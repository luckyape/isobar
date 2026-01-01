import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Header } from '@/components/Header';
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
import { DualRingGauge } from '@/components/DualRingGauge';
import { WeatherConfidenceCard } from '@/components/WeatherConfidenceCard';
import { ModelCard } from '@/components/ModelCard';
import { ModelBadgeIcon } from '@/components/ModelBadgeIcon';
import {
  CategoryDetailPanel,
  CATEGORY_DETAIL_META,
  type CategoryDetailKey
} from '@/components/CategoryDetailPanel';
import { ModelForecastDetailPanel } from '@/components/ModelForecastDetailPanel';
import { DailyForecast, ModelHourlyBreakdownPanel, type BreakdownLens } from '@/components/DailyForecast';
import { GraphsPanel } from '@/components/GraphsPanel';
import { WEATHER_CODES } from '@/lib/weatherApi';
import { findCurrentHourIndex, formatHourLabel, parseOpenMeteoDateTime } from '@/lib/timeUtils';

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
  const [heroPane, setHeroPane] = useState<'models' | 'breakdown' | 'category' | null>(null);
  const [heroCategory, setHeroCategory] = useState<CategoryDetailKey | null>(null);
  const [breakdownLens, setBreakdownLens] = useState<BreakdownLens>('agreement');
  const [breakdownCategory, setBreakdownCategory] = useState<string | null>(null);
  const hasInitializedModels = useRef(false);
  const isHeroMobile = useMediaQuery('(max-width: 639px)');
  const isHeroModelsOpen = heroPane === 'models';
  const isHeroBreakdownOpen = heroPane === 'breakdown';
  const isHeroCategoryOpen = heroPane === 'category';

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
    setHeroPane(null);
    setHeroCategory(null);
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
      Number.isFinite(value) ? Math.round(value as number) : 0;
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
  const heroModelDetailsId = isHeroMobile ? 'hero-model-details-drawer' : 'hero-model-details';
  const heroModelBreakdownId = isHeroMobile ? 'hero-model-breakdown-drawer' : 'hero-model-breakdown';
  const heroCategoryDetailsId = isHeroMobile ? 'hero-category-details-drawer' : 'hero-category-details';
  const heroCategoryMeta = heroCategory ? CATEGORY_DETAIL_META[heroCategory] : null;
  const heroHourLabel = useMemo(() => {
    const timeValue = currentConsensus?.time ?? currentForecastHour?.time;
    if (!timeValue) return 'This hour';
    const parts = parseOpenMeteoDateTime(timeValue);
    if (!parts) return 'This hour';
    const formatted = formatHourLabel(parts);
    return formatted ? `This hour (${formatted})` : 'This hour';
  }, [currentConsensus?.time, currentForecastHour?.time]);

  const toggleHeroModels = () => {
    setHeroPane((prev) => (prev === 'models' ? null : 'models'));
    setHeroCategory(null);
  };

  const toggleHeroBreakdown = () => {
    setHeroPane((prev) => {
      const next = prev === 'breakdown' ? null : 'breakdown';
      if (next === 'breakdown') {
        setBreakdownLens('agreement');
        setBreakdownCategory(null);
      }
      return next;
    });
    setHeroCategory(null);
  };

  const openHeroBreakdown = (category: string | null = null) => {
    setBreakdownLens('agreement');
    setBreakdownCategory(category);
    setHeroPane('breakdown');
    setHeroCategory(null);
  };

  const openHeroCategory = (category: CategoryDetailKey) => {
    setHeroCategory((prev) => {
      const next = prev === category ? null : category;
      setHeroPane(next ? 'category' : null);
      return next;
    });
  };

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
                            onClick={toggleHeroBreakdown}
                            className="inline-flex items-center rounded-full transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-white/30"
                            aria-expanded={isHeroBreakdownOpen}
                            aria-controls={heroModelBreakdownId}
                            aria-label="View model breakdown"
                          >
                            <span aria-hidden="true">
                              <ModelBadgeIcon
                                className={`transition-opacity ${isHeroBreakdownOpen ? 'opacity-100' : 'opacity-70'}`}
                              />
                            </span>
                          </button>
                        )}
                      </div>
                      <p className="text-foreground/80 mb-3">
                        {location?.province && `${location.province}, `}
                        {location?.country}
                      </p>


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
                      {showHeroModels && isHeroBreakdownOpen && !isHeroMobile && (
                        <div id={heroModelBreakdownId} className="mt-4">
                          <ModelHourlyBreakdownPanel
                            hour={currentConsensus}
                            forecasts={forecasts}
                            modelNames={heroModelNames}
                            timezone={location?.timezone}
                            lens={breakdownLens}
                            onLensChange={setBreakdownLens}
                            focusedCategory={breakdownCategory}
                          />
                        </div>
                      )}
                    </div>

                    {showHeroModels && isHeroMobile && (
                      <Drawer
                        open={heroPane !== null}
                        onOpenChange={(open) => {
                          if (!open) {
                            setHeroPane(null);
                            setHeroCategory(null);
                          }
                        }}
                      >
                        <DrawerContent className="glass-card border border-white/10 text-foreground/90 overflow-hidden data-[vaul-drawer-direction=bottom]:mt-12 data-[vaul-drawer-direction=bottom]:max-h-[92vh] [&>div:first-child]:hidden">
                          <DrawerHeader className="px-4 pb-2 pt-2">
                            <div className="flex items-center justify-between">
                              <div>
                                <DrawerTitle className={heroPane === 'models' ? 'sr-only' : 'text-base'}>
                                  {heroPane === 'category'
                                    ? (heroCategoryMeta?.label ?? 'Model Details')
                                    : heroPane === 'breakdown'
                                      ? 'Model Breakdown'
                                      : 'Individual model forecasts'}
                                </DrawerTitle>
                                {(heroPane === 'breakdown' || heroPane === 'category') && (
                                  <DrawerDescription className="text-foreground/70 text-xs">
                                    {heroHourLabel}
                                  </DrawerDescription>
                                )}
                              </div>
                              <DrawerClose asChild>
                                <button
                                  type="button"
                                  className="text-[11px] text-foreground/70 hover:text-foreground underline underline-offset-2"
                                >
                                  Close
                                </button>
                              </DrawerClose>
                            </div>
                          </DrawerHeader>
                          <div className="flex-1 overflow-y-auto px-4 pb-4">
                            {heroPane === 'breakdown' && (
                              <div id={heroModelBreakdownId}>
                                <ModelHourlyBreakdownPanel
                                  hour={currentConsensus}
                                  forecasts={forecasts}
                                  modelNames={heroModelNames}
                                  timezone={location?.timezone}
                                  lens={breakdownLens}
                                  onLensChange={setBreakdownLens}
                                  focusedCategory={breakdownCategory}
                                />
                              </div>
                            )}
                            {heroPane === 'models' && (
                              <div id={heroModelDetailsId}>
                                <ModelForecastDetailPanel
                                  forecasts={forecasts}
                                  modelNames={heroModelNames}
                                  timezone={location?.timezone}
                                />
                              </div>
                            )}
                            {heroPane === 'category' && heroCategory && (
                              <div id={heroCategoryDetailsId}>
                                <CategoryDetailPanel
                                  category={heroCategory}
                                  forecasts={forecasts}
                                  modelNames={heroModelNames}
                                  timezone={location?.timezone}
                                />
                              </div>
                            )}
                          </div>
                        </DrawerContent>
                      </Drawer>
                    )}

                    {/* Forecast Console with Decomposed Gauges */}
                    <div className="flex flex-col items-center gap-4 lg:items-end">
                      <DualRingGauge
                        score={consensus.metrics.overall}
                        size="lg"
                        isUnavailable={!consensusAvailable}
                        metrics={consensus.metrics}
                        forecast={displayTemperatureValue !== null && weatherInfo ? {
                          temperature: displayTemperatureValue,
                          icon: weatherInfo.icon,
                          description: weatherInfo.description
                        } : undefined}
                        onOverallTap={showHeroModels ? () => openHeroBreakdown(null) : undefined}
                        onCategoryTap={showHeroModels ? (category: string) => openHeroCategory(category as CategoryDetailKey) : undefined}
                        onModelDetailsToggle={showHeroModels ? toggleHeroModels : undefined}
                        modelDetailsOpen={isHeroModelsOpen}
                        modelDetailsControlsId={heroModelDetailsId}
                        modelDetailsLabel="Show individual model forecasts"
                        activeCategoryKey={isHeroCategoryOpen ? heroCategory : null}
                      />
                    </div>
                  </div>

                  {showHeroModels && isHeroModelsOpen && !isHeroMobile && (
                    <motion.div
                      id={heroModelDetailsId}
                      role="region"
                      aria-label="Individual model forecasts"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="pt-2"
                    >
                      <ModelForecastDetailPanel
                        forecasts={forecasts}
                        modelNames={heroModelNames}
                        timezone={location?.timezone}
                      />
                    </motion.div>
                  )}

                  {showHeroModels && isHeroCategoryOpen && heroCategory && heroCategoryMeta && !isHeroMobile && (
                    <motion.div
                      id={heroCategoryDetailsId}
                      role="region"
                      aria-label={`${heroCategoryMeta.label} model details`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="pt-2"
                    >
                      <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground/60">
                        <span className="flex h-4 w-4 items-center justify-center">
                          <heroCategoryMeta.icon className="h-3.5 w-3.5" />
                        </span>
                        <span>{heroCategoryMeta.label}</span>
                      </div>
                      <CategoryDetailPanel
                        category={heroCategory}
                        forecasts={forecasts}
                        modelNames={heroModelNames}
                        timezone={location?.timezone}
                      />
                    </motion.div>
                  )}

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

            {/* {weatherConfidenceCardData && (
              <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 }}
                className="mb-8"
              >
                <WeatherConfidenceCard {...weatherConfidenceCardData} />
              </motion.section>
            )} */}

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
