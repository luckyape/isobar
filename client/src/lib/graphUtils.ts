import type { HourlyForecast, ModelForecast } from '@/lib/weatherApi';
import type { HourlyConsensus } from '@/lib/consensus';
import { filterFiniteNumbers } from '@/lib/consensusMath';
import {
  formatHourLabel,
  formatWeekdayHourLabel,
  parseOpenMeteoDateTime
} from '@/lib/timeUtils';

export type PrecipConsensusPoint = {
  pop: number | null;
  intensity: number | null;
  popCount: number;
  intensityCount: number;
};

export type HourlySpine = {
  slotEpochs: number[];
  slotTimeKeys: string[];
  currentTimeKey: string | null;
};

export type HourlyTemperatureSeriesPoint = {
  time: string;
  epoch: number | null;
  label: string;
  fullLabel: string;
  observed?: number;
  consensusMean?: number;
  consensusMin?: number;
  consensusMax?: number;
  temperatureAgreement?: number;
  overallAgreement?: number;
  [key: string]: unknown;
};

export function buildHourlySpine({
  forecasts,
  consensus = [],
  showConsensus = true,
  fallbackForecast = null,
  timezone,
  nowMs,
  maxWindowHours = 48,
  maxPastHours = 24
}: {
  forecasts: ModelForecast[];
  consensus?: HourlyConsensus[];
  showConsensus?: boolean;
  fallbackForecast?: ModelForecast | null;
  timezone?: string;
  nowMs?: number;
  maxWindowHours?: number;
  maxPastHours?: number;
}): HourlySpine {
  const baseForecast = fallbackForecast
    || forecasts.find((forecast) => !forecast.error && forecast.hourly.length > 0)
    || null;

  const epochByTime = new Map<string, number>();
  baseForecast?.hourly?.forEach((hour) => {
    if (hour?.time && Number.isFinite(hour.epoch ?? NaN)) {
      epochByTime.set(hour.time, hour.epoch as number);
    }
  });

  let baseItems: { time: string; epoch: number }[] = [];
  if (showConsensus && consensus.length > 0) {
    baseItems = consensus
      .map((hour) => {
        const epoch = Number.isFinite(hour.epoch ?? NaN)
          ? (hour.epoch as number)
          : epochByTime.get(hour.time);
        if (!hour.time || !Number.isFinite(epoch ?? NaN)) return null;
        return { time: hour.time, epoch: epoch as number };
      })
      .filter((item): item is { time: string; epoch: number } => Boolean(item));
  } else if (baseForecast?.hourly) {
    baseItems = baseForecast.hourly
      .filter((hour) => hour?.time && Number.isFinite(hour.epoch ?? NaN))
      .map((hour) => ({ time: hour.time, epoch: hour.epoch as number }));
  }

  if (baseItems.length === 0) {
    return { slotEpochs: [], slotTimeKeys: [], currentTimeKey: null };
  }

  const sortedItems = [...baseItems].sort((a, b) => a.epoch - b.epoch);
  const resolvedNowMs = Number.isFinite(nowMs ?? NaN) ? (nowMs as number) : Date.now();
  const anchorEpoch = Math.floor(resolvedNowMs / 3600000) * 3600000;
  const futureStartIndex = sortedItems.findIndex((item) => item.epoch >= anchorEpoch);
  const boundedFutureStart = futureStartIndex === -1 ? sortedItems.length : futureStartIndex;
  const totalSlots = Math.max(0, maxWindowHours);
  const pastSlots = Math.min(maxPastHours, boundedFutureStart);
  const futureSlots = Math.max(0, totalSlots - pastSlots);
  let startIndex = Math.max(0, boundedFutureStart - pastSlots);
  let endIndex = Math.min(sortedItems.length, boundedFutureStart + futureSlots);
  if (endIndex - startIndex < totalSlots) {
    startIndex = Math.max(0, endIndex - totalSlots);
  }
  const windowItems = sortedItems.slice(startIndex, endIndex);

  const lastCompletedEpoch = anchorEpoch - 3600000;
  let currentTimeKey: string | null = null;
  for (let i = sortedItems.length - 1; i >= 0; i -= 1) {
    if (sortedItems[i].epoch <= lastCompletedEpoch) {
      currentTimeKey = sortedItems[i].time;
      break;
    }
  }

  return {
    slotEpochs: windowItems.map((item) => item.epoch),
    slotTimeKeys: windowItems.map((item) => item.time),
    currentTimeKey
  };
}

