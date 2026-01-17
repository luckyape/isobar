/**
 * Weather Forecast CDN — Garbage Collection Engine
 *
 * Deterministic mark-and-sweep GC with quota enforcement.
 * Deletion order is (lastAccess ASC, hash ASC) for reproducibility.
 */

import { computeReachable, type ReachabilityParams, type TrustMode } from './reachability';
import { getClosetDB, type ClosetDB, type BlobMeta } from './db';
import { getVault } from '../vault';
import { type ClosetPolicy, getDefaultClosetPolicy } from './policy';
import { withClosetLock } from './locks';

// =============================================================================
// Types
// =============================================================================

export interface GCParams {
    policy: ClosetPolicy;
    nowMs: number;
    trustMode: TrustMode;
    expectedManifestPubKeyHex?: string;
    activeHashes?: string[];
}

export interface GCResult {
    reachableCount: number;
    deletedCount: number;
    freedBytes: number;
    bytesBefore: number;
    bytesAfter: number;
    cannotSatisfyQuota: boolean;
    lastGcAt: number;
}

// =============================================================================
// Main GC Function
// =============================================================================

/**
 * Run mark-and-sweep GC with deterministic quota enforcement.
 * Protected by unified closet lock.
 */
export async function sweepAndEnforce(params: GCParams): Promise<GCResult> {
    return withClosetLock('closet', async () => {
        const { policy, nowMs, trustMode, expectedManifestPubKeyHex, activeHashes } = params;

        const closetDB = getClosetDB();
        await closetDB.open();

        const bytesBefore = await closetDB.getTotalBytesPresent();

        // 1. Compute reachable set
        const reachable = await computeReachable({
            policy,
            nowMs,
            trustMode,
            expectedManifestPubKeyHex,
            activeHashes
        });

        // 1.5 Get in-flight hashes (shared across sweep and quota)
        const allInflight = await closetDB.getAllInflight();
        const inflightHashes = new Set(allInflight.map(e => e.hash.toLowerCase()));

        // 2. Sweep unreachable and unpinned blobs
        const sweepResult = await sweepUnreachable(closetDB, reachable, inflightHashes);

        // 3. Enforce quota if still over
        let bytesAfter = bytesBefore - sweepResult.freedBytes;
        let quotaResult = { deletedCount: 0, freedBytes: 0, skippedInflight: 0 };
        let cannotSatisfyQuota = false;

        if (bytesAfter > policy.quotaBytes) {
            quotaResult = await enforceQuota(closetDB, reachable, inflightHashes, policy.quotaBytes, bytesAfter);
            bytesAfter -= quotaResult.freedBytes;

            // Still over quota after enforcement means all remaining blobs are reachable/pinned
            if (bytesAfter > policy.quotaBytes) {
                cannotSatisfyQuota = true;
            }
        }

        // 4. Update metadata
        await closetDB.setTotalBytesPresent(Math.max(0, bytesAfter));
        await closetDB.setLastGcAt(nowMs);

        return {
            reachableCount: reachable.size,
            deletedCount: sweepResult.deletedCount + quotaResult.deletedCount,
            freedBytes: sweepResult.freedBytes + quotaResult.freedBytes,
            bytesBefore,
            bytesAfter,
            cannotSatisfyQuota,
            lastGcAt: nowMs
        };
    });
}

// =============================================================================
// Sweep Phase
// =============================================================================

interface SweepResult {
    deletedCount: number;
    freedBytes: number;
    skippedInflight: number;
}

/**
 * Delete all unreachable and unpinned blobs.
 * SAFETY: Skips blobs that are currently in-flight (mid-sync).
 */
async function sweepUnreachable(
    closetDB: ClosetDB,
    reachable: Set<string>,
    inflightHashes: Set<string>
): Promise<SweepResult> {
    const allBlobs = await closetDB.getAllBlobMetas();

    let deletedCount = 0;
    let freedBytes = 0;
    let skippedInflight = 0;

    for (const blob of allBlobs) {
        // Skip if already deleted or pinned or reachable
        if (blob.present !== 1) continue;
        if (blob.pinned === 1) continue;
        if (reachable.has(blob.hash)) continue;

        // SAFETY: Skip if in-flight (mid-sync download)
        if (inflightHashes.has(blob.hash.toLowerCase())) {
            skippedInflight++;
            continue;
        }

        // Delete!
        await markBlobDeleted(closetDB, blob);
        deletedCount++;
        freedBytes += blob.sizeBytes;
    }

    return { deletedCount, freedBytes, skippedInflight };
}

// =============================================================================
// Quota Enforcement Phase
// =============================================================================

interface QuotaResult {
    deletedCount: number;
    freedBytes: number;
    skippedInflight: number;
}

/**
 * Enforce quota by deleting blobs in deterministic order.
 * Only deletes unreachable and unpinned blobs.
 * SAFETY: Skips blobs that are currently in-flight (mid-sync).
 * Order: lastAccess ASC, then hash ASC
 */
