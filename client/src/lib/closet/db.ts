/**
 * Weather Forecast CDN — Closet Database (IndexedDB)
 *
 * Thin wrapper around IndexedDB for the closet's metadata stores.
 * No external dependencies - pure browser APIs.
 */

// =============================================================================
// Types
// =============================================================================

export interface BlobMeta {
    hash: string;
    sizeBytes: number;
    lastAccess: number;  // epoch ms
    pinned: 0 | 1;
    present: 0 | 1;
}

export interface ManifestRef {
    key: string;      // ${date}|${kind}|${shard}
    date: string;
    kind: string;     // "daily" or "shard" or "checkpoint"
    shard: string;    // "" for unsharded
    hash: string;
}

export interface ObservationIndexEntry {
    key: string;      // ${source}|${observedAtBucket}|${bucketMinutes}|${stationSetId}
    source: string;
    observedAtBucket: string;
    bucketMinutes: number;
    stationSetId: string;
    hash: string;
}

export interface ForecastIndexEntry {
    key: string;      // ${model}|${runTime}|${gridKey}
    model: string;
    runTime: string;
    gridKey: string;
    hash: string;
}

export interface PackIndexEntry {
    hash: string;
    packId: string;
    off: number;
    len: number;
}

export interface MetaEntry {
    k: string;
    v: unknown;
}

export interface VerificationReceipt {
    manifestHash: string;
    pubKeyHex: string;
    verifiedAt: number;
}

/**
 * Entry for tracking in-flight blob downloads.
 * Used to prevent reclaim from deleting blobs mid-sync.
 */
export interface InflightEntry {
    hash: string;        // lowercased hash
    startedAtMs: number; // when download started
}

// =============================================================================
// Constants
// =============================================================================

const DB_NAME = 'weather-closet-v2';
const DB_VERSION = 2; // Bumped for inflight store

const STORE_BLOBS = 'blobs';
const STORE_MANIFESTS = 'manifests';
const STORE_OBS_INDEX = 'obsIndex';
const STORE_FORECAST_INDEX = 'forecastIndex';
const STORE_PACK_INDEX = 'pack_index';
const STORE_META = 'meta';
const STORE_INFLIGHT = 'inflight';

// Meta keys
export const META_TOTAL_BYTES_PRESENT = 'totalBytesPresent';
export const META_LAST_GC_AT = 'lastGcAt';

// =============================================================================
// ClosetDB Class
// =============================================================================

export class ClosetDB {
    private db: IDBDatabase | null = null;
    private opening: Promise<IDBDatabase> | null = null;
    private dbName: string;

    constructor(dbName: string = DB_NAME) {
        this.dbName = dbName;
    }

    // =========================================================================
    // Database Lifecycle
    // =========================================================================

