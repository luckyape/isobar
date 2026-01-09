/**
 * Weather Forecast CDN — Closet Blob Store
 *
 * Unified blob access abstraction. All blob reads in the app MUST go through
 * BlobStore.get(hash). Supports loose blobs now, pack-range compatible later.
 */

import { getClosetDB, type ClosetDB, type BlobMeta, type PackIndexEntry } from './db';
import { getVault, type Vault } from '../vault/store';
import { getBlobContentHash } from '@cdn/artifact';
import { withClosetLock } from './locks';
import { getCdnBaseUrl } from '../config';

// =============================================================================
// Types
// =============================================================================

export interface BlobStore {
    /** Get blob bytes (local if present, else remote). Always marks access. */
    get(hash: string): Promise<Uint8Array>;

    /** Check if blob is present locally. */
    hasLocal(hash: string): Promise<boolean>;

    /** Store blob locally with metadata. */
    putLocal(hash: string, blob: Uint8Array, sizeBytes: number): Promise<void>;

    /** Update lastAccess timestamp. */
    markAccess(hash: string, ts: number): Promise<void>;

    /** Delete blob from local storage. */
    deleteLocal(hash: string): Promise<void>;

    /** Get blob metadata. */
    getMeta(hash: string): Promise<BlobMeta | null>;
}

export interface BlobStoreConfig {
    cdnBaseUrl: string;
    packsBaseUrl?: string;
}

// =============================================================================
// Implementation
// =============================================================================

// Debounce threshold: don't update lastAccess if it was updated within this window
const ACCESS_DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes
// Flush interval for buffered access timestamps
const ACCESS_FLUSH_INTERVAL_MS = 15 * 1000; // 15 seconds

export class ClosetBlobStore implements BlobStore {
    private closetDB: ClosetDB;
    private vault: Vault;
    private config: BlobStoreConfig;

    // In-memory access buffer to prevent DB thrashing (blocker E)
    private accessBuffer: Map<string, number> = new Map();
    private accessFlushTimer: ReturnType<typeof setInterval> | null = null;
    private accessDebounceMs: number;

    // Guardrail 5: In-flight dedupe to prevent concurrent duplicate downloads
    private inflight: Map<string, Promise<Uint8Array>> = new Map();

    constructor(config?: Partial<BlobStoreConfig>) {
        this.closetDB = getClosetDB();
        this.vault = getVault();
        this.config = {
            cdnBaseUrl: config?.cdnBaseUrl ?? getCdnBaseUrl(),
            packsBaseUrl: config?.packsBaseUrl
        };
        this.accessDebounceMs = ACCESS_DEBOUNCE_MS;

        // Start periodic flush
        this.startFlushTimer();
    }

    /**
     * Start the periodic access buffer flush.
     */
    private startFlushTimer(): void {
        if (typeof setInterval !== 'undefined' && !this.accessFlushTimer) {
            this.accessFlushTimer = setInterval(() => this.flushAccessBuffer(), ACCESS_FLUSH_INTERVAL_MS);
        }
    }

    /**
     * Stop the periodic flush timer (for cleanup).
     */
    stopFlushTimer(): void {
        if (this.accessFlushTimer) {
            clearInterval(this.accessFlushTimer);
            this.accessFlushTimer = null;
        }
    }

    /**
     * Flush buffered access timestamps to IndexedDB.
     */
    async flushAccessBuffer(): Promise<void> {
        if (this.accessBuffer.size === 0) return;

        // Create a snapshot of entries to flush
        const entries = Array.from(this.accessBuffer.entries());
        this.accessBuffer.clear();

        // Protected flush using unified lock
        await withClosetLock('closet', async () => {
            await this.closetDB.open();

            for (const [hash, ts] of entries) {
                try {
                    const meta = await this.closetDB.getBlobMeta(hash);
                    if (meta) {
                        // Only update if timestamp is newer
                        if (ts > meta.lastAccess) {
                            meta.lastAccess = ts;
                            await this.closetDB.upsertBlobMeta(meta);
                        }
                    }
                } catch (err) {
                    console.warn(`[BlobStore] Failed to flush access for ${hash}:`, err);
                }
            }
        });
    }

