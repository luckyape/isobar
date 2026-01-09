
import { getClosetDB, type BlobMeta } from './db';
import { type Vault } from '../vault/store';
import { withClosetLock } from './locks';
import { type ClosetPolicy, isHashPinned } from './policy';

export interface ReconciliationParams {
    /** Policy for checking hash pins */
    policy?: ClosetPolicy;
    /** Ephemeral active hashes (UI-pinned, don't delete) */
    activeHashes?: string[];
}

export interface ReconciliationReport {
    // Pass 1: Integrity
    missingFound: number;
    sizeMismatches: number;
    metaMarkedMissing: number;
    sizesFixed: number;

    // Pass 2: Orphans
    softOrphansFound: number;      // present=0 but exists in vault
    trueOrphansFound: number;      // not in DB at all (report only, don't delete)
    pinnedOrphansSkipped: number;  // would be deleted but pinned
    orphansReclaimed: number;      // actually deleted

    // Accounting
    totalBytesRecomputed: number;
    previousTotalBytes: number;

    // Timing
    startMs: number;
    endMs: number;
}

/**
 * Reconcile differences between ClosetDB metadata and actual Vault storage.
 * 
 * Strategy:
 * 1. Pass 1 (Integrity): Iterate all blobs marked 'present=1'.
 *    - Check existence in Vault. If missing -> mark present=0.
 *    - Check size in Vault. If mismatch -> update sizeBytes.
 * 
 * 2. Pass 2 (Orphan Detection):
 *    - Soft orphans (present=0 in DB but exists in vault): Safe to delete.
 *    - True orphans (not in DB at all): Report only, DON'T delete.
 *      This avoids race with sync writes that haven't committed metadata yet.
 * 
 * 3. Totals Recomputation:
 *    - After fixes, recompute totalBytesPresent from DB metadata.
 * 
 * @param vault The vault instance to check against.
 * @param fix Whether to apply fixes or just report.
 * @param params Optional params for pinned hash checking.
 */
export async function reconcileStorage(
    vault: Vault,
    fix: boolean = false,
    params: ReconciliationParams = {}
): Promise<ReconciliationReport> {
    return withClosetLock('closet', async () => {
        const startMs = Date.now();
        const closetDB = getClosetDB();
        await closetDB.open();

        const allBlobs = await closetDB.getAllBlobMetas();

        const report: ReconciliationReport = {
            missingFound: 0,
            sizeMismatches: 0,
            metaMarkedMissing: 0,
            sizesFixed: 0,
            softOrphansFound: 0,
            trueOrphansFound: 0,
            pinnedOrphansSkipped: 0,
            orphansReclaimed: 0,
            totalBytesRecomputed: 0,
            previousTotalBytes: 0,
            startMs,
            endMs: 0
        };

        report.previousTotalBytes = await closetDB.getTotalBytesPresent();

        // Build O(1) lookup map with normalized keys
        const dbHashMap = new Map<string, BlobMeta>(
            allBlobs.map(b => [b.hash.toLowerCase(), b])
        );

        // Prepare pinned hash set for O(1) lookup
        const policyPinnedHashes = new Set<string>();
        if (params.policy) {
            for (const pin of params.policy.pins) {
                if (pin.type === 'hash') {
                    policyPinnedHashes.add(pin.hash.toLowerCase());
                }
            }
        }
        const activeHashSet = new Set<string>(
            (params.activeHashes ?? []).map(h => h.toLowerCase())
        );

        // Helper: is hash pinned?
        const isPinned = (hash: string, meta: BlobMeta | undefined): boolean => {
            const normalizedHash = hash.toLowerCase();
            if (policyPinnedHashes.has(normalizedHash)) return true;
            if (activeHashSet.has(normalizedHash)) return true;
            if (meta?.pinned === 1) return true;
            return false;
        };

        // =========================================================================
        // Pass 1: Integrity Check (present=1 blobs)
        // =========================================================================
        for (const blob of allBlobs) {
            if (blob.present !== 1) continue;

            const normalizedHash = blob.hash.toLowerCase();
            const { exists, size } = await vault.stat(normalizedHash);

            if (!exists) {
                report.missingFound++;
                if (fix) {
                    blob.present = 0;
                    await closetDB.upsertBlobMeta(blob);
                    report.metaMarkedMissing++;
                }
            } else if (size !== undefined && size !== blob.sizeBytes) {
                report.sizeMismatches++;
                if (fix) {
                    blob.sizeBytes = size;
                    await closetDB.upsertBlobMeta(blob);
                    report.sizesFixed++;
                }
            }
        }

        // =========================================================================
        // Pass 2: Orphan Detection
        // =========================================================================
        const vaultHashes = await vault.getAllHashes();

        for (const vaultHash of vaultHashes) {
            const normalizedHash = vaultHash.toLowerCase();
            const dbBlob = dbHashMap.get(normalizedHash);

            // Case A: True orphan (not in DB at all)
            if (!dbBlob) {
                report.trueOrphansFound++;
                // DO NOT DELETE - could be mid-flight sync write
                // Report only, require explicit ops action
                continue;
            }

            // Case B: Soft orphan (in DB with present=0)
            if (dbBlob.present === 0) {
                report.softOrphansFound++;

                // Check if pinned (even soft-deleted blobs can be pinned)
                if (isPinned(normalizedHash, dbBlob)) {
                    report.pinnedOrphansSkipped++;
                    // Optionally flip present=1 if we want to restore
                    // For now, just skip deletion
                    continue;
                }

                if (fix) {
                    await vault.delete(normalizedHash);
                    report.orphansReclaimed++;
                }
            }
            // Case C: present=1 - not an orphan, already handled in Pass 1
        }

        // =========================================================================
        // Pass 3: Totals Recomputation (if fixing)
        // =========================================================================
        if (fix) {
            // Reload metadata after changes
            const updatedBlobs = await closetDB.getAllBlobMetas();
            const newTotal = updatedBlobs
                .filter(b => b.present === 1)
                .reduce((sum, b) => sum + b.sizeBytes, 0);

            await closetDB.setTotalBytesPresent(newTotal);
            report.totalBytesRecomputed = newTotal;
        }

        report.endMs = Date.now();
        return report;
    });
}

