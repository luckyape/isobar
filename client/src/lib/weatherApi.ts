/**
 * Weather API Service - Arctic Data Observatory
 * Fetches forecasts from multiple weather models via Open-Meteo API
 * Models: GEM (Canada), GFS (US), ECMWF (Europe), ICON (Germany)
 */

import {
  addDays,
  formatDateKey,
  formatDateTimeKey,
  getZonedDateParts,
  getZonedNowParts,
  parseOpenMeteoDateTime
} from '@/lib/timeUtils';

export interface WeatherModel {
  id: string;
  name: string;
  provider: string;
  endpoint: string;
  color: string;
  description: string;
  metadataId?: string;
}

export interface HourlyForecast {
  time: string;
  temperature: number;
  precipitation: number;
  precipitationProbability: number;
  windSpeed: number;
  windDirection: number;
  windGusts: number;
  cloudCover: number;
  humidity: number;
  pressure: number;
  weatherCode: number;
}

export interface DailyForecast {
  date: string;
  temperatureMax: number;
  temperatureMin: number;
  precipitationSum: number;
  precipitationProbabilityMax: number;
  windSpeedMax: number;
  windGustsMax: number;
  weatherCode: number;
  sunrise: string;
  sunset: string;
}

export interface ModelForecast {
  model: WeatherModel;
  hourly: HourlyForecast[];
  daily: DailyForecast[];
  fetchedAt: Date;
  runInitialisationTime?: number;
  runAvailabilityTime?: number;
  updateIntervalSeconds?: number;
  metadataFetchedAt?: number;
  snapshotTime?: number;
  lastForecastFetchTime?: number;
  lastSeenRunAvailabilityTime?: number | null;
  lastForecastSnapshotId?: string;
  snapshotHash?: string;
  etag?: string;
  pendingAvailabilityTime?: number;
  updateError?: string;
  error?: string;
}

export interface ModelMetadata {
  runInitialisationTime?: number;
  runAvailabilityTime?: number;
  updateIntervalSeconds?: number;
  metadataFetchedAt?: number;
}

export interface ObservedHourly {
  time: string;
  temperature: number;
  precipitation?: number;
  windSpeed?: number;
  windDirection?: number;
  windGusts?: number;
}

export interface ObservedConditions {
  hourly: ObservedHourly[];
  fetchedAt: Date;
  error?: string;
}

export interface Location {
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  province?: string;
  timezone: string;
}

// Weather models configuration - focused on Canadian context
export const WEATHER_MODELS: WeatherModel[] = [
  {
    id: 'gem_seamless',
    name: 'GEM',
    provider: 'Environment Canada',
    endpoint: 'https://api.open-meteo.com/v1/gem',
    color: 'oklch(0.75 0.15 195)', // Arctic cyan
    description: 'Canadian Global Environmental Multiscale Model - Primary for Canada',
    metadataId: 'cmc_gem_gdps'
  },
  {
    id: 'gfs_seamless',
    name: 'GFS',
    provider: 'NOAA (US)',
    endpoint: 'https://api.open-meteo.com/v1/gfs',
    color: 'oklch(0.70 0.16 280)', // Purple
    description: 'Global Forecast System - US model with global coverage',
    metadataId: 'ncep_gfs013'
  },
  {
    id: 'ecmwf_ifs',
    name: 'ECMWF',
    provider: 'European Centre',
    endpoint: 'https://api.open-meteo.com/v1/ecmwf',
    color: 'oklch(0.72 0.19 160)', // Green
    description: 'European model - IFS HRES 9 km global forecast',
    metadataId: 'ecmwf_ifs'
  },
  {
    id: 'icon_seamless',
    name: 'ICON',
    provider: 'DWD (Germany)',
    endpoint: 'https://api.open-meteo.com/v1/dwd-icon',
    color: 'oklch(0.75 0.18 85)', // Amber
    description: 'German Icosahedral Nonhydrostatic model',
    metadataId: 'dwd_icon'
  }
];

const DEFAULT_UPDATE_INTERVAL_SECONDS = 600;
const MIN_METADATA_INTERVAL_SECONDS = 60;
const DEFAULT_METADATA_MEMORY_TTL_MINUTES = 10;
const DEFAULT_METADATA_FALLBACK_TTL_HOURS = 6;
const DEFAULT_CONSISTENCY_DELAY_MINUTES = 10;
const DEFAULT_MAX_CACHED_LOCATIONS = 6;
const DEFAULT_PENDING_JITTER_SECONDS = 60;
const METADATA_STORAGE_KEY = 'weather-consensus-model-metadata-v1';
const FORECAST_CACHE_KEY = 'weather-consensus-forecast-cache-v1';
const DEBUG_GATING = import.meta.env.VITE_DEBUG_GATING === 'true';

