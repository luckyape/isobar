/**
 * Weather Forecast CDN — Ingest Fetcher
 *
 * Fetches raw forecast data from Open-Meteo and observations from ECCC (MSC GeoMet).
 * Minimal transformation: normalize timestamps and variable names only.
 */

import { StationSetArtifact, ObservationArtifact, ForecastArtifact, CURRENT_SCHEMA_VERSION } from '../types';
import { floorToBucketUtc } from '../time';
import { computeArtifactId } from '../artifact';

// =============================================================================
// Configuration
// =============================================================================

const MODELS = [
    { id: 'gem_seamless', endpoint: 'https://api.open-meteo.com/v1/gem' },
    { id: 'gfs_seamless', endpoint: 'https://api.open-meteo.com/v1/gfs' }
] as const;

const HOURLY_VARIABLES = [
    'temperature_2m',
    'precipitation',
    'precipitation_probability',
    'wind_speed_10m',
    'wind_direction_10m',
    'wind_gusts_10m',
    'cloud_cover',
    'weather_code'
];

const DAILY_VARIABLES = [
    'temperature_2m_max',
    'temperature_2m_min',
    'precipitation_sum',
    'precipitation_probability_max',
    'wind_speed_10m_max',
    'weather_code'
];

// =============================================================================
// Forecast Fetching
// =============================================================================

export interface FetchForecastOptions {
    latitude: number;
    longitude: number;
    timezone?: string;
    forecastDays?: number;
}

/**
 * Fetch a forecast run from Open-Meteo.
 * Returns a normalized ForecastArtifact.
 */
export async function fetchForecast(
    modelId: string,
    options: FetchForecastOptions
): Promise<ForecastArtifact> {
    const model = MODELS.find((m) => m.id === modelId);
    if (!model) {
        throw new Error(`Unknown model: ${modelId}`);
    }

    const { latitude, longitude, timezone = 'UTC', forecastDays = 7 } = options;

    const params = new URLSearchParams({
        latitude: latitude.toString(),
        longitude: longitude.toString(),
        timezone,
        forecast_days: forecastDays.toString(),
        hourly: HOURLY_VARIABLES.join(','),
        daily: DAILY_VARIABLES.join(',')
    });

    const response = await fetch(`${model.endpoint}?${params}`);
    if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
        hourly: { time: string[];[key: string]: number[] | string[] };
        daily?: { time: string[];[key: string]: number[] | string[] };
    };
    const issuedAt = Math.floor(Date.now() / 1000);

    // Normalize to artifact schema
    const artifact: ForecastArtifact = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        type: 'forecast',
        model: modelId,
        runTime: normalizeRunTime(data),
        issuedAt,
        validTimes: data.hourly.time,
        variables: HOURLY_VARIABLES,
        grid: {
            type: 'point',
            lat: latitude,
            lon: longitude
        },
        data: {},
        source: 'open-meteo',
        sourceUrl: `${model.endpoint}?${params}`,
        variableMap: {
            'temperature_2m': 'airTempC',
            'wind_speed_10m': 'windSpdKmh',
            'wind_direction_10m': 'windDirDeg'
        }
    };

    // Copy hourly data
    for (const variable of HOURLY_VARIABLES) {
        const values = data.hourly[variable];
        if (values && Array.isArray(values) && typeof values[0] === 'number') {
            artifact.data[variable] = values as number[];
        }
    }

    return artifact;
}

/**
 * Fetch forecasts from all configured models.
 */
export async function fetchAllForecasts(
    options: FetchForecastOptions
): Promise<ForecastArtifact[]> {
    const promises = MODELS.map((model) =>
        fetchForecast(model.id, options).catch((error) => {
            console.error(`Failed to fetch ${model.id}:`, error);
            return null;
        })
    );
    const results = await Promise.all(promises);
    return results.filter((r): r is ForecastArtifact => r !== null);
}

// =============================================================================
// Observation Fetching (ECCC)
// =============================================================================

