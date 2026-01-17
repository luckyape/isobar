/**
 * Safety Tripwire Tests
 * 
 * These tests enforce critical safety invariants that prevent data loss.
 * If any of these fail, DO NOT SHIP.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';
import { setLockProvider, TestLockProvider, StrictTestLockProvider, withClosetLock } from '../locks';
import { type ClosetPolicy, getDefaultClosetPolicy } from '../policy';

// Create mock instances that tests can configure
let mockClosetDBInstance: ReturnType<typeof createMockClosetDB>;

// Mock the db module BEFORE any imports that use it
vi.mock('../db', () => ({
    getClosetDB: () => mockClosetDBInstance,
}));

// NOW import reclaimTrueOrphans (after mock is set up)
import { reclaimTrueOrphans, type ReclaimParams, type ReclaimReport } from '../reconcile';

// Mock vault factory
const createMockVault = () => {
    const blobs = new Map<string, Uint8Array>();
    return {
        blobs,
        async open() { },
        async stat(hash: string) {
            const normalizedHash = hash.toLowerCase();
            const blob = blobs.get(normalizedHash);
            return blob
                ? { exists: true, size: blob.byteLength }
                : { exists: false };
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
    let totalBytes = 0;

    return {
        metas,
        inflight,
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
        async getTotalBytesPresent() {
            return totalBytes;
        },
        async setTotalBytesPresent(bytes: number) {
            totalBytes = bytes;
        },
        setTotalBytes(bytes: number) {
            totalBytes = bytes;
        },
        // Inflight methods
        async setInflight(hash: string) {
            inflight.set(hash.toLowerCase(), { hash: hash.toLowerCase(), startedAtMs: Date.now() });
        },
        async clearInflight(hash: string) {
            inflight.delete(hash.toLowerCase());
        },
        async isInflight(hash: string) {
            return inflight.has(hash.toLowerCase());
        },
        async getAllInflight() {
            return Array.from(inflight.values());
        },
        async getStaleInflight(staleThresholdMs: number) {
            const now = Date.now();
            return Array.from(inflight.values()).filter(e => (now - e.startedAtMs) > staleThresholdMs);
        },
        async clearAllInflight() {
            inflight.clear();
        },
        // Helper for tests to set inflight with custom time
        setInflightWithTime(hash: string, startedAtMs: number) {
            inflight.set(hash.toLowerCase(), { hash: hash.toLowerCase(), startedAtMs });
        }
    };
};

describe('Safety Tripwires', () => {
    let mockVault: ReturnType<typeof createMockVault>;

    beforeEach(() => {
        mockVault = createMockVault();
        mockClosetDBInstance = createMockClosetDB();
        setLockProvider(new TestLockProvider());
    });

    // =========================================================================
    // Tripwire 1: Reclaim MUST refuse without manifest proof
    // =========================================================================
    describe('Reclaim Safety Rails', () => {
        it('REFUSES to reclaim without manifest proof or danger acknowledgment', async () => {
            await mockVault.put('orphan_hash', new Uint8Array([1, 2, 3]));

            await expect(
                reclaimTrueOrphans(mockVault as any, {
                    confirmationToken: 'RECLAIM'
                })
            ).rejects.toThrow(/manifestKnownHashes/);
        });

        it('ALLOWS reclaim with manifest proof, skips hashes in manifests', async () => {
            const legitHash = 'legit_from_manifest';
            const junkHash = 'not_in_any_manifest';

            await mockVault.put(legitHash, new Uint8Array([1, 2, 3]));
            await mockVault.put(junkHash, new Uint8Array([4, 5, 6]));

            const report = await reclaimTrueOrphans(mockVault as any, {
                confirmationToken: 'RECLAIM',
                manifestKnownHashes: new Set([legitHash])
            });

            expect(report.trueOrphansFound).toBe(2);
            expect(report.orphansSkippedInManifest).toBe(1);
            expect(report.orphansReclaimed).toBe(1);
            expect(await mockVault.has(legitHash)).toBe(true);
            expect(await mockVault.has(junkHash)).toBe(false);
        });

        it('PROTECTS pinned hashes during reclaim', async () => {
            const pinnedHash = 'pinned_orphan';
            await mockVault.put(pinnedHash, new Uint8Array([7, 8, 9]));

            const policy: ClosetPolicy = {
                ...getDefaultClosetPolicy(),
                pins: [{ type: 'hash', hash: pinnedHash }]
            };

            const report = await reclaimTrueOrphans(mockVault as any, {
                confirmationToken: 'RECLAIM',
                manifestKnownHashes: new Set(['some_other_hash']),
                policy
            });

            expect(report.orphansSkippedPinned).toBe(1);
            expect(await mockVault.has(pinnedHash)).toBe(true);
        });

        it('ALLOWS dangerous reclaim with explicit acknowledgment', async () => {
            await mockVault.put('will_be_deleted', new Uint8Array([1]));

            const report = await reclaimTrueOrphans(mockVault as any, {
                confirmationToken: 'RECLAIM',
                dangerSkipManifestCheck: 'I_UNDERSTAND_DATA_LOSS_RISK'
            });

            expect(report.orphansReclaimed).toBe(1);
        });

        it('REJECTS wrong danger acknowledgment string', async () => {
            await mockVault.put('hash', new Uint8Array([1]));

            await expect(
                reclaimTrueOrphans(mockVault as any, {
                    confirmationToken: 'RECLAIM',
                    dangerSkipManifestCheck: 'wrong_string'
                })
            ).rejects.toThrow(/manifestKnownHashes/);
        });
    });

    // =========================================================================
    // Tripwire 2: No hardcoded CDN URLs in source (grep test)
    // =========================================================================
    describe('CDN URL Coupling Prevention', () => {
        it('no hardcoded localhost ports in client source (excluding config.ts)', () => {
            const clientSrcPath = path.resolve(__dirname, '../../..');

            try {
                const result = execSync(
                    `grep -rn "localhost:878[79]" --include="*.ts" --include="*.tsx" | grep -v "config.ts" | grep -v "node_modules" | grep -v ".test.ts" || true`,
                    { cwd: clientSrcPath, encoding: 'utf-8' }
                );

                const matches = result.trim().split('\n').filter(line => line.length > 0);

                if (matches.length > 0) {
                    throw new Error(
                        `Found hardcoded CDN URLs in source files. ` +
                        `Use getCdnBaseUrl() from lib/config.ts instead:\n${matches.join('\n')}`
                    );
                }
            } catch (e: any) {
                if (e.status !== 0 && e.status !== 1) {
                    throw e;
                }
            }
        });
    });

    // =========================================================================
    // Tripwire 3: Locking tripwire - concurrent ops must serialize
    // =========================================================================
    describe('Lock Serialization', () => {
        it('StrictTestLockProvider detects overlapping critical sections', async () => {
            const strictProvider = new StrictTestLockProvider();
            setLockProvider(strictProvider);

            let firstStarted = false;
            let firstDone = false;

            const op1 = withClosetLock('closet', async () => {
                firstStarted = true;
                await new Promise(r => setTimeout(r, 50));
                firstDone = true;
                return 'op1';
            });

            await new Promise(r => setTimeout(r, 10));
            expect(firstStarted).toBe(true);
            expect(firstDone).toBe(false);

            let tripwireHit = false;
            try {
                await withClosetLock('closet', async () => 'op2');
            } catch (e: any) {
                if (e.message.includes('TRIPWIRE')) {
                    tripwireHit = true;
                }
            }

            await op1;

            expect(tripwireHit).toBe(true);
            expect(strictProvider.overlapDetected).toBe(true);
        });
    });

    // =========================================================================
    // Tripwire 4: Inflight protection - reclaim MUST NOT delete mid-sync blobs
    // =========================================================================
    describe('Inflight Protection', () => {
        it('reclaim does NOT delete a blob that is in-flight even if not in manifestKnownHashes', async () => {
            const inflightHash = 'mid_sync_blob';
            await mockVault.put(inflightHash, new Uint8Array([1, 2, 3]));

            // Mark it as in-flight (simulating a download in progress)
            mockClosetDBInstance.setInflightWithTime(inflightHash, Date.now());

            const report = await reclaimTrueOrphans(mockVault as any, {
                confirmationToken: 'RECLAIM',
                dangerSkipManifestCheck: 'I_UNDERSTAND_DATA_LOSS_RISK'
            });

            // Should be found as orphan but skipped due to inflight
            expect(report.trueOrphansFound).toBe(1);
            expect(report.orphansSkippedInflight).toBe(1);
            expect(report.orphansReclaimed).toBe(0);
            expect(await mockVault.has(inflightHash)).toBe(true);
        });

        it('reclaim DOES delete stale in-flight blobs in danger mode after threshold', async () => {
            const staleHash = 'stale_inflight_blob';
            await mockVault.put(staleHash, new Uint8Array([1, 2, 3]));

            // Mark as in-flight 60 minutes ago (stale)
            const sixtyMinutesAgo = Date.now() - (60 * 60 * 1000);
            mockClosetDBInstance.setInflightWithTime(staleHash, sixtyMinutesAgo);

            // With 30 minute stale threshold (default), this should be deleted
            const report = await reclaimTrueOrphans(mockVault as any, {
                confirmationToken: 'RECLAIM',
                dangerSkipManifestCheck: 'I_UNDERSTAND_DATA_LOSS_RISK',
                inflightStaleMs: 30 * 60 * 1000 // 30 minutes
            });

            expect(report.trueOrphansFound).toBe(1);
            expect(report.orphansSkippedInflight).toBe(0);
            expect(report.orphansReclaimed).toBe(1);
            expect(await mockVault.has(staleHash)).toBe(false);
        });

        it('reclaim NEVER deletes in-flight blobs without danger acknowledgment, even if stale', async () => {
            const staleHash = 'stale_but_protected';
            await mockVault.put(staleHash, new Uint8Array([1, 2, 3]));

            // Mark as in-flight 60 minutes ago (stale)
            const sixtyMinutesAgo = Date.now() - (60 * 60 * 1000);
            mockClosetDBInstance.setInflightWithTime(staleHash, sixtyMinutesAgo);

            // When using manifestKnownHashes (not danger mode), stale inflight are still protected
            const report = await reclaimTrueOrphans(mockVault as any, {
                confirmationToken: 'RECLAIM',
                manifestKnownHashes: new Set(['some_other_hash'])
                // Note: NOT using dangerSkipManifestCheck
            });

            // Stale inflight should still be protected without danger ack
            expect(report.orphansSkippedInflight).toBe(1);
            expect(await mockVault.has(staleHash)).toBe(true);
        });
    });
});
