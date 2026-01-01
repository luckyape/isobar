/**
 * ModelCard Component - Arctic Data Observatory
 * Displays individual weather model forecast data
 */

import { motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, Thermometer, Droplets, Wind, ArrowUp } from 'lucide-react';
import type { ModelForecast } from '@/lib/weatherApi';
import { WEATHER_CODES } from '@/lib/weatherApi';
import { Badge } from '@/components/ui/badge';
import { findCurrentHourIndex } from '@/lib/timeUtils';

interface ModelCardProps {
  forecast: ModelForecast;
  index: number;
  isStale?: boolean;
  timezone?: string;
}

export function ModelCard({
  forecast,
  index,
  isStale,
  timezone
}: ModelCardProps) {
  const { model, hourly, daily, error } = forecast;

  // Get current hour data
  const currentHourIndex = findCurrentHourIndex(
    hourly.map((hour) => hour.time),
    timezone
  );
  const currentHour = hourly[currentHourIndex] || hourly[0];
  const today = daily[0];
  const nowMs = Date.now();
  const nowSeconds = nowMs / 1000;
  const runAvailabilityTime = Number.isFinite(forecast.runAvailabilityTime)
    ? (forecast.runAvailabilityTime as number)
    : null;
  const modelAgeSeconds =
    runAvailabilityTime !== null ? Math.max(0, nowSeconds - runAvailabilityTime) : null;
  const hasMetadata = runAvailabilityTime !== null;

  const formatAge = (seconds: number) => {
    const totalMinutes = Math.max(0, Math.floor(seconds / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.1 }}
        className="glass-card p-4 readable-text"
      >
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-3 h-3 triangle-icon"
            style={{ backgroundColor: model.color }}
          />
          <h3 className="font-semibold">{model.name}</h3>
          <span className="text-xs text-foreground/80">{model.provider}</span>
        </div>
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm">Failed to load: {error}</span>
        </div>
      </motion.div>
    );
  }

  const weatherInfo =
    WEATHER_CODES[currentHour?.weatherCode] || {
      description: 'Unknown',
      icon: '❓'
    };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      className="glass-card p-4 hover:border-white/20 transition-colors readable-text"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-3 h-3 triangle-icon"
            style={{
              backgroundColor: model.color,
              filter: `drop-shadow(0 0 8px ${model.color})`
            }}
          />
          <div>
            <h3 className="font-semibold">{model.name}</h3>
            <p className="text-xs text-foreground/80">{model.provider}</p>
          </div>
        </div>
        <CheckCircle2 className="w-4 h-4 text-[oklch(0.72_0.19_160)]" />
      </div>

      {/* Current conditions */}
      {currentHour && (
        <div className="space-y-4">
          {/* Weather icon and temp */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-4xl">{weatherInfo.icon}</span>
              <div>
                <p className="text-3xl font-mono font-semibold">
                  {Math.round(currentHour.temperature)}°
                </p>
                <p className="text-sm text-foreground/80">
                  {weatherInfo.description}
                </p>
              </div>
            </div>
          </div>

          {/* Details grid */}
          <div className="grid grid-cols-3 gap-3 pt-3 border-t border-white/10">
            <div className="text-center">
              <Thermometer className="w-4 h-4 mx-auto mb-1 text-foreground/70" />
              <p className="text-xs text-foreground/80">High/Low</p>
              <p className="font-mono text-sm">
                {today
                  ? `${Math.round(today.temperatureMax)}° / ${Math.round(
                    today.temperatureMin
                  )}°`
                  : '--'}
              </p>
            </div>
            <div className="text-center">
              <Droplets className="w-4 h-4 mx-auto mb-1 text-foreground/70" />
              <p className="text-xs text-foreground/80">Precip</p>
              <p className="font-mono text-sm">
                {currentHour.precipitationProbability}%
              </p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <Wind className="w-4 h-4 text-foreground/70" />
                {Number.isFinite(currentHour.windDirection) && (
                  <ArrowUp
                    className="w-3 h-3 text-foreground/70"
                    style={{
                      transform: `rotate(${currentHour.windDirection + 180}deg)`
                    }}
                  />
                )}
              </div>
              <p className="text-xs text-foreground/80">Wind</p>
              <p className="font-mono text-sm">
                {Math.round(currentHour.windSpeed)} km/h
              </p>
            </div>
          </div>

          <div className="pt-3 border-t border-white/10">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-foreground/80">
                {hasMetadata && modelAgeSeconds !== null
                  ? `Model run available: ${formatAge(modelAgeSeconds)} ago`
                  : 'Model run age: unknown'}
              </p>
              {isStale && (
                <Badge
                  variant="outline"
                  className="border-destructive/60 text-destructive"
                >
                  Stale
                </Badge>
              )}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
