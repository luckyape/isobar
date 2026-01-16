import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, ChevronDown, ChevronUp } from 'lucide-react';
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
import { Carousel, CarouselContent, CarouselItem, type CarouselApi } from '@/components/ui/carousel';
import { Cloud, Droplets, Thermometer, Wind } from 'lucide-react';
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
import { DailyForecast, type BreakdownLens } from '@/components/DailyForecast';
import { GraphsPanel } from '@/components/GraphsPanel';
import { IndividualModelForecasts } from '@/components/IndividualModelForecasts';
import { getLastFetchDiagnostics, type ModelDiagnostic } from '@/lib/weatherApi';
import { WEATHER_CODES } from '@/lib/weatherApi';
import { findCurrentHourIndex, formatHourLabel, parseOpenMeteoDateTime } from '@/lib/timeUtils';

// Unified drawer tab configuration
const DRAWER_TABS = [
  { key: 'overall', label: 'Overall', shortLabel: 'All', icon: null },
  { key: 'temperature', label: 'Temperature', shortLabel: 'Temp', icon: Thermometer },
  { key: 'precipitation', label: 'Precipitation', shortLabel: 'Precip', icon: Droplets },
  { key: 'wind', label: 'Wind', shortLabel: 'Wind', icon: Wind },
  { key: 'conditions', label: 'Conditions', shortLabel: 'Cond', icon: Cloud }
] as const;
type DrawerTabKey = typeof DRAWER_TABS[number]['key'];

