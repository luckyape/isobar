/**
 * Weather Forecast CDN — Client Sync Engine
 *
 * Stateless sync protocol for downloading artifacts from the CDN.
 * No server-side user state: client tracks its own sync cursor.
 */

import { getVault, type Vault } from './store';
import { getBlobContentHash } from '@cdn/artifact';
import { unpackageManifest, getLastNDays } from '@cdn/manifest';
import type { DailyManifest, ManifestEntry } from '@cdn/types';
import { computeLocationScopeId, type LocationScopeInput } from '@cdn/location';
import { onSyncComplete, getDefaultClosetPolicy, type MaintenanceResult, getClosetDB, withClosetLock } from '../closet';
import { getCdnBaseUrl, getManifestPubKeyHex } from '../config';

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_SYNC_DAYS = 7;
const DEFAULT_CONCURRENCY = 4;
const SYNC_STATE_KEY = 'sync-state';
const MANIFEST_INDEX_KEY = 'manifest-index';

export interface SyncConfig {
    cdnUrl: string;
    syncDays: number;
    concurrency: number;
    /** Optional location scoping for manifests/root pointers. */
    location?: LocationScopeInput;
    /** Optional precomputed location scope id (64-hex). */
    locationScopeId?: string;
    /**
     * Optional manifest signing key pin.
     * - `undefined`: use default app config (`getManifestPubKeyHex()`).
     * - `null`: disable signature verification (useful for tests/dev against unsigned or differently-signed CDNs).
     * - `string`: require manifests be signed by this key.
     */
    expectedManifestPubKeyHex?: string | null;
}

export interface SyncState {
    lastSyncedDate?: string;
    lastSyncedAt?: number;
    blobsDownloaded: number;
    bytesDownloaded: number;
}

export interface SyncProgress {
    phase: 'manifests' | 'chunks' | 'complete';
    total: number;
    downloaded: number;
    skipped: number;
    failed: number;
}

export type SyncProgressCallback = (progress: SyncProgress) => void;

// =============================================================================
// Sync Engine
// =============================================================================

export class SyncEngine {
    private vault: Vault;
    private config: SyncConfig;
    private scopeId?: string;

    constructor(config?: Partial<SyncConfig>) {
        this.vault = getVault();
        this.scopeId =
            config?.locationScopeId ??
            (config?.location ? computeLocationScopeId(config.location) : undefined);
        this.config = {
            cdnUrl: config?.cdnUrl ?? getCdnBaseUrl(),
            syncDays: config?.syncDays ?? DEFAULT_SYNC_DAYS,
            concurrency: config?.concurrency ?? DEFAULT_CONCURRENCY,
            location: config?.location,
            locationScopeId: this.scopeId,
            expectedManifestPubKeyHex: config?.expectedManifestPubKeyHex
        };
    }

    private metaKey(base: string): string {
        return this.scopeId ? `${base}:${this.scopeId}` : base;
    }

    private scopedPath(path: string): string {
        if (!this.scopeId) return path;
        // Chunks are global/content-addressed; only manifests are location-scoped.
        if (path.startsWith('chunks/')) return path;
        return `locations/${this.scopeId}/${path}`;
    }

