import { describe, it, expect } from 'vitest';
import { calculateConsensus } from './consensus';
import { WEATHER_MODELS } from './weatherApi';

describe('consensus calculation', () => {
    const mockHourly = (temp: number) => ({
        time: '2024-05-20T12:00',
        temperature: temp,
        precipitation: 0,
        precipitationProbability: 0,
        windSpeed: 10,
        windDirection: 180,
        weatherCode: 1,
        cloudCover: 50,
        isDay: 1,
    });

    const mockDaily = (tempMax: number, tempMin: number) => ({
        date: '2024-05-20',
        temperatureMax: tempMax,
        temperatureMin: tempMin,
        precipitationSum: 0,
        precipitationProbabilityMax: 0,
        windSpeedMax: 15,
        weatherCode: 1,
        sunrise: '2024-05-20T05:00',
        sunset: '2024-05-20T21:00',
    });

    const createMockForecast = (modelId: string, temp: number) => ({
        model: WEATHER_MODELS.find(m => m.id === modelId)!,
        hourly: Array(24).fill(null).map(() => mockHourly(temp)),
        daily: Array(7).fill(null).map(() => mockDaily(temp + 5, temp - 5)),
        updatedAt: Date.now(),
        lat: 45,
        lon: -75,
        timezone: 'UTC',
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
            { ...createMockForecast('gfs_seamless', 20), error: 'API Error' },
        ];

        const result = calculateConsensus(forecasts as any);
        expect(result.isAvailable).toBe(false);
        expect(result.metrics.overall).toBe(0);
    });
});
