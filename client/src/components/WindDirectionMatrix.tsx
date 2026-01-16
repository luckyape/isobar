import { useMemo, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';
import { WEATHER_MODELS, type ModelForecast } from '@/lib/weatherApi';
import type { HourlyConsensus } from '@/lib/consensus';
import { AGREEMENT_LEVEL_THRESHOLDS } from '@/lib/consensusConfig';
import { MatrixRowLabel } from '@/components/MatrixRowLabel';
import {
  ComparisonTooltipCard,
  ComparisonTooltipRow,
  ComparisonTooltipSection
} from '@/components/ComparisonTooltip';
import {
  binSustainedSpeed,
  flowToDegrees,
  resultantLengthR,
  type WindSizeBin
} from '@/lib/windDirection';

type TimeSlot = {
  time: string;
  epoch: number;
  label: string;
  fullLabel: string;
  isCurrent: boolean;
};

type ObservedWindSample = {
  direction: number;
  speed?: number;
  gust?: number;
};

type DirectionRow = {
  id: string;
  label: string;
  type: 'model' | 'consensus' | 'observed';
  available: boolean;
  color?: string;
};

type TooltipRow = {
  id: string;
  name: string;
  type: 'model' | 'consensus' | 'observed';
  color?: string;
  windFrom: number | null;
  sustained: number | null;
  gust: number | null;
  directionAgreement: number | null;
  clusteringR: number | null;
  available: boolean;
};

type TooltipColumn = {
  slot: TimeSlot;
  rows: TooltipRow[];
};

const BASE_CELL_BG = 'oklch(0.12 0.02 240)';
const CONSENSUS_COLOR = 'oklch(0.95 0.01 240)';
const OBSERVED_COLOR = 'oklch(0.82 0.02 240)';
const DIRECTION_CLUSTERING_THRESHOLD_R = 0.6;
const DIRECTION_AGREEMENT_RING_THRESHOLD = AGREEMENT_LEVEL_THRESHOLDS.moderate;
const CELL_SIZE = 28;
const CELL_CENTER = CELL_SIZE / 2;
const POINTER_SIZES: Record<Exclude<WindSizeBin, 'calm'>, number> = {
  small: 6,
  medium: 9,
  large: 12
};

function withAlpha(color: string, alpha: number): string {
  if (!color) return color;
  if (color.includes('/')) return color;
  const idx = color.lastIndexOf(')');
  if (idx === -1) return color;
  return `${color.slice(0, idx)} / ${alpha})`;
}

function formatDegrees(value: number | null): string {
  if (!Number.isFinite(value ?? NaN)) return '--';
  return `${Math.round(value as number)}°`;
}

function formatSpeed(value: number | null): string {
  if (!Number.isFinite(value ?? NaN)) return '--';
  return `${Math.round(value as number)} km/h`;
}

function formatClusteringR(value: number | null): string {
  if (!Number.isFinite(value ?? NaN)) return '--';
  return `${Math.round((value as number) * 100)}%`;
}

function formatAgreementPercent(value: number | null): string {
  if (!Number.isFinite(value ?? NaN)) return '--';
  return `${Math.round(value as number)}%`;
}

function getFlowToText(windFrom: number | null): string {
  if (!Number.isFinite(windFrom ?? NaN)) return '--';
  return `${Math.round(flowToDegrees(windFrom as number))}°`;
}

function WindDirectionCell({
  windFrom,
  sustained,
  color,
  isConsensus,
  directionAgreement,
  clusteringR,
  isDisabled,
  rowGlowColor
}: {
  windFrom: number | null;
  sustained: number | null;
  color: string;
  isConsensus: boolean;
  directionAgreement: number | null;
  clusteringR: number | null;
  isDisabled: boolean;
  rowGlowColor?: string;
}) {
  const sizeBin = binSustainedSpeed(sustained ?? NaN);
  const isCalm = sizeBin === 'calm';
  const hasDirection = Number.isFinite(windFrom ?? NaN);
  const showPointer = Boolean(sizeBin && sizeBin !== 'calm' && hasDirection);
  const pointerSize = sizeBin && sizeBin !== 'calm' ? POINTER_SIZES[sizeBin] : 0;
  const pointerHeight = pointerSize * 1.2;
  const pointerHalfBase = pointerSize / 2;
  const pointerHalfHeight = pointerHeight / 2;
  const rotation = hasDirection ? flowToDegrees(windFrom as number) : 0;
  const showAgreementRing = Boolean(
    isConsensus
    && !isCalm
    && (
      (Number.isFinite(directionAgreement ?? NaN)
        && (directionAgreement as number) < DIRECTION_AGREEMENT_RING_THRESHOLD)
      || (
        !Number.isFinite(directionAgreement ?? NaN)
        && Number.isFinite(clusteringR ?? NaN)
        && (clusteringR as number) < DIRECTION_CLUSTERING_THRESHOLD_R
      )
    )
  );
  const overlayTint = rowGlowColor ? withAlpha(rowGlowColor, 0.07) : undefined;

  return (
    <svg
      className="h-full w-full rounded-sm"
      viewBox={`0 0 ${CELL_SIZE} ${CELL_SIZE}`}
      style={isDisabled ? { opacity: 0.4 } : undefined}
    >
      <rect width={CELL_SIZE} height={CELL_SIZE} fill={BASE_CELL_BG} />
      {overlayTint && <rect width={CELL_SIZE} height={CELL_SIZE} fill={overlayTint} />}
      {showAgreementRing && (
        <circle
          cx={CELL_CENTER}
          cy={CELL_CENTER}
          r={pointerHalfHeight + 4}
          fill="none"
          stroke="oklch(0.95 0.01 240 / 0.25)"
          strokeWidth="1"
        />
      )}
      {isCalm && (
        <circle
          cx={CELL_CENTER}
          cy={CELL_CENTER}
          r={isConsensus ? 2.8 : 2.4}
          fill={color}
        />
      )}
      {showPointer && (
        <polygon
          points={`${CELL_CENTER} ${CELL_CENTER - pointerHalfHeight} ${CELL_CENTER + pointerHalfBase} ${CELL_CENTER + pointerHalfHeight} ${CELL_CENTER - pointerHalfBase} ${CELL_CENTER + pointerHalfHeight}`}
          fill={color}
          stroke={isConsensus ? CONSENSUS_COLOR : 'none'}
          strokeWidth={isConsensus ? 1.2 : 0}
          transform={`rotate(${rotation} ${CELL_CENTER} ${CELL_CENTER})`}
        />
      )}
    </svg>
  );
}

export function WindDirectionMatrix({
  timeSlots,
  modelHourlyById,
  modelAvailability,
  consensusByTime,
  showConsensus,
  observedWindByEpoch,
  observedCutoffTimeKey
}: {
  timeSlots: TimeSlot[];
  modelHourlyById: Map<string, Map<string, ModelForecast['hourly'][number]>>;
  modelAvailability: Map<string, boolean>;
  consensusByTime: Map<string, HourlyConsensus>;
  showConsensus: boolean;
  observedWindByEpoch: Map<number, ObservedWindSample>;
  observedCutoffTimeKey?: string | null;
}) {
  const isMobile = useIsMobile();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const labelInterval = isMobile ? 6 : 3;
  const columnWidth = isMobile ? 22 : 28;

  const rows = useMemo<DirectionRow[]>(() => {
    const modelRows: DirectionRow[] = WEATHER_MODELS.map((model) => ({
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
        color: CONSENSUS_COLOR,
        available: true
      });
    }
    list.push({
      id: 'observed',
      label: 'Observed',
      type: 'observed' as const,
      color: OBSERVED_COLOR,
      available: observedWindByEpoch.size > 0
    });
    return list;
  }, [modelAvailability, observedWindByEpoch, showConsensus]);

  const agreementByTime = useMemo(() => {
    const map = new Map<string, number | null>();
    timeSlots.forEach((slot) => {
      const directions = WEATHER_MODELS.map((model) =>
        modelHourlyById.get(model.id)?.get(slot.time)?.windDirection
      ).filter((value) => Number.isFinite(value)) as number[];
      const clusteringR = resultantLengthR(directions);
      map.set(slot.time, Number.isFinite(clusteringR) ? clusteringR : null);
    });
    return map;
  }, [modelHourlyById, timeSlots]);

  const tooltipColumns = useMemo<TooltipColumn[]>(() => {
    return timeSlots.map((slot) => {
      const columnRows: TooltipRow[] = rows.map((row) => {
        if (row.type === 'model') {
          const hour = modelHourlyById.get(row.id)?.get(slot.time);
          const windFrom = Number.isFinite(hour?.windDirection) ? hour?.windDirection ?? null : null;
          const sustained = Number.isFinite(hour?.windSpeed) ? hour?.windSpeed ?? null : null;
          const gust = Number.isFinite(hour?.windGusts) ? hour?.windGusts ?? null : null;
          return {
            id: row.id,
            name: row.label,
            type: row.type,
            color: row.color,
            windFrom,
            sustained,
            gust,
            directionAgreement: null,
            clusteringR: null,
            available: row.available
          };
        }
        if (row.type === 'consensus') {
          const consensus = consensusByTime.get(slot.time);
          const windFrom = Number.isFinite(consensus?.windDirection.mean)
            ? consensus?.windDirection.mean ?? null
            : null;
          const sustained = Number.isFinite(consensus?.windSpeed.mean)
            ? consensus?.windSpeed.mean ?? null
            : null;
          const clusteringR = agreementByTime.get(slot.time) ?? null;
          const directionAgreement = consensus?.windDirection.available === false
            ? null
            : consensus?.windDirection.agreement ?? null;
          return {
            id: row.id,
            name: row.label,
            type: row.type,
            color: CONSENSUS_COLOR,
            windFrom,
            sustained,
            gust: null,
            directionAgreement,
            clusteringR,
            available: row.available
          };
        }
        const observed = observedWindByEpoch.get(slot.epoch) ?? null;
        return {
          id: row.id,
          name: row.label,
          type: row.type,
          color: OBSERVED_COLOR,
          windFrom: observed?.direction ?? null,
          sustained: Number.isFinite(observed?.speed ?? NaN) ? observed?.speed ?? null : null,
          gust: Number.isFinite(observed?.gust ?? NaN) ? observed?.gust ?? null : null,
          directionAgreement: null,
          clusteringR: null,
          available: row.available
        };
      });
      return { slot, rows: columnRows };
    });
  }, [agreementByTime, consensusByTime, modelHourlyById, observedWindByEpoch, rows, timeSlots]);

  if (timeSlots.length === 0) {
    return null;
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
            {tooltipColumns.map((column, index) => {
              const isActive = hoverIndex === index;
              const consensusRows = column.rows.filter((row) => row.type === 'consensus');
              const observedRows = column.rows
                .filter((row) => row.type === 'observed')
                .filter((row) =>
                  Number.isFinite(row.windFrom ?? NaN)
                  || Number.isFinite(row.sustained ?? NaN)
                  || Number.isFinite(row.gust ?? NaN)
                );
              const modelRows = column.rows.filter((row) => row.type === 'model');
              const showModelDivider = consensusRows.length > 0 || observedRows.length > 0;
              return (
                <Tooltip key={column.slot.time}>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        'relative flex flex-col items-center transition-opacity duration-150',
                        isActive && 'bg-primary/10',
                        hoverIndex !== null && !isActive && 'opacity-60'
                      )}
                      style={{ width: columnWidth }}
                      onMouseEnter={() => setHoverIndex(index)}
                      onMouseLeave={() => setHoverIndex(null)}
                      onFocus={() => setHoverIndex(index)}
                      onBlur={() => setHoverIndex(null)}
                      tabIndex={0}
                      aria-label={`Wind direction column ${column.slot.fullLabel}`}
                    >
                      <div
                        className={cn(
                          'h-6 w-full text-[10px] flex items-center justify-center text-foreground/70',
                          column.slot.isCurrent && 'text-primary'
                        )}
                      >
                        {index % labelInterval === 0 ? column.slot.label : ''}
                      </div>
                      {column.rows.map((row) => {
                        const rowGlowColor = row.type === 'model'
                          ? row.color
                          : row.type === 'consensus'
                            ? CONSENSUS_COLOR
                            : undefined;
                        const hideObservedFuture = row.type === 'observed'
                          && Boolean(observedCutoffTimeKey)
                          && column.slot.time > (observedCutoffTimeKey as string);
                        return (
                          <div
                            key={`${row.id}-${column.slot.time}`}
                            className="h-8 w-full px-[1px] py-[2px]"
                            style={
                              hideObservedFuture
                                ? { opacity: 0, pointerEvents: 'none' }
                                : undefined
                            }
                          >
                            <WindDirectionCell
                              windFrom={row.windFrom}
                              sustained={row.sustained}
                              color={row.color ?? CONSENSUS_COLOR}
                              isConsensus={row.type === 'consensus'}
                              directionAgreement={row.directionAgreement}
                              clusteringR={row.clusteringR}
                              isDisabled={!row.available}
                              rowGlowColor={rowGlowColor}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    className="p-0 bg-transparent shadow-none border-none text-foreground [&>svg]:hidden"
                  >
                    <ComparisonTooltipCard title={column.slot.fullLabel}>
                      {consensusRows.map((row) => {
                        const speedText = formatSpeed(row.sustained);
                        const gustText = Number.isFinite(row.gust ?? NaN)
                          ? ` / ${formatSpeed(row.gust)} gust`
                          : '';
                        const agreementText = Number.isFinite(row.directionAgreement ?? NaN)
                          ? ` • Dir ${formatAgreementPercent(row.directionAgreement)}`
                          : '';
                        const clusteringText = Number.isFinite(row.clusteringR ?? NaN)
                          ? ` • R ${formatClusteringR(row.clusteringR)}`
                          : '';
                        return (
                          <ComparisonTooltipSection key={`${row.id}-${column.slot.time}-consensus`}>
                            <ComparisonTooltipRow
                              label="Consensus"
                              value={`${formatDegrees(row.windFrom)} → ${getFlowToText(row.windFrom)} • ${speedText}${gustText}${agreementText}${clusteringText}`}
                            />
                          </ComparisonTooltipSection>
                        );
                      })}
                      {observedRows.map((row) => {
                        const speedText = formatSpeed(row.sustained);
                        const gustText = Number.isFinite(row.gust ?? NaN)
                          ? ` / ${formatSpeed(row.gust)} gust`
                          : '';
                        return (
                          <ComparisonTooltipSection
                            key={`${row.id}-${column.slot.time}-observed`}
                            divider={consensusRows.length > 0}
                          >
                            <ComparisonTooltipRow
                              label="Observed"
                              value={`${formatDegrees(row.windFrom)} → ${getFlowToText(row.windFrom)} • ${speedText}${gustText}`}
                              icon={
                                <span
                                  className="inline-block h-2 w-2 rounded-full"
                                  style={{ backgroundColor: OBSERVED_COLOR }}
                                />
                              }
                            />
                          </ComparisonTooltipSection>
                        );
                      })}
                      <ComparisonTooltipSection divider={showModelDivider}>
                        {modelRows.map((row) => {
                          const speedText = formatSpeed(row.sustained);
                          const gustText = Number.isFinite(row.gust ?? NaN)
                            ? ` / ${formatSpeed(row.gust)} gust`
                            : '';
                          return (
                            <ComparisonTooltipRow
                              key={`${row.id}-${column.slot.time}-model`}
                              label={`${row.name}:`}
                              value={`${formatDegrees(row.windFrom)} → ${getFlowToText(row.windFrom)} • ${speedText}${gustText}`}
                              icon={
                                <span
                                  className="h-2 w-2 triangle-icon"
                                  style={{ backgroundColor: row.color }}
                                />
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
