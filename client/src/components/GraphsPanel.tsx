/**
 * GraphsPanel Component - Arctic Data Observatory
 * Tabbed suite for hourly model comparisons with chart/table modes.
 */
/* eslint-disable @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps, no-console */

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Thermometer, Droplets, Wind, Cloud, Layers, Navigation, List as ListIcon, Crown } from 'lucide-react';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Toggle } from '@/components/ui/toggle';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { HourlyChart } from '@/components/HourlyChart';
import { fetchObservedHourlyFromApi, normalizeWeatherCode, WEATHER_CODES, WEATHER_MODELS, type ModelForecast, type ObservedHourly } from '@/lib/weatherApi';
import type { HourlyConsensus } from '@/lib/consensus';
import {
  findCurrentHourIndex,
  formatHourLabel,
  formatWeekdayHourLabel,
  parseOpenMeteoDateTime,
  shiftOpenMeteoDateTimeKey,
  getZonedDateParts,
  formatDateTimeKey
} from '@/lib/timeUtils';
import {
  buildHourlyForecastMap,
  getPrecipIntensityColor
} from '@/lib/graphUtils';
import {
  PrecipPatterns,
  getPatternId,
  getTracePatternId,
  getPrecipTypeFromWeatherCode,
  type PrecipType
} from '@/components/PrecipPatterns';
import { WindChart } from '@/components/WindChart';
import { WindDirectionMatrix } from '@/components/WindDirectionMatrix';
import { MatrixRowLabel } from '@/components/MatrixRowLabel';
import {
  ComparisonTooltipCard,
  ComparisonTooltipRow,
  ComparisonTooltipSection
} from '@/components/ComparisonTooltip';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';
import { fetchObservationsForRange, type ObservationData } from '@/lib/observations/observations';
import { signedDelta, circularAbsDiffDeg } from '@/lib/observations/error';
import { bucketMs, bucketEndMs, isBucketCompleted } from '@/lib/observations/bucketing';
import { isBucketedAccumulation } from '@/lib/observations/vars';
import { WeatherIcon } from '@/components/icons/WeatherIcon';
import { conditionToIconName } from '@/lib/weatherIcons';
import { getIsDay } from '@/lib/dayNight';

type GraphKey = 'temperature' | 'precipitation' | 'wind' | 'conditions';
type ViewMode = 'chart' | 'table';
type WindMode = 'chart' | 'matrix';

type TimeSlot = {
  time: string;
  epoch: number;
  label: string;
  fullLabel: string;
  isCurrent: boolean;
};

type PrecipRow = {
  id: string;
  label: string;
  type: 'model' | 'consensus' | 'observed';
  available: boolean;
  color?: string;
};

interface GraphsPanelProps {
  forecasts: ModelForecast[];
  consensus?: HourlyConsensus[];
  showConsensus?: boolean;
  fallbackForecast?: ModelForecast | null;
  observations?: never; // DEPRECATED: Removed to prevent fake observed rendering
  timezone?: string;
  visibleLines?: Record<string, boolean>;
  onToggleLine?: (lineName: string) => void;
  location?: { latitude: number; longitude: number };
  lastUpdated?: Date | null;
  isPrimary?: boolean;
}

interface HourlyWindow {
  slots: { time: string; epoch: number }[];
  currentTimeKey: string | null;
}

const GRAPH_TITLES: Record<GraphKey, string> = {
  temperature: '48-Hour Temperature Forecast',
  precipitation: '48-Hour Precipitation Comparison',
  wind: '48-Hour Wind Comparison',
  conditions: '48-Hour Conditions Comparison'
};

const POP_THRESHOLD = 20;
const OBSERVED_TOOLTIP_COLOR = 'oklch(0.85 0.12 60)';
const TOOLTIP_CONTENT_CLASSNAME =
  'p-0 bg-transparent shadow-none border-none text-foreground [&>svg]:hidden';

function buildHourlyWindow({
  forecasts,
  consensus,
  showConsensus,
  fallbackForecast,
  timezone
}: {
  forecasts: ModelForecast[];
  consensus: HourlyConsensus[];
  showConsensus: boolean;
  fallbackForecast?: ModelForecast | null;
  timezone?: string;
}): HourlyWindow {
  const baseForecast = fallbackForecast
    || forecasts.find(forecast => !forecast.error && forecast.hourly.length > 0)
    || null;

  // Extract items with both time and epoch
  // Prefer consensus if available as it's the agreed timeline
  let baseItems: { time: string; epoch: number }[] = [];

  if (showConsensus && consensus.length > 0) {
    baseItems = consensus.map(h => ({ time: h.time, epoch: h.epoch || 0 }));
  } else if (baseForecast?.hourly) {
    baseItems = baseForecast.hourly.map(h => ({ time: h.time, epoch: h.epoch || 0 }));
  }

  if (baseItems.length === 0) {
    return { slots: [], currentTimeKey: null };
  }

  const times = baseItems.map(i => i.time);
  const currentIndex = findCurrentHourIndex(times, timezone);
  const currentTimeKey = times[currentIndex] ?? null;
  const maxWindowHours = 48;
  const maxPastHours = 24;
  const pastHours = Math.min(maxPastHours, currentIndex);
  const futureHours = maxWindowHours - pastHours;
  const startIndex = Math.max(0, currentIndex - pastHours);
  const endIndex = Math.min(baseItems.length, currentIndex + futureHours + 1);

  return {
    slots: baseItems.slice(startIndex, endIndex),
    currentTimeKey
  };
}

function convertToObservedHourly(data: ObservationData, timezone?: string): ObservedHourly[] {
  // Defensive check: ensure data.series and data.series.buckets exist
  if (!data?.series?.buckets) {
    return [];
  }
  return data.series.buckets.map((t, i) => {
    // Convert ms -> Local Key using the graph's timezone (or default UTC)
    // This ensures alignment with forecast keys (which are typically local)
    const date = new Date(t);
    const parts = getZonedDateParts(date, timezone);
    const time = parts ? formatDateTimeKey(parts) ?? new Date(t).toISOString().slice(0, 16) : new Date(t).toISOString().slice(0, 16);

    return {
      time,
      epoch: t, // Bucket timestamp is the epoch
      temperature: data.series.tempC[i] ?? NaN,
      precipitation: data.series.precipMm[i] ?? undefined,
      windSpeed: data.series.windKph[i] ?? undefined,
      windGusts: data.series.windGustKph[i] ?? undefined,
      windDirection: data.series.windDirDeg[i] ?? undefined,
      weatherCode: data.series.conditionCode[i] ?? undefined
    };
  }).filter(row => row.time); // items are valid
}

function formatTemp(value?: number | null): string {
  if (!Number.isFinite(value ?? NaN)) return '--';
  return `${Math.round((value as number) * 10) / 10} C`;
}

function formatPop(value?: number | null): string {
  if (!Number.isFinite(value ?? NaN)) return '--';
  return `${Math.round(value as number)}%`;
}

function formatAgreement(value?: number | null): string {
  if (!Number.isFinite(value ?? NaN)) return '--';
  return `${Math.round(value as number)}%`;
}

function formatIntensity(value?: number | null): string {
  if (!Number.isFinite(value ?? NaN)) return '--';
  const intensity = value as number;
  if (intensity >= 0 && intensity < 0.05) return '<0.1';
  return `${Math.round(intensity * 10) / 10}`;
}

function formatConditionValue(code?: number | null): string {
  if (!Number.isFinite(code ?? NaN)) return 'Unavailable';
  const info = getWeatherInfo(code as number);
  const description = info?.description ?? 'Unknown';
  return `${description} (WMO ${Math.round(code as number)})`;
}

function withAlpha(color: string, alpha: number): string {
  if (!color) return color;
  if (color.includes('/')) return color;
  const idx = color.lastIndexOf(')');
  if (idx === -1) return color;
  return `${color.slice(0, idx)} / ${alpha})`;
}

function getWeatherInfo(
  code: number | null | undefined,
  epoch?: number | null,
  timezone?: string
): { iconName: string | null; description: string } | null {
  const normalized = normalizeWeatherCode(code);
  if (!Number.isFinite(normalized)) return null;
  const isDay = epoch ? getIsDay(epoch, undefined, timezone) : true;
  const iconName = conditionToIconName(normalized, isDay);
  return {
    iconName,
    description: WEATHER_CODES[normalized]?.description || 'Unknown'
  };
}

function getObservedIntensityColor(intensity: number): string {
  if (!Number.isFinite(intensity) || intensity <= 0) {
    return 'oklch(0.92 0 0 / 0.2)';
  }
  if (intensity <= 0.5) return 'oklch(0.86 0 0 / 0.4)';
  if (intensity <= 2) return 'oklch(0.78 0 0 / 0.55)';
  if (intensity <= 5) return 'oklch(0.68 0 0 / 0.7)';
  return 'oklch(0.58 0 0 / 0.85)';
}

