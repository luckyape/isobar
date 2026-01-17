/**
 * WindChart Component - Arctic Data Observatory
 * Shows hourly wind speed and gust comparison across models with consensus band.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useMemo } from 'react';
import {
  Area,
  Brush,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import type { ModelForecast, ObservedHourly } from '@/lib/weatherApi';
import type { HourlyConsensus } from '@/lib/consensus';
import { WEATHER_MODELS } from '@/lib/weatherApi';
import {
  findCurrentHourIndex,
  formatHourLabel,
  formatWeekdayHourLabel,
  parseOpenMeteoDateTime
} from '@/lib/timeUtils';
import {
  ComparisonTooltipCard,
  ComparisonTooltipRow,
  ComparisonTooltipSection
} from '@/components/ComparisonTooltip';
import { useIsMobile } from '@/hooks/useMediaQuery';

interface WindChartProps {
  forecasts: ModelForecast[];
  consensus?: HourlyConsensus[];
  showConsensus?: boolean;
  fallbackForecast?: ModelForecast | null;
  observations?: ObservedHourly[];
  timezone?: string;
  visibleLines?: Record<string, boolean>;
  onToggleLine?: (lineName: string) => void;
}

export function WindChart({
  forecasts,
  consensus = [],
  showConsensus = true,
  fallbackForecast = null,
  observations = [],
  timezone,
  visibleLines = {},
  onToggleLine = () => { }
}: WindChartProps) {
  const hasConsensus = showConsensus && consensus.length > 0;
  const isMobile = useIsMobile();
  const observedColor = 'oklch(0.85 0.12 60)';
  const observationByTime = useMemo(() => {
    if (!observations.length) return new Map<string, { speed?: number; gust?: number }>();
    const map = new Map<string, { speed?: number; gust?: number }>();
    observations.forEach((observation) => {
      if (!observation.time) return;
      const speed = Number.isFinite(observation.windSpeed ?? NaN) ? observation.windSpeed : undefined;
      const gust = Number.isFinite(observation.windGusts ?? NaN) ? observation.windGusts : undefined;
      if (!Number.isFinite(speed ?? NaN) && !Number.isFinite(gust ?? NaN)) return;
      map.set(observation.time, { speed, gust });
    });
    return map;
  }, [observations]);
  const hasObservations = observationByTime.size > 0;
  const chartMargin = useMemo(
    () => ({
      top: 10,
      right: 10,
      left: isMobile ? 0 : -10,
      bottom: 0
    }),
    [isMobile]
  );
  const yAxisWidth = isMobile ? 44 : 56;

  const windSpeedById = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    forecasts.forEach((forecast) => {
      if (forecast.error) return;
      const speeds = new Map<string, number>();
      forecast.hourly.forEach((hour) => {
        if (Number.isFinite(hour.windSpeed)) {
          speeds.set(hour.time, hour.windSpeed);
        }
      });
      map.set(forecast.model.id, speeds);
    });
    return map;
  }, [forecasts]);

  const windGustById = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    forecasts.forEach((forecast) => {
      if (forecast.error) return;
      const gusts = new Map<string, number>();
      forecast.hourly.forEach((hour) => {
        if (Number.isFinite(hour.windGusts)) {
          gusts.set(hour.time, hour.windGusts);
        }
      });
      map.set(forecast.model.id, gusts);
    });
    return map;
  }, [forecasts]);

  const consensusByTime = useMemo(() => {
    if (!hasConsensus) return new Map<string, HourlyConsensus>();
    return new Map(consensus.map((hour) => [hour.time, hour]));
  }, [consensus, hasConsensus]);

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

      const observation = observationByTime.get(time);
      if (observation && (!currentTimeKey || time <= currentTimeKey)) {
        if (Number.isFinite(observation.speed ?? NaN)) {
          dataPoint.observed = observation.speed;
        }
        if (Number.isFinite(observation.gust ?? NaN)) {
          dataPoint.observedGust = observation.gust;
        }
      }

      if (hasConsensus) {
        const consensusPoint = consensusByTime.get(time);
        if (consensusPoint) {
          dataPoint.consensusMean = consensusPoint.windSpeed.mean;
          dataPoint.consensusMin = consensusPoint.windSpeed.min;
          dataPoint.consensusMax = consensusPoint.windSpeed.max;
          dataPoint.agreement = consensusPoint.windSpeed.agreement;
        }
      }

      forecasts.forEach((forecast) => {
        if (forecast.error) return;
        const speeds = windSpeedById.get(forecast.model.id);
        const gusts = windGustById.get(forecast.model.id);
        const speedValue = speeds?.get(time);
        const gustValue = gusts?.get(time);
        if (speedValue !== undefined) {
          dataPoint[forecast.model.id] = speedValue;
        }
        if (gustValue !== undefined) {
          dataPoint[`${forecast.model.id}__gust`] = gustValue;
        }
        if (Number.isFinite(speedValue ?? NaN) && Number.isFinite(gustValue ?? NaN)) {
          dataPoint[`${forecast.model.id}__range`] = [
            Math.min(speedValue as number, gustValue as number),
            Math.max(speedValue as number, gustValue as number)
          ];
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
    consensusByTime,
    windSpeedById,
    windGustById,
    observationByTime,
    timezone
  ]);

  const chartData = chartWindow.chartData;
  const currentTimeKey = chartWindow.currentTimeKey;
  const showWindFill = visibleLines['Wind Fill'] ?? true;
  const labelByTime = useMemo(() => {
    const map = new Map<string, string>();
    chartData.forEach((point: any) => {
      if (typeof point?.time === 'string' && typeof point?.label === 'string') {
        map.set(point.time, point.label);
      }
    });
    return map;
  }, [chartData]);

  const formatWind = (value?: number) => {
    if (!Number.isFinite(value ?? NaN)) return '--';
    return `${Math.round(value as number)} km/h`;
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;
    const data = payload[0]?.payload;
    if (!data) return null;
    const hasConsensusData = data.consensusMean !== undefined;
    const observedSpeed = data.observed;
    const observedGust = data.observedGust;
    const hasObserved = Number.isFinite(observedSpeed ?? NaN);

    return (
      <ComparisonTooltipCard title={data.fullLabel}>
        {hasConsensusData && (
          <ComparisonTooltipSection>
            <ComparisonTooltipRow
              label="Consensus"
              value={formatWind(data.consensusMean)}
            />
            <ComparisonTooltipRow
              label="Range"
              value={`${formatWind(data.consensusMin)} - ${formatWind(data.consensusMax)}`}
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
              value={`${formatWind(observedSpeed)}${Number.isFinite(observedGust ?? NaN) ? ` / ${formatWind(observedGust)} gust` : ''}`}
              icon={
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: observedColor }}
                />
              }
            />
          </ComparisonTooltipSection>
        )}
        <ComparisonTooltipSection divider={hasConsensusData || hasObserved}>
          {WEATHER_MODELS.map((model) => {
            const sustained = data[model.id];
            const gust = data[`${model.id}__gust`];
            if (sustained === undefined && gust === undefined) return null;

            let sustainedText = Number.isFinite(sustained ?? NaN) ? formatWind(sustained) : null;
            if (sustainedText && hasObserved && Number.isFinite(data.observed)) {
              const delta = (sustained as number) - (data.observed as number);
              if (Number.isFinite(delta)) {
                const sign = delta > 0 ? '+' : '';
                const color = delta > 0 ? 'text-red-400' : delta < 0 ? 'text-blue-400' : 'text-gray-400';
                const deltaStr = `(${sign}${Math.round(delta)})`;
                sustainedText = <span className="flex items-center gap-1">{formatWind(sustained)} <span className={`text-[10px] ${color}`}>{deltaStr}</span></span> as any;
              }
            }

            const gustText = Number.isFinite(gust ?? NaN) ? `${formatWind(gust)} gust` : null;

            // Composition is tricky if sustainedText is a Component.
            // If sustainedText became a component, we can't just concat strings.
            // Let's keep structure clean.
            const valueContent = (
              <div className="flex items-center justify-end gap-2">
                {sustainedText || '--'}
                {gustText && <span className="opacity-70 text-[10px]">{gustText}</span>}
              </div>
            );

            return (
              <ComparisonTooltipRow
                key={model.id}
                label={`${model.name}:`}
                value={valueContent}
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

  if (chartData.length === 0) {
    return null;
  }

  return (
    <div className="readable-text">
      <div className="flex flex-wrap items-center justify-end gap-4 text-xs text-foreground/70 mb-2">
        <div className="flex items-center gap-2">
          <span className="inline-block w-6 h-0.5 rounded bg-foreground/70" />
          <span>Sustained</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-6 h-0.5 border-b border-dashed border-foreground/70" />
          <span>Gusts</span>
        </div>
      </div>

      <div className="h-56 sm:h-72 lg:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={chartMargin}
          >
            <defs>
              <linearGradient id="windBand" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="oklch(0.75 0.15 195)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="oklch(0.75 0.15 195)" stopOpacity={0.04} />
              </linearGradient>
              {WEATHER_MODELS.map((model) => (
                <linearGradient
                  key={`windRange-${model.id}`}
                  id={`windRange-${model.id}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={model.color} stopOpacity={0.3} />
                  <stop offset="65%" stopColor={model.color} stopOpacity={0.12} />
                  <stop offset="100%" stopColor={model.color} stopOpacity={0.03} />
                </linearGradient>
              ))}
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
              tickFormatter={(value) => `${value} km/h`}
              width={yAxisWidth}
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
                <Area
                  type="monotone"
                  dataKey="consensusMax"
                  stroke="none"
                  fill="url(#windBand)"
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

            {WEATHER_MODELS.map((model) => {
              if (!visibleLines[model.name]) return null;
              return showWindFill
                ? [
                  <Area
                    key={`${model.id}-range`}
                    type="monotone"
                    dataKey={`${model.id}__range`}
                    stroke="none"
                    fill={`url(#windRange-${model.id})`}
                    fillOpacity={1}
                  />,
                  <Line
                    key={`${model.id}-sustained`}
                    type="monotone"
                    dataKey={model.id}
                    stroke={model.color}
                    strokeWidth={2}
                    dot={false}
                    strokeOpacity={0.75}
                  />,
                  <Line
                    key={`${model.id}-gust`}
                    type="monotone"
                    dataKey={`${model.id}__gust`}
                    stroke={model.color}
                    strokeWidth={1.5}
                    dot={false}
                    strokeDasharray="4 4"
                    strokeOpacity={0.5}
                  />
                ]
                : [
                  <Line
                    key={`${model.id}-sustained`}
                    type="monotone"
                    dataKey={model.id}
                    stroke={model.color}
                    strokeWidth={2}
                    dot={false}
                    strokeOpacity={0.75}
                  />,
                  <Line
                    key={`${model.id}-gust`}
                    type="monotone"
                    dataKey={`${model.id}__gust`}
                    stroke={model.color}
                    strokeWidth={1.5}
                    dot={false}
                    strokeDasharray="4 4"
                    strokeOpacity={0.5}
                  />
                ];
            })}

            {hasObservations && visibleLines['Observed'] && (
              <>
                <Line
                  type="monotone"
                  dataKey="observed"
                  stroke={observedColor}
                  strokeWidth={2}
                  dot={false}
                  strokeOpacity={0.85}
                />
                <Line
                  type="monotone"
                  dataKey="observedGust"
                  stroke={observedColor}
                  strokeWidth={1.5}
                  dot={false}
                  strokeDasharray="4 4"
                  strokeOpacity={0.6}
                />
              </>
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
