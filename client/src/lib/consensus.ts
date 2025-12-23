/**
 * Consensus Calculation - Arctic Data Observatory
 * Normalizes and compares weather model forecasts to calculate agreement scores
 */

import { normalizeWeatherCode, type ModelForecast } from './weatherApi';
import {
  calculateAgreement,
  calculateFreshness,
  clampScore,
  computeStats,
  filterFiniteNumbers
} from './consensusMath';

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
    !f.error && f.hourly[timeIndex]
  );
  
  if (validForecasts.length === 0) return null;
  
  const hourlyData = validForecasts.map(f => f.hourly[timeIndex]);
  const time = hourlyData[0].time;
  
  // Temperature consensus
  const temps = hourlyData.map(h => h.temperature);
  const tempStats = computeStats(temps);
  const tempAvailable = tempStats.count >= 2;
  const tempAgreement = tempAvailable ? calculateAgreement(tempStats.stdDev, 10) : 0;
  
  // Precipitation consensus
  const precips = hourlyData.map(h => h.precipitation);
  const precipStats = computeStats(precips);
  const precipAvailable = precipStats.count >= 2;
  const precipAgreement = precipAvailable ? calculateAgreement(precipStats.stdDev, 5) : 0;
  
  // Precipitation probability
  const precipProbs = hourlyData.map(h => h.precipitationProbability);
  const precipProbStats = computeStats(precipProbs);
  const precipProbAvailable = precipProbStats.count >= 2;
  const precipProbAgreement = precipProbAvailable
    ? calculateAgreement(precipProbStats.stdDev, 30)
    : 0;
  
  // Wind speed consensus
  const winds = hourlyData.map(h => h.windSpeed);
  const windStats = computeStats(winds);
  const windAvailable = windStats.count >= 2;
  const windAgreement = windAvailable ? calculateAgreement(windStats.stdDev, 15) : 0;
  
  // Wind direction consensus (circular)
  const windDirs = hourlyData.map(h => h.windDirection);
  const windDirValues = filterFiniteNumbers(windDirs);
  const windDirMean = windDirValues.length ? circularMean(windDirValues) : 0;
  const windDirAvailable = windDirValues.length >= 2;
  const windDirStdDev = windDirAvailable ? circularStdDev(windDirValues) : 0;
  const windDirAgreement = windDirAvailable ? calculateAgreement(windDirStdDev, 45) : 0;
  
  // Cloud cover consensus
  const clouds = hourlyData.map(h => h.cloudCover);
  const cloudStats = computeStats(clouds);
  const cloudAvailable = cloudStats.count >= 2;
  const cloudAgreement = cloudAvailable ? calculateAgreement(cloudStats.stdDev, 30) : 0;
  
  // Weather code consensus
  const codes = hourlyData.map(h => h.weatherCode);
  const { code: dominantCode, agreement: codeAgreement, available: codeAvailable } = dominantWeatherCode(codes);
  
  // Overall hourly agreement (weighted average)
  const overallAgreement = weightedAverage([
    { value: tempAgreement, weight: 0.3, available: tempAvailable },
    { value: precipAgreement, weight: 0.25, available: precipAvailable },
    { value: windAgreement, weight: 0.2, available: windAvailable },
    { value: codeAgreement, weight: 0.15, available: codeAvailable },
    { value: cloudAgreement, weight: 0.1, available: cloudAvailable }
  ]);
  
  return {
    time,
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
      agreement: Math.round(precipAgreement),
      available: precipAvailable
    },
    precipitationProbability: {
      mean: Math.round(precipProbStats.mean),
      min: Math.round(precipProbStats.min),
      max: Math.round(precipProbStats.max),
      agreement: Math.round(precipProbAgreement),
      available: precipProbAvailable
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
    !f.error && f.daily[dayIndex]
  );
  
  if (validForecasts.length === 0) return null;
  
  const dailyData = validForecasts.map(f => f.daily[dayIndex]);
  const date = dailyData[0].date;
  
  // Temperature max consensus
  const maxTemps = dailyData.map(d => d.temperatureMax);
  const maxTempStats = computeStats(maxTemps);
  const maxTempAvailable = maxTempStats.count >= 2;
  const maxTempAgreement = maxTempAvailable ? calculateAgreement(maxTempStats.stdDev, 8) : 0;
  
  // Temperature min consensus
  const minTemps = dailyData.map(d => d.temperatureMin);
  const minTempStats = computeStats(minTemps);
  const minTempAvailable = minTempStats.count >= 2;
  const minTempAgreement = minTempAvailable ? calculateAgreement(minTempStats.stdDev, 8) : 0;
  
  // Precipitation consensus
  const precips = dailyData.map(d => d.precipitationSum);
  const precipStats = computeStats(precips);
  const precipAvailable = precipStats.count >= 2;
  const precipAgreement = precipAvailable ? calculateAgreement(precipStats.stdDev, 15) : 0;
  
  // Wind speed consensus
  const winds = dailyData.map(d => d.windSpeedMax);
  const windStats = computeStats(winds);
  const windAvailable = windStats.count >= 2;
  const windAgreement = windAvailable ? calculateAgreement(windStats.stdDev, 20) : 0;
  
  // Weather code consensus
  const codes = dailyData.map(d => d.weatherCode);
  const { code: dominantCode, agreement: codeAgreement, available: codeAvailable } = dominantWeatherCode(codes);
  
  // Overall daily agreement
  const overallAgreement = weightedAverage([
    { value: maxTempAgreement, weight: 0.25, available: maxTempAvailable },
    { value: minTempAgreement, weight: 0.25, available: minTempAvailable },
    { value: precipAgreement, weight: 0.25, available: precipAvailable },
    { value: windAgreement, weight: 0.15, available: windAvailable },
    { value: codeAgreement, weight: 0.1, available: codeAvailable }
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
      agreement: Math.round(precipAgreement),
      available: precipAvailable
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
  const successfulForecasts = forecasts.filter(f => !f.error);
  const successfulModels = successfulForecasts.map(f => f.model.name);
  const failedModels = forecasts.filter(f => f.error).map(f => f.model.name);
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
    .filter(d => d.precipitation.available)
    .map(d => d.precipitation.agreement);
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
    { weight: 0.35, available: tempAgreements.length > 0 },
    { weight: 0.30, available: precipAgreements.length > 0 },
    { weight: 0.20, available: windAgreements.length > 0 },
    { weight: 0.15, available: conditionAgreements.length > 0 }
  ].reduce((sum, item) => sum + (item.available ? item.weight : 0), 0);

  const overallAgreement = overallWeight > 0
    ? weightedAverage([
        { value: avgTempAgreement, weight: 0.35, available: tempAgreements.length > 0 },
        { value: avgPrecipAgreement, weight: 0.30, available: precipAgreements.length > 0 },
        { value: avgWindAgreement, weight: 0.20, available: windAgreements.length > 0 },
        { value: avgConditionsAgreement, weight: 0.15, available: conditionAgreements.length > 0 }
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

  if (safeScore >= 75) {
    return {
      label: 'High Confidence',
      description: 'Models are in strong agreement. Forecast is reliable.',
      color: 'high'
    };
  } else if (safeScore >= 50) {
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