export interface FetchObservationsOptions {
    latitude: number;
    longitude: number;
    radiusKm?: number;
    /**
     * For testing/determinism, override clock.
     * Observations are ingested for the latest COMPLETED hour bucket.
     */
    now?: Date;
}

/**
 * Result of fetching observations: separate data and metadata artifacts.
 */
export interface ObservationFetchResult {
    stationSet: StationSetArtifact;
    observations: ObservationArtifact[];
}

/**
 * Fetch observations via ECCC MSC GeoMet WFS `ec-msc:CURRENT_CONDITIONS`.
 * Returns a StationSet containing the nearest station in the query area and a single hourly Observation.
 */
export async function fetchObservations(
    options: FetchObservationsOptions
): Promise<ObservationFetchResult | null> {
    const { latitude, longitude } = options;
    const radiusKm = Number.isFinite(options.radiusKm ?? NaN) ? Math.max(5, Math.min(250, options.radiusKm as number)) : 80;
    const now = options.now ?? new Date();
    const bucketMinutes = 60;

    const candidates = await fetchEcccCurrentConditionsNear(latitude, longitude, radiusKm);
    if (candidates.length === 0) return null;

    const best = selectNearestCandidate(candidates, latitude, longitude);
    if (!best) return null;

    const observedAtRaw = best.timestamp;
    const observedAtBucket = floorToBucketUtc(observedAtRaw, bucketMinutes).toISOString();
    const bucketStartMs = new Date(observedAtBucket).getTime();

    // Reject obviously future timestamps.
    if (bucketStartMs > now.getTime() + 60_000) return null;

    const stationSet: StationSetArtifact = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        type: 'station_set',
        source: 'eccc',
        stations: [
            {
                id: best.stationId,
                lat: best.lat,
                lon: best.lon,
                name: best.stationName
            }
        ]
    };
    const stationSetId = computeArtifactId(stationSet);

    const valueOrNull = (v: unknown): number | null =>
        typeof v === 'number' && Number.isFinite(v) ? v : null;

    const observation: ObservationArtifact = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        type: 'observation',
        source: 'eccc',
        observedAtBucket,
        observedAtRaw,
        bucketMinutes,
        fetchedAt: Math.floor(bucketStartMs / 1000),
        stationSetId,
        variables: ['airTempC', 'windSpdKmh', 'windGustKph', 'windDirDeg', 'precipMm', 'weatherCode'],
        data: {
            airTempC: { [best.stationId]: valueOrNull(best.tempC) },
            windSpdKmh: { [best.stationId]: valueOrNull(best.windSpeedKph) },
            windGustKph: { [best.stationId]: valueOrNull(best.windGustKph) },
            windDirDeg: { [best.stationId]: valueOrNull(best.windBearingDeg) },
            precipMm: { [best.stationId]: null },
            weatherCode: { [best.stationId]: null }
        }
    };

    return { stationSet, observations: [observation] };
}

// =============================================================================
// Utilities
// =============================================================================


/**
 * Extract run time from Open-Meteo response.
 * Falls back to current hour if not available.
 */
type OpenMeteoHourly = {
    time?: string[];
};

type OpenMeteoData = {
    hourly?: OpenMeteoHourly;
};

function normalizeRunTime(data: OpenMeteoData): string {
    // Open-Meteo doesn't expose model run time directly
    // Use first forecast time as approximation
    if (data.hourly?.time?.[0]) {
        return data.hourly.time[0];
    }
    // Fallback to current hour (floored)
    return floorToBucketUtc(new Date(), 60).toISOString();
}

/**
 * Get configured model IDs.
 */
export function getModelIds(): string[] {
    return MODELS.map((m) => m.id);
}

