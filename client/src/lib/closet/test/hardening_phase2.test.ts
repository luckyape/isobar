/**
 * Hardening Phase 2 Tests
 * 
 * Tests for:
 * - GC respects inflight blobs (never deletes mid-sync)
 * - Trusted mode gating for destructive operations
 * - Sync + GC lock serialization
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setLockProvider, TestLockProvider } from '../locks';

// Mock ClosetDB for isolated testing
let mockClosetDBInstance: ReturnType<typeof createMockClosetDB>;

vi.mock('../db', () => ({
    getClosetDB: () => mockClosetDBInstance,
}));

// Mock Vault for isolated testing
vi.mock('../../vault', () => ({
    getVault: () => mockVaultInstance,
}));

let mockVaultInstance: ReturnType<typeof createMockVault>;

import {
    runGCNow,
    resetCloset,
    runReconciliation,
    runReclaimTrueOrphans,
    computeOpsSnapshot,
    isTrustedMode,
    TRUSTED_MODE_REQUIRED,
    type OpsConfig
} from '../ops';
import { getDefaultClosetPolicy } from '../policy';

// Mock vault factory
const createMockVault = () => {
    const blobs = new Map<string, Uint8Array>();
    return {
        blobs,
        async open() { },
        async stat(hash: string) {
            const blob = blobs.get(hash.toLowerCase());
            return blob ? { exists: true, size: blob.byteLength } : { exists: false };
        },
        async delete(hash: string) {
            blobs.delete(hash.toLowerCase());
        },
        async getAllHashes() {
            return Array.from(blobs.keys());
        },
        async put(hash: string, data: Uint8Array) {
            blobs.set(hash.toLowerCase(), data);
        },
        async getBlob(hash: string) {
            return blobs.get(hash.toLowerCase()) ?? null;
        },
        async has(hash: string) {
            return blobs.has(hash.toLowerCase());
        },
    };
};

// Mock closetDB factory
const createMockClosetDB = () => {
    const metas = new Map<string, any>();
    const inflight = new Map<string, { hash: string; startedAtMs: number }>();
    const manifestRefs: any[] = [];
    let totalBytes = 0;
    let lastGcAt = 0;

    return {
        metas,
        inflight,
        manifestRefs,
        async open() { },
        async getBlobMeta(hash: string) {
            return metas.get(hash.toLowerCase()) ?? null;
        },
        async upsertBlobMeta(meta: any) {
            metas.set(meta.hash.toLowerCase(), { ...meta });
        },
        async deleteBlobMeta(hash: string) {
            metas.delete(hash.toLowerCase());
        },
        async getAllBlobMetas() {
            return Array.from(metas.values());
        },
        async listPresentBlobsSortedForDeletion() {
            return Array.from(metas.values())
                .filter(m => m.present === 1)
                .sort((a, b) => a.lastAccess - b.lastAccess || a.hash.localeCompare(b.hash));
        },
        async getTotalBytesPresent() {
            return totalBytes;
        },
        async setTotalBytesPresent(bytes: number) {
            totalBytes = bytes;
        },
        async getLastGcAt() {
            return lastGcAt;
        },
        async setLastGcAt(ts: number) {
            lastGcAt = ts;
        },
        async countPresentBlobs() {
            return Array.from(metas.values()).filter(m => m.present === 1).length;
        },
        async countPinnedBlobs() {
            return Array.from(metas.values()).filter(m => m.pinned === 1).length;
        },
        // Inflight methods
        async setInflight(hash: string) {
            inflight.set(hash.toLowerCase(), { hash: hash.toLowerCase(), startedAtMs: Date.now() });
        },
        async clearInflight(hash: string) {
            inflight.delete(hash.toLowerCase());
        },
        async getAllInflight() {
            return Array.from(inflight.values());
        },
        async clearAllInflight() {
            inflight.clear();
        },
        // Manifest methods
        async getAllManifestRefs() {
            return manifestRefs;
        },
        async getManifestDateBounds() {
            return { oldest: null, newest: null };
        },
        async resetCloset() {
            metas.clear();
            inflight.clear();
            manifestRefs.length = 0;
            totalBytes = 0;
        },
        // Pack index methods
        async countPackEntries() {
            return 0;
        },
        async getDistinctPackIds() {
            return [];
        },
        async listTopBlobsBySize(limit: number) {
            return Array.from(metas.values())
                .filter(m => m.present === 1)
                .sort((a, b) => b.sizeBytes - a.sizeBytes)
                .slice(0, limit);
        },
        // Helper for tests
        setInflightWithTime(hash: string, startedAtMs: number) {
            inflight.set(hash.toLowerCase(), { hash: hash.toLowerCase(), startedAtMs });
        },
        addBlobMeta(hash: string, sizeBytes: number, present: 0 | 1 = 1, pinned: 0 | 1 = 0) {
            metas.set(hash.toLowerCase(), {
                hash: hash.toLowerCase(),
                sizeBytes,
                lastAccess: Date.now(),
                present,
                pinned
            });
            if (present === 1) totalBytes += sizeBytes;
        }
    };
};

describe('Hardening Phase 2', () => {
    beforeEach(() => {
        mockClosetDBInstance = createMockClosetDB();
        mockVaultInstance = createMockVault();
        setLockProvider(new TestLockProvider());
    });

    // =========================================================================
    // Trusted Mode Gating
    // =========================================================================
    describe('Trusted Mode Gating', () => {
        const unverifiedConfig: OpsConfig = {
            trustMode: 'unverified',
            expectedManifestPubKeyHex: undefined,
            policy: getDefaultClosetPolicy()
        };

        const trustedConfig: OpsConfig = {
            trustMode: 'trusted',
            expectedManifestPubKeyHex: 'abc123def456',
            policy: getDefaultClosetPolicy()
        };

        describe('isTrustedMode helper', () => {
            it('returns false for unverified mode', () => {
                expect(isTrustedMode(unverifiedConfig)).toBe(false);
            });

            it('returns false for trusted mode without pubkey', () => {
                expect(isTrustedMode({
                    trustMode: 'trusted',
                    expectedManifestPubKeyHex: undefined,
                    policy: getDefaultClosetPolicy()
                })).toBe(false);
            });

            it('returns true for trusted mode with pubkey', () => {
                expect(isTrustedMode(trustedConfig)).toBe(true);
            });
        });

        describe('runGCNow', () => {
            it('throws TRUSTED_MODE_REQUIRED in unverified mode', async () => {
                await expect(runGCNow(unverifiedConfig)).rejects.toThrow(TRUSTED_MODE_REQUIRED);
            });

            it('succeeds in trusted mode', async () => {
                // Should not throw
                await expect(runGCNow(trustedConfig)).resolves.toBeDefined();
            });
        });

        describe('resetCloset', () => {
            it('throws TRUSTED_MODE_REQUIRED in unverified mode', async () => {
                await expect(resetCloset(unverifiedConfig)).rejects.toThrow(TRUSTED_MODE_REQUIRED);
            });

            it('succeeds in trusted mode', async () => {
                await expect(resetCloset(trustedConfig)).resolves.toBeUndefined();
            });
        });

        describe('runReconciliation', () => {
            it('allows dry-run (fix=false) in unverified mode', async () => {
                // Dry-run should work in unverified mode
                await expect(runReconciliation(unverifiedConfig, false)).resolves.toBeDefined();
            });

            it('throws TRUSTED_MODE_REQUIRED for fix=true in unverified mode', async () => {
                await expect(runReconciliation(unverifiedConfig, true)).rejects.toThrow(TRUSTED_MODE_REQUIRED);
            });

            it('allows fix=true in trusted mode', async () => {
                await expect(runReconciliation(trustedConfig, true)).resolves.toBeDefined();
            });
        });

        describe('runReclaimTrueOrphans', () => {
            it('throws TRUSTED_MODE_REQUIRED in unverified mode', async () => {
                await expect(
                    runReclaimTrueOrphans(
                        unverifiedConfig,
                        'RECLAIM',
                        new Set(['hash1']),
                        undefined,
                        undefined
                    )
                ).rejects.toThrow(TRUSTED_MODE_REQUIRED);
            });

            it('proceeds in trusted mode (then hits other validation)', async () => {
                // Should get past trusted mode check and hit RECLAIM validation
                const result = await runReclaimTrueOrphans(
                    trustedConfig,
                    'RECLAIM',
                    new Set(['hash1']),
                    undefined,
                    undefined
                );
                expect(result).toBeDefined();
            });
        });

        describe('computeOpsSnapshot', () => {
            it('works in unverified mode (read-only)', async () => {
                // Read-only operations should always work
                const snapshot = await computeOpsSnapshot(unverifiedConfig);
                expect(snapshot).toBeDefined();
                expect(snapshot.trustMode).toBe('unverified');
            });
        });
    });

    // =========================================================================
    // GC Inflight Protection
    // =========================================================================
    describe('GC Inflight Protection', () => {
        const trustedConfig: OpsConfig = {
            trustMode: 'trusted',
            expectedManifestPubKeyHex: 'abc123',
            policy: getDefaultClosetPolicy()
        };

        it('GC skips inflight blobs during sweep', async () => {
            // Add two blobs: one normal, one inflight
            mockClosetDBInstance.addBlobMeta('normal_blob', 1000);
            mockClosetDBInstance.addBlobMeta('inflight_blob', 1000);

            // Mark one as inflight
            mockClosetDBInstance.setInflightWithTime('inflight_blob', Date.now());

            // Run GC
            const result = await runGCNow(trustedConfig);

            // Normal blob should be deleted (not reachable), inflight should survive
            expect(result.deletedCount).toBe(1);

            // Inflight blob meta should still be present=1
            const inflightMeta = await mockClosetDBInstance.getBlobMeta('inflight_blob');
            expect(inflightMeta?.present).toBe(1);

            // Normal blob should be deleted
            const normalMeta = await mockClosetDBInstance.getBlobMeta('normal_blob');
            expect(normalMeta?.present).toBe(0);
        });
    });
});
