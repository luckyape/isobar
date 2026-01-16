/**
 * Weather Forecast CDN — Closet Maintenance Hook
 *
 * Post-sync maintenance: index updates and GC trigger.
 * Called after SyncEngine downloads new artifacts.
 */

import { sweepAndEnforce, type GCResult } from './gc';
import { getClosetDB, type ClosetDB, buildObservationKey, buildForecastKey } from './db';
import { getVault, type Vault } from '../vault/store';
import { getDefaultClosetPolicy, type ClosetPolicy } from './policy';
import { type TrustMode } from './reachability';
import { unpackageManifest } from '@cdn/manifest';
import type { DailyManifest, ManifestEntry } from '@cdn/types';
import { withClosetLock } from './locks';
import { getZonedDateParts, formatDateTimeKey } from '../timeUtils';

// =============================================================================
// Types
// =============================================================================

export interface SyncResult {
    /** Hashes of artifact blobs downloaded this sync */
    newArtifactHashes: string[];
    /** Hashes of manifest blobs downloaded this sync */
    newManifestHashes: string[];
}

export interface MaintenanceParams {
    sync: SyncResult;
    policy: ClosetPolicy;
    nowMs: number;
    trustMode: TrustMode;
    expectedManifestPubKeyHex?: string;
    activeHashes?: string[];
    forceGC?: boolean;
}

export interface MaintenanceResult {
    bytesUsed: number;
    bytesFreed: number;
    deleted: number;
    reachable: number;
    cannotSatisfyQuota: boolean;
    lastGcAt: number;
    indexedManifests: number;
    indexedObservations: number;
    indexedForecasts: number;
    /** If GC ran, this contains details */
    gcResult?: GCResult;
}

// GC trigger threshold: 6 hours
const GC_INTERVAL_MS = 6 * 60 * 60 * 1000;

// =============================================================================
// Implementation
// =============================================================================

/**
 * Main entry point: Called by SyncEngine after new data arrives.
 * Protected by unified closet lock.
 */
export async function onSyncComplete(params: MaintenanceParams): Promise<MaintenanceResult> {
    return withClosetLock('closet', async () => {
        const { sync, policy, nowMs, trustMode, expectedManifestPubKeyHex, activeHashes, forceGC } = params;
        const closetDB = getClosetDB();
        const vault = getVault();
        await closetDB.open();
        await vault.open();

        // 1. Index new manifests
        const indexStats = await indexNewManifests(closetDB, vault, sync.newManifestHashes);

        // 2. Refresh metadata for ALL new artifacts (chunks)
        if (sync.newArtifactHashes.length > 0) {
            await updateBlobMetadata(closetDB, vault, sync.newArtifactHashes, nowMs);
        }

        // 3. Mark access for known active hashes (e.g. current UI needs)
        if (activeHashes && activeHashes.length > 0) {
            for (const hash of activeHashes) {
                const meta = await closetDB.getBlobMeta(hash);
                if (meta) {
                    meta.lastAccess = nowMs;
                    await closetDB.upsertBlobMeta(meta);
                }
            }
        }

        // 4. Decide whether to run GC
        const bytesUsed = await closetDB.getTotalBytesPresent();
        const lastGcAt = await closetDB.getLastGcAt();
        const timeSinceGc = nowMs - lastGcAt;

        const isTrusted = trustMode === 'trusted' && !!expectedManifestPubKeyHex;

        const shouldGC =
            (forceGC ||
                bytesUsed > policy.quotaBytes ||
                timeSinceGc > GC_INTERVAL_MS) &&
            isTrusted; // DISABLE GC if not in trusted mode

        // 5. Run GC if needed
        let gcResult: GCResult | undefined;

        if (shouldGC) {
            gcResult = await sweepAndEnforce({
                policy,
                nowMs,
                trustMode,
                expectedManifestPubKeyHex,
                activeHashes
            });
        }

        const bytesAfterGC = gcResult?.bytesAfter ?? bytesUsed;

        return {
            bytesUsed: bytesAfterGC,
            bytesFreed: gcResult?.freedBytes ?? 0,
            deleted: gcResult?.deletedCount ?? 0,
            reachable: gcResult?.reachableCount ?? 0,
            cannotSatisfyQuota: gcResult?.cannotSatisfyQuota ?? false,
            lastGcAt: gcResult?.lastGcAt ?? lastGcAt,
            indexedManifests: indexStats.manifests,
            indexedObservations: indexStats.observations,
            indexedForecasts: indexStats.forecasts,
            gcResult
        };
    });
}

// =============================================================================
// Manifest Indexing
// =============================================================================

interface IndexStats {
    manifests: number;
    observations: number;
    forecasts: number;
}

/**
 * Index newly downloaded manifests by parsing their entries
 * and upserting to obsIndex/forecastIndex.
 */