    /**
     * Run a full sync cycle.
     */
    async sync(onProgress?: SyncProgressCallback, options?: { syncDays?: number; signal?: AbortSignal }): Promise<SyncState> {
        await this.vault.open();
        const signal = options?.signal;

        const pinnedManifestPubKeyHex =
            this.config.expectedManifestPubKeyHex === null
                ? undefined
                : (this.config.expectedManifestPubKeyHex ?? getManifestPubKeyHex());

        const cdnUrl = this.config.cdnUrl;
        console.log(`[SyncEngine] Starting sync from ${cdnUrl}`);

        const state: SyncState = {
            blobsDownloaded: 0,
            bytesDownloaded: 0
        };

        try {
            // 1. Fetch root.json to get latest manifest date
            let root: { latest?: string } | null = null;
            try {
                root = await this.fetchJson<{ latest?: string }>(this.scopedPath('manifests/root.json'), signal);
            } catch (err) {
                const status = (err as any)?.status;
                if (status === 404 && this.scopeId) {
                    // Location scope may not exist yet; treat as empty sync.
                    onProgress?.({ phase: 'complete', total: 0, downloaded: 0, skipped: 0, failed: 0 });
                    state.lastSyncedAt = Date.now();
                    await this.vault.setMeta(this.metaKey(SYNC_STATE_KEY), state);
                    return state;
                }
                throw err;
            }

            const latestDate = root.latest;
            if (!latestDate) {
                onProgress?.({ phase: 'complete', total: 0, downloaded: 0, skipped: 0, failed: 0 });
                state.lastSyncedAt = Date.now();
                await this.vault.setMeta(this.metaKey(SYNC_STATE_KEY), state);
                return state;
            }
            state.lastSyncedDate = latestDate;

            // 2. Get dates to sync
            const syncDays = options?.syncDays ?? this.config.syncDays;
            const dates = getLastNDays(syncDays, latestDate);

            // 3. Fetch and process manifests
            const manifests: DailyManifest[] = [];
            const manifestProgress: SyncProgress = {
                phase: 'manifests',
                total: dates.length,
                downloaded: 0,
                skipped: 0,
                failed: 0
            };

            const manifestIndex: Record<string, string[]> =
                await this.vault.getMeta(this.metaKey(MANIFEST_INDEX_KEY)) ?? {};

            for (const date of dates) {
                if (signal?.aborted) throw new Error('Aborted');

                try {
                    const dateResults = await this.fetchManifestsForDate(date, pinnedManifestPubKeyHex, signal);
                    manifests.push(...dateResults.map((r) => r.data));

                    // Index manifest hashes
                    manifestIndex[date] = dateResults.map((r) => r.hash);

                    manifestProgress.downloaded++;
                } catch (error) {
                    console.warn(`Failed to fetch manifests for ${date}:`, error);
                    manifestProgress.failed++;
                }

                onProgress?.(manifestProgress);
            }

            // 4. Build want-set of chunk hashes, tracking types for logging
            const wantSet = new Map<string, string>(); // hash -> type
            for (const manifest of manifests) {
                for (const entry of manifest.artifacts) {
                    const exists = await this.vault.has(entry.hash);
                    if (!exists) {
                        wantSet.set(entry.hash, entry.type);
                    }
                }
            }

            // 5. Download missing chunks
            const chunks = Array.from(wantSet.keys());
            const chunkProgress: SyncProgress = {
                phase: 'chunks',
                total: chunks.length,
                downloaded: 0,
                skipped: 0,
                failed: 0
            };

            onProgress?.(chunkProgress);

            await this.parallelDownload(
                chunks,
                async (hash) => {
                    const closetDB = getClosetDB();
                    const type = wantSet.get(hash) ?? 'unknown';

                    // Phase 1 (locked): Mark as in-flight
                    await withClosetLock('closet', async () => {
                        await closetDB.setInflight(hash);
                    });

                    try {
                        // Phase 2 (unlocked): Fetch bytes (slow network op)
                        const blob = await this.fetchAndVerify(`chunks/${hash}`, hash, signal);

                        // Phase 3 (locked): Commit to vault and clear in-flight
                        await withClosetLock('closet', async () => {
                            await this.vault.put(hash, blob);
                            state.blobsDownloaded++;
                            state.bytesDownloaded += blob.length;
                            chunkProgress.downloaded++;

                            // Clear in-flight AFTER successful commit
                            await closetDB.clearInflight(hash);
                        });
                    } catch (err) {
                        // Clear in-flight on failure too (protected)
                        await withClosetLock('closet', async () => {
                            await closetDB.clearInflight(hash);
                        });
                        throw err;
                    }

                    // console.debug(`[sync] Downloaded ${type} ${hash.slice(0, 8)}`);
                    onProgress?.(chunkProgress);
                },
                (hash, error) => {
                    console.warn(`Failed to download ${hash}:`, error);
                    chunkProgress.failed++;
                    onProgress?.(chunkProgress);
                },
                signal
            );

            // 6. Update sync state
            state.lastSyncedAt = Date.now();
            await this.vault.setMeta(this.metaKey(SYNC_STATE_KEY), state);
            await this.vault.setMeta(this.metaKey(MANIFEST_INDEX_KEY), manifestIndex);

            // 7. Run closet maintenance (GC, indexing)
            const manifestHashes = Object.values(manifestIndex).flat();
            try {
                await onSyncComplete({
                    sync: {
                        newArtifactHashes: chunks,
                        newManifestHashes: manifestHashes
                    },
                    policy: getDefaultClosetPolicy(),
                    nowMs: Date.now(),
                    trustMode: 'unverified' // TODO: make configurable for trusted mode
                });
            } catch (err) {
                console.warn('[sync] Closet maintenance failed:', err);
            }

            onProgress?.({ phase: 'complete', total: 0, downloaded: 0, skipped: 0, failed: 0 });

            console.log(`[SyncEngine] Sync success. Downloaded: ${state.blobsDownloaded} blobs, ${state.bytesDownloaded} bytes.`);
            return state;
        } catch (error) {
            console.error(`[SyncEngine] Sync failed from ${this.config.cdnUrl}:`, error);
            throw error;
        }
    }