    /**
     * Get blob bytes. Tries in order:
     * 1. Pack index → HTTP Range fetch
     * 2. Local vault storage
     * 3. Remote CDN fetch
     *
     * Guardrail 5: Dedupes concurrent requests for the same hash.
     * Always marks access on success.
     */
    async get(hash: string): Promise<Uint8Array> {
        hash = hash.toLowerCase();

        // Guardrail 5: Return existing in-flight request if any
        const existing = this.inflight.get(hash);
        if (existing) return existing;

        // Start fetch and track in-flight
        const promise = this.getInternal(hash).finally(() => {
            this.inflight.delete(hash);
        });
        this.inflight.set(hash, promise);
        return promise;
    }

    /**
     * Internal get implementation (actual fetch logic).
     */
    private async getInternal(hash: string): Promise<Uint8Array> {
        const nowMs = Date.now();

        // 1. Check pack index first (scaffolding for future packs)
        const packEntry = await this.closetDB.getPackEntry(hash);
        if (packEntry) {
            const blob = await this.fetchFromPack(hash, packEntry);
            await this.markAccess(hash, nowMs);
            return blob;
        }

        // 2. Check local vault
        const localBlob = await this.vault.getBlob(hash);
        if (localBlob) {
            await this.markAccess(hash, nowMs);
            return localBlob;
        }

        // 3. Fetch from remote CDN
        const remoteBlob = await this.fetchLoose(hash);

        // Store locally and update metadata
        await this.putLocal(hash, remoteBlob, remoteBlob.length);
        await this.markAccess(hash, nowMs);

        return remoteBlob;
    }

    async hasLocal(hash: string): Promise<boolean> {
        const meta = await this.closetDB.getBlobMeta(hash);
        if (meta?.present === 1) return true;

        // Also check vault directly (for blobs not yet in closet index)
        return this.vault.has(hash);
    }

    async putLocal(hash: string, blob: Uint8Array, sizeBytes: number): Promise<void> {
        // Verify integrity before storing
        const actualHash = getBlobContentHash(blob);
        if (actualHash !== hash.toLowerCase()) {
            throw new Error(`BlobStore: integrity check failed - expected ${hash}, got ${actualHash}`);
        }

        // Store in vault
        await this.vault.put(hash, blob);

        // Update closet metadata
        const existing = await this.closetDB.getBlobMeta(hash);
        const meta: BlobMeta = {
            hash,
            sizeBytes,
            lastAccess: Date.now(),
            pinned: existing?.pinned ?? 0,
            present: 1
        };
        await this.closetDB.upsertBlobMeta(meta);

        // Update total bytes
        if (!existing?.present) {
            const totalBytes = await this.closetDB.getTotalBytesPresent();
            await this.closetDB.setTotalBytesPresent(totalBytes + sizeBytes);
        }
    }

    /**
     * Mark blob as accessed. Uses debouncing to prevent DB thrashing.
     *
     * - Buffers access timestamps in memory
     * - Skips write if blob was accessed within debounce window
     * - Periodic flush writes buffered timestamps to DB
     */
    async markAccess(hash: string, ts: number): Promise<void> {
        // Check if we need to skip (accessed recently)
        const meta = await this.closetDB.getBlobMeta(hash);
        if (meta) {
            const timeSinceLastAccess = ts - meta.lastAccess;
            if (timeSinceLastAccess < this.accessDebounceMs) {
                // Skip - accessed too recently
                return;
            }
        }

        // Buffer the access for periodic flush
        this.accessBuffer.set(hash, ts);
    }

    /**
     * Force flush and mark access immediately (for critical paths).
     */
    async markAccessImmediate(hash: string, ts: number): Promise<void> {
        const meta = await this.closetDB.getBlobMeta(hash);
        if (meta) {
            meta.lastAccess = ts;
            await this.closetDB.upsertBlobMeta(meta);
        }
    }

