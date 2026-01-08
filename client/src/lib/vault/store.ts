/**
 * Weather Forecast CDN — Client Vault (IndexedDB Store)
 *
 * Local storage for content-addressed artifacts on the device.
 * This is the client's canonical database.
 */

import { hashHex, verifyHash } from '@cdn/hash';
import type { Artifact, DailyManifest } from '@cdn/types';
import { unpackageArtifact, getBlobContentHash } from '@cdn/artifact';
import { unpackageManifest } from '@cdn/manifest';

// =============================================================================
// Database Schema
// =============================================================================

const DB_NAME = 'weather-vault';
const DB_VERSION = 1;
const STORE_BLOBS = 'blobs';       // Raw blobs keyed by hash
const STORE_META = 'meta';         // Local metadata (lastSync, etc.)

// =============================================================================
// Vault Class
// =============================================================================

export class Vault {
    private db: IDBDatabase | null = null;
    private opening: Promise<IDBDatabase> | null = null;

    /**
     * Open the vault database.
     */
    async open(): Promise<void> {
        if (this.db) return;
        if (this.opening) {
            await this.opening;
            return;
        }

        this.opening = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(request.result);
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                // Blobs store: key is hash, value is Uint8Array
                if (!db.objectStoreNames.contains(STORE_BLOBS)) {
                    db.createObjectStore(STORE_BLOBS);
                }

                // Meta store: arbitrary metadata
                if (!db.objectStoreNames.contains(STORE_META)) {
                    db.createObjectStore(STORE_META);
                }
            };
        });

        await this.opening;
        this.opening = null;
    }

    /**
     * Check if a blob exists by hash.
     */
    async has(hash: string): Promise<boolean> {
        await this.open();
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(STORE_BLOBS, 'readonly');
            const store = tx.objectStore(STORE_BLOBS);
            const request = store.getKey(hash);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result !== undefined);
        });
    }

    /**
     * Store a blob with verification.
     * The blob is verified against its expected hash before storing.
     */
    async put(expectedHash: string, blob: Uint8Array): Promise<void> {
        await this.open();

        // Verify hash
        const actualHash = getBlobContentHash(blob);
        if (actualHash !== expectedHash.toLowerCase()) {
            throw new Error(`Hash mismatch: expected ${expectedHash}, got ${actualHash}`);
        }

        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(STORE_BLOBS, 'readwrite');
            const store = tx.objectStore(STORE_BLOBS);
            const request = store.put(blob, expectedHash);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
        });
    }

    /**
     * Get a raw blob by hash.
     */
    async getBlob(hash: string): Promise<Uint8Array | null> {
        await this.open();
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(STORE_BLOBS, 'readonly');
            const store = tx.objectStore(STORE_BLOBS);
            const request = store.get(hash);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result ?? null);
        });
    }

    /**
     * Get and unpackage an artifact by hash.
     */
    async getArtifact(hash: string): Promise<Artifact | null> {
        const blob = await this.getBlob(hash);
        if (!blob) return null;
        return unpackageArtifact(blob);
    }

    /**
     * Get and unpackage a manifest by hash.
     */
    async getManifest(hash: string): Promise<DailyManifest | null> {
        const blob = await this.getBlob(hash);
        if (!blob) return null;
        return unpackageManifest(blob);
    }

    /**
     * Get all blob hashes in the vault.
     */
    async getAllHashes(): Promise<string[]> {
        await this.open();
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(STORE_BLOBS, 'readonly');
            const store = tx.objectStore(STORE_BLOBS);
            const request = store.getAllKeys();

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result as string[]);
        });
    }

    /**
     * Get metadata value.
     */
    async getMeta<T>(key: string): Promise<T | null> {
        await this.open();
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(STORE_META, 'readonly');
            const store = tx.objectStore(STORE_META);
            const request = store.get(key);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result ?? null);
        });
    }

    /**
     * Set metadata value.
     */
    async setMeta<T>(key: string, value: T): Promise<void> {
        await this.open();
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(STORE_META, 'readwrite');
            const store = tx.objectStore(STORE_META);
            const request = store.put(value, key);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
        });
    }

    /**
     * Delete blobs older than a certain date (for pruning).
     * Note: This requires walking all blobs and checking their metadata.
     */
    async pruneOlderThan(cutoffDate: Date): Promise<number> {
        const allHashes = await this.getAllHashes();
        let pruned = 0;

        for (const hash of allHashes) {
            try {
                const artifact = await this.getArtifact(hash);
                if (!artifact) continue;

                // Determine artifact date
                let artifactDate: Date | null = null;
                if (artifact.type === 'forecast' && 'runTime' in artifact) {
                    artifactDate = new Date(artifact.runTime);
                } else if (artifact.type === 'observation' && 'observedAtBucket' in artifact) {
                    artifactDate = new Date(artifact.observedAtBucket);
                }

                if (artifactDate && artifactDate < cutoffDate) {
                    await this.deleteBlob(hash);
                    pruned++;
                }
            } catch (error) {
                // Skip corrupted or unparseable blobs
                console.warn(`Failed to process ${hash}:`, error);
            }
        }

        return pruned;
    }

    /**
     * Delete a blob by hash.
     */
    private async deleteBlob(hash: string): Promise<void> {
        await this.open();
        return new Promise((resolve, reject) => {
            const tx = this.db!.transaction(STORE_BLOBS, 'readwrite');
            const store = tx.objectStore(STORE_BLOBS);
            const request = store.delete(hash);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
        });
    }

    /**
     * Close the database connection.
     */
    close(): void {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }

    /**
     * Get vault statistics.
     */
    async getStats(): Promise<{ blobCount: number; estimatedSizeBytes: number }> {
        const allHashes = await this.getAllHashes();
        let totalSize = 0;

        for (const hash of allHashes.slice(0, 100)) {
            // Sample first 100 for size estimate
            const blob = await this.getBlob(hash);
            if (blob) totalSize += blob.length;
        }

        const avgSize = allHashes.length > 0 ? totalSize / Math.min(allHashes.length, 100) : 0;

        return {
            blobCount: allHashes.length,
            estimatedSizeBytes: Math.round(avgSize * allHashes.length)
        };
    }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let vaultInstance: Vault | null = null;

export function getVault(): Vault {
    if (!vaultInstance) {
        vaultInstance = new Vault();
    }
    return vaultInstance;
}
