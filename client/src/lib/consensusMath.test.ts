import { describe, expect, it } from 'vitest';
import type { ModelForecast, WeatherModel } from './weatherApi';
import { calculateAgreement, calculateFreshness, computeStats } from './consensusMath';

const baseModel: WeatherModel = {
  id: 'test-model',
  name: 'Test Model',
  provider: 'Test Provider',
  endpoint: 'https://example.com',
  color: 'oklch(0.5 0.1 240)',
  description: 'Test model'
};

const makeForecast = (runAvailabilityTime?: number): ModelForecast => ({
  model: baseModel,
  hourly: [],
  daily: [],
  fetchedAt: new Date(0),
  runAvailabilityTime
});

describe('computeStats', () => {
  it('filters non-finite values and computes mean/stddev', () => {
    const stats = computeStats([1, 3, NaN, Infinity, -Infinity]);
    expect(stats.count).toBe(2);
    expect(stats.mean).toBe(2);
    expect(stats.stdDev).toBeCloseTo(1);
  });
});

describe('calculateAgreement', () => {
  it('returns 0 when expected range is invalid', () => {
    expect(calculateAgreement(2, 0)).toBe(0);
  });
});

describe('calculateFreshness', () => {
  it('computes spread and freshness score from run availability times', () => {
    const freshest = 1_700_000_000;
    const oldest = freshest - 10 * 3600;
    const result = calculateFreshness([
      makeForecast(freshest),
      makeForecast(oldest)
    ], { nowSeconds: freshest });

    expect(result.hasMetadata).toBe(true);
    expect(result.spreadHours).toBeCloseTo(10);
    expect(result.freshnessScore).toBe(60);
  });

  it('returns no spread when metadata is missing', () => {
    const result = calculateFreshness([makeForecast(), makeForecast()]);
    expect(result.spreadHours).toBeUndefined();
    expect(result.hasMetadata).toBe(false);
  });

  it('returns higher freshness scores for smaller spreads', () => {
    const freshest = 1_700_000_000;
    const oldest = freshest - 3 * 3600;
    const result = calculateFreshness([
      makeForecast(freshest),
      makeForecast(oldest)
    ], { nowSeconds: freshest });

    expect(result.freshnessScore).toBe(88);
  });
});