// =============================================================================
// Reclaim True Orphans (Explicit Ops Action)
// =============================================================================

export interface ReclaimParams {
    /** Required confirmation token: must be 'RECLAIM' */
    confirmationToken: string;

    /** 
     * Policy for checking pinned hashes (if provided, pinned hashes are protected).
     */
    policy?: ClosetPolicy;

    /**
     * Set of hashes known to appear in verified manifests.
     * If provided, only delete hashes NOT in this set (i.e., truly orphaned junk).
     * If not provided, reclaim is BLOCKED unless dangerSkipManifestCheck is true.
     */
    manifestKnownHashes?: Set<string>;

    /**
     * DANGEROUS: Skip manifest verification check.
     * Only set this if you are 100% sure what you're doing.
     * Requires typing 'I_UNDERSTAND_DATA_LOSS_RISK' as value.
     */
    dangerSkipManifestCheck?: string;

    /**
     * Stale threshold for in-flight entries (default: 30 minutes).
     * Only used when dangerSkipManifestCheck is provided.
     * In-flight entries older than this may be reclaimed.
     */
    inflightStaleMs?: number;
}

export interface ReclaimReport {
    trueOrphansFound: number;
    orphansReclaimed: number;
    orphansSkippedPinned: number;
    orphansSkippedInManifest: number;
    orphansSkippedInflight: number;
    bytesReclaimed: number;
    errors: string[];
    durationMs: number;
}

/** Default stale threshold: 30 minutes */
const DEFAULT_INFLIGHT_STALE_MS = 30 * 60 * 1000;

/**
 * Explicitly reclaim true orphans (blobs in vault not tracked by DB).
 * 
 * SAFETY RAILS:
 * 1. Requires confirmation token 'RECLAIM'
 * 2. Runs under unified closet lock
 * 3. Skips pinned hashes (policy.pins, meta.pinned)
 * 4. Skips hashes that appear in verified manifests (unless dangerSkipManifestCheck)
 * 5. Skips hashes marked as in-flight (mid-sync)
 * 6. Without manifestKnownHashes, requires explicit danger acknowledgment
 * 
 * @param vault The vault instance
 * @param params Reclaim parameters with safety options
 */
