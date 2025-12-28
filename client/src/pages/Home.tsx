import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { motion } from 'framer-motion';
import { Info, CloudSnow, Loader2, ChevronDownIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Header } from '@/components/Header';
import {
  ComparisonTooltipCard,
  ComparisonTooltipRow,
  ComparisonTooltipSection
} from '@/components/ComparisonTooltip';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle
} from '@/components/ui/drawer';
import { useWeather } from '@/hooks/useWeather';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { ConfidenceGauge } from '@/components/ConfidenceGauge';
import { WeatherConfidenceCard } from '@/components/WeatherConfidenceCard';
import { ModelCard } from '@/components/ModelCard';
import { DailyForecast, ModelHourlyBreakdownPanel } from '@/components/DailyForecast';
import { GraphsPanel } from '@/components/GraphsPanel';
import { WEATHER_CODES } from '@/lib/weatherApi';
import {
  findCurrentHourIndex,
  formatHourLabel,
  parseOpenMeteoDateTime
} from '@/lib/timeUtils';

const TOOLTIP_CONTENT_CLASSNAME =
  'p-0 bg-transparent shadow-none border-none text-foreground [&>svg]:hidden';

export default function Home() {
  const {
    location,
    forecasts,
    consensus,
    observations,
    isLoading,
    isOffline,
    error,
    lastUpdated,
    refreshNotice,
    setLocation,
    refresh
  } = useWeather();
  const [showModelList, setShowModelList] = useState(false);
  const [visibleLines, setVisibleLines] = useState<Record<string, boolean>>({});
  const [heroModelsOpen, setHeroModelsOpen] = useState(false);
  const hasInitializedModels = useRef(false);
  const isHeroMobile = useMediaQuery('(max-width: 639px)');

  useEffect(() => {
    if (forecasts.length > 0 && !hasInitializedModels.current) {
      const initialVisibility: Record<string, boolean> = {
        'Consensus Mean': true,
        'Observed': true,
        'Wind Fill': true
      };
      forecasts.forEach(fc => {
        initialVisibility[fc.model.name] = true;
      });
      setVisibleLines(initialVisibility);
      hasInitializedModels.current = true;
    }
  }, [forecasts]);

  useEffect(() => {
    if (forecasts.length === 0) return;
    setVisibleLines((prev) => {
      const next = { ...prev };
      let changed = false;
      const ensure = (key: string, value: boolean) => {
        if (next[key] === undefined) {
          next[key] = value;
          changed = true;
        }
      };
      ensure('Consensus Mean', true);
      ensure('Observed', true);
      ensure('Wind Fill', true);
      forecasts.forEach((forecast) => ensure(forecast.model.name, true));
      return changed ? next : prev;
    });
  }, [forecasts]);

  useEffect(() => {
    setHeroModelsOpen(false);
  }, [location?.latitude, location?.longitude]);

  const toggleLineVisibility = (lineName: string) => {
    setVisibleLines(prev => ({
      ...prev,
      [lineName]: !prev[lineName]
    }));
  };

  const consensusAvailable = Boolean(consensus?.isAvailable);
  const fallbackForecast = forecasts.find(forecast => !forecast.error && forecast.model.name === 'ECMWF')
    || forecasts.find(forecast => !forecast.error && forecast.hourly.length > 0)
    || null;
  const fallbackModelName = fallbackForecast?.model.name;
  const freshnessScore = Number.isFinite(consensus?.freshness.freshnessScore ?? NaN)
    ? (consensus?.freshness.freshnessScore as number)
    : null;
  const freshnessScoreValue = freshnessScore !== null
    ? Math.round(freshnessScore)
    : null;
  const refreshNoticeLabel = refreshNotice?.type === 'no-new-runs'
    ? refreshNotice.latestRunAvailabilityTime
      ? `No new runs since ${new Date(refreshNotice.latestRunAvailabilityTime * 1000).toLocaleTimeString('en-CA', {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: location?.timezone
        })}`
      : 'No new runs detected'
    : null;
  
  const getCurrentConsensus = () => {
    if (!consensus?.hourly?.length) return null;
    const index = findCurrentHourIndex(
      consensus.hourly.map((hour) => hour.time),
      location?.timezone
    );
    return consensus.hourly[index] || consensus.hourly[0] || null;
  };

  const getCurrentForecastHour = () => {
    if (!fallbackForecast?.hourly?.length) return null;
    const index = findCurrentHourIndex(
      fallbackForecast.hourly.map((hour) => hour.time),
      location?.timezone
    );
    return fallbackForecast.hourly[index] || fallbackForecast.hourly[0] || null;
  };

  const currentConsensus = consensusAvailable ? getCurrentConsensus() : null;
  const currentForecastHour = !consensusAvailable ? getCurrentForecastHour() : null;

  const displayTemperature = consensusAvailable
    ? currentConsensus?.temperature.mean
    : currentForecastHour?.temperature;
  const displayWeatherCode = consensusAvailable
    ? currentConsensus?.weatherCode.dominant
    : currentForecastHour?.weatherCode;
  const displayTemperatureValue = Number.isFinite(displayTemperature ?? NaN)
    ? (displayTemperature as number)
    : null;

  const weatherCodeValue = Number.isFinite(displayWeatherCode ?? NaN)
    ? (displayWeatherCode as number)
    : null;
  const weatherInfo = weatherCodeValue !== null
    ? WEATHER_CODES[weatherCodeValue] || { description: 'Unknown', icon: '❓' }
    : null;
  const weatherConfidenceCardData = useMemo(() => {
    if (!consensusAvailable || !currentConsensus) return null;
    const formatUpdatedAt = () => {
      if (!lastUpdated) return 'Unknown';
      return lastUpdated.toLocaleTimeString('en-CA', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: location?.timezone
      });
    };
    const safeAgreement = (value: number | undefined) =>
      Number.isFinite(value) ? Math.round(value) : 0;
    const safeTemp = Number.isFinite(currentConsensus.temperature.mean)
      ? currentConsensus.temperature.mean
      : displayTemperatureValue ?? 0;
    const safeOverall = Number.isFinite(currentConsensus.overallAgreement ?? NaN)
      ? Math.round(currentConsensus.overallAgreement)
      : 0;

    return {
      location: {
        name: location?.name ?? 'Unknown',
        region: [location?.province, location?.country].filter(Boolean).join(', ') || 'Unknown region'
      },
      current: {
        temp: safeTemp,
        condition: weatherInfo?.description ?? 'Unknown',
        icon: weatherInfo?.icon ?? '❔'
      },
      overallConfidence: safeOverall,
      freshness: freshnessScoreValue ?? null,
      categories: {
        temp: safeAgreement(currentConsensus.temperature.agreement),
        precip: safeAgreement(currentConsensus.precipitation.agreement),
        wind: safeAgreement(currentConsensus.windSpeed.agreement),
        cloud: safeAgreement(currentConsensus.weatherCode.agreement)
      },
      modelCount: consensus?.modelCount ?? 0,
      updatedAt: formatUpdatedAt()
    };
  }, [
    consensus?.modelCount,
    consensusAvailable,
    currentConsensus,
    displayTemperatureValue,
    freshnessScoreValue,
    lastUpdated,
    location?.country,
    location?.name,
    location?.province,
    location?.timezone,
    weatherInfo
  ]);

  const availabilityTimes = forecasts
    .filter(forecast => !forecast.error)
    .map(forecast => forecast.runAvailabilityTime)
    .filter((time): time is number => Number.isFinite(time));
  const freshestRunAvailability = availabilityTimes.length > 0 ? Math.max(...availabilityTimes) : null;
  const staleModelIds = new Set<string>();

  if (freshestRunAvailability !== null) {
    forecasts.forEach(forecast => {
      if (forecast.error) return;
      if (!Number.isFinite(forecast.runAvailabilityTime)) return;
      const ageDeltaHours = (freshestRunAvailability - (forecast.runAvailabilityTime as number)) / 3600;
      if (ageDeltaHours > 6) {
        staleModelIds.add(forecast.model.id);
      }
    });
  }

  const nowSeconds = Date.now() / 1000;
  const modelByName = new Map(forecasts.map((forecast) => [forecast.model.name, forecast]));
  const modelColorByName = new Map(forecasts.map((forecast) => [
    forecast.model.name,
    forecast.model.color
  ]));
  const getModelColor = (name: string) =>
    modelColorByName.get(name) ?? 'oklch(0.95 0.01 240)';
  const formatAge = (seconds: number) => {
    const totalMinutes = Math.max(0, Math.floor(seconds / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  const getModelFreshnessTone = (runAvailabilityTime?: number, hasError?: boolean) => {
    if (hasError || !Number.isFinite(runAvailabilityTime)) return 'unknown';
    const ageHours = Math.max(0, (nowSeconds - (runAvailabilityTime as number)) / 3600);
    if (ageHours <= 6) return 'fresh';
    if (ageHours <= 12) return 'aging';
    return 'stale';
  };

  const getFreshnessToneByName = (name: string) => {
    const forecast = modelByName.get(name);
    return getModelFreshnessTone(forecast?.runAvailabilityTime, Boolean(forecast?.error));
  };

  const freshnessToneClass: Record<string, string> = {
    fresh: 'bg-[oklch(0.72_0.19_160)]',
    aging: 'bg-[oklch(0.75_0.18_85)]',
    stale: 'bg-destructive',
    unknown: 'bg-white/10 border border-white/30'
  };

  const fallbackDaily = fallbackForecast?.daily.map(day => ({
    date: day.date,
    temperatureMax: {
      mean: day.temperatureMax,
      min: day.temperatureMax,
      max: day.temperatureMax,
      stdDev: 0,
      agreement: 0
    },
    temperatureMin: {
      mean: day.temperatureMin,
      min: day.temperatureMin,
      max: day.temperatureMin,
      stdDev: 0,
      agreement: 0
    },
    precipitation: {
      mean: day.precipitationSum,
      min: day.precipitationSum,
      max: day.precipitationSum,
      agreement: 0
    },
    windSpeed: {
      mean: day.windSpeedMax,
      agreement: 0
    },
    weatherCode: {
      dominant: day.weatherCode,
      agreement: 0
    },
    overallAgreement: 0
  })) || [];

  const dailyForDisplay = consensusAvailable ? (consensus?.daily ?? []) : fallbackDaily;
  const showHeroModels = forecasts.some((forecast) => forecast.hourly.length > 0);
  const heroModelNames = consensusAvailable ? consensus?.successfulModels : undefined;
  const heroHourLabel = useMemo(() => {
    const timeValue = currentConsensus?.time ?? currentForecastHour?.time;
    if (!timeValue) return 'This hour';
    const parts = parseOpenMeteoDateTime(timeValue);
    if (!parts) return 'This hour';
    const formatted = formatHourLabel(parts);
    return formatted ? `This hour (${formatted})` : 'This hour';
  }, [currentConsensus?.time, currentForecastHour?.time]);

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Background with aurora image */}
      <div 
        className="fixed inset-0 bg-cover bg-center bg-no-repeat animate-aurora"
        style={{ 
          backgroundImage: 'url(/images/hero-aurora.png)',
          opacity: 0.4
        }}
      />
      <div className="fixed inset-0 bg-gradient-to-b from-background/80 via-background/90 to-background" />
      
      {/* Topographic pattern overlay */}
      <div 
        className="fixed inset-0 opacity-10"
        style={{ 
          backgroundImage: 'url(/images/topo-pattern.png)',
          backgroundSize: '400px'
        }}
      />

      {/* Main content */}
      <div className="relative z-10">
        <Header 
          location={location}
          isOffline={isOffline}
          isLoading={isLoading}
          onLocationSelect={setLocation}
          onRefresh={refresh}
        />

        {/* Loading state */}
        {isLoading && !consensus && (
          <div className="container py-20">
            <div className="flex flex-col items-center justify-center gap-4">
              <Loader2 className="w-12 h-12 animate-spin text-primary" />
              <p className="text-foreground/80">Fetching forecasts from multiple models...</p>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && !consensus && (
          <div className="container py-20">
            <div className="glass-card p-8 max-w-md mx-auto text-center readable-text">
              <p className="text-destructive mb-4">{error}</p>
              <Button onClick={() => refresh({ userInitiated: true })}>
                Try Again
              </Button>
            </div>
          </div>
        )}

        {/* Main dashboard */}
        {consensus && (
          <main className="container py-8">
            {/* Hero section with confidence gauge */}
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-8"
            >
              <div className="glass-card p-6 sm:p-8 aurora-glow readable-text">
                <div className="flex flex-col gap-6">
                  <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-start">
                    {/* Location and current weather */}
                    <div>
                      <div className="flex flex-wrap items-center gap-3 mb-1">
                        <h2 className="text-3xl font-semibold">
                          {location?.name}
                        </h2>
                        {showHeroModels && (
                          <button
                            type="button"
                            onClick={() => setHeroModelsOpen((prev) => !prev)}
                            className="inline-flex items-center gap-1 text-xs text-foreground/70 hover:text-foreground"
                            aria-expanded={heroModelsOpen}
                            aria-controls="hero-model-breakdown"
                          >
                            <span>Models</span>
                            <ChevronDownIcon
                              className={`h-3 w-3 transition-transform ${heroModelsOpen ? 'rotate-180' : ''}`}
                            />
                          </button>
                        )}
                      </div>
                      <p className="text-foreground/80 mb-3">
                        {location?.province && `${location.province}, `}
                        {location?.country}
                      </p>
                      
                      {displayTemperatureValue !== null && weatherInfo && (
                        <div className="flex items-center gap-4">
                          <span className="text-6xl">{weatherInfo.icon}</span>
                          <div>
    
                            <p className="text-5xl font-mono font-semibold">
                              {Math.round(displayTemperatureValue)}°
                            </p>
                            <p className="text-foreground/80">
                              {weatherInfo.description}
                            </p>
                          </div>
                        </div>
                      )}
                      {!consensusAvailable && (
                        <Badge
                          variant="outline"
                          className="mt-3 border-destructive/60 text-destructive"
                        >
                          {fallbackModelName
                            ? `Consensus unavailable (showing ${fallbackModelName})`
                            : 'Consensus unavailable'}
                        </Badge>
                      )}
                      {showHeroModels && heroModelsOpen && !isHeroMobile && (
                        <div id="hero-model-breakdown" className="mt-4">
                          <ModelHourlyBreakdownPanel
                            hour={currentConsensus}
                            forecasts={forecasts}
                            modelNames={heroModelNames}
                            timezone={location?.timezone}
                          />
                        </div>
                      )}
                    </div>

                    {showHeroModels && isHeroMobile && (
                      <Drawer
                        open={heroModelsOpen}
                        onOpenChange={setHeroModelsOpen}
                      >
                        <DrawerContent className="glass-card border border-white/10 text-foreground/90">
                          <DrawerHeader className="pb-2">
                            <div className="flex items-center justify-between">
                              <div>
                                <DrawerTitle className="text-base">Model Breakdown</DrawerTitle>
                                <DrawerDescription className="text-foreground/70 text-xs">
                                  {heroHourLabel}
                                </DrawerDescription>
                              </div>
                              <DrawerClose asChild>
                                <button
                                  type="button"
                                  className="text-xs text-foreground/70 hover:text-foreground underline underline-offset-2"
                                >
                                  Close
                                </button>
                              </DrawerClose>
                            </div>
                          </DrawerHeader>
                          <ModelHourlyBreakdownPanel
                            hour={currentConsensus}
                            forecasts={forecasts}
                            modelNames={heroModelNames}
                            timezone={location?.timezone}
                            className="mx-4 mb-4"
                          />
                        </DrawerContent>
                      </Drawer>
                    )}
                    
                    {/* Confidence gauge */}
                    <div className="flex flex-col items-center gap-6 lg:items-end">
                      <div className="w-full max-w-[420px]">
                        <ConfidenceGauge
                          score={consensus.metrics.overall}
                          size="lg"
                          isUnavailable={!consensusAvailable}
                          metrics={consensus.metrics}
                        />
                      </div>
                      {forecasts.length > 0 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="flex items-center justify-center gap-4 rounded-full bg-transparent p-0 border-none focus-visible:ring-2 focus-visible:ring-ring/50"
                              aria-label="Model freshness details"
                            >
                              {forecasts.map((forecast) => {
                                const tone = getModelFreshnessTone(
                                  forecast.runAvailabilityTime,
                                  Boolean(forecast.error)
                                );
                                return (
                                  <span
                                    key={`${forecast.model.id}-freshness-dot`}
                                    className={`h-3 w-3 rounded-full inline-block opacity-50 ${freshnessToneClass[tone]}`}
                                    aria-hidden="true"
                                  />
                                );
                              })}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className={TOOLTIP_CONTENT_CLASSNAME}>
                            <ComparisonTooltipCard title="Model freshness">
                              <ComparisonTooltipSection>
                                <ComparisonTooltipRow
                                  label="Freshness score"
                                  value={freshnessScoreValue !== null ? `${freshnessScoreValue}%` : 'Unavailable'}
                                />
                              </ComparisonTooltipSection>
                              <ComparisonTooltipSection divider>
                                {forecasts.map((forecast) => {
                                  const ageSeconds = Number.isFinite(forecast.runAvailabilityTime)
                                    ? Math.max(0, nowSeconds - (forecast.runAvailabilityTime as number))
                                    : null;
                                  const ageValue = ageSeconds !== null
                                    ? formatAge(ageSeconds)
                                    : null;
                                  const pendingAvailabilityTime = Number.isFinite(forecast.pendingAvailabilityTime ?? NaN)
                                    ? (forecast.pendingAvailabilityTime as number)
                                    : null;
                                  const statusLabel = pendingAvailabilityTime !== null
                                    ? 'Stabilizing'
                                    : forecast.updateError
                                      ? 'Cached'
                                      : forecast.error
                                        ? 'Error'
                                        : null;
                                  const valueLabel = ageValue ? `${ageValue} ago` : 'Unknown';
                                  const valueWithStatus = statusLabel
                                    ? `${valueLabel} (${statusLabel})`
                                    : valueLabel;
                                  return (
                                    <ComparisonTooltipRow
                                      key={`${forecast.model.id}-freshness-row`}
                                      label={forecast.model.name}
                                      value={valueWithStatus}
                                      icon={
                                        <span
                                          className="h-2 w-2 triangle-icon"
                                          style={{ backgroundColor: forecast.model.color }}
                                          aria-hidden="true"
                                        />
                                      }
                                    />
                                  );
                                })}
                              </ComparisonTooltipSection>
                            </ComparisonTooltipCard>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </div>

                  {/* Model status and metadata */}
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
  
                      <span className="text-sm text-foreground/80">
                        Based on {consensus.modelCount} weather models
                      </span>
  
                    </div>
                    
                    {showModelList && (
                      <div id="model-status-list" className="space-y-2">
                        {consensus.successfulModels.map(name => {
                          const tone = getFreshnessToneByName(name);
                          const forecast = modelByName.get(name);
                          const modelAgeSeconds = Number.isFinite(forecast?.runAvailabilityTime ?? NaN)
                            ? Math.max(0, nowSeconds - (forecast?.runAvailabilityTime as number))
                            : null;
                          const modelAgeLabel = modelAgeSeconds !== null
                            ? `${formatAge(modelAgeSeconds)} old`
                            : 'Age unknown';
                          const statusLabel = forecast?.pendingAvailabilityTime
                            ? 'Stabilizing'
                            : forecast?.updateError
                              ? 'Cached'
                              : null;
                          return (
                            <div key={name} className="flex items-center gap-2">
                              <span className="text-sm">{name}</span>
                              <div className="flex items-center gap-1">
                                <div
                                  className="w-2.5 h-2.5 triangle-icon"
                                  style={{ backgroundColor: getModelColor(name) }}
                                />
                                <div className={`w-2 h-2 rounded-full ${freshnessToneClass[tone]}`} />
                              </div>
                              <span className="text-[10px] text-foreground/60">
                                {modelAgeLabel}
                              </span>
                              {statusLabel && (
                                <span className="text-[10px] text-foreground/60">
                                  {statusLabel}
                                </span>
                              )}
                            </div>
                          );
                        })}
                        {consensus.failedModels.map(name => {
                          const tone = getFreshnessToneByName(name);
                          const forecast = modelByName.get(name);
                          const modelAgeSeconds = Number.isFinite(forecast?.runAvailabilityTime ?? NaN)
                            ? Math.max(0, nowSeconds - (forecast?.runAvailabilityTime as number))
                            : null;
                          const modelAgeLabel = modelAgeSeconds !== null
                            ? `${formatAge(modelAgeSeconds)} old`
                            : 'Age unknown';
                          return (
                            <div key={name} className="flex items-center gap-2">
                              <span className="text-sm text-destructive">{name}</span>
                              <div className="flex items-center gap-1">
                                <div
                                  className="w-2.5 h-2.5 triangle-icon opacity-40"
                                  style={{ backgroundColor: getModelColor(name) }}
                                />
                                <div className={`w-2 h-2 rounded-full ${freshnessToneClass[tone]}`} />
                              </div>
                              <span className="text-[10px] text-foreground/60">
                                {modelAgeLabel}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    
                    {lastUpdated && (
                      <p className="text-xs text-foreground/80">
                        Updated {lastUpdated.toLocaleTimeString('en-CA', { 
                          hour: 'numeric', 
                          minute: '2-digit',
                          timeZone: location?.timezone
                        })}
                      </p>
                    )}
                    {refreshNoticeLabel && (
                      <p className="text-xs text-foreground/70">{refreshNoticeLabel}</p>
                    )}
                  </div>
                </div>
              </div>
            </motion.section>

            {weatherConfidenceCardData && (
              <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 }}
                className="mb-8"
              >
                <WeatherConfidenceCard {...weatherConfidenceCardData} />
              </motion.section>
            )}

            {/* Hourly chart */}
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="mb-8"
            >
              <GraphsPanel
                forecasts={forecasts}
                consensus={consensusAvailable ? consensus.hourly : []}
                showConsensus={consensusAvailable}
                fallbackForecast={fallbackForecast}
                observations={observations?.hourly ?? []}
                timezone={location?.timezone}
                visibleLines={visibleLines}
                onToggleLine={toggleLineVisibility}
              />
            </motion.section>

            {/* Daily forecast */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="mb-8 min-w-0"
            >
              <DailyForecast
                daily={dailyForDisplay}
                forecasts={forecasts}
                showAgreement={consensusAvailable}
                timezone={location?.timezone}
              />
            </motion.div>

            {/* Individual model cards */}
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
            >
              <h2 className="text-xl font-semibold">Individual Model Forecasts</h2>
              <p className="text-sm text-foreground/70 mb-4">
                Current-hour conditions per model, plus today's high/low.
              </p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {forecasts.map((forecast, index) => (
                  <ModelCard
                    key={forecast.model.id}
                    forecast={forecast}
                    index={index}
                    isStale={staleModelIds.has(forecast.model.id)}
                    timezone={location?.timezone}
                  />
                ))}
              </div>
            </motion.section>

            {/* Footer info */}
            <motion.footer
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-12 pt-8 border-t border-white/10 text-center"
            >
              <p className="text-sm text-foreground/80 mb-2">
                Data sourced from Environment Canada (GEM), NOAA (GFS), ECMWF, and DWD (ICON) via Open-Meteo API
              </p>
              <p className="text-xs text-foreground/80">
                For mission-critical decisions, always consult official weather services and local authorities.
              </p>
            </motion.footer>
          </main>
        )}
      </div>
    </div>
  );
}
