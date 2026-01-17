
import { describe, it, expect, vi } from 'vitest';
import { selectStationId, extractObservationSeries, getObservationBucketsForRange } from '../observations';
import { mae, circularAbsDiffDeg, signedDelta, summarizeWindow } from '../error';
import { normalizeForecastToCanonical } from '../../weatherNormalization';
import type { ObservationArtifact, StationSetArtifact, ForecastArtifact } from '@cdn/types';

// Mock getVault and getClosetDB
vi.mock('@/lib/vault', () => ({
    getVault: vi.fn(() => ({
        getArtifact: vi.fn()
    }))
}));

vi.mock('@/lib/closet', () => {
    return {
        getClosetDB: vi.fn(() => ({
            getObservationsByBucket: vi.fn()
        })),
        buildObservationKey: vi.fn(),
        getVault: vi.fn()
    };
});

describe('observations', () => {
    describe('selectStationId', () => {
        const stationSet: StationSetArtifact = {
            type: 'station_set',
            schemaVersion: 1,
            source: 'test',
            stations: [
                { id: 'A', lat: 10, lon: 10, name: 'Station A' },
                { id: 'B', lat: 10, lon: 10.1, name: 'Station B' }, // B is slightly further from 10,10 than A? No wait.
                // Let's make explicit distances.
                // Target: 0, 0
                { id: 'CLOSE', lat: 0.1, lon: 0.1, name: 'Close' },
                { id: 'FAR', lat: 5, lon: 5, name: 'Far' },
                // Tie-break scenario
                { id: 'TIE_1', lat: 1, lon: 1, name: 'Tie 1' },
                { id: 'TIE_2', lat: 1, lon: 1, name: 'Tie 2' } // Same pos
            ]
        };

        it('selects nearest station', () => {
            const id = selectStationId(stationSet, 0, 0); // Should be CLOSE
            expect(id).toBe('CLOSE');
        });

        it('breaks ties deterministically by ID (lexical)', () => {
            // Both at 1,1. IDs are TIE_1 and TIE_2.
            // "TIE_1" < "TIE_2"
            const id = selectStationId(stationSet, 1, 1);
            expect(id).toBe('TIE_1');
        });

        it('respects preferred ID if present', () => {
            const id = selectStationId(stationSet, 5, 5, 'FAR');
            expect(id).toBe('FAR');
        });

        it('ignores invalid preference', () => {
            // Preference 'MISSING' not in set -> fallback to nearest 'FAR'
            const id = selectStationId(stationSet, 5, 5, 'MISSING');
            expect(id).toBe('FAR');
        });
    });

    describe('extractObservationSeries', () => {
        it('aligns buckets correctly and handles nulls', async () => {
            const t1 = Date.UTC(2024, 0, 1, 10, 0);
            const t2 = Date.UTC(2024, 0, 1, 11, 0);
            const t3 = Date.UTC(2024, 0, 1, 12, 0);
            const buckets = [t1, t2, t3];

            const art: ObservationArtifact = {
                schemaVersion: 1,
                type: 'observation',
                source: 'test',
                observedAtBucket: '2024-01-01T11:00:00', // Matches t2 directly
                bucketMinutes: 60,
                fetchedAt: 123,
                // stationSetId: 'ss1', // Removed to avoid mocking lookup
                variables: ['airTempC'],
                data: {
                    'airTempC': {
                        'st1': 20.5
                    }
                }
            };

            const { series } = await extractObservationSeries([art], 'st1', 0, 0, buckets);

            expect(series.tempC).toEqual([null, 20.5, null]);
            expect(series.buckets).toEqual(buckets);
        });
    });
});

describe('error math', () => {
    it('calculates MAE correctly ignoring nulls', () => {
        const m = [10, 20, 30, null, 50];
        const o = [12, 20, 40, 40, null];
        // Pairs: (10,12)->diff 2, (20,20)->diff 0, (30,40)->diff 10.
        // Ignored: (null,40), (50,null).
        // Total diff = 12, Count = 3. MAE = 4.
        expect(mae(m, o)).toBe(4);
    });

    it('calculates signed delta', () => {
        const m = [10, 20];
        const o = [12, 15];
        // 10-12 = -2
        // 20-15 = 5
        expect(signedDelta(m, o)).toEqual([-2, 5]);
    });

    it('calculates circular abs diff', () => {
        expect(circularAbsDiffDeg(359, 1)).toBe(2);
        expect(circularAbsDiffDeg(1, 359)).toBe(2);
        expect(circularAbsDiffDeg(180, 0)).toBe(180);
        expect(circularAbsDiffDeg(90, 270)).toBe(180);
        expect(circularAbsDiffDeg(10, 20)).toBe(10);
    });

    it('summarizes window stats', () => {
        const m = [10, 20];
        const o = [12, 18];
        // Diff: -2, +2.
        // Abs Diff: 2, 2 -> 4. MAE = 2.
        // Signed Diff: 0. Bias = 0.
        const stats = summarizeWindow(m, o);
        expect(stats.mae).toBe(2);
        expect(stats.bias).toBe(0);
        expect(stats.count).toBe(2);
    });
});

describe('weatherNormalization', () => {
    it('extracts canonical series', () => {
        const fa: ForecastArtifact = {
            schemaVersion: 1,
            type: 'forecast',
            model: 'test',
            runTime: '2024-01-01T00:00:00Z',
            issuedAt: 0,
            validTimes: [],
            variables: ['temp_2m'],
            grid: { type: 'point', lat: 0, lon: 0 },
            data: {
                'temp_2m': [10, 20]
            },
            variableMap: {
                'temp_2m': 'airTempC'
            },
            source: 'test'
        };

        const canonical = normalizeForecastToCanonical(fa);
        expect(canonical['airTempC']).toEqual([10, 20]);
        expect(canonical['random']).toBeUndefined();
    });
});
