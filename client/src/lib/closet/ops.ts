/**
 * Weather Forecast CDN — Closet Ops Module
 *
 * Exports for the Closet Ops UI. All operations are read-only except
 * explicitly marked actions that require user confirmation.
 */

import { getClosetDB, type ClosetDB, type BlobMeta } from './db';
import { getBlobStore } from './blobStore';
import { getVault } from '../vault';
import {
    computeReachableWithDetails,
    type ReachabilityResult,
    type ReachabilityParams,
    type TrustMode
} from './reachability';
import {
    sweepAndEnforce,
    getGCStats,
    planDeletion,
    type GCParams,
    type GCResult,
    type DeletionPlan
} from './gc';
import { type ClosetPolicy, getRetentionCutoff, getDefaultClosetPolicy } from './policy';
import { withClosetLock } from './locks';
import { reconcileStorage, reclaimTrueOrphans, type ReconciliationReport, type ReclaimReport } from './reconcile';

// =============================================================================
// Types
// =============================================================================

export interface OpsSnapshot {
    // Storage
    totalBytesPresent: number;
    quotaBytes: number;
    headroomBytes: number;
    presentBlobsCount: number;
    pinnedBlobsCount: number;

    // Manifests
    manifestRefsCount: number;
    manifestsInWindowCount: number;
    oldestManifestDate: string | null;
    newestManifestDate: string | null;

    // Reachability
    reachability: ReachabilityResult | null;
    reachabilityError: string | null;

    // GC Preview
    deletionPlan: DeletionPlan | null;
    deletionPlanError: string | null;

    // Pack status
    packEntriesCount: number;
    distinctPackIds: string[];

    // Meta
    lastGcAt: number;
    trustMode: TrustMode;
    policy: ClosetPolicy;

    // Top blobs
    topBlobsBySize: BlobMeta[];
}

export interface OpsConfig {
    trustMode: TrustMode;
    expectedManifestPubKeyHex?: string;
    policy: ClosetPolicy;
}

/**
 * Check if config represents trusted mode.
 */
export function isTrustedMode(config: OpsConfig): boolean {
    return config.trustMode === 'trusted' && !!config.expectedManifestPubKeyHex;
}

/**
 * Error code for trusted mode requirement.
 */
export const TRUSTED_MODE_REQUIRED = 'TRUSTED_MODE_REQUIRED';

/**
 * Assert that config is in trusted mode, throw if not.
 */
export function assertTrustedMode(config: OpsConfig, operation: string): void {
    if (!isTrustedMode(config)) {
        const error = new Error(
            `${TRUSTED_MODE_REQUIRED}: Operation "${operation}" requires trusted mode. ` +
            `Set expectedManifestPubKeyHex and trustMode='trusted'.`
        );
        (error as any).code = TRUSTED_MODE_REQUIRED;
        throw error;
    }
}

// =============================================================================
// Snapshot Computation
// =============================================================================

/**
 * Compute a full Ops snapshot without any mutations.
 * Safe to call from UI render path.
 */
export async function computeOpsSnapshot(config: OpsConfig): Promise<OpsSnapshot> {
    const closetDB = getClosetDB();
    await closetDB.open();

    const { trustMode, expectedManifestPubKeyHex, policy } = config;
    const nowMs = Date.now();

    // Storage stats
    const totalBytesPresent = await closetDB.getTotalBytesPresent();
    const presentBlobsCount = await closetDB.countPresentBlobs();
    const pinnedBlobsCount = await closetDB.countPinnedBlobs();

    // Manifest stats
    const allManifestRefs = await closetDB.getAllManifestRefs();
    const { oldest: oldestManifestDate, newest: newestManifestDate } = await closetDB.getManifestDateBounds();

    const windowCutoffMs = getRetentionCutoff(nowMs, policy.windowDays);
    const manifestsInWindowCount = allManifestRefs.filter((ref) => {
        const dateMs = new Date(ref.date + 'T00:00:00Z').getTime();
        return dateMs >= windowCutoffMs;
    }).length;

    // Pack stats
    const packEntriesCount = await closetDB.countPackEntries();
    const distinctPackIds = await closetDB.getDistinctPackIds();

    // Last GC
    const lastGcAt = await closetDB.getLastGcAt();

    // Top blobs
    const topBlobsBySize = await closetDB.listTopBlobsBySize(50);

    // Reachability (may throw in trusted mode without pubkey)
    let reachability: ReachabilityResult | null = null;
    let reachabilityError: string | null = null;
    try {
        reachability = await computeReachableWithDetails({
            policy,
            nowMs,
            trustMode,
            expectedManifestPubKeyHex,
            activeHashes: []
        });
    } catch (err) {
        reachabilityError = String(err);
    }

    // Deletion plan (may throw)
    let deletionPlan: DeletionPlan | null = null;
    let deletionPlanError: string | null = null;
    if (!reachabilityError) {
        try {
            deletionPlan = await planDeletion({
                policy,
                nowMs,
                trustMode,
                expectedManifestPubKeyHex,
                activeHashes: []
            });
        } catch (err) {
            deletionPlanError = String(err);
        }
    }

    return {
        totalBytesPresent,
        quotaBytes: policy.quotaBytes,
        headroomBytes: policy.quotaBytes - totalBytesPresent,
        presentBlobsCount,
        pinnedBlobsCount,

        manifestRefsCount: allManifestRefs.length,
        manifestsInWindowCount,
        oldestManifestDate,
        newestManifestDate,

        reachability,
        reachabilityError,

        deletionPlan,
        deletionPlanError,

        packEntriesCount,
        distinctPackIds,

        lastGcAt,
        trustMode,
        policy,

        topBlobsBySize
    };
}