export async function reclaimTrueOrphans(
    vault: Vault,
    params: ReclaimParams
): Promise<ReclaimReport> {
    // Rail 1: Require confirmation token
    if (params.confirmationToken !== 'RECLAIM') {
        throw new Error('Invalid confirmation token. Required: "RECLAIM"');
    }

    // Rail 2: Require manifest proof OR explicit danger acknowledgment
    const hasManifestProof = params.manifestKnownHashes && params.manifestKnownHashes.size > 0;
    const hasDangerAck = params.dangerSkipManifestCheck === 'I_UNDERSTAND_DATA_LOSS_RISK';

    if (!hasManifestProof && !hasDangerAck) {
        throw new Error(
            'Reclaim requires either manifestKnownHashes (set of hashes from verified manifests) ' +
            'OR dangerSkipManifestCheck="I_UNDERSTAND_DATA_LOSS_RISK". ' +
            'This prevents accidental mass deletion if ClosetDB was reset.'
        );
    }

    const inflightStaleMs = params.inflightStaleMs ?? DEFAULT_INFLIGHT_STALE_MS;

    return withClosetLock('closet', async () => {
        const startMs = Date.now();
        const closetDB = getClosetDB();
        await closetDB.open();

        const report: ReclaimReport = {
            trueOrphansFound: 0,
            orphansReclaimed: 0,
            orphansSkippedPinned: 0,
            orphansSkippedInManifest: 0,
            orphansSkippedInflight: 0,
            bytesReclaimed: 0,
            errors: [],
            durationMs: 0
        };

        // Build set of known DB hashes (normalized)
        const allBlobs = await closetDB.getAllBlobMetas();
        const dbHashSet = new Set(allBlobs.map(b => b.hash.toLowerCase()));

        // Build pinned hash set for O(1) lookup
        const pinnedHashes = new Set<string>();
        if (params.policy) {
            for (const pin of params.policy.pins) {
                if (pin.type === 'hash') {
                    pinnedHashes.add(pin.hash.toLowerCase());
                }
            }
        }
        // Also add DB meta-pinned hashes
        for (const blob of allBlobs) {
            if (blob.pinned === 1) {
                pinnedHashes.add(blob.hash.toLowerCase());
            }
        }

        // Manifest known hashes (normalized)
        const manifestHashes = params.manifestKnownHashes
            ? new Set(Array.from(params.manifestKnownHashes).map(h => h.toLowerCase()))
            : null;

        // Build in-flight hash set (with stale handling)
        const allInflight = await closetDB.getAllInflight();
        const inflightHashes = new Set<string>();
        const now = Date.now();

        for (const entry of allInflight) {
            const age = now - entry.startedAtMs;
            // If NOT in danger mode, all inflight are protected
            // If in danger mode, only protect non-stale entries
            if (!hasDangerAck || age < inflightStaleMs) {
                inflightHashes.add(entry.hash.toLowerCase());
            }
        }

        // Enumerate vault
        const vaultHashes = await vault.getAllHashes();

        for (const vaultHash of vaultHashes) {
            const normalizedHash = vaultHash.toLowerCase();

            // Skip if tracked in DB (not a true orphan)
            if (dbHashSet.has(normalizedHash)) {
                continue;
            }

            report.trueOrphansFound++;

            // Rail 3: Skip if pinned
            if (pinnedHashes.has(normalizedHash)) {
                report.orphansSkippedPinned++;
                continue;
            }

            // Rail 4: Skip if appears in verified manifest (it's legit content, not junk)
            if (manifestHashes && manifestHashes.has(normalizedHash)) {
                report.orphansSkippedInManifest++;
                continue;
            }

            // Rail 5: Skip if in-flight (mid-sync)
            if (inflightHashes.has(normalizedHash)) {
                report.orphansSkippedInflight++;
                continue;
            }

            // Safe to delete
            try {
                const statBefore = await vault.stat(normalizedHash);
                await vault.delete(normalizedHash);
                report.orphansReclaimed++;
                if (statBefore.size) {
                    report.bytesReclaimed += statBefore.size;
                }
            } catch (err) {
                report.errors.push(`Failed to delete ${normalizedHash}: ${err}`);
            }
        }

        report.durationMs = Date.now() - startMs;
        return report;
    });
}
