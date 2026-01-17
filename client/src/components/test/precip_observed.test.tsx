import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GraphsPanel } from '../GraphsPanel';
import { fetchObservationsForRange } from '@/lib/observations/observations';
import { isBucketedAccumulation } from '@/lib/observations/vars';
import type { ObservationData } from '@/lib/observations/observations';
import { WEATHER_MODELS, type ModelForecast } from '@/lib/weatherApi';

vi.mock('@/lib/weatherApi', async () => {
    const actual = await vi.importActual<any>('@/lib/weatherApi');
    return {
        ...actual,
        fetchObservedHourlyFromApi: vi.fn().mockResolvedValue(null)
    };
});

// Mock dependencies
vi.mock('@/lib/observations/observations', () => ({
    fetchObservationsForRange: vi.fn()
}));

vi.mock('@/lib/observations/vars', () => ({
    isBucketedAccumulation: vi.fn().mockReturnValue(true) // Default true
}));

vi.mock('@/hooks/useMediaQuery', () => ({
    useIsMobile: () => false
}));

// Mock browser APIs
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })),
});

class ResizeObserver {
    observe() { }
    unobserve() { }
    disconnect() { }
}
window.ResizeObserver = ResizeObserver;

describe('Precipitation Observed Overlay', () => {
    // Helper to make observation data
    const makeObs = (bucketMs: number, precipMm: number): ObservationData => ({
        stationId: 'st-1',
        distanceKm: 5,
        series: {
            buckets: [bucketMs],
            tempC: [10],
            precipMm: [precipMm],
            conditionCode: [63],
            windKph: [10],
            windGustKph: [15],
            windDirDeg: [180]
        },
        trust: { mode: 'trusted', verifiedCount: 1, unverifiedCount: 0 }
    });

    const buildForecasts = (nowHourMs: number): ModelForecast[] => {
        const startEpochMs = nowHourMs - 24 * 3600_000;
        const hourly = Array.from({ length: 49 }, (_, i) => {
            const epoch = startEpochMs + i * 3600_000;
            return {
                time: new Date(epoch).toISOString().slice(0, 16),
                epoch,
                temperature: 10,
                precipitation: 1,
                precipitationProbability: 0,
                windSpeed: 0,
                windDirection: 0,
                windGusts: 0,
                cloudCover: 0,
                humidity: 0,
                pressure: 0,
                weatherCode: 63
            };
        });

        return [
            {
                model: WEATHER_MODELS[0],
                status: 'ok',
                hourly,
                daily: [],
                fetchedAt: new Date(nowHourMs)
            }
        ] as ModelForecast[];
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    async function selectPrecipTab(): Promise<void> {
        const trigger = screen.getByLabelText('Precipitation graph');
        fireEvent.mouseDown(trigger);
        fireEvent.click(trigger);
        await waitFor(() => {
            const selected = screen.getByLabelText('Precipitation graph').getAttribute('aria-selected');
            expect(selected).toBe('true');
        });
    }

    it('renders observed precip pattern for completed buckets (bucketed accumulation)', async () => {
        (isBucketedAccumulation as any).mockReturnValue(true);

	        const nowMs = Date.now();
	        const nowHourMs = Math.floor(nowMs / 3600_000) * 3600_000;
	        const targetBucketMs = nowHourMs - 2 * 3600_000;
	        const targetBucketEndMs = targetBucketMs + 3600_000;
	        (fetchObservationsForRange as any).mockResolvedValue(makeObs(targetBucketMs, 2.5));

        render(
            <GraphsPanel
                location={{ latitude: 40, longitude: -74 }}
                forecasts={buildForecasts(nowHourMs)}
                timezone="UTC"
                isPrimary
            />
        );
        await waitFor(() => expect(fetchObservationsForRange).toHaveBeenCalled());
        await selectPrecipTab();

	        const cell = screen.getByTestId(`observed-cell-${targetBucketEndMs}`);
	        expect(cell.innerHTML).toContain('url(#');
    });

    it('does not render observed precip when variable is not bucketed accumulation', async () => {
        (isBucketedAccumulation as any).mockReturnValue(false);

	        const nowMs = Date.now();
	        const nowHourMs = Math.floor(nowMs / 3600_000) * 3600_000;
	        const targetBucketMs = nowHourMs - 2 * 3600_000;
	        const targetBucketEndMs = targetBucketMs + 3600_000;
	        (fetchObservationsForRange as any).mockResolvedValue(makeObs(targetBucketMs, 2.5));

        render(
            <GraphsPanel
                location={{ latitude: 40, longitude: -74 }}
                forecasts={buildForecasts(nowHourMs)}
                timezone="UTC"
                isPrimary
            />
        );

        await waitFor(() => expect(fetchObservationsForRange).toHaveBeenCalled());
        await selectPrecipTab();

	        const cell = screen.getByTestId(`observed-cell-${targetBucketEndMs}`);
	        expect(cell.innerHTML).not.toContain('url(#');
	        expect(isBucketedAccumulation).toHaveBeenCalledWith('p_mm');
    });

    it('does not render future buckets even if data is present', async () => {
        (isBucketedAccumulation as any).mockReturnValue(true);

	        const nowMs = Date.now();
	        const nowHourMs = Math.floor(nowMs / 3600_000) * 3600_000;
	        const futureBucketMs = nowHourMs + 1 * 3600_000;
	        const futureBucketEndMs = futureBucketMs + 3600_000;
	        (fetchObservationsForRange as any).mockResolvedValue(makeObs(futureBucketMs, 2.5));

        render(
            <GraphsPanel
                location={{ latitude: 40, longitude: -74 }}
                forecasts={buildForecasts(nowHourMs)}
                timezone="UTC"
                isPrimary
            />
        );

        await waitFor(() => expect(fetchObservationsForRange).toHaveBeenCalled());
        await selectPrecipTab();

	        const cell = screen.getByTestId(`observed-cell-${futureBucketEndMs}`);
	        expect(cell.innerHTML).not.toContain('url(#');
    });
});
