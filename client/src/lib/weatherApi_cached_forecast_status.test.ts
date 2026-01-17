import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WEATHER_MODELS } from './weatherModels';

const FORECAST_CACHE_KEY = 'weather-consensus-forecast-cache-v2';

describe('weatherApi forecast cache hydration', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
  });

  it('hydrates cached forecasts with status so UI does not flash empty states', async () => {
    const model = WEATHER_MODELS[0];
    const latitude = 43.6532;
    const longitude = -79.3832;
    const timezone = 'America/Toronto';
    const locationKey = `${latitude.toFixed(4)}|${longitude.toFixed(4)}|${timezone}`;
    const now = Date.now();

    window.localStorage.setItem(FORECAST_CACHE_KEY, JSON.stringify({
      version: 1,
      order: [locationKey],
      locations: {
        [locationKey]: {
          updatedAt: now,
          models: {
            [model.id]: {
              hourly: [{
                time: '2026-01-01T00:00',
                epoch: 1767225600000,
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
              }],
              daily: [],
              fetchedAt: now,
              snapshotTime: now,
              lastForecastFetchTime: now,
              lastSeenRunAvailabilityTime: null,
              lastForecastSnapshotId: 'test-snapshot',
              snapshotHash: 'test-hash',
              etag: null,
              runInitialisationTime: null,
              runAvailabilityTime: null,
              updateIntervalSeconds: null,
              metadataFetchedAt: null
            }
          }
        }
      }
    }));

    const weatherApi = await import('./weatherApi');
    const cached = weatherApi.getCachedForecasts(latitude, longitude, timezone);

    expect(cached.length).toBeGreaterThan(0);
    expect(cached[0]?.status).toBe('ok');
  });
});