export function getSlotIndexAtX({
  width,
  x,
  slotCount,
  marginLeft = 0,
  marginRight = 0
}: {
  width: number;
  x: number;
  slotCount: number;
  marginLeft?: number;
  marginRight?: number;
}): number {
  if (!Number.isFinite(width) || width <= 0 || slotCount <= 1) return 0;
  const innerWidth = Math.max(1, width - marginLeft - marginRight);
  const clampedX = Math.max(0, Math.min(innerWidth, x - marginLeft));
  const bandSize = innerWidth / slotCount;
  const index = Math.floor(clampedX / bandSize);
  return Math.min(slotCount - 1, Math.max(0, index));
}

export function buildHourlyTemperatureSeries({
  forecasts,
  consensus = [],
  showConsensus = true,
  fallbackForecast = null,
  timezone,
  observedTempByEpoch,
  nowMs,
  maxWindowHours = 48,
  maxPastHours = 24
}: {
  forecasts: ModelForecast[];
  consensus?: HourlyConsensus[];
  showConsensus?: boolean;
  fallbackForecast?: ModelForecast | null;
  timezone?: string;
  observedTempByEpoch?: Map<number, number>;
  nowMs?: number;
  maxWindowHours?: number;
  maxPastHours?: number;
}): {
  points: HourlyTemperatureSeriesPoint[];
  currentTimeKey: string | null;
  slotEpochs: number[];
  slotTimeKeys: string[];
  observedCount: number;
} {
  const spine = buildHourlySpine({
    forecasts,
    consensus,
    showConsensus,
    fallbackForecast,
    timezone,
    nowMs,
    maxWindowHours,
    maxPastHours
  });
  const slotCount = Math.min(spine.slotEpochs.length, spine.slotTimeKeys.length);
  if (slotCount === 0) {
    return {
      points: [],
      currentTimeKey: spine.currentTimeKey,
      slotEpochs: spine.slotEpochs,
      slotTimeKeys: spine.slotTimeKeys,
      observedCount: 0
    };
  }

  const slotEpochs = spine.slotEpochs.slice(0, slotCount);
  const slotTimeKeys = spine.slotTimeKeys.slice(0, slotCount);
  const hasConsensus = showConsensus && consensus.length > 0;
  const consensusByTime = hasConsensus
    ? new Map(consensus.map((hour) => [hour.time, hour]))
    : new Map<string, HourlyConsensus>();

  const modelTemperatureById = new Map<string, Map<string, number>>();
  forecasts.forEach((forecast) => {
    if (forecast.error) return;
    const temps = new Map<string, number>();
    forecast.hourly.forEach((hour) => {
      if (Number.isFinite(hour.temperature)) {
        temps.set(hour.time, hour.temperature);
      }
    });
    modelTemperatureById.set(forecast.model.id, temps);
  });

  const resolvedNowMs = Number.isFinite(nowMs ?? NaN) ? (nowMs as number) : Date.now();
  const observedEntries = Array.from(observedTempByEpoch?.entries() ?? [])
    .filter(([epoch, value]) => Number.isFinite(epoch) && Number.isFinite(value))
    .sort((a, b) => a[0] - b[0]);
  const firstObserved = observedEntries.length > 0
    ? { epoch: observedEntries[0][0], value: observedEntries[0][1] }
    : null;
  let observedIndex = 0;
  let lastObserved: { epoch: number; value: number } | null = null;
  let observedCount = 0;

  const points = slotTimeKeys.map((time, index) => {
    const timeParts = parseOpenMeteoDateTime(time);
    const slotEpoch = slotEpochs[index];
    const parsedEpoch = new Date(time).getTime();
    const slotEpochMs = Number.isFinite(slotEpoch ?? NaN)
      ? (slotEpoch as number)
      : Number.isFinite(parsedEpoch ?? NaN)
        ? parsedEpoch
        : null;
    const dataPoint: HourlyTemperatureSeriesPoint = {
      time,
      epoch: slotEpochMs,
      label: timeParts ? formatHourLabel(timeParts) : time,
      fullLabel: timeParts ? formatWeekdayHourLabel(timeParts) : time
    };

    if (slotEpochMs !== null && observedEntries.length > 0) {
      while (observedIndex < observedEntries.length && observedEntries[observedIndex][0] <= slotEpochMs) {
        const [epoch, value] = observedEntries[observedIndex];
        lastObserved = { epoch, value };
        observedIndex += 1;
      }

      if (slotEpochMs <= resolvedNowMs) {
        if (lastObserved) {
          dataPoint.observed = lastObserved.value;
          observedCount += 1;
        } else if (firstObserved) {
          // Backfill earliest observed so hover/tooltips stay populated on sparse data.
          dataPoint.observed = firstObserved.value;
          observedCount += 1;
        }
      }
    }

    if (hasConsensus) {
      const consensusPoint = consensusByTime.get(time);
      if (consensusPoint) {
        dataPoint.consensusMean = consensusPoint.temperature.mean;
        dataPoint.consensusMin = consensusPoint.temperature.min;
        dataPoint.consensusMax = consensusPoint.temperature.max;
        dataPoint.temperatureAgreement = consensusPoint.temperature.agreement;
        dataPoint.overallAgreement = consensusPoint.overallAgreement;
      }
    }

    forecasts.forEach((forecast) => {
      if (forecast.error) return;
      const modelTemps = modelTemperatureById.get(forecast.model.id);
      const value = modelTemps?.get(time);
      if (value !== undefined) {
        dataPoint[forecast.model.id] = value;
      }
    });

    return dataPoint;
  });

  return {
    points,
    currentTimeKey: spine.currentTimeKey,
    slotEpochs,
    slotTimeKeys,
    observedCount
  };
}

