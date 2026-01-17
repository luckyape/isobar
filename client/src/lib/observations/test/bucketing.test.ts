import { describe, it, expect } from 'vitest';
import { bucketMs, bucketEndMs, isBucketCompleted } from '../bucketing';

describe('bucketing', () => {
    const HOUR_MS = 3600 * 1000;

    describe('bucketMs', () => {
        it('aligns timestamps to the hour (default)', () => {
            // 10:05 -> 10:00
            const ts = new Date('2024-01-01T10:05:00Z').getTime();
            const expected = new Date('2024-01-01T10:00:00Z').getTime();
            expect(bucketMs(ts)).toBe(expected);
        });

        it('floors random seconds/milliseconds to start of hour', () => {
            // 10:05:59.999 -> 10:00:00.000
            const ts = new Date('2024-01-01T10:05:59.999Z').getTime();
            const expected = new Date('2024-01-01T10:00:00Z').getTime();
            expect(bucketMs(ts)).toBe(expected);
        });

        it('aligns exact hour to itself', () => {
            const ts = new Date('2024-01-01T10:00:00Z').getTime();
            expect(bucketMs(ts)).toBe(ts);
        });

        it('handles different bucket sizes', () => {
            // 10:35, 30 min buckets -> 10:30
            const ts = new Date('2024-01-01T10:35:00Z').getTime();
            const expected = new Date('2024-01-01T10:30:00Z').getTime();
            expect(bucketMs(ts, 30)).toBe(expected);
        });
    });

    describe('isBucketCompleted', () => {
        it('returns true if bucket end is <= now', () => {
            const bucketStart = new Date('2024-01-01T10:00:00Z').getTime(); // End is 11:00

            // Now is 11:00 -> TRUE (just finished)
            expect(isBucketCompleted(bucketStart, 60, bucketStart + HOUR_MS)).toBe(true);

            // Now is 11:01 -> TRUE
            expect(isBucketCompleted(bucketStart, 60, bucketStart + HOUR_MS + 1)).toBe(true);
        });

        it('returns false if bucket end is > now', () => {
            const bucketStart = new Date('2024-01-01T10:00:00Z').getTime(); // End is 11:00

            // Now is 10:59 -> FALSE
            expect(isBucketCompleted(bucketStart, 60, bucketStart + HOUR_MS - 1000)).toBe(false);
        });
    });
});
