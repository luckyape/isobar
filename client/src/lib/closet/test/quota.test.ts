/**
 * Quota Tests — Deterministic deletion order
 *
 * Uses in-memory simulation to test deletion ordering.
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

/**
 * Simulate quota enforcement with deterministic deletion order.
 * Order: lastAccess ASC, then hash ASC
 */
function simulateQuotaEnforcement(
    blobs: InMemoryBlob[],
    reachable: Set<string>,
    quotaBytes: number
): { deletionOrder: string[]; bytesAfter: number } {
    // Sort by lastAccess ASC, then hash ASC (deterministic)
    const sorted = [...blobs]
        .filter((b) => b.present === 1)
        .sort((a, b) => {
            if (a.lastAccess !== b.lastAccess) {
                return a.lastAccess - b.lastAccess;
            }
            return a.hash.localeCompare(b.hash);
        });

    let currentBytes = blobs.filter((b) => b.present === 1).reduce((sum, b) => sum + b.sizeBytes, 0);
    const deletionOrder: string[] = [];

    for (const blob of sorted) {
        if (currentBytes <= quotaBytes) break;
        if (blob.pinned === 1) continue;
        if (reachable.has(blob.hash)) continue;

        blob.present = 0;
        deletionOrder.push(blob.hash);
        currentBytes -= blob.sizeBytes;
    }

    return { deletionOrder, bytesAfter: currentBytes };
}

// =============================================================================
// Tests
// =============================================================================

describe('Quota Enforcement Tests', () => {
    it('deletes blobs in deterministic order: lastAccess ASC, then hash ASC', () => {
        // Create 5 unreachable blobs with specific lastAccess and hash values
        const blobs: InMemoryBlob[] = [
            // Same lastAccess (100), different hashes - should delete in hash order
            { hash: 'cccc'.repeat(16), sizeBytes: 100, lastAccess: 100, pinned: 0, present: 1 },
            { hash: 'aaaa'.repeat(16), sizeBytes: 100, lastAccess: 100, pinned: 0, present: 1 },
            { hash: 'bbbb'.repeat(16), sizeBytes: 100, lastAccess: 100, pinned: 0, present: 1 },
            // Different lastAccess
            { hash: 'dddd'.repeat(16), sizeBytes: 100, lastAccess: 50, pinned: 0, present: 1 },  // oldest
            { hash: 'eeee'.repeat(16), sizeBytes: 100, lastAccess: 200, pinned: 0, present: 1 }, // newest
        ];

        const reachable = new Set<string>();

        // Quota = 200 bytes, so need to delete 3 blobs
        const result = simulateQuotaEnforcement(blobs, reachable, 200);

        // Expected deletion order:
        // 1. dddd (lastAccess=50)
        // 2. aaaa (lastAccess=100, hash comes first)
        // 3. bbbb (lastAccess=100, hash second)
        expect(result.deletionOrder).toHaveLength(3);
        expect(result.deletionOrder[0]).toBe('dddd'.repeat(16)); // oldest
        expect(result.deletionOrder[1]).toBe('aaaa'.repeat(16)); // same lastAccess, first by hash
        expect(result.deletionOrder[2]).toBe('bbbb'.repeat(16)); // same lastAccess, second by hash

        expect(result.bytesAfter).toBe(200);
    });

    it('stops deleting when quota is satisfied', () => {
        const blobs: InMemoryBlob[] = [
            { hash: '1111'.repeat(16), sizeBytes: 100, lastAccess: 100, pinned: 0, present: 1 },
            { hash: '2222'.repeat(16), sizeBytes: 100, lastAccess: 200, pinned: 0, present: 1 },
            { hash: '3333'.repeat(16), sizeBytes: 100, lastAccess: 300, pinned: 0, present: 1 },
        ];

        const reachable = new Set<string>();

        // Quota = 250, so need to delete only 1 blob
        const result = simulateQuotaEnforcement(blobs, reachable, 250);

        expect(result.deletionOrder).toHaveLength(1);
        expect(result.deletionOrder[0]).toBe('1111'.repeat(16)); // oldest by lastAccess
        expect(result.bytesAfter).toBe(200);
    });

    it('respects deterministic order across multiple runs', () => {
        // Use closures to recreate blobs for each run
        const createBlobs = (): InMemoryBlob[] => [
            { hash: 'ffff'.repeat(16), sizeBytes: 100, lastAccess: 500, pinned: 0, present: 1 },
            { hash: 'aaaa'.repeat(16), sizeBytes: 100, lastAccess: 500, pinned: 0, present: 1 },
        ];

        const reachable = new Set<string>();
        const deletedHashes: string[] = [];

        // Run 3 times
        for (let i = 0; i < 3; i++) {
            const blobs = createBlobs();
            const result = simulateQuotaEnforcement(blobs, reachable, 100);
            deletedHashes.push(result.deletionOrder[0]);
        }

        // Should always delete 'aaaa' first (comes before 'ffff' alphabetically)
        expect(deletedHashes).toEqual([
            'aaaa'.repeat(16),
            'aaaa'.repeat(16),
            'aaaa'.repeat(16)
        ]);
    });

    it('skips pinned blobs in deletion order', () => {
        const blobs: InMemoryBlob[] = [
            { hash: 'aaaa'.repeat(16), sizeBytes: 100, lastAccess: 100, pinned: 1, present: 1 }, // Pinned
            { hash: 'bbbb'.repeat(16), sizeBytes: 100, lastAccess: 200, pinned: 0, present: 1 },
            { hash: 'cccc'.repeat(16), sizeBytes: 100, lastAccess: 300, pinned: 0, present: 1 },
        ];

        const reachable = new Set<string>();

        // Quota = 100, need to delete 2 blobs
        const result = simulateQuotaEnforcement(blobs, reachable, 100);

        // Should delete bbbb and cccc, not aaaa (pinned)
        expect(result.deletionOrder).not.toContain('aaaa'.repeat(16));
        expect(result.deletionOrder).toContain('bbbb'.repeat(16));
        expect(result.deletionOrder).toContain('cccc'.repeat(16));
    });

    it('skips reachable blobs in deletion order', () => {
        const blobs: InMemoryBlob[] = [
            { hash: 'aaaa'.repeat(16), sizeBytes: 100, lastAccess: 100, pinned: 0, present: 1 },
            { hash: 'bbbb'.repeat(16), sizeBytes: 100, lastAccess: 200, pinned: 0, present: 1 },
        ];

        const reachable = new Set(['aaaa'.repeat(16)]);

        // Quota = 50, need to delete blobs
        const result = simulateQuotaEnforcement(blobs, reachable, 50);

        // Should only delete bbbb (aaaa is reachable)
        expect(result.deletionOrder).not.toContain('aaaa'.repeat(16));
        expect(result.deletionOrder).toContain('bbbb'.repeat(16));
    });
});