type EcccCurrentConditionsCandidate = {
    stationId: string;
    stationName: string;
    lat: number;
    lon: number;
    timestamp: string; // ISO with Z
    tempC: number | null;
    windSpeedKph: number | null;
    windGustKph: number | null;
    windBearingDeg: number | null;
};

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function parseNumberOrNull(value: string | null): number | null {
    if (!value) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function getTagText(xml: string, tag: string): string | null {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const m = xml.match(re);
    if (!m) return null;
    const text = m[1].trim();
    return text ? text : null;
}

function extractMembers(xml: string): string[] {
    const members: string[] = [];
    const re = /<wfs:member>([\s\S]*?)<\/wfs:member>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) {
        members.push(m[1]);
    }
    return members;
}

function parseGmlPos(memberXml: string): { lat: number; lon: number } | null {
    const pos = getTagText(memberXml, 'gml:pos');
    if (!pos) return null;
    const parts = pos.split(/\s+/).map((p) => Number(p));
    if (parts.length < 2) return null;
    const [lat, lon] = parts;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
}

function parseEcccCandidate(memberXml: string): EcccCurrentConditionsCandidate | null {
    // Station id from gml:id on the feature element.
    const idMatch = memberXml.match(/gml:id="([^"]+)"/i);
    const stationId = idMatch?.[1]?.trim();
    if (!stationId) return null;

    const pos = parseGmlPos(memberXml);
    if (!pos) return null;

    const stationName =
        getTagText(memberXml, 'ec-msc:station_en') ??
        getTagText(memberXml, 'ec-msc:name') ??
        stationId;

    const timestamp = getTagText(memberXml, 'ec-msc:timestamp');
    if (!timestamp) return null;

    return {
        stationId,
        stationName,
        lat: pos.lat,
        lon: pos.lon,
        timestamp,
        tempC: parseNumberOrNull(getTagText(memberXml, 'ec-msc:temp')),
        windSpeedKph: parseNumberOrNull(getTagText(memberXml, 'ec-msc:speed')),
        windGustKph: parseNumberOrNull(getTagText(memberXml, 'ec-msc:gust')),
        windBearingDeg: parseNumberOrNull(getTagText(memberXml, 'ec-msc:bearing'))
    };
}

async function fetchEcccCurrentConditionsNear(
    latitude: number,
    longitude: number,
    radiusKm: number
): Promise<EcccCurrentConditionsCandidate[]> {
    const latDelta = radiusKm / 111;
    const lonDelta = radiusKm / (111 * Math.max(0.2, Math.cos((latitude * Math.PI) / 180)));

    const latMin = latitude - latDelta;
    const latMax = latitude + latDelta;
    const lonMin = longitude - lonDelta;
    const lonMax = longitude + lonDelta;

    const url = new URL('https://geo.weather.gc.ca/geomet');
    url.searchParams.set('service', 'WFS');
    url.searchParams.set('version', '2.0.0');
    url.searchParams.set('request', 'GetFeature');
    url.searchParams.set('typeName', 'ec-msc:CURRENT_CONDITIONS');
    url.searchParams.set('bbox', `${latMin},${lonMin},${latMax},${lonMax},urn:ogc:def:crs:EPSG:4326`);
    url.searchParams.set('count', '200');

    const response = await fetch(url.toString());
    if (!response.ok) {
        throw new Error(`ECCC GeoMet fetch failed: ${response.status} ${response.statusText}`);
    }

    const xml = await response.text();
    const members = extractMembers(xml);
    const candidates: EcccCurrentConditionsCandidate[] = [];
    for (const member of members) {
        const parsed = parseEcccCandidate(member);
        if (parsed) candidates.push(parsed);
    }
    return candidates;
}

function selectNearestCandidate(
    candidates: EcccCurrentConditionsCandidate[],
    latitude: number,
    longitude: number
): EcccCurrentConditionsCandidate | null {
    let best: EcccCurrentConditionsCandidate | null = null;
    let bestDist = Infinity;
    for (const c of candidates) {
        const d = haversineKm(latitude, longitude, c.lat, c.lon);
        if (d < bestDist) {
            best = c;
            bestDist = d;
        }
    }
    return best;
}
