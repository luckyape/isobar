/**
 * DailyForecast Component - Arctic Data Observatory
 * Shows 7-day forecast with model agreement indicators
 */

import { memo, useCallback, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDownIcon, ArrowUp } from 'lucide-react';
import { ModelCaretIcon } from '@/components/ModelCaretIcon';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle
} from '@/components/ui/drawer';
import {
  ComparisonTooltipCard,
  ComparisonTooltipRow,
  ComparisonTooltipSection
} from '@/components/ComparisonTooltip';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { WEATHER_CODES } from '@/lib/weatherApi';
import type {
  DailyForecast as ModelDailyForecast,
  HourlyForecast,
  ModelForecast
} from '@/lib/weatherApi';
import type { DailyConsensus, HourlyConsensus } from '@/lib/consensus';
import { getConfidenceLevel } from '@/lib/consensus';
import { median } from '@/lib/graphUtils';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import {
  addDays,
  findCurrentHourIndex,
  formatCalendarDate,
  getZonedNowParts,
  isSameDate,
  parseOpenMeteoDate
} from '@/lib/timeUtils';

interface DailyForecastProps {
  daily: DailyConsensus[];
  hourly?: HourlyConsensus[];
  forecasts: ModelForecast[];
  showAgreement?: boolean;
  timezone?: string;
}

const MODEL_ORDER = ['ECMWF', 'GFS', 'ICON', 'GEM'] as const;
const MODEL_ORDER_SET = new Set<string>(MODEL_ORDER);
const TOOLTIP_CONTENT_CLASSNAME =
  'p-0 bg-transparent shadow-none border-none text-foreground [&>svg]:hidden';

type ModelBreakdownEntry = {
  name: string;
  color: string;
  daily?: ModelDailyForecast;
  runAvailabilityTime?: number | null;
};

type ModelHourlyEntry = {
  name: string;
  color: string;
  hour?: HourlyForecast;
  runAvailabilityTime?: number | null;
};

type OutlierInfo = {
  name: string;
  ratio: number;
};

