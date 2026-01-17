import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphsPanel } from './GraphsPanel';
import { WEATHER_MODELS, fetchObservedHourlyFromApi } from '@/lib/weatherApi';

vi.mock('@/lib/weatherApi', async () => {
    const actual = await vi.importActual<any>('@/lib/weatherApi');
    return {
        ...actual,
        fetchObservedHourlyFromApi: vi.fn().mockResolvedValue(null)
    };
});

// Mock dependencies
vi.mock('@/hooks/useMediaQuery', () => ({
    useIsMobile: () => false
}));

global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
}));

const fetchObservationsForRange = vi.fn();
vi.mock('@/lib/observations/observations', () => ({
    fetchObservationsForRange: (...args: any[]) => fetchObservationsForRange(...args)
}));

// Mock simple Obs return shape (Normalized for component usage)
// The component calls fetchObservationsForRange and gets { series: { buckets, tempC... } }
// So mock needs to return that structure.

describe('GraphsPanel Temperature Strictness', () => {
    const getKey = (offsetHours: number) => {
        const d = new Date();
        d.setHours(d.getHours() + offsetHours);
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
            weatherCode: 0,
            epoch: new Date(getKey(i - 24)).getTime()
        })),
        daily: [],
        runAvailabilityTime: Date.now() / 1000,
        status: 'ok' as const,
        reason: undefined
    }));

    beforeEach(() => {
        vi.clearAllMocks();
    });

    async function switchToTableView() {
        const tableToggle = screen.getByLabelText('Table view');
        fireEvent.click(tableToggle);
    }

    it('does NOT show Observed column when NONE/LOADING (Strict Gating)', async () => {
        const nowMs = Date.now();
        // Return null -> NONE state
        fetchObservationsForRange.mockResolvedValue(null);

        render(
            <GraphsPanel
                forecasts={mockForecasts as any}
                location={{ latitude: 45, longitude: -75 }}
                timezone="America/Toronto"
                lastUpdated={new Date(nowMs)}
            />
        );

        // Switch to Table
        await switchToTableView();

        // Check headers
        expect(screen.getByText('Time')).toBeTruthy();
        // "Observed" should NOT be present
        expect(screen.queryByText('Observed')).toBeNull();
    });

    it('shows Observed column when VAULT and data exists', async () => {
        const nowMs = Date.now();
        // Use logic aligned with forecast generation
        // Index 0 is -24 hours approx. Definitely completed.
        const targetSlot = mockForecasts[0].hourly[0];
        const t = targetSlot.epoch;

        // Return valid vault data
        fetchObservationsForRange.mockResolvedValue({
            trust: { mode: 'trusted' },
            series: {
                buckets: [t], // 1 bucket
                tempC: [15.5],
                precipMm: [0],
                windKph: [null],
                windGustKph: [null],
                windDirDeg: [null],
                conditionCode: [null]
            }
        });

        render(
            <GraphsPanel
                forecasts={mockForecasts as any}
                location={{ latitude: 45, longitude: -75 }}
                timezone="America/Toronto"
                lastUpdated={new Date(nowMs)}
            />
        );

        // Wait for load
        await screen.findByText(/Observed source: VAULT/i);

        // Switch to Table
        await switchToTableView();

        // "Observed" header MUST be present because we have data
        expect(screen.getByText('Observed')).toBeTruthy();

        // And value 15.5 should be visible
        // formatTemp uses " C" suffix
        expect(screen.getByText('15.5 C')).toBeTruthy();
    });

    it('does NOT show Observed column if data exists but is pending (future/incomplete)', async () => {
        const nowMs = Date.now();
        // Use logic aligned with forecast generation
        // Index 26 is +2 hours approx (Future)
        const targetSlot = mockForecasts[0].hourly[26];
        const t = targetSlot.epoch;

        // Return valid vault data but for future (should be filtered out by isBucketCompleted)
        fetchObservationsForRange.mockResolvedValue({
            trust: { mode: 'trusted' },
            series: {
                buckets: [t],
                tempC: [15.5],
                precipMm: [0],
                windKph: [null],
                windGustKph: [null],
                windDirDeg: [null],
                conditionCode: [null]
            }
        });

        render(
            <GraphsPanel
                forecasts={mockForecasts as any}
                location={{ latitude: 45, longitude: -75 }}
                timezone="America/Toronto"
                lastUpdated={new Date(nowMs)}
            />
        );

        // Wait for load
        await screen.findByText(/Observed source: VAULT/i);

        await switchToTableView();

        // "Observed" header should be MISSING because the map should be empty after filtering
        expect(screen.queryByText('Observed')).toBeNull();
    });

    it('shows Observed column when Vault is empty but API observations exist', async () => {
        const nowMs = Date.now();
        fetchObservationsForRange.mockResolvedValue(null);

        const targetSlot = mockForecasts[0].hourly[0];
        const timeKey = targetSlot.time;

        (fetchObservedHourlyFromApi as any).mockResolvedValue({
            hourly: [
                {
                    time: timeKey,
                    epoch: targetSlot.epoch,
                    temperature: 14.2,
                    precipitation: 0,
                    windSpeed: 5,
                    windDirection: 180,
                    windGusts: 10
                }
            ],
            fetchedAt: new Date(nowMs)
        });

        render(
            <GraphsPanel
                forecasts={mockForecasts as any}
                location={{ latitude: 45, longitude: -75, timezone: 'America/Toronto' } as any}
                timezone="America/Toronto"
                lastUpdated={new Date(nowMs)}
            />
        );

        await screen.findByText(/Observed source: API/i);

        // Switch to Table
        await switchToTableView();

        expect(screen.getByText('Observed')).toBeTruthy();
        expect(screen.getByText('14.2 C')).toBeTruthy();
    });
});
