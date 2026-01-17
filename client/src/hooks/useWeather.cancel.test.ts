import { renderHook, act } from '@testing-library/react';
import { useWeather } from './useWeather';
import { triggerIngest } from '@/lib/weatherApi';
import { setPrimaryLocation } from '@/lib/locationStore';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { SyncEngine } from '@/lib/vault/sync';

// Mock dependencies
vi.mock('@/lib/weatherApi', async () => {
    const actual = await vi.importActual('@/lib/weatherApi');
    return {
        ...actual,
        triggerIngest: vi.fn().mockResolvedValue(undefined),
        fetchForecastsWithMetadata: vi.fn().mockResolvedValue({
            forecasts: [],
            pending: [],
            refreshSummary: {},
            completeness: {}
        }),
        getCachedForecasts: vi.fn().mockReturnValue([]),
        fetchObservedHourly: vi.fn().mockResolvedValue(null)
    };
});

vi.mock('@/lib/locationStore', async () => {
    const actual = await vi.importActual('@/lib/locationStore');
    return {
        ...actual,
        setPrimaryLocation: vi.fn(),
        getPrimaryLocation: vi.fn().mockReturnValue(null), // Start with null
        subscribeToLocationChanges: vi.fn(() => () => { }),
        getLocationSnapshot: vi.fn().mockReturnValue({
            activeLocation: null,
            primaryLocation: null,
            isViewingPrimary: false
        })
    };
});

// Mock SyncEngine implementation
const mockSync = vi.fn().mockImplementation(async (onProgress, options) => {
    // Simulate async work
    const signal = options?.signal;
    if (signal?.aborted) throw new Error('Aborted');
    await new Promise(resolve => setTimeout(resolve, 10)); // Allow other ops to interleave
    if (signal?.aborted) throw new Error('Aborted');
    return { blobsDownloaded: 1, bytesDownloaded: 100 };
});

const mockAbort = vi.fn();

vi.mock('@/lib/vault/sync', () => {
    return {
        SyncEngine: vi.fn().mockImplementation(() => ({
            sync: mockSync,
            abort: mockAbort // Legacy, though unnecessary with signal
        })),
        getSyncEngine: vi.fn().mockReturnValue({
            sync: vi.fn().mockResolvedValue({}),
            abort: vi.fn()
        })
    };
});

describe('useWeather hook - Cancellation & Sequencing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should abort previous backfill when setPrimaryLocation is called twice', async () => {
        const locA = { name: 'A', latitude: 10, longitude: 10, timezone: 'UTC' };
        const locB = { name: 'B', latitude: 20, longitude: 20, timezone: 'UTC' };

        const { result } = renderHook(() => useWeather());

        // 1. Trigger first location set
        await act(async () => {
            // We don't await the result of setPrimaryLocation inside hook immediately 
            // to simulate rapid fire, but since it's async we need to be careful.
            // Actually useWeather.setPrimaryLocation is declared async in our impl.
            // We call it without awaiting to fire it off, then call the second one.
            result.current.setPrimaryLocation(locA);
        });

        // 2. Immediately trigger second location set
        await act(async () => {
            result.current.setPrimaryLocation(locB);
        });

        // 3. Wait for all promises to settle
        await new Promise(resolve => setTimeout(resolve, 100));

        // EXPECTATIONS:

        // triggerIngest called for both
        expect(triggerIngest).toHaveBeenCalledWith(locA);
        expect(triggerIngest).toHaveBeenCalledWith(locB);

        // Filter for backfill calls (syncDays: 365)
        // Background sync calls (syncDays: undefined/default) are ignored
        const backfillCalls = mockSync.mock.calls.filter((args: any) => args[1]?.syncDays === 365);

        // We expect ONE backfill for A (aborted) and ONE backfill for B
        expect(backfillCalls.length).toBe(2);

        // The first backfill call should have been aborted
        const firstCallConfig = backfillCalls[0][1];
        expect(firstCallConfig.signal.aborted).toBe(true);

        // The second backfill call should NOT be aborted
        const secondCallConfig = backfillCalls[1][1];
        expect(secondCallConfig.signal.aborted).toBe(false);
    });
});
