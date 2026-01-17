/**
 * Consensus / agreement configuration.
 *
 * This file centralizes the constants used to score model agreement so the
 * methodology can be documented and kept in sync with the implementation.
 *
 * Units (Open‑Meteo defaults; we do not request alternate units):
 * - Temperature: °C (`temperature_2m`)
 * - Precipitation intensity: mm/hr (`precipitation`)
 * - Precipitation probability: % (`precipitation_probability`)
 * - Wind speed: km/h (`wind_speed_10m`)
 * - Wind direction: degrees from north, 0–360 (`wind_direction_10m`)
 * - Cloud cover: % (`cloud_cover`)
 *
 * Agreement scoring for numeric metrics:
 * - Compute population standard deviation across available model values
 * - Estimate "model spread" as `2 × stdDev` (exact when there are 2 models)
 * - Convert to a 0–100 score: `100 × (1 - spread / expectedSpread)`
 * - Clamp to the inclusive range [0, 100]
 */

export const AGREEMENT_STDDEV_TO_SPREAD_MULTIPLIER = 2 as const;

export const AGREEMENT_LEVEL_THRESHOLDS = {
  high: 75,
  moderate: 50
} as const;

export const HOURLY_EXPECTED_SPREAD = {
  temperatureC: 10,
  precipitationMmPerHour: 5,
  precipitationProbabilityPct: 30,
  windSpeedKmh: 15,
  windDirectionDeg: 45,
  cloudCoverPct: 30
} as const;

export const DAILY_EXPECTED_SPREAD = {
  temperatureMaxC: 8,
  temperatureMinC: 8,
  precipitationSumMm: 15,
  precipitationProbabilityMaxPct: 30,
  windSpeedMaxKmh: 20
} as const;

export const PRECIPITATION_COMPONENT_WEIGHTS = {
  amount: 0.5,
  probability: 0.5
} as const;

export const HOURLY_OVERALL_WEIGHTS = {
  temperature: 0.3,
  precipitation: 0.25,
  windSpeed: 0.2,
  weatherCode: 0.15,
  cloudCover: 0.1
} as const;

export const DAILY_OVERALL_WEIGHTS = {
  temperatureMax: 0.25,
  temperatureMin: 0.25,
  precipitation: 0.25,
  windSpeed: 0.15,
  weatherCode: 0.1
} as const;

export const FORECAST_OVERALL_WEIGHTS = {
  temperature: 0.35,
  precipitation: 0.3,
  wind: 0.2,
  conditions: 0.15
} as const;
