/**
 * HourlyWeatherBugCard
 *
 * Dense "weather bug" / heads-up display for a single hourly forecast.
 * Designed for rapid scanning: time label, condition icon + description,
 * temperature, and structured data rows for wind, precipitation, and atmosphere.
 *
 * Style: Arctic Data Observatory frosted glass with model-scoped gradient accent.
 */

import { ArrowUp, Droplets, Wind, CloudSun, Gauge } from 'lucide-react';
import type { ModelForecast } from '@/lib/weatherApi';
import { normalizeWeatherCode, WEATHER_CODES } from '@/lib/weatherApi';
import { cn } from '@/lib/utils';

function withAlpha(color: string, alpha: number): string {
  if (!color) return color;
  if (color.includes('oklch(')) {
    return color.replace(')', ` / ${alpha})`);
  }
  return color;
}

function formatTemp(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) return '--';
  return `${Math.round(value as number)}°`;
}

function formatPercent(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) return '--';
  return `${Math.round(value as number)}%`;
}

function formatMmPerHour(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) return '--';
  const amount = value as number;
  if (amount >= 0 && amount < 0.05) return '<0.1';
  return `${Math.round(amount * 10) / 10}`;
}

function formatWind(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) return '--';
  return `${Math.round(value as number)}`;
}

function formatPressure(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) return '--';
  return `${Math.round(value as number)}`;
}

function windDirectionLabel(degrees: number | null | undefined): string {
  if (!Number.isFinite(degrees ?? NaN)) return '--';
  const value = ((degrees as number) % 360 + 360) % 360;
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(value / 45) % directions.length;
  return directions[index];
}

function getWeatherInfo(code: number | null | undefined) {
  const normalized = normalizeWeatherCode(code);
  if (!Number.isFinite(normalized)) return null;
  return WEATHER_CODES[normalized] || { description: 'Unknown', icon: '❓' };
}

export function HourlyWeatherBugCard({
  hour,
  fullLabel,
  isCurrent = false,
  isPast = false,
  accentColor,
  className
}: {
  hour: ModelForecast['hourly'][number];
  fullLabel: string;
  isCurrent?: boolean;
  isPast?: boolean;
  accentColor?: string;
  className?: string;
}) {
  const weatherInfo = getWeatherInfo(hour.weatherCode);
  const directionLabel = windDirectionLabel(hour.windDirection);
  const hasGust = Number.isFinite(hour.windGusts ?? NaN);

  // Build gradient style matching ModelBreakdownPanel pattern
  const cardStyle = accentColor
    ? { background: `linear-gradient(135deg, ${withAlpha(accentColor, isPast ? 0.02 : 0.06)}, var(--background))` }
    : undefined;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg border border-white/10 bg-background px-3 py-3 transition-opacity',
        isCurrent && 'border-white/20 bg-white/[0.04]',
        isPast && 'opacity-50 grayscale-[30%]',
        className
      )}
      style={cardStyle}
    >
      {/* Left accent bar */}
      {accentColor && (
        <div
          className="absolute left-0 top-0 h-full w-[2px]"
          style={{ backgroundColor: accentColor }}
          aria-hidden="true"
        />
      )}

      {/* Hero row: Time + Conditions + Temperature */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* Time label + Now badge */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-caps text-foreground/70 whitespace-nowrap">
              {fullLabel}
            </span>
            {isCurrent && (
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-foreground/80">
                Now
              </span>
            )}
          </div>

          {/* Weather icon */}
          <span className="text-xl leading-none opacity-90" aria-hidden="true">
            {weatherInfo?.icon ?? '—'}
          </span>

          {/* Temperature + short description */}
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="font-mono text-[26px] font-bold leading-none tracking-tighter tabular-nums">
              {formatTemp(hour.temperature)}
            </span>
            <span className="hidden text-xs text-foreground/70 sm:inline truncate">
              {weatherInfo?.description ?? '—'}
            </span>
          </div>
        </div>

        {/* Wind summary (right side) */}
        <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-foreground/60">
          <ArrowUp
            className="h-3 w-3"
            aria-hidden="true"
            style={{
              transform: Number.isFinite(hour.windDirection ?? NaN)
                ? `rotate(${(hour.windDirection as number) + 180}deg)`
                : undefined
            }}
          />
          <span className="font-mono tabular-nums">
            {formatWind(hour.windSpeed)}
          </span>
          <span className="hidden sm:inline">km/h</span>
          <span className="hidden sm:inline text-foreground/50">{directionLabel}</span>
        </div>
      </div>

      {/* Structured data rows */}
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/[0.06] pt-2.5">
        {/* Wind group */}
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 text-[10px] text-foreground/50">
            <Wind className="h-3 w-3" />
            <span>Wind</span>
          </div>
          <div className="text-[12px] text-foreground/80">
            <span className="font-mono tabular-nums">{formatWind(hour.windSpeed)}</span>
            <span className="text-foreground/50"> km/h {directionLabel}</span>
            {hasGust && (
              <span className="text-foreground/50"> (g {formatWind(hour.windGusts)})</span>
            )}
          </div>
        </div>

        {/* Precipitation group */}
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 text-[10px] text-foreground/50">
            <Droplets className="h-3 w-3" />
            <span>Precip</span>
          </div>
          <div className="text-[12px] text-foreground/80">
            <span className="font-mono tabular-nums">{formatPercent(hour.precipitationProbability)}</span>
            <span className="text-foreground/50"> · </span>
            <span className="font-mono tabular-nums">{formatMmPerHour(hour.precipitation)}</span>
            <span className="text-foreground/50"> mm/hr</span>
          </div>
        </div>

        {/* Atmosphere group */}
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 text-[10px] text-foreground/50">
            <Gauge className="h-3 w-3" />
            <span>Atmos</span>
          </div>
          <div className="text-[12px] text-foreground/80">
            <span className="font-mono tabular-nums">{formatPressure(hour.pressure)}</span>
            <span className="text-foreground/50"> hPa</span>
          </div>
        </div>
      </div>

      {/* Secondary metrics row */}
      <div className="mt-2 flex items-center gap-3 text-[11px] text-foreground/50">
        <div className="flex items-center gap-1">
          <CloudSun className="h-3 w-3" />
          <span>Cloud</span>
          <span className="font-mono tabular-nums text-foreground/70">{formatPercent(hour.cloudCover)}</span>
        </div>
        <div className="flex items-center gap-1">
          <span>Humidity</span>
          <span className="font-mono tabular-nums text-foreground/70">{formatPercent(hour.humidity)}</span>
        </div>
      </div>
    </div>
  );
}
