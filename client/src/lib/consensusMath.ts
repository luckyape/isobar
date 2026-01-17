/**
 * Consensus Math Helpers - Arctic Data Observatory
 * Shared numeric utilities for safe consensus calculations.
 */

import type { ModelForecast } from './weatherApi';
import { AGREEMENT_STDDEV_TO_SPREAD_MULTIPLIER } from './consensusConfig';

export function filterFiniteNumbers(values: number[]): number[] {
  return values.filter((value) => Number.isFinite(value));
}

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function computeStats(values: number[]): {
  mean: number;
  stdDev: number;
  min: number;
  max: number;
  count: number;
} {
  const finite = filterFiniteNumbers(values);
  const count = finite.length;

  if (count === 0) {
    return { mean: 0, stdDev: 0, min: 0, max: 0, count: 0 };
  }

  const mean = finite.reduce((sum, value) => sum + value, 0) / count;
  const squaredDiffs = finite.map((value) => Math.pow(value - mean, 2));
  const stdDev = Math.sqrt(squaredDiffs.reduce((sum, value) => sum + value, 0) / count);
  const min = Math.min(...finite);
  const max = Math.max(...finite);

  return {
    mean,
    stdDev: Number.isFinite(stdDev) ? stdDev : 0,
    min,
    max,
    count
  };
}

/**
 * Convert a standard deviation (computed across model values) into a 0–100
 * agreement score.
 *
 * `expectedSpread` is interpreted as the typical max-to-min spread across models
 * for the given metric (not a standard deviation). We estimate spread from
 * stdDev as `spread ≈ 2 × stdDev` (exact when there are 2 models).
 */
export function calculateAgreement(stdDev: number, expectedSpread: number): number {
  if (!Number.isFinite(stdDev) || !Number.isFinite(expectedSpread) || expectedSpread <= 0) {
    return 0;
  }

  const spreadEstimate = stdDev * AGREEMENT_STDDEV_TO_SPREAD_MULTIPLIER;
  const normalizedSpread = spreadEstimate / expectedSpread;
  const score = 100 * (1 - normalizedSpread);
  return clampScore(score);
}

export function calculateFreshness(
  forecasts: ModelForecast[],
  options: {
    nowSeconds?: number;
    staleThresholdHours?: number;
    spreadThresholdHours?: number;
    maxPenalty?: number;
  } = {}
): {
  hasMetadata: boolean;
  spreadHours?: number;
  freshnessScore?: number;
  freshestRunAvailabilityTime?: number;
  oldestRunAvailabilityTime?: number;
  staleModelCount?: number;
  staleModelIds?: string[];
  freshnessPenalty?: number;
} {
  const runTimes = forecasts
    .filter((forecast) => !forecast.error)
    .map((forecast) => ({
      modelId: forecast.model.id,
      runAvailabilityTime: forecast.runAvailabilityTime
    }))
    .filter((entry): entry is { modelId: string; runAvailabilityTime: number } =>
      Number.isFinite(entry.runAvailabilityTime)
    );

  if (runTimes.length === 0) {
    return { hasMetadata: false };
  }

  const runValues = runTimes.map((entry) => entry.runAvailabilityTime);
  const freshest = Math.max(...runValues);
  const oldest = Math.min(...runValues);
  const hasSpread = runValues.length >= 2 && Number.isFinite(freshest) && Number.isFinite(oldest);
  const spreadHours = hasSpread ? (freshest - oldest) / 3600 : undefined;
  const nowSeconds = options.nowSeconds ?? Date.now() / 1000;
  const staleThresholdHours = options.staleThresholdHours ?? 12;
  const spreadThresholdHours = options.spreadThresholdHours ?? 6;
  const maxPenalty = options.maxPenalty ?? 20;
  const oldestAgeHours = Number.isFinite(oldest)
    ? Math.max(0, (nowSeconds - oldest) / 3600)
    : undefined;
  const freshnessScore = oldestAgeHours !== undefined
    ? clampScore(100 - oldestAgeHours * 4)
    : undefined;

  const staleModelIds = runTimes
    .filter((entry) => (nowSeconds - entry.runAvailabilityTime) / 3600 > staleThresholdHours)
    .map((entry) => entry.modelId);
  const staleModelCount = staleModelIds.length;

  const spreadPenalty = spreadHours !== undefined && spreadHours > spreadThresholdHours
    ? (spreadHours - spreadThresholdHours) * 2
    : 0;
  const stalePenalty = staleModelCount * 4;
  const freshnessPenalty = clampScore(Math.min(maxPenalty, spreadPenalty + stalePenalty));

  return {
    hasMetadata: true,
    spreadHours: spreadHours !== undefined ? Math.max(0, spreadHours) : undefined,
    freshnessScore: freshnessScore !== undefined ? Math.round(freshnessScore) : undefined,
    freshestRunAvailabilityTime: freshest,
    oldestRunAvailabilityTime: oldest,
    staleModelCount,
    staleModelIds,
    freshnessPenalty: freshnessPenalty > 0 ? Math.round(freshnessPenalty) : 0
  };
}