    async open(): Promise<void> {
        if (this.db) return;
        if (this.opening) {
            await this.opening;
            return;
        }

        this.opening = new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(request.result);
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                this.createSchema(db);
            };
        });

        await this.opening;
        this.opening = null;
    }

    private createSchema(db: IDBDatabase): void {
        // 1. blobs store
        if (!db.objectStoreNames.contains(STORE_BLOBS)) {
            const blobStore = db.createObjectStore(STORE_BLOBS, { keyPath: 'hash' });
            // Compound index for deterministic deletion order
            blobStore.createIndex('byLastAccessHash', ['lastAccess', 'hash'], { unique: false });
            blobStore.createIndex('byPresent', 'present', { unique: false });
            blobStore.createIndex('byPinned', 'pinned', { unique: false });
        }

        // 2. manifests store
        if (!db.objectStoreNames.contains(STORE_MANIFESTS)) {
            const manifestStore = db.createObjectStore(STORE_MANIFESTS, { keyPath: 'key' });
            manifestStore.createIndex('byDate', 'date', { unique: false });
        }

        // 3. obsIndex store
        if (!db.objectStoreNames.contains(STORE_OBS_INDEX)) {
            const obsStore = db.createObjectStore(STORE_OBS_INDEX, { keyPath: 'key' });
            obsStore.createIndex('byBucket', ['source', 'observedAtBucket'], { unique: false });
        }

        // 4. forecastIndex store
        if (!db.objectStoreNames.contains(STORE_FORECAST_INDEX)) {
            const forecastStore = db.createObjectStore(STORE_FORECAST_INDEX, { keyPath: 'key' });
            forecastStore.createIndex('byModelRunTime', ['model', 'runTime'], { unique: false });
            forecastStore.createIndex('byGridKeyRunTime', ['gridKey', 'runTime'], { unique: false });
        }

        // 5. pack_index store
        if (!db.objectStoreNames.contains(STORE_PACK_INDEX)) {
            db.createObjectStore(STORE_PACK_INDEX, { keyPath: 'hash' });
        }

        // 6. meta store
        if (!db.objectStoreNames.contains(STORE_META)) {
            db.createObjectStore(STORE_META, { keyPath: 'k' });
        }

        // 7. inflight store (v2)
        if (!db.objectStoreNames.contains(STORE_INFLIGHT)) {
            db.createObjectStore(STORE_INFLIGHT, { keyPath: 'hash' });
        }
    }

    close(): void {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }

    // =========================================================================
    // Blob Metadata Operations
    // =========================================================================

    async getBlobMeta(hash: string): Promise<BlobMeta | null> {
        await this.open();
        return this.promisifyRequest(
            this.db!
                .transaction(STORE_BLOBS, 'readonly')
                .objectStore(STORE_BLOBS)
                .get(hash)
        );
    }

    async upsertBlobMeta(meta: BlobMeta): Promise<void> {
        await this.open();
        await this.promisifyRequest(
            this.db!
                .transaction(STORE_BLOBS, 'readwrite')
                .objectStore(STORE_BLOBS)
                .put(meta)
        );
    }

    async setPinned(hash: string, pinned: 0 | 1): Promise<void> {
        await this.open();
        const tx = this.db!.transaction(STORE_BLOBS, 'readwrite');
        const store = tx.objectStore(STORE_BLOBS);
        const existing = await this.promisifyRequest<BlobMeta | undefined>(store.get(hash));
        if (existing) {
            existing.pinned = pinned;
            await this.promisifyRequest(store.put(existing));
        }
    }

    async deleteBlobMeta(hash: string): Promise<void> {
        await this.open();
        await this.promisifyRequest(
            this.db!
                .transaction(STORE_BLOBS, 'readwrite')
                .objectStore(STORE_BLOBS)
                .delete(hash)
        );
    }

    /**
     * List present blobs sorted for deterministic deletion (lastAccess ASC, hash ASC).
     * Uses the byLastAccessHash compound index.
     */
    async listPresentBlobsSortedForDeletion(): Promise<BlobMeta[]> {
        await this.open();
        const results: BlobMeta[] = [];

        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(STORE_BLOBS, 'readonly');
            const store = tx.objectStore(STORE_BLOBS);
            const index = store.index('byLastAccessHash');
            const request = index.openCursor();

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    const blob = cursor.value as BlobMeta;
                    if (blob.present === 1) {
                        results.push(blob);
                    }
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
        });
    }

    async getAllBlobMetas(): Promise<BlobMeta[]> {
        await this.open();
        return this.promisifyRequest<BlobMeta[]>(
            this.db!
                .transaction(STORE_BLOBS, 'readonly')
                .objectStore(STORE_BLOBS)
                .getAll()
        ) ?? [];
    }

    // =========================================================================
    // Manifest Operations
    // =========================================================================

    async upsertManifestRef(date: string, kind: string, shard: string, hash: string): Promise<void> {
        await this.open();
        const key = `${date}|${kind}|${shard}`;
        const ref: ManifestRef = { key, date, kind, shard, hash };
        await this.promisifyRequest(
            this.db!
                .transaction(STORE_MANIFESTS, 'readwrite')
                .objectStore(STORE_MANIFESTS)
                .put(ref)
        );
    }

    async getManifestHashesForDateRange(dates: string[]): Promise<string[]> {
        await this.open();
        const hashes: string[] = [];
        const dateSet = new Set(dates);

        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(STORE_MANIFESTS, 'readonly');
            const store = tx.objectStore(STORE_MANIFESTS);
            const index = store.index('byDate');
            const request = index.openCursor();

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    const ref = cursor.value as ManifestRef;
                    if (dateSet.has(ref.date)) {
                        hashes.push(ref.hash);
                    }
                    cursor.continue();
                } else {
                    resolve(hashes);
                }
            };
        });
    }

    async getAllManifestRefs(): Promise<ManifestRef[]> {
        await this.open();
        return this.promisifyRequest<ManifestRef[]>(
            this.db!
                .transaction(STORE_MANIFESTS, 'readonly')
                .objectStore(STORE_MANIFESTS)
                .getAll()
        ) ?? [];
    }

    // =========================================================================
    // Observation Index Operations
    // =========================================================================

    async upsertObservationIndex(entry: ObservationIndexEntry): Promise<void> {
        await this.open();
        await this.promisifyRequest(
            this.db!
                .transaction(STORE_OBS_INDEX, 'readwrite')
                .objectStore(STORE_OBS_INDEX)
                .put(entry)
        );
    }

    async getObservationsByBucket(source: string, observedAtBucket: string): Promise<ObservationIndexEntry[]> {
        await this.open();
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(STORE_OBS_INDEX, 'readonly');
            const index = tx.objectStore(STORE_OBS_INDEX).index('byBucket');
            const request = index.getAll(IDBKeyRange.only([source, observedAtBucket]));

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result ?? []);
        });
    }

    async getAllObservationIndexEntries(): Promise<ObservationIndexEntry[]> {
        await this.open();
        return this.promisifyRequest<ObservationIndexEntry[]>(
            this.db!
                .transaction(STORE_OBS_INDEX, 'readonly')
                .objectStore(STORE_OBS_INDEX)
                .getAll()
        ) ?? [];
    }

    // =========================================================================
    // Forecast Index Operations
    // =========================================================================

    async upsertForecastIndex(entry: ForecastIndexEntry): Promise<void> {
        await this.open();
        await this.promisifyRequest(
            this.db!
                .transaction(STORE_FORECAST_INDEX, 'readwrite')
                .objectStore(STORE_FORECAST_INDEX)
                .put(entry)
        );
    }

    async getForecastsByModelRunTime(model: string, runTime: string): Promise<ForecastIndexEntry[]> {
        await this.open();
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(STORE_FORECAST_INDEX, 'readonly');
            const index = tx.objectStore(STORE_FORECAST_INDEX).index('byModelRunTime');
            const request = index.getAll(IDBKeyRange.only([model, runTime]));

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result ?? []);
        });
    }

    async getAllForecastIndexEntries(): Promise<ForecastIndexEntry[]> {
        await this.open();
        return this.promisifyRequest<ForecastIndexEntry[]>(
            this.db!
                .transaction(STORE_FORECAST_INDEX, 'readonly')
                .objectStore(STORE_FORECAST_INDEX)
                .getAll()
        ) ?? [];
    }

    async getForecastsByGridKey(gridKey: string): Promise<ForecastIndexEntry[]> {
        await this.open();
        const results: ForecastIndexEntry[] = [];

        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(STORE_FORECAST_INDEX, 'readonly');
            const index = tx.objectStore(STORE_FORECAST_INDEX).index('byGridKeyRunTime');
            const request = index.openCursor();

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    const entry = cursor.value as ForecastIndexEntry;
                    if (entry.gridKey === gridKey) {
                        results.push(entry);
                    }
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
        });
    }

    // =========================================================================
    // Pack Index Operations (Scaffolding)
    // =========================================================================

    async getPackEntry(hash: string): Promise<PackIndexEntry | null> {
        await this.open();
        return this.promisifyRequest(
            this.db!
                .transaction(STORE_PACK_INDEX, 'readonly')
                .objectStore(STORE_PACK_INDEX)
                .get(hash)
        );
    }

    async upsertPackEntry(entry: PackIndexEntry): Promise<void> {
        await this.open();
        await this.promisifyRequest(
            this.db!
                .transaction(STORE_PACK_INDEX, 'readwrite')
                .objectStore(STORE_PACK_INDEX)
                .put(entry)
        );
    }

    // =========================================================================
    // Meta Operations
    // =========================================================================

    async getMeta<T>(key: string): Promise<T | null> {
        await this.open();
        const entry = await this.promisifyRequest<MetaEntry | undefined>(
            this.db!
                .transaction(STORE_META, 'readonly')
                .objectStore(STORE_META)
                .get(key)
        );
        return entry?.v as T ?? null;
    }

    async setMeta<T>(key: string, value: T): Promise<void> {
        await this.open();
        await this.promisifyRequest(
            this.db!
                .transaction(STORE_META, 'readwrite')
                .objectStore(STORE_META)
                .put({ k: key, v: value })
        );
    }

    async getTotalBytesPresent(): Promise<number> {
        return (await this.getMeta<number>(META_TOTAL_BYTES_PRESENT)) ?? 0;
    }

    async setTotalBytesPresent(bytes: number): Promise<void> {
        await this.setMeta(META_TOTAL_BYTES_PRESENT, bytes);
    }

    async getLastGcAt(): Promise<number> {
        return (await this.getMeta<number>(META_LAST_GC_AT)) ?? 0;
    }

    async setLastGcAt(timestamp: number): Promise<void> {
        await this.setMeta(META_LAST_GC_AT, timestamp);
    }

    // =========================================================================
    // Verification Receipt Operations
    // =========================================================================

    async recordManifestVerified(manifestHash: string, pubKeyHex: string, verifiedAt: number): Promise<void> {
        const key = `verified:${manifestHash}|${pubKeyHex}`;
        await this.setMeta(key, { manifestHash, pubKeyHex, verifiedAt });
    }

    async isManifestVerified(manifestHash: string, pubKeyHex: string): Promise<boolean> {
        const key = `verified:${manifestHash}|${pubKeyHex}`;
        const receipt = await this.getMeta<VerificationReceipt>(key);
        return receipt !== null;
    }

    // =========================================================================
    // Utilities
    // =========================================================================

    private promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
    }

    /**
     * Clear all stores (for testing).
     */
    async clear(): Promise<void> {
        await this.open();
        const stores = [
            STORE_BLOBS,
            STORE_MANIFESTS,
            STORE_OBS_INDEX,
            STORE_FORECAST_INDEX,
            STORE_PACK_INDEX,
            STORE_META
        ];

        for (const storeName of stores) {
            await this.promisifyRequest(
                this.db!
                    .transaction(storeName, 'readwrite')
                    .objectStore(storeName)
                    .clear()
            );
        }
    }

    // =========================================================================
    // Ops Helper Methods (for Closet Ops UI)
    // =========================================================================

    /**
     * Count present blobs.
     */
    async countPresentBlobs(): Promise<number> {
        await this.open();
        const all = await this.getAllBlobMetas();
        return all.filter((b) => b.present === 1).length;
    }

    /**
     * Count pinned blobs.
     */
    async countPinnedBlobs(): Promise<number> {
        await this.open();
        const all = await this.getAllBlobMetas();
        return all.filter((b) => b.pinned === 1).length;
    }

    /**
     * List top N blobs by size (descending).
     */
    async getPinnedBlobs(): Promise<BlobMeta[]> {
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(STORE_BLOBS, 'readonly');
            const store = tx.objectStore(STORE_BLOBS);
            // const index = store.index('pinned'); // We need a 'pinned' index?
            // Wait, we didn't define a 'pinned' index strictly in schema. 
            // Existing schema: hash(key), present, pinned, lastAccess. 
            // If no index, we have to scan. 'getAllBlobMetas' filters is fine for now as dataset is small-ish (thousands not millions).
            // But 'pinned' column index would be better.
            // Let's check schema in 'open()' method.

            // Checking schema (from memory/view):
            // const blobStore = db.createObjectStore(STORE_BLOB_META, { keyPath: 'hash' });
            // blobStore.createIndex('lastAccess', 'lastAccess', { unique: false });
            // blobStore.createIndex('present', 'present', { unique: false });
            // blobStore.createIndex('pinned', 'pinned', { unique: false }); -- Did we add this? 
            // If not, we iterate.

            // Fallback iteration
            const request = store.openCursor();
            const results: BlobMeta[] = [];
            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result as IDBCursorWithValue;
                if (cursor) {
                    const meta = cursor.value as BlobMeta;
                    if (meta.pinned === 1 && meta.present === 1) {
                        results.push(meta);
                    }
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    async listTopBlobsBySize(limit: number = 20): Promise<BlobMeta[]> {
        await this.open();
        const all = await this.getAllBlobMetas();
        return all
            .filter((b) => b.present === 1)
            .sort((a, b) => b.sizeBytes - a.sizeBytes)
            .slice(0, limit);
    }

    /**
     * Count pack index entries.
     */
    async countPackEntries(): Promise<number> {
        await this.open();
        return this.promisifyRequest<number>(
            this.db!
                .transaction(STORE_PACK_INDEX, 'readonly')
                .objectStore(STORE_PACK_INDEX)
                .count()
        );
    }

    /**
     * Get distinct pack IDs.
     */
    async getDistinctPackIds(): Promise<string[]> {
        await this.open();
        const entries = await this.promisifyRequest<PackIndexEntry[]>(
            this.db!
                .transaction(STORE_PACK_INDEX, 'readonly')
                .objectStore(STORE_PACK_INDEX)
                .getAll()
        ) ?? [];

        const packIds = new Set<string>();
        entries.forEach((e) => packIds.add(e.packId));
        return Array.from(packIds);
    }

    /**
     * Get manifest date bounds (oldest and newest).
     */
    async getManifestDateBounds(): Promise<{ oldest: string | null; newest: string | null }> {
        await this.open();
        const refs = await this.getAllManifestRefs();
        if (refs.length === 0) {
            return { oldest: null, newest: null };
        }

        const dates = refs.map((r) => r.date).sort();
        return {
            oldest: dates[0],
            newest: dates[dates.length - 1]
        };
    }

    /**
     * Prune manifest refs outside window (deterministic: oldest first).
     * Does NOT delete blobs, only cleans manifest refs.
     */
    async pruneManifestRefsOutsideWindow(
        windowCutoffMs: number,
        pinnedDates: Set<string>
    ): Promise<{ pruned: number; hashes: string[] }> {
        await this.open();
        const refs = await this.getAllManifestRefs();

        // Find refs outside window that are not pinned
        const toDelete = refs
            .filter((ref) => {
                const dateMs = new Date(ref.date + 'T00:00:00Z').getTime();
                return dateMs < windowCutoffMs && !pinnedDates.has(ref.date);
            })
            .sort((a, b) => a.date.localeCompare(b.date)); // Oldest first (deterministic)

        const deletedHashes: string[] = [];

        for (const ref of toDelete) {
            await this.promisifyRequest(
                this.db!
                    .transaction(STORE_MANIFESTS, 'readwrite')
                    .objectStore(STORE_MANIFESTS)
                    .delete(ref.key)
            );
            deletedHashes.push(ref.hash);
        }

        return { pruned: deletedHashes.length, hashes: deletedHashes };
    }

    /**
     * Reset all closet data (dangerous!).
     */
    async resetCloset(): Promise<void> {
        await this.clear();
        await this.setTotalBytesPresent(0);
        await this.setLastGcAt(Date.now());
    }

    // =========================================================================
    // Inflight Operations (v2)
    // =========================================================================

    /**
     * Mark a blob as in-flight (download started, DB commit pending).
     */
    async setInflight(hash: string): Promise<void> {
        await this.open();
        const entry: InflightEntry = {
            hash: hash.toLowerCase(),
            startedAtMs: Date.now()
        };
        await this.promisifyRequest(
            this.db!
                .transaction(STORE_INFLIGHT, 'readwrite')
                .objectStore(STORE_INFLIGHT)
                .put(entry)
        );
    }

    /**
     * Clear in-flight marker (download committed to DB).
     */
    async clearInflight(hash: string): Promise<void> {
        await this.open();
        await this.promisifyRequest(
            this.db!
                .transaction(STORE_INFLIGHT, 'readwrite')
                .objectStore(STORE_INFLIGHT)
                .delete(hash.toLowerCase())
        );
    }

    /**
     * Check if a hash is marked as in-flight.
     */
    async isInflight(hash: string): Promise<boolean> {
        await this.open();
        const entry = await this.promisifyRequest<InflightEntry | undefined>(
            this.db!
                .transaction(STORE_INFLIGHT, 'readonly')
                .objectStore(STORE_INFLIGHT)
                .get(hash.toLowerCase())
        );
        return entry !== undefined;
    }

    /**
     * Get all in-flight entries.
     */
    async getAllInflight(): Promise<InflightEntry[]> {
        await this.open();
        return this.promisifyRequest(
            this.db!
                .transaction(STORE_INFLIGHT, 'readonly')
                .objectStore(STORE_INFLIGHT)
                .getAll()
        );
    }

    /**
     * Get stale in-flight entries older than the given threshold.
     */
    async getStaleInflight(staleThresholdMs: number): Promise<InflightEntry[]> {
        const all = await this.getAllInflight();
        const now = Date.now();
        return all.filter(e => (now - e.startedAtMs) > staleThresholdMs);
    }

    /**
     * Clear all in-flight entries (for recovery/reset).
     */
    async clearAllInflight(): Promise<void> {
        await this.open();
        await this.promisifyRequest(
            this.db!
                .transaction(STORE_INFLIGHT, 'readwrite')
                .objectStore(STORE_INFLIGHT)
                .clear()
        );
    }
}

// =============================================================================
// Singleton
// =============================================================================

let closetDBInstance: ClosetDB | null = null;

export function getClosetDB(): ClosetDB {
    if (!closetDBInstance) {
        closetDBInstance = new ClosetDB();
    }
    return closetDBInstance;
}

// =============================================================================
// Key Builders
// =============================================================================

export function buildManifestKey(date: string, kind: string, shard: string): string {
    return `${date}|${kind}|${shard}`;
}

export function buildObservationKey(
    source: string,
    observedAtBucket: string,
    bucketMinutes: number,
    stationSetId: string
): string {
    return `${source}|${observedAtBucket}|${bucketMinutes}|${stationSetId}`;
}

export function buildForecastKey(model: string, runTime: string, gridKey: string): string {
    return `${model}|${runTime}|${gridKey}`;
}
