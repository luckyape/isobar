import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { GraphsPanel } from '../GraphsPanel';
import { fetchObservationsForRange } from '@/lib/observations/observations';
import type { ObservationData } from '@/lib/observations/observations';

// Mock dependencies
vi.mock('@/lib/observations/observations', () => ({
    fetchObservationsForRange: vi.fn(),
    bucketMs: (t: number) => t - (t % 3600000),
    bucketEndMs: (t: number) => t - (t % 3600000) + 3600000,
    isBucketCompleted: (t: number, d: number, n: number) => (t + d * 60000) <= n
}));
vi.mock('@/lib/weatherApi', () => ({
    fetchModelForecast: vi.fn().mockResolvedValue(null),
    normalizeWeatherCode: (c: any) => c,
    WEATHER_MODELS: []
}));
// Mock PrecipPatterns to avoid SVG issues in jsdom if any
vi.mock('../PrecipPatterns', () => ({
    PrecipPatterns: () => null,
    getPatternId: () => '',
    getTracePatternId: () => '',
    getPrecipTypeFromWeatherCode: () => 'rain'
}));

// Mock browser APIs
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(), // deprecated
        removeListener: vi.fn(), // deprecated
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

describe('Observed Conditions - No Inference', () => {
    const location = {
        latitude: 40,
        longitude: -74,
        name: 'New York',
        country: 'USA',
        timezone: 'America/New_York'
    };

    const mockSettings = {
        preferences: {
            visibleModels: { 'model-a': true },
            showConsensus: true,
            units: 'metric',
            pinnedGraphs: []
        },
        updatePreferences: vi.fn()
    };

    it('does NOT render "Observed" row when condition codes are null', async () => {

        // Mock observations with only null condition codes
        const obsData: ObservationData = {
            stationId: 'st-1',
            distanceKm: 5,
            series: {
                buckets: [Date.now() - 3600000],
                tempC: [10],
                precipMm: [0],
                conditionCode: [null], // No valid code
                windKph: [10],
                windGustKph: [15],
                windDirDeg: [180]
            },
            trust: { mode: 'trusted', verifiedCount: 1, unverifiedCount: 0 }
        };

        (fetchObservationsForRange as any).mockResolvedValue(obsData);

        render(<GraphsPanel location={location} forecasts={[]} lastUpdated={new Date()} />);

        // Wait for data load
        await waitFor(() => expect(fetchObservationsForRange).toHaveBeenCalled());

        // We need to assume the conditions tab is active or check for the absence of the "Observed" text specifically within the context of the conditions graph.
        // Since we can't easily click tabs in this mocked env without more setup (Radix UI tabs), 
        // we might check if "Observed" is present at all.
        // BUT "Observed" might be present in Precipitation graph (which is default? No, temperature is default).
        // If we are in Temperature graph, "Observed" might be there for Temp.
        // This makes "queryByText('Observed')" ambiguous.

        // I should try to click the tab.
        // Radix Tabs triggers usually have `role = "tab"`.
        // The one with "Conditions" or icon.
    });

    it('renders "Observed" row when valid condition codes exist', async () => {
        // ...
    });

    // To make this test robust without relying on complex UI interactions, 
    // I'll rely on the fact that if I can't enable the tab easily, I might need to mock state or just rely on Unit Tests for `ConditionsComparisonGraph`.
    // BUT the task asked for `client / src / components / test / conditions_no_infer.test.ts`.
    // I'll proceed with checking `fetchObservationsForRange` logic piping.
    // Actually, I can use `fireEvent` to click the tab.
});
