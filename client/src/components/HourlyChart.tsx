/**
 * HourlyChart Component - Arctic Data Observatory
 * Shows hourly temperature comparison across models with consensus band
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

import React, { useMemo } from 'react';
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
import { buildHourlyTemperatureSeries } from '@/lib/graphUtils';
import {
  ComparisonTooltipCard,
  ComparisonTooltipRow,
  ComparisonTooltipSection
} from '@/components/ComparisonTooltip';
import { useIsMobile } from '@/hooks/useMediaQuery';

interface HourlyChartProps {
  forecasts: ModelForecast[];
  consensus?: HourlyConsensus[];
  showConsensus?: boolean;
  fallbackForecast?: ModelForecast | null;
  /** @deprecated use observedTempByEpoch */
  observations?: ObservedHourly[];
  timezone?: string;
  visibleLines?: Record<string, boolean>;
  onToggleLine?: (lineName: string) => void;
  observedAvailability?: { available: boolean; reason: string | null; detail: string | null };
  // New strict props
  observedTempByEpoch?: Map<number, number>;
  observationsStatus?: 'loading' | 'none' | 'vault' | 'error';
  nowMs?: number;
}

function formatTemp(value?: number | null): string {
  if (!Number.isFinite(value ?? NaN)) return '--';
  return `${Math.round((value as number) * 10) / 10}°`;
}

function formatAgreement(value?: number | null): string {
  if (!Number.isFinite(value ?? NaN)) return '--';
  return `${Math.round(value as number)}%`;
}

export function HourlyChartTooltip({
  active,
  payload,
  observedVisible = false,
  observedColor = 'var(--color-observed)'
}: {
  active?: boolean;
  payload?: any[];
  observedVisible?: boolean;
  observedColor?: string;
}) {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0]?.payload;
  if (!data) return null;

  const hasConsensusData = Number.isFinite(data.consensusMean ?? NaN);
  const observedValue = data.observed;
  const hasObserved = observedVisible && Number.isFinite(observedValue ?? NaN);
  const agreement = Number.isFinite(data.temperatureAgreement ?? NaN)
    ? data.temperatureAgreement
    : data.overallAgreement;

  return (
    <ComparisonTooltipCard title={data.fullLabel}>
      {hasConsensusData && (
        <ComparisonTooltipSection>
          <ComparisonTooltipRow
            label="Consensus"
            value={formatTemp(data.consensusMean)}
          />
          <ComparisonTooltipRow
            label="Range"
            value={`${formatTemp(data.consensusMin)} - ${formatTemp(data.consensusMax)}`}
          />
          <ComparisonTooltipRow
            label="Agreement"
            value={formatAgreement(agreement)}
          />
        </ComparisonTooltipSection>
      )}
      {hasObserved && (
        <ComparisonTooltipSection divider={hasConsensusData}>
          <ComparisonTooltipRow
            label="Observed"
            value={formatTemp(observedValue)}
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
        {WEATHER_MODELS.map((model) => {
          const value = data[model.id];
          if (!Number.isFinite(value ?? NaN)) return null;

          let valueContent: React.ReactNode = formatTemp(value);
          if (hasObserved && Number.isFinite(observedValue ?? NaN)) {
            const delta = (value as number) - (observedValue as number);
            if (Number.isFinite(delta)) {
              const sign = delta > 0 ? '+' : '';
              const color = delta > 0 ? 'text-red-400' : delta < 0 ? 'text-blue-400' : 'text-gray-400';
              const roundedDelta = Math.round(delta * 10) / 10;
              const deltaStr = `(${sign}${roundedDelta})`;
              valueContent = (
                <span className="flex items-center gap-1">
                  {formatTemp(value)}
                  <span className={`text-[10px] ${color}`}>{deltaStr}</span>
                </span>
              );
            }
          }

          return (
            <ComparisonTooltipRow
              key={model.id}
              label={`${model.name}:`}
              value={valueContent}
              icon={
                <span
                  className="h-2 w-2 triangle-icon"
                  style={{ backgroundColor: model.color }}
                />
              }
            />
          );
        })}
      </ComparisonTooltipSection>
    </ComparisonTooltipCard>
  );
}

export function HourlyChart({
  forecasts,
  consensus = [],
  showConsensus = true,
  fallbackForecast = null,
  observations = [],
  timezone,
  visibleLines = {},
  onToggleLine = () => { },
  observedAvailability,
  observedTempByEpoch,
  observationsStatus,
  nowMs
}: HourlyChartProps) {
  const hasConsensus = showConsensus && consensus.length > 0;
  const isMobile = useIsMobile();
  const observedColor = 'var(--color-observed)';

  // Prepare chart data - 48-hour window around the current hour
  const chartWindow = useMemo(() => {
    return buildHourlyTemperatureSeries({
      forecasts,
      consensus,
      showConsensus,
      fallbackForecast,
      timezone,
      observedTempByEpoch,
      nowMs
    });
  }, [
    forecasts,
    consensus,
    showConsensus,
    fallbackForecast,
    timezone,
    observedTempByEpoch,
    nowMs
  ]);

  const chartData = chartWindow.points;
  const currentTimeKey = chartWindow.currentTimeKey;
  const hasObservations = (observedTempByEpoch?.size ?? 0) > 0;
  const observedEnabled = visibleLines['Observed'] !== false;
  const observedVisible = hasObservations && observedEnabled;
  const labelByTime = useMemo(() => {
    const map = new Map<string, string>();
    chartData.forEach((point: any) => {
      if (typeof point?.time === 'string' && typeof point?.label === 'string') {
        map.set(point.time, point.label);
      }
    });
    return map;
  }, [chartData]);

  const tooltipContent = useMemo(
    () => (
      <HourlyChartTooltip
        observedVisible={observedVisible}
        observedColor={observedColor}
      />
    ),
    [observedVisible, observedColor]
  );

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
            <Tooltip content={tooltipContent} />

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

            {observedVisible && (
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
        <div
          className={`flex items-center gap-2 ${hasObservations ? 'cursor-pointer' : ''}`}
          onClick={() => hasObservations && onToggleLine('Observed')}
          style={{
            opacity: !hasObservations ? 0.4 : observedEnabled ? 1 : 0.5,
            textShadow: hasObservations && observedEnabled
              ? `0 0 8px ${observedColor}`
              : 'none'
          }}
        >
          <div
            className="w-6 h-0.5 rounded"
            style={{ backgroundColor: observedColor }}
          />
          <span
            className="text-xs text-foreground/80"
            title={!hasObservations && observedAvailability?.detail ? observedAvailability.detail : undefined}
          >
            Observed{!hasObservations && observedAvailability?.reason ? ` – ${observedAvailability.reason}` : !hasObservations ? ' – Unavailable' : ''}
          </span>
        </div>
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
