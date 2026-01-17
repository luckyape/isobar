import { describe, it, expect } from 'vitest';
import { calculateConsensus } from './consensus';
import { WEATHER_MODELS } from './weatherApi';

describe('consensus calculation', () => {
    const baseEpochMs = Date.UTC(2024, 4, 20, 0, 0, 0);

    const mockHourly = (epochMs: number, temp: number) => ({
        time: new Date(epochMs).toISOString().slice(0, 16),
        epoch: epochMs,
        temperature: temp,
        precipitation: 0,
        precipitationProbability: 0,
        windSpeed: 10,
        windDirection: 180,
        windGusts: 15,
        cloudCover: 50,
        humidity: 55,
        pressure: 1012,
        weatherCode: 1
    });

    const mockDaily = (epochMs: number, tempMax: number, tempMin: number) => ({
        date: new Date(epochMs).toISOString().slice(0, 10),
        temperatureMax: tempMax,
        temperatureMin: tempMin,
        precipitationSum: 0,
        precipitationProbabilityMax: 0,
        windSpeedMax: 15,
        windGustsMax: 25,
        weatherCode: 1,
        sunrise: new Date(epochMs + 6 * 3600_000).toISOString(),
        sunset: new Date(epochMs + 18 * 3600_000).toISOString()
    });

    const createMockForecast = (modelId: string, temp: number) => ({
        model: WEATHER_MODELS.find(m => m.id === modelId)!,
        status: 'ok' as const,
        hourly: Array.from({ length: 24 }, (_, i) => mockHourly(baseEpochMs + i * 3600_000, temp)),
        daily: Array.from({ length: 7 }, (_, i) => mockDaily(baseEpochMs + i * 24 * 3600_000, temp + 5, temp - 5)),
        fetchedAt: new Date(0)
    });

    it('should calculate high agreement when models are identical', () => {
        const forecasts = [
            createMockForecast('gem_seamless', 20),
            createMockForecast('gfs_seamless', 20),
        ];

        const result = calculateConsensus(forecasts as any);
        expect(result.isAvailable).toBe(true);
        expect(result.metrics.overall).toBe(100);
        expect(result.metrics.temperature).toBe(100);
    });

    it('should calculate moderate agreement when models diverge slightly', () => {
        const forecasts = [
            createMockForecast('gem_seamless', 20),
            createMockForecast('gfs_seamless', 22), // 2 degree spread
        ];

        const result = calculateConsensus(forecasts as any);
        expect(result.isAvailable).toBe(true);
        // Daily expected spread for temp is 8. Spread here is 2.
        // Score = 100 * (1 - 2/8) = 75
        expect(result.metrics.temperature).toBe(75);
    });

    it('should calculate low agreement when models diverge significantly', () => {
        const forecasts = [
            createMockForecast('gem_seamless', 20),
            createMockForecast('gfs_seamless', 30), // 10 degree spread (full expected spread)
        ];

        const result = calculateConsensus(forecasts as any);
        expect(result.isAvailable).toBe(true);
        expect(result.metrics.temperature).toBe(0);
    });

    it('should return unavailable if fewer than 2 successful models', () => {
        const forecasts = [
            createMockForecast('gem_seamless', 20),
            { ...createMockForecast('gfs_seamless', 20), status: 'error' as const, error: 'API Error', hourly: [], daily: [] },
        ];

        const result = calculateConsensus(forecasts as any);
        expect(result.isAvailable).toBe(false);
        expect(result.metrics.overall).toBe(0);
    });
});
