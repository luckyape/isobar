/**
 * Integration tests for weatherApi forecast fetching
 * These tests mock global fetch to ensure real API call flow works correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchForecastsWithMetadata,
  resetForecastCachesForTests,
  CANADIAN_CITIES,
  getLastFetchDiagnostics
} from './weatherApi';

// Mock the vault module to return empty data
vi.mock('./vault', () => ({
  getVault: () => ({
    open: vi.fn().mockResolvedValue(undefined),
    getArtifactsForDate: vi.fn().mockResolvedValue([]),
    getMeta: vi.fn().mockResolvedValue(null),
    has: vi.fn().mockResolvedValue(false),
    getBlob: vi.fn().mockResolvedValue(null),
    close: vi.fn()
  }),
  getSyncEngine: () => ({
    sync: vi.fn().mockResolvedValue({ blobsDownloaded: 0, bytesDownloaded: 0 })
  })
}));

describe('weatherApi Integration Tests', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    // Reset all caches before each test
    resetForecastCachesForTests();
    
    // Clear localStorage
    if (typeof window !== 'undefined') {
      window.localStorage.clear();
    }
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('Toronto happy path: fetches and returns valid forecasts from Open-Meteo', async () => {
    const toronto = CANADIAN_CITIES[0]; // Toronto is first

    // Mock Open-Meteo metadata endpoints (4 models)
    const metadataResponse = {
      last_run_initialisation_time: Math.floor(Date.now() / 1000) - 7200, // 2 hours ago
      last_run_availability_time: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      update_interval_seconds: 10800 // 3 hours
    };

    // Mock Open-Meteo forecast endpoints
    const forecastResponse = {
      latitude: toronto.latitude,
      longitude: toronto.longitude,
      hourly: {
        time: [
          Math.floor(Date.now() / 1000),
          Math.floor(Date.now() / 1000) + 3600,
          Math.floor(Date.now() / 1000) + 7200
        ],
        temperature_2m: [15.5, 16.2, 17.1],
        precipitation: [0, 0.1, 0.2],
        precipitation_probability: [10, 20, 30],
        wind_speed_10m: [10, 12, 14],
        wind_direction_10m: [180, 190, 200],
        wind_gusts_10m: [15, 17, 19],
        cloud_cover: [50, 60, 70],
        relative_humidity_2m: [65, 70, 75],
        pressure_msl: [1013, 1012, 1011],
        weather_code: [1, 2, 3]
      },
      daily: {
        time: [
          Math.floor(Date.now() / 1000),
          Math.floor(Date.now() / 1000) + 86400
        ],
        temperature_2m_max: [20, 22],
        temperature_2m_min: [10, 12],
        precipitation_sum: [0.5, 1.0],
        precipitation_probability_max: [30, 40],
        wind_speed_10m_max: [15, 18],
        wind_gusts_10m_max: [20, 25],
        weather_code: [2, 3],
        sunrise: [Math.floor(Date.now() / 1000) + 25200, Math.floor(Date.now() / 1000) + 111600],
        sunset: [Math.floor(Date.now() / 1000) + 61200, Math.floor(Date.now() / 1000) + 147600]
      }
    };

    // Mock global fetch
    global.fetch = vi.fn((url: string) => {
      const urlStr = url.toString();
      
      // Metadata endpoints
      if (urlStr.includes('/static/meta.json')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: () => Promise.resolve(metadataResponse)
        } as Response);
      }
      
      // Forecast endpoints
      if (
        urlStr.includes('api.open-meteo.com/v1/gem') ||
        urlStr.includes('api.open-meteo.com/v1/gfs') ||
        urlStr.includes('api.open-meteo.com/v1/ecmwf') ||
        urlStr.includes('api.open-meteo.com/v1/dwd-icon')
      ) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: () => Promise.resolve(forecastResponse)
        } as Response);
      }

      return Promise.reject(new Error(`Unmocked URL: ${urlStr}`));
    }) as any;

    // Fetch forecasts
    const result = await fetchForecastsWithMetadata(
      toronto.latitude,
      toronto.longitude,
      toronto.timezone,
      { force: true, nowMs: Date.now() }
    );

    // Assertions
    expect(result.forecasts).toBeDefined();
    expect(result.forecasts.length).toBe(4); // 4 weather models

    // Check that at least one model has valid data
    const okForecasts = result.forecasts.filter(f => {
      const isOk = (f as any).status === 'ok';
      const hasData = !f.error && Array.isArray(f.hourly) && f.hourly.length > 0;
      return isOk || hasData;
    });

    expect(okForecasts.length).toBeGreaterThan(0);
    expect(okForecasts.length).toBe(4); // All 4 should succeed with our mock

    // Verify structure of first forecast
    const firstForecast = okForecasts[0];
    expect(firstForecast.model).toBeDefined();
    expect(firstForecast.model.name).toBeDefined();
    expect(firstForecast.hourly).toBeDefined();
    expect(firstForecast.hourly.length).toBe(3);
    expect(firstForecast.hourly[0].temperature).toBe(15.5);
    expect(firstForecast.daily).toBeDefined();
    expect(firstForecast.daily.length).toBe(2);
  });

  it('All models error: handles complete API failure gracefully', async () => {
    const toronto = CANADIAN_CITIES[0];

    // Mock fetch to always fail
    global.fetch = vi.fn((url: string) => {
      const urlStr = url.toString();
      
      // Metadata succeeds but with old data
      if (urlStr.includes('/static/meta.json')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: () => Promise.resolve({
            last_run_availability_time: Math.floor(Date.now() / 1000) - 86400 // 1 day ago
          })
        } as Response);
      }
      
      // All forecast endpoints fail
      return Promise.resolve({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Headers()
      } as Response);
    }) as any;

    const result = await fetchForecastsWithMetadata(
      toronto.latitude,
      toronto.longitude,
      toronto.timezone,
      { force: true }
    );

    expect(result.forecasts).toBeDefined();
    expect(result.forecasts.length).toBe(4);

    // All should have errors
    const errorForecasts = result.forecasts.filter(f => f.error || (f as any).status === 'error');
    expect(errorForecasts.length).toBe(4);

    // None should have valid hourly data
    const validForecasts = result.forecasts.filter(f => 
      Array.isArray(f.hourly) && f.hourly.length > 0 && !f.error
    );
    expect(validForecasts.length).toBe(0);
  });

  it('Metadata failure: still fetches forecasts when metadata unavailable', async () => {
    const toronto = CANADIAN_CITIES[0];

    const forecastResponse = {
      latitude: toronto.latitude,
      longitude: toronto.longitude,
      hourly: {
        time: [Math.floor(Date.now() / 1000)],
        temperature_2m: [15.5],
        precipitation: [0],
        precipitation_probability: [10],
        wind_speed_10m: [10],
        wind_direction_10m: [180],
        wind_gusts_10m: [15],
        cloud_cover: [50],
        relative_humidity_2m: [65],
        pressure_msl: [1013],
        weather_code: [1]
      },
      daily: {
        time: [Math.floor(Date.now() / 1000)],
        temperature_2m_max: [20],
        temperature_2m_min: [10],
        precipitation_sum: [0.5],
        precipitation_probability_max: [30],
        wind_speed_10m_max: [15],
        wind_gusts_10m_max: [20],
        weather_code: [2],
        sunrise: [Math.floor(Date.now() / 1000) + 25200],
        sunset: [Math.floor(Date.now() / 1000) + 61200]
      }
    };

    global.fetch = vi.fn((url: string) => {
      const urlStr = url.toString();
      
      // Metadata fails
      if (urlStr.includes('/static/meta.json')) {
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          headers: new Headers()
        } as Response);
      }
      
      // Forecasts succeed
      if (urlStr.includes('api.open-meteo.com/v1/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: () => Promise.resolve(forecastResponse)
        } as Response);
      }

      return Promise.reject(new Error(`Unmocked URL: ${urlStr}`));
    }) as any;

    const result = await fetchForecastsWithMetadata(
      toronto.latitude,
      toronto.longitude,
      toronto.timezone,
      { force: true }
    );

    // Should still have valid forecasts even without metadata
    const okForecasts = result.forecasts.filter(f => 
      !f.error && Array.isArray(f.hourly) && f.hourly.length > 0
    );
    
    expect(okForecasts.length).toBeGreaterThan(0);
  });

  it('Partial success: some models work, some fail', async () => {
    const toronto = CANADIAN_CITIES[0];

    const forecastResponse = {
      latitude: toronto.latitude,
      longitude: toronto.longitude,
      hourly: {
        time: [Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000) + 3600],
        temperature_2m: [15.5, 16.2],
        precipitation: [0, 0.1],
        precipitation_probability: [10, 20],
        wind_speed_10m: [10, 12],
        wind_direction_10m: [180, 190],
        wind_gusts_10m: [15, 17],
        cloud_cover: [50, 60],
        relative_humidity_2m: [65, 70],
        pressure_msl: [1013, 1012],
        weather_code: [1, 2]
      },
      daily: {
        time: [Math.floor(Date.now() / 1000)],
        temperature_2m_max: [20],
        temperature_2m_min: [10],
        precipitation_sum: [0.5],
        precipitation_probability_max: [30],
        wind_speed_10m_max: [15],
        wind_gusts_10m_max: [20],
        weather_code: [2],
        sunrise: [Math.floor(Date.now() / 1000) + 25200],
        sunset: [Math.floor(Date.now() / 1000) + 61200]
      }
    };

    let callCount = 0;
    global.fetch = vi.fn((url: string) => {
      const urlStr = url.toString();
      
      // Metadata succeeds
      if (urlStr.includes('/static/meta.json')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: () => Promise.resolve({
            last_run_availability_time: Math.floor(Date.now() / 1000) - 3600
          })
        } as Response);
      }
      
      // First 2 forecasts succeed, last 2 fail
      if (urlStr.includes('api.open-meteo.com/v1/')) {
        callCount++;
        if (callCount <= 2) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: () => Promise.resolve(forecastResponse)
          } as Response);
        } else {
          return Promise.resolve({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            headers: new Headers()
          } as Response);
        }
      }

      return Promise.reject(new Error(`Unmocked URL: ${urlStr}`));
    }) as any;

    const result = await fetchForecastsWithMetadata(
      toronto.latitude,
      toronto.longitude,
      toronto.timezone,
      { force: true }
    );

    const okForecasts = result.forecasts.filter(f => 
      !f.error && Array.isArray(f.hourly) && f.hourly.length > 0
    );
    const errorForecasts = result.forecasts.filter(f => f.error);

    expect(okForecasts.length).toBe(2);
    expect(errorForecasts.length).toBe(2);
    expect(result.forecasts.length).toBe(4);
  });

  it('bypassAllCaches: forces fresh fetch even with fresh cache', async () => {
    const toronto = CANADIAN_CITIES[0];

    // Mock metadata and forecast responses
    const metadataResponse = {
      last_run_initialisation_time: Math.floor(Date.now() / 1000) - 7200,
      last_run_availability_time: Math.floor(Date.now() / 1000) - 3600,
      update_interval_seconds: 10800
    };

    let fetchCallCount = 0;
    const forecastResponse = () => ({
      latitude: toronto.latitude,
      longitude: toronto.longitude,
      hourly: {
        time: [Math.floor(Date.now() / 1000)],
        temperature_2m: [15 + fetchCallCount], // Temperature changes per call
        precipitation: [0],
        precipitation_probability: [10],
        wind_speed_10m: [10],
        wind_direction_10m: [180],
        wind_gusts_10m: [15],
        cloud_cover: [50],
        relative_humidity_2m: [65],
        pressure_msl: [1013],
        weather_code: [1]
      },
      daily: {
        time: [Math.floor(Date.now() / 1000)],
        temperature_2m_max: [20],
        temperature_2m_min: [10],
        precipitation_sum: [0.5],
        precipitation_probability_max: [30],
        wind_speed_10m_max: [15],
        wind_gusts_10m_max: [20],
        weather_code: [2],
        sunrise: [Math.floor(Date.now() / 1000) + 25200],
        sunset: [Math.floor(Date.now() / 1000) + 61200]
      }
    });

    global.fetch = vi.fn((url: string) => {
      const urlStr = url.toString();
      
      if (urlStr.includes('/static/meta.json')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: () => Promise.resolve(metadataResponse)
        } as Response);
      }
      
      if (urlStr.includes('api.open-meteo.com/v1/')) {
        fetchCallCount++;
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: () => Promise.resolve(forecastResponse())
        } as Response);
      }

      return Promise.reject(new Error(`Unmocked URL: ${urlStr}`));
    }) as any;

    // First fetch - should call API
    const result1 = await fetchForecastsWithMetadata(
      toronto.latitude,
      toronto.longitude,
      toronto.timezone,
      { force: true }
    );

    const callsAfterFirst = fetchCallCount;
    expect(callsAfterFirst).toBe(4); // 4 models fetched

    // Verify first results are ok
    const okForecasts1 = result1.forecasts.filter(f => (f as any).status === 'ok');
    expect(okForecasts1.length).toBe(4);

    // Second fetch WITHOUT bypassAllCaches - metadata might allow skip
    // Reset cache counters but keep in-memory caches
    fetchCallCount = 0;

    // With force=false and no bypass, if cache is fresh, might skip fetch
    // The real behavior depends on TTL logic

    // Third fetch WITH bypassAllCaches - MUST call API regardless of cache state
    fetchCallCount = 0;
    const result3 = await fetchForecastsWithMetadata(
      toronto.latitude,
      toronto.longitude,
      toronto.timezone,
      { force: true, bypassAllCaches: true }
    );

    // With bypassAllCaches, should always make fresh calls
    const diagnostics = getLastFetchDiagnostics();
    
    // All 4 models should have decision === 'fetch' (not 'skip' or 'pending')
    const fetchDecisions = diagnostics.filter(d => d.decision === 'fetch');
    expect(fetchDecisions.length).toBe(4);
    
    // All should have made HTTP requests (status 200)
    const httpSuccesses = diagnostics.filter(d => d.httpStatus === 200);
    expect(httpSuccesses.length).toBe(4);

    // Verify we got fresh data
    const okForecasts3 = result3.forecasts.filter(f => (f as any).status === 'ok');
    expect(okForecasts3.length).toBe(4);
  });

  it('URL contains required hourly and daily query params', async () => {
    const toronto = CANADIAN_CITIES[0];
    const capturedUrls: string[] = [];

    // Mock fetch to capture URLs
    global.fetch = vi.fn((url: string) => {
      const urlStr = url.toString();
      capturedUrls.push(urlStr);
      
      if (urlStr.includes('/static/meta.json')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: () => Promise.resolve({
            last_run_availability_time: Math.floor(Date.now() / 1000) - 3600
          })
        } as Response);
      }
      
      // Return valid response
      if (urlStr.includes('api.open-meteo.com/v1/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: () => Promise.resolve({
            latitude: toronto.latitude,
            longitude: toronto.longitude,
            hourly: {
              time: [Math.floor(Date.now() / 1000)],
              temperature_2m: [15],
              precipitation: [0],
              precipitation_probability: [10],
              wind_speed_10m: [10],
              wind_direction_10m: [180],
              wind_gusts_10m: [15],
              cloud_cover: [50],
              relative_humidity_2m: [65],
              pressure_msl: [1013],
              weather_code: [1]
            },
            daily: {
              time: [Math.floor(Date.now() / 1000)],
              temperature_2m_max: [20],
              temperature_2m_min: [10],
              precipitation_sum: [0.5],
              precipitation_probability_max: [30],
              wind_speed_10m_max: [15],
              wind_gusts_10m_max: [20],
              weather_code: [2],
              sunrise: [Math.floor(Date.now() / 1000) + 25200],
              sunset: [Math.floor(Date.now() / 1000) + 61200]
            }
          })
        } as Response);
      }

      return Promise.reject(new Error(`Unmocked URL: ${urlStr}`));
    }) as any;

    await fetchForecastsWithMetadata(
      toronto.latitude,
      toronto.longitude,
      toronto.timezone,
      { force: true }
    );

    // Filter to only Open-Meteo forecast URLs (not metadata)
    const forecastUrls = capturedUrls.filter(url => 
      url.includes('api.open-meteo.com/v1/') && 
      !url.includes('/static/meta.json')
    );

    expect(forecastUrls.length).toBeGreaterThan(0);

    // Every forecast URL must contain hourly= and daily= params
    for (const url of forecastUrls) {
      expect(url).toContain('hourly=');
      expect(url).toContain('daily=');
      expect(url).toContain('temperature_2m');
      expect(url).toContain('temperature_2m_max');
      expect(url).toContain('sunrise');
      expect(url).toContain('sunset');
    }
  });

  it('Missing hourly.time returns error status without throwing', async () => {
    const toronto = CANADIAN_CITIES[0];

    // Mock fetch to return response missing hourly.time
    global.fetch = vi.fn((url: string) => {
      const urlStr = url.toString();
      
      if (urlStr.includes('/static/meta.json')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: () => Promise.resolve({
            last_run_availability_time: Math.floor(Date.now() / 1000) - 3600
          })
        } as Response);
      }
      
      // Return response with missing hourly data
      if (urlStr.includes('api.open-meteo.com/v1/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: () => Promise.resolve({
            latitude: toronto.latitude,
            longitude: toronto.longitude,
            // hourly is completely missing or has no time array
            hourly: {},
            daily: {
              time: [Math.floor(Date.now() / 1000)],
              temperature_2m_max: [20],
              temperature_2m_min: [10]
            }
          })
        } as Response);
      }

      return Promise.reject(new Error(`Unmocked URL: ${urlStr}`));
    }) as any;

    // Should NOT throw
    const result = await fetchForecastsWithMetadata(
      toronto.latitude,
      toronto.longitude,
      toronto.timezone,
      { force: true }
    );

    // All forecasts should have error status due to missing hourly.time
    expect(result.forecasts.length).toBe(4);
    
    for (const forecast of result.forecasts) {
      const normalized = forecast as any;
      expect(normalized.status).toBe('error');
      expect(normalized.reason || normalized.error).toBeTruthy();
      expect(normalized.hourly).toEqual([]);
    }
  });

  it('Partial hourly data uses safe fallbacks without throwing', async () => {
    const toronto = CANADIAN_CITIES[0];

    // Mock fetch to return response with partial hourly data (missing some fields)
    global.fetch = vi.fn((url: string) => {
      const urlStr = url.toString();
      
      if (urlStr.includes('/static/meta.json')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: () => Promise.resolve({
            last_run_availability_time: Math.floor(Date.now() / 1000) - 3600
          })
        } as Response);
      }
      
      // Return response with partial data - time exists but some fields missing
      if (urlStr.includes('api.open-meteo.com/v1/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: () => Promise.resolve({
            latitude: toronto.latitude,
            longitude: toronto.longitude,
            hourly: {
              time: [Math.floor(Date.now() / 1000)],
              temperature_2m: [15],
              // Missing: precipitation, wind_speed_10m, etc.
            },
            daily: {
              time: [Math.floor(Date.now() / 1000)],
              temperature_2m_max: [20],
              // Missing: temperature_2m_min, sunrise, sunset, etc.
            }
          })
        } as Response);
      }

      return Promise.reject(new Error(`Unmocked URL: ${urlStr}`));
    }) as any;

    // Should NOT throw
    const result = await fetchForecastsWithMetadata(
      toronto.latitude,
      toronto.longitude,
      toronto.timezone,
      { force: true }
    );

    // All forecasts should succeed with fallback values
    expect(result.forecasts.length).toBe(4);
    
    for (const forecast of result.forecasts) {
      const normalized = forecast as any;
      // Should be OK since hourly.time exists
      expect(normalized.status).toBe('ok');
      expect(normalized.hourly.length).toBe(1);
      
      // Check fallback values were applied
      const hourlyPoint = normalized.hourly[0];
      expect(hourlyPoint.temperature).toBe(15); // was provided
      expect(hourlyPoint.precipitation).toBe(0); // fallback
      expect(hourlyPoint.windSpeed).toBe(0); // fallback
    }
  });
});
