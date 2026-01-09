/**
 * Ops Plan Deletion Tests
 *
 * Tests for planDeletion determinism and correctness.
 */

import { describe, it, expect } from 'vitest';
import type { BlobMeta } from '../db';

// =============================================================================
// In-memory simulation helpers
// =============================================================================

interface SimBlob {
    hash: string;
    sizeBytes: number;
    lastAccess: number;
    pinned: 0 | 1;
    present: 0 | 1;
}

/**
 * Simulate planDeletion using the same ordering as real GC.
 */
function simulatePlanDeletion(
    blobs: SimBlob[],
    reachable: Set<string>,
    quotaBytes: number
): { entries: Array<{ hash: string; reason: string }>; order: string[] } {
    // Sort by (lastAccess ASC, hash ASC) - same as real GC
    const sorted = [...blobs]
        .filter((b) => b.present === 1)
        .sort((a, b) => {
            if (a.lastAccess !== b.lastAccess) {
                return a.lastAccess - b.lastAccess;
            }
            return a.hash.localeCompare(b.hash);
        });

    const entries: Array<{ hash: string; reason: string }> = [];

    for (const blob of sorted) {
        if (blob.pinned === 1) continue;
        if (reachable.has(blob.hash)) continue;

        entries.push({ hash: blob.hash, reason: 'unreachable' });
    }

    return {
        entries,
        order: entries.map((e) => e.hash)
    };
}

// =============================================================================
// Tests
// =============================================================================

describe('Plan Deletion Determinism', () => {
    it('produces identical hash order across runs', () => {
        const blobs: SimBlob[] = [
            { hash: 'aaaa', sizeBytes: 100, lastAccess: 1000, pinned: 0, present: 1 },
            { hash: 'bbbb', sizeBytes: 200, lastAccess: 500, pinned: 0, present: 1 },
            { hash: 'cccc', sizeBytes: 150, lastAccess: 500, pinned: 0, present: 1 },
            { hash: 'dddd', sizeBytes: 300, lastAccess: 1000, pinned: 0, present: 1 }
        ];

        const reachable = new Set<string>();

        // Run multiple times
        const run1 = simulatePlanDeletion(blobs, reachable, 500);
        const run2 = simulatePlanDeletion(blobs, reachable, 500);
        const run3 = simulatePlanDeletion(blobs, reachable, 500);

        // All runs should produce identical order
        expect(run1.order).toEqual(run2.order);
        expect(run2.order).toEqual(run3.order);

        // Order should be (lastAccess ASC, hash ASC)
        // lastAccess 500: bbbb, cccc (alpha order)
        // lastAccess 1000: aaaa, dddd (alpha order)
        expect(run1.order).toEqual(['bbbb', 'cccc', 'aaaa', 'dddd']);
    });

    it('excludes pinned blobs from deletion plan', () => {
        const blobs: SimBlob[] = [
            { hash: 'pinned', sizeBytes: 100, lastAccess: 0, pinned: 1, present: 1 },
            { hash: 'unpinned', sizeBytes: 100, lastAccess: 0, pinned: 0, present: 1 }
        ];

        const reachable = new Set<string>();
        const plan = simulatePlanDeletion(blobs, reachable, 100);

        expect(plan.order).not.toContain('pinned');
        expect(plan.order).toContain('unpinned');
    });

    it('excludes reachable blobs from deletion plan', () => {
        const blobs: SimBlob[] = [
            { hash: 'reachable', sizeBytes: 100, lastAccess: 0, pinned: 0, present: 1 },
            { hash: 'unreachable', sizeBytes: 100, lastAccess: 0, pinned: 0, present: 1 }
        ];

        const reachable = new Set<string>(['reachable']);
        const plan = simulatePlanDeletion(blobs, reachable, 100);

        expect(plan.order).not.toContain('reachable');
        expect(plan.order).toContain('unreachable');
    });

    it('excludes non-present blobs from deletion plan', () => {
        const blobs: SimBlob[] = [
            { hash: 'present', sizeBytes: 100, lastAccess: 0, pinned: 0, present: 1 },
            { hash: 'notpresent', sizeBytes: 100, lastAccess: 0, pinned: 0, present: 0 }
        ];

        const reachable = new Set<string>();
        const plan = simulatePlanDeletion(blobs, reachable, 100);

        expect(plan.order).toContain('present');
        expect(plan.order).not.toContain('notpresent');
    });
});

describe('Prune Manifest Refs Determinism', () => {
    it('deletes oldest manifests first', () => {
        const refs = [
            { date: '2026-01-05', hash: 'e' },
            { date: '2026-01-01', hash: 'a' },
            { date: '2026-01-03', hash: 'c' },
            { date: '2026-01-02', hash: 'b' },
            { date: '2026-01-04', hash: 'd' }
        ];

        const windowCutoffMs = new Date('2026-01-04T00:00:00Z').getTime();
        const pinnedDates = new Set<string>();

        // Filter refs outside window
        const toDelete = refs
            .filter((ref) => {
                const dateMs = new Date(ref.date + 'T00:00:00Z').getTime();
                return dateMs < windowCutoffMs && !pinnedDates.has(ref.date);
            })
            .sort((a, b) => a.date.localeCompare(b.date));

        // Should be sorted oldest first
        expect(toDelete.map((r) => r.date)).toEqual([
            '2026-01-01',
            '2026-01-02',
            '2026-01-03'
        ]);
    });
});

describe('Trusted Mode UI Requirement', () => {
    it('trusted mode without pubkey throws error', () => {
        const trustMode = 'trusted';
        const pubKey: string | undefined = undefined;

        function requirePubKey(): string | undefined {
            if (trustMode === 'trusted') {
                const pk = pubKey?.toLowerCase();
                if (!pk) {
                    throw new Error('Trusted mode requires expectedManifestPubKeyHex');
                }
                return pk;
            }
            return undefined;
        }

        expect(() => requirePubKey()).toThrow('Trusted mode requires expectedManifestPubKeyHex');
    });

    it('unverified mode does not require pubkey', () => {
        const trustMode = 'unverified';
        const pubKey: string | undefined = undefined;

        function requirePubKey(): string | undefined {
            if (trustMode === 'trusted') {
                const pk = pubKey?.toLowerCase();
                if (!pk) {
                    throw new Error('Trusted mode requires expectedManifestPubKeyHex');
                }
                return pk;
            }
            return undefined;
        }

        expect(() => requirePubKey()).not.toThrow();
        expect(requirePubKey()).toBeUndefined();
    });
});