function getNumericEnv(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const CONFIG_CONSISTENCY_DELAY_MINUTES = getNumericEnv(
  import.meta.env.VITE_METADATA_CONSISTENCY_DELAY_MINUTES,
  DEFAULT_CONSISTENCY_DELAY_MINUTES
);
const CONFIG_METADATA_MEMORY_TTL_MINUTES = getNumericEnv(
  import.meta.env.VITE_METADATA_MEMORY_TTL_MINUTES,
  DEFAULT_METADATA_MEMORY_TTL_MINUTES
);
const CONFIG_METADATA_FALLBACK_TTL_HOURS = getNumericEnv(
  import.meta.env.VITE_METADATA_FALLBACK_TTL_HOURS,
  DEFAULT_METADATA_FALLBACK_TTL_HOURS
);
const CONFIG_MAX_CACHED_LOCATIONS = getNumericEnv(
  import.meta.env.VITE_MAX_CACHED_LOCATIONS,
  DEFAULT_MAX_CACHED_LOCATIONS
);
const CONFIG_MIN_METADATA_INTERVAL_SECONDS = getNumericEnv(
  import.meta.env.VITE_METADATA_MIN_INTERVAL_SECONDS,
  MIN_METADATA_INTERVAL_SECONDS
);

const METADATA_MEMORY_TTL_MS = Math.max(1, CONFIG_METADATA_MEMORY_TTL_MINUTES) * 60 * 1000;

type ModelMetadataCacheEntry = {
  runInitialisationTime?: number;
  runAvailabilityTime?: number;
  updateIntervalSeconds?: number;
  metadataFetchedAt?: number;
  lastMetadataCheckAt?: number;
  lastFetchedAvailabilityTime?: number;
};

type ModelMetadataCacheStore = {
  version: 1;
  models: Record<string, ModelMetadataCacheEntry>;
};

type CachedModelForecast = {
  hourly: HourlyForecast[];
  daily: DailyForecast[];
  fetchedAt: number;
  snapshotTime?: number;
  lastForecastFetchTime?: number;
  lastSeenRunAvailabilityTime?: number | null;
  lastForecastSnapshotId?: string;
  snapshotHash?: string;
  etag?: string;
  runInitialisationTime?: number;
  runAvailabilityTime?: number;
  updateIntervalSeconds?: number;
  metadataFetchedAt?: number;
};

type ForecastLocationCache = {
  updatedAt: number;
  models: Record<string, CachedModelForecast>;
};

type ForecastCacheStore = {
  version: 1;
  order: string[];
  locations: Record<string, ForecastLocationCache>;
};

type PendingModelUpdate = {
  modelId: string;
  availableAt: number;
  retryAt: number;
};

type ForecastFetchOptions = {
  force?: boolean;
  userInitiated?: boolean;
  offline?: boolean;
  consistencyDelayMinutes?: number;
  maxCachedLocations?: number;
  minMetadataIntervalSeconds?: number;
  metadataFallbackTtlHours?: number;
  nowMs?: number;
};

type ForecastFetchResult = {
  forecasts: ModelForecast[];
  pending: PendingModelUpdate[];
  usedCache: boolean;
  refreshSummary: RefreshSummary;
  completeness: DataCompleteness;
};

export type RefreshSummary = {
  mode: 'auto' | 'manual' | 'force';
  noNewRuns: boolean;
  latestRunAvailabilityTime?: number;
  offline?: boolean;
};

export type ModelCompleteness = {
  modelId: string;
  hasSnapshot: boolean;
  snapshotAgeSeconds: number | null;
  hasMetadata: boolean;
  runAgeKnown: boolean;
  updatedThisRefresh: boolean;
  isPending: boolean;
  isFailed: boolean;
};

export type DataCompleteness = {
  byModel: Record<string, ModelCompleteness>;
  countModelsFresh: number;
  countModelsStale: number;
  countModelsUnknown: number;
  countModelsFailed: number;
};

const metadataRequests = new Map<string, Promise<ModelMetadata | null>>();
const forecastRequests = new Map<string, Promise<ModelForecast>>();
const metadataMemoryCache = new Map<string, { metadata: ModelMetadata | null; fetchedAt: number }>();
const gatingStats = {
  metadataChecks: 0,
  forecastCalls: 0,
  forecastCallsSkipped: 0,
  pendingDelayModels: 0
};

function logDebug(message: string, data?: Record<string, unknown>) {
  if (!DEBUG_GATING) return;
  if (data) {
    console.info(`[gating] ${message}`, data);
  } else {
    console.info(`[gating] ${message}`);
  }
}

function canUseStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function loadMetadataStore(): ModelMetadataCacheStore {
  if (!canUseStorage()) {
    return { version: 1, models: {} };
  }
  try {
    const raw = window.localStorage.getItem(METADATA_STORAGE_KEY);
    if (!raw) return { version: 1, models: {} };
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || typeof parsed?.models !== 'object') {
      return { version: 1, models: {} };
    }
    return parsed as ModelMetadataCacheStore;
  } catch {
    return { version: 1, models: {} };
  }
}

function saveMetadataStore(store: ModelMetadataCacheStore) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(METADATA_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore storage write failures
  }
}

function loadForecastStore(): ForecastCacheStore {
  if (!canUseStorage()) {
    return { version: 1, order: [], locations: {} };
  }
  try {
    const raw = window.localStorage.getItem(FORECAST_CACHE_KEY);
    if (!raw) return { version: 1, order: [], locations: {} };
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || typeof parsed?.locations !== 'object') {
      return { version: 1, order: [], locations: {} };
    }
    return parsed as ForecastCacheStore;
  } catch {
    return { version: 1, order: [], locations: {} };
  }
}

function saveForecastStore(store: ForecastCacheStore) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(FORECAST_CACHE_KEY, JSON.stringify(store));
  } catch {
    // ignore storage write failures
  }
}

const metadataStore = loadMetadataStore();
const forecastStore = loadForecastStore();

