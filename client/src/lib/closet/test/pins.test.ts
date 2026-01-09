/**
 * Pins Tests — Pinned blobs are immune to GC
 *
 * Uses in-memory simulation to test pin logic without IndexedDB.
 */

import { describe, it, expect } from 'vitest';
import { getDefaultClosetPolicy, type ClosetPolicy, isHashPinned } from '../policy';
import type { BlobMeta } from '../db';

// =============================================================================
// In-Memory GC Simulation
// =============================================================================

interface InMemoryBlob {
    hash: string;
    sizeBytes: number;
    lastAccess: number;
    pinned: 0 | 1;
    present: 0 | 1;
}

/**
 * Simulate GC sweep: delete unreachable and unpinned blobs.
 */
function simulateSweep(
    blobs: InMemoryBlob[],
    reachable: Set<string>
): { deleted: string[]; freedBytes: number } {
    const deleted: string[] = [];
    let freedBytes = 0;

    for (const blob of blobs) {
        if (blob.present !== 1) continue;
        if (blob.pinned === 1) continue;
        if (reachable.has(blob.hash)) continue;

        // Mark as deleted
        blob.present = 0;
        deleted.push(blob.hash);
        freedBytes += blob.sizeBytes;
    }

    return { deleted, freedBytes };
}

/**
 * Simulate quota enforcement: delete in deterministic order until under quota.
 */
function simulateQuotaEnforcement(
    blobs: InMemoryBlob[],
    reachable: Set<string>,
    quotaBytes: number
): { deleted: string[]; freedBytes: number; cannotSatisfy: boolean } {
    // Sort by lastAccess ASC, then hash ASC
    const sorted = [...blobs]
        .filter((b) => b.present === 1)
        .sort((a, b) => {
            if (a.lastAccess !== b.lastAccess) {
                return a.lastAccess - b.lastAccess;
            }
            return a.hash.localeCompare(b.hash);
        });

    let currentBytes = blobs.filter((b) => b.present === 1).reduce((sum, b) => sum + b.sizeBytes, 0);
    const deleted: string[] = [];
    let freedBytes = 0;

    for (const blob of sorted) {
        if (currentBytes <= quotaBytes) break;
        if (blob.pinned === 1) continue;
        if (reachable.has(blob.hash)) continue;

        blob.present = 0;
        deleted.push(blob.hash);
        freedBytes += blob.sizeBytes;
        currentBytes -= blob.sizeBytes;
    }

    return {
        deleted,
        freedBytes,
        cannotSatisfy: currentBytes > quotaBytes
    };
}

// =============================================================================
// Tests
// =============================================================================

describe('Pins Tests', () => {
    it('never deletes pinned blobs even if unreachable', () => {
        const pinnedHash = 'aaaa'.repeat(16);
        const unpinnedHash = 'bbbb'.repeat(16);

        const blobs: InMemoryBlob[] = [
            { hash: pinnedHash, sizeBytes: 1000, lastAccess: 100, pinned: 1, present: 1 },
            { hash: unpinnedHash, sizeBytes: 500, lastAccess: 200, pinned: 0, present: 1 }
        ];

        const reachable = new Set<string>(); // Nothing reachable

        const result = simulateSweep(blobs, reachable);

        expect(result.deleted).toContain(unpinnedHash);
        expect(result.deleted).not.toContain(pinnedHash);
        expect(result.freedBytes).toBe(500);

        // Verify pinned blob is still present
        const pinnedBlob = blobs.find((b) => b.hash === pinnedHash);
        expect(pinnedBlob?.present).toBe(1);
    });

    it('respects hash pins in policy', () => {
        const targetHash = 'cccc'.repeat(16);

        const policy: ClosetPolicy = {
            ...getDefaultClosetPolicy(),
            pins: [{ type: 'hash', hash: targetHash }]
        };

        expect(isHashPinned(policy, targetHash)).toBe(true);
        expect(isHashPinned(policy, 'dddd'.repeat(16))).toBe(false);
    });

    it('pinned blobs survive quota enforcement', () => {
        const pinnedHash = 'eeee'.repeat(16);
        const unpinnedHash = 'ffff'.repeat(16);

        const blobs: InMemoryBlob[] = [
            { hash: pinnedHash, sizeBytes: 500, lastAccess: 100, pinned: 1, present: 1 },
            { hash: unpinnedHash, sizeBytes: 500, lastAccess: 200, pinned: 0, present: 1 }
        ];

        const reachable = new Set<string>();

        const result = simulateQuotaEnforcement(blobs, reachable, 100);

        // Only unpinned should be deleted
        expect(result.deleted).toContain(unpinnedHash);
        expect(result.deleted).not.toContain(pinnedHash);

        // Still can't satisfy quota because pinned blob remains
        expect(result.cannotSatisfy).toBe(true);
    });

    it('reachable blobs are also immune to deletion', () => {
        const reachableHash = 'gggg'.repeat(16);
        const unreachableHash = 'hhhh'.repeat(16);

        const blobs: InMemoryBlob[] = [
            { hash: reachableHash, sizeBytes: 500, lastAccess: 100, pinned: 0, present: 1 },
            { hash: unreachableHash, sizeBytes: 500, lastAccess: 200, pinned: 0, present: 1 }
        ];

        const reachable = new Set([reachableHash]);

        const result = simulateSweep(blobs, reachable);

        expect(result.deleted).toContain(unreachableHash);
        expect(result.deleted).not.toContain(reachableHash);
    });
});
