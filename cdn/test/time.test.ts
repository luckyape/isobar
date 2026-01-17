
import { describe, it, expect } from 'vitest';
import { floorToBucketUtc } from '../time';
import { canonicalMsgPack } from '../canonical';
import { hashHex } from '../hash';

describe('Time Bucketing Determinism', () => {

    it('floors timestamps correctly (60 min bucket)', () => {
        const bucketMinutes = 60;

        // Exact boundary
        expect(floorToBucketUtc('2026-01-08T19:00:00.000Z', bucketMinutes).toISOString())
            .toBe('2026-01-08T19:00:00.000Z');

        // Just after
        expect(floorToBucketUtc('2026-01-08T19:00:00.001Z', bucketMinutes).toISOString())
            .toBe('2026-01-08T19:00:00.000Z');

        // Just before next bucket
        expect(floorToBucketUtc('2026-01-08T19:59:59.999Z', bucketMinutes).toISOString())
            .toBe('2026-01-08T19:00:00.000Z');
    });

    it('floors timestamps correctly (custom bucket)', () => {
        const bucketMinutes = 15;
        expect(floorToBucketUtc('2026-01-08T19:14:59.999Z', bucketMinutes).toISOString())
            .toBe('2026-01-08T19:00:00.000Z');
        expect(floorToBucketUtc('2026-01-08T19:15:00.000Z', bucketMinutes).toISOString())
            .toBe('2026-01-08T19:15:00.000Z');
    });

    it('hash stability check: observedAtRaw affects identity', () => {
        const base = {
            type: 'observation',
            source: 'test',
            observedAtBucket: '2026-01-08T19:00:00.000Z',
            bucketMinutes: 60,
            stationSetId: 'abc',
            variables: ['v'],
            data: {}
        };

        const obj1 = { ...base, observedAtRaw: '2026-01-08T19:05:00.000Z' };
        const obj2 = { ...base, observedAtRaw: '2026-01-08T19:10:00.000Z' };

        // Different raw times = different identity (provenance matters)
        expect(hashHex(canonicalMsgPack(obj1))).not.toBe(hashHex(canonicalMsgPack(obj2)));
    });

});
