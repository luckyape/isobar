import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateConsensus } from './consensus';
import { WEATHER_MODELS, type ModelForecast } from './weatherApi';

const buildForecast = (
  modelId: string,
  runAvailabilityTime: number
): ModelForecast => ({
  model: WEATHER_MODELS.find((model) => model.id === modelId) ?? WEATHER_MODELS[0],
  hourly: [
    {
      time: '2024-01-01T00:00',
      temperature: 10,
      precipitation: 0,
      precipitationProbability: 0,
      windSpeed: 5,
      windDirection: 180,
      windGusts: 8,
      cloudCover: 20,
      humidity: 50,
      pressure: 1010,
      weatherCode: 1
    }
  ],
  daily: [
    {
      date: '2024-01-01',
      temperatureMax: 12,
      temperatureMin: 6,
      precipitationSum: 0,
      precipitationProbabilityMax: 0,
      windSpeedMax: 10,
      windGustsMax: 14,
      weatherCode: 1,
      sunrise: '2024-01-01T07:00',
      sunset: '2024-01-01T17:00'
    }
  ],
  fetchedAt: new Date(0),
  runAvailabilityTime
});

describe('consensus freshness penalty', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not reduce overall agreement when run freshness diverges', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const forecasts: ModelForecast[] = [
      buildForecast(WEATHER_MODELS[0].id, nowSeconds),
      buildForecast(WEATHER_MODELS[1].id, nowSeconds - 10 * 3600)
    ];

    const consensus = calculateConsensus(forecasts);
    expect(consensus.freshness.freshnessPenalty).toBeGreaterThan(0);
    expect(consensus.metrics.overall).toBe(100);
  });
});
