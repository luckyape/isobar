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

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_CDN_URL = 'https://weather-cdn.example.com';
const DEFAULT_SYNC_DAYS = 7;
const DEFAULT_CONCURRENCY = 4;
const SYNC_STATE_KEY = 'sync-state';

export interface SyncConfig {
    cdnUrl: string;
    syncDays: number;
    concurrency: number;
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
    private abortController: AbortController | null = null;

    constructor(config?: Partial<SyncConfig>) {
        this.vault = getVault();
        this.config = {
            cdnUrl: config?.cdnUrl ?? DEFAULT_CDN_URL,
            syncDays: config?.syncDays ?? DEFAULT_SYNC_DAYS,
            concurrency: config?.concurrency ?? DEFAULT_CONCURRENCY
        };
    }

    /**
     * Run a full sync cycle.
     */
    async sync(onProgress?: SyncProgressCallback): Promise<SyncState> {
        await this.vault.open();
        this.abortController = new AbortController();

        const state: SyncState = {
            blobsDownloaded: 0,
            bytesDownloaded: 0
        };

        try {
            // 1. Fetch root.json to get latest manifest date
            const root = await this.fetchJson<{ latest: string }>('manifests/root.json');
            const latestDate = root.latest;
            state.lastSyncedDate = latestDate;

            // 2. Get dates to sync
            const dates = getLastNDays(this.config.syncDays, latestDate);

            // 3. Fetch and process manifests
            const manifests: DailyManifest[] = [];
            const manifestProgress: SyncProgress = {
                phase: 'manifests',
                total: dates.length,
                downloaded: 0,
                skipped: 0,
                failed: 0
            };

            for (const date of dates) {
                if (this.abortController.signal.aborted) break;

                try {
                    const dateManifests = await this.fetchManifestsForDate(date);
                    manifests.push(...dateManifests);
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
                    const type = wantSet.get(hash) ?? 'unknown';
                    const blob = await this.fetchAndVerify(`chunks/${hash}`, hash);
                    await this.vault.put(hash, blob);
                    state.blobsDownloaded++;
                    state.bytesDownloaded += blob.length;
                    chunkProgress.downloaded++;

                    // console.debug(`[sync] Downloaded ${type} ${hash.slice(0, 8)}`);
                    onProgress?.(chunkProgress);
                },
                (hash, error) => {
                    console.warn(`Failed to download ${hash}:`, error);
                    chunkProgress.failed++;
                    onProgress?.(chunkProgress);
                }
            );

            // 6. Update sync state
            state.lastSyncedAt = Date.now();
            await this.vault.setMeta(SYNC_STATE_KEY, state);

            onProgress?.({ phase: 'complete', total: 0, downloaded: 0, skipped: 0, failed: 0 });

            return state;
        } finally {
            this.abortController = null;
        }
    }

    /**
     * Abort an in-progress sync.
     */
    abort(): void {
        this.abortController?.abort();
    }

    /**
     * Get the last sync state.
     */
    async getState(): Promise<SyncState | null> {
        await this.vault.open();
        return this.vault.getMeta(SYNC_STATE_KEY);
    }

    // ===========================================================================
    // Private Methods
    // ===========================================================================

    /**
     * Fetch manifests for a specific date.
     */
    private async fetchManifestsForDate(date: string): Promise<DailyManifest[]> {
        // List manifests for the date
        // In a real CDN, this might be a directory listing or a known pattern
        // For MVP, we assume a single manifest per date with a predictable name
        const listUrl = `${this.config.cdnUrl}/manifests/${date}/`;

        try {
            // Try to list directory (S3-style XML or JSON listing)
            const response = await fetch(listUrl, { signal: this.abortController?.signal });

            if (!response.ok) {
                // Fallback: try to fetch a known manifest pattern
                return [];
            }

            // Parse listing and fetch individual manifests
            // This is CDN-specific; for R2/S3, parse XML or use list API
            const manifests: DailyManifest[] = [];
            // ... implementation depends on CDN listing format

            return manifests;
        } catch (error) {
            console.warn(`Failed to list manifests for ${date}:`, error);
            return [];
        }
    }

    /**
     * Fetch and verify a blob by hash.
     */
    private async fetchAndVerify(path: string, expectedHash: string): Promise<Uint8Array> {
        const url = `${this.config.cdnUrl}/${path}`;
        const response = await fetch(url, { signal: this.abortController?.signal });

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
    private async fetchJson<T>(path: string): Promise<T> {
        const url = `${this.config.cdnUrl}/${path}`;
        const response = await fetch(url, { signal: this.abortController?.signal });

        if (!response.ok) {
            throw new Error(`Fetch failed: ${response.status}`);
        }

        return response.json();
    }

    /**
     * Download items in parallel with concurrency limit.
     */
    private async parallelDownload(
        items: string[],
        download: (item: string) => Promise<void>,
        onError: (item: string, error: unknown) => void
    ): Promise<void> {
        const queue = [...items];
        const inFlight = new Set<Promise<void>>();

        while (queue.length > 0 || inFlight.size > 0) {
            // Start new downloads up to concurrency limit
            while (queue.length > 0 && inFlight.size < this.config.concurrency) {
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
            if (this.abortController?.signal.aborted) {
                break;
            }
        }
    }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let syncEngineInstance: SyncEngine | null = null;

export function getSyncEngine(config?: Partial<SyncConfig>): SyncEngine {
    if (!syncEngineInstance) {
        syncEngineInstance = new SyncEngine(config);
    }
    return syncEngineInstance;
}
