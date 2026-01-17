import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decideForecastFetch,
  fetchForecastsWithMetadata,
  resetForecastCachesForTests,
  resetGatingStats,
  getGatingStats,
  WEATHER_MODELS,
  type ModelForecast
} from './weatherApi';

const baseForecast = (runAvailabilityTime: number): ModelForecast => ({
  model: WEATHER_MODELS[0],
  hourly: [
    {
      time: '2024-01-01T00:00',
      epoch: 1704067200000,
      temperature: 0,
      precipitation: 0,
      precipitationProbability: 0,
      windSpeed: 0,
      windDirection: 0,
      windGusts: 0,
      cloudCover: 0,
      humidity: 0,
      pressure: 0,
      weatherCode: 0
    }
  ],
  daily: [
    {
      date: '2024-01-01',
      temperatureMax: 0,
      temperatureMin: 0,
      precipitationSum: 0,
      precipitationProbabilityMax: 0,
      windSpeedMax: 0,
      windGustsMax: 0,
      weatherCode: 0,
      sunrise: '2024-01-01T07:00',
      sunset: '2024-01-01T17:00'
    }
  ],
  fetchedAt: new Date(0),
  runAvailabilityTime
});

const forecastPayload = {
  hourly: {
    time: [1704067200],
    temperature_2m: [0],
    precipitation: [0],
    precipitation_probability: [0],
    wind_speed_10m: [0],
    wind_direction_10m: [0],
    wind_gusts_10m: [0],
    cloud_cover: [0],
    relative_humidity_2m: [0],
    pressure_msl: [0],
    weather_code: [0]
  },
  daily: {
    time: [1704067200],
    temperature_2m_max: [0],
    temperature_2m_min: [0],
    precipitation_sum: [0],
    precipitation_probability_max: [0],
    wind_speed_10m_max: [0],
    wind_gusts_10m_max: [0],
    weather_code: [0],
    sunrise: [1704092400],
    sunset: [1704128400]
  }
};

describe('forecast gating', () => {
  let metadataAvailability = 1_000;
  const mockFetch = vi.fn(async (url: string) => {
    if (url.includes('/data/')) {
      return {
        ok: true,
        json: async () => ({
          last_run_initialisation_time: metadataAvailability - 3600,
          last_run_availability_time: metadataAvailability,
          update_interval_seconds: 3600
        })
      } as Response;
    }
    return {
      ok: true,
      json: async () => forecastPayload
    } as Response;
  });

  beforeEach(() => {
    resetForecastCachesForTests();
    resetGatingStats();
    metadataAvailability = 1_000;
    mockFetch.mockClear();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips forecast fetches when metadata is unchanged and cache exists', async () => {
    await fetchForecastsWithMetadata(0, 0, 'UTC', {
      force: true,
      userInitiated: true,
      nowMs: 1_000_000
    });

    resetGatingStats();

    const result = await fetchForecastsWithMetadata(0, 0, 'UTC', {
      userInitiated: true,
      nowMs: 1_200_000
    });

    const stats = getGatingStats();
    expect(result.usedCache).toBe(true);
    expect(stats.forecastCalls).toBe(0);
  });

  it('defers fetches when new run is inside the consistency delay', async () => {
    await fetchForecastsWithMetadata(0, 0, 'UTC', {
      force: true,
      userInitiated: true,
      nowMs: 1_000_000
    });

    resetGatingStats();
    metadataAvailability = 2_000;

    const beforeReady = metadataAvailability * 1000 + 10 * 60 * 1000 - 1000;
    const pendingResult = await fetchForecastsWithMetadata(0, 0, 'UTC', {
      userInitiated: true,
      nowMs: beforeReady,
      consistencyDelayMinutes: 10
    });

    expect(pendingResult.pending.length).toBeGreaterThan(0);
    expect(getGatingStats().forecastCalls).toBe(0);

    resetGatingStats();
    const afterReady = metadataAvailability * 1000 + 10 * 60 * 1000 + 1000;
    await fetchForecastsWithMetadata(0, 0, 'UTC', {
      userInitiated: true,
      nowMs: afterReady,
      consistencyDelayMinutes: 10
    });

    expect(getGatingStats().forecastCalls).toBeGreaterThan(0);
  });

  it('fetches when metadata is missing and no cache exists', () => {
    const decision = decideForecastFetch({
      metadata: null,
      cachedForecast: null,
      nowMs: 1_000_000,
      delayMinutes: 10,
      metadataFallbackTtlHours: 6
    });

    expect(decision.action).toBe('fetch');
  });

  it('forces forecast fetches when explicitly requested', () => {
    const decision = decideForecastFetch({
      metadata: { runAvailabilityTime: 1_000 },
      cachedForecast: baseForecast(1_000),
      nowMs: 1_000_000,
      delayMinutes: 10,
      metadataFallbackTtlHours: 6,
      force: true
    });

    expect(decision.action).toBe('fetch');
  });

  it('fetches when metadata is missing and cached data is stale', () => {
    const cachedForecast = baseForecast(1_000);
    cachedForecast.fetchedAt = new Date(0);
    const decision = decideForecastFetch({
      metadata: null,
      cachedForecast,
      nowMs: 1000 * 60 * 60 * 10,
      delayMinutes: 10,
      metadataFallbackTtlHours: 6
    });

    expect(decision.action).toBe('fetch');
  });

  it('continues to fetch when metadata endpoints fail', async () => {
    // Suppress expected error log
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { });

    mockFetch.mockImplementationOnce(async (url: string) => {
      if (url.includes('/data/')) {
        return {
          ok: false,
          status: 500,
          statusText: 'Server error',
          json: async () => ({})
        } as Response;
      }
      return {
        ok: true,
        json: async () => forecastPayload
      } as Response;
    });

    await fetchForecastsWithMetadata(0, 0, 'UTC', {
      userInitiated: true,
      nowMs: 1_000_000
    });

    expect(getGatingStats().forecastCalls).toBeGreaterThan(0);
    consoleError.mockRestore();
  });
});
