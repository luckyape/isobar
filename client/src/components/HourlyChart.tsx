/**
 * HourlyChart Component - Arctic Data Observatory
 * Shows hourly temperature comparison across models with consensus band
 */

import { useMemo } from 'react';
import {
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Area,
  ComposedChart,
  Brush,
  ReferenceLine
} from 'recharts';
import type { ModelForecast, ObservedHourly } from '@/lib/weatherApi';
import type { HourlyConsensus } from '@/lib/consensus';
import { WEATHER_MODELS } from '@/lib/weatherApi';
import {
  ComparisonTooltipCard,
  ComparisonTooltipRow,
  ComparisonTooltipSection
} from '@/components/ComparisonTooltip';
import {
  findCurrentHourIndex,
  formatHourLabel,
  formatWeekdayHourLabel,
  parseOpenMeteoDateTime
} from '@/lib/timeUtils';
import { useIsMobile } from '@/hooks/useMobile';

interface HourlyChartProps {
  forecasts: ModelForecast[];
  consensus?: HourlyConsensus[];
  showConsensus?: boolean;
  fallbackForecast?: ModelForecast | null;
  observations?: ObservedHourly[];
  timezone?: string;
  visibleLines?: Record<string, boolean>;
  onToggleLine?: (lineName: string) => void;
}

