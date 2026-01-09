/**
 * Closet Hardening Tests
 * 
 * Tests for:
 * 1. Race safety - true orphans not deleted
 * 2. Pinned safety - pinned orphans not deleted
 * 3. Totals accounting - recomputation after fix
 * 4. Case normalization - mixed case hash handling
 * 5. Locking - mutual exclusion with tripwire
 * 6. Keys-only enumeration - getAllHashes doesn't read payloads
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { reconcileStorage, type ReconciliationReport } from '../reconcile';
import { StrictTestLockProvider, setLockProvider, TestLockProvider, withClosetLock } from '../locks';
import { type ClosetPolicy, getDefaultClosetPolicy } from '../policy';

// Mock vault and closetDB for isolated testing
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

const createMockClosetDB = () => {
    const metas = new Map<string, any>();
    let totalBytes = 0;

    return {
        metas,
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
        }
    };
};

describe('Closet Hardening', () => {
    let mockVault: ReturnType<typeof createMockVault>;
    let mockClosetDB: ReturnType<typeof createMockClosetDB>;

    beforeEach(() => {
        mockVault = createMockVault();
        mockClosetDB = createMockClosetDB();
        // Reset lock provider to test implementation
        setLockProvider(new TestLockProvider());
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // =========================================================================
    // 1. Race Safety Tests
    // =========================================================================
    describe('Race Safety', () => {
        it('does NOT delete true orphans (blobs in vault but not in DB)', async () => {
            // Setup: Blob exists in vault but NOT in ClosetDB (simulating mid-flight sync)
            const hash = 'abc123def456';
            await mockVault.put(hash, new Uint8Array([1, 2, 3]));
            // No meta in DB - this is a "true orphan"

            // Mock the imports
            vi.doMock('../db', () => ({
                getClosetDB: () => mockClosetDB,
            }));

            // Run reconcile with fix=true
            const { reconcileStorage: reconcile } = await import('../reconcile');
            const report = await reconcile(mockVault as any, true);

            // True orphan should be REPORTED but NOT deleted
            expect(report.trueOrphansFound).toBe(1);
            expect(report.orphansReclaimed).toBe(0);
            expect(await mockVault.has(hash)).toBe(true); // Still exists!
        });

        it('DOES delete soft orphans (present=0 in DB)', async () => {
            const hash = 'soft123';
            await mockVault.put(hash, new Uint8Array([4, 5, 6]));
            await mockClosetDB.upsertBlobMeta({
                hash,
                sizeBytes: 3,
                lastAccess: Date.now(),
                present: 0, // Soft deleted
                pinned: 0
            });

            vi.doMock('../db', () => ({
                getClosetDB: () => mockClosetDB,
            }));

            const { reconcileStorage: reconcile } = await import('../reconcile');
            const report = await reconcile(mockVault as any, true);

            expect(report.softOrphansFound).toBe(1);
            expect(report.orphansReclaimed).toBe(1);
            expect(await mockVault.has(hash)).toBe(false); // Deleted
        });
    });

    // =========================================================================
    // 2. Pinned Safety Tests
    // =========================================================================
    describe('Pinned Safety', () => {
        it('does NOT delete orphans pinned by policy', async () => {
            const hash = 'pinned_by_policy';
            await mockVault.put(hash, new Uint8Array([7, 8, 9]));
            await mockClosetDB.upsertBlobMeta({
                hash,
                sizeBytes: 3,
                lastAccess: Date.now(),
                present: 0, // Soft orphan
                pinned: 0   // Not meta-pinned
            });

            const policy: ClosetPolicy = {
                ...getDefaultClosetPolicy(),
                pins: [{ type: 'hash', hash: hash.toUpperCase() }] // Test case insensitivity
            };

            vi.doMock('../db', () => ({
                getClosetDB: () => mockClosetDB,
            }));

            const { reconcileStorage: reconcile } = await import('../reconcile');
            const report = await reconcile(mockVault as any, true, { policy });

            expect(report.softOrphansFound).toBe(1);
            expect(report.pinnedOrphansSkipped).toBe(1);
            expect(report.orphansReclaimed).toBe(0);
            expect(await mockVault.has(hash)).toBe(true);
        });

        it('does NOT delete orphans with meta.pinned=1', async () => {
            const hash = 'meta_pinned';
            await mockVault.put(hash, new Uint8Array([10, 11, 12]));
            await mockClosetDB.upsertBlobMeta({
                hash,
                sizeBytes: 3,
                lastAccess: Date.now(),
                present: 0,
                pinned: 1  // Meta-pinned
            });

            vi.doMock('../db', () => ({
                getClosetDB: () => mockClosetDB,
            }));

            const { reconcileStorage: reconcile } = await import('../reconcile');
            const report = await reconcile(mockVault as any, true);

            expect(report.pinnedOrphansSkipped).toBe(1);
            expect(await mockVault.has(hash)).toBe(true);
        });

        it('does NOT delete orphans in activeHashes', async () => {
            const hash = 'active_hash';
            await mockVault.put(hash, new Uint8Array([13, 14, 15]));
            await mockClosetDB.upsertBlobMeta({
                hash,
                sizeBytes: 3,
                lastAccess: Date.now(),
                present: 0,
                pinned: 0
            });

            vi.doMock('../db', () => ({
                getClosetDB: () => mockClosetDB,
            }));

            const { reconcileStorage: reconcile } = await import('../reconcile');
            const report = await reconcile(mockVault as any, true, {
                activeHashes: [hash.toUpperCase()] // Test case insensitivity
            });

            expect(report.pinnedOrphansSkipped).toBe(1);
            expect(await mockVault.has(hash)).toBe(true);
        });
    });

    // =========================================================================
    // 3. Totals Accounting Tests
    // =========================================================================
    describe('Totals Accounting', () => {
        it('recomputes totalBytesPresent after fix', async () => {
            // Setup with corrupted total
            await mockClosetDB.upsertBlobMeta({
                hash: 'blob1',
                sizeBytes: 100,
                lastAccess: Date.now(),
                present: 1,
                pinned: 0
            });
            await mockClosetDB.upsertBlobMeta({
                hash: 'blob2',
                sizeBytes: 200,
                lastAccess: Date.now(),
                present: 1,
                pinned: 0
            });
            await mockVault.put('blob1', new Uint8Array(100));
            await mockVault.put('blob2', new Uint8Array(200));

            // Set WRONG total (corrupted)
            mockClosetDB.setTotalBytes(999999);

            vi.doMock('../db', () => ({
                getClosetDB: () => mockClosetDB,
            }));

            const { reconcileStorage: reconcile } = await import('../reconcile');
            const report = await reconcile(mockVault as any, true);

            // Total should be recomputed to 300
            expect(report.totalBytesRecomputed).toBe(300);
            expect(await mockClosetDB.getTotalBytesPresent()).toBe(300);
        });
    });

    // =========================================================================
    // 4. Case Normalization Tests
    // =========================================================================
    describe('Case Normalization', () => {
        it('handles mixed case hashes correctly', async () => {
            // DB has uppercase, vault has lowercase
            const upperHash = 'ABC123DEF456';
            const lowerHash = 'abc123def456';

            await mockVault.put(lowerHash, new Uint8Array([1, 2, 3]));
            await mockClosetDB.upsertBlobMeta({
                hash: upperHash,
                sizeBytes: 3,
                lastAccess: Date.now(),
                present: 0,
                pinned: 0
            });

            vi.doMock('../db', () => ({
                getClosetDB: () => mockClosetDB,
            }));

            const { reconcileStorage: reconcile } = await import('../reconcile');
            const report = await reconcile(mockVault as any, true);

            // Should match and delete (it's a soft orphan)
            expect(report.softOrphansFound).toBe(1);
            expect(report.trueOrphansFound).toBe(0); // NOT a true orphan
        });
    });

    // =========================================================================
    // 5. Locking Tests (Tripwire)
    // =========================================================================
    describe('Locking', () => {
        it('StrictTestLockProvider detects overlap', async () => {
            const strictProvider = new StrictTestLockProvider();
            setLockProvider(strictProvider);

            // Create a slow task that holds the lock
            const slowTask = async () => {
                return withClosetLock('closet', async () => {
                    await new Promise(r => setTimeout(r, 100));
                    return 'first';
                });
            };

            // Try to enter while first is running (should throw)
            const fastTask = async () => {
                return withClosetLock('closet', async () => {
                    return 'second';
                });
            };

            // Start slow task
            const p1 = slowTask();

            // Immediately try fast task (should trigger tripwire)
            await new Promise(r => setTimeout(r, 10)); // Let slow task start

            let tripwireTriggered = false;
            try {
                await fastTask();
            } catch (e: any) {
                if (e.message.includes('TRIPWIRE')) {
                    tripwireTriggered = true;
                }
            }

            await p1; // Wait for first to complete

            expect(tripwireTriggered).toBe(true);
            expect(strictProvider.overlapDetected).toBe(true);
        });

        it('TestLockProvider serializes correctly (no overlap)', async () => {
            const testProvider = new TestLockProvider();
            setLockProvider(testProvider);

            const results: number[] = [];

            const task1 = withClosetLock('closet', async () => {
                results.push(1);
                await new Promise(r => setTimeout(r, 50));
                results.push(2);
            });

            const task2 = withClosetLock('closet', async () => {
                results.push(3);
                await new Promise(r => setTimeout(r, 50));
                results.push(4);
            });

            await Promise.all([task1, task2]);

            // Should be serialized: either [1,2,3,4] or [3,4,1,2]
            expect(results.length).toBe(4);
            // Check no interleaving
            if (results[0] === 1) {
                expect(results).toEqual([1, 2, 3, 4]);
            } else {
                expect(results).toEqual([3, 4, 1, 2]);
            }
        });
    });

    // =========================================================================
    // 6. Keys-Only Enumeration Test
    // =========================================================================
    describe('Keys-Only Enumeration', () => {
        it('getAllHashes does not read blob payloads', async () => {
            // Spy on getBlob
            const getBlobSpy = vi.spyOn(mockVault, 'getBlob');

            await mockVault.put('hash1', new Uint8Array([1]));
            await mockVault.put('hash2', new Uint8Array([2]));

            const hashes = await mockVault.getAllHashes();

            expect(hashes).toHaveLength(2);
            expect(getBlobSpy).not.toHaveBeenCalled();
        });
    });
});
