/**
 * Consensus Calculation - Arctic Data Observatory
 * Normalizes and compares weather model forecasts to calculate agreement scores
 *
 * Agreement constants (weights + expected spreads) are centralized in
 * `consensusConfig.ts` to keep the implementation and published methodology in sync.
 */

import { normalizeWeatherCode, type ModelForecast } from './weatherApi';
import {
  calculateAgreement,
  calculateFreshness,
  clampScore,
  computeStats,
  filterFiniteNumbers
} from './consensusMath';
import {
  AGREEMENT_LEVEL_THRESHOLDS,
  DAILY_EXPECTED_SPREAD,
  DAILY_OVERALL_WEIGHTS,
  FORECAST_OVERALL_WEIGHTS,
  HOURLY_EXPECTED_SPREAD,
  HOURLY_OVERALL_WEIGHTS,
  PRECIPITATION_COMPONENT_WEIGHTS
} from './consensusConfig';

function getNumericEnv(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const FRESHNESS_STALE_THRESHOLD_HOURS = getNumericEnv(
  import.meta.env.VITE_FRESHNESS_STALE_HOURS,
  12
);
const FRESHNESS_SPREAD_THRESHOLD_HOURS = getNumericEnv(
  import.meta.env.VITE_FRESHNESS_SPREAD_THRESHOLD_HOURS,
  6
);
const FRESHNESS_MAX_PENALTY = getNumericEnv(
  import.meta.env.VITE_FRESHNESS_MAX_PENALTY,
  20
);

export interface ConsensusMetrics {
  overall: number; // 0-100 overall agreement score
  temperature: number;
  precipitation: number;
  wind: number;
  conditions: number;
}

export interface HourlyConsensus {
  time: string;
  epoch?: number;
  temperature: {
    mean: number;
    min: number;
    max: number;
    stdDev: number;
    agreement: number;
    available?: boolean;
  };
  precipitation: {
    mean: number;
    min: number;
    max: number;
    stdDev: number;
    agreement: number;
    available?: boolean;
  };
  precipitationProbability: {
    mean: number;
    min: number;
    max: number;
    agreement: number;
    available?: boolean;
  };
  precipitationCombined: {
    agreement: number;
    available?: boolean;
    amountAgreement: number;
    probabilityAgreement: number;
    amountAvailable?: boolean;
    probabilityAvailable?: boolean;
  };
  windSpeed: {
    mean: number;
    min: number;
    max: number;
    stdDev: number;
    agreement: number;
    available?: boolean;
  };
  windDirection: {
    mean: number;
    agreement: number;
    available?: boolean;
  };
  cloudCover: {
    mean: number;
    agreement: number;
    available?: boolean;
  };
  weatherCode: {
    dominant: number;
    agreement: number;
    available?: boolean;
  };
  overallAgreement: number;
}

export interface DailyConsensus {
  date: string;
  temperatureMax: {
    mean: number;
    min: number;
    max: number;
    stdDev: number;
    agreement: number;
    available?: boolean;
  };
  temperatureMin: {
    mean: number;
    min: number;
    max: number;
    stdDev: number;
    agreement: number;
    available?: boolean;
  };
  precipitation: {
    mean: number;
    min: number;
    max: number;
    agreement: number;
    available?: boolean;
  };
  precipitationProbabilityMax: {
    mean: number;
    min: number;
    max: number;
    agreement: number;
    available?: boolean;
  };
  precipitationCombined: {
    agreement: number;
    available?: boolean;
    amountAgreement: number;
    probabilityAgreement: number;
    amountAvailable?: boolean;
    probabilityAvailable?: boolean;
  };
  windSpeed: {
    mean: number;
    agreement: number;
    available?: boolean;
  };
  weatherCode: {
    dominant: number;
    agreement: number;
    available?: boolean;
  };
  overallAgreement: number;
}

export interface ConsensusResult {
  metrics: ConsensusMetrics;
  hourly: HourlyConsensus[];
  daily: DailyConsensus[];
  modelCount: number;
  successfulModels: string[];
  failedModels: string[];
  isAvailable: boolean;
  freshness: FreshnessInfo;
}

export interface FreshnessInfo {
  hasMetadata: boolean;
  spreadHours?: number;
  freshnessScore?: number;
  freshestRunAvailabilityTime?: number;
  oldestRunAvailabilityTime?: number;
  staleModelCount?: number;
  staleModelIds?: string[];
  freshnessPenalty?: number;
}

function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function weightedAverage(items: Array<{ value: number; weight: number; available: boolean }>): number {
  const valid = items.filter((item) => item.available && Number.isFinite(item.value) && item.weight > 0);
  const totalWeight = valid.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight === 0) return 0;
  return valid.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;
}

