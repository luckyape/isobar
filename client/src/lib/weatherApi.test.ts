import { describe, it, expect, vi } from 'vitest';
import {
    computePendingRetryAt,
    decideForecastFetch,
    normalizeWeatherCode
} from './weatherApi';

describe('weatherApi', () => {
    describe('normalization', () => {
        it('should normalize weather codes correctly', () => {
            expect(normalizeWeatherCode(0)).toBe(0); // Clear
            expect(normalizeWeatherCode(1)).toBe(1); // Mostly clear
            expect(normalizeWeatherCode(48)).toBe(45); // Deprecated fog -> fog
            expect(normalizeWeatherCode(51)).toBe(61); // Drizzle -> rain
            expect(normalizeWeatherCode(71)).toBe(71); // Snow
        });
    });

    describe('fetch gating', () => {
        it('should compute retry time with jitter', () => {
            const now = 1700000000000;
            const availabilityTime = 1700000000;
            const delayMinutes = 10;

            const { pendingUntil, retryAt } = computePendingRetryAt(availabilityTime, delayMinutes, now);

            expect(pendingUntil).toBe(availabilityTime * 1000 + delayMinutes * 60 * 1000);
            expect(retryAt).toBeGreaterThanOrEqual(pendingUntil);
            expect(retryAt).toBeLessThanOrEqual(pendingUntil + 60000);
        });

        it('should action fetch when force is true', () => {
            const result = decideForecastFetch({
                metadata: null,
                cachedForecast: null,
                force: true,
                nowMs: Date.now(),
                delayMinutes: 10,
                metadataFallbackTtlHours: 6
            });
            expect(result.action).toBe('fetch');
        });

        it('should action pending when data is new but too recent', () => {
            const now = 1000000000000;
            const availabilityTime = 1000000000; // 1000000000 * 1000 = now
            const result = decideForecastFetch({
                metadata: { runAvailabilityTime: availabilityTime } as any,
                cachedForecast: {
                    lastSeenRunAvailabilityTime: availabilityTime - 3600,
                    fetchedAt: new Date(now - 3600000),
                    hourly: [{}, {}]
                } as any,
                nowMs: now,
                delayMinutes: 10,
                metadataFallbackTtlHours: 6
            });
            expect(result.action).toBe('pending');
        });

        it('should action skip when data matches cached run', () => {
            const now = 1000000000000;
            const availabilityTime = 1000000000;
            const result = decideForecastFetch({
                metadata: { runAvailabilityTime: availabilityTime } as any,
                cachedForecast: {
                    lastSeenRunAvailabilityTime: availabilityTime,
                    fetchedAt: new Date(now - 1800000),
                    hourly: [{}, {}]
                } as any,
                nowMs: now,
                delayMinutes: 10,
                metadataFallbackTtlHours: 6
            });
            expect(result.action).toBe('skip');
        });
    });
});
