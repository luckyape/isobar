
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { GraphsPanel } from '../GraphsPanel';
import { fetchObservationsForRange } from '@/lib/observations/observations';
import { isBucketedAccumulation } from '@/lib/observations/vars';
import type { ObservationData } from '@/lib/observations/observations';

// Mock dependencies
vi.mock('@/lib/observations/observations', () => ({
    fetchObservationsForRange: vi.fn(),
    bucketMs: (t: number) => t - (t % 3600000),
    bucketEndMs: (t: number) => t - (t % 3600000) + 3600000,
    isBucketCompleted: vi.fn().mockImplementation((bucketStart, duration, now) => {
        return (bucketStart + duration * 60000) <= now;
    })
}));

vi.mock('@/lib/observations/bucketing', () => ({
    bucketMs: (t: number) => t - (t % 3600000),
    bucketEndMs: (t: number) => t - (t % 3600000) + 3600000,
    isBucketCompleted: vi.fn().mockImplementation((bucketStart, now) => {
        return (bucketStart + 3600000) <= now;
    })
}));

vi.mock('@/lib/observations/vars', () => ({
    isBucketedAccumulation: vi.fn().mockReturnValue(true)
}));

vi.mock('@/lib/weatherApi', () => ({
    fetchModelForecast: vi.fn().mockResolvedValue(null),
    normalizeWeatherCode: (c: any) => c,
    WEATHER_MODELS: []
}));

vi.mock('../PrecipPatterns', () => ({
    PrecipPatterns: () => null,
    getPatternId: () => 'pattern-id',
    getTracePatternId: () => 'trace-id',
    getPrecipTypeFromWeatherCode: () => 'rain'
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

describe('Observed Row Unavailability Messaging', () => {
    const location = {
        latitude: 40,
        longitude: -74,
        name: 'New York',
        country: 'USA',
        timezone: 'America/New_York'
    };

    const NOW = 1704110400000; // 2024-01-01T12:00:00Z

    it('shows explanatory reason when observed data fetch returns null', async () => {
        (isBucketedAccumulation as any).mockReturnValue(true);
        (fetchObservationsForRange as any).mockResolvedValue(null); // No data
        vi.setSystemTime(NOW);

        render(<GraphsPanel location={location} forecasts={[]} lastUpdated={new Date(NOW)} />);

        await waitFor(() => expect(fetchObservationsForRange).toHaveBeenCalled());

        // Should show "Observed" row with reason, not generic "Unavailable"
        // The reason should be one of the graph-specific reasons like "No data"
        const observedLabels = screen.getAllByText(/Observed/i);
        expect(observedLabels.length).toBeGreaterThan(0);

        // Look for the specific unavailability reason - should contain one of our reasons
        // "No data", "Not synced", "Fetch failed", "Location required"
        const textContent = document.body.textContent || '';
        expect(textContent).toMatch(/No data|Not synced|Fetch failed|Location required/);
    });

    it('does not show generic "Unavailable" text', async () => {
        (isBucketedAccumulation as any).mockReturnValue(true);
        (fetchObservationsForRange as any).mockResolvedValue(null);
        vi.setSystemTime(NOW);

        render(<GraphsPanel location={location} forecasts={[]} lastUpdated={new Date(NOW)} />);

        await waitFor(() => expect(fetchObservationsForRange).toHaveBeenCalled());

        // The old generic "Unavailable" text should NOT appear
        // Instead we should have specific reasons
        expect(screen.queryAllByText('Unavailable')).toHaveLength(0);
    });
});
