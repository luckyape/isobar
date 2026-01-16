import { renderHook, act } from '@testing-library/react';
import { useWeather } from './useWeather';
import { triggerIngest } from '@/lib/weatherApi';
import { setPrimaryLocation, getPrimaryLocation } from '@/lib/locationStore';
import { vi, describe, it, expect, beforeEach } from 'vitest';

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
        getPrimaryLocation: vi.fn(),
        subscribeToLocationChanges: vi.fn(() => () => { }), // No-op subscription
        getLocationSnapshot: vi.fn().mockReturnValue({
            activeLocation: null,
            primaryLocation: null,
            isViewingPrimary: false
        })
    };
});

// Mock SyncEngine to avoid network calls
vi.mock('@/lib/vault/sync', () => {
    return {
        SyncEngine: class {
            sync = vi.fn().mockResolvedValue({ blobsDownloaded: 0, bytesDownloaded: 0 });
            abort = vi.fn();
        },
        getSyncEngine: vi.fn().mockReturnValue({
            sync: vi.fn().mockResolvedValue({}),
            abort: vi.fn()
        })
    };
});

describe('useWeather hook - Ingestion Trigger', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should trigger ingestion when setting primary location to Calgary', async () => {
        const calgary = {
            name: 'Calgary',
            latitude: 51.0447,
            longitude: -114.0719,
            timezone: 'America/Edmonton'
        };

        const { result } = renderHook(() => useWeather());

        await act(async () => {
            result.current.setPrimaryLocation(calgary);
        });

        // Verify triggerIngest was called with Calgary's details
        expect(triggerIngest).toHaveBeenCalledTimes(1);
        expect(triggerIngest).toHaveBeenCalledWith(calgary);

        // Also verify location store was updated
        expect(setPrimaryLocation).toHaveBeenCalledWith(calgary);
    });
});