function formatAgeShort(seconds: number) {
  const totalMinutes = Math.max(0, Math.floor(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  if (hours > 0) return `${hours}h`;
  return `${totalMinutes}m`;
}

function formatAgeLong(seconds: number) {
  const totalMinutes = Math.max(0, Math.floor(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatMmPerHourShort(value: number | null) {
  if (value === null) return '—';
  if (!Number.isFinite(value)) return '—';
  if (value >= 0 && value < 0.05) return '<0.1';
  return String(Math.round(value * 10) / 10);
}

function formatRunTime(seconds: number, timezone?: string) {
  const date = new Date(seconds * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone ?? 'UTC',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function getNumeric(value?: number) {
  return Number.isFinite(value) ? (value as number) : null;
}

function getOutlierInfo(
  values: Array<{ name: string; value: number | null }>,
  spread: number | null,
  minSpread: number
): OutlierInfo | null {
  if (spread === null || spread < minSpread || spread <= 0) return null;
  const numeric = values.filter((entry): entry is { name: string; value: number } =>
    entry.value !== null
  );
  if (numeric.length < 2) return null;
  const medianValue = median(numeric.map((entry) => entry.value));
  if (medianValue === null) return null;
  const distances = numeric.map((entry) => ({
    name: entry.name,
    distance: Math.abs(entry.value - medianValue)
  }));
  distances.sort((a, b) => b.distance - a.distance);
  if (distances[0].distance <= 0) return null;
  const secondDistance = distances[1]?.distance ?? 0;
  if (distances[0].distance - secondDistance <= spread * 0.15) return null;
  return {
    name: distances[0].name,
    ratio: Math.min(1, distances[0].distance / spread)
  };
}

function getSpread(values: Array<number | null>) {
  const numeric = values.filter((value): value is number => value !== null);
  if (numeric.length < 2) return null;
  return Math.max(...numeric) - Math.min(...numeric);
}

function getMode(values: Array<number | null>) {
  const counts = new Map<number, number>();
  values.forEach((value) => {
    if (value === null) return;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  if (counts.size === 0) return null;
  const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const topCount = ranked[0][1];
  const hasTie = ranked.length > 1 && ranked[1][1] === topCount;
  if (topCount <= 1 || hasTie) return null;
  return ranked[0][0];
}

function getAgreementColor(agreement: number) {
  const { color } = getConfidenceLevel(agreement);
  const colors = {
    high: 'bg-agreement-high',
    medium: 'bg-agreement-medium',
    low: 'bg-agreement-low'
  };
  return colors[color];
}

function getAgreementBorder(agreement: number) {
  const { color } = getConfidenceLevel(agreement);
  const colors = {
    high: 'border-agreement-high',
    medium: 'border-agreement-medium',
    low: 'border-agreement-low'
  };
  return colors[color];
}

function withAlpha(color: string, alpha: number) {
  if (!color) return color;
  if (color.includes('oklch(')) {
    return color.replace(')', ` / ${alpha})`);
  }
  return color;
}

function getFreshnessTone(ageHours: number | null) {
  if (ageHours === null) return 'unknown';
  if (ageHours <= 6) return 'fresh';
  if (ageHours <= 12) return 'aging';
  return 'stale';
}

function buildOutlierStyle(ratio: number | null, minRatio = 0.35) {
  if (ratio === null || ratio <= minRatio) return undefined;
  const intensity = Math.min(1, Math.max(0, (ratio - minRatio) / (1 - minRatio)));
  const ringAlpha = 0.05 + (0.18 - 0.05) * intensity;
  const glowAlpha = 0.015 + (0.02 - 0.015) * intensity;
  return {
    boxShadow: `0 0 0 1px oklch(0.75 0.18 85 / ${ringAlpha}), 0 0 8px oklch(0.75 0.18 85 / ${glowAlpha})`
  };
}

const freshnessToneClass: Record<string, string> = {
  fresh: 'bg-agreement-high',
  aging: 'bg-agreement-medium',
  stale: 'bg-agreement-low',
  unknown: 'bg-white/20'
};

export const ModelBreakdownPanel = memo(function ModelBreakdownPanel({
  day,
  dayIndex,
  forecasts,
  modelNames,
  timezone,
  className
}: {
  day: DailyConsensus;
  dayIndex: number;
  forecasts: ModelForecast[];
  modelNames?: string[];
  timezone?: string;
  className?: string;
}) {
  const modelOrder = useMemo<string[]>(() => {
    if (!modelNames?.length) {
      return [...MODEL_ORDER];
    }
    const uniqueNames = Array.from(new Set(modelNames));
    const ordered = MODEL_ORDER.filter((name) => uniqueNames.includes(name));
    const extras = uniqueNames.filter((name) => !MODEL_ORDER_SET.has(name));
    return [...ordered, ...extras];
  }, [modelNames]);

  const modelEntries = useMemo<ModelBreakdownEntry[]>(() => {
    const forecastByName = new Map(forecasts.map((forecast) => [forecast.model.name, forecast]));
    const includeMissing = !modelNames?.length;
    return modelOrder.flatMap<ModelBreakdownEntry>((name) => {
      const forecast = forecastByName.get(name);
      if (!forecast || forecast.error) {
        if (!includeMissing) {
          return [];
        }
        return [{
          name,
          color: forecast?.model.color ?? 'oklch(0.95 0.01 240)',
          daily: undefined,
          runAvailabilityTime: null
        }];
      }
      const daily = forecast.daily.find((entry) => entry.date === day.date)
        ?? forecast.daily[dayIndex];
      const runAvailabilityTime = Number.isFinite(forecast.runAvailabilityTime)
        ? (forecast.runAvailabilityTime as number)
        : null;
      return [{
        name,
        color: forecast.model.color,
        daily,
        runAvailabilityTime
      }];
    });
  }, [day.date, dayIndex, forecasts, modelNames, modelOrder]);

  const tempHighs = modelEntries.map((entry) => getNumeric(entry.daily?.temperatureMax));
  const tempLows = modelEntries.map((entry) => getNumeric(entry.daily?.temperatureMin));
  const precipTotals = modelEntries.map((entry) => getNumeric(entry.daily?.precipitationSum));
  const windSpeeds = modelEntries.map((entry) => getNumeric(entry.daily?.windSpeedMax));

  const tempHighValues = tempHighs.filter((value): value is number => value !== null);
  const tempLowValues = tempLows.filter((value): value is number => value !== null);
  const tempHighSpread = getSpread(tempHighs);
  const tempLowSpread = getSpread(tempLows);
  const precipSpread = getSpread(precipTotals);
  const windSpread = getSpread(windSpeeds);
  const tempSpreadMax = Math.max(tempHighSpread ?? 0, tempLowSpread ?? 0);
  const tempSpreadSum = (tempHighSpread ?? 0) + (tempLowSpread ?? 0);
  const tempMedianHigh = median(tempHighValues);
  const tempMedianLow = median(tempLowValues);

  const tempOutlier = useMemo<OutlierInfo | null>(() => {
    if (tempMedianHigh === null || tempMedianLow === null) return null;
    if (tempHighValues.length < 2 || tempLowValues.length < 2) return null;
    if (tempSpreadMax < 2 || tempSpreadSum <= 0) return null;
    const distances = modelEntries.reduce<Array<{ name: string; distance: number }>>((acc, entry) => {
      const high = getNumeric(entry.daily?.temperatureMax);
      const low = getNumeric(entry.daily?.temperatureMin);
      if (high === null || low === null) return acc;
      acc.push({
        name: entry.name,
        distance: Math.abs(high - tempMedianHigh) + Math.abs(low - tempMedianLow)
      });
      return acc;
    }, []);
    if (distances.length < 2) return null;
    distances.sort((a, b) => b.distance - a.distance);
    if (distances[0].distance <= 0) return null;
    const secondDistance = distances[1]?.distance ?? 0;
    if (distances[0].distance - secondDistance <= tempSpreadSum * 0.15) return null;
    return {
      name: distances[0].name,
      ratio: Math.min(1, distances[0].distance / tempSpreadSum)
    };
  }, [
    modelEntries,
    tempMedianHigh,
    tempMedianLow,
    tempHighValues.length,
    tempLowValues.length,
    tempSpreadMax,
    tempSpreadSum
  ]);

  const precipOutlier = useMemo(() => (
    getOutlierInfo(
      modelEntries.map((entry) => ({
        name: entry.name,
        value: getNumeric(entry.daily?.precipitationSum)
      })),
      precipSpread,
      2
    )
  ), [modelEntries, precipSpread]);

  const windOutlier = useMemo(() => (
    getOutlierInfo(
      modelEntries.map((entry) => ({
        name: entry.name,
        value: getNumeric(entry.daily?.windSpeedMax)
      })),
      windSpread,
      6
    )
  ), [modelEntries, windSpread]);

  const conditionValues = modelEntries
    .map((entry) => getNumeric(entry.daily?.weatherCode))
    .filter((value): value is number => value !== null);
  const conditionsMode = getMode(conditionValues);
  const conditionOutliers = new Set(
    modelEntries
      .filter((entry) => {
        const code = getNumeric(entry.daily?.weatherCode);
        return conditionsMode !== null && code !== null && code !== conditionsMode;
      })
      .map((entry) => entry.name)
  );
  const hasConditionDisagreement = conditionValues.length > 1
    ? new Set(conditionValues).size > 1
    : false;
  const conditionAgreement = day.weatherCode?.available === false
    ? null
    : day.weatherCode?.agreement ?? null;
  const conditionOutlierRatio = conditionAgreement !== null && conditionAgreement < 100
    ? Math.min(1, (100 - conditionAgreement) / 50)
    : null;

  const spreadCandidates = [
    {
      key: 'temperature',
      label: 'temperature',
      value: Math.max(tempHighSpread ?? 0, tempLowSpread ?? 0),
      unit: '°'
    },
    { key: 'precipitation', label: 'precipitation', value: precipSpread ?? 0, unit: ' mm' },
    { key: 'wind', label: 'wind', value: windSpread ?? 0, unit: ' km/h' }
  ].filter((candidate) => candidate.value > 0);

  const maxSpread = spreadCandidates.reduce<{ label: string; value: number; unit: string } | null>(
    (current, candidate) => {
      if (!current || candidate.value > current.value) {
        return { label: candidate.label, value: candidate.value, unit: candidate.unit };
      }
      return current;
    },
    null
  );

  const agreementLabel = day.overallAgreement >= 75
    ? 'High agreement'
    : day.overallAgreement >= 50
      ? 'Moderate agreement'
      : 'Low agreement';

  const nowSeconds = Date.now() / 1000;
  const staleCount = modelEntries.filter((entry) => {
    if (entry.runAvailabilityTime === null) return false;
    return (nowSeconds - (entry.runAvailabilityTime as number)) / 3600 > 12;
  }).length;
  const freshnessNote = staleCount > 0 ? `${staleCount} stale model${staleCount > 1 ? 's' : ''}` : null;

  const hasConditionOutliers = conditionOutliers.size > 0 || hasConditionDisagreement;
  const reasonLine = day.overallAgreement >= 75
    ? `${agreementLabel}: models aligned across all metrics.`
    : maxSpread
      ? `${agreementLabel} driven by ${maxSpread.label} spread (${Math.round(maxSpread.value)}${maxSpread.unit}).`
      : hasConditionOutliers
        ? `${agreementLabel} driven by conditions disagreement.`
        : `${agreementLabel}: limited model agreement data.`;
  const reasonWithFreshness = freshnessNote
    ? `${reasonLine} Freshness: ${freshnessNote}.`
    : reasonLine;

  return (
    <div className={cn('rounded-lg border border-white/10 bg-white/[0.02] p-3', className)}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {modelEntries.map((entry) => {
          const high = getNumeric(entry.daily?.temperatureMax);
          const low = getNumeric(entry.daily?.temperatureMin);
          const precip = getNumeric(entry.daily?.precipitationSum);
          const wind = getNumeric(entry.daily?.windSpeedMax);
          const code = getNumeric(entry.daily?.weatherCode);
          const weatherInfo = code !== null ? WEATHER_CODES[code] : null;
          const ageSeconds = entry.runAvailabilityTime !== null
            ? Math.max(0, nowSeconds - (entry.runAvailabilityTime as number))
            : null;
          const ageLabel = ageSeconds !== null ? formatAgeShort(ageSeconds) : '—';
          const ageLong = ageSeconds !== null ? formatAgeLong(ageSeconds) : '—';
          const ageShort = ageLabel;
          const ageHours = ageSeconds !== null ? ageSeconds / 3600 : null;
          const freshnessTone = getFreshnessTone(ageHours);
          const tempValue = high !== null && low !== null
            ? `${Math.round(high)}° / ${Math.round(low)}°`
            : '—';
          const precipValue = precip !== null ? `${Math.round(precip)} mm` : '—';
          const windValue = wind !== null ? `${Math.round(wind)} km/h` : '—';
          const tempOutlierStyle = tempOutlier?.name === entry.name
            ? buildOutlierStyle(tempOutlier.ratio, 0.3)
            : undefined;
          const precipOutlierStyle = precipOutlier?.name === entry.name
            ? buildOutlierStyle(precipOutlier.ratio, 0.35)
            : undefined;
          const windOutlierStyle = windOutlier?.name === entry.name
            ? buildOutlierStyle(windOutlier.ratio, 0.35)
            : undefined;
          const conditionOutlierStyle = conditionOutliers.has(entry.name) && conditionOutlierRatio !== null
            ? buildOutlierStyle(conditionOutlierRatio, 0.2)
            : undefined;
          const cardStyle = entry.color
            ? { background: `linear-gradient(135deg, ${withAlpha(entry.color, 0.08)}, oklch(0.12 0.02 240))` }
            : undefined;
          return (
            <div
              key={entry.name}
              className="rounded-lg bg-background px-3 py-2 text-foreground/90"
              style={cardStyle}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[11px] text-foreground/80">
                  <span
                    className="h-2.5 w-2.5 triangle-icon"
                    style={{ backgroundColor: entry.color }}
                  />
                  <span className="font-medium">{entry.name}</span>
                </div>
                <span className={`h-2 w-2 rounded-full ${freshnessToneClass[freshnessTone]}`} />
              </div>
              <div className="mt-1 text-[10px] text-foreground/60">
                {entry.runAvailabilityTime !== null ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="font-mono tabular-nums text-foreground/60"
                      >
                        {ageShort}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className={TOOLTIP_CONTENT_CLASSNAME}>
                      <ComparisonTooltipCard title={`${entry.name} run`}>
                        <ComparisonTooltipSection>
                          <ComparisonTooltipRow
                            label="Age"
                            value={`${ageLong} ago`}
                          />
                          <ComparisonTooltipRow
                            label="Updated"
                            value={formatRunTime(entry.runAvailabilityTime as number, timezone)}
                          />
                        </ComparisonTooltipSection>
                      </ComparisonTooltipCard>
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <span className="font-mono tabular-nums">—</span>
                )}
              </div>
              <div
                className="mt-2 rounded-md px-2 py-1 font-mono text-base tabular-nums"
                style={tempOutlierStyle}
              >
                {tempValue}
              </div>
              <div className="mt-2 space-y-1 text-[11px] text-foreground/70">
                <div
                  className="flex items-center justify-between rounded-md bg-white/[0.02] px-2 py-1"
                  style={precipOutlierStyle}
                >
                  <span>Precip</span>
                  <span className="font-mono tabular-nums">{precipValue}</span>
                </div>
                <div
                  className="flex items-center justify-between rounded-md bg-white/[0.02] px-2 py-1"
                  style={windOutlierStyle}
                >
                  <span>Wind</span>
                  <span className="font-mono tabular-nums">{windValue}</span>
                </div>
                <div
                  className="flex items-center justify-between rounded-md bg-white/[0.02] px-2 py-1"
                  style={conditionOutlierStyle}
                >
                  <span>Cond</span>
                  <span className="text-sm leading-none">{weatherInfo ? weatherInfo.icon : '—'}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 space-y-2">
        <p className="text-xs text-foreground/80">{reasonWithFreshness}</p>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-white/[0.04] px-2 py-1 text-[10px] font-mono text-foreground/70">
            Temp Δ {tempHighSpread !== null || tempLowSpread !== null
              ? `${tempHighSpread !== null ? Math.round(tempHighSpread) : '—'}° / ${tempLowSpread !== null ? Math.round(tempLowSpread) : '—'}°`
              : '—'}
          </span>
          <span className="rounded-full bg-white/[0.04] px-2 py-1 text-[10px] font-mono text-foreground/70">
            Precip Δ {precipSpread !== null ? `${Math.round(precipSpread)} mm` : '—'}
          </span>
          <span className="rounded-full bg-white/[0.04] px-2 py-1 text-[10px] font-mono text-foreground/70">
            Wind Δ {windSpread !== null ? `${Math.round(windSpread)} km/h` : '—'}
          </span>
        </div>
      </div>
    </div>
  );
});

export type BreakdownLens = 'agreement' | 'freshness';

const ModelHourlyBreakdownPanel = memo(function ModelHourlyBreakdownPanel({
  hour,
  forecasts,
  modelNames,
  timezone,
  className,
  focusedCategory = null,
  lens = 'agreement',
  onLensChange
}: {
  hour?: HourlyConsensus | null;
  forecasts: ModelForecast[];
  modelNames?: string[];
  timezone?: string;
  className?: string;
  focusedCategory?: string | null;
  /** Current lens mode - affects emphasis and display */
  lens?: BreakdownLens;
  /** Callback when user changes lens via internal toggle */
  onLensChange?: (lens: BreakdownLens) => void;
}) {
  const modelOrder = useMemo<string[]>(() => {
    if (!modelNames?.length) {
      return [...MODEL_ORDER];
    }
    const uniqueNames = Array.from(new Set(modelNames));
    const ordered = MODEL_ORDER.filter((name) => uniqueNames.includes(name));
    const extras = uniqueNames.filter((name) => !MODEL_ORDER_SET.has(name));
    return [...ordered, ...extras];
  }, [modelNames]);

  const modelEntries = useMemo<ModelHourlyEntry[]>(() => {
    const forecastByName = new Map(forecasts.map((forecast) => [forecast.model.name, forecast]));
    const includeMissing = !modelNames?.length;
    return modelOrder.flatMap<ModelHourlyEntry>((name) => {
      const forecast = forecastByName.get(name);
      if (!forecast || forecast.error || forecast.hourly.length === 0) {
        if (!includeMissing) {
          return [];
        }
        return [{
          name,
          color: forecast?.model.color ?? 'oklch(0.95 0.01 240)',
          hour: undefined,
          runAvailabilityTime: null
        }];
      }
      let currentHour;
      if (hour?.time) {
        currentHour = forecast.hourly.find(h => h.time === hour.time);
      }

      if (!currentHour) {
        const currentHourIndex = findCurrentHourIndex(
          forecast.hourly.map((entry) => entry.time),
          timezone
        );
        currentHour = forecast.hourly[currentHourIndex] || forecast.hourly[0];
      }
      const runAvailabilityTime = Number.isFinite(forecast.runAvailabilityTime)
        ? (forecast.runAvailabilityTime as number)
        : null;
      return [{
        name,
        color: forecast.model.color,
        hour: currentHour,
        runAvailabilityTime
      }];
    });
  }, [forecasts, modelOrder, modelNames, timezone]);

  const tempValues = modelEntries.map((entry) => getNumeric(entry.hour?.temperature));
  const precipPopValues = modelEntries.map((entry) => getNumeric(entry.hour?.precipitationProbability));
  const precipAmountValues = modelEntries.map((entry) => getNumeric(entry.hour?.precipitation));
  const windValues = modelEntries.map((entry) => getNumeric(entry.hour?.windSpeed));

  const tempSpread = getSpread(tempValues);
  const precipPopSpread = getSpread(precipPopValues);
  const precipAmountSpread = getSpread(precipAmountValues);
  const windSpread = getSpread(windValues);

  const tempOutlier = useMemo(() => (
    getOutlierInfo(
      modelEntries.map((entry) => ({
        name: entry.name,
        value: getNumeric(entry.hour?.temperature)
      })),
      tempSpread,
      2
    )
  ), [modelEntries, tempSpread]);

  const precipOutlier = useMemo(() => (
    getOutlierInfo(
      modelEntries.map((entry) => ({
        name: entry.name,
        value: getNumeric(entry.hour?.precipitationProbability)
      })),
      precipPopSpread,
      20
    )
  ), [modelEntries, precipPopSpread]);

  const windOutlier = useMemo(() => (
    getOutlierInfo(
      modelEntries.map((entry) => ({
        name: entry.name,
        value: getNumeric(entry.hour?.windSpeed)
      })),
      windSpread,
      6
    )
  ), [modelEntries, windSpread]);

  const conditionValues = modelEntries
    .map((entry) => getNumeric(entry.hour?.weatherCode))
    .filter((value): value is number => value !== null);
  const conditionsMode = getMode(conditionValues);
  const conditionOutliers = new Set(
    modelEntries
      .filter((entry) => {
        const code = getNumeric(entry.hour?.weatherCode);
        return conditionsMode !== null && code !== null && code !== conditionsMode;
      })
      .map((entry) => entry.name)
  );
  const hasConditionDisagreement = conditionValues.length > 1
    ? new Set(conditionValues).size > 1
    : false;
  const conditionAgreement = hour?.weatherCode?.available === false
    ? null
    : hour?.weatherCode?.agreement ?? null;
  const conditionOutlierRatio = conditionAgreement !== null && conditionAgreement < 100
    ? Math.min(1, (100 - conditionAgreement) / 50)
    : null;

  const spreadCandidates = [
    { key: 'temperature', label: 'temperature', value: tempSpread ?? 0, unit: '°' },
    { key: 'precipitation', label: 'precipitation', value: precipPopSpread ?? 0, unit: '%' },
    { key: 'wind', label: 'wind', value: windSpread ?? 0, unit: ' km/h' }
  ].filter((candidate) => candidate.value > 0);

  const maxSpread = spreadCandidates.reduce<{ label: string; value: number; unit: string } | null>(
    (current, candidate) => {
      if (!current || candidate.value > current.value) {
        return { label: candidate.label, value: candidate.value, unit: candidate.unit };
      }
      return current;
    },
    null
  );

  const agreementScore = Number.isFinite(hour?.overallAgreement ?? NaN)
    ? (hour?.overallAgreement as number)
    : null;
  const agreementLabel = agreementScore !== null
    ? agreementScore >= 75
      ? 'High agreement'
      : agreementScore >= 50
        ? 'Moderate agreement'
        : 'Low agreement'
    : 'Model comparison';

  const precipitationSpreadDetail = [
    `POP Δ ${precipPopSpread !== null ? `${Math.round(precipPopSpread)}%` : '—'}`,
    `amount Δ ${precipAmountSpread !== null ? `${formatMmPerHourShort(precipAmountSpread)} mm/hr` : '—'}`
  ].join(', ');

  const hasConditionOutliers = conditionOutliers.size > 0 || hasConditionDisagreement;
  const reasonLine = agreementScore !== null
    ? agreementScore >= 75
      ? `${agreementLabel}: models aligned across all metrics.`
      : maxSpread
        ? maxSpread.label === 'precipitation'
          ? `${agreementLabel} driven by precipitation spread (${precipitationSpreadDetail}).`
          : `${agreementLabel} driven by ${maxSpread.label} spread (${Math.round(maxSpread.value)}${maxSpread.unit}).`
        : hasConditionOutliers
          ? `${agreementLabel} driven by conditions disagreement.`
          : `${agreementLabel}: limited model agreement data.`
    : maxSpread
      ? `Comparing models: ${maxSpread.label} spread ${Math.round(maxSpread.value)}${maxSpread.unit}.`
      : 'Comparing models for this hour.';

  const nowSeconds = Date.now() / 1000;
  const staleCount = modelEntries.filter((entry) => {
    if (entry.runAvailabilityTime === null) return false;
    return (nowSeconds - (entry.runAvailabilityTime as number)) / 3600 > 12;
  }).length;
  const freshnessNote = staleCount > 0 ? `${staleCount} stale model${staleCount > 1 ? 's' : ''}` : null;
  const reasonWithFreshness = freshnessNote
    ? `${reasonLine} Freshness: ${freshnessNote}.`
    : reasonLine;

  // Determine which metric is the "driver" (highest spread)
  const driverMetric = focusedCategory || maxSpread?.label || null;

  return (
    <div className={cn('rounded-lg border border-white/10 bg-white/[0.02] p-3', className)}>
      {/* Lens toggle tabs */}
      {onLensChange && (
        <div className="mb-3 flex gap-1 rounded-lg bg-white/[0.04] p-1">
          <button
            type="button"
            onClick={() => onLensChange('agreement')}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              lens === 'agreement'
                ? 'bg-white/10 text-foreground'
                : 'text-foreground/60 hover:text-foreground/80'
            )}
          >
            Agreement
          </button>
          <button
            type="button"
            onClick={() => onLensChange('freshness')}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              lens === 'freshness'
                ? 'bg-white/10 text-foreground'
                : 'text-foreground/60 hover:text-foreground/80'
            )}
          >
            Freshness
          </button>
        </div>
      )}

      {/* Driver explanation - emphasized in agreement mode */}
      {lens === 'agreement' && agreementScore !== null && (
        <p className="mb-3 text-xs text-foreground/80">{reasonWithFreshness}</p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {modelEntries.map((entry) => {
          const temp = getNumeric(entry.hour?.temperature);
          const precipPop = getNumeric(entry.hour?.precipitationProbability);
          const precipAmount = getNumeric(entry.hour?.precipitation);
          const wind = getNumeric(entry.hour?.windSpeed);
          const code = getNumeric(entry.hour?.weatherCode);
          const weatherInfo = code !== null ? WEATHER_CODES[code] : null;
          const ageSeconds = entry.runAvailabilityTime !== null
            ? Math.max(0, nowSeconds - (entry.runAvailabilityTime as number))
            : null;
          const ageLabel = ageSeconds !== null ? formatAgeShort(ageSeconds) : '—';
          const ageLong = ageSeconds !== null ? formatAgeLong(ageSeconds) : '—';
          const ageShort = ageLabel;
          const ageHours = ageSeconds !== null ? ageSeconds / 3600 : null;
          const freshnessTone = getFreshnessTone(ageHours);
          const tempValue = temp !== null ? `${Math.round(temp)}°` : '—';
          const precipParts = [
            precipPop !== null ? `${Math.round(precipPop)}% POP` : null,
            precipAmount !== null ? `${formatMmPerHourShort(precipAmount)} mm/hr` : null
          ].filter((part): part is string => Boolean(part));
          const precipValue = precipParts.length > 0 ? precipParts.join(' · ') : '—';
          const windValue = wind !== null ? `${Math.round(wind)} km/h` : '—';
          const tempOutlierStyle = tempOutlier?.name === entry.name
            ? buildOutlierStyle(tempOutlier.ratio, 0.3)
            : undefined;
          const precipOutlierStyle = precipOutlier?.name === entry.name
            ? buildOutlierStyle(precipOutlier.ratio, 0.35)
            : undefined;
          const windOutlierStyle = windOutlier?.name === entry.name
            ? buildOutlierStyle(windOutlier.ratio, 0.35)
            : undefined;
          const conditionOutlierStyle = conditionOutliers.has(entry.name) && conditionOutlierRatio !== null
            ? buildOutlierStyle(conditionOutlierRatio, 0.2)
            : undefined;
          const cardStyle = entry.color
            ? { background: `linear-gradient(135deg, ${withAlpha(entry.color, 0.08)}, oklch(0.12 0.02 240))` }
            : undefined;
          return (
            <div
              key={entry.name}
              className="rounded-lg bg-background px-3 py-2 text-foreground/90"
              style={cardStyle}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[11px] text-foreground/80">
                  <span
                    className="h-2.5 w-2.5 triangle-icon"
                    style={{ backgroundColor: entry.color }}
                  />
                  <span className="font-medium">{entry.name}</span>
                </div>
                {/* Freshness indicator - more prominent in freshness mode */}
                <div className={cn(
                  'flex items-center gap-1.5',
                  lens === 'freshness' && 'bg-white/[0.04] rounded-full px-2 py-0.5'
                )}>
                  <span className={cn(
                    'rounded-full',
                    lens === 'freshness' ? 'h-2.5 w-2.5' : 'h-2 w-2',
                    freshnessToneClass[freshnessTone]
                  )} />
                  {lens === 'freshness' && (
                    <span className="text-[10px] text-foreground/70 font-mono tabular-nums">
                      {ageShort}
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-1 text-[10px] text-foreground/60">
                {entry.runAvailabilityTime !== null ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="font-mono tabular-nums text-foreground/60"
                      >
                        {ageShort}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className={TOOLTIP_CONTENT_CLASSNAME}>
                      <ComparisonTooltipCard title={`${entry.name} run`}>
                        <ComparisonTooltipSection>
                          <ComparisonTooltipRow
                            label="Age"
                            value={`${ageLong} ago`}
                          />
                          <ComparisonTooltipRow
                            label="Updated"
                            value={formatRunTime(entry.runAvailabilityTime as number, timezone)}
                          />
                        </ComparisonTooltipSection>
                      </ComparisonTooltipCard>
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <span className="font-mono tabular-nums">—</span>
                )}
              </div>
              <div
                className={cn(
                  "mt-2 rounded-md px-2 py-1 font-mono text-base tabular-nums",
                  lens === 'agreement' && driverMetric === 'temperature' && 'border-l-2 border-[oklch(0.75_0.18_85/50%)]'
                )}
                style={tempOutlierStyle}
              >
                {tempValue}
              </div>
              <div className="mt-2 space-y-1 text-[11px] text-foreground/70">
                <div
                  className={cn(
                    "flex items-center justify-between rounded-md bg-white/[0.02] px-2 py-1",
                    lens === 'agreement' && driverMetric === 'precipitation' && 'border-l-2 border-[oklch(0.75_0.18_85/50%)]'
                  )}
                  style={precipOutlierStyle}
                >
                  <span>Precip</span>
                  <span className="font-mono tabular-nums">{precipValue}</span>
                </div>
                <div
                  className={cn(
                    "flex items-center justify-between rounded-md bg-white/[0.02] px-2 py-1",
                    lens === 'agreement' && driverMetric === 'wind' && 'border-l-2 border-[oklch(0.75_0.18_85/50%)]'
                  )}
                  style={windOutlierStyle}
                >
                  <div className="flex items-center gap-1">
                    <span>Wind</span>
                    {Number.isFinite(entry.hour?.windDirection) && (
                      <ArrowUp
                        className="w-3 h-3 opacity-80"
                        style={{
                          transform: `rotate(${(entry.hour?.windDirection ?? 0) + 180}deg)`
                        }}
                      />
                    )}
                  </div>
                  <span className="font-mono tabular-nums">{windValue}</span>
                </div>
                <div
                  className={cn(
                    "flex items-center justify-between rounded-md bg-white/[0.02] px-2 py-1",
                    lens === 'agreement' && driverMetric === 'conditions' && 'border-l-2 border-[oklch(0.75_0.18_85/50%)]'
                  )}
                  style={conditionOutlierStyle}
                >
                  <span>Cond</span>
                  <span className="text-sm leading-none">{weatherInfo ? weatherInfo.icon : '—'}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 space-y-2">
        <p className="text-xs text-foreground/80">{reasonWithFreshness}</p>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-white/[0.04] px-2 py-1 text-[10px] font-mono text-foreground/70">
            Temp Δ {tempSpread !== null ? `${Math.round(tempSpread)}°` : '—'}
          </span>
          <span className="rounded-full bg-white/[0.04] px-2 py-1 text-[10px] font-mono text-foreground/70">
            POP Δ {precipPopSpread !== null ? `${Math.round(precipPopSpread)}%` : '—'}
          </span>
          <span className="rounded-full bg-white/[0.04] px-2 py-1 text-[10px] font-mono text-foreground/70">
            Amt Δ {precipAmountSpread !== null ? `${formatMmPerHourShort(precipAmountSpread)} mm/hr` : '—'}
          </span>
          <span className="rounded-full bg-white/[0.04] px-2 py-1 text-[10px] font-mono text-foreground/70">
            Wind Δ {windSpread !== null ? `${Math.round(windSpread)} km/h` : '—'}
          </span>
        </div>
      </div>
    </div>
  );
});

const HourlyForecastRow = memo(function HourlyForecastRow({
  hour,
  hourIndex,
  displayTime,
  isActive,
  isMobile,
  hasModelData,
  forecasts,
  timezone,
  onToggle
}: {
  hour: HourlyConsensus;
  hourIndex: number;
  displayTime: string;
  isActive: boolean;
  isMobile: boolean;
  hasModelData: boolean;
  forecasts: ModelForecast[];
  timezone?: string;
  onToggle: (time: string) => void;
}) {
  const weatherInfo = WEATHER_CODES[hour.weatherCode.dominant] || { description: 'Unknown', icon: '❓' };
  const agreementScore = Number.isFinite(hour.overallAgreement) ? hour.overallAgreement : 0;
  const borderClass = getAgreementBorder(agreementScore);

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: hourIndex * 0.05 }}
      className={`p-3 rounded-lg border ${borderClass} bg-white/[0.02] hover:bg-white/[0.04] transition-colors sm:flex sm:flex-wrap sm:items-start sm:gap-4 sm:gap-y-3`}
    >
      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
        {/* Time */}
        <div className="w-16 shrink-0 sm:w-20">
          <p className="font-medium truncate">{displayTime}</p>
        </div>

        {/* Weather icon */}
        <div className="w-10 shrink-0 text-center text-xl sm:w-12">
          {weatherInfo.icon}
        </div>

        {/* Temperature */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-lg">
              {Math.round(hour.temperature.mean)}°
            </span>
          </div>
          <p className="text-xs text-foreground/80 truncate">
            {weatherInfo.description}
          </p>
        </div>
      </div>

      {/* Secondary stats */}
      <div className="mt-3 flex items-center justify-between gap-3 sm:mt-0 sm:ml-auto sm:justify-end sm:gap-6">
        {/* Precipitation */}
        <div className="text-left sm:w-24 sm:text-center">
          <p className="font-mono text-sm whitespace-nowrap">
            {hour.precipitationProbability.available === false
              ? '—'
              : `${Math.round(hour.precipitationProbability.mean)}%`}
          </p>
          <p className="text-xs text-foreground/80 whitespace-nowrap">
            Precip
            {hour.precipitation.available === false
              ? ''
              : ` · ${formatMmPerHourShort(hour.precipitation.mean)} mm/hr`}
          </p>
        </div>

        {/* Wind */}
        <div className="hidden sm:block w-20 text-center">
          <p className="font-mono text-sm whitespace-nowrap">
            {Math.round(hour.windSpeed.mean)} km/h
          </p>
          <p className="text-xs text-foreground/80">Wind</p>
        </div>

        {/* Agreement indicator */}
        <div className="text-right sm:w-20">
          <div className="flex items-center justify-end gap-2">
            <div className={`w-2 h-2 rotate-45 ${getAgreementColor(agreementScore)}`} />
            <span className="font-mono text-sm whitespace-nowrap">{Math.round(agreementScore)}%</span>
          </div>
          <p className="text-xs text-foreground/80">Agreement</p>
        </div>

        {hasModelData && (
          <div className="text-right sm:w-20">
            <button
              type="button"
              onClick={() => onToggle(hour.time)}
              className="inline-flex items-center gap-1 text-xs text-foreground/70 hover:text-foreground"
              aria-expanded={isActive}
              aria-controls={`hourly-breakdown-${hour.time}`}
            >
              <ModelCaretIcon
                color="currentColor"
                className={cn(
                  'transition-transform origin-center',
                  isActive && 'rotate-90'
                )}
              />
            </button>
          </div>
        )}
      </div>

      {isActive && !isMobile && (
        <motion.div
          id={`hourly-breakdown-${hour.time}`}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mt-3 w-full"
        >
          <ModelHourlyBreakdownPanel
            hour={hour}
            forecasts={forecasts}
            timezone={timezone}
          />
        </motion.div>
      )}
    </motion.div>
  );
});

const HourlyForecastView = memo(function HourlyForecastView({
  hourly,
  forecasts,
  timezone,
  isMobile,
  onToggle,
  expandedTime
}: {
  hourly: HourlyConsensus[];
  forecasts: ModelForecast[];
  timezone?: string;
  isMobile: boolean;
  onToggle: (time: string) => void;
  expandedTime: string | null;
}) {
  const hasModelData = forecasts.length > 0;
  // Show next 24 hours
  const displayHours = hourly.slice(0, 24);

  return (
    <div className="space-y-3">
      {displayHours.map((hour, index) => {
        const date = new Date(hour.time);
        const displayTime = new Intl.DateTimeFormat('en-CA', {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: timezone
        }).format(date);

        const isActive = expandedTime === hour.time;

        return (
          <HourlyForecastRow
            key={hour.time}
            hour={hour}
            hourIndex={index}
            displayTime={displayTime}
            isActive={isActive}
            isMobile={isMobile}
            hasModelData={hasModelData}
            forecasts={forecasts}
            timezone={timezone}
            onToggle={onToggle}
          />
        );
      })}
    </div>
  );
});


const DailyForecastRow = memo(function DailyForecastRow({
  day,
  dayIndex,
  displayDate,
  showAgreement,
  isExpanded,
  isActive,
  isMobile,
  hasModelData,
  forecasts,
  timezone,
  onToggle
}: {
  day: DailyConsensus;
  dayIndex: number;
  displayDate: string;
  showAgreement: boolean;
  isExpanded: boolean;
  isActive: boolean;
  isMobile: boolean;
  hasModelData: boolean;
  forecasts: ModelForecast[];
  timezone?: string;
  onToggle: (date: string) => void;
}) {
  const weatherInfo = WEATHER_CODES[day.weatherCode.dominant] || { description: 'Unknown', icon: '❓' };
  const borderClass = showAgreement ? getAgreementBorder(day.overallAgreement) : 'border-white/10';

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: dayIndex * 0.05 }}
      className={`p-3 rounded-lg border ${borderClass} bg-white/[0.02] hover:bg-white/[0.04] transition-colors sm:flex sm:flex-wrap sm:items-start sm:gap-4 sm:gap-y-3`}
    >
      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
        {/* Date */}
        <div className="w-20 shrink-0 sm:w-24">
          <p className="font-medium truncate">{displayDate}</p>
        </div>

        {/* Weather icon */}
        <div className="w-10 shrink-0 text-center text-2xl sm:w-12">
          {weatherInfo.icon}
        </div>

        {/* Temperature range */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-lg">
              {Math.round(day.temperatureMax.mean)}°
            </span>
            <span className="text-foreground/80 font-mono">
              / {Math.round(day.temperatureMin.mean)}°
            </span>
          </div>
          <p className="text-xs text-foreground/80 truncate">
            {weatherInfo.description}
          </p>
        </div>
      </div>

      {/* Secondary stats (stack on mobile, inline on sm+) */}
      <div className="mt-3 flex items-center justify-between gap-3 sm:mt-0 sm:ml-auto sm:justify-end sm:gap-6">
        {/* Precipitation */}
        <div className="text-left sm:w-16 sm:text-center">
          <p className="font-mono text-sm whitespace-nowrap">
            {Math.round(day.precipitation.mean)} mm
          </p>
          <p className="text-xs text-foreground/80">Precip</p>
        </div>

        {/* Wind */}
        <div className="hidden sm:block w-20 text-center">
          <p className="font-mono text-sm whitespace-nowrap">
            {Math.round(day.windSpeed.mean)} km/h
          </p>
          <p className="text-xs text-foreground/80">Wind</p>
        </div>

        {/* Agreement indicator */}
        {showAgreement && (
          <div className="text-right sm:w-20">
            <div className="flex items-center justify-end gap-2">
              <div className={`w-2 h-2 rotate-45 ${getAgreementColor(day.overallAgreement)}`} />
              <span className="font-mono text-sm whitespace-nowrap">{day.overallAgreement}%</span>
            </div>
            <p className="text-xs text-foreground/80">Agreement</p>
          </div>
        )}

        {hasModelData && (
          <div className="text-right sm:w-20">
            <button
              type="button"
              onClick={() => onToggle(day.date)}
              className="inline-flex items-center gap-1 text-xs text-foreground/70 hover:text-foreground"
              aria-expanded={isActive}
              aria-controls={`model-breakdown-${day.date}`}
            >
              <ModelCaretIcon
                color="currentColor"
                className={cn(
                  'transition-transform origin-center',
                  isActive && 'rotate-90'
                )}
              />
            </button>
          </div>
        )}
      </div>

      {isExpanded && !isMobile && (
        <motion.div
          id={`model-breakdown-${day.date}`}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mt-3 w-full"
        >
          <ModelBreakdownPanel
            day={day}
            dayIndex={dayIndex}
            forecasts={forecasts}
            timezone={timezone}
          />
        </motion.div>
      )}
    </motion.div>
  );
});

export function DailyForecast({
  daily,
  hourly,
  forecasts,
  showAgreement = true,
  timezone
}: DailyForecastProps) {
  const [activeTab, setActiveTab] = useState<'daily' | 'hourly'>('daily');
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [expandedTime, setExpandedTime] = useState<string | null>(null);
  const isMobile = useMediaQuery('(max-width: 639px)');
  const hasModelData = forecasts.length > 0;

  const formatDate = (dateStr: string) => {
    const dateParts = parseOpenMeteoDate(dateStr);
    if (!dateParts) return dateStr;

    const nowParts = getZonedNowParts(timezone);
    if (nowParts) {
      const todayParts = { year: nowParts.year, month: nowParts.month, day: nowParts.day };
      const tomorrowParts = addDays(todayParts, 1);

      if (isSameDate(dateParts, todayParts)) {
        return 'Today';
      }
      if (isSameDate(dateParts, tomorrowParts)) {
        return 'Tomorrow';
      }
    }

    return formatCalendarDate(dateParts);
  };

  const handleDateToggle = useCallback((date: string) => {
    setExpandedDate((prev) => (prev === date ? null : date));
  }, []);

  const handleTimeToggle = useCallback((time: string) => {
    setExpandedTime((prev) => (prev === time ? null : time));
  }, []);

  const expandedIndex = useMemo(() => (
    expandedDate ? daily.findIndex((day) => day.date === expandedDate) : -1
  ), [daily, expandedDate]);

  const expandedDay = expandedIndex >= 0 ? daily[expandedIndex] : null;

  const expandedHour = useMemo(() => (
    expandedTime && hourly ? hourly.find((h) => h.time === expandedTime) : null
  ), [hourly, expandedTime]);

  return (
    <div className="glass-card p-4 sm:p-6 readable-text">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Forecast</h2>

        <div className="flex p-1 bg-white/[0.04] rounded-lg">
          <button
            onClick={() => setActiveTab('daily')}
            className={cn(
              "px-3 py-1 text-xs font-medium rounded-md transition-all",
              activeTab === 'daily'
                ? "bg-white/10 text-foreground shadow-sm"
                : "text-foreground/60 hover:text-foreground/80"
            )}
          >
            7-Day
          </button>
          <button
            onClick={() => setActiveTab('hourly')}
            disabled={!hourly || hourly.length === 0}
            className={cn(
              "px-3 py-1 text-xs font-medium rounded-md transition-all",
              activeTab === 'hourly'
                ? "bg-white/10 text-foreground shadow-sm"
                : "text-foreground/60 hover:text-foreground/80",
              (!hourly || hourly.length === 0) && "opacity-50 cursor-not-allowed"
            )}
          >
            Hourly
          </button>
        </div>
      </div>

      {activeTab === 'daily' ? (
        <div className="space-y-3">
          {daily.map((day, index) => {
            const displayDate = formatDate(day.date);
            const isActive = expandedDate === day.date;
            const isExpanded = !isMobile && isActive;

            return (
              <DailyForecastRow
                key={day.date}
                day={day}
                dayIndex={index}
                displayDate={displayDate}
                showAgreement={showAgreement}
                isExpanded={isExpanded}
                isActive={isActive}
                isMobile={isMobile}
                hasModelData={hasModelData}
                forecasts={forecasts}
                timezone={timezone}
                onToggle={handleDateToggle}
              />
            );
          })}
        </div>
      ) : (
        hourly && (
          <HourlyForecastView
            hourly={hourly}
            forecasts={forecasts}
            timezone={timezone}
            isMobile={isMobile}
            onToggle={handleTimeToggle}
            expandedTime={expandedTime}
          />
        )
      )}

      {/* Mobile Drawers */}
      {isMobile && expandedDay && activeTab === 'daily' && (
        <Drawer
          open={Boolean(expandedDay)}
          onOpenChange={(open) => {
            if (!open) setExpandedDate(null);
          }}
        >
          <DrawerContent className="glass-card border border-white/10 text-foreground/90">
            <DrawerHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <DrawerTitle className="text-base">Model Breakdown</DrawerTitle>
                  <DrawerDescription className="text-foreground/70 text-xs">
                    {formatDate(expandedDay.date)}
                  </DrawerDescription>
                </div>
                <DrawerClose asChild>
                  <button
                    type="button"
                    className="text-xs text-foreground/70 hover:text-foreground underline underline-offset-2"
                  >
                    Close
                  </button>
                </DrawerClose>
              </div>
            </DrawerHeader>
            <ModelBreakdownPanel
              day={expandedDay}
              dayIndex={expandedIndex}
              forecasts={forecasts}
              timezone={timezone}
              className="mx-4 mb-4"
            />
          </DrawerContent>
        </Drawer>
      )}

      {isMobile && expandedHour && activeTab === 'hourly' && (
        <Drawer
          open={Boolean(expandedHour)}
          onOpenChange={(open) => {
            if (!open) setExpandedTime(null);
          }}
        >
          <DrawerContent className="glass-card border border-white/10 text-foreground/90">
            <DrawerHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <DrawerTitle className="text-base">Hourly Breakdown</DrawerTitle>
                  <DrawerDescription className="text-foreground/70 text-xs">
                    {new Intl.DateTimeFormat('en-CA', {
                      hour: 'numeric',
                      minute: '2-digit',
                      timeZone: timezone,
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric'
                    }).format(new Date(expandedHour.time))}
                  </DrawerDescription>
                </div>
                <DrawerClose asChild>
                  <button
                    type="button"
                    className="text-xs text-foreground/70 hover:text-foreground underline underline-offset-2"
                  >
                    Close
                  </button>
                </DrawerClose>
              </div>
            </DrawerHeader>
            <ModelHourlyBreakdownPanel
              hour={expandedHour}
              forecasts={forecasts}
              timezone={timezone}
              className="mx-4 mb-4"
            />
          </DrawerContent>
        </Drawer>
      )}

      {/* Legend */}
      {showAgreement && activeTab === 'daily' && (
        <div className="flex flex-wrap items-center justify-start sm:justify-end gap-4 mt-4 pt-4 border-t border-white/10">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rotate-45 bg-agreement-high" />
            <span className="text-xs text-foreground/80">High Agreement</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rotate-45 bg-agreement-medium" />
            <span className="text-xs text-foreground/80">Moderate</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rotate-45 bg-agreement-low" />
            <span className="text-xs text-foreground/80">Low</span>
          </div>
        </div>
      )}
    </div>
  );
}
