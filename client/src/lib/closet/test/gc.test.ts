/**
 * GC Tests — Cannot satisfy quota edge case
 *
 * Uses in-memory simulation to test GC edge cases.
 */

import { describe, it, expect } from 'vitest';

// =============================================================================
// In-Memory Types & Simulation
// =============================================================================

interface InMemoryBlob {
    hash: string;
    sizeBytes: number;
    lastAccess: number;
    pinned: 0 | 1;
    present: 0 | 1;
}

interface GCResult {
    deletedCount: number;
    freedBytes: number;
    bytesAfter: number;
    cannotSatisfyQuota: boolean;
}

/**
 * Simulate full GC cycle: sweep then quota enforcement.
 */
function simulateGC(
    blobs: InMemoryBlob[],
    reachable: Set<string>,
    quotaBytes: number
): GCResult {
    let deletedCount = 0;
    let freedBytes = 0;

    // 1. Sweep unreachable+unpinned
    for (const blob of blobs) {
        if (blob.present !== 1) continue;
        if (blob.pinned === 1) continue;
        if (reachable.has(blob.hash)) continue;

        blob.present = 0;
        deletedCount++;
        freedBytes += blob.sizeBytes;
    }

    // 2. Calculate bytes after sweep
    let bytesAfter = blobs
        .filter((b) => b.present === 1)
        .reduce((sum, b) => sum + b.sizeBytes, 0);

    // 3. Quota enforcement (if still over)
    if (bytesAfter > quotaBytes) {
        const sorted = [...blobs]
            .filter((b) => b.present === 1)
            .sort((a, b) => {
                if (a.lastAccess !== b.lastAccess) {
                    return a.lastAccess - b.lastAccess;
                }
                return a.hash.localeCompare(b.hash);
            });

        for (const blob of sorted) {
            if (bytesAfter <= quotaBytes) break;
            if (blob.pinned === 1) continue;
            if (reachable.has(blob.hash)) continue;

            blob.present = 0;
            deletedCount++;
            freedBytes += blob.sizeBytes;
            bytesAfter -= blob.sizeBytes;
        }
    }

    const cannotSatisfyQuota = bytesAfter > quotaBytes;

    return { deletedCount, freedBytes, bytesAfter, cannotSatisfyQuota };
}

// =============================================================================
// Tests
// =============================================================================

describe('GC Edge Case Tests', () => {
    it('reports cannotSatisfyQuota=true when all blobs are reachable', () => {
        const blobs: InMemoryBlob[] = [
            { hash: 'aaaa'.repeat(16), sizeBytes: 500, lastAccess: 100, pinned: 0, present: 1 },
            { hash: 'bbbb'.repeat(16), sizeBytes: 500, lastAccess: 200, pinned: 0, present: 1 },
        ];

        // All blobs are reachable
        const reachable = new Set([
            'aaaa'.repeat(16),
            'bbbb'.repeat(16)
        ]);

        const result = simulateGC(blobs, reachable, 100);

        expect(result.cannotSatisfyQuota).toBe(true);
        expect(result.deletedCount).toBe(0);
        expect(result.bytesAfter).toBe(1000);
    });

    it('reports cannotSatisfyQuota=true when all blobs are pinned', () => {
        const blobs: InMemoryBlob[] = [
            { hash: 'cccc'.repeat(16), sizeBytes: 500, lastAccess: 100, pinned: 1, present: 1 },
            { hash: 'dddd'.repeat(16), sizeBytes: 500, lastAccess: 200, pinned: 1, present: 1 },
        ];

        const reachable = new Set<string>();

        const result = simulateGC(blobs, reachable, 100);

        expect(result.cannotSatisfyQuota).toBe(true);
        expect(result.deletedCount).toBe(0);
    });

    it('does not loop infinitely when quota cannot be satisfied', () => {
        const blobs: InMemoryBlob[] = [
            { hash: 'eeee'.repeat(16), sizeBytes: 500, lastAccess: 100, pinned: 1, present: 1 },
        ];

        const reachable = new Set<string>();

        const startTime = Date.now();
        const result = simulateGC(blobs, reachable, 100);
        const elapsed = Date.now() - startTime;

        // Should complete almost instantly (< 100ms)
        expect(elapsed).toBeLessThan(100);
        expect(result.cannotSatisfyQuota).toBe(true);
    });

    it('correctly handles mix of deletable and non-deletable blobs', () => {
        const blobs: InMemoryBlob[] = [
            { hash: 'aaaa'.repeat(16), sizeBytes: 300, lastAccess: 100, pinned: 0, present: 1 }, // Reachable
            { hash: 'bbbb'.repeat(16), sizeBytes: 300, lastAccess: 200, pinned: 1, present: 1 }, // Pinned
            { hash: 'cccc'.repeat(16), sizeBytes: 200, lastAccess: 300, pinned: 0, present: 1 }, // Deletable
        ];

        const reachable = new Set(['aaaa'.repeat(16)]);

        const result = simulateGC(blobs, reachable, 600);

        expect(result.deletedCount).toBe(1);
        expect(result.freedBytes).toBe(200);
        expect(result.bytesAfter).toBe(600);
        expect(result.cannotSatisfyQuota).toBe(false);

        // Verify correct blob was deleted
        const aaaa = blobs.find((b) => b.hash === 'aaaa'.repeat(16));
        const bbbb = blobs.find((b) => b.hash === 'bbbb'.repeat(16));
        const cccc = blobs.find((b) => b.hash === 'cccc'.repeat(16));

        expect(aaaa?.present).toBe(1); // Reachable, kept
        expect(bbbb?.present).toBe(1); // Pinned, kept
        expect(cccc?.present).toBe(0); // Deletable, deleted
    });

    it('deletes all unreachable+unpinned before reporting cannotSatisfyQuota', () => {
        const blobs: InMemoryBlob[] = [
            { hash: 'aaaa'.repeat(16), sizeBytes: 500, lastAccess: 100, pinned: 1, present: 1 },
            { hash: 'bbbb'.repeat(16), sizeBytes: 100, lastAccess: 200, pinned: 0, present: 1 }, // Deletable
        ];

        const reachable = new Set<string>();

        const result = simulateGC(blobs, reachable, 100);

        // bbbb should be deleted (unreachable, unpinned)
        expect(result.deletedCount).toBe(1);
        expect(result.freedBytes).toBe(100);

        // Still over quota because aaaa is pinned
        expect(result.bytesAfter).toBe(500);
        expect(result.cannotSatisfyQuota).toBe(true);
    });

    it('reports cannotSatisfyQuota=false when quota can be satisfied', () => {
        const blobs: InMemoryBlob[] = [
            { hash: 'aaaa'.repeat(16), sizeBytes: 100, lastAccess: 100, pinned: 0, present: 1 },
            { hash: 'bbbb'.repeat(16), sizeBytes: 100, lastAccess: 200, pinned: 0, present: 1 },
        ];

        const reachable = new Set(['bbbb'.repeat(16)]);

        const result = simulateGC(blobs, reachable, 100);

        expect(result.cannotSatisfyQuota).toBe(false);
        expect(result.deletedCount).toBe(1);
        expect(result.bytesAfter).toBe(100);
    });
});