    async deleteLocal(hash: string): Promise<void> {
        const meta = await this.closetDB.getBlobMeta(hash);

        // Delete from vault (need to access private method via cast for now)
        // The vault doesn't expose deleteBlob publicly, so we update metadata only
        // and mark as not present. Actual blob deletion would need vault API extension.

        if (meta) {
            const wasPresent = meta.present === 1;
            meta.present = 0;
            await this.closetDB.upsertBlobMeta(meta);

            if (wasPresent) {
                const totalBytes = await this.closetDB.getTotalBytesPresent();
                await this.closetDB.setTotalBytesPresent(Math.max(0, totalBytes - meta.sizeBytes));
            }
        }

        // For true deletion, we'd need: await (this.vault as any).deleteBlob(hash);
        // Since vault.deleteBlob is private, we'll need to extend the Vault API
        // or use the closetDB as the source of truth for "present" status.
    }

    async getMeta(hash: string): Promise<BlobMeta | null> {
        return this.closetDB.getBlobMeta(hash);
    }

    // =========================================================================
    // Pack Fetch (Scaffolding)
    // =========================================================================

    /**
     * Fetch blob from a pack file using HTTP Range request.
     * STRICT: Requires 206 Partial Content + Content-Range validation.
     */
    private async fetchFromPack(hash: string, pack: PackIndexEntry): Promise<Uint8Array> {
        const baseUrl = this.config.packsBaseUrl ?? this.config.cdnBaseUrl;
        const url = `${baseUrl}/packs/${pack.packId}`;
        const expectedStart = pack.off;
        const expectedEnd = pack.off + pack.len - 1;

        const response = await fetch(url, {
            headers: {
                'Range': `bytes=${expectedStart}-${expectedEnd}`
            }
        });

        // STRICT: Must be 206 Partial Content
        if (response.status !== 206) {
            throw new Error(
                `BlobStore: pack fetch failed - expected 206 Partial Content, got ${response.status}. ` +
                `Server may not support Range requests.`
            );
        }

        // Guardrail 4: Validate Content-Range header
        const contentRange = response.headers.get('Content-Range');
        if (!contentRange) {
            throw new Error('BlobStore: pack fetch missing Content-Range header');
        }

        const rangeMatch = contentRange.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/);
        if (!rangeMatch) {
            throw new Error(`BlobStore: pack fetch invalid Content-Range: ${contentRange}`);
        }

        const rangeStart = Number(rangeMatch[1]);
        const rangeEnd = Number(rangeMatch[2]);
        if (rangeStart !== expectedStart || rangeEnd !== expectedEnd) {
            throw new Error(
                `BlobStore: pack fetch Content-Range mismatch - ` +
                `got ${rangeStart}-${rangeEnd}, expected ${expectedStart}-${expectedEnd}`
            );
        }

        const blob = new Uint8Array(await response.arrayBuffer());

        // Verify size matches expected
        if (blob.length !== pack.len) {
            throw new Error(
                `BlobStore: pack fetch size mismatch - expected ${pack.len} bytes, got ${blob.length}`
            );
        }

        // Verify hash
        const actualHash = getBlobContentHash(blob);
        if (actualHash !== hash.toLowerCase()) {
            throw new Error(
                `BlobStore: pack fetch integrity check failed - expected ${hash}, got ${actualHash}`
            );
        }

        return blob;
    }

    // =========================================================================
    // Loose Blob Fetch
    // =========================================================================

    /**
     * Fetch a loose blob from the CDN.
     * Hard fails on missing or invalid blobs.
     */
    private async fetchLoose(hash: string): Promise<Uint8Array> {
        const url = `${this.config.cdnBaseUrl}/chunks/${hash}`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(
                `BlobStore: loose fetch failed - ${response.status} for hash ${hash}`
            );
        }

        const blob = new Uint8Array(await response.arrayBuffer());

        // Verify hash
        const actualHash = getBlobContentHash(blob);
        if (actualHash !== hash.toLowerCase()) {
            throw new Error(
                `BlobStore: loose fetch integrity check failed - expected ${hash}, got ${actualHash}`
            );
        }

        return blob;
    }
}

// =============================================================================
// Singleton
// =============================================================================

let blobStoreInstance: ClosetBlobStore | null = null;

export function getBlobStore(config?: Partial<BlobStoreConfig>): BlobStore {
    if (!blobStoreInstance) {
        blobStoreInstance = new ClosetBlobStore(config);
    }
    return blobStoreInstance;
}

/**
 * Create a new blob store instance (for testing).
 */
export function createBlobStore(config?: Partial<BlobStoreConfig>): BlobStore {
    return new ClosetBlobStore(config);
}