export function buildHourlyForecastMap(
  forecasts: ModelForecast[]
): Map<string, Map<string, HourlyForecast>> {
  const map = new Map<string, Map<string, HourlyForecast>>();
  forecasts.forEach((forecast) => {
    if (forecast.error || !forecast.hourly?.length) return;
    const hourlyMap = new Map<string, HourlyForecast>();
    forecast.hourly.forEach((hour) => {
      if (!hour?.time) return;
      hourlyMap.set(hour.time, hour);
    });
    map.set(forecast.model.id, hourlyMap);
  });
  return map;
}

export function median(values: number[]): number | null {
  const finite = filterFiniteNumbers(values).sort((a, b) => a - b);
  if (finite.length === 0) return null;
  const mid = Math.floor(finite.length / 2);
  if (finite.length % 2 === 0) {
    return (finite[mid - 1] + finite[mid]) / 2;
  }
  return finite[mid];
}

export function buildPrecipMedianConsensus(
  times: string[],
  modelIds: string[],
  hourlyByModelId: Map<string, Map<string, HourlyForecast>>
): Map<string, PrecipConsensusPoint> {
  const consensus = new Map<string, PrecipConsensusPoint>();
  times.forEach((time) => {
    const pops: number[] = [];
    const intensities: number[] = [];
    modelIds.forEach((modelId) => {
      const hour = hourlyByModelId.get(modelId)?.get(time);
      if (!hour) return;
      if (Number.isFinite(hour.precipitationProbability)) {
        pops.push(hour.precipitationProbability);
      }
      if (Number.isFinite(hour.precipitation)) {
        intensities.push(hour.precipitation);
      }
    });

    consensus.set(time, {
      pop: median(pops),
      intensity: median(intensities),
      popCount: pops.length,
      intensityCount: intensities.length
    });
  });
  return consensus;
}

export function getPrecipIntensityColor(intensity: number): string {
  if (!Number.isFinite(intensity) || intensity <= 0) {
    return 'oklch(0.18 0.01 220)';
  }
  // Louder chroma + wider lightness spread so “heavier rain looks heavier”.
  if (intensity <= 0.2) return 'oklch(0.36 0.10 195)';   // trace
  if (intensity <= 0.5) return 'oklch(0.44 0.14 195)';   // light
  if (intensity <= 1.5) return 'oklch(0.52 0.17 195)';   // moderate
  if (intensity <= 3)   return 'oklch(0.58 0.20 200)';   // heavy
  if (intensity <= 6)   return 'oklch(0.64 0.22 205)';   // very heavy
  return 'oklch(0.70 0.24 210)';                         // extreme
}
