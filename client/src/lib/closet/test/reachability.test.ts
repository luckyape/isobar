/**
 * Reachability Tests — Determinism
 *
 * Uses pure functions to test determinism without IndexedDB.
 */

import { describe, it, expect } from 'vitest';
import { getDefaultClosetPolicy, type ClosetPolicy, getRetentionCutoff, isHashPinned } from '../policy';
import type { ManifestEntry } from '@cdn/types';

// =============================================================================
// In-Memory Test Helpers
// =============================================================================

const NOW_MS = new Date('2026-01-08T12:00:00Z').getTime();
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function shouldKeepEntry(
    entry: ManifestEntry,
    policy: ClosetPolicy,
    nowMs: number
): boolean {
    const forecastCutoffMs = getRetentionCutoff(nowMs, policy.keepForecastRunsDays);
    const observationCutoffMs = getRetentionCutoff(nowMs, policy.keepObservationDays);

    if (isHashPinned(policy, entry.hash)) return true;

    switch (entry.type) {
        case 'forecast': {
            if (!entry.runTime) return false;
            return new Date(entry.runTime).getTime() >= forecastCutoffMs;
        }
        case 'observation': {
            if (!entry.observedAtBucket) return false;
            return new Date(entry.observedAtBucket).getTime() >= observationCutoffMs;
        }
        case 'station_set':
            return false;
        default:
            return false;
    }
}

function computeReachableFromEntries(
    entries: ManifestEntry[],
    policy: ClosetPolicy,
    nowMs: number,
    activeHashes: string[] = []
): Set<string> {
    const reachable = new Set<string>();
    const stationSets = new Set<string>();

    for (const entry of entries) {
        if (shouldKeepEntry(entry, policy, nowMs)) {
            reachable.add(entry.hash);
            if (entry.type === 'observation' && entry.stationSetId) {
                stationSets.add(entry.stationSetId);
            }
        }
    }

    stationSets.forEach((id) => reachable.add(id));

    for (const pin of policy.pins) {
        if (pin.type === 'hash') {
            reachable.add(pin.hash.toLowerCase());
        }
    }

    for (const hash of activeHashes) {
        reachable.add(hash.toLowerCase());
    }

    return reachable;
}

// =============================================================================
// Tests
// =============================================================================

describe('Reachability Determinism Tests', () => {
    it('produces identical reachable sets for identical inputs', () => {
        const fiveDaysAgo = new Date(NOW_MS - 5 * MS_PER_DAY).toISOString();

        const entries: ManifestEntry[] = [
            { hash: 'aaaa'.repeat(16), type: 'forecast', sizeBytes: 1000, model: 'gfs', runTime: fiveDaysAgo },
            { hash: 'bbbb'.repeat(16), type: 'observation', sizeBytes: 500, source: 'eccc', observedAtBucket: fiveDaysAgo, stationSetId: 'cccc'.repeat(16) },
            { hash: 'dddd'.repeat(16), type: 'forecast', sizeBytes: 1200, model: 'gem', runTime: fiveDaysAgo }
        ];

        const policy = getDefaultClosetPolicy();

        // Run computation multiple times
        const results: Set<string>[] = [];
        for (let i = 0; i < 5; i++) {
            results.push(computeReachableFromEntries(entries, policy, NOW_MS));
        }

        // Convert to sorted arrays for comparison
        const sortedArrays = results.map((set) => Array.from(set).sort());

        // All results should be identical
        for (let i = 1; i < sortedArrays.length; i++) {
            expect(sortedArrays[i]).toEqual(sortedArrays[0]);
        }
    });

    it('produces different results for different nowMs', () => {
        const tenDaysAgo = new Date(NOW_MS - 10 * MS_PER_DAY).toISOString();

        const entries: ManifestEntry[] = [
            { hash: 'eeee'.repeat(16), type: 'forecast', sizeBytes: 1000, model: 'gfs', runTime: tenDaysAgo }
        ];

        const policy: ClosetPolicy = {
            ...getDefaultClosetPolicy(),
            keepForecastRunsDays: 14
        };

        // At NOW_MS, forecast is 10 days old (within 14-day retention)
        const reachableNow = computeReachableFromEntries(entries, policy, NOW_MS);

        // 10 days later, forecast would be 20 days old (outside retention)
        const reachableLater = computeReachableFromEntries(entries, policy, NOW_MS + 10 * MS_PER_DAY);

        expect(reachableNow.has('eeee'.repeat(16))).toBe(true);
        expect(reachableLater.has('eeee'.repeat(16))).toBe(false);
    });

    it('includes activeHashes in reachable set', () => {
        const ephemeralHash = '1111'.repeat(16);

        const reachable = computeReachableFromEntries(
            [],
            getDefaultClosetPolicy(),
            NOW_MS,
            [ephemeralHash]
        );

        expect(reachable.has(ephemeralHash.toLowerCase())).toBe(true);
    });

    it('produces consistent results regardless of entry order', () => {
        const fiveDaysAgo = new Date(NOW_MS - 5 * MS_PER_DAY).toISOString();

        const entriesA: ManifestEntry[] = [
            { hash: 'aaaa'.repeat(16), type: 'forecast', sizeBytes: 1000, model: 'gfs', runTime: fiveDaysAgo },
            { hash: 'bbbb'.repeat(16), type: 'forecast', sizeBytes: 1200, model: 'gem', runTime: fiveDaysAgo }
        ];

        const entriesB: ManifestEntry[] = [
            { hash: 'bbbb'.repeat(16), type: 'forecast', sizeBytes: 1200, model: 'gem', runTime: fiveDaysAgo },
            { hash: 'aaaa'.repeat(16), type: 'forecast', sizeBytes: 1000, model: 'gfs', runTime: fiveDaysAgo }
        ];

        const policy = getDefaultClosetPolicy();

        const reachableA = computeReachableFromEntries(entriesA, policy, NOW_MS);
        const reachableB = computeReachableFromEntries(entriesB, policy, NOW_MS);

        expect(Array.from(reachableA).sort()).toEqual(Array.from(reachableB).sort());
    });
});
