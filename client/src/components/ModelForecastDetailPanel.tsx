import { useMemo } from 'react';
import { useReducedMotion } from 'framer-motion';
import type { ModelForecast } from '@/lib/weatherApi';
import { WEATHER_CODES } from '@/lib/weatherApi';
import { findCurrentHourIndex } from '@/lib/timeUtils';
import { cn } from '@/lib/utils';
import { ForecastDisplay } from '@/components/ForecastDisplay';
import { WeatherIcon } from '@/components/icons/WeatherIcon';
import { conditionToIconName } from '@/lib/weatherIcons';
import { getIsDay } from '@/lib/dayNight';

const MODEL_ORDER = ['ECMWF', 'GFS', 'ICON', 'GEM'] as const;
const MODEL_ORDER_SET = new Set<string>(MODEL_ORDER);
const FALLBACK_MODEL_COLOR = 'oklch(0.95 0.01 240)';

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

export function ModelForecastDetailPanel({
  forecasts,
  modelNames,
  timezone,
  className,
  evidenceOpen = false
}: {
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

  return (
    <div
      className={cn('grid grid-cols-2 gap-1.5 sm:gap-3 lg:grid-cols-4', className)}
      data-state={evidenceOpen ? 'open' : 'closed'}
    >
      {modelEntries.map((entry, index) => {
        const temp = Number.isFinite(entry.hour?.temperature ?? NaN)
          ? (entry.hour?.temperature as number)
          : null;
        const code = Number.isFinite(entry.hour?.weatherCode ?? NaN)
          ? (entry.hour?.weatherCode as number)
          : null;

        const hourEpoch = entry.hour?.time ? new Date(entry.hour.time).getTime() / 1000 : Date.now() / 1000;
        const isDay = getIsDay(hourEpoch, undefined, timezone);
        const iconName = code !== null ? conditionToIconName(code, isDay) : null;
        const weatherDescription = code !== null
          ? (WEATHER_CODES[code]?.description || 'Unknown')
          : null;
        const tint = entry.color ? withAlpha(entry.color, 0.12) : undefined;
        const cardStyle = tint
          ? { background: `linear-gradient(135deg, ${tint}, var(--background))` }
          : undefined;
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
            className={cn(
              "rounded-lg sm:rounded-xl border border-white/10 bg-subtle p-2.5 sm:p-4 text-foreground/90 min-h-28 sm:min-h-32 flex flex-col",
              "will-change-transform",
              motionClassName,
              stateClassName,
              transformClassName
            )}
            style={resolvedStyle}
          >
            <div className="flex items-center gap-2 text-[9px] sm:text-[10px] font-semibold uppercase tracking-caps text-foreground/70">
              <span
                className="h-2 w-2 sm:h-2.5 sm:w-2.5 triangle-icon"
                style={{ backgroundColor: entry.color }}
              />
              <span>{entry.name}</span>
            </div>
            <ForecastDisplay
              temperature={temp}
              precision={1}
              icon={iconName ? <WeatherIcon name={iconName} className="h-10 w-10 sm:h-14 sm:w-14 text-foreground/80" /> : '—'}
              description={weatherDescription ?? '—'}
              className="mt-1.5 sm:mt-3 flex-1"
            />
          </div>
        );
      })}
    </div>
  );
}
