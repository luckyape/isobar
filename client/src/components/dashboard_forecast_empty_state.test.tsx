
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import Home from '../pages/Home';
import { useWeather } from '../hooks/useWeather';
import { ModelForecast } from '../lib/weatherApi';

// Mock dependencies
vi.mock('../hooks/useWeather');
vi.mock('../lib/weatherApi', async () => {
    const actual = await vi.importActual('../lib/weatherApi');
    return {
        ...actual,
        CANADIAN_CITIES: [{ name: 'Test City', latitude: 45, longitude: -75, timezone: 'America/Toronto' }]
    };
});

// Mock child components to simplify tree
vi.mock('../components/GraphsPanel', () => ({
    GraphsPanel: () => <div data-testid="graphs-panel">GraphsPanel Stub</div>
}));
// Helper components
vi.mock('../components/IndividualModelForecasts', () => ({
    IndividualModelForecasts: () => <div data-testid="individual-model-forecasts">IndividualModelForecasts Stub</div>
}));
vi.mock('../components/ModelBadgeIcon', () => ({
    ModelBadgeIcon: () => <div data-testid="model-badge">Icon</div>
}));
vi.mock('../components/Header', () => ({
    Header: ({ isLoading }: { isLoading: boolean }) => <div data-testid="header">{isLoading ? 'Loading...' : 'Header'}</div>
}));
vi.mock('../components/ModelForecastDetailPanel', () => ({
    ModelForecastDetailPanel: () => <div data-testid="model-forecast-detail-panel">ModelForecastDetailPanel</div>
}));
vi.mock('../components/CategoryDetailPanel', () => ({
    CategoryDetailPanel: () => <div data-testid="category-detail-panel">CategoryDetailPanel</div>
}));
vi.mock('../components/DailyForecast', () => ({
    DailyForecast: () => <div data-testid="daily-forecast">DailyForecast</div>
}));
vi.mock('../components/DualRingGauge', () => ({
    DualRingGauge: () => <div data-testid="dual-ring-gauge">DualRingGauge</div>
}));
vi.mock('../components/WeatherConfidenceCard', () => ({
    WeatherConfidenceCard: () => <div data-testid="weather-confidence-card">WeatherConfidenceCard</div>
}));

describe('Dashboard Forecast Empty States', () => {
    const mockUseWeather = useWeather as unknown as ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();

        // Mock matchMedia
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
    });

    it('Scenario 1: Loading State', () => {
        mockUseWeather.mockReturnValue({
            location: { name: 'Test City' },
            forecasts: [],
            consensus: null,
            isLoading: true,
            error: null,
            isOffline: false,
            setLocation: vi.fn(),
            refresh: vi.fn()
        });

        render(<Home />);

        expect(screen.getByText(/Fetching forecasts from multiple models/i)).toBeTruthy();
        expect(screen.queryByTestId('graphs-panel')).toBeNull();
        expect(screen.queryByText(/Forecast Unavailable/i)).toBeNull();
    });

    it('Scenario 2: Zero Usable Models (Empty State) - Case A', () => {
        // Return empty forecasts array (simulating all failed/filtered or just empty)
        mockUseWeather.mockReturnValue({
            location: { name: 'Test City' },
            forecasts: [],
            consensus: null, // Consensus is null when no models
            isLoading: false,
            error: null, // No global error, just no data
            isOffline: false,
            setLocation: vi.fn(),
            refresh: vi.fn()
        });

        render(<Home />);

        // CHECK: "Forecast Unavailable" is visible
        expect(screen.getByText(/Forecast Unavailable/i)).toBeTruthy();
        expect(screen.getByText(/No weather models returned valid data/i)).toBeTruthy();

        // CHECK: “48-Hour Temperature Forecast” (GraphsPanel) not in document
        expect(screen.queryByTestId('graphs-panel')).toBeNull();

        // CHECK: “Individual Model Forecasts” not in document
        expect(screen.queryByTestId('individual-model-forecasts')).toBeNull();
        expect(screen.queryByText('Individual Model Forecasts')).toBeNull();

        // CHECK: Loading is GONE
        expect(screen.queryByText(/Fetching forecasts/i)).toBeNull();
    });

    it('Scenario 3: Zero Usable Models with Error (Error State)', () => {
        // Global error takes precedence if no consensus
        mockUseWeather.mockReturnValue({
            location: { name: 'Test City' },
            forecasts: [],
            consensus: null,
            isLoading: false,
            error: "Network Error", // Explicit global error
            isOffline: false,
            setLocation: vi.fn(),
            refresh: vi.fn()
        });

        render(<Home />);

        expect(screen.getByText("Network Error")).toBeTruthy();
        expect(screen.queryByText(/Forecast Unavailable/i)).toBeNull();
        expect(screen.queryByTestId('graphs-panel')).toBeNull();
    });

    it('Scenario 4: One OK Model (Partial Success) - Case B', () => {
        const okModelData: ModelForecast = {
            model: { id: 'gfs', name: 'GFS', color: 'blue', endpoint: '', provider: '', country: '', max_forecast_days: 7, resolution_km: 10 },
            hourly: [{ time: '2025-01-01T00:00', epoch: 1000, temperature: 20, precipitation: 0, precipitationProbability: 0, windSpeed: 10, windDirection: 180, windGusts: 20, cloudCover: 0, humidity: 50, pressure: 1000, weatherCode: 1 }],
            daily: [] as any,
            fetchedAt: new Date(),
            status: 'ok' // Normalized status
        } as any;

        // Mock consensus object (usually derived from forecasts)
        const mockConsensus = {
            modelCount: 1,
            successfulModels: ['GFS'],
            failedModels: [],
            hourly: [],
            daily: [],
            freshness: {},
            temperature: { mean: 20, agreement: 1 },
            weatherCode: { dominant: 1, agreement: 1 },
            precipitationCombined: { agreement: 1 }
        };

        mockUseWeather.mockReturnValue({
            location: { name: 'Test City' },
            // Note: Home.tsx recalculates okForecasts based on checks, so we must provide valid hourly array
            forecasts: [okModelData],
            consensus: mockConsensus as any,
            isLoading: false,
            error: null,
            isOffline: false,
            setLocation: vi.fn(),
            refresh: vi.fn()
        });

        render(<Home />);

        // CHECK: GraphsPanel is present
        expect(screen.getByTestId('graphs-panel')).toBeTruthy();

        // CHECK: IndividualModelForecasts is present
        expect(screen.getByTestId('individual-model-forecasts')).toBeTruthy();

        // Should NOT show empty states
        expect(screen.queryByText(/Forecast Unavailable/i)).toBeNull();
        expect(screen.queryByText(/Fetching forecasts/i)).toBeNull();

        // Should show model count (from Home.tsx computed from okForecasts)
        expect(screen.getByText(/Based on 1 weather models/i)).toBeTruthy();
    });
});