function safeAverage(values: number[]): number {
  const finite = filterFiniteNumbers(values);
  if (finite.length === 0) return 0;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

// Calculate circular mean for wind direction
function circularMean(angles: number[]): number {
  const values = filterFiniteNumbers(angles);
  if (values.length === 0) return 0;
  const sinSum = values.reduce((sum, a) => sum + Math.sin(a * Math.PI / 180), 0);
  const cosSum = values.reduce((sum, a) => sum + Math.cos(a * Math.PI / 180), 0);
  let mean = Math.atan2(sinSum, cosSum) * 180 / Math.PI;
  if (mean < 0) mean += 360;
  return mean;
}

// Calculate circular standard deviation for wind direction
function circularStdDev(angles: number[]): number {
  const values = filterFiniteNumbers(angles);
  if (values.length === 0) return 0;
  const mean = circularMean(values);
  const diffs = values.map(a => {
    let diff = Math.abs(a - mean);
    if (diff > 180) diff = 360 - diff;
    return diff;
  });
  return Math.sqrt(diffs.reduce((sum, d) => sum + d * d, 0) / values.length);
}

// Find dominant weather code
function dominantWeatherCode(
  codes: number[]
): { code: number; agreement: number; available: boolean } {
  const normalizedCodes = codes.map((code) => normalizeWeatherCode(code));
  const finiteCodes = filterFiniteNumbers(normalizedCodes);
  if (finiteCodes.length === 0) return { code: -1, agreement: 0, available: false };

  const counts = finiteCodes.reduce((acc, code) => {
    acc[code] = (acc[code] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  const dominant = Object.entries(counts).reduce((a, b) =>
    (b[1] > a[1]) ? b : a
  );

  const agreement = finiteCodes.length >= 2
    ? (parseInt(dominant[1].toString()) / finiteCodes.length) * 100
    : 0;

  return {
    code: parseInt(dominant[0]),
    agreement,
    available: finiteCodes.length >= 2
  };
}

// Calculate hourly consensus for a specific time index
function calculateHourlyConsensus(
  forecasts: ModelForecast[],
  timeIndex: number
): HourlyConsensus | null {
  const validForecasts = forecasts.filter(f =>
    f.status === 'ok' && f.hourly[timeIndex]
  );

  if (validForecasts.length === 0) return null;

  const hourlyData = validForecasts.map(f => f.hourly[timeIndex]);
  const time = hourlyData[0].time;
  const epoch = hourlyData[0].epoch;

  // Temperature consensus
  const temps = hourlyData.map(h => h.temperature);
  const tempStats = computeStats(temps);
  const tempAvailable = tempStats.count >= 2;
  const tempAgreement = tempAvailable
    ? calculateAgreement(tempStats.stdDev, HOURLY_EXPECTED_SPREAD.temperatureC)
    : 0;

  // Precipitation consensus
  const precips = hourlyData.map(h => h.precipitation);
  const precipStats = computeStats(precips);
  const precipAmountAvailable = precipStats.count >= 2;
  const precipAmountAgreement = precipAmountAvailable
    ? calculateAgreement(precipStats.stdDev, HOURLY_EXPECTED_SPREAD.precipitationMmPerHour)
    : 0;

  // Precipitation probability
  const precipProbs = hourlyData.map(h => h.precipitationProbability);
  const precipProbStats = computeStats(precipProbs);
  const precipProbAvailable = precipProbStats.count >= 2;
  const precipProbAgreement = precipProbAvailable
    ? calculateAgreement(
      precipProbStats.stdDev,
      HOURLY_EXPECTED_SPREAD.precipitationProbabilityPct
    )
    : 0;
  const precipCombinedAvailable = precipAmountAvailable || precipProbAvailable;
  const precipCombinedAgreement = precipCombinedAvailable
    ? weightedAverage([
      {
        value: precipAmountAgreement,
        weight: PRECIPITATION_COMPONENT_WEIGHTS.amount,
        available: precipAmountAvailable
      },
      {
        value: precipProbAgreement,
        weight: PRECIPITATION_COMPONENT_WEIGHTS.probability,
        available: precipProbAvailable
      }
    ])
    : 0;

  // Wind speed consensus
  const winds = hourlyData.map(h => h.windSpeed);
  const windStats = computeStats(winds);
  const windAvailable = windStats.count >= 2;
  const windAgreement = windAvailable
    ? calculateAgreement(windStats.stdDev, HOURLY_EXPECTED_SPREAD.windSpeedKmh)
    : 0;

  // Wind direction consensus (circular)
  const windDirs = hourlyData.map(h => h.windDirection);
  const windDirValues = filterFiniteNumbers(windDirs);
  const windDirMean = windDirValues.length ? circularMean(windDirValues) : 0;
  const windDirAvailable = windDirValues.length >= 2;
  const windDirStdDev = windDirAvailable ? circularStdDev(windDirValues) : 0;
  const windDirAgreement = windDirAvailable
    ? calculateAgreement(windDirStdDev, HOURLY_EXPECTED_SPREAD.windDirectionDeg)
    : 0;

  // Cloud cover consensus
  const clouds = hourlyData.map(h => h.cloudCover);
  const cloudStats = computeStats(clouds);
  const cloudAvailable = cloudStats.count >= 2;
  const cloudAgreement = cloudAvailable
    ? calculateAgreement(cloudStats.stdDev, HOURLY_EXPECTED_SPREAD.cloudCoverPct)
    : 0;

  // Weather code consensus
  const codes = hourlyData.map(h => h.weatherCode);
  const { code: dominantCode, agreement: codeAgreement, available: codeAvailable } = dominantWeatherCode(codes);

  // Overall hourly agreement (weighted average)
  const overallAgreement = weightedAverage([
    { value: tempAgreement, weight: HOURLY_OVERALL_WEIGHTS.temperature, available: tempAvailable },
    { value: precipCombinedAgreement, weight: HOURLY_OVERALL_WEIGHTS.precipitation, available: precipCombinedAvailable },
    { value: windAgreement, weight: HOURLY_OVERALL_WEIGHTS.windSpeed, available: windAvailable },
    { value: codeAgreement, weight: HOURLY_OVERALL_WEIGHTS.weatherCode, available: codeAvailable },
    { value: cloudAgreement, weight: HOURLY_OVERALL_WEIGHTS.cloudCover, available: cloudAvailable }
  ]);

  return {
    time,
    epoch,
    temperature: {
      mean: roundTo(tempStats.mean, 1),
      min: roundTo(tempStats.min, 1),
      max: roundTo(tempStats.max, 1),
      stdDev: roundTo(tempStats.stdDev, 1),
      agreement: Math.round(tempAgreement),
      available: tempAvailable
    },
    precipitation: {
      mean: roundTo(precipStats.mean, 1),
      min: roundTo(precipStats.min, 1),
      max: roundTo(precipStats.max, 1),
      stdDev: roundTo(precipStats.stdDev, 1),
      agreement: Math.round(precipAmountAgreement),
      available: precipAmountAvailable
    },
    precipitationProbability: {
      mean: Math.round(precipProbStats.mean),
      min: Math.round(precipProbStats.min),
      max: Math.round(precipProbStats.max),
      agreement: Math.round(precipProbAgreement),
      available: precipProbAvailable
    },
    precipitationCombined: {
      agreement: Math.round(precipCombinedAgreement),
      available: precipCombinedAvailable,
      amountAgreement: Math.round(precipAmountAgreement),
      probabilityAgreement: Math.round(precipProbAgreement),
      amountAvailable: precipAmountAvailable,
      probabilityAvailable: precipProbAvailable
    },
    windSpeed: {
      mean: roundTo(windStats.mean, 1),
      min: roundTo(windStats.min, 1),
      max: roundTo(windStats.max, 1),
      stdDev: roundTo(windStats.stdDev, 1),
      agreement: Math.round(windAgreement),
      available: windAvailable
    },
    windDirection: {
      mean: Math.round(windDirMean),
      agreement: Math.round(windDirAgreement),
      available: windDirAvailable
    },
    cloudCover: {
      mean: Math.round(cloudStats.mean),
      agreement: Math.round(cloudAgreement),
      available: cloudAvailable
    },
    weatherCode: {
      dominant: dominantCode,
      agreement: Math.round(codeAgreement),
      available: codeAvailable
    },
    overallAgreement: Math.round(clampScore(overallAgreement))
  };
}

// Calculate daily consensus
function calculateDailyConsensus(
  forecasts: ModelForecast[],
  dayIndex: number
): DailyConsensus | null {
  const validForecasts = forecasts.filter(f =>
    f.status === 'ok' && f.daily[dayIndex]
  );

  if (validForecasts.length === 0) return null;

  const dailyData = validForecasts.map(f => f.daily[dayIndex]);
  const date = dailyData[0].date;

  // Temperature max consensus
  const maxTemps = dailyData.map(d => d.temperatureMax);
  const maxTempStats = computeStats(maxTemps);
  const maxTempAvailable = maxTempStats.count >= 2;
  const maxTempAgreement = maxTempAvailable
    ? calculateAgreement(maxTempStats.stdDev, DAILY_EXPECTED_SPREAD.temperatureMaxC)
    : 0;

  // Temperature min consensus
  const minTemps = dailyData.map(d => d.temperatureMin);
  const minTempStats = computeStats(minTemps);
  const minTempAvailable = minTempStats.count >= 2;
  const minTempAgreement = minTempAvailable
    ? calculateAgreement(minTempStats.stdDev, DAILY_EXPECTED_SPREAD.temperatureMinC)
    : 0;

  // Precipitation consensus
  const precips = dailyData.map(d => d.precipitationSum);
  const precipStats = computeStats(precips);
  const precipAmountAvailable = precipStats.count >= 2;
  const precipAmountAgreement = precipAmountAvailable
    ? calculateAgreement(precipStats.stdDev, DAILY_EXPECTED_SPREAD.precipitationSumMm)
    : 0;

  // Precipitation probability max
  const precipProbValues = dailyData.map(d => d.precipitationProbabilityMax);
  const precipProbStats = computeStats(precipProbValues);
  const precipProbAvailable = precipProbStats.count >= 2;
  const precipProbAgreement = precipProbAvailable
    ? calculateAgreement(
      precipProbStats.stdDev,
      DAILY_EXPECTED_SPREAD.precipitationProbabilityMaxPct
    )
    : 0;

  const precipCombinedAvailable = precipAmountAvailable || precipProbAvailable;
  const precipCombinedAgreement = precipCombinedAvailable
    ? weightedAverage([
      {
        value: precipAmountAgreement,
        weight: PRECIPITATION_COMPONENT_WEIGHTS.amount,
        available: precipAmountAvailable
      },
      {
        value: precipProbAgreement,
        weight: PRECIPITATION_COMPONENT_WEIGHTS.probability,
        available: precipProbAvailable
      }
    ])
    : 0;

  // Wind speed consensus
  const winds = dailyData.map(d => d.windSpeedMax);
  const windStats = computeStats(winds);
  const windAvailable = windStats.count >= 2;
  const windAgreement = windAvailable
    ? calculateAgreement(windStats.stdDev, DAILY_EXPECTED_SPREAD.windSpeedMaxKmh)
    : 0;

  // Weather code consensus
  const codes = dailyData.map(d => d.weatherCode);
  const { code: dominantCode, agreement: codeAgreement, available: codeAvailable } = dominantWeatherCode(codes);

  // Overall daily agreement
  const overallAgreement = weightedAverage([
    { value: maxTempAgreement, weight: DAILY_OVERALL_WEIGHTS.temperatureMax, available: maxTempAvailable },
    { value: minTempAgreement, weight: DAILY_OVERALL_WEIGHTS.temperatureMin, available: minTempAvailable },
    { value: precipCombinedAgreement, weight: DAILY_OVERALL_WEIGHTS.precipitation, available: precipCombinedAvailable },
    { value: windAgreement, weight: DAILY_OVERALL_WEIGHTS.windSpeed, available: windAvailable },
    { value: codeAgreement, weight: DAILY_OVERALL_WEIGHTS.weatherCode, available: codeAvailable }
  ]);

  return {
    date,
    temperatureMax: {
      mean: roundTo(maxTempStats.mean, 1),
      min: roundTo(maxTempStats.min, 1),
      max: roundTo(maxTempStats.max, 1),
      stdDev: roundTo(maxTempStats.stdDev, 1),
      agreement: Math.round(maxTempAgreement),
      available: maxTempAvailable
    },
    temperatureMin: {
      mean: roundTo(minTempStats.mean, 1),
      min: roundTo(minTempStats.min, 1),
      max: roundTo(minTempStats.max, 1),
      stdDev: roundTo(minTempStats.stdDev, 1),
      agreement: Math.round(minTempAgreement),
      available: minTempAvailable
    },
    precipitation: {
      mean: roundTo(precipStats.mean, 1),
      min: roundTo(precipStats.min, 1),
      max: roundTo(precipStats.max, 1),
      agreement: Math.round(precipAmountAgreement),
      available: precipAmountAvailable
    },
    precipitationProbabilityMax: {
      mean: Math.round(precipProbStats.mean),
      min: Math.round(precipProbStats.min),
      max: Math.round(precipProbStats.max),
      agreement: Math.round(precipProbAgreement),
      available: precipProbAvailable
    },
    precipitationCombined: {
      agreement: Math.round(precipCombinedAgreement),
      available: precipCombinedAvailable,
      amountAgreement: Math.round(precipAmountAgreement),
      probabilityAgreement: Math.round(precipProbAgreement),
      amountAvailable: precipAmountAvailable,
      probabilityAvailable: precipProbAvailable
    },
    windSpeed: {
      mean: roundTo(windStats.mean, 1),
      agreement: Math.round(windAgreement),
      available: windAvailable
    },
    weatherCode: {
      dominant: dominantCode,
      agreement: Math.round(codeAgreement),
      available: codeAvailable
    },
    overallAgreement: Math.round(clampScore(overallAgreement))
  };
}

// Main consensus calculation function
export function calculateConsensus(forecasts: ModelForecast[]): ConsensusResult {
  const successfulForecasts = forecasts.filter(f => f.status === 'ok');
  const successfulModels = successfulForecasts.map(f => f.model.name);
  const failedModels = forecasts.filter(f => f.status === 'error').map(f => f.model.name);
  const freshness = calculateFreshness(forecasts, {
    nowSeconds: Date.now() / 1000,
    staleThresholdHours: FRESHNESS_STALE_THRESHOLD_HOURS,
    spreadThresholdHours: FRESHNESS_SPREAD_THRESHOLD_HOURS,
    maxPenalty: FRESHNESS_MAX_PENALTY
  });

  if (successfulModels.length < 2) {
    return {
      metrics: { overall: 0, temperature: 0, precipitation: 0, wind: 0, conditions: 0 },
      hourly: [],
      daily: [],
      modelCount: successfulModels.length,
      successfulModels,
      failedModels,
      isAvailable: false,
      freshness
    };
  }

  // Calculate hourly consensus
  const maxHours = Math.max(...successfulForecasts.map(f => f.hourly.length));
  const hourlyConsensus: HourlyConsensus[] = [];

  for (let i = 0; i < maxHours; i++) {
    const consensus = calculateHourlyConsensus(forecasts, i);
    if (consensus) hourlyConsensus.push(consensus);
  }

  // Calculate daily consensus
  const maxDays = Math.max(...successfulForecasts.map(f => f.daily.length));
  const dailyConsensus: DailyConsensus[] = [];

  for (let i = 0; i < maxDays; i++) {
    const consensus = calculateDailyConsensus(forecasts, i);
    if (consensus) dailyConsensus.push(consensus);
  }

  // Calculate overall metrics
  const tempAgreements = dailyConsensus
    .filter(d => d.temperatureMax.available && d.temperatureMin.available)
    .map(d => (d.temperatureMax.agreement + d.temperatureMin.agreement) / 2);
  const precipAgreements = dailyConsensus
    .filter(d => d.precipitationCombined.available)
    .map(d => d.precipitationCombined.agreement);
  const windAgreements = dailyConsensus
    .filter(d => d.windSpeed.available)
    .map(d => d.windSpeed.agreement);
  const conditionAgreements = dailyConsensus
    .filter(d => d.weatherCode.available)
    .map(d => d.weatherCode.agreement);

  const avgTempAgreement = safeAverage(tempAgreements);
  const avgPrecipAgreement = safeAverage(precipAgreements);
  const avgWindAgreement = safeAverage(windAgreements);
  const avgConditionsAgreement = safeAverage(conditionAgreements);

  const overallWeight = [
    { weight: FORECAST_OVERALL_WEIGHTS.temperature, available: tempAgreements.length > 0 },
    { weight: FORECAST_OVERALL_WEIGHTS.precipitation, available: precipAgreements.length > 0 },
    { weight: FORECAST_OVERALL_WEIGHTS.wind, available: windAgreements.length > 0 },
    { weight: FORECAST_OVERALL_WEIGHTS.conditions, available: conditionAgreements.length > 0 }
  ].reduce((sum, item) => sum + (item.available ? item.weight : 0), 0);

  const overallAgreement = overallWeight > 0
    ? weightedAverage([
      { value: avgTempAgreement, weight: FORECAST_OVERALL_WEIGHTS.temperature, available: tempAgreements.length > 0 },
      { value: avgPrecipAgreement, weight: FORECAST_OVERALL_WEIGHTS.precipitation, available: precipAgreements.length > 0 },
      { value: avgWindAgreement, weight: FORECAST_OVERALL_WEIGHTS.wind, available: windAgreements.length > 0 },
      { value: avgConditionsAgreement, weight: FORECAST_OVERALL_WEIGHTS.conditions, available: conditionAgreements.length > 0 }
    ])
    : 0;

  const seriesAvailable = hourlyConsensus.length > 0 && dailyConsensus.length > 0;
  const overallAgreementFinite = Number.isFinite(overallAgreement);
  const baseOverall = clampScore(overallAgreement);
  const consensusAvailable = seriesAvailable && overallWeight > 0 && overallAgreementFinite;

  if (!consensusAvailable) {
    return {
      metrics: { overall: 0, temperature: 0, precipitation: 0, wind: 0, conditions: 0 },
      hourly: [],
      daily: [],
      modelCount: successfulModels.length,
      successfulModels,
      failedModels,
      isAvailable: false,
      freshness
    };
  }

  return {
    metrics: {
      overall: Math.round(baseOverall),
      temperature: Math.round(avgTempAgreement),
      precipitation: Math.round(avgPrecipAgreement),
      wind: Math.round(avgWindAgreement),
      conditions: Math.round(avgConditionsAgreement)
    },
    hourly: hourlyConsensus,
    daily: dailyConsensus,
    modelCount: successfulModels.length,
    successfulModels,
    failedModels,
    isAvailable: true,
    freshness
  };
}

// Get confidence level label
export function getConfidenceLevel(score: number): {
  label: string;
  description: string;
  color: 'high' | 'medium' | 'low';
} {
  const safeScore = Number.isFinite(score) ? score : 0;

  if (safeScore >= AGREEMENT_LEVEL_THRESHOLDS.high) {
    return {
      label: 'High Confidence',
      description: 'Models are in strong agreement. Forecast is reliable.',
      color: 'high'
    };
  } else if (safeScore >= AGREEMENT_LEVEL_THRESHOLDS.moderate) {
    return {
      label: 'Moderate Confidence',
      description: 'Some model disagreement. Consider checking back for updates.',
      color: 'medium'
    };
  } else {
    return {
      label: 'Low Confidence',
      description: 'Significant model disagreement. Weather pattern is uncertain.',
      color: 'low'
    };
  }
}
