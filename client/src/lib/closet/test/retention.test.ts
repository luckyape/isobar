/**
 * Retention Tests — Type-specific retention for forecasts vs observations
 *
 * Uses full in-memory mocks to avoid IndexedDB dependency.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDefaultClosetPolicy, type ClosetPolicy, getRetentionCutoff, isHashPinned } from '../policy';
import type { ManifestEntry, DailyManifest } from '@cdn/types';

// =============================================================================
// In-Memory Test Helpers
// =============================================================================

const NOW_MS = new Date('2026-01-08T12:00:00Z').getTime();
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Test retention logic directly without IndexedDB.
 */
function shouldKeepEntry(
    entry: ManifestEntry,
    policy: ClosetPolicy,
    nowMs: number
): { keep: boolean; reason: string } {
    const forecastCutoffMs = getRetentionCutoff(nowMs, policy.keepForecastRunsDays);
    const observationCutoffMs = getRetentionCutoff(nowMs, policy.keepObservationDays);

    if (isHashPinned(policy, entry.hash)) {
        return { keep: true, reason: 'pinned' };
    }

    switch (entry.type) {
        case 'forecast': {
            if (!entry.runTime) {
                return { keep: false, reason: 'no runTime' };
            }
            const runTimeMs = new Date(entry.runTime).getTime();
            if (runTimeMs >= forecastCutoffMs) {
                return { keep: true, reason: 'within forecast retention' };
            }
            return { keep: false, reason: 'outside forecast retention' };
        }

        case 'observation': {
            if (!entry.observedAtBucket) {
                return { keep: false, reason: 'no observedAtBucket' };
            }
            const bucketMs = new Date(entry.observedAtBucket).getTime();
            if (bucketMs >= observationCutoffMs) {
                return { keep: true, reason: 'within observation retention' };
            }
            return { keep: false, reason: 'outside observation retention' };
        }

        case 'station_set': {
            return { keep: false, reason: 'station_set not kept by default' };
        }

        default:
            return { keep: false, reason: 'unknown type' };
    }
}

/**
 * Compute reachability from manifest entries.
 */
function computeReachableFromEntries(
    entries: ManifestEntry[],
    policy: ClosetPolicy,
    nowMs: number
): { reachable: Set<string>; stationSets: Set<string> } {
    const reachable = new Set<string>();
    const stationSets = new Set<string>();

    for (const entry of entries) {
        const result = shouldKeepEntry(entry, policy, nowMs);
        if (result.keep) {
            reachable.add(entry.hash);
            if (entry.type === 'observation' && entry.stationSetId) {
                stationSets.add(entry.stationSetId);
            }
        }
    }

    // Add station sets to reachable
    stationSets.forEach((id) => reachable.add(id));

    // Add pinned hashes
    for (const pin of policy.pins) {
        if (pin.type === 'hash') {
            reachable.add(pin.hash.toLowerCase());
        }
    }

    return { reachable, stationSets };
}

// =============================================================================
// Tests
// =============================================================================

describe('Retention Tests', () => {
    it('keeps observations within retention but NOT forecasts outside retention', () => {
        const forecastHash = 'aaaa'.repeat(16);
        const obsHash = 'bbbb'.repeat(16);
        const stationSetHash = 'cccc'.repeat(16);

        // 20 days ago
        const twentyDaysAgo = new Date(NOW_MS - 20 * MS_PER_DAY).toISOString();

        const entries: ManifestEntry[] = [
            {
                hash: forecastHash,
                type: 'forecast',
                sizeBytes: 1000,
                model: 'gfs',
                runTime: twentyDaysAgo
            },
            {
                hash: obsHash,
                type: 'observation',
                sizeBytes: 500,
                source: 'eccc',
                observedAtBucket: twentyDaysAgo,
                stationSetId: stationSetHash
            },
            {
                hash: stationSetHash,
                type: 'station_set',
                sizeBytes: 200,
                source: 'eccc'
            }
        ];

        // Policy: keep forecasts 14 days, observations 30 days
        const policy: ClosetPolicy = {
            ...getDefaultClosetPolicy(),
            keepForecastRunsDays: 14,
            keepObservationDays: 30
        };

        const { reachable } = computeReachableFromEntries(entries, policy, NOW_MS);

        expect(reachable.has(obsHash)).toBe(true);      // Observation: 20 days < 30 days retention
        expect(reachable.has(forecastHash)).toBe(false); // Forecast: 20 days > 14 days retention
        expect(reachable.has(stationSetHash)).toBe(true); // Station set: referenced by kept observation
    });

    it('does NOT keep station sets when no observations reference them', () => {
        const stationSetHash = 'dddd'.repeat(16);

        const entries: ManifestEntry[] = [
            {
                hash: stationSetHash,
                type: 'station_set',
                sizeBytes: 200,
                source: 'eccc'
            }
        ];

        const { reachable } = computeReachableFromEntries(entries, getDefaultClosetPolicy(), NOW_MS);

        expect(reachable.has(stationSetHash)).toBe(false); // Not referenced by any observation
    });

    it('keeps forecasts within retention window', () => {
        const forecastHash = 'eeee'.repeat(16);

        // 10 days ago - within 14-day retention
        const tenDaysAgo = new Date(NOW_MS - 10 * MS_PER_DAY).toISOString();

        const entries: ManifestEntry[] = [
            {
                hash: forecastHash,
                type: 'forecast',
                sizeBytes: 1000,
                model: 'gfs',
                runTime: tenDaysAgo
            }
        ];

        const policy: ClosetPolicy = {
            ...getDefaultClosetPolicy(),
            keepForecastRunsDays: 14
        };

        const { reachable } = computeReachableFromEntries(entries, policy, NOW_MS);

        expect(reachable.has(forecastHash)).toBe(true); // 10 days < 14 days retention
    });

    it('does NOT keep observations outside retention window', () => {
        const obsHash = 'ffff'.repeat(16);

        // 40 days ago - outside 30-day retention
        const fortyDaysAgo = new Date(NOW_MS - 40 * MS_PER_DAY).toISOString();

        const entries: ManifestEntry[] = [
            {
                hash: obsHash,
                type: 'observation',
                sizeBytes: 500,
                source: 'eccc',
                observedAtBucket: fortyDaysAgo,
                stationSetId: '0000'.repeat(16)
            }
        ];

        const policy: ClosetPolicy = {
            ...getDefaultClosetPolicy(),
            keepObservationDays: 30
        };

        const { reachable } = computeReachableFromEntries(entries, policy, NOW_MS);

        expect(reachable.has(obsHash)).toBe(false); // 40 days > 30 days retention
    });

    it('keeps pinned hashes regardless of retention', () => {
        const pinnedHash = 'gggg'.repeat(16);

        // 100 days ago - far outside any retention
        const oldTime = new Date(NOW_MS - 100 * MS_PER_DAY).toISOString();

        const entries: ManifestEntry[] = [
            {
                hash: pinnedHash,
                type: 'forecast',
                sizeBytes: 1000,
                model: 'gfs',
                runTime: oldTime
            }
        ];

        const policy: ClosetPolicy = {
            ...getDefaultClosetPolicy(),
            keepForecastRunsDays: 14,
            pins: [{ type: 'hash', hash: pinnedHash }]
        };

        const { reachable } = computeReachableFromEntries(entries, policy, NOW_MS);

        expect(reachable.has(pinnedHash)).toBe(true); // Pinned, kept regardless of retention
    });
});
