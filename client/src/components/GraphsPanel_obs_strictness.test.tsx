
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphsPanel } from './GraphsPanel';
import { WEATHER_MODELS } from '@/lib/weatherApi';

// Mock dependencies
vi.mock('@/hooks/useMediaQuery', () => ({
    useIsMobile: () => false
}));

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
}));

const fetchObservationsForRange = vi.fn();
vi.mock('@/lib/observations/observations', () => ({
    fetchObservationsForRange: (...args: any[]) => fetchObservationsForRange(...args)
}));

describe('GraphsPanel Strict Observed Rendering', () => {
    const nowKey = new Date().toISOString().slice(0, 16);
    const getKey = (offsetHours: number) => {
        const d = new Date();
        d.setHours(d.getHours() + offsetHours);
        // Round to nearest hour for stable keys
        d.setMinutes(0, 0, 0);
        return d.toISOString().slice(0, 16);
    };

    const mockForecasts = WEATHER_MODELS.map(m => ({
        model: m,
        hourly: Array(48).fill(null).map((_, i) => ({
            time: getKey(i - 24),
            temperature: 20,
            precipitation: 0,
            precipitationProbability: 0,
            weatherCode: 0
        })),
        daily: [],
        runAvailabilityTime: Date.now() / 1000,
    }));

    // Reset mocks
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders LOADING state correctly', async () => {
        // Pending promise = LOADING
        fetchObservationsForRange.mockImplementation(() => new Promise(() => { }));

        render(
            <GraphsPanel
                forecasts={mockForecasts as any}
                location={{ latitude: 45, longitude: -75 }}
                timezone="America/Toronto"
            />
        );

        // Assert Debug Badge: LOADING (Blue)
        const debugBadge = await screen.findByText(/Observed source: LOADING/i);
        expect(debugBadge).toBeTruthy();
        expect(debugBadge.className).toContain('text-blue-300');

        // Assert 0 buckets
        expect(screen.getByText(/loaded buckets: 0/i)).toBeTruthy();

        // Assert cells are empty/disabled
        // We need to wait for rows to render. Usually "Observed" row is always present.
        const observedRow = await screen.findByText('Observed');
        expect(observedRow).toBeTruthy();

        // Query strict cell testId
        // Since no epoch is known/derived easily without exact window logic matching,
        // we can query by generic class or standard DOM if testId is missing?
        // Actually, we pass testId now. Let's find any observed-cell-*
        // But if isObserved is false, testId is undefined.
        // Wait, 'isObserved' boolean in component is strictly row type.
        // But testId assignment: `testId={isObserved ? ... : undefined}`
        // So they SHOULD exist if row type is observed.
        // BUT `canRender` gating might affect content or class.
        // If !canRender, intensity is null.
        // PrecipCell renders svg.
        // Inspect emptiness by ensuring no "url(#pattern...)" or POP arcs.
        const cells = document.querySelectorAll('[data-testid^="observed-cell-"]');
        expect(cells.length).toBeGreaterThan(0); // Rows exist
        // Check content of first cell
        const firstCell = cells[0];
        expect(firstCell.innerHTML).not.toContain('url(#'); // No pattern
        expect(firstCell.innerHTML).not.toContain('rotate('); // No POP arc
    });

    it('renders NONE state correctly (null result)', async () => {
        fetchObservationsForRange.mockResolvedValue(null);

        render(
            <GraphsPanel
                forecasts={mockForecasts as any}
                location={{ latitude: 45, longitude: -75 }}
                timezone="America/Toronto"
            />
        );

        // Assert Debug Badge: NONE (Yellow)
        const debugBadge = await screen.findByText(/Observed source: NONE/i);
        expect(debugBadge).toBeTruthy();
        expect(debugBadge.className).toContain('text-yellow-300');

        expect(screen.getByText(/loaded buckets: 0/i)).toBeTruthy();

        // Check cells empty
        const cells = document.querySelectorAll('[data-testid^="observed-cell-"]');
        expect(cells.length).toBeGreaterThan(0);
        const firstCell = cells[0];
        expect(firstCell.innerHTML).not.toContain('url(#');
    });

    it('renders VAULT state correctly (valid result)', async () => {
        // Create 1 valid bucket relative to now
        const nowMs = Date.now();
        // Completed bucket = past. 2 hours ago.
        const t = nowMs - 2 * 3600 * 1000;
        const bucketKey = new Date(t).toISOString().slice(0, 13) + ':00'; // YYYY-MM-DDTHH:00

        fetchObservationsForRange.mockResolvedValue([
            {
                time: bucketKey,
                epoch: t, // Ensure epoch matches
                precipitation: 5.0, // Significant precip
                weatherCode: 63, // Rain
                temperature: 10,
                windSpeed: 10,
                windDirection: 180
            }
        ]);

        render(
            <GraphsPanel
                forecasts={mockForecasts as any}
                location={{ latitude: 45, longitude: -75 }}
                timezone="America/Toronto"
                lastUpdated={new Date(nowMs)} // Pass now to force completion check consistency
            />
        );

        // Assert Debug Badge: VAULT (Green)
        const debugBadge = await screen.findByText(/Observed source: VAULT/i);
        expect(debugBadge).toBeTruthy();
        expect(debugBadge.className).toContain('text-emerald-300');

        expect(screen.getByText(/loaded buckets: 1/i)).toBeTruthy();

        // Check specifically the populated cell
        const cell = screen.getByTestId(`observed-cell-${t}`);
        expect(cell).toBeTruthy();
        // Should have content (pattern or value)
        // PrecipCell with intensity 5 -> pattern
        const hasPattern = cell.innerHTML.includes('url(#');
        expect(hasPattern).toBe(true);
    });

    it('renders NONE even if request fails (ERROR state)', async () => {
        fetchObservationsForRange.mockRejectedValue(new Error('Network fail'));

        render(
            <GraphsPanel
                forecasts={mockForecasts as any}
                location={{ latitude: 45, longitude: -75 }}
                timezone="America/Toronto"
            />
        );

        // Assert Debug Badge: ERROR (Red)
        const debugBadge = await screen.findByText(/Observed source: ERROR/i);
        expect(debugBadge).toBeTruthy();
        expect(debugBadge.className).toContain('text-red-300');

        // Cells empty
        const cells = document.querySelectorAll('[data-testid^="observed-cell-"]');
        expect(cells.length).toBeGreaterThan(0);
        expect(cells[0].innerHTML).not.toContain('url(#');
    });
});

