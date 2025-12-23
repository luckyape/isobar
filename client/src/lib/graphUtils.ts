import type { HourlyForecast, ModelForecast } from '@/lib/weatherApi';
import { filterFiniteNumbers } from '@/lib/consensusMath';

export type PrecipConsensusPoint = {
  pop: number | null;
  intensity: number | null;
  popCount: number;
  intensityCount: number;
};

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