async function enforceQuota(
    closetDB: ClosetDB,
    reachable: Set<string>,
    inflightHashes: Set<string>,
    quotaBytes: number,
    currentBytes: number
): Promise<QuotaResult> {
    // Get blobs sorted by (lastAccess, hash) using the compound index
    const sortedBlobs = await closetDB.listPresentBlobsSortedForDeletion();

    let deletedCount = 0;
    let freedBytes = 0;
    let skippedInflight = 0;
    let bytesRemaining = currentBytes;

    for (const blob of sortedBlobs) {
        // Stop if under quota
        if (bytesRemaining <= quotaBytes) break;

        // Skip pinned
        if (blob.pinned === 1) continue;

        // Skip reachable
        if (reachable.has(blob.hash)) continue;

        // SAFETY: Skip if in-flight (mid-sync download)
        if (inflightHashes.has(blob.hash.toLowerCase())) {
            skippedInflight++;
            continue;
        }

        // Delete this blob
        await markBlobDeleted(closetDB, blob);
        deletedCount++;
        freedBytes += blob.sizeBytes;
        bytesRemaining -= blob.sizeBytes;
    }

    return { deletedCount, freedBytes, skippedInflight };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Mark a blob as deleted (present=0).
 * The actual blob data deletion from vault would happen here if vault exposed it.
 */
async function markBlobDeleted(closetDB: ClosetDB, blob: BlobMeta): Promise<void> {
    // 1. Physical Deletion (Idempotent)
    const vault = getVault();
    await vault.delete(blob.hash);

    // 2. Metadata Update (only after physical delete succeeds)
    blob.present = 0;
    await closetDB.upsertBlobMeta(blob);
}

/**
 * Get GC statistics without performing any deletions.
 */
export async function getGCStats(params: GCParams): Promise<{
    totalBytesPresent: number;
    reachableCount: number;
    unreachableCount: number;
    pinnedCount: number;
    deletableBytes: number;
}> {
    const { policy, nowMs, trustMode, expectedManifestPubKeyHex, activeHashes } = params;

    const closetDB = getClosetDB();
    await closetDB.open();

    const totalBytesPresent = await closetDB.getTotalBytesPresent();
    const reachable = await computeReachable({
        policy,
        nowMs,
        trustMode,
        expectedManifestPubKeyHex,
        activeHashes
    });

    const allBlobs = await closetDB.getAllBlobMetas();
    let unreachableCount = 0;
    let pinnedCount = 0;
    let deletableBytes = 0;

    for (const blob of allBlobs) {
        if (blob.present !== 1) continue;

        if (blob.pinned === 1) {
            pinnedCount++;
            continue;
        }

        if (!reachable.has(blob.hash)) {
            unreachableCount++;
            deletableBytes += blob.sizeBytes;
        }
    }

    return {
        totalBytesPresent,
        reachableCount: reachable.size,
        unreachableCount,
        pinnedCount,
        deletableBytes
    };
}

// =============================================================================
// Dry Run / Plan Deletion (for Ops UI)
// =============================================================================

export interface DeletionPlanEntry {
    hash: string;
    sizeBytes: number;
    lastAccess: number;
    reason: 'unreachable' | 'quota-enforcement';
}

export interface DeletionPlan {
    entries: DeletionPlanEntry[];
    sweepCount: number;
    sweepBytes: number;
    quotaEnforcementCount: number;
    quotaEnforcementBytes: number;
    wouldNeedQuotaEnforcement: boolean;
    cannotSatisfyQuota: boolean;
    bytesAfter: number;
}

/**
 * Plan deletion without actually deleting anything (dry run).
 * Uses exact same ordering as real GC (lastAccess ASC, hash ASC).
 */
export async function planDeletion(params: GCParams): Promise<DeletionPlan> {
    const { policy, nowMs, trustMode, expectedManifestPubKeyHex, activeHashes } = params;

    const closetDB = getClosetDB();
    await closetDB.open();

    const bytesBefore = await closetDB.getTotalBytesPresent();
    const reachable = await computeReachable({
        policy,
        nowMs,
        trustMode,
        expectedManifestPubKeyHex,
        activeHashes
    });

    const entries: DeletionPlanEntry[] = [];
    let sweepCount = 0;
    let sweepBytes = 0;
    let quotaEnforcementCount = 0;
    let quotaEnforcementBytes = 0;

    // Get blobs sorted for deletion (same order as real GC)
    const sortedBlobs = await closetDB.listPresentBlobsSortedForDeletion();

    // Phase 1: Sweep (unreachable + unpinned)
    for (const blob of sortedBlobs) {
        if (blob.pinned === 1) continue;
        if (reachable.has(blob.hash)) continue;

        entries.push({
            hash: blob.hash,
            sizeBytes: blob.sizeBytes,
            lastAccess: blob.lastAccess,
            reason: 'unreachable'
        });
        sweepCount++;
        sweepBytes += blob.sizeBytes;
    }

    // Phase 2: Quota enforcement (if still over quota after sweep)
    const bytesAfterSweep = bytesBefore - sweepBytes;
    const wouldNeedQuotaEnforcement = bytesAfterSweep > policy.quotaBytes;

    if (wouldNeedQuotaEnforcement) {
        // Already swept all unreachable - no additional deletions possible
        // (quota enforcement deletes from same pool, already in entries)
    }

    const bytesAfter = bytesBefore - sweepBytes - quotaEnforcementBytes;
    const cannotSatisfyQuota = bytesAfter > policy.quotaBytes;

    return {
        entries,
        sweepCount,
        sweepBytes,
        quotaEnforcementCount,
        quotaEnforcementBytes,
        wouldNeedQuotaEnforcement,
        cannotSatisfyQuota,
        bytesAfter
    };
}