export default function Home() {
  const {
    location,
    primaryLocation,
    isPrimary,
    forecasts,
    consensus,
    observations,
    isLoading,
    isOffline,
    error,
    lastUpdated,
    refreshNotice,
    setLocation,
    setPrimaryLocation,
    refresh
  } = useWeather();
  const [showModelList, setShowModelList] = useState(false);
  const [visibleLines, setVisibleLines] = useState<Record<string, boolean>>({});
  const [activeDrawerTab, setActiveDrawerTab] = useState<DrawerTabKey | null>(null);
  const [breakdownLens, setBreakdownLens] = useState<BreakdownLens>('agreement');
  const [breakdownCategory, setBreakdownCategory] = useState<string | null>(null);
  const [carouselApi, setCarouselApi] = useState<CarouselApi>();
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // 1. Compute Safe Forecast Spine ONCE
  // Use the canonical contract: normalizeModel returns status='ok' for valid models
  // This is the SINGLE source of truth for what counts as a usable forecast
  const okForecasts = useMemo(() => {
    return forecasts.filter(f => f.status === 'ok');
  }, [forecasts]);

  const hasInitializedModels = useRef(false);
  const isHeroMobile = useMediaQuery('(max-width: 639px)');
  const isDrawerOpen = activeDrawerTab !== null;
  const activeCategory = activeDrawerTab && activeDrawerTab !== 'overall' ? activeDrawerTab as CategoryDetailKey : null;

  // Memoize carousel options to prevent re-initialization on every render
  const [initialIndex] = useState(() => {
    const idx = DRAWER_TABS.findIndex(t => t.key === activeDrawerTab);
    return idx >= 0 ? idx : 0;
  });

  const carouselOptions = useMemo(() => ({
    startIndex: initialIndex,
    loop: false,
    dragFree: false,
    containScroll: 'trimSnaps' as const,
    align: 'start' as const,
  }), [initialIndex]);

  // Sync carousel slide selection with activeDrawerTab
  useEffect(() => {
    if (!carouselApi) return;

    const onSelect = () => {
      const index = carouselApi.selectedScrollSnap();
      const tab = DRAWER_TABS[index];
      if (tab && tab.key !== activeDrawerTab) {
        setActiveDrawerTab(tab.key);
      }
    };

    carouselApi.on('select', onSelect);
    return () => {
      carouselApi.off('select', onSelect);
    };
  }, [carouselApi, activeDrawerTab]);

  // Scroll carousel when tab state changes externally (gauge tap or tab click)
  useEffect(() => {
    if (!carouselApi || !activeDrawerTab) return;
    const targetIndex = DRAWER_TABS.findIndex(t => t.key === activeDrawerTab);
    if (targetIndex >= 0 && carouselApi.selectedScrollSnap() !== targetIndex) {
      carouselApi.scrollTo(targetIndex);
    }
  }, [carouselApi, activeDrawerTab]);

  useEffect(() => {
    if (forecasts.length > 0 && !hasInitializedModels.current) {
      const initialVisibility: Record<string, boolean> = {
        'Consensus Mean': true,
        'Observed': true,
        'Wind Fill': true
      };
      // Only iterate OK forecasts
      okForecasts.forEach(fc => {
        initialVisibility[fc.model.name] = true;
      });
      setVisibleLines(initialVisibility);
      hasInitializedModels.current = true;
    }
  }, [forecasts, okForecasts]);

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
      // Only iterate OK forecasts
      okForecasts.forEach((forecast) => ensure(forecast.model.name, true));
      return changed ? next : prev;
    });
  }, [forecasts, okForecasts]);

  useEffect(() => {
    setActiveDrawerTab(null);
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

  const heroAgreementScore = consensusAvailable && currentConsensus
    ? currentConsensus.overallAgreement
    : 0;
  const heroAgreementMetrics = consensusAvailable && currentConsensus
    ? {
      overall: currentConsensus.overallAgreement,
      temperature: currentConsensus.temperature.agreement,
      precipitation: currentConsensus.precipitationCombined.agreement,
      wind: currentConsensus.windSpeed.agreement,
      conditions: currentConsensus.weatherCode.agreement
    }
    : null;

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
        precip: safeAgreement(currentConsensus.precipitationCombined.agreement),
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
    precipitationProbabilityMax: {
      mean: day.precipitationProbabilityMax ?? 0,
      min: day.precipitationProbabilityMax ?? 0,
      max: day.precipitationProbabilityMax ?? 0,
      agreement: 0
    },
    precipitationCombined: {
      agreement: 0,
      amountAgreement: 0,
      probabilityAgreement: 0,
      amountAvailable: false,
      probabilityAvailable: false,
      available: false
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
  // Gating Logic
  const hasOkModels = okForecasts.length > 0;
  const showGraphs = hasOkModels; // Forecast-dependent sections rely on this
  const showHeroModels = hasOkModels;

  // Empty State Logic
  // Gating order: Loading -> Error -> No Useable Models -> Content
  const showLoading = isLoading && !consensus && !hasOkModels;
  const showError = !!error && !consensus && !hasOkModels;
  const showEmptyForecasts = !showLoading && !showError && !hasOkModels;

  const heroModelNames = consensusAvailable ? consensus?.successfulModels : undefined;

  const heroHourLabel = useMemo(() => {
    const timeValue = currentConsensus?.time ?? currentForecastHour?.time;
    if (!timeValue) return 'This hour';
    const parts = parseOpenMeteoDateTime(timeValue);
    if (!parts) return 'This hour';
    const formatted = formatHourLabel(parts);
    return formatted ? `This hour (${formatted})` : 'This hour';
  }, [currentConsensus?.time, currentForecastHour?.time]);

  // ---------------------------------------------------------------------------
  // STRICT GATING & EARLY RETURNS
  // ---------------------------------------------------------------------------

  // 1. LOADING: Global loading and no useful data yet
  if (isLoading && !consensus && okForecasts.length === 0) {
    return (
      <div className="min-h-screen relative overflow-hidden">
        {/* Background Layer (replicated for consistency) */}
        <div
          className="fixed inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: 'url(/images/hero-aurora.png)', opacity: 0.4 }}
        />
        <div className="fixed inset-0 bg-gradient-to-b from-background/80 via-background/90 to-background" />
        <Header
          location={location}
          primaryLocation={primaryLocation}
          isPrimary={isPrimary}
          isOffline={isOffline}
          isLoading={isLoading}
          onLocationSelect={setLocation}
          onSetPrimary={setPrimaryLocation}
          onRefresh={refresh}
        />
        <div className="container py-20">
          <div className="flex flex-col items-center justify-center gap-4">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
            <p className="text-foreground/80">Fetching forecasts from multiple models...</p>
          </div>
        </div>
      </div>
    );
  }

  // 2. ERROR: Global error and no useful data
  if (error && !consensus && okForecasts.length === 0) {
    return (
      <div className="min-h-screen relative overflow-hidden">
        <div
          className="fixed inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: 'url(/images/hero-aurora.png)', opacity: 0.4 }}
        />
        <div className="fixed inset-0 bg-gradient-to-b from-background/80 via-background/90 to-background" />
        <Header
          location={location}
          primaryLocation={primaryLocation}
          isPrimary={isPrimary}
          isOffline={isOffline}
          isLoading={isLoading}
          onLocationSelect={setLocation}
          onSetPrimary={setPrimaryLocation}
          onRefresh={refresh}
        />
        <div className="container py-20">
          <div className="glass-card p-8 max-w-md mx-auto text-center readable-text">
            <p className="text-destructive mb-4">{error}</p>
            <Button onClick={() => refresh({ userInitiated: true })}>
              Try Again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // 3. EMPTY: No usable models found (and not loading, not error-only)
  if (okForecasts.length === 0) {
    const diagnostics = import.meta.env.DEV ? getLastFetchDiagnostics() : [];

    return (
      <div className="min-h-screen relative overflow-hidden">
        <div
          className="fixed inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: 'url(/images/hero-aurora.png)', opacity: 0.4 }}
        />
        <div className="fixed inset-0 bg-gradient-to-b from-background/80 via-background/90 to-background" />
        <Header
          location={location}
          primaryLocation={primaryLocation}
          isPrimary={isPrimary}
          isOffline={isOffline}
          isLoading={isLoading}
          onLocationSelect={setLocation}
          onSetPrimary={setPrimaryLocation}
          onRefresh={refresh}
        />
        <div className="container py-20">
          <div className="glass-card p-8 max-w-lg mx-auto text-center readable-text border-white/10">
            <Cloud className="w-12 h-12 mx-auto mb-4 text-foreground/40" />
            <h3 className="text-lg font-medium mb-2">Forecast Unavailable</h3>
            <p className="text-foreground/70 mb-6">
              No weather models returned valid data for this location.
            </p>
            <p className="text-sm text-foreground/50 mb-4">
              Based on {forecasts.length} weather models
            </p>
            <Button
              onClick={() => refresh({ bypassAllCaches: true, userInitiated: true })}
              variant="outline"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Fetching...
                </>
              ) : (
                'Retry Forecast'
              )}
            </Button>

            {/* DEV-only Forecast Diagnostics Panel */}
            {import.meta.env.DEV && diagnostics.length > 0 && (
              <div className="mt-6 text-left">
                <button
                  onClick={() => setShowDiagnostics(!showDiagnostics)}
                  className="flex items-center gap-2 text-sm text-foreground/60 hover:text-foreground/80 transition-colors w-full justify-between"
                >
                  <span>Forecast Diagnostics</span>
                  {showDiagnostics ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                {showDiagnostics && (
                  <div className="mt-3 space-y-3 text-xs font-mono bg-black/20 rounded-lg p-3 max-h-80 overflow-y-auto">
                    {diagnostics.map((d) => (
                      <div key={d.modelId} className="border-b border-white/10 pb-2 last:border-0">
                        <div className="font-semibold text-foreground/90">{d.modelName} ({d.modelId})</div>
                        <div className="text-foreground/60">
                          <div>Decision: <span className={d.decision === 'fetch' ? 'text-green-400' : 'text-yellow-400'}>{d.decision}</span></div>
                          <div>HTTP: <span className={d.httpStatus === 200 ? 'text-green-400' : d.httpStatus ? 'text-red-400' : 'text-gray-400'}>
                            {d.httpStatus ?? 'no response'}
                          </span></div>
                          <div>Hourly: {d.hourlyLength} | Daily: {d.dailyLength}</div>
                          {d.filterReason && (
                            <div className="text-red-400">Filter: {d.filterReason}</div>
                          )}
                          {d.httpError && (
                            <div className="text-red-400 truncate" title={d.httpError}>Error: {d.httpError}</div>
                          )}
                          {d.requestUrl && (
                            <div className="text-foreground/40 truncate" title={d.requestUrl}>
                              URL: {d.requestUrl.slice(0, 60)}...
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 4. SUCCESS: We have at least one OK forecast.
  // We can safely render graphs, model cards, and the dashboard.
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
          primaryLocation={primaryLocation}
          isPrimary={isPrimary}
          isOffline={isOffline}
          isLoading={isLoading}
          onLocationSelect={setLocation}
          onSetPrimary={setPrimaryLocation}
          onRefresh={refresh}
        />

        <main className="container py-8">
          {/* Hero section with confidence gauge */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <div className="glass-card overflow-hidden p-6 sm:p-8 aurora-glow readable-text">
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
                          onClick={() => setActiveDrawerTab(prev => prev === 'overall' ? null : 'overall')}
                          className="inline-flex items-center rounded-full transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-white/30"
                          aria-expanded={activeDrawerTab === 'overall'}
                          aria-controls="desktop-carousel-panel"
                          aria-label="View model breakdown"
                        >
                          <span aria-hidden="true">
                            <ModelBadgeIcon
                              open={activeDrawerTab === 'overall'}
                              className={`${activeDrawerTab === 'overall' ? 'opacity-100' : 'opacity-70'}`}
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

                  </div>

                  {showHeroModels && isHeroMobile && (
                    <Drawer
                      open={isDrawerOpen}
                      onOpenChange={(open) => !open && setActiveDrawerTab(null)}
                    >
                      <DrawerContent className="glass-card border border-white/10 text-foreground/90 overflow-hidden data-[vaul-drawer-direction=bottom]:mt-12 data-[vaul-drawer-direction=bottom]:max-h-[92vh] [&>div:first-child]:hidden">
                        <DrawerHeader className="px-4 pb-2 pt-2">
                          <div className="flex items-center justify-between">
                            <div>
                              <DrawerTitle className="sr-only">Forecast Details</DrawerTitle>
                              <DrawerDescription className="text-foreground/70 text-xs">
                                {heroHourLabel}
                              </DrawerDescription>
                            </div>
                            <DrawerClose asChild>
                              <button
                                type="button"
                                className="text-[11px] text-foreground/70 hover:text-foreground underline underline-offset-2"
                                onClick={() => setActiveDrawerTab(null)}
                              >
                                Close
                              </button>
                            </DrawerClose>
                          </div>
                        </DrawerHeader>
                        {/* Tab Indicators with sliding pill */}
                        <div className="mx-4 mt-2 mb-4 grid grid-cols-5 gap-1 p-1 rounded-lg bg-white/[0.04]">
                          {DRAWER_TABS.map((tab) => {
                            const Icon = tab.icon;
                            const isActive = activeDrawerTab === tab.key;
                            return (
                              <button
                                key={tab.key}
                                type="button"
                                onClick={() => setActiveDrawerTab(tab.key)}
                                className="relative flex items-center justify-center gap-1 py-2 rounded-md text-[11px] font-medium transition-colors duration-200"
                                aria-pressed={isActive}
                              >
                                {isActive && (
                                  <motion.div
                                    layoutId="mobile-tab-indicator"
                                    className="absolute inset-0 bg-white/10 rounded-md shadow-sm"
                                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                                  />
                                )}
                                <span className={`relative z-10 ${isActive ? 'text-foreground' : 'text-foreground/50 hover:text-foreground/80'}`}>
                                  {Icon ? <Icon className="h-4 w-4" /> : <span className="text-xs">{tab.shortLabel}</span>}
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        {/* Swipeable Carousel */}
                        <Carousel
                          setApi={setCarouselApi}
                          opts={carouselOptions}
                          className="flex-1 w-full"
                        >
                          <CarouselContent className="ml-0 h-full">
                            {DRAWER_TABS.map((tab) => (
                              <CarouselItem key={tab.key} className="pl-0 h-full overflow-y-auto px-4 pb-4">
                                {tab.key === 'overall' ? (
                                  <ModelForecastDetailPanel
                                    forecasts={forecasts}
                                    modelNames={heroModelNames}
                                    timezone={location?.timezone}
                                  />
                                ) : (
                                  <CategoryDetailPanel
                                    category={tab.key as CategoryDetailKey}
                                    forecasts={forecasts}
                                    modelNames={heroModelNames}
                                    timezone={location?.timezone}
                                  />
                                )}
                              </CarouselItem>
                            ))}
                          </CarouselContent>
                        </Carousel>
                      </DrawerContent>
                    </Drawer>
                  )}

                  {/* Forecast Console with Decomposed Gauges */}
                  <div className="flex flex-col items-center gap-4 lg:items-end">
                    <DualRingGauge
                      score={heroAgreementScore}
                      size="lg"
                      isUnavailable={!consensusAvailable}
                      metrics={heroAgreementMetrics}
                      forecast={displayTemperatureValue !== null && weatherInfo ? {
                        temperature: displayTemperatureValue,
                        icon: weatherInfo.icon,
                        description: weatherInfo.description
                      } : undefined}
                      onOverallTap={showHeroModels ? () => setActiveDrawerTab('overall') : undefined}
                      onCategoryTap={showHeroModels ? (category: string) => setActiveDrawerTab(category as DrawerTabKey) : undefined}
                      onModelDetailsToggle={showHeroModels ? () => setActiveDrawerTab(prev => prev === 'overall' ? null : 'overall') : undefined}
                      modelDetailsOpen={activeDrawerTab === 'overall'}
                      modelDetailsControlsId="desktop-carousel-panel"
                      modelDetailsLabel="Show individual model forecasts"
                      activeCategoryKey={activeCategory}
                    />
                  </div>
                </div>

                {showHeroModels && activeDrawerTab && !isHeroMobile && (
                  <motion.div
                    id="desktop-carousel-panel"
                    role="region"
                    aria-label="Model details panel"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="pt-4"
                  >
                    {/* Desktop Tab Bar with sliding pill */}
                    <div className="mb-4 p-1 rounded-lg bg-white/[0.04] flex items-center">
                      <div className="flex-1 grid grid-cols-5 gap-1">
                        {DRAWER_TABS.map((tab) => {
                          const Icon = tab.icon;
                          const isActive = activeDrawerTab === tab.key;
                          return (
                            <button
                              key={tab.key}
                              type="button"
                              onClick={() => setActiveDrawerTab(tab.key)}
                              className="relative flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-colors duration-200"
                              aria-pressed={isActive}
                            >
                              {isActive && (
                                <motion.div
                                  layoutId="desktop-tab-indicator"
                                  className="absolute inset-0 bg-white/10 rounded-md shadow-sm"
                                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                                />
                              )}
                              <span className={`relative z-10 flex items-center gap-1.5 ${isActive ? 'text-foreground' : 'text-foreground/60 hover:text-foreground'}`}>
                                {Icon && <Icon className="h-3.5 w-3.5" />}
                                <span>{tab.label}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveDrawerTab(null)}
                        className="ml-3 px-2 py-1 text-[10px] text-foreground/50 hover:text-foreground/80 transition-colors"
                      >
                        ✕
                      </button>
                    </div>

                    {/* Swipeable Carousel - Desktop */}
                    <div className="w-full  -m-4 p-4">
                      <Carousel
                        setApi={setCarouselApi}
                        opts={carouselOptions}
                        className="w-full"
                      >
                        <CarouselContent className="ml-0">
                          {DRAWER_TABS.map((tab) => (
                            <CarouselItem key={tab.key} className="pl-6 basis-full">
                              {tab.key === 'overall' ? (
                                <ModelForecastDetailPanel
                                  forecasts={forecasts}
                                  modelNames={heroModelNames}
                                  timezone={location?.timezone}
                                />
                              ) : (
                                <CategoryDetailPanel
                                  category={tab.key as CategoryDetailKey}
                                  forecasts={forecasts}
                                  modelNames={heroModelNames}
                                  timezone={location?.timezone}
                                />
                              )}
                            </CarouselItem>
                          ))}
                        </CarouselContent>
                      </Carousel>
                    </div>
                  </motion.div>
                )}

                {/* Model status and metadata */}
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">

                    <span className="text-sm text-foreground/80">
                      Based on {okForecasts.length} weather models
                    </span>

                  </div>

                  {showModelList && (
                    <div id="model-status-list" className="space-y-2">
                      {consensus?.successfulModels?.map(name => {
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
                      {consensus?.failedModels?.map(name => {
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

          {/* Hourly chart */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-8"
          >
            <GraphsPanel
              forecasts={forecasts}
              consensus={consensus?.hourly ?? []}
              showConsensus={consensusAvailable}
              fallbackForecast={fallbackForecast}
              timezone={location?.timezone}
              visibleLines={visibleLines}
              onToggleLine={toggleLineVisibility}
              location={location ?? undefined}
              lastUpdated={lastUpdated}
              isPrimary={isPrimary}
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
              hourly={consensusAvailable ? consensus?.hourly : undefined}
              forecasts={forecasts}
              showAgreement={consensusAvailable}
              timezone={location?.timezone}
            />
          </motion.div>

          <IndividualModelForecasts
            forecasts={okForecasts}
            staleModelIds={staleModelIds}
            timezone={location?.timezone}
          />

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
      </div>
    </div>
  );
}