function parseMetadataTime(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseMetadataInterval(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function hashString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function computeSnapshotHash(hourly: HourlyForecast[], daily: DailyForecast[]): string | undefined {
  try {
    return hashString(JSON.stringify({ hourly, daily }));
  } catch {
    return undefined;
  }
}

function buildSnapshotId(
  modelId: string,
  locationKey: string,
  snapshotTime: number,
  snapshotHash?: string
): string {
  const base = `${modelId}:${locationKey}:${snapshotTime}`;
  return snapshotHash ? `${base}:${snapshotHash}` : base;
}

function getLocationKey(latitude: number, longitude: number, timezone: string): string {
  return `${latitude.toFixed(4)}|${longitude.toFixed(4)}|${timezone}`;
}

function hydrateCachedForecast(model: WeatherModel, cached: CachedModelForecast): ModelForecast {
  return {
    model,
    hourly: cached.hourly,
    daily: cached.daily,
    fetchedAt: new Date(cached.fetchedAt),
    snapshotTime: cached.snapshotTime,
    lastForecastFetchTime: cached.lastForecastFetchTime,
    lastSeenRunAvailabilityTime: cached.lastSeenRunAvailabilityTime ?? null,
    lastForecastSnapshotId: cached.lastForecastSnapshotId,
    snapshotHash: cached.snapshotHash,
    etag: cached.etag,
    runInitialisationTime: cached.runInitialisationTime,
    runAvailabilityTime: cached.runAvailabilityTime,
    updateIntervalSeconds: cached.updateIntervalSeconds,
    metadataFetchedAt: cached.metadataFetchedAt
  };
}

function recordForecastCache(
  locationKey: string,
  modelId: string,
  forecast: ModelForecast,
  maxCachedLocations: number
) {
  if (!forecast.hourly.length || forecast.error) return;
  const snapshotTime = forecast.snapshotTime ?? forecast.fetchedAt.getTime();
  const snapshotHash = forecast.snapshotHash ?? computeSnapshotHash(forecast.hourly, forecast.daily);
  const snapshotId = forecast.lastForecastSnapshotId
    ?? buildSnapshotId(modelId, locationKey, snapshotTime, snapshotHash);
  const entry: CachedModelForecast = {
    hourly: forecast.hourly,
    daily: forecast.daily,
    fetchedAt: forecast.fetchedAt.getTime(),
    snapshotTime,
    lastForecastFetchTime: forecast.lastForecastFetchTime ?? forecast.fetchedAt.getTime(),
    lastSeenRunAvailabilityTime: forecast.lastSeenRunAvailabilityTime ?? forecast.runAvailabilityTime ?? null,
    lastForecastSnapshotId: snapshotId,
    snapshotHash,
    etag: forecast.etag,
    runInitialisationTime: forecast.runInitialisationTime,
    runAvailabilityTime: forecast.runAvailabilityTime,
    updateIntervalSeconds: forecast.updateIntervalSeconds,
    metadataFetchedAt: forecast.metadataFetchedAt
  };
  if (!forecastStore.locations[locationKey]) {
    forecastStore.locations[locationKey] = { updatedAt: Date.now(), models: {} };
  }
  forecastStore.locations[locationKey].updatedAt = Date.now();
  forecastStore.locations[locationKey].models[modelId] = entry;

  const existingIndex = forecastStore.order.indexOf(locationKey);
  if (existingIndex >= 0) {
    forecastStore.order.splice(existingIndex, 1);
  }
  forecastStore.order.unshift(locationKey);

  const maxLocations = Math.max(1, maxCachedLocations);
  while (forecastStore.order.length > maxLocations) {
    const removed = forecastStore.order.pop();
    if (removed) {
      delete forecastStore.locations[removed];
    }
  }

  saveForecastStore(forecastStore);
}

function getLastSeenRunAvailability(forecast: ModelForecast | null): number | null {
  if (!forecast) return null;
  const candidate = Number.isFinite(forecast.lastSeenRunAvailabilityTime ?? NaN)
    ? (forecast.lastSeenRunAvailabilityTime as number)
    : forecast.runAvailabilityTime;
  return Number.isFinite(candidate ?? NaN) ? (candidate as number) : null;
}

function getCachedForecastForModel(locationKey: string, modelId: string): ModelForecast | null {
  const locationCache = forecastStore.locations[locationKey];
  const cached = locationCache?.models?.[modelId];
  if (!cached) return null;
  const model = WEATHER_MODELS.find((candidate) => candidate.id === modelId);
  if (!model) return null;
  return hydrateCachedForecast(model, cached);
}

export function getCachedForecasts(
  latitude: number,
  longitude: number,
  timezone: string = 'America/Toronto'
): ModelForecast[] {
  const locationKey = getLocationKey(latitude, longitude, timezone);
  return WEATHER_MODELS.map((model) => getCachedForecastForModel(locationKey, model.id))
    .filter((forecast): forecast is ModelForecast => Boolean(forecast));
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function getMetadataEntry(modelId: string): ModelMetadataCacheEntry {
  if (!metadataStore.models[modelId]) {
    metadataStore.models[modelId] = {};
  }
  return metadataStore.models[modelId];
}

function shouldFetchMetadata(
  modelId: string,
  nowMs: number,
  minIntervalSeconds: number,
  force?: boolean
): boolean {
  if (force) return true;
  const entry = metadataStore.models[modelId];
  if (!entry?.lastMetadataCheckAt) return true;
  const baselineSeconds = entry.updateIntervalSeconds ?? DEFAULT_UPDATE_INTERVAL_SECONDS;
  const intervalSeconds = Math.max(minIntervalSeconds, baselineSeconds);
  return nowMs - entry.lastMetadataCheckAt >= intervalSeconds * 1000;
}

async function fetchModelMetadata(
  model: WeatherModel,
  options?: { force?: boolean; minIntervalSeconds?: number; nowMs?: number }
): Promise<ModelMetadata | null> {
  if (!model.metadataId) return null;
  const nowMs = options?.nowMs ?? Date.now();
  const minIntervalSeconds = options?.minIntervalSeconds ?? MIN_METADATA_INTERVAL_SECONDS;
  const memoryCached = metadataMemoryCache.get(model.id);
  if (memoryCached && nowMs - memoryCached.fetchedAt < METADATA_MEMORY_TTL_MS) {
    return memoryCached.metadata;
  }

  const cached = metadataStore.models[model.id];
  if (cached?.metadataFetchedAt && nowMs - cached.metadataFetchedAt < METADATA_MEMORY_TTL_MS) {
    const metadata = {
      runInitialisationTime: cached.runInitialisationTime,
      runAvailabilityTime: cached.runAvailabilityTime,
      updateIntervalSeconds: cached.updateIntervalSeconds,
      metadataFetchedAt: cached.metadataFetchedAt
    };
    metadataMemoryCache.set(model.id, { metadata, fetchedAt: cached.metadataFetchedAt });
    return metadata;
  }

  if (!shouldFetchMetadata(model.id, nowMs, minIntervalSeconds, options?.force)) {
    if (cached?.metadataFetchedAt) {
      return {
        runInitialisationTime: cached.runInitialisationTime,
        runAvailabilityTime: cached.runAvailabilityTime,
        updateIntervalSeconds: cached.updateIntervalSeconds,
        metadataFetchedAt: cached.metadataFetchedAt
      };
    }
  }

  const existing = metadataRequests.get(model.id);
  if (existing) return existing;

  const request = (async () => {
    const entry = getMetadataEntry(model.id);
    entry.lastMetadataCheckAt = nowMs;
    saveMetadataStore(metadataStore);

    try {
      gatingStats.metadataChecks += 1;
      const response = await fetchWithTimeout(
        `https://api.open-meteo.com/data/${model.metadataId}/static/meta.json`,
        4000
      );

      if (!response.ok) {
        throw new Error(`Metadata HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const metadata: ModelMetadata = {
        runInitialisationTime: parseMetadataTime(data?.last_run_initialisation_time),
        runAvailabilityTime: parseMetadataTime(data?.last_run_availability_time),
        updateIntervalSeconds: parseMetadataInterval(data?.update_interval_seconds),
        metadataFetchedAt: nowMs
      };

      metadataStore.models[model.id] = {
        ...entry,
        runInitialisationTime: metadata.runInitialisationTime,
        runAvailabilityTime: metadata.runAvailabilityTime,
        updateIntervalSeconds: metadata.updateIntervalSeconds,
        metadataFetchedAt: metadata.metadataFetchedAt,
        lastMetadataCheckAt: nowMs
      };
      saveMetadataStore(metadataStore);
      metadataMemoryCache.set(model.id, { metadata, fetchedAt: nowMs });
      return metadata;
    } catch (error) {
      console.warn(`Metadata fetch failed for ${model.name}:`, error);
      metadataMemoryCache.set(model.id, { metadata: null, fetchedAt: nowMs });
      return null;
    } finally {
      metadataRequests.delete(model.id);
    }
  })();

  metadataRequests.set(model.id, request);
  return request;
}

export function computePendingRetryAt(
  availabilityTimeSeconds: number,
  delayMinutes: number,
  nowMs: number
): { pendingUntil: number; retryAt: number } {
  const delayMs = delayMinutes * 60 * 1000;
  const pendingUntil = availabilityTimeSeconds * 1000 + delayMs;
  const jitter = Math.floor(Math.random() * DEFAULT_PENDING_JITTER_SECONDS * 1000);
  const retryAt = Math.max(pendingUntil, nowMs) + jitter;
  return { pendingUntil, retryAt };
}

export function decideForecastFetch(params: {
  metadata: ModelMetadata | null;
  cachedForecast: ModelForecast | null;
  force?: boolean;
  userInitiated?: boolean;
  nowMs: number;
  delayMinutes: number;
  metadataFallbackTtlHours: number;
}): { action: 'fetch' | 'skip' | 'pending'; pending?: { retryAt: number; availableAt: number } } {
  const { metadata, cachedForecast, force, userInitiated, nowMs, delayMinutes, metadataFallbackTtlHours } = params;
  if (force) {
    return { action: 'fetch' };
  }

  const hasCached = Boolean(cachedForecast?.hourly?.length);
  const metadataAvailable = Number.isFinite(metadata?.runAvailabilityTime ?? NaN);
  const cacheAgeHours = cachedForecast
    ? Math.max(0, (nowMs - cachedForecast.fetchedAt.getTime()) / 3600_000)
    : null;
  const fallbackTtlHours = Math.max(1, metadataFallbackTtlHours);

  if (!metadataAvailable) {
    if (!hasCached) return { action: 'fetch' };
    if (cacheAgeHours !== null && cacheAgeHours >= fallbackTtlHours) {
      return { action: 'fetch' };
    }
    return { action: 'skip' };
  }

  if (!hasCached) {
    return { action: 'fetch' };
  }

  const availabilityTime = metadata?.runAvailabilityTime as number;
  const lastSeen = Number.isFinite(cachedForecast?.lastSeenRunAvailabilityTime ?? NaN)
    ? (cachedForecast?.lastSeenRunAvailabilityTime as number)
    : cachedForecast?.runAvailabilityTime;
  const hasNewRun = !Number.isFinite(lastSeen ?? NaN) || availabilityTime > (lastSeen as number);

  if (hasNewRun) {
    const { pendingUntil, retryAt } = computePendingRetryAt(
      availabilityTime,
      delayMinutes,
      nowMs
    );
    if (nowMs < pendingUntil) {
      return { action: 'pending', pending: { retryAt, availableAt: availabilityTime } };
    }
    return { action: 'fetch' };
  }

  if (!hasCached) {
    return { action: 'fetch' };
  }

  return { action: 'skip' };
}

function normalizeObservationTime(value: unknown, timeZone?: string): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const parts = parseOpenMeteoDateTime(trimmed);
  return parts ? formatDateTimeKey(parts) : null;
}

export async function fetchObservedHourly(
  latitude: number,
  longitude: number,
  timezone: string = 'America/Toronto'
): Promise<ObservedConditions | null> {
  const nowParts = getZonedNowParts(timezone);
  if (!nowParts) return null;
  const nowKey = formatDateTimeKey({ ...nowParts, minute: 0 });
  if (!nowKey) return null;

  const startParts = addDays(nowParts, -2);
  const start = formatDateKey(startParts);
  const end = formatDateKey(nowParts);

  const params = new URLSearchParams({
    lat: latitude.toString(),
    lon: longitude.toString(),
    start,
    end,
    tz: timezone,
    units: 'metric'
  });

  // Prefer direct RapidAPI calls in dev when a Vite key is available; otherwise use the server proxy.
  const directApiKey = import.meta.env.VITE_METEOSTAT_API_KEY as string | undefined;
  const requestUrl = directApiKey
    ? `https://meteostat.p.rapidapi.com/point/hourly?${params.toString()}`
    : `/api/observations?${params.toString()}`;

  const headers = directApiKey
    ? {
        'x-rapidapi-key': directApiKey,
        'x-rapidapi-host': 'meteostat.p.rapidapi.com'
      }
    : undefined;

  try {
    const response = await fetchWithTimeout(requestUrl, 5000, { headers });
    if (!response.ok) {
      throw new Error(`Observations HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const rawData = Array.isArray(data?.data) ? data.data : [];
    const hourly: ObservedHourly[] = rawData
      .map((row: any) => {
        let time = normalizeObservationTime(row?.time, timezone);
        if (!time && typeof row?.time === 'string') {
          const normalized = row.time.replace(' ', 'T');
          const parsed = new Date(normalized);
          if (Number.isFinite(parsed.getTime())) {
            const zonedParts = getZonedDateParts(parsed, timezone);
            time = zonedParts ? formatDateTimeKey(zonedParts) : null;
          }
        }
        const rawTemp = row?.temp ?? row?.temperature;
        if (typeof rawTemp !== 'number' || !Number.isFinite(rawTemp)) return null;
        if (!time || time > nowKey) return null;
        const temperature = rawTemp;
        if (temperature < -80 || temperature > 60) return null;
        const rawPrecip = row?.prcp ?? row?.precipitation ?? row?.precip;
        const precipitation = typeof rawPrecip === 'number' && Number.isFinite(rawPrecip) && rawPrecip >= 0 && rawPrecip <= 250
          ? rawPrecip
          : undefined;
        const rawWindDir = row?.wdir ?? row?.wind_direction ?? row?.windDir;
        const windDirection = typeof rawWindDir === 'number' && Number.isFinite(rawWindDir) && rawWindDir >= 0 && rawWindDir <= 360
          ? rawWindDir
          : undefined;
        const rawWindSpeed = row?.wspd ?? row?.wind_speed ?? row?.windSpeed;
        const windSpeed = typeof rawWindSpeed === 'number' && Number.isFinite(rawWindSpeed) && rawWindSpeed >= 0 && rawWindSpeed <= 250
          ? rawWindSpeed
          : undefined;
        const rawWindGust = row?.wpgt ?? row?.wind_gusts ?? row?.windGusts ?? row?.gust;
        const windGusts = typeof rawWindGust === 'number' && Number.isFinite(rawWindGust) && rawWindGust >= 0 && rawWindGust <= 300
          ? rawWindGust
          : undefined;
        return { time, temperature, precipitation, windSpeed, windDirection, windGusts };
      })
      .filter((row: ObservedHourly | null): row is ObservedHourly => Boolean(row));

    return {
      hourly,
      fetchedAt: new Date()
    };
  } catch (error) {
    console.warn('Observations fetch failed:', error);
    return null;
  }
}

// Icon-level normalization: collapse WMO codes that render the same graphics.
const WEATHER_CODE_NORMALIZATION: Record<number, number> = {
  0: 0,
  1: 1,
  2: 2,
  3: 3,
  45: 45,
  48: 45,
  51: 61,
  53: 61,
  55: 61,
  56: 71,
  57: 71,
  61: 61,
  63: 61,
  65: 61,
  66: 71,
  67: 71,
  71: 71,
  73: 71,
  75: 75,
  77: 71,
  80: 80,
  81: 80,
  82: 95,
  85: 71,
  86: 75,
  95: 95,
  96: 95,
  99: 95
};

export function normalizeWeatherCode(code: unknown): number {
  const parsed = typeof code === 'number' ? code : Number(code);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    return NaN;
  }
  return WEATHER_CODE_NORMALIZATION[parsed] ?? parsed;
}

// WMO Weather interpretation codes
export const WEATHER_CODES: Record<number, { description: string; icon: string }> = {
  0: { description: 'Clear sky', icon: '☀️' },
  1: { description: 'Mainly clear', icon: '🌤️' },
  2: { description: 'Partly cloudy', icon: '⛅' },
  3: { description: 'Overcast', icon: '☁️' },
  45: { description: 'Fog', icon: '🌫️' },
  48: { description: 'Depositing rime fog', icon: '🌫️' },
  51: { description: 'Light drizzle', icon: '🌧️' },
  53: { description: 'Moderate drizzle', icon: '🌧️' },
  55: { description: 'Dense drizzle', icon: '🌧️' },
  56: { description: 'Light freezing drizzle', icon: '🌨️' },
  57: { description: 'Dense freezing drizzle', icon: '🌨️' },
  61: { description: 'Rain', icon: '🌧️' },
  63: { description: 'Moderate rain', icon: '🌧️' },
  65: { description: 'Heavy rain', icon: '🌧️' },
  66: { description: 'Light freezing rain', icon: '🌨️' },
  67: { description: 'Heavy freezing rain', icon: '🌨️' },
  71: { description: 'Snow', icon: '🌨️' },
  73: { description: 'Moderate snow', icon: '🌨️' },
  75: { description: 'Heavy snow', icon: '❄️' },
  77: { description: 'Snow grains', icon: '🌨️' },
  80: { description: 'Rain showers', icon: '🌦️' },
  81: { description: 'Moderate rain showers', icon: '🌦️' },
  82: { description: 'Violent rain showers', icon: '⛈️' },
  85: { description: 'Slight snow showers', icon: '🌨️' },
  86: { description: 'Heavy snow showers', icon: '❄️' },
  95: { description: 'Thunderstorm', icon: '⛈️' },
  96: { description: 'Thunderstorm with slight hail', icon: '⛈️' },
  99: { description: 'Thunderstorm with heavy hail', icon: '⛈️' }
};

// Fetch forecast from a single model
async function fetchModelForecast(
  model: WeatherModel,
  latitude: number,
  longitude: number,
  timezone: string = 'America/Toronto',
  metadata?: ModelMetadata | null
): Promise<ModelForecast> {
  const params = new URLSearchParams({
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    timezone,
    forecast_days: '7',
    hourly: [
      'temperature_2m',
      'precipitation',
      'precipitation_probability',
      'wind_speed_10m',
      'wind_direction_10m',
      'wind_gusts_10m',
      'cloud_cover',
      'relative_humidity_2m',
      'pressure_msl',
      'weather_code'
    ].join(','),
    daily: [
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_sum',
      'precipitation_probability_max',
      'wind_speed_10m_max',
      'wind_gusts_10m_max',
      'weather_code',
      'sunrise',
      'sunset'
    ].join(',')
  });

  try {
    const response = await fetch(`${model.endpoint}?${params}`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const fetchedAt = new Date();
    const etag = response.headers.get('etag') ?? undefined;
    const data = await response.json();

    // Parse hourly data
    const hourly: HourlyForecast[] = data.hourly.time.map((time: string, i: number) => ({
      time,
      temperature: data.hourly.temperature_2m[i],
      precipitation: data.hourly.precipitation[i] ?? 0,
      precipitationProbability: data.hourly.precipitation_probability?.[i] ?? 0,
      windSpeed: data.hourly.wind_speed_10m[i],
      windDirection: data.hourly.wind_direction_10m[i],
      windGusts: data.hourly.wind_gusts_10m[i],
      cloudCover: data.hourly.cloud_cover[i],
      humidity: data.hourly.relative_humidity_2m[i],
      pressure: data.hourly.pressure_msl[i],
      weatherCode: normalizeWeatherCode(data.hourly.weather_code[i])
    }));

    // Parse daily data
    const daily: DailyForecast[] = data.daily.time.map((date: string, i: number) => ({
      date,
      temperatureMax: data.daily.temperature_2m_max[i],
      temperatureMin: data.daily.temperature_2m_min[i],
      precipitationSum: data.daily.precipitation_sum[i] ?? 0,
      precipitationProbabilityMax: data.daily.precipitation_probability_max?.[i] ?? 0,
      windSpeedMax: data.daily.wind_speed_10m_max[i],
      windGustsMax: data.daily.wind_gusts_10m_max[i],
      weatherCode: normalizeWeatherCode(data.daily.weather_code[i]),
      sunrise: data.daily.sunrise[i],
      sunset: data.daily.sunset[i]
    }));

    return {
      model,
      hourly,
      daily,
      fetchedAt,
      snapshotTime: fetchedAt.getTime(),
      lastForecastFetchTime: fetchedAt.getTime(),
      lastSeenRunAvailabilityTime: metadata?.runAvailabilityTime ?? null,
      etag,
      runInitialisationTime: metadata?.runInitialisationTime,
      runAvailabilityTime: metadata?.runAvailabilityTime,
      updateIntervalSeconds: metadata?.updateIntervalSeconds,
      metadataFetchedAt: metadata?.metadataFetchedAt
    };
  } catch (error) {
    const fetchedAt = new Date();
    return {
      model,
      hourly: [],
      daily: [],
      fetchedAt,
      snapshotTime: fetchedAt.getTime(),
      lastForecastFetchTime: fetchedAt.getTime(),
      lastSeenRunAvailabilityTime: metadata?.runAvailabilityTime ?? null,
      runInitialisationTime: metadata?.runInitialisationTime,
      runAvailabilityTime: metadata?.runAvailabilityTime,
      updateIntervalSeconds: metadata?.updateIntervalSeconds,
      metadataFetchedAt: metadata?.metadataFetchedAt,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Fetch forecasts from all models
export async function fetchAllForecasts(
  latitude: number,
  longitude: number,
  timezone: string = 'America/Toronto'
): Promise<ModelForecast[]> {
  const forecastPromises = WEATHER_MODELS.map(model =>
    fetchModelForecast(model, latitude, longitude, timezone)
  );

  return Promise.all(forecastPromises);
}

export async function fetchAllModelMetadata(options?: {
  force?: boolean;
  minIntervalSeconds?: number;
  nowMs?: number;
}): Promise<Array<ModelMetadata | null>> {
  const metadataPromises = WEATHER_MODELS.map(model =>
    fetchModelMetadata(model, options)
  );
  return Promise.all(metadataPromises);
}

export function applyMetadataToForecasts(
  forecasts: ModelForecast[],
  metadataList: Array<ModelMetadata | null>
): ModelForecast[] {
  return forecasts.map((forecast, index) => {
    const metadata = metadataList[index];
    if (!metadata) return forecast;

    return {
      ...forecast,
      runInitialisationTime: metadata.runInitialisationTime,
      runAvailabilityTime: metadata.runAvailabilityTime,
      updateIntervalSeconds: metadata.updateIntervalSeconds,
      metadataFetchedAt: metadata.metadataFetchedAt
    };
  });
}

function fetchModelForecastWithDedupe(
  model: WeatherModel,
  locationKey: string,
  latitude: number,
  longitude: number,
  timezone: string,
  metadata?: ModelMetadata | null
) {
  const requestKey = `${locationKey}|${model.id}`;
  const existing = forecastRequests.get(requestKey);
  if (existing) return existing;
  const request = (async () => {
    gatingStats.forecastCalls += 1;
    return fetchModelForecast(model, latitude, longitude, timezone, metadata);
  })();
  forecastRequests.set(requestKey, request);
  request.finally(() => {
    forecastRequests.delete(requestKey);
  });
  return request;
}

export function getGatingStats() {
  return { ...gatingStats };
}

export function resetGatingStats() {
  gatingStats.metadataChecks = 0;
  gatingStats.forecastCalls = 0;
  gatingStats.forecastCallsSkipped = 0;
  gatingStats.pendingDelayModels = 0;
}

export function resetForecastCachesForTests() {
  metadataRequests.clear();
  forecastRequests.clear();
  metadataMemoryCache.clear();
  metadataStore.models = {};
  forecastStore.order = [];
  forecastStore.locations = {};
  saveMetadataStore(metadataStore);
  saveForecastStore(forecastStore);
}

function buildCompleteness(params: {
  forecasts: ModelForecast[];
  metadataById: Map<string, ModelMetadata | null>;
  fetchedById: Map<string, ModelForecast>;
  pending: PendingModelUpdate[];
  nowMs: number;
}): DataCompleteness {
  const { forecasts, metadataById, fetchedById, pending, nowMs } = params;
  const freshestRunAvailability = forecasts.reduce<number | null>((current, forecast) => {
    if (forecast.error || !Number.isFinite(forecast.runAvailabilityTime ?? NaN)) return current;
    const value = forecast.runAvailabilityTime as number;
    if (current === null || value > current) return value;
    return current;
  }, null);

  const pendingIds = new Set(pending.map((item) => item.modelId));
  const byModel: Record<string, ModelCompleteness> = {};
  let countModelsFresh = 0;
  let countModelsStale = 0;
  let countModelsUnknown = 0;
  let countModelsFailed = 0;
  const staleThresholdHours = getNumericEnv(
    import.meta.env.VITE_FRESHNESS_SPREAD_THRESHOLD_HOURS,
    6
  );

  forecasts.forEach((forecast) => {
    const modelId = forecast.model.id;
    const hasSnapshot = Boolean(forecast.hourly.length);
    const snapshotTime = forecast.snapshotTime ?? forecast.fetchedAt.getTime();
    const snapshotAgeSeconds = hasSnapshot ? Math.max(0, (nowMs - snapshotTime) / 1000) : null;
    const metadata = metadataById.get(modelId) ?? null;
    const hasMetadata = Number.isFinite(metadata?.runAvailabilityTime ?? NaN);
    const runAgeKnown = Number.isFinite(forecast.runAvailabilityTime ?? NaN);
    const updatedThisRefresh = Boolean(fetchedById.get(modelId) && !fetchedById.get(modelId)?.error);
    const isFailed = Boolean(forecast.error || forecast.updateError);
    const isPending = pendingIds.has(modelId);

    let isStale = false;
    if (runAgeKnown && Number.isFinite(freshestRunAvailability ?? NaN)) {
      const deltaHours = Math.max(
        0,
        ((freshestRunAvailability as number) - (forecast.runAvailabilityTime as number)) / 3600
      );
      isStale = deltaHours > staleThresholdHours;
    }

    if (isFailed) {
      countModelsFailed += 1;
    } else if (!runAgeKnown) {
      countModelsUnknown += 1;
    } else if (isStale) {
      countModelsStale += 1;
    } else {
      countModelsFresh += 1;
    }

    byModel[modelId] = {
      modelId,
      hasSnapshot,
      snapshotAgeSeconds,
      hasMetadata,
      runAgeKnown,
      updatedThisRefresh,
      isPending,
      isFailed
    };
  });

  return {
    byModel,
    countModelsFresh,
    countModelsStale,
    countModelsUnknown,
    countModelsFailed
  };
}

export async function fetchForecastsWithMetadata(
  latitude: number,
  longitude: number,
  timezone: string = 'America/Toronto',
  options: ForecastFetchOptions = {}
): Promise<ForecastFetchResult> {
  const nowMs = options.nowMs ?? Date.now();
  const delayMinutes = options.consistencyDelayMinutes ?? CONFIG_CONSISTENCY_DELAY_MINUTES;
  const minIntervalSeconds = options.minMetadataIntervalSeconds ?? CONFIG_MIN_METADATA_INTERVAL_SECONDS;
  const maxCachedLocations = options.maxCachedLocations ?? CONFIG_MAX_CACHED_LOCATIONS;
  const force = options.force ?? false;
  const userInitiated = options.userInitiated ?? false;
  const locationKey = getLocationKey(latitude, longitude, timezone);
  const mode: RefreshSummary['mode'] = force ? 'force' : userInitiated ? 'manual' : 'auto';

  const cachedForecasts = new Map(
    WEATHER_MODELS.map((model) => [
      model.id,
      getCachedForecastForModel(locationKey, model.id)
    ])
  );
  const usedCache = Array.from(cachedForecasts.values()).some((forecast) => Boolean(forecast?.hourly?.length));
  const isOffline = options.offline ?? (typeof navigator !== 'undefined' && !navigator.onLine);

  if (isOffline) {
    const metadataById = new Map(WEATHER_MODELS.map((model) => [model.id, null]));
    const forecasts = WEATHER_MODELS.map((model) => {
      const cached = cachedForecasts.get(model.id) ?? null;
      if (cached) return cached;
      return {
        model,
        hourly: [],
        daily: [],
        fetchedAt: new Date(nowMs),
        error: 'Offline'
      };
    });
    const completeness = buildCompleteness({
      forecasts,
      metadataById,
      fetchedById: new Map(),
      pending: [],
      nowMs
    });
    return {
      forecasts,
      pending: [],
      usedCache,
      refreshSummary: { mode, noNewRuns: false, offline: true },
      completeness
    };
  }

  const metadataList = await fetchAllModelMetadata({
    force: userInitiated || force,
    minIntervalSeconds,
    nowMs
  });
  const metadataById = new Map(
    WEATHER_MODELS.map((model, index) => [model.id, metadataList[index]])
  );

  const pending: PendingModelUpdate[] = [];
  const fetchQueue: Array<Promise<ModelForecast>> = [];
  const fetchModels: string[] = [];
  let anyMetadataAvailable = false;
  let anyNewRunAvailable = false;
  let latestRunAvailabilityTime: number | undefined;

  WEATHER_MODELS.forEach((model) => {
    const metadata = metadataById.get(model.id) ?? null;
    const cached = cachedForecasts.get(model.id) ?? null;
    const metadataRun = Number.isFinite(metadata?.runAvailabilityTime ?? NaN)
      ? (metadata?.runAvailabilityTime as number)
      : null;
    if (metadataRun !== null) {
      anyMetadataAvailable = true;
      if (!Number.isFinite(latestRunAvailabilityTime ?? NaN) || metadataRun > (latestRunAvailabilityTime as number)) {
        latestRunAvailabilityTime = metadataRun;
      }
    }
    if (metadataRun !== null) {
      const lastSeen = getLastSeenRunAvailability(cached);
      const hasNewRun = lastSeen === null || metadataRun > lastSeen;
      if (hasNewRun) {
        anyNewRunAvailable = true;
      }
    }
    const decision = decideForecastFetch({
      metadata,
      cachedForecast: cached,
      force,
      userInitiated,
      nowMs,
      delayMinutes,
      metadataFallbackTtlHours: options.metadataFallbackTtlHours ?? CONFIG_METADATA_FALLBACK_TTL_HOURS
    });

    if (decision.action === 'fetch') {
      fetchModels.push(model.id);
      fetchQueue.push(
        fetchModelForecastWithDedupe(
          model,
          locationKey,
          latitude,
          longitude,
          timezone,
          metadata
        )
      );
      return;
    }

    if (decision.action === 'pending' && decision.pending) {
      pending.push({
        modelId: model.id,
        availableAt: decision.pending.availableAt,
        retryAt: decision.pending.retryAt
      });
    }

    if (metadata && cached) {
      cached.updateIntervalSeconds = cached.updateIntervalSeconds ?? metadata.updateIntervalSeconds;
      cached.metadataFetchedAt = metadata.metadataFetchedAt ?? cached.metadataFetchedAt;
    }

    if (decision.action === 'skip') {
      gatingStats.forecastCallsSkipped += 1;
    }
  });

  if (pending.length > 0) {
    gatingStats.pendingDelayModels = pending.length;
  } else {
    gatingStats.pendingDelayModels = 0;
  }

  const fetchedForecasts = fetchQueue.length > 0 ? await Promise.all(fetchQueue) : [];
  const fetchedById = new Map<string, ModelForecast>();
  fetchedForecasts.forEach((forecast, index) => {
    const modelId = fetchModels[index];
    fetchedById.set(modelId, forecast);
  });

  const forecasts: ModelForecast[] = WEATHER_MODELS.map((model) => {
    const metadata = metadataById.get(model.id) ?? null;
    const cached = cachedForecasts.get(model.id) ?? null;
    const fetched = fetchedById.get(model.id);
    const pendingUpdate = pending.find((item) => item.modelId === model.id);

    if (fetched) {
      if (!fetched.error) {
        const fetchedRunAvailability = Number.isFinite(fetched.runAvailabilityTime ?? NaN)
          ? (fetched.runAvailabilityTime as number)
          : Number.isFinite(metadata?.runAvailabilityTime ?? NaN)
            ? (metadata?.runAvailabilityTime as number)
            : null;
        fetched.lastSeenRunAvailabilityTime = fetchedRunAvailability;
        recordForecastCache(locationKey, model.id, fetched, maxCachedLocations);
        return fetched;
      }
      if (cached) {
        return {
          ...cached,
          updateError: fetched.error,
          updateIntervalSeconds: cached.updateIntervalSeconds ?? metadata?.updateIntervalSeconds,
          metadataFetchedAt: cached.metadataFetchedAt ?? metadata?.metadataFetchedAt
        };
      }
      return fetched;
    }

    if (cached) {
      const updatedForecast: ModelForecast = {
        ...cached,
        updateIntervalSeconds: cached.updateIntervalSeconds ?? metadata?.updateIntervalSeconds,
        metadataFetchedAt: cached.metadataFetchedAt ?? metadata?.metadataFetchedAt
      };
      if (pendingUpdate) {
        updatedForecast.pendingAvailabilityTime = pendingUpdate.availableAt;
      }
      return updatedForecast;
    }

    return {
      model,
      hourly: [],
      daily: [],
      fetchedAt: new Date(nowMs),
      runInitialisationTime: metadata?.runInitialisationTime,
      runAvailabilityTime: metadata?.runAvailabilityTime,
      updateIntervalSeconds: metadata?.updateIntervalSeconds,
      metadataFetchedAt: metadata?.metadataFetchedAt,
      error: 'No cached data available'
    };
  });

  logDebug('Forecast gating summary', {
    pendingModels: pending.length,
    fetchedModels: fetchModels.length,
    skippedModels: WEATHER_MODELS.length - fetchModels.length,
    force,
    userInitiated
  });

  const noNewRuns = Boolean(
    userInitiated
    && !force
    && fetchModels.length === 0
    && pending.length === 0
    && anyMetadataAvailable
    && !anyNewRunAvailable
  );
  const refreshSummary: RefreshSummary = {
    mode,
    noNewRuns,
    latestRunAvailabilityTime
  };
  const completeness = buildCompleteness({
    forecasts,
    metadataById,
    fetchedById,
    pending,
    nowMs
  });

  return { forecasts, pending, usedCache, refreshSummary, completeness };
}

export async function getMeta(
  modelId: string,
  options?: { force?: boolean; minIntervalSeconds?: number; nowMs?: number }
): Promise<ModelMetadata | null> {
  const model = WEATHER_MODELS.find((candidate) => candidate.id === modelId);
  if (!model) return null;
  return fetchModelMetadata(model, options);
}

export function shouldFetchForecast(params: {
  modelId: string;
  location: Pick<Location, 'latitude' | 'longitude' | 'timezone'>;
  metadata: ModelMetadata | null;
  force?: boolean;
  userInitiated?: boolean;
  nowMs?: number;
  delayMinutes?: number;
  metadataFallbackTtlHours?: number;
}): { action: 'fetch' | 'skip' | 'pending'; pending?: { retryAt: number; availableAt: number } } {
  const {
    modelId,
    location,
    metadata,
    force,
    userInitiated,
    nowMs,
    delayMinutes,
    metadataFallbackTtlHours
  } = params;
  const locationKey = getLocationKey(location.latitude, location.longitude, location.timezone);
  const cachedForecast = getCachedForecastForModel(locationKey, modelId);
  return decideForecastFetch({
    metadata,
    cachedForecast,
    force,
    userInitiated,
    nowMs: nowMs ?? Date.now(),
    delayMinutes: delayMinutes ?? CONFIG_CONSISTENCY_DELAY_MINUTES,
    metadataFallbackTtlHours: metadataFallbackTtlHours ?? CONFIG_METADATA_FALLBACK_TTL_HOURS
  });
}

export async function fetchForecast(
  modelId: string,
  location: Pick<Location, 'latitude' | 'longitude' | 'timezone'>,
  metadata?: ModelMetadata | null
): Promise<ModelForecast | null> {
  const model = WEATHER_MODELS.find((candidate) => candidate.id === modelId);
  if (!model) return null;
  const locationKey = getLocationKey(location.latitude, location.longitude, location.timezone);
  return fetchModelForecastWithDedupe(
    model,
    locationKey,
    location.latitude,
    location.longitude,
    location.timezone,
    metadata
  );
}

export function persistSnapshot(params: {
  modelId: string;
  location: Pick<Location, 'latitude' | 'longitude' | 'timezone'>;
  forecast: ModelForecast;
  maxCachedLocations?: number;
}) {
  const { modelId, location, forecast, maxCachedLocations } = params;
  const locationKey = getLocationKey(location.latitude, location.longitude, location.timezone);
  recordForecastCache(
    locationKey,
    modelId,
    forecast,
    maxCachedLocations ?? CONFIG_MAX_CACHED_LOCATIONS
  );
}

export async function refreshLocation(
  location: Location,
  mode: RefreshSummary['mode'],
  options: Omit<ForecastFetchOptions, 'force' | 'userInitiated'> = {}
): Promise<ForecastFetchResult> {
  return fetchForecastsWithMetadata(
    location.latitude,
    location.longitude,
    location.timezone,
    {
      ...options,
      force: mode === 'force',
      userInitiated: mode !== 'auto'
    }
  );
}

// Canadian cities for quick selection
export const CANADIAN_CITIES: Location[] = [
  { name: 'Toronto', latitude: 43.6532, longitude: -79.3832, country: 'Canada', province: 'Ontario', timezone: 'America/Toronto' },
  { name: 'Vancouver', latitude: 49.2827, longitude: -123.1207, country: 'Canada', province: 'British Columbia', timezone: 'America/Vancouver' },
  { name: 'Montreal', latitude: 45.5017, longitude: -73.5673, country: 'Canada', province: 'Quebec', timezone: 'America/Toronto' },
  { name: 'Calgary', latitude: 51.0447, longitude: -114.0719, country: 'Canada', province: 'Alberta', timezone: 'America/Edmonton' },
  { name: 'Edmonton', latitude: 53.5461, longitude: -113.4938, country: 'Canada', province: 'Alberta', timezone: 'America/Edmonton' },
  { name: 'Ottawa', latitude: 45.4215, longitude: -75.6972, country: 'Canada', province: 'Ontario', timezone: 'America/Toronto' },
  { name: 'Winnipeg', latitude: 49.8951, longitude: -97.1384, country: 'Canada', province: 'Manitoba', timezone: 'America/Winnipeg' },
  { name: 'Quebec City', latitude: 46.8139, longitude: -71.2080, country: 'Canada', province: 'Quebec', timezone: 'America/Toronto' },
  { name: 'Halifax', latitude: 44.6488, longitude: -63.5752, country: 'Canada', province: 'Nova Scotia', timezone: 'America/Halifax' },
  { name: 'Victoria', latitude: 48.4284, longitude: -123.3656, country: 'Canada', province: 'British Columbia', timezone: 'America/Vancouver' },
  { name: 'Saskatoon', latitude: 52.1579, longitude: -106.6702, country: 'Canada', province: 'Saskatchewan', timezone: 'America/Regina' },
  { name: 'Regina', latitude: 50.4452, longitude: -104.6189, country: 'Canada', province: 'Saskatchewan', timezone: 'America/Regina' },
  { name: 'St. John\'s', latitude: 47.5615, longitude: -52.7126, country: 'Canada', province: 'Newfoundland', timezone: 'America/St_Johns' },
  { name: 'Yellowknife', latitude: 62.4540, longitude: -114.3718, country: 'Canada', province: 'Northwest Territories', timezone: 'America/Yellowknife' },
  { name: 'Whitehorse', latitude: 60.7212, longitude: -135.0568, country: 'Canada', province: 'Yukon', timezone: 'America/Whitehorse' }
];

// Geocoding search using Open-Meteo
export async function searchLocations(query: string): Promise<Location[]> {
  if (!query || query.length < 2) return [];

  try {
    const params = new URLSearchParams({
      name: query,
      count: '10',
      language: 'en',
      format: 'json'
    });

    const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
    const data = await response.json();

    if (!data.results) return [];

    return data.results.map((r: any) => ({
      name: r.name,
      latitude: r.latitude,
      longitude: r.longitude,
      country: r.country,
      province: r.admin1,
      timezone: r.timezone
    }));
  } catch (error) {
    console.error('Geocoding error:', error);
    return [];
  }
}