export function HourlyChart({
  forecasts,
  consensus = [],
  showConsensus = true,
  fallbackForecast = null,
  observations = [],
  timezone,
  visibleLines = {},
  onToggleLine = () => {}
}: HourlyChartProps) {
  const hasConsensus = showConsensus && consensus.length > 0;
  const isMobile = useIsMobile();
  const observedColor = 'oklch(0.85 0.12 60)';
  const observationByTime = useMemo(() => {
    if (!observations.length) return new Map<string, number>();
    const map = new Map<string, number>();
    observations.forEach((observation) => {
      if (!observation.time || !Number.isFinite(observation.temperature)) return;
      map.set(observation.time, observation.temperature);
    });
    return map;
  }, [observations]);
  const hasObservations = observationByTime.size > 0;
  const consensusByTime = useMemo(() => {
    if (!hasConsensus) return new Map<string, HourlyConsensus>();
    return new Map(consensus.map((hour) => [hour.time, hour]));
  }, [consensus, hasConsensus]);
  const modelTemperatureById = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    forecasts.forEach((forecast) => {
      if (forecast.error) return;
      const temps = new Map<string, number>();
      forecast.hourly.forEach((hour) => {
        if (Number.isFinite(hour.temperature)) {
          temps.set(hour.time, hour.temperature);
        }
      });
      map.set(forecast.model.id, temps);
    });
    return map;
  }, [forecasts]);

  // Prepare chart data - 48-hour window around the current hour
  const chartWindow = useMemo(() => {
    const baseForecast = fallbackForecast || forecasts.find(forecast => !forecast.error && forecast.hourly.length > 0);
    const baseTimes = hasConsensus
      ? consensus.map((hour) => hour.time)
      : baseForecast?.hourly.map((hour) => hour.time) ?? [];
    if (baseTimes.length === 0) return { chartData: [], currentTimeKey: null as string | null };

    const currentIndex = findCurrentHourIndex(baseTimes, timezone);
    const currentTimeKey = baseTimes[currentIndex] ?? null;
    const maxWindowHours = 48;
    const maxPastHours = 24;
    const pastHours = Math.min(maxPastHours, currentIndex);
    const futureHours = maxWindowHours - pastHours;
    const startIndex = Math.max(0, currentIndex - pastHours);
    const endIndex = Math.min(baseTimes.length, currentIndex + futureHours + 1);
    const windowTimes = baseTimes.slice(startIndex, endIndex);
    if (windowTimes.length === 0) return { chartData: [], currentTimeKey };

    const windowStart = windowTimes[0];
    const windowEnd = windowTimes[windowTimes.length - 1];
    const observedTimes = Array.from(observationByTime.keys()).filter(
      (time) =>
        time >= windowStart &&
        time <= windowEnd &&
        (!currentTimeKey || time <= currentTimeKey)
    );
    const times = Array.from(new Set([...windowTimes, ...observedTimes])).sort();

    const chartData = times.map((time) => {
      const timeParts = parseOpenMeteoDateTime(time);
      const dataPoint: Record<string, any> = {
        time,
        label: timeParts ? formatHourLabel(timeParts) : time,
        fullLabel: timeParts ? formatWeekdayHourLabel(timeParts) : time
      };
      const observedTemp = observationByTime.get(time);
      if (observedTemp !== undefined && (!currentTimeKey || time <= currentTimeKey)) {
        dataPoint.observed = observedTemp;
      }

      if (hasConsensus) {
        const consensusPoint = consensusByTime.get(time);
        if (consensusPoint) {
          dataPoint.consensusMean = consensusPoint.temperature.mean;
          dataPoint.consensusMin = consensusPoint.temperature.min;
          dataPoint.consensusMax = consensusPoint.temperature.max;
          dataPoint.agreement = consensusPoint.overallAgreement;
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
    return { chartData, currentTimeKey };
  }, [
    forecasts,
    consensus,
    fallbackForecast,
    hasConsensus,
    observationByTime,
    consensusByTime,
    modelTemperatureById,
    timezone
  ]);

  const chartData = chartWindow.chartData;
  const currentTimeKey = chartWindow.currentTimeKey;
  const labelByTime = useMemo(() => {
    const map = new Map<string, string>();
    chartData.forEach((point: any) => {
      if (typeof point?.time === 'string' && typeof point?.label === 'string') {
        map.set(point.time, point.label);
      }
    });
    return map;
  }, [chartData]);

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;
    
    const data = payload[0]?.payload;
    if (!data) return null;
    const hasConsensusData = data.consensusMean !== undefined;
    const hasObserved = Number.isFinite(data.observed ?? NaN);
    const formatTemperature = (value?: number) => {
      if (!Number.isFinite(value ?? NaN)) return '--';
      return `${Math.round((value as number) * 10) / 10}°`;
    };
    
    return (
      <ComparisonTooltipCard title={data.fullLabel}>
        {hasConsensusData && (
          <ComparisonTooltipSection>
            <ComparisonTooltipRow
              label="Consensus"
              value={formatTemperature(data.consensusMean)}
            />
            <ComparisonTooltipRow
              label="Range"
              value={`${formatTemperature(data.consensusMin)} - ${formatTemperature(data.consensusMax)}`}
            />
            <ComparisonTooltipRow
              label="Agreement"
              value={`${data.agreement}%`}
            />
          </ComparisonTooltipSection>
        )}
        {hasObserved && (
          <ComparisonTooltipSection divider={hasConsensusData}>
            <ComparisonTooltipRow
              label="Observed"
              value={formatTemperature(data.observed)}
              icon={
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: observedColor }}
                />
              }
            />
          </ComparisonTooltipSection>
        )}
        <ComparisonTooltipSection divider={hasConsensusData || hasObserved}>
          {WEATHER_MODELS.map(model => {
            const value = data[model.id];
            if (value === undefined) return null;
            return (
              <ComparisonTooltipRow
                key={model.id}
                label={`${model.name}:`}
                value={formatTemperature(value)}
                icon={
                  <span
                    className="w-2 h-2 triangle-icon"
                    style={{ backgroundColor: model.color }}
                  />
                }
              />
            );
          })}
        </ComparisonTooltipSection>
      </ComparisonTooltipCard>
    );
  };

  return (
    <div className="readable-text">
      <div className="h-56 sm:h-72 lg:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 10, right: 10, left: isMobile ? 0 : -10, bottom: 0 }}
          >
            {/* Consensus range band */}
            <defs>
              <linearGradient id="consensusBand" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="oklch(0.75 0.15 195)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="oklch(0.75 0.15 195)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            
            <XAxis 
              dataKey="time"
              stroke="oklch(0.95 0.01 240 / 0.7)"
              fontSize={isMobile ? 10 : 12}
              tickLine={false}
              interval={isMobile ? 12 : 5}
              tickMargin={isMobile ? 6 : 10}
              tickFormatter={(time) => labelByTime.get(time as string) ?? ''}
            />
            <YAxis 
              stroke="oklch(0.95 0.01 240 / 0.7)"
              fontSize={isMobile ? 10 : 12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `${value}°`}
              width={isMobile ? 32 : 40}
            />
            <Tooltip content={<CustomTooltip />} />

            {currentTimeKey && (
              <ReferenceLine
                x={currentTimeKey}
                stroke="oklch(0.75 0.15 195 / 0.55)"
                strokeWidth={1}
              />
            )}
            
            {hasConsensus && (
              <>
                {/* Consensus range area */}
                <Area
                  type="monotone"
                  dataKey="consensusMax"
                  stroke="none"
                  fill="url(#consensusBand)"
                  fillOpacity={1}
                />
                <Area
                  type="monotone"
                  dataKey="consensusMin"
                  stroke="none"
                  fill="oklch(0.12 0.02 240)"
                  fillOpacity={1}
                />
              </>
            )}
            
            {/* Individual model lines */}
            {WEATHER_MODELS.map(
              (model) =>
                visibleLines[model.name] && (
                  <Line
                    key={model.id}
                    type="monotone"
                    dataKey={model.id}
                    stroke={model.color}
                    strokeWidth={2}
                    dot={false}
                    strokeOpacity={0.7}
                  />
                )
            )}

            {hasObservations && visibleLines['Observed'] && (
              <Line
                type="monotone"
                dataKey="observed"
                stroke={observedColor}
                strokeWidth={2}
                dot={false}
                strokeOpacity={0.9}
              />
            )}
            
            {hasConsensus && visibleLines['Consensus Mean'] && (
              <Line
                type="monotone"
                dataKey="consensusMean"
                stroke="oklch(0.95 0.01 240)"
                strokeWidth={3}
                dot={false}
                strokeDasharray="5 5"
              />
            )}
            <Brush
              dataKey="time"
              height={30}
              stroke="oklch(0.75 0.15 195)"
              fill="oklch(0.12 0.02 240 / 0.5)"
              tickFormatter={(time) => labelByTime.get(time as string) ?? ''}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      
      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-4 mt-4 pt-4 border-t border-white/10">
        {hasConsensus && (
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => onToggleLine('Consensus Mean')}
            style={{
              opacity: visibleLines['Consensus Mean'] ? 1 : 0.5,
              textShadow: visibleLines['Consensus Mean']
                ? '0 0 8px oklch(0.95 0.01 240 / 0.8)'
                : 'none'
            }}
          >
            <div
              className="w-6 h-0.5 bg-white border-dashed border-white"
              style={{ borderStyle: 'dashed' }}
            />
            <span className="text-xs text-foreground/80">Consensus Mean</span>
          </div>
        )}
        {hasObservations && (
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => onToggleLine('Observed')}
            style={{
              opacity: visibleLines['Observed'] ? 1 : 0.5,
              textShadow: visibleLines['Observed']
                ? `0 0 8px ${observedColor}`
                : 'none'
            }}
          >
            <div
              className="w-6 h-0.5 rounded"
              style={{ backgroundColor: observedColor }}
            />
            <span className="text-xs text-foreground/80">Observed</span>
          </div>
        )}
        {WEATHER_MODELS.map((model) => (
          <div
            key={model.id}
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => onToggleLine(model.name)}
            style={{
              opacity: visibleLines[model.name] ? 1 : 0.5,
              textShadow: visibleLines[model.name]
                ? `0 0 8px ${model.color}`
                : 'none'
            }}
          >
            <div
              className="w-6 h-0.5 rounded"
              style={{ backgroundColor: model.color }}
            />
            <span className="text-xs text-foreground/80">{model.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
