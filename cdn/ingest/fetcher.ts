/**
 * Weather Forecast CDN — Ingest Fetcher
 *
 * Fetches raw forecast data from Open-Meteo and observations from ECCC.
 * Minimal transformation: normalize timestamps and variable names only.
 */

import { StationSetArtifact, ObservationArtifact, ForecastArtifact, ArtifactType, CURRENT_SCHEMA_VERSION } from '../types';
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
}

/**
 * Result of fetching observations: separate data and metadata artifacts.
 */
export interface ObservationFetchResult {
    stationSet: StationSetArtifact;
    observation: ObservationArtifact;
}

/**
 * Fetch observations from ECCC via Meteostat proxy.
 * This is a placeholder - in production, use ECCC's XML feed directly.
 * Returns both the station metadata (StationSet) and the data snapshot (Observation).
 */
export async function fetchObservations(
    options: FetchObservationsOptions
): Promise<ObservationFetchResult | null> {
    const { latitude, longitude } = options;
    const now = new Date();

    const fetchedAt = Math.floor(now.getTime() / 1000);

    // 1. Construct Station Set (Metadata)
    const stations = [
        {
            id: 'CYYZ',
            lat: 43.6772,
            lon: -79.6306,
            name: 'Toronto Pearson',
            elevation: 173
        },
        {
            id: 'CXTO',
            lat: 43.6285,
            lon: -79.3960,
            name: 'Toronto City Centre',
            elevation: 77
        }
    ];

    const stationSet: StationSetArtifact = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        type: 'station_set',
        source: 'eccc',
        stations
    };

    // Compute ID for linking (this is deterministic based on content)
    const stationSetId = computeArtifactId(stationSet);

    // 2. Construct Data Snapshot (Observation)
    // Referenced strict numeric rules are enforced by canonical serialization later
    const bucketMinutes = 60;
    const bucketStart = floorToBucketUtc(now, bucketMinutes);

    // In a real implementation, observedAtRaw would come from the source data
    const observedAtRaw = now.toISOString();
    const observedAtBucket = bucketStart.toISOString();

    const observation: ObservationArtifact = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        type: 'observation',
        source: 'eccc',
        observedAtBucket,
        observedAtRaw,
        bucketMinutes,
        fetchedAt,
        stationSetId,
        variables: ['airTempC', 'windSpdKmh', 'windDirDeg'],
        data: {
            // Placeholder: mapped by variable -> stationId using stable keys
            airTempC: {
                'CYYZ': -2.4,
                'CXTO': -1.8
            },
            windSpdKmh: {
                'CYYZ': 12.5,
                'CXTO': 15.0
            },
            windDirDeg: {
                'CYYZ': 310,
                'CXTO': 320
            }
        }
    };

    return { stationSet, observation };
}

// =============================================================================
// Utilities
// =============================================================================


/**
 * Extract run time from Open-Meteo response.
 * Falls back to current hour if not available.
 */
function normalizeRunTime(data: any): string {
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