// =============================================================================
// Actions (require explicit user trigger)
// =============================================================================

/**
 * Run GC with explicit user confirmation.
 * DESTRUCTIVE: Requires trusted mode.
 */
export async function runGCNow(config: OpsConfig): Promise<GCResult> {
    assertTrustedMode(config, 'runGCNow');

    return sweepAndEnforce({
        policy: config.policy,
        nowMs: Date.now(),
        trustMode: config.trustMode,
        expectedManifestPubKeyHex: config.expectedManifestPubKeyHex,
        activeHashes: []
    });
}

/**
 * Prune manifest refs outside the retention window.
 */
export async function pruneManifestRefs(config: OpsConfig): Promise<{ pruned: number; hashes: string[] }> {
    const closetDB = getClosetDB();
    await closetDB.open();

    const windowCutoffMs = getRetentionCutoff(Date.now(), config.policy.windowDays);

    // Get pinned manifest dates
    const pinnedDates = new Set<string>();
    for (const pin of config.policy.pins) {
        if (pin.type === 'manifest') {
            pinnedDates.add(pin.date);
        }
    }

    return closetDB.pruneManifestRefsOutsideWindow(windowCutoffMs, pinnedDates);
}

/**
 * Reset closet completely (dangerous!).
 * DESTRUCTIVE: Requires trusted mode.
 */
export async function resetCloset(config: OpsConfig): Promise<void> {
    assertTrustedMode(config, 'resetCloset');

    const closetDB = getClosetDB();
    await closetDB.open();
    await closetDB.resetCloset();
}

/**
 * Flush the access buffer in BlobStore.
 */
export async function flushAccessBuffer(): Promise<void> {
    const blobStore = getBlobStore();
    // BlobStore.flushAccessBuffer is a public method
    await (blobStore as any).flushAccessBuffer();
}

/**
 * Pin a blob (prevent GC).
 */
export async function pinBlob(hash: string): Promise<void> {
    return withClosetLock('closet', async () => {
        const db = getClosetDB();
        await db.open();
        const meta = await db.getBlobMeta(hash);
        if (meta) {
            meta.pinned = 1;
            await db.upsertBlobMeta(meta);
        } else {
            throw new Error(`Blob ${hash} not found`);
        }
    });
}

/**
 * Unpin a blob (allow GC).
 */
export async function unpinBlob(hash: string): Promise<void> {
    return withClosetLock('closet', async () => {
        const db = getClosetDB();
        await db.open();
        const meta = await db.getBlobMeta(hash);
        if (meta) {
            meta.pinned = 0;
            await db.upsertBlobMeta(meta);
        }
    });
}

/**
 * Run storage reconciliation.
 * DESTRUCTIVE when fix=true: Requires trusted mode.
 */
export async function runReconciliation(
    config: OpsConfig,
    fix: boolean,
    policy?: ClosetPolicy,
    activeHashes?: string[]
): Promise<ReconciliationReport> {
    if (fix) {
        assertTrustedMode(config, 'runReconciliation(fix=true)');
    }

    const vault = getVault();
    return reconcileStorage(vault, fix, { policy, activeHashes });
}

/**
 * Reclaim true orphans (blobs in vault but not in DB).
 * DANGEROUS: Requires confirmation token 'RECLAIM' plus manifest proof OR danger ack.
 * DESTRUCTIVE: Requires trusted mode.
 */
export async function runReclaimTrueOrphans(
    config: OpsConfig,
    confirmationToken: string,
    manifestKnownHashes?: Set<string>,
    policy?: ClosetPolicy,
    dangerSkipManifestCheck?: string
): Promise<ReclaimReport> {
    assertTrustedMode(config, 'runReclaimTrueOrphans');

    const vault = getVault();
    return reclaimTrueOrphans(vault, {
        confirmationToken,
        manifestKnownHashes,
        policy,
        dangerSkipManifestCheck
    });
}

// =============================================================================
// Re-exports
// =============================================================================

export { type TrustMode } from './reachability';
export { type ClosetPolicy } from './policy';
export { type BlobMeta } from './db';
export {
    type GCResult,
    type DeletionPlan,
    type DeletionPlanEntry
} from './gc';
export type { ReconciliationReport, ReclaimReport } from './reconcile';

export { getDefaultClosetPolicy } from './policy';

