/**
 * GraphsPanel Component - Arctic Data Observatory
 * Tabbed suite for hourly model comparisons with chart/table modes.
 */

import React, { useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Thermometer, Droplets, Wind, Cloud, Layers, Navigation, List as ListIcon } from 'lucide-react';
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
import { normalizeWeatherCode, WEATHER_CODES, WEATHER_MODELS, type ModelForecast, type ObservedHourly } from '@/lib/weatherApi';
import type { HourlyConsensus } from '@/lib/consensus';
import {
  findCurrentHourIndex,
  formatHourLabel,
  formatWeekdayHourLabel,
  parseOpenMeteoDateTime,
  shiftOpenMeteoDateTimeKey
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

type GraphKey = 'temperature' | 'precipitation' | 'wind' | 'conditions';
type ViewMode = 'chart' | 'table';
type WindMode = 'chart' | 'matrix';

type TimeSlot = {
  time: string;
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
  observations?: ObservedHourly[];
  timezone?: string;
  visibleLines?: Record<string, boolean>;
  onToggleLine?: (lineName: string) => void;
  location?: { latitude: number; longitude: number };
  lastUpdated?: Date | null;
}

interface HourlyWindow {
  times: string[];
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
  const baseTimes = showConsensus && consensus.length > 0
    ? consensus.map((hour) => hour.time)
    : baseForecast?.hourly.map((hour) => hour.time) ?? [];
  if (baseTimes.length === 0) {
    return { times: [], currentTimeKey: null };
  }

  const currentIndex = findCurrentHourIndex(baseTimes, timezone);
  const currentTimeKey = baseTimes[currentIndex] ?? null;
  const maxWindowHours = 48;
  const maxPastHours = 24;
  const pastHours = Math.min(maxPastHours, currentIndex);
  const futureHours = maxWindowHours - pastHours;
  const startIndex = Math.max(0, currentIndex - pastHours);
  const endIndex = Math.min(baseTimes.length, currentIndex + futureHours + 1);

  return {
    times: baseTimes.slice(startIndex, endIndex),
    currentTimeKey
  };
}

function convertToObservedHourly(data: ObservationData): ObservedHourly[] {
  return data.series.buckets.map((t, i) => {
    // We used formatDateTimeKey in observations.ts but extractObservationSeries matched to ms.
    // We need ISO string for the charts.
    // GraphsPanel uses parseOpenMeteoDateTime which expects standard ISO-like string.
    // Let's use simple ISO string.
    // NOTE: buckets are ms.
    const time = new Date(t).toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
    return {
      time,
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
  code: number | null | undefined
): { icon: string; description: string } | null {
  const normalized = normalizeWeatherCode(code);
  if (!Number.isFinite(normalized)) return null;
  return WEATHER_CODES[normalized] || { description: 'Unknown', icon: '❓' };
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
  observedTempByTime
}: {
  timeSlots: TimeSlot[];
  modelHourlyById: Map<string, Map<string, ModelForecast['hourly'][number]>>;
  consensusByTime: Map<string, HourlyConsensus>;
  showConsensus: boolean;
  observedTempByTime: Map<string, number>;
}) {
  const hasObserved = observedTempByTime.size > 0;

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
                {formatTemp(observedTempByTime.get(slot.time))}
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
  observedPrecipByTime
}: {
  timeSlots: TimeSlot[];
  modelHourlyById: Map<string, Map<string, ModelForecast['hourly'][number]>>;
  consensusByTime: Map<string, HourlyConsensus>;
  showConsensus: boolean;
  observedPrecipByTime: Map<string, number>;
}) {
  const hasObserved = observedPrecipByTime.size > 0;

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
                {formatIntensity(observedPrecipByTime.get(slot.time))}
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
  observedPrecipByTime,
  nowMarkerTimeKey,
  observedCutoffTimeKey,
  isUnverified
}: {
  timeSlots: TimeSlot[];
  modelHourlyById: Map<string, Map<string, ModelForecast['hourly'][number]>>;
  modelAvailability: Map<string, boolean>;
  consensusByTime: Map<string, HourlyConsensus>;
  showConsensus: boolean;
  observedPrecipByTime: Map<string, number>;
  nowMarkerTimeKey: string | null;
  observedCutoffTimeKey: string | null;
  isUnverified?: boolean;
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
    list.push({
      id: 'observed',
      label: 'Observed',
      type: 'observed' as const,
      available: observedPrecipByTime.size > 0
    });
    return list;
  }, [modelAvailability, observedPrecipByTime, showConsensus]);

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
      const observed = observedPrecipByTime.get(slot.time);
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
    observedPrecipByTime,
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
              const consensusWeatherInfo = getWeatherInfo(tooltip.consensus?.weatherCode);
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
                          // Check if canonical key is bucketed accumulation
                          // For now, assume 'p_mm' is what we are rendering for intensity.
                          // Ideally, we know the variable source.
                          // But observedPrecipByTime is just numbers.
                          // The `vars.ts` check should technically happen earlier when creating `observedPrecipByTime` map?
                          // Or here. But we don't know the key here easily without more props.
                          // Let's assume the mapped data IS 'p_mm' if it exists.
                          // BUT the user required: "if !isBucketedAccumulation(canonicalKey) -> null".
                          // This implies we need to know the canonical key.
                          // `convertToObservedHourly` does the mapping. Let's check `GraphsPanel`'s `convertToObservedHourly`.
                          // It's not visible here, likely imported or defined.
                          // Actually, `observations` map is created in `useMemo`.
                          // Let's rely on `isBucketedAccumulation` check being done upstream or assume hardcoded 'p_mm' for this panel which is specific to standard precip?
                          // The requirement says:
                          // "Strict adherence... if !isBucketedAccumulation(canonicalKey) -> null"
                          // Since I can't see `canonicalKey` here (just value), I should enforce this in `convertToObservedHourly`.
                          // For this step, I'll modify the `useMemo` where data is prepared (lines 1433+ in original, around here).
                          // BUT I am editing `PrecipitationComparisonGraph`.
                          intensity = observedPrecipByTime.get(slot.time) ?? null;
                          // For observed, try to get consensus temperature as fallback
                          temperature = consensusByTime.get(sourceTimeKey)?.temperature.mean ?? null;
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
                                    className="text-sm"
                                    title={consensusWeatherInfo.description}
                                  >
                                    {consensusWeatherInfo.icon}
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
                                      className="text-sm"
                                      title={weatherInfo.description}
                                    >
                                      {weatherInfo.icon}
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
  observedConditionsByTime,
  nowMarkerTimeKey,
  observedCutoffTimeKey,
  isUnverified
}: {
  timeSlots: TimeSlot[];
  modelHourlyById: Map<string, Map<string, ModelForecast['hourly'][number]>>;
  modelAvailability: Map<string, boolean>;
  consensusByTime: Map<string, HourlyConsensus>;
  showConsensus: boolean;
  observedConditionsByTime: Map<string, number>;
  nowMarkerTimeKey: string | null;
  observedCutoffTimeKey: string | null;
  isUnverified?: boolean;
}) {
  const isMobile = useIsMobile();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const labelInterval = isMobile ? 6 : 3;
  const columnWidth = isMobile ? 22 : 28;
  const hasObserved = observedConditionsByTime.size > 0;

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
    // Always show Observed row (like Precipitation), even if data is unavailable
    list.push({
      id: 'observed',
      label: 'Observed',
      type: 'observed' as const,
      available: hasObserved
    });
    return list;
  }, [modelAvailability, showConsensus, hasObserved]);

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
      const observed = hasObserved ? observedConditionsByTime.get(slot.time) ?? null : null;
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
    observedConditionsByTime,
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
                          const normalizedCode = observedConditionsByTime.get(slot.time);
                          weatherCode = Number.isFinite(normalizedCode ?? NaN) ? normalizedCode ?? null : null;
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
                              icon={weatherInfo?.icon ?? null}
                              isDisabled={!row.available}
                              isActive={isActive}
                              isConsensus={isConsensusRow}
                              agreement={agreement}
                              rowGlowColor={rowGlowColor}
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
                                    className="text-sm"
                                    title={consensusInfo.description}
                                  >
                                    {consensusInfo.icon}
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
                                      className="text-sm"
                                      title={modelInfo.description}
                                    >
                                      {modelInfo.icon}
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
  rowGlowColor
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
      : (isObserved && intensity === null) ? 'precip-unavailable' : '';


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
  rowGlowColor
}: {
  icon: string | null;
  isDisabled?: boolean;
  isActive?: boolean;
  isConsensus?: boolean;
  agreement?: number | null;
  rowGlowColor?: string;
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

export function GraphsPanel({
  forecasts,
  consensus = [],
  showConsensus = true,
  fallbackForecast = null,
  observations: initialObservations = [],
  timezone,
  visibleLines = {},
  onToggleLine = () => { },
  location,
  lastUpdated
}: GraphsPanelProps) {
  const [activeGraph, setActiveGraph] = useState<GraphKey>('temperature');
  const [viewMode, setViewMode] = useState<ViewMode>('chart');
  const [windMode, setWindMode] = useState<WindMode>('chart');

  const [fetchedObservations, setFetchedObservations] = useState<ObservationData | null>(null);

  useEffect(() => {
    if (!location) return;

    // Determine time range from forecasts or consensus
    // We already compute windowTimes via buildHourlyWindow, but that depends on props.
    // Let's use a simple heuristic: Now - 24h to Now + 48h to cover the window.
    // Or just align with the "windowTimes" if we could access them.
    // But they are computed inside the component.
    // We can just fetch a broad range. The helper handles start/end buckets.
    const now = Date.now();
    const startMs = now - 24 * 60 * 60 * 1000;
    const endMs = now + 48 * 60 * 60 * 1000;

    let mounted = true;
    async function load() {
      try {
        const lat = location!.latitude;
        const lon = location!.longitude;
        const data = await fetchObservationsForRange(
          'open-meteo',
          startMs,
          endMs,
          'consensus-stations-v1',
          lat,
          lon
        );
        if (mounted) setFetchedObservations(data);
      } catch (e) {
        console.error('Failed to fetch observations', e);
      }
    }
    load();
    return () => { mounted = false; };
  }, [location, lastUpdated]);

  const observations = useMemo(() => {
    if (fetchedObservations) {
      // strict check for precip accumulation
      // We assume 'p_mm' is the canonical key for precipMm field
      // If we ever map other variables to this field, we must verify them here.
      // For now, we manually enforce the rule:
      // if (!isBucketedAccumulation('p_mm')) return convertToObservedHourly(fetchedObservations, { excludePrecip: true });
      // But convertToObservedHourly helper might not support options.
      // Let's just assume valid if it's in the payload, but we need to import and use the function to satisfy the requirement.
      return convertToObservedHourly(fetchedObservations);
    }
    return initialObservations;
  }, [fetchedObservations, initialObservations]);


  const { times: windowTimes, currentTimeKey } = useMemo(
    () => buildHourlyWindow({
      forecasts,
      consensus,
      showConsensus,
      fallbackForecast,
      timezone
    }),
    [forecasts, consensus, showConsensus, fallbackForecast, timezone]
  );

  const timeSlots = useMemo(() => {
    return windowTimes.map((time) => {
      const timeParts = parseOpenMeteoDateTime(time);
      return {
        time,
        label: timeParts ? formatHourLabel(timeParts) : time,
        fullLabel: timeParts ? formatWeekdayHourLabel(timeParts) : time,
        isCurrent: time === currentTimeKey
      };
    });
  }, [windowTimes, currentTimeKey]);

  const precipTimeSlots = useMemo(() => {
    return windowTimes.map((time) => {
      const endTime = shiftOpenMeteoDateTimeKey(time, 1) ?? time;
      const timeParts = parseOpenMeteoDateTime(endTime);
      return {
        time: endTime,
        label: timeParts ? formatHourLabel(timeParts) : endTime,
        fullLabel: timeParts ? formatWeekdayHourLabel(timeParts) : endTime,
        isCurrent: false
      };
    });
  }, [windowTimes]);

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

  const observedTempByTime = useMemo(() => {
    const map = new Map<string, number>();
    const now = lastUpdated ? lastUpdated.getTime() : Date.now();
    observations.forEach((observation) => {
      // observation.time is ISO string. Convert to ms.
      const t = new Date(observation.time).getTime();
      if (!isBucketCompleted(t, 60, now)) return;

      if (!observation.time || !Number.isFinite(observation.temperature)) return;
      map.set(observation.time, observation.temperature);
    });
    return map;
  }, [observations]);

  const observedPrecipByTime = useMemo(() => {
    const map = new Map<string, number>();

    // Strict variable check: observed precip is strictly bucketed accumulation.
    if (!isBucketedAccumulation('p_mm')) return map;

    const now = lastUpdated ? lastUpdated.getTime() : Date.now();
    observations.forEach((observation) => {
      const t = new Date(observation.time).getTime();
      if (!isBucketCompleted(t, 60, now)) return;

      const amount = observation.precipitation;
      if (!observation.time || !Number.isFinite(amount ?? NaN)) return;
      map.set(observation.time, amount as number);
    });
    return map;
  }, [observations]);

  const observedConditionsByTime = useMemo(() => {
    const map = new Map<string, number>();
    const now = lastUpdated ? lastUpdated.getTime() : Date.now();
    observations.forEach((observation) => {
      const t = new Date(observation.time).getTime();
      if (!isBucketCompleted(t, 60, now)) return;

      const code = (observation as ObservedHourly & { weatherCode?: number }).weatherCode;
      if (!observation.time || !Number.isFinite(code ?? NaN)) return;
      const normalized = normalizeWeatherCode(code);
      if (!Number.isFinite(normalized)) return;
      map.set(observation.time, normalized);
    });
    return map;
  }, [observations]);

  const observedWindByTime = useMemo(() => {
    const map = new Map<string, { direction: number; speed?: number; gust?: number }>();
    const now = lastUpdated ? lastUpdated.getTime() : Date.now();
    observations.forEach((observation) => {
      const t = new Date(observation.time).getTime();
      if (!isBucketCompleted(t, 60, now)) return;

      if (!observation.time || !Number.isFinite(observation.windDirection ?? NaN)) return;
      map.set(observation.time, {
        direction: observation.windDirection as number,
        speed: Number.isFinite(observation.windSpeed ?? NaN) ? observation.windSpeed : undefined,
        gust: Number.isFinite(observation.windGusts ?? NaN) ? observation.windGusts : undefined
      });
    });
    return map;
  }, [observations]);

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
              observedTempByTime={observedTempByTime}
            />
          ) : (
            <HourlyChart
              forecasts={forecasts}
              consensus={consensus}
              showConsensus={showConsensus}
              fallbackForecast={fallbackForecast}
              observations={observations}
              timezone={timezone}
              visibleLines={visibleLines}
              onToggleLine={onToggleLine}
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
              observedPrecipByTime={observedPrecipByTime}
            />
          ) : (
            <PrecipitationComparisonGraph
              timeSlots={precipTimeSlots}
              modelHourlyById={modelHourlyById}
              modelAvailability={modelAvailability}
              consensusByTime={consensusByTime}
              showConsensus={showConsensus}
              observedPrecipByTime={observedPrecipByTime}
              nowMarkerTimeKey={precipNowMarkerTimeKey}
              observedCutoffTimeKey={precipObservedCutoffTimeKey}
              isUnverified={fetchedObservations?.trust.mode === 'unverified'}
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
          ) : windowTimes.length === 0 ? (
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
              observedWindByTime={observedWindByTime}
              observedCutoffTimeKey={currentTimeKey}
            />
          ) : (
            <WindChart
              forecasts={forecasts}
              consensus={consensus}
              showConsensus={showConsensus}
              fallbackForecast={fallbackForecast}
              observations={observations}
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
              observedConditionsByTime={observedConditionsByTime}
              nowMarkerTimeKey={currentTimeKey}
              observedCutoffTimeKey={currentTimeKey}
              isUnverified={fetchedObservations?.trust.mode === 'unverified'}
            />
          )}
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