    /**
     * Get the last sync state.
     */
    async getState(): Promise<SyncState | null> {
        await this.vault.open();
        return this.vault.getMeta(this.metaKey(SYNC_STATE_KEY));
    }

    // ===========================================================================
    // Private Methods
    // ===========================================================================

    /**
     * Fetch manifests for a specific date.
     * @param pinnedManifestPubKeyHex - If provided, manifests MUST be signed by this key.
     */
    private async fetchManifestsForDate(
        date: string,
        pinnedManifestPubKeyHex?: string,
        signal?: AbortSignal
    ): Promise<Array<{ hash: string; data: DailyManifest }>> {
        // List manifests for the date
        const listUrl = `${this.config.cdnUrl}/${this.scopedPath(`manifests/${date}/`)}`;

        try {
            // Fetch the list of manifest hashes
            const response = await fetch(listUrl, { signal });

            if (!response.ok) {
                return [];
            }

            const hashes: string[] = await response.json();
            const results: Array<{ hash: string; data: DailyManifest }> = [];

            // Fetch each manifest
            for (const hash of hashes) {
                if (signal?.aborted) throw new Error('Aborted');
                try {
                    const manifestBlob = await this.fetchAndVerify(`manifests/${date}/${hash}`, hash, signal);
                    // Verify signature if pinned key is configured
                    const manifest = await unpackageManifest(manifestBlob, pinnedManifestPubKeyHex);
                    results.push({ hash, data: manifest });

                    // Also store the manifest blob in the vault itself
                    await this.vault.put(hash, manifestBlob);
                } catch (error) {
                    console.warn(`Failed to unpackage/verify manifest ${hash} for ${date}:`, error);
                }
            }

            return results;
        } catch (error) {
            console.warn(`Failed to list manifests for ${date}:`, error);
            return [];
        }
    }

    /**
     * Fetch and verify a blob by hash.
     */
    private async fetchAndVerify(path: string, expectedHash: string, signal?: AbortSignal): Promise<Uint8Array> {
        const url = `${this.config.cdnUrl}/${this.scopedPath(path)}`;
        const response = await fetch(url, { signal });

        if (!response.ok) {
            throw new Error(`Fetch failed: ${response.status}`);
        }

        const blob = new Uint8Array(await response.arrayBuffer());
        const actualHash = getBlobContentHash(blob);

        if (actualHash !== expectedHash.toLowerCase()) {
            throw new Error(`Integrity check failed: expected ${expectedHash}, got ${actualHash}`);
        }

        return blob;
    }

    /**
     * Fetch JSON from CDN.
     */
    private async fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
        const url = `${this.config.cdnUrl}/${path}`;
        const response = await fetch(url, { signal });

        if (!response.ok) {
            const error = new Error(`Fetch failed: ${response.status}`);
            (error as any).status = response.status;
            throw error;
        }

        return response.json();
    }

    /**
     * Download items in parallel with concurrency limit.
     */
    private async parallelDownload(
        items: string[],
        download: (item: string) => Promise<void>,
        onError: (item: string, error: unknown) => void,
        signal?: AbortSignal
    ): Promise<void> {
        const queue = [...items];
        const inFlight = new Set<Promise<void>>();

        while (queue.length > 0 || inFlight.size > 0) {
            // Start new downloads up to concurrency limit
            while (queue.length > 0 && inFlight.size < this.config.concurrency) {
                if (signal?.aborted) break;
                const item = queue.shift()!;
                const promise = download(item)
                    .catch((error) => onError(item, error))
                    .finally(() => inFlight.delete(promise));
                inFlight.add(promise);
            }

            // Wait for at least one to complete
            if (inFlight.size > 0) {
                await Promise.race(inFlight);
            }

            // Check for abort
            if (signal?.aborted) {
                throw new Error('Aborted');
            }
        }
    }
}

// =============================================================================
// Singleton Instance
// =============================================================================

const syncEnginesByScope = new Map<string, SyncEngine>();

export function getSyncEngine(config?: Partial<SyncConfig>): SyncEngine {
    const scopeId =
        config?.locationScopeId ??
        (config?.location ? computeLocationScopeId(config.location) : undefined);
    const key = scopeId ?? 'global';

    const existing = syncEnginesByScope.get(key);
    if (existing) return existing;

    const engine = new SyncEngine({ ...config, locationScopeId: scopeId });
    syncEnginesByScope.set(key, engine);
    return engine;
}
