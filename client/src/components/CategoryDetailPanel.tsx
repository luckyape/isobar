import { useMemo, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { ArrowUp, Cloud, Droplets, Thermometer, Wind } from 'lucide-react';
import type { ModelForecast } from '@/lib/weatherApi';
import { WEATHER_CODES } from '@/lib/weatherApi';
import { findCurrentHourIndex } from '@/lib/timeUtils';
import { cn } from '@/lib/utils';
import { ForecastDisplay } from '@/components/ForecastDisplay';
import { ModelBadgeIcon } from '@/components/ModelBadgeIcon';
import { ModelForecastDrilldownPanel } from '@/components/ModelForecastDrilldownPanel';
import { Dialog, DialogContent } from '@/components/ui/dialog';

const MODEL_ORDER = ['ECMWF', 'GFS', 'ICON', 'GEM'] as const;
const MODEL_ORDER_SET = new Set<string>(MODEL_ORDER);
const FALLBACK_MODEL_COLOR = 'oklch(0.95 0.01 240)';

export const CATEGORY_DETAIL_META = {
  temperature: { label: 'Temperature', unit: '°', icon: Thermometer },
  precipitation: { label: 'Precipitation', unit: '%', icon: Droplets },
  wind: { label: 'Wind', unit: 'km/h', icon: Wind },
  conditions: { label: 'Conditions', unit: '', icon: Cloud }
} as const;

export type CategoryDetailKey = keyof typeof CATEGORY_DETAIL_META;

type ModelEntry = {
  name: string;
  color: string;
  hour?: ModelForecast['hourly'][number];
};

function withAlpha(color: string, alpha: number) {
  if (!color) return color;
  if (color.includes('oklch(')) {
    return color.replace(')', ` / ${alpha})`);
  }
  return color;
}

function formatPrecipAmount(value: number | null | undefined) {
  if (!Number.isFinite(value ?? NaN)) return null;
  const amount = value as number;
  if (amount >= 0 && amount < 0.05) return '<0.1';
  return String(Math.round(amount * 10) / 10);
}

function formatWindDirection(value: number | null | undefined) {
  if (!Number.isFinite(value ?? NaN)) return null;
  const degrees = ((value as number) % 360 + 360) % 360;
  return degrees;
}

function windDirectionLabel(degrees: number) {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(degrees / 45) % directions.length;
  return directions[index];
}

export function CategoryDetailPanel({
  category,
  forecasts,
  modelNames,
  timezone,
  className,
  evidenceOpen = false
}: {
  category: CategoryDetailKey;
  forecasts: ModelForecast[];
  modelNames?: string[];
  timezone?: string;
  className?: string;
  evidenceOpen?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const modelOrder = useMemo<string[]>(() => {
    if (!modelNames?.length) {
      return [...MODEL_ORDER];
    }
    const uniqueNames = Array.from(new Set(modelNames));
    const ordered = MODEL_ORDER.filter((name) => uniqueNames.includes(name));
    const extras = uniqueNames.filter((name) => !MODEL_ORDER_SET.has(name));
    return [...ordered, ...extras];
  }, [modelNames]);

  const modelEntries = useMemo<ModelEntry[]>(() => {
    const forecastByName = new Map(forecasts.map((forecast) => [forecast.model.name, forecast]));
    const includeMissing = !modelNames?.length;
    return modelOrder.flatMap<ModelEntry>((name) => {
      const forecast = forecastByName.get(name);
      if (!forecast || forecast.error || forecast.hourly.length === 0) {
        if (!includeMissing) {
          return [];
        }
        return [{
          name,
          color: forecast?.model.color ?? FALLBACK_MODEL_COLOR,
          hour: undefined
        }];
      }
      const currentHourIndex = findCurrentHourIndex(
        forecast.hourly.map((entry) => entry.time),
        timezone
      );
      const currentHour = forecast.hourly[currentHourIndex] || forecast.hourly[0];
      return [{
        name,
        color: forecast.model.color,
        hour: currentHour
      }];
    });
  }, [forecasts, modelNames, modelOrder, timezone]);

  const [activeModelName, setActiveModelName] = useState<string | null>(null);
  const activeForecast = useMemo(() => {
    if (!activeModelName) return null;
    return forecasts.find((forecast) => forecast.model.name === activeModelName) ?? null;
  }, [activeModelName, forecasts]);

  return (
    <>
      <div
        className={cn('grid grid-cols-2 gap-1.5 sm:gap-3 lg:grid-cols-4', className)}
        data-state={evidenceOpen ? 'open' : 'closed'}
      >
        {modelEntries.map((entry, index) => {
          const tint = entry.color ? withAlpha(entry.color, 0.12) : undefined;
          const cardStyle = tint
            ? { background: `linear-gradient(135deg, ${tint}, var(--background))` }
            : undefined;
          const weatherInfo = Number.isFinite(entry.hour?.weatherCode ?? NaN)
            ? (WEATHER_CODES[entry.hour?.weatherCode as number] || { description: 'Unknown', icon: '❓' })
            : null;
          const categoryMeta = CATEGORY_DETAIL_META[category];
          const isConditions = category === 'conditions';
          const description = isConditions
            ? categoryMeta.label
            : categoryMeta.label;
          const icon = isConditions
            ? (weatherInfo?.icon ?? '—')
            : (
              <categoryMeta.icon className="h-6 w-6 sm:h-8 sm:w-8 text-foreground/80" />
            );
          const valueLabel = isConditions ? (weatherInfo?.description ?? '—') : null;
          const hideValue = false;
          const value = isConditions
            ? null
            : category === 'temperature'
              ? entry.hour?.temperature
              : category === 'precipitation'
                ? entry.hour?.precipitationProbability
                : category === 'wind'
                  ? entry.hour?.windSpeed
                  : null;
          const precipAmountLabel = category === 'precipitation'
            ? formatPrecipAmount(entry.hour?.precipitation)
            : null;
          const showPrecipAmount = category === 'precipitation'
            && precipAmountLabel !== null
            && Number.isFinite(value ?? NaN);
          const windDirectionValue = category === 'wind'
            ? formatWindDirection(entry.hour?.windDirection)
            : null;
          const showWindDirection = category === 'wind' && windDirectionValue !== null;
          const accessory = showPrecipAmount ? (
            <span className="text-[10px] sm:text-xs font-semibold text-foreground/60 leading-none">
              {precipAmountLabel} mm
            </span>
          ) : showWindDirection ? (
            <span className="flex items-center gap-1 text-[10px] sm:text-xs font-semibold text-foreground/60 leading-none">
              <ArrowUp
                className="h-3 w-3 sm:h-3.5 sm:w-3.5"
                style={{ transform: `rotate(${windDirectionValue + 180}deg)` }}
              />
              <span>{windDirectionLabel(windDirectionValue)}</span>
            </span>
          ) : null;
          const cardClassName = cn(
            'relative rounded-lg sm:rounded-xl border border-white/10 bg-subtle p-2.5 sm:p-4 text-foreground/90 flex flex-col gap-2 sm:gap-3',
            'min-h-28 sm:min-h-32'
          );
          const displayClassName = cn('mt-1.5 sm:mt-3 items-start text-left');
          const canOpen = Boolean(entry.hour);
          const delay = reduceMotion || !evidenceOpen ? 0 : 60 + index * 35;
          const transitionStyle = delay > 0 ? { transitionDelay: `${delay}ms` } : undefined;
          const resolvedStyle = transitionStyle ? { ...cardStyle, ...transitionStyle } : cardStyle;
          const motionClassName = reduceMotion
            ? 'transition-none'
            : 'transition-[opacity,transform,filter] duration-[170ms] ease-[cubic-bezier(.2,.8,.2,1)]';
          const stateClassName = evidenceOpen ? 'opacity-100' : 'opacity-0';
          const transformClassName = reduceMotion
            ? ''
            : (evidenceOpen ? 'translate-y-0 blur-0' : '-translate-y-2 blur-[2px]');

          return (
            <div
              key={entry.name}
              className={cn(cardClassName, "will-change-transform", motionClassName, stateClassName, transformClassName)}
              style={resolvedStyle}
            >
              <button
                type="button"
                onClick={() => setActiveModelName(entry.name)}
                className={cn(
                  'absolute top-2 right-2 sm:top-3 sm:right-3',
                  'rounded-full p-1.5 transition-opacity',
                  'opacity-70 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-white/30',
                  'disabled:pointer-events-none disabled:opacity-30'
                )}
                aria-label={`View ${entry.name} model details`}
                disabled={!canOpen}
              >
                <ModelBadgeIcon open={activeModelName === entry.name} className={activeModelName === entry.name ? 'opacity-100' : 'opacity-70'} />
              </button>

              <div className="flex items-center gap-2 text-[9px] sm:text-[10px] font-semibold uppercase tracking-caps text-foreground/70">
                <span
                  className="h-2 w-2 sm:h-2.5 sm:w-2.5 triangle-icon"
                  style={{ backgroundColor: entry.color }}
                />
                <span>{entry.name}</span>
              </div>
              <ForecastDisplay
                value={value}
                unit={categoryMeta.unit}
                precision={category === 'temperature' ? 1 : 0}
                icon={icon}
                description={description}
                hideValue={hideValue}
                valueLabel={valueLabel}
                accessory={accessory}
                className={displayClassName}
              />
            </div>
          );
        })}
      </div>

      <Dialog
        open={activeModelName !== null && activeForecast !== null}
        onOpenChange={(open) => {
          if (!open) setActiveModelName(null);
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="p-0 glass-card bg-background/90 backdrop-blur-xl border-white/15 shadow-2xl max-w-[min(92vw,58rem)] w-full h-[92vh] sm:h-[85vh] overflow-hidden"
        >
          {activeForecast && (
            <ModelForecastDrilldownPanel
              forecast={activeForecast}
              timezone={timezone}
              className="h-full readable-text"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