function PlaceholderPanel({
  icon: Icon,
  title,
  description
}: {
  icon: typeof Thermometer;
  title: string;
  description: string;
}) {
  return (
    <Empty className="border-white/10 text-foreground/70">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon className="size-5" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function TemperatureTable({
  timeSlots,
  modelHourlyById,
  consensusByTime,
  showConsensus,
  observedTempByEpoch
}: {
  timeSlots: TimeSlot[];
  modelHourlyById: Map<string, Map<string, ModelForecast['hourly'][number]>>;
  consensusByTime: Map<string, HourlyConsensus>;
  showConsensus: boolean;
  observedTempByEpoch: Map<number, number>;
}) {
  const hasObserved = observedTempByEpoch.size > 0;

  if (timeSlots.length === 0) {
    return (
      <PlaceholderPanel
        icon={Thermometer}
        title="Temperature data unavailable"
        description="Hourly temperature data will appear once forecasts are loaded."
      />
    );
  }

  return (
    <Table className="min-w-max">
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          {WEATHER_MODELS.map((model) => (
            <TableHead key={`${model.id}-temp`}>{model.name}</TableHead>
          ))}
          {showConsensus && <TableHead>Consensus</TableHead>}
          {hasObserved && <TableHead>Observed</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {timeSlots.map((slot) => (
          <TableRow key={slot.time}>
            <TableCell className="text-xs text-foreground/70">
              {slot.fullLabel}
            </TableCell>
            {WEATHER_MODELS.map((model) => {
              const value = modelHourlyById.get(model.id)?.get(slot.time)?.temperature;
              return (
                <TableCell
                  key={`${model.id}-${slot.time}-temp`}
                  className="font-mono tabular-nums"
                >
                  {formatTemp(value)}
                </TableCell>
              );
            })}
            {showConsensus && (
              <TableCell className="font-mono tabular-nums">
                {formatTemp(
                  consensusByTime.get(slot.time)?.temperature.available === false
                    ? null
                    : consensusByTime.get(slot.time)?.temperature.mean
                )}
              </TableCell>
            )}
            {hasObserved && (
              <TableCell className="font-mono tabular-nums">
                {formatTemp(observedTempByEpoch.get(slot.epoch))}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function PrecipitationTable({
  timeSlots,
  modelHourlyById,
  consensusByTime,
  showConsensus,
  observedPrecipByEpoch
}: {
  timeSlots: TimeSlot[];
  modelHourlyById: Map<string, Map<string, ModelForecast['hourly'][number]>>;
  consensusByTime: Map<string, HourlyConsensus>;
  showConsensus: boolean;
  observedPrecipByEpoch: Map<number, number>;
}) {
  const hasObserved = observedPrecipByEpoch.size > 0;

  if (timeSlots.length === 0) {
    return (
      <PlaceholderPanel
        icon={Droplets}
        title="Precipitation data unavailable"
        description="Hourly precipitation data will appear once forecasts are loaded."
      />
    );
  }

  return (
    <Table className="min-w-max">
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          {WEATHER_MODELS.flatMap((model) => [
            <TableHead key={`${model.id}-pop`} className="text-xs">
              {model.name} POP
            </TableHead>,
            <TableHead key={`${model.id}-intensity`} className="text-xs">
              {model.name} Intensity (mm/hr)
            </TableHead>
          ])}
          {showConsensus && (
            <>
              <TableHead className="text-xs">Consensus POP</TableHead>
              <TableHead className="text-xs">Consensus Intensity (mm/hr)</TableHead>
            </>
          )}
          {hasObserved && (
            <TableHead className="text-xs">Observed (mm/hr)</TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {timeSlots.map((slot) => (
          <TableRow key={slot.time}>
            <TableCell className="text-xs text-foreground/70">
              {slot.fullLabel}
            </TableCell>
            {WEATHER_MODELS.flatMap((model) => {
              const sourceTimeKey = shiftOpenMeteoDateTimeKey(slot.time, -1) ?? slot.time;
              const hour = modelHourlyById.get(model.id)?.get(sourceTimeKey);
              const pop = hour?.precipitationProbability;
              const intensity = hour?.precipitation;
              return [
                <TableCell
                  key={`${model.id}-${slot.time}-pop`}
                  className="font-mono tabular-nums"
                >
                  {formatPop(pop)}
                </TableCell>,
                <TableCell
                  key={`${model.id}-${slot.time}-intensity`}
                  className="font-mono tabular-nums"
                >
                  {formatIntensity(intensity)}
                </TableCell>
              ];
            })}
            {showConsensus && (
              <>
                <TableCell className="font-mono tabular-nums">
                  {formatPop(
                    consensusByTime.get(shiftOpenMeteoDateTimeKey(slot.time, -1) ?? slot.time)
                      ?.precipitationProbability.available === false
                      ? null
                      : consensusByTime.get(shiftOpenMeteoDateTimeKey(slot.time, -1) ?? slot.time)
                        ?.precipitationProbability.mean
                  )}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatIntensity(
                    consensusByTime.get(shiftOpenMeteoDateTimeKey(slot.time, -1) ?? slot.time)
                      ?.precipitation.available === false
                      ? null
                      : consensusByTime.get(shiftOpenMeteoDateTimeKey(slot.time, -1) ?? slot.time)
                        ?.precipitation.mean
                  )}
                </TableCell>
              </>
            )}
            {hasObserved && (
              <TableCell className="font-mono tabular-nums">
                {formatIntensity(observedPrecipByEpoch.get(slot.epoch))}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function PrecipitationComparisonGraph({
  timeSlots,
  modelHourlyById,
  modelAvailability,
  consensusByTime,
  showConsensus,
  observedPrecipByEpoch,
  observationsStatus,
  nowMs,
  nowMarkerTimeKey,
  observedCutoffTimeKey,
  isUnverified,
  observedAvailability
}: {
  timeSlots: TimeSlot[];
  modelHourlyById: Map<string, Map<string, ModelForecast['hourly'][number]>>;
  modelAvailability: Map<string, boolean>;
  consensusByTime: Map<string, HourlyConsensus>;
  showConsensus: boolean;
  observedPrecipByEpoch: Map<number, number>;
  observationsStatus: 'loading' | 'none' | 'vault' | 'error';
  nowMs: number;
  nowMarkerTimeKey: string | null;
  observedCutoffTimeKey: string | null;
  isUnverified?: boolean;
  observedAvailability: { available: boolean; reason: string | null; detail: string | null };
}) {
  const isMobile = useIsMobile();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const labelInterval = isMobile ? 6 : 3;
  const columnWidth = isMobile ? 22 : 28;

  const rows = useMemo<PrecipRow[]>(() => {
    const modelRows: PrecipRow[] = WEATHER_MODELS.map((model) => ({
      id: model.id,
      label: model.name,
      color: model.color,
      type: 'model' as const,
      available: modelAvailability.get(model.id) ?? false
    }));
    const list = [...modelRows];
    if (showConsensus) {
      list.push({
        id: 'consensus',
        label: 'Consensus',
        type: 'consensus' as const,
        available: true
      });
    }
    // Always include observed row
    list.push({
      id: 'observed',
      label: 'Observed',
      type: 'observed' as const,
      available: observedAvailability.available
    });
    return list;
  }, [modelAvailability, showConsensus, observedAvailability]);

  const tooltipColumns = useMemo(() => {
    return timeSlots.map((slot) => {
      const models = WEATHER_MODELS.map((model) => {
        const sourceTimeKey = shiftOpenMeteoDateTimeKey(slot.time, -1) ?? slot.time;
        const hour = modelHourlyById.get(model.id)?.get(sourceTimeKey);
        const normalizedCode = normalizeWeatherCode(hour?.weatherCode);
        return {
          id: model.id,
          name: model.name,
          color: model.color,
          pop: Number.isFinite(hour?.precipitationProbability)
            ? hour?.precipitationProbability ?? null
            : null,
          intensity: Number.isFinite(hour?.precipitation)
            ? hour?.precipitation ?? null
            : null,
          weatherCode: Number.isFinite(normalizedCode) ? normalizedCode : null,
          available: modelAvailability.get(model.id) ?? false
        };
      });
      const sourceTimeKey = shiftOpenMeteoDateTimeKey(slot.time, -1) ?? slot.time;
      const consensusData = showConsensus ? consensusByTime.get(sourceTimeKey) : null;
      const normalizedConsensusCode = showConsensus
        ? normalizeWeatherCode(consensusData?.weatherCode.dominant)
        : NaN;
      const consensus = showConsensus
        ? {
          pop: consensusData?.precipitationProbability.available === false
            ? null
            : consensusData?.precipitationProbability.mean ?? null,
          intensity: consensusData?.precipitation.available === false
            ? null
            : consensusData?.precipitation.mean ?? null,
          weatherCode: Number.isFinite(normalizedConsensusCode)
            ? normalizedConsensusCode
            : null,
          agreement: consensusData?.precipitationCombined.agreement ?? null,
          amountAgreement: consensusData?.precipitation.agreement ?? null,
          probabilityAgreement: consensusData?.precipitationProbability.agreement ?? null
        }
        : null;
      const observed = observedPrecipByEpoch.get(slot.epoch);
      return {
        slot,
        models,
        consensus,
        observed
      };
    });
  }, [
    timeSlots,
    modelHourlyById,
    modelAvailability,
    consensusByTime,
    observedPrecipByEpoch,
    showConsensus
  ]);

  if (timeSlots.length === 0) {
    return (
      <PlaceholderPanel
        icon={Droplets}
        title="Precipitation data unavailable"
        description="Hourly precipitation data will appear once forecasts are loaded."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* SVG pattern definitions - render once */}
      <PrecipPatterns />
      <div className="flex items-start gap-3">
        <div className="flex flex-col text-xs text-foreground/70">
          <div className="h-6" />
          {rows.map((row) => {
            const labelTint = row.type === 'model' && row.color
              ? `linear-gradient(90deg, ${withAlpha(row.color, 0.14)}, transparent 85%)`
              : row.type === 'consensus'
                ? `linear-gradient(90deg, ${withAlpha('oklch(0.75 0.15 195)', 0.12)}, transparent 85%)`
                : undefined;

            return (
              <MatrixRowLabel
                key={row.id}
                label={row.label}
                type={row.type}
                color={row.color}
                available={row.available}
                labelTint={labelTint}
                unavailableReason={
                  row.type === 'observed' && !row.available && observedAvailability.reason
                    ? observedAvailability.reason
                    : undefined
                }
              />
            );
          })}
        </div>
        <div className="flex-1 overflow-x-auto">
          <div className="flex min-w-max">
            {timeSlots.map((slot, index) => {
              const isActive = hoverIndex === index;
              const isCurrent = slot.time === nowMarkerTimeKey;
              const tooltip = tooltipColumns[index];
              const consensusWeatherInfo = getWeatherInfo(tooltip.consensus?.weatherCode, slot.epoch);
              return (
                <Tooltip key={slot.time}>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        "relative flex flex-col items-center transition-opacity duration-150",
                        isActive && "bg-primary/10",
                        hoverIndex !== null && !isActive && "opacity-60"
                      )}
                      style={{ width: columnWidth }}
                      onMouseEnter={() => setHoverIndex(index)}
                      onMouseLeave={() => setHoverIndex(null)}
                      onFocus={() => setHoverIndex(index)}
                      onBlur={() => setHoverIndex(null)}
                      tabIndex={0}
                      aria-label={`Precipitation column ${slot.fullLabel}`}
                    >
                      {isCurrent && (
                        <div
                          className="absolute inset-y-0 right-0 w-px bg-primary/60 pointer-events-none"
                          style={{
                            boxShadow: '0 0 10px oklch(0.75 0.15 195 / 0.35)'
                          }}
                        />
                      )}
                      <div
                        className={cn(
                          "h-6 w-full text-[10px] flex items-center justify-center text-foreground/70",
                          isCurrent && "text-primary"
                        )}
                      >
                        {index % labelInterval === 0 ? slot.label : ''}
                      </div>
                      {rows.map((row) => {
                        const sourceTimeKey = shiftOpenMeteoDateTimeKey(slot.time, -1) ?? slot.time;
                        let pop: number | null = null;
                        let intensity: number | null = null;
                        let weatherCode: number | null = null;
                        let tintColor: string | undefined;
                        let rowGlowColor: string | undefined;
                        let isObserved = false;
                        const isConsensusRow = row.type === 'consensus';
                        let temperature: number | null = null;
                        if (row.type === 'model') {
                          rowGlowColor = row.color;
                          const hour = modelHourlyById.get(row.id)?.get(sourceTimeKey);
                          pop = Number.isFinite(hour?.precipitationProbability)
                            ? hour?.precipitationProbability ?? null
                            : null;
                          intensity = Number.isFinite(hour?.precipitation)
                            ? hour?.precipitation ?? null
                            : null;
                          const normalizedCode = normalizeWeatherCode(hour?.weatherCode);
                          weatherCode = Number.isFinite(normalizedCode) ? normalizedCode : null;
                          temperature = hour?.temperature ?? null;
                        } else if (row.type === 'consensus') {
                          rowGlowColor = 'oklch(0.75 0.15 195)';
                          const consensusData = consensusByTime.get(sourceTimeKey);
                          pop = consensusData?.precipitationProbability.available === false
                            ? null
                            : consensusData?.precipitationProbability.mean ?? null;
                          intensity = consensusData?.precipitation.available === false
                            ? null
                            : consensusData?.precipitation.mean ?? null;
                          // Use dominant weather code from consensus for precip type
                          const normalizedCode = normalizeWeatherCode(consensusData?.weatherCode.dominant);
                          weatherCode = Number.isFinite(normalizedCode) ? normalizedCode : null;
                          temperature = consensusData?.temperature.mean ?? null;
                          const agreement = consensusData?.precipitationCombined.agreement;
                          if (Number.isFinite(agreement)) {
                            const alpha = Math.min(0.18, (agreement as number) / 600);
                            if (alpha > 0) {
                              tintColor = `oklch(0.75 0.15 195 / ${alpha})`;
                            }
                          }
                        } else if (row.type === 'observed') {
                          isObserved = true;
                          // Strict Rendering Gate
                          // Only render if bucket is completed and we have an observed source enabled.
                          const canRender = observedAvailability.available && isBucketCompleted(slot.epoch, 60, nowMs);

                          if (canRender) {
                            const val = observedPrecipByEpoch.get(slot.epoch);
                            intensity = (val !== undefined && val !== null) ? val : null;
                          } else {
                            intensity = null; // Explicitly null if not renderable
                          }
                          // STRICT: No borrowing consensus temperature for observed row type derivation.
                          temperature = null;
                        }

                        // Determine precipitation type from weather code, with temperature fallback
                        const precipType = getPrecipTypeFromWeatherCode(weatherCode, temperature);
                        const hideObservedFuture = isObserved
                          && Boolean(observedCutoffTimeKey)
                          && slot.time > (observedCutoffTimeKey as string);

                        return (
                          <div
                            key={`${row.id}-${slot.time}`}
                            className={cn("h-8 w-full px-[1px] py-[2px] relative")}
                            style={
                              hideObservedFuture
                                ? { opacity: 0, pointerEvents: 'none' }
                                : undefined
                            }
                          >
                            {isConsensusRow && (
                              <div className="absolute inset-0 -mx-[2px] rounded bg-primary/5 pointer-events-none" />
                            )}
                            <PrecipCell
                              pop={pop}
                              intensity={intensity}
                              threshold={POP_THRESHOLD}
                              isDisabled={!row.available}
                              isObserved={isObserved}
                              isActive={isActive}
                              tintColor={tintColor}
                              isConsensus={isConsensusRow}
                              precipType={precipType}
                              rowGlowColor={rowGlowColor}
                              testId={isObserved ? `observed-cell-${slot.epoch}` : undefined}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className={TOOLTIP_CONTENT_CLASSNAME}>
                    <ComparisonTooltipCard title={tooltip.slot.fullLabel} isUnverified={isUnverified}>
                      {showConsensus && (
                        <ComparisonTooltipSection>
                          <ComparisonTooltipRow
                            label="Consensus"
                            value={`${formatPop(tooltip.consensus?.pop ?? null)} POP / ${formatIntensity(tooltip.consensus?.intensity ?? null)} mm/hr`}
                            icon={
                              <span className="flex items-center gap-1">
                                <span
                                  className="inline-block h-2 w-2 rounded-full"
                                  style={{ backgroundColor: 'oklch(0.75 0.15 195)' }}
                                />
                                {consensusWeatherInfo && (
                                  <span
                                    className="flex items-center gap-1 text-sm"
                                    title={consensusWeatherInfo.description}
                                  >
                                    <span className="h-4 w-4">
                                      {consensusWeatherInfo.iconName ? <WeatherIcon name={consensusWeatherInfo.iconName as any} className="h-full w-full" /> : null}
                                    </span>
                                  </span>
                                )}
                              </span>
                            }
                          />
                          <ComparisonTooltipRow
                            label="Precip agreement"
                            value={formatAgreement(tooltip.consensus?.agreement ?? null)}
                          />
                          <ComparisonTooltipRow
                            label="POP agreement"
                            value={formatAgreement(tooltip.consensus?.probabilityAgreement ?? null)}
                          />
                          <ComparisonTooltipRow
                            label="Amount agreement"
                            value={formatAgreement(tooltip.consensus?.amountAgreement ?? null)}
                          />
                        </ComparisonTooltipSection>
                      )}
                      {Number.isFinite(tooltip.observed ?? NaN) && (
                        <ComparisonTooltipSection divider={showConsensus}>
                          <ComparisonTooltipRow
                            label="Observed"
                            value={`${formatIntensity(tooltip.observed)} mm/hr`}
                            icon={
                              <span
                                className="inline-block h-2 w-2 rounded-full"
                                style={{ backgroundColor: OBSERVED_TOOLTIP_COLOR }}
                              />
                            }
                          />
                        </ComparisonTooltipSection>
                      )}
                      <ComparisonTooltipSection divider={showConsensus || Number.isFinite(tooltip.observed ?? NaN)}>
                        {tooltip.models.map((model) => {
                          const weatherInfo = getWeatherInfo(model.weatherCode);
                          return (
                            <ComparisonTooltipRow
                              key={`${model.id}-${slot.time}-tooltip`}
                              label={`${model.name}:`}
                              value={`${formatPop(model.pop)} POP / ${formatIntensity(model.intensity)} mm/hr`}
                              icon={
                                <span className="flex items-center gap-1">
                                  <span
                                    className="h-2 w-2 triangle-icon"
                                    style={{ backgroundColor: model.color }}
                                  />
                                  {weatherInfo && (
                                    <span
                                      className="flex items-center gap-1 text-sm"
                                      title={weatherInfo.description}
                                    >
                                      <span className="h-4 w-4">
                                        {weatherInfo.iconName ? <WeatherIcon name={weatherInfo.iconName as any} className="h-full w-full" /> : null}
                                      </span>
                                    </span>
                                  )}
                                </span>
                              }
                            />
                          );
                        })}
                      </ComparisonTooltipSection>
                    </ComparisonTooltipCard>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-4 pt-4 border-t border-white/10 text-xs text-foreground/80">
        <div className="flex items-center gap-2">
          <div className="relative h-5 w-5 rounded-sm border border-white/20 bg-white/5">
            <svg className="absolute inset-0" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="8" fill="none" stroke="oklch(1 0 0 / 0.12)" strokeWidth="3" />
              <circle cx="12" cy="12" r="8" fill="none" stroke="oklch(0.92 0.05 195)" strokeWidth="3" strokeDasharray="18 100" strokeLinecap="round" transform="rotate(-90 12 12)" />
            </svg>
          </div>
          <span>POP (arc)</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <svg className="h-4 w-4 rounded-sm border border-white/20" viewBox="0 0 20 20">
              <rect width="20" height="20" fill="oklch(0.12 0.02 240)" />
              <rect width="20" height="20" fill="url(#precip-light)" />
            </svg>
            <span className="text-[10px]">Rain</span>
          </div>
          <div className="flex items-center gap-1">
            <svg className="h-4 w-4 rounded-sm border border-white/20" viewBox="0 0 20 20">
              <rect width="20" height="20" fill="oklch(0.12 0.02 240)" />
              <rect width="20" height="20" fill="url(#precip-heavy)" />
            </svg>
            <span className="text-[10px]">Heavy</span>
          </div>
          <div className="flex items-center gap-1">
            <svg className="h-4 w-4 rounded-sm border border-white/20" viewBox="0 0 20 20">
              <rect width="20" height="20" fill="oklch(0.12 0.02 240)" />
              <rect width="20" height="20" fill="url(#snow-moderate)" />
            </svg>
            <span className="text-[10px]">Snow</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConditionsComparisonGraph({
  timeSlots,
  modelHourlyById,
  modelAvailability,
  consensusByTime,
  showConsensus,
  observedConditionsByEpoch,
  observationsStatus,
  nowMs,
  nowMarkerTimeKey,
  observedCutoffTimeKey,
  isUnverified,
  observedAvailability
}: {
  timeSlots: TimeSlot[];
  modelHourlyById: Map<string, Map<string, ModelForecast['hourly'][number]>>;
  modelAvailability: Map<string, boolean>;
  consensusByTime: Map<string, HourlyConsensus>;
  showConsensus: boolean;
  observedConditionsByEpoch: Map<number, number>;
  observationsStatus: 'loading' | 'none' | 'vault' | 'error';
  nowMs: number;
  nowMarkerTimeKey: string | null;
  observedCutoffTimeKey: string | null;
  isUnverified?: boolean;
  observedAvailability: { available: boolean; reason: string | null; detail: string | null };
}) {
  const isMobile = useIsMobile();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const labelInterval = isMobile ? 6 : 3;
  const columnWidth = isMobile ? 22 : 28;
  const hasObserved = observedConditionsByEpoch.size > 0;

  const rows = useMemo<PrecipRow[]>(() => {
    const modelRows: PrecipRow[] = WEATHER_MODELS.map((model) => ({
      id: model.id,
      label: model.name,
      color: model.color,
      type: 'model' as const,
      available: modelAvailability.get(model.id) ?? false
    }));
    const list = [...modelRows];
    if (showConsensus) {
      list.push({
        id: 'consensus',
        label: 'Consensus',
        type: 'consensus' as const,
        available: true
      });
    }
    // Always include observed row
    list.push({
      id: 'observed',
      label: 'Observed',
      type: 'observed' as const,
      available: observedAvailability.available
    });
    return list;
  }, [modelAvailability, showConsensus, observedAvailability]);

  const tooltipColumns = useMemo(() => {
    return timeSlots.map((slot) => {
      const models = WEATHER_MODELS.map((model) => {
        const hour = modelHourlyById.get(model.id)?.get(slot.time);
        const normalizedCode = normalizeWeatherCode(hour?.weatherCode);
        return {
          id: model.id,
          name: model.name,
          color: model.color,
          weatherCode: Number.isFinite(normalizedCode) ? normalizedCode : null,
          available: modelAvailability.get(model.id) ?? false
        };
      });
      const consensusData = showConsensus ? consensusByTime.get(slot.time) : null;
      const normalizedConsensusCode = showConsensus
        ? normalizeWeatherCode(consensusData?.weatherCode.dominant)
        : NaN;
      const consensus = showConsensus
        ? {
          weatherCode: Number.isFinite(normalizedConsensusCode)
            ? normalizedConsensusCode
            : null,
          agreement: consensusData?.weatherCode.agreement
        }
        : null;

      const observed = hasObserved ? observedConditionsByEpoch.get(slot.epoch) ?? null : null;
      return {
        slot,
        models,
        consensus,
        observed
      };
    });
  }, [
    timeSlots,
    modelHourlyById,
    modelAvailability,
    consensusByTime,
    showConsensus,
    observedConditionsByEpoch,
    hasObserved
  ]);

  if (timeSlots.length === 0) {
    return (
      <PlaceholderPanel
        icon={Cloud}
        title="Conditions data unavailable"
        description="Hourly conditions data will appear once forecasts are loaded."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex flex-col text-xs text-foreground/70">
          <div className="h-6" />
          {rows.map((row) => {
            const labelTint = row.type === 'model' && row.color
              ? `linear-gradient(90deg, ${withAlpha(row.color, 0.14)}, transparent 85%)`
              : row.type === 'consensus'
                ? `linear-gradient(90deg, ${withAlpha('oklch(0.75 0.15 195)', 0.12)}, transparent 85%)`
                : undefined;

            return (
              <MatrixRowLabel
                key={row.id}
                label={row.label}
                type={row.type}
                color={row.color}
                available={row.available}
                labelTint={labelTint}
                unavailableReason={
                  row.type === 'observed' && !row.available && observedAvailability.reason
                    ? observedAvailability.reason
                    : undefined
                }
              />
            );
          })}
        </div>
        <div className="flex-1 overflow-x-auto">
          <div className="flex min-w-max">
            {timeSlots.map((slot, index) => {
              const isActive = hoverIndex === index;
              const isCurrent = slot.time === nowMarkerTimeKey;
              const tooltip = tooltipColumns[index];
              const hasConsensusData = Boolean(showConsensus && tooltip.consensus);
              const consensusInfo = getWeatherInfo(tooltip.consensus?.weatherCode ?? null);
              return (
                <Tooltip key={slot.time}>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        "relative flex flex-col items-center transition-opacity duration-150",
                        isActive && "bg-primary/10",
                        hoverIndex !== null && !isActive && "opacity-60"
                      )}
                      style={{ width: columnWidth }}
                      onMouseEnter={() => setHoverIndex(index)}
                      onMouseLeave={() => setHoverIndex(null)}
                      onFocus={() => setHoverIndex(index)}
                      onBlur={() => setHoverIndex(null)}
                      tabIndex={0}
                      aria-label={`Conditions column ${slot.fullLabel}`}
                    >
                      {isCurrent && (
                        <div
                          className="absolute inset-y-0 right-0 w-px bg-primary/60 pointer-events-none"
                          style={{
                            boxShadow: '0 0 10px oklch(0.75 0.15 195 / 0.35)'
                          }}
                        />
                      )}
                      <div
                        className={cn(
                          "h-6 w-full text-[10px] flex items-center justify-center text-foreground/70",
                          isCurrent && "text-primary"
                        )}
                      >
                        {index % labelInterval === 0 ? slot.label : ''}
                      </div>
                      {rows.map((row) => {
                        let weatherCode: number | null = null;
                        let agreement: number | null = null;
                        let rowGlowColor: string | undefined;
                        let isObserved = false;
                        const isConsensusRow = row.type === 'consensus';
                        if (row.type === 'model') {
                          rowGlowColor = row.color;
                          const hour = modelHourlyById.get(row.id)?.get(slot.time);
                          const normalizedCode = normalizeWeatherCode(hour?.weatherCode);
                          weatherCode = Number.isFinite(normalizedCode) ? normalizedCode : null;
                        } else if (row.type === 'consensus') {
                          rowGlowColor = 'oklch(0.75 0.15 195)';
                          const consensusData = consensusByTime.get(slot.time);
                          const normalizedCode = normalizeWeatherCode(consensusData?.weatherCode.dominant);
                          weatherCode = Number.isFinite(normalizedCode) ? normalizedCode : null;
                          const rawAgreement = consensusData?.weatherCode.agreement;
                          agreement = weatherCode === null
                            ? null
                            : Number.isFinite(rawAgreement ?? NaN)
                              ? rawAgreement ?? null
                              : null;
                        } else if (row.type === 'observed') {
                          isObserved = true;

                          // Strict gating: unavailability OR incomplete bucket OR missing data -> empty
                          // Use Date.now() for completion check as precise lastUpdated isn't passed to this sub-component
                          // But map logic already filtered for completion, so if it's in the map, it's completed.

                          if (!observedAvailability.available) {
                            weatherCode = null;
                          } else {
                            // Strict Rendering Gate via Completion
                            const canRender = isBucketCompleted(slot.epoch, 60, nowMs);

                            if (canRender) {
                              const v = observedConditionsByEpoch.get(slot.epoch);
                              // Strict Value Check: No ?? defaults
                              if (v === undefined || v === null) {
                                weatherCode = null;
                              } else {
                                weatherCode = v;
                              }
                            } else {
                              weatherCode = null;
                            }
                          }

                          // Dev assertion: catch fallback regressions
                          if (process.env.NODE_ENV !== 'production' && !observedAvailability.available && weatherCode !== null) {
                            console.error(`[Assertion Failed] Rendering observed conditions despite unavailability. Bucket: ${slot.time}, Value: ${weatherCode}`);
                          }
                        }

                        const weatherInfo = getWeatherInfo(weatherCode);
                        const hideObservedFuture = isObserved
                          && Boolean(observedCutoffTimeKey)
                          && slot.time > (observedCutoffTimeKey as string);

                        return (
                          <div
                            key={`${row.id}-${slot.time}`}
                            className={cn("h-8 w-full px-[1px] py-[2px] relative")}
                            style={
                              hideObservedFuture
                                ? { opacity: 0, pointerEvents: 'none' }
                                : undefined
                            }
                          >
                            {isConsensusRow && (
                              <div className="absolute inset-0 -mx-[2px] rounded bg-primary/5 pointer-events-none" />
                            )}
                            <ConditionCell
                              icon={weatherInfo?.iconName ? <WeatherIcon name={weatherInfo.iconName as any} className="h-4 w-4" /> : null}
                              isDisabled={!row.available}
                              isActive={isActive}
                              isConsensus={isConsensusRow}
                              agreement={agreement}
                              rowGlowColor={rowGlowColor}
                              testId={isObserved ? `observed-cell-${slot.epoch}` : undefined}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className={TOOLTIP_CONTENT_CLASSNAME}>
                    <ComparisonTooltipCard title={tooltip.slot.fullLabel} isUnverified={isUnverified}>
                      {showConsensus && tooltip.consensus && (
                        <ComparisonTooltipSection>
                          <ComparisonTooltipRow
                            label="Consensus"
                            value={formatConditionValue(tooltip.consensus.weatherCode)}
                            icon={
                              <span className="flex items-center gap-1">
                                <span
                                  className="inline-block h-2 w-2 rounded-full"
                                  style={{ backgroundColor: 'oklch(0.75 0.15 195)' }}
                                />
                                {consensusInfo && (
                                  <span
                                    className="flex items-center gap-1 text-sm"
                                    title={consensusInfo.description}
                                  >
                                    <span className="h-4 w-4">
                                      {consensusInfo.iconName ? <WeatherIcon name={consensusInfo.iconName as any} className="h-full w-full" /> : null}
                                    </span>
                                  </span>
                                )}
                              </span>
                            }
                          />
                        </ComparisonTooltipSection>
                      )}
                      {hasObserved && Number.isFinite(tooltip.observed ?? NaN) && (
                        <ComparisonTooltipSection divider={hasConsensusData}>
                          <ComparisonTooltipRow
                            label="Observed"
                            value={formatConditionValue(tooltip.observed)}
                            icon={
                              <span
                                className="inline-block h-2 w-2 rounded-full"
                                style={{ backgroundColor: OBSERVED_TOOLTIP_COLOR }}
                              />
                            }
                          />
                        </ComparisonTooltipSection>
                      )}
                      <ComparisonTooltipSection
                        divider={hasConsensusData || (hasObserved && Number.isFinite(tooltip.observed ?? NaN))}
                      >
                        {tooltip.models.map((model) => {
                          const modelInfo = getWeatherInfo(model.weatherCode);
                          return (
                            <ComparisonTooltipRow
                              key={`${model.id}-${slot.time}-tooltip`}
                              label={`${model.name}:`}
                              value={formatConditionValue(model.weatherCode)}
                              icon={
                                <span className="flex items-center gap-1">
                                  <span
                                    className="h-2 w-2 triangle-icon"
                                    style={{ backgroundColor: model.color }}
                                  />
                                  {modelInfo && (
                                    <span
                                      className="flex items-center gap-1 text-sm"
                                      title={modelInfo.description}
                                    >
                                      <span className="h-4 w-4">
                                        {modelInfo.iconName ? <WeatherIcon name={modelInfo.iconName as any} className="h-full w-full" /> : null}
                                      </span>
                                    </span>
                                  )}
                                </span>
                              }
                            />
                          );
                        })}
                      </ComparisonTooltipSection>
                    </ComparisonTooltipCard>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function PrecipCell({
  pop,
  intensity,
  threshold,
  isDisabled,
  isObserved,
  isActive,
  tintColor,
  isConsensus,
  precipType = 'rain',
  rowGlowColor,
  testId
}: {
  pop: number | null;
  intensity: number | null;
  threshold: number;
  isDisabled?: boolean;
  isObserved?: boolean;
  isActive?: boolean;
  tintColor?: string;
  isConsensus?: boolean;
  precipType?: PrecipType;
  rowGlowColor?: string;
  testId?: string;
}) {
  const clampedPop = Number.isFinite(pop ?? NaN)
    ? Math.max(0, Math.min(100, pop as number))
    : 0;
  const hasIntensity = Number.isFinite(intensity ?? NaN) && (intensity as number) > 0;
  const hasTrace = !hasIntensity && clampedPop > 0;

  const size = 28;
  const strokeWidth = 2.5;
  const radius = (size / 2) - strokeWidth - 1;
  const circumference = 2 * Math.PI * radius;
  const arcLength = (clampedPop / 100) * circumference;
  const arcColor = isConsensus
    ? 'oklch(0.9 0.1 180)'
    : 'oklch(0.95 0.03 220)';
  const arcOpacity = isDisabled ? 0.3 : clampedPop < threshold ? 0.6 : 0.85;

  // Pattern ID for rain/snow visualization
  const patternId = hasIntensity
    ? getPatternId(intensity, isObserved ? 'observed' : 'forecast', precipType)
    : hasTrace
      ? getTracePatternId(isObserved ? 'observed' : 'forecast', precipType)
      : '';


  // Base background for empty cells
  const emptyBg = 'oklch(0.12 0.02 240)';

  const overlayTint = tintColor ?? (rowGlowColor ? withAlpha(rowGlowColor, 0.06) : undefined);

  const glowStyle = rowGlowColor && !isDisabled
    ? {
      boxShadow: `0 0 0 1px ${withAlpha(rowGlowColor, 0.1)}, 0 0 10px ${withAlpha(
        rowGlowColor,
        0.08
      )}`
    }
    : undefined;

  return (
    <div
      className={cn(
        "relative h-full w-full rounded-sm overflow-hidden transition-all duration-150",
        isActive && "ring-2 ring-primary/50 scale-[1.02]",
        isConsensus && "ring-1 ring-primary/20"
      )}
      style={{
        backgroundColor: emptyBg,
        opacity: isDisabled ? 0.35 : 1,
        ...glowStyle
      }}
      data-testid={testId}
    >
      {/* Rain pattern background */}
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox={`0 0 ${size} ${size}`}
        preserveAspectRatio="xMidYMid slice"
      >
        {/* Base dark fill */}
        <rect width={size} height={size} fill={emptyBg} />

        {/* Subtle tint overlay (used for row glow and consensus agreement shading) */}
        {overlayTint && <rect width={size} height={size} fill={overlayTint} />}

        {/* Rain pattern overlay */}
        {patternId && (
          <rect
            width={size}
            height={size}
            fill={`url(#${patternId})`}
            opacity={isDisabled ? 0.4 : 1}
          />
        )}

        {/* POP arc overlay */}
        {clampedPop > 0 && (
          <>
            {/* Track circle */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="oklch(1 0 0 / 0.08)"
              strokeWidth={strokeWidth}
            />
            {/* Progress arc */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={arcColor}
              strokeWidth={strokeWidth}
              strokeDasharray={`${arcLength} ${circumference}`}
              strokeLinecap="round"
              opacity={arcOpacity}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          </>
        )}

        {/* Center dot for high POP + intensity */}
        {clampedPop >= 85 && hasIntensity && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={2}
            fill="oklch(1 0 0 / 0.7)"
          />
        )}
      </svg>
    </div>
  );
}

function ConditionCell({
  icon,
  isDisabled,
  isActive,
  isConsensus,
  agreement,
  rowGlowColor,
  testId
}: {
  icon: React.ReactNode | null;
  isDisabled?: boolean;
  isActive?: boolean;
  isConsensus?: boolean;
  agreement?: number | null;
  rowGlowColor?: string;
  testId?: string;
}) {
  const baseBg = 'oklch(0.12 0.02 240)';
  const glowStyle = rowGlowColor && !isDisabled
    ? {
      boxShadow: `0 0 0 1px ${withAlpha(rowGlowColor, 0.1)}, 0 0 10px ${withAlpha(
        rowGlowColor,
        0.08
      )}`
    }
    : undefined;

  const agreementValue = Number.isFinite(agreement ?? NaN) ? (agreement as number) : null;
  const agreementRingColor = agreementValue === null || !isConsensus || isDisabled
    ? null
    : agreementValue < 50
      ? 'oklch(0.65 0.22 25 / 0.55)'
      : agreementValue < 75
        ? 'oklch(0.75 0.18 85 / 0.5)'
        : null;

  return (
    <div
      className={cn(
        "relative h-full w-full rounded-sm overflow-hidden transition-all duration-150 flex items-center justify-center",
        isActive && "ring-2 ring-primary/50 scale-[1.02]",
        isConsensus && "ring-1 ring-primary/20"
      )}
      style={{
        backgroundColor: baseBg,
        opacity: isDisabled ? 0.35 : 1,
        ...glowStyle
      }}
      data-testid={testId}
    >
      {agreementRingColor && (
        <div
          className="absolute inset-0 rounded-sm border border-transparent pointer-events-none"
          style={{ borderColor: agreementRingColor }}
        />
      )}
      {icon && (
        <span className="text-base leading-none">{icon}</span>
      )}
    </div>
  );
}

// Graph isolation flag
// Enabled: 'precipitation' and 'temperature' (via 'all' or explicit logic if we want to isolate)
// User instruction: "Re-enable Temperature observed rendering"
// We can set it to 'all' or keep it simpler. Let's create a set or union?
// Type is `GraphKey | 'all'`.
// I'll set it to 'all' for now, but I might need to keep wind/conditions disabled inside their hooks if they are not ready.
// User said: "Keep other graphs disabled ... (wind/conditions)".
// So if I set 'all', I need to guard wind/conditions hooks.
// `observedPrecipByEpoch` and `observedTempByEpoch` have guards.
// The wind/conditions hooks have `if (OBSERVED_ENABLED_GRAPH !== 'all' ...)` guards.
// So if I set 'all', wind/conditions hooks will ENABLE.
// I should update their guards to EXPLICITLY disable them or use specific allow list.
// Or I can change definition to `const OBSERVED_ENABLED_GRAPH: Array<GraphKey> = ['precipitation', 'temperature'];`
// But types might clash.
// I'll leave `OBSERVED_ENABLED_GRAPH` as 'all'.
// And I will add specific disable logic to wind and conditions hooks.
const OBSERVED_ENABLED_GRAPH: GraphKey | 'all' = 'all';

export function GraphsPanel({
  forecasts,
  consensus = [],
  showConsensus = true,
  fallbackForecast = null,
  timezone,
  visibleLines = {},
  onToggleLine = () => { },
  location,
  lastUpdated,
  isPrimary = true
}: GraphsPanelProps) {
  const [activeGraph, setActiveGraph] = useState<GraphKey>('temperature');
  const [viewMode, setViewMode] = useState<ViewMode>('chart');
  const [windMode, setWindMode] = useState<WindMode>('chart');

  // 3-state logic: loading | none | vault | error
  type ObservationsStatus = 'loading' | 'none' | 'vault' | 'error';
  const [observationsStatus, setObservationsStatus] = useState<ObservationsStatus>('loading');
  const [fetchedObservations, setFetchedObservations] = useState<ObservationData | null | undefined>(undefined);
  const [apiObservations, setApiObservations] = useState<{ hourly: ObservedHourly[]; fetchedAt: Date } | null | undefined>(undefined);
  const [fetchError, setFetchError] = useState<Error | null>(null);
  const observationsCacheRef = useRef<Map<string, ObservationData | null>>(new Map());
  const apiObservationsCacheRef = useRef<Map<string, { hourly: ObservedHourly[]; fetchedAt: Date } | null>>(new Map());
  const observationsRequestIdRef = useRef(0);

  useEffect(() => {
    // GATING: Only fetch observations for primary location
    // When browsing non-primary, observations are disabled
    if (!location || !isPrimary) {
      setObservationsStatus('none');
      setFetchedObservations(undefined);
      setApiObservations(undefined);
      setFetchError(null);
      return;
    }

    const cacheKey = `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;
    const hasCached = observationsCacheRef.current.has(cacheKey);
    const hasCachedApi = apiObservationsCacheRef.current.has(cacheKey);
    if (hasCached) {
      const cached = observationsCacheRef.current.get(cacheKey) ?? null;
      setFetchedObservations(cached);
      setObservationsStatus(cached === null ? 'none' : 'vault');
    } else {
      setFetchedObservations(undefined);
      setObservationsStatus('loading');
    }

    if (hasCachedApi) {
      setApiObservations(apiObservationsCacheRef.current.get(cacheKey) ?? null);
    } else {
      setApiObservations(undefined);
    }

    // Determine time range from forecasts or consensus
    // We already compute windowTimes via buildHourlyWindow, but that depends on props.
    // Let's use a simple heuristic: Now - 24h to Now + 48h to cover the window.
    // Or just align with the "windowTimes" if we could access them.
    // But they are computed inside the component.
    // We can just fetch a broad range. The helper handles start/end buckets.
    const now = Date.now();
    const startMs = now - 24 * 60 * 60 * 1000;
    const endMs = now + 48 * 60 * 60 * 1000;

    const requestId = ++observationsRequestIdRef.current;
    let mounted = true;
    async function load() {
      try {
        setFetchError(null);

        const lat = location!.latitude;
        const lon = location!.longitude;
        const [data, apiData] = await Promise.all([
          fetchObservationsForRange(
            'eccc',
            startMs,
            endMs,
            'consensus-stations-v1',
            lat,
            lon
          ),
          fetchObservedHourlyFromApi(lat, lon, timezone ?? 'America/Toronto')
        ]);
        if (mounted && observationsRequestIdRef.current === requestId) {
          observationsCacheRef.current.set(cacheKey, data);
          apiObservationsCacheRef.current.set(cacheKey, apiData);
          if (data === null) {
            setFetchedObservations(null);
            setObservationsStatus('none');
          } else {
            setFetchedObservations(data);
            setObservationsStatus('vault');
          }
          setApiObservations(apiData);
        }
      } catch (e) {
        console.error('Failed to fetch observations', e);
        if (mounted && observationsRequestIdRef.current === requestId) {
          // If we have cached observations for this location, keep rendering them and
          // avoid flipping the UI into an "error" empty state.
          if (!hasCached) {
            setFetchError(e as Error);
            setObservationsStatus('error');
            setFetchedObservations(null);
            setApiObservations(null);
          }
        }
      }
    }
    load();
    return () => { mounted = false; };
  }, [location?.latitude, location?.longitude, isPrimary, timezone, lastUpdated?.getTime()]);



  const { slots: windowSlots, currentTimeKey } = useMemo(
    () => buildHourlyWindow({
      forecasts,
      consensus,
      showConsensus,
      fallbackForecast,
      timezone
    }),
    [forecasts, consensus, showConsensus, fallbackForecast, timezone]
  );

  const slotEpochByTimeKey = useMemo(() => {
    return new Map(windowSlots.map((slot) => [slot.time, slot.epoch]));
  }, [windowSlots]);

  const mergedObservedSeries = useMemo(() => {
    const vaultSeries = fetchedObservations ? convertToObservedHourly(fetchedObservations, timezone) : [];
    const vaultByEpoch = new Map<number, ObservedHourly>();
    let maxVaultEpoch = -Infinity;

    for (const row of vaultSeries) {
      const epoch = row.epoch;
      if (!Number.isFinite(epoch ?? NaN)) continue;
      vaultByEpoch.set(epoch as number, row);
      maxVaultEpoch = Math.max(maxVaultEpoch, epoch as number);
    }

    type ObservedHourlyWithEpoch = ObservedHourly & { epoch: number };

    const apiSeries = (apiObservations?.hourly ?? [])
      .map((row): ObservedHourlyWithEpoch | null => {
        const epoch = row.epoch ?? slotEpochByTimeKey.get(row.time);
        return Number.isFinite(epoch ?? NaN) ? { ...row, epoch: epoch as number } : null;
      })
      .filter((row): row is ObservedHourlyWithEpoch => row !== null);

    const isFiniteNumber = (value: unknown): value is number =>
      typeof value === 'number' && Number.isFinite(value);

    const mergedByEpoch = new Map<number, ObservedHourly>(vaultByEpoch);
    let apiContributed = false;

    for (const apiRow of apiSeries) {
      const epoch = apiRow.epoch;
      const existing = mergedByEpoch.get(epoch);
      if (!existing) {
        if (epoch > maxVaultEpoch) apiContributed = true;
        mergedByEpoch.set(epoch, apiRow);
        continue;
      }

      const merged: ObservedHourly = { ...existing };
      const before = JSON.stringify({
        temperature: merged.temperature,
        precipitation: merged.precipitation,
        windSpeed: merged.windSpeed,
        windDirection: merged.windDirection,
        windGusts: merged.windGusts
      });

      if (!isFiniteNumber(merged.temperature) && isFiniteNumber(apiRow.temperature)) merged.temperature = apiRow.temperature;
      if (!isFiniteNumber(merged.precipitation) && isFiniteNumber(apiRow.precipitation)) merged.precipitation = apiRow.precipitation;
      if (!isFiniteNumber(merged.windSpeed) && isFiniteNumber(apiRow.windSpeed)) merged.windSpeed = apiRow.windSpeed;
      if (!isFiniteNumber(merged.windDirection) && isFiniteNumber(apiRow.windDirection)) merged.windDirection = apiRow.windDirection;
      if (!isFiniteNumber(merged.windGusts) && isFiniteNumber(apiRow.windGusts)) merged.windGusts = apiRow.windGusts;

      mergedByEpoch.set(epoch, merged);

      const after = JSON.stringify({
        temperature: merged.temperature,
        precipitation: merged.precipitation,
        windSpeed: merged.windSpeed,
        windDirection: merged.windDirection,
        windGusts: merged.windGusts
      });

      if (before !== after) apiContributed = true;
    }

    const merged = Array.from(mergedByEpoch.values()).sort((a, b) => {
      const ea = a.epoch ?? 0;
      const eb = b.epoch ?? 0;
      return ea - eb;
    });

    const hasVault = vaultSeries.length > 0;
    const hasApi = apiSeries.length > 0;
    const source: 'vault' | 'api' | 'mixed' | 'none' =
      hasVault && apiContributed ? 'mixed'
        : hasVault ? 'vault'
          : hasApi ? 'api'
            : 'none';

    return { merged, source };
  }, [apiObservations, fetchedObservations, slotEpochByTimeKey, timezone]);

  const observedSeries = mergedObservedSeries.merged;

  const timeSlots = useMemo(() => {
    return windowSlots.map((s) => {
      const timeParts = parseOpenMeteoDateTime(s.time);
      return {
        time: s.time,
        epoch: s.epoch,
        label: timeParts ? formatHourLabel(timeParts) : s.time,
        fullLabel: timeParts ? formatWeekdayHourLabel(timeParts) : s.time,
        isCurrent: s.time === currentTimeKey
      };
    });
  }, [windowSlots, currentTimeKey, timezone]);

  const precipTimeSlots = useMemo(() => {
    return windowSlots.map((s) => {
      const endTime = shiftOpenMeteoDateTimeKey(s.time, 1) ?? s.time;
      const endEpoch = s.epoch + 3600000; // 1 hour shift
      const timeParts = parseOpenMeteoDateTime(endTime);
      return {
        time: endTime,
        epoch: endEpoch,
        label: timeParts ? formatHourLabel(timeParts) : endTime,
        fullLabel: timeParts ? formatWeekdayHourLabel(timeParts) : endTime,
        isCurrent: false
      };
    });
  }, [windowSlots]);

  const { precipNowMarkerTimeKey, precipObservedCutoffTimeKey } = useMemo(() => {
    if (!currentTimeKey) {
      return { precipNowMarkerTimeKey: null as string | null, precipObservedCutoffTimeKey: null as string | null };
    }

    return {
      precipNowMarkerTimeKey: currentTimeKey,
      precipObservedCutoffTimeKey: currentTimeKey
    };
  }, [currentTimeKey]);

  const modelHourlyById = useMemo(
    () => buildHourlyForecastMap(forecasts),
    [forecasts]
  );

  const modelAvailability = useMemo(() => {
    const map = new Map<string, boolean>();
    forecasts.forEach((forecast) => {
      map.set(
        forecast.model.id,
        !forecast.error && forecast.hourly.length > 0
      );
    });
    return map;
  }, [forecasts]);

  const consensusByTime = useMemo(
    () => new Map(consensus.map((hour) => [hour.time, hour])),
    [consensus]
  );

  const observedTempByEpoch = useMemo(() => {
    // Only allow if graph is enabled (and not disabled by strict isolation instructions)
    if (OBSERVED_ENABLED_GRAPH !== 'all' && OBSERVED_ENABLED_GRAPH !== 'temperature') return new Map<number, number>();

    const map = new Map<number, number>();
    const nowMs = Date.now();
    observedSeries.forEach((observation) => {
      const t = observation.epoch;
      if (!Number.isFinite(t ?? NaN)) return;
      if (!isBucketCompleted(t as number, 60, nowMs)) return;

      const val = observation.temperature;
      if (!Number.isFinite(val ?? NaN)) return;
      map.set(t as number, val as number);
    });

    return map;
  }, [observedSeries, lastUpdated]);

  const observedPrecipByEpoch = useMemo(() => {
    const map = new Map<number, number>();

    // Strict variable check: observed precip is strictly bucketed accumulation.
    if (!isBucketedAccumulation('p_mm')) return map;

    // Isolation check
    // Ensure 'all' allows precip, or explicit 'precipitation'.
    if (OBSERVED_ENABLED_GRAPH !== 'all' && OBSERVED_ENABLED_GRAPH !== 'precipitation') return map;

    const now = Date.now();
    observedSeries.forEach((observation) => {
      const epoch = observation.epoch;
      if (typeof epoch !== 'number' || !Number.isFinite(epoch)) return;
      if (!isBucketCompleted(epoch, 60, now)) return;

      const amount = observation.precipitation;
      if (!observation.time || !Number.isFinite(amount ?? NaN)) return;
      // Precip graphs are rendered as bucket-END aligned (bars end at the hour),
      // so key precip values by bucket end epoch for consistent lookup.
      map.set(bucketEndMs(epoch, 60), amount as number);
    });
    console.debug('[Observed][Precip]', {
      buckets: map.size,
      keys: Array.from(map.keys()).slice(0, 3)
    });
    return map;
  }, [observedSeries, lastUpdated]);

  const observedConditionsByEpoch = useMemo(() => {
    if (OBSERVED_ENABLED_GRAPH !== 'all' && OBSERVED_ENABLED_GRAPH !== 'conditions') return new Map<number, number>();
    const map = new Map<number, number>();
    const now = Date.now();
    observedSeries.forEach((observation) => {
      const epoch = observation.epoch;
      if (typeof epoch !== 'number' || !Number.isFinite(epoch)) return;
      if (!isBucketCompleted(epoch, 60, now)) return;

      const code = (observation as ObservedHourly & { weatherCode?: number }).weatherCode;
      if (!observation.time || !Number.isFinite(code ?? NaN)) return;
      const normalized = normalizeWeatherCode(code);
      if (!Number.isFinite(normalized)) return;
      map.set(epoch, normalized);
    });
    return map;
  }, [observedSeries, lastUpdated]);

  const observedWindByEpoch = useMemo(() => {
    if (OBSERVED_ENABLED_GRAPH !== 'all' && OBSERVED_ENABLED_GRAPH !== 'wind') return new Map<number, { direction: number; speed?: number; gust?: number }>();
    const map = new Map<number, { direction: number; speed?: number; gust?: number }>();
    const now = Date.now();
    observedSeries.forEach((observation) => {
      const epoch = observation.epoch;
      if (typeof epoch !== 'number' || !Number.isFinite(epoch)) return;
      if (!isBucketCompleted(epoch, 60, now)) return;

      if (!observation.time || !Number.isFinite(observation.windDirection ?? NaN)) return;
      map.set(epoch, {
        direction: observation.windDirection as number,
        speed: Number.isFinite(observation.windSpeed ?? NaN) ? observation.windSpeed : undefined,
        gust: Number.isFinite(observation.windGusts ?? NaN) ? observation.windGusts : undefined
      });
    });
    return map;
  }, [observedSeries, lastUpdated]);

  // Observed availability with graph-specific reasoning
  const observedAvailability = useMemo(() => {
    // No location provided
    if (!location) {
      return {
        temperature: { available: false, reason: 'Location required', detail: 'Location required to fetch station data' },
        precipitation: { available: false, reason: 'Location required', detail: 'Location required to fetch station data' },
        wind: { available: false, reason: 'Location required', detail: 'Location required to fetch station data' },
        conditions: { available: false, reason: 'Location required', detail: 'Location required to fetch station data' }
      };
    }

    // Observations are only fetched for the primary location.
    if (!isPrimary) {
      return {
        temperature: { available: false, reason: 'Primary only', detail: 'Observed station data is only shown for the primary location' },
        precipitation: { available: false, reason: 'Primary only', detail: 'Observed station data is only shown for the primary location' },
        wind: { available: false, reason: 'Primary only', detail: 'Observed station data is only shown for the primary location' },
        conditions: { available: false, reason: 'Primary only', detail: 'Observed station data is only shown for the primary location' }
      };
    }

    // Fetch error occurred (and no API observations to fall back on)
    if (
      fetchError &&
      (fetchedObservations === undefined || fetchedObservations === null) &&
      !(apiObservations && apiObservations.hourly.length > 0)
    ) {
      return {
        temperature: { available: false, reason: 'Fetch failed', detail: `Failed to fetch observations: ${fetchError.message}` },
        precipitation: { available: false, reason: 'Fetch failed', detail: `Failed to fetch observations: ${fetchError.message}` },
        wind: { available: false, reason: 'Fetch failed', detail: `Failed to fetch observations: ${fetchError.message}` },
        conditions: { available: false, reason: 'Fetch failed', detail: `Failed to fetch observations: ${fetchError.message}` }
      };
    }

    // fetchObservationsForRange returned null - could mean no station coverage or no data yet
    // We cannot definitively distinguish between these cases without deeper inspection,
    // so we use a neutral message
    // fetchObservationsForRange returned null - could mean no station coverage or no data yet
    // We distinguish "Loading" (undefined) from "No Data" (null) if needed, but for "availability" logic:
    // If undefined (Loading), we can say unavailable/loading.
    // If null (No Data), we say No data.
    if (fetchedObservations === null && !(apiObservations && apiObservations.hourly.length > 0)) {
      return {
        temperature: { available: false, reason: 'No data', detail: 'No observed data available for this location and time range' },
        precipitation: { available: false, reason: 'No data', detail: 'No observed data available for this location and time range' },
        wind: { available: false, reason: 'No data', detail: 'No observed data available for this location and time range' },
        conditions: { available: false, reason: 'No data', detail: 'No observed data available for this location and time range' }
      };
    }

    if (fetchedObservations === undefined && apiObservations === undefined) {
      return {
        temperature: { available: false, reason: 'Loading...', detail: 'Fetching observations...' },
        precipitation: { available: false, reason: 'Loading...', detail: 'Fetching observations...' },
        wind: { available: false, reason: 'Loading...', detail: 'Fetching observations...' },
        conditions: { available: false, reason: 'Loading...', detail: 'Fetching observations...' }
      };
    }

    // Data was fetched, check graph-specific availability
    const status = {
      temperature: observedTempByEpoch.size > 0
        ? { available: true, reason: null, detail: null }
        : { available: false, reason: 'Not synced', detail: 'Temperature data not yet synced for this time range' },
      precipitation: observedPrecipByEpoch.size > 0
        ? { available: true, reason: null, detail: null }
        : { available: false, reason: 'Not synced', detail: 'Precipitation data not yet synced for this time range' },
      wind: observedWindByEpoch.size > 0
        ? { available: true, reason: null, detail: null }
        : { available: false, reason: 'Not synced', detail: 'Wind data not yet synced for this time range' },
      conditions: observedConditionsByEpoch.size > 0
        ? { available: true, reason: null, detail: null }
        : { available: false, reason: 'Not synced', detail: 'Conditions data not yet synced for this time range' }
    };

    if (process.env.NODE_ENV !== 'production' && fetchedObservations) {
      console.table({
        temp: Array.from(observedTempByEpoch.entries()).slice(0, 5),
        precip: Array.from(observedPrecipByEpoch.entries()).slice(0, 5),
        cond: Array.from(observedConditionsByEpoch.entries()).slice(0, 5),
        wind: Array.from(observedWindByEpoch.entries()).slice(0, 5),
        availability: Object.fromEntries(Object.entries(status).map(([k, v]) => [k, v.available]))
      });
    }

    return status;
  }, [location, isPrimary, fetchError, fetchedObservations, apiObservations, observedTempByEpoch, observedPrecipByEpoch, observedWindByEpoch, observedConditionsByEpoch]);


  const title = activeGraph === 'wind' && windMode === 'matrix'
    ? '48-Hour Wind Direction Matrix'
    : GRAPH_TITLES[activeGraph];
  const placeholderModeLabel = viewMode === 'table' ? 'table view' : 'comparison';
  const showWindFill = visibleLines['Wind Fill'] ?? true;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-4 sm:p-6 readable-text"
    >
      <Tabs
        value={activeGraph}
        onValueChange={(value) => setActiveGraph(value as GraphKey)}
        className="gap-4"
      >
        {process.env.NODE_ENV !== 'production' && (
          <div className="flex items-center gap-4 text-[10px] font-mono border-b border-white/10 pb-2 mb-2">
            {(() => {
              const sourceLabel = mergedObservedSeries.source !== 'none'
                ? mergedObservedSeries.source.toUpperCase()
                : observationsStatus.toUpperCase();
              const sourceTone = mergedObservedSeries.source === 'mixed'
                ? "bg-fuchsia-500/20 text-fuchsia-200"
                : mergedObservedSeries.source === 'api'
                  ? "bg-cyan-500/20 text-cyan-200"
                  : observationsStatus === 'vault'
                    ? "bg-emerald-500/20 text-emerald-300"
                    : observationsStatus === 'loading'
                      ? "bg-blue-500/20 text-blue-300"
                      : observationsStatus === 'error'
                        ? "bg-red-500/20 text-red-300"
                        : "bg-yellow-500/20 text-yellow-300";

              return (
                <span className={cn("px-1.5 py-0.5 rounded", sourceTone)}>
                  Observed source: {sourceLabel}
                </span>
              );
            })()}
            <span className="text-foreground/50">
              loaded buckets: {observedSeries.length}
            </span>
            {observedSeries.length > 0 && (
              <span className="text-foreground/50">
                last: {observedSeries[observedSeries.length - 1].time.slice(5)}
              </span>
            )}
          </div>
        )}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold">{title}</h2>
            {activeGraph === 'wind' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Toggle
                    pressed={windMode === 'matrix'}
                    onPressedChange={(pressed) => {
                      setWindMode(pressed ? 'matrix' : 'chart');
                      if (pressed && viewMode === 'table') {
                        setViewMode('chart');
                      }
                    }}
                    variant="outline"
                    aria-label="Wind direction matrix"
                    className="h-9 px-2 data-[state=on]:border-primary/40 data-[state=on]:bg-primary/15 data-[state=on]:text-primary data-[state=on]:shadow-[0_0_12px_oklch(0.75_0.15_195_/0.35)]"
                  >
                    <Navigation className="w-4 h-4" />
                    <span className="text-xs text-foreground/80">Dir</span>
                  </Toggle>
                </TooltipTrigger>
                <TooltipContent side="top" className={TOOLTIP_CONTENT_CLASSNAME}>
                  <ComparisonTooltipCard title="Direction matrix" />
                </TooltipContent>
              </Tooltip>
            )}
            {activeGraph === 'wind' && viewMode === 'chart' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Toggle
                    pressed={windMode === 'chart' ? showWindFill : false}
                    onPressedChange={() => onToggleLine('Wind Fill')}
                    variant="outline"
                    aria-label="Wind fill"
                    className="h-9 px-2 data-[state=on]:border-primary/40 data-[state=on]:bg-primary/15 data-[state=on]:text-primary data-[state=on]:shadow-[0_0_12px_oklch(0.75_0.15_195_/0.35)]"
                    disabled={windMode !== 'chart'}
                  >
                    <Layers className="w-4 h-4" />
                    <span className="text-xs text-foreground/80">Fill</span>
                  </Toggle>
                </TooltipTrigger>
                <TooltipContent side="top" className={TOOLTIP_CONTENT_CLASSNAME}>
                  <ComparisonTooltipCard
                    title={windMode === 'chart' ? 'Wind fill' : 'Fill unavailable in direction mode'}
                  />
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TabsList className="gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger
                    value="temperature"
                    className="flex-none"
                    aria-label="Temperature graph"
                  >
                    <Thermometer className="w-4 h-4" />
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent side="top" className={TOOLTIP_CONTENT_CLASSNAME}>
                  <ComparisonTooltipCard title="Temperature graph" />
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger
                    value="precipitation"
                    className="flex-none"
                    aria-label="Precipitation graph"
                  >
                    <Droplets className="w-4 h-4" />
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent side="top" className={TOOLTIP_CONTENT_CLASSNAME}>
                  <ComparisonTooltipCard title="Precipitation graph" />
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger
                    value="wind"
                    className="flex-none"
                    aria-label="Wind graph"
                  >
                    <Wind className="w-4 h-4" />
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent side="top" className={TOOLTIP_CONTENT_CLASSNAME}>
                  <ComparisonTooltipCard title="Wind graph" />
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger
                    value="conditions"
                    className="flex-none"
                    aria-label="Conditions graph"
                  >
                    <Cloud className="w-4 h-4" />
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent side="top" className={TOOLTIP_CONTENT_CLASSNAME}>
                  <ComparisonTooltipCard title="Conditions graph" />
                </TooltipContent>
              </Tooltip>
            </TabsList>
            <Tooltip>
              <TooltipTrigger asChild>
                <Toggle
                  pressed={viewMode === 'table'}
                  onPressedChange={(pressed) =>
                    setViewMode(pressed ? 'table' : 'chart')
                  }
                  variant="outline"
                  aria-label="Table view"
                  className="h-9 w-9 p-0"
                >
                  <ListIcon className="w-4 h-4" />
                </Toggle>
              </TooltipTrigger>
              <TooltipContent side="top" className={TOOLTIP_CONTENT_CLASSNAME}>
                <ComparisonTooltipCard title="Table view" />
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <TabsContent value="temperature">
          {viewMode === 'table' ? (
            <TemperatureTable
              timeSlots={timeSlots}
              modelHourlyById={modelHourlyById}
              consensusByTime={consensusByTime}
              showConsensus={showConsensus}
              observedTempByEpoch={observedTempByEpoch}
            />
          ) : (
            <HourlyChart
              forecasts={forecasts}
              consensus={consensus}
              showConsensus={showConsensus}
              fallbackForecast={fallbackForecast}
              observations={observedSeries} // Legacy prop retained for type compat but unused
              timezone={timezone}
              visibleLines={visibleLines}
              onToggleLine={onToggleLine}
              observedAvailability={observedAvailability.temperature}
              // STRICT PROPS
              observedTempByEpoch={observedTempByEpoch}
              observationsStatus={observationsStatus}
              nowMs={Date.now()}
            />
          )}
        </TabsContent>

        <TabsContent value="precipitation">
          {viewMode === 'table' ? (
            <PrecipitationTable
              timeSlots={precipTimeSlots}
              modelHourlyById={modelHourlyById}
              consensusByTime={consensusByTime}
              showConsensus={showConsensus}
              observedPrecipByEpoch={observedPrecipByEpoch}
            />
          ) : (
            <PrecipitationComparisonGraph
              timeSlots={precipTimeSlots}
              modelHourlyById={modelHourlyById}
              modelAvailability={modelAvailability}
              consensusByTime={consensusByTime}
              showConsensus={showConsensus}
              observedPrecipByEpoch={observedPrecipByEpoch}
              observationsStatus={observationsStatus}
              nowMs={Date.now()}
              nowMarkerTimeKey={precipNowMarkerTimeKey}
              observedCutoffTimeKey={precipObservedCutoffTimeKey}
              isUnverified={fetchedObservations?.trust?.mode === 'unverified'}
              observedAvailability={observedAvailability.precipitation}
            />
          )}
        </TabsContent>

        <TabsContent value="wind">
          {viewMode === 'table' ? (
            <PlaceholderPanel
              icon={Wind}
              title="Wind table coming soon"
              description={`Hourly wind ${placeholderModeLabel} is on the way.`}
            />
          ) : windowSlots.length === 0 ? (
            <PlaceholderPanel
              icon={Wind}
              title="Wind data unavailable"
              description="Hourly wind data will appear once forecasts are loaded."
            />
          ) : windMode === 'matrix' ? (
            <WindDirectionMatrix
              timeSlots={timeSlots}
              modelHourlyById={modelHourlyById}
              modelAvailability={modelAvailability}
              consensusByTime={consensusByTime}
              showConsensus={showConsensus}
              observedWindByEpoch={observedWindByEpoch}
              observedCutoffTimeKey={currentTimeKey}
            />
          ) : (
            <WindChart
              forecasts={forecasts}
              consensus={consensus}
              showConsensus={showConsensus}
              fallbackForecast={fallbackForecast}
              observations={observedSeries}
              timezone={timezone}
              visibleLines={visibleLines}
              onToggleLine={onToggleLine}
            />
          )}
        </TabsContent>

        <TabsContent value="conditions">
          {viewMode === 'table' ? (
            <PlaceholderPanel
              icon={Cloud}
              title="Conditions table coming soon"
              description={`Hourly conditions ${placeholderModeLabel} is on the way.`}
            />
          ) : (
            <ConditionsComparisonGraph
              timeSlots={timeSlots}
              modelHourlyById={modelHourlyById}
              modelAvailability={modelAvailability}
              consensusByTime={consensusByTime}
              showConsensus={showConsensus}
              // Force empty map for now if we want to keep it disabled while enabling temperature with 'all'.
              // User said "Keep other graphs disabled (wind/conditions)".
              // Since I set OBSERVED_ENABLED_GRAPH = 'all', I should pass empty map here OR update the hook for conditions.
              // I'll pass empty map here override, OR uncomment the hook but block it.
              // The hook observedConditionsByEpoch is commented out in previous steps (Lines 1592-1606 in original context).
              // Let's check if the HOOK is active.
              // I need to see if observedConditionsByEpoch is defined. I saw it passed in props.
              // I'll assume I need to ensure it returns empty.
              observedConditionsByEpoch={observedConditionsByEpoch}
              observationsStatus={observationsStatus}
              nowMs={Date.now()}
              nowMarkerTimeKey={precipNowMarkerTimeKey}
              observedCutoffTimeKey={currentTimeKey}
              isUnverified={fetchedObservations?.trust?.mode === 'unverified'}
              observedAvailability={observedAvailability.conditions}
            />
          )}
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