async function indexNewManifests(
    closetDB: ClosetDB,
    vault: Vault,
    manifestHashes: string[]
): Promise<IndexStats> {
    let manifests = 0;
    let observations = 0;
    let forecasts = 0;

    for (const hash of manifestHashes) {
        try {
            const blob = await vault.getBlob(hash);
            if (!blob) continue;

            // Unpackage without verification for indexing
            // (verification happens during reachability if pubkey is provided)
            const manifest = await unpackageManifest(blob);

            // Upsert manifest reference
            await closetDB.upsertManifestRef(
                manifest.date,
                'daily',
                '',
                hash
            );
            manifests++;

            // Index each entry
            for (const entry of manifest.artifacts) {
                await indexManifestEntry(closetDB, entry, hash);

                if (entry.type === 'observation') observations++;
                if (entry.type === 'forecast') forecasts++;
            }
        } catch (err) {
            console.warn(`[closet] Failed to index manifest ${hash}:`, err);
        }
    }

    return { manifests, observations, forecasts };
}

/**
 * Index a single manifest entry.
 */
async function indexManifestEntry(
    closetDB: ClosetDB,
    entry: ManifestEntry,
    _manifestHash: string
): Promise<void> {
    if (entry.type === 'observation') {
        if (entry.source && entry.observedAtBucket && entry.stationSetId) {
            // Normalize observedAtBucket to minute-precision for consistent querying
            // The manifest may have seconds/Z (e.g. "2024-01-01T12:00:00Z")
            // The query layer uses "2024-01-01T12:00"
            let bucketIso = entry.observedAtBucket;
            const parts = getZonedDateParts(new Date(entry.observedAtBucket), 'UTC');
            if (parts) {
                const formatted = formatDateTimeKey(parts);
                if (formatted) bucketIso = formatted;
            }

            const key = buildObservationKey(
                entry.source,
                bucketIso,
                60, // Default bucket minutes
                entry.stationSetId
            );
            await closetDB.upsertObservationIndex({
                key,
                source: entry.source,
                observedAtBucket: bucketIso,
                bucketMinutes: 60,
                stationSetId: entry.stationSetId,
                hash: entry.hash
            });
        }
    } else if (entry.type === 'forecast') {
        if (entry.model && entry.runTime) {
            // Note: gridKey is not in ManifestEntry by default
            // Using placeholder for now
            const gridKey = 'default';
            const key = buildForecastKey(entry.model, entry.runTime, gridKey);
            await closetDB.upsertForecastIndex({
                key,
                model: entry.model,
                runTime: entry.runTime,
                gridKey,
                hash: entry.hash
            });
        }
    }
}

// =============================================================================
// Blob Metadata Updates
// =============================================================================

/**
 * Update blob metadata for newly downloaded artifacts.
 */
async function updateBlobMetadata(
    closetDB: ClosetDB,
    vault: Vault,
    artifactHashes: string[],
    nowMs: number
): Promise<void> {
    let totalNewBytes = 0;

    for (const hash of artifactHashes) {
        const existing = await closetDB.getBlobMeta(hash);
        if (existing?.present === 1) continue; // Already indexed

        // Get blob size from vault
        const blob = await vault.getBlob(hash);
        if (!blob) continue;

        const sizeBytes = blob.length;
        await closetDB.upsertBlobMeta({
            hash,
            sizeBytes,
            lastAccess: nowMs,
            pinned: existing?.pinned ?? 0,
            present: 1
        });

        totalNewBytes += sizeBytes;
    }

    // Update total bytes
    if (totalNewBytes > 0) {
        const currentTotal = await closetDB.getTotalBytesPresent();
        await closetDB.setTotalBytesPresent(currentTotal + totalNewBytes);
    }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Run maintenance with default policy.
 */
export async function runMaintenance(
    sync: SyncResult,
    options?: {
        nowMs?: number;
        trustMode?: TrustMode;
        expectedManifestPubKeyHex?: string;
        activeHashes?: string[];
        forceGC?: boolean;
    }
): Promise<MaintenanceResult> {
    return onSyncComplete({
        sync,
        policy: getDefaultClosetPolicy(),
        nowMs: options?.nowMs ?? Date.now(),
        trustMode: options?.trustMode ?? 'unverified',
        expectedManifestPubKeyHex: options?.expectedManifestPubKeyHex,
        activeHashes: options?.activeHashes,
        forceGC: options?.forceGC
    });
}

/**
 * Force a GC run without new sync data.
 */
export async function forceGC(options?: {
    policy?: ClosetPolicy;
    nowMs?: number;
    trustMode?: TrustMode;
    expectedManifestPubKeyHex?: string;
    activeHashes?: string[];
}): Promise<MaintenanceResult> {
    return onSyncComplete({
        sync: { newArtifactHashes: [], newManifestHashes: [] },
        policy: options?.policy ?? getDefaultClosetPolicy(),
        nowMs: options?.nowMs ?? Date.now(),
        trustMode: options?.trustMode ?? 'unverified',
        expectedManifestPubKeyHex: options?.expectedManifestPubKeyHex,
        activeHashes: options?.activeHashes,
        forceGC: true
    });
}
