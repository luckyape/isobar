
import type { ForecastArtifact } from '@cdn/types';

/**
 * Normalized forecast series aligned to validTimes.
 * Keys are canonical (e.g. "airTempC", "precipMm").
 */
export type CanonicalForecastData = Record<string, (number | null)[]>;

/**
 * Normalize a forecast artifact into canonical series.
 * Uses the artifact's variableMap to translate source keys to canonical keys.
 * 
 * @param artifact The forecast artifact to normalize.
 * @returns A map of canonical keys to data arrays. Missing keys are omitted.
 */
export function normalizeForecastToCanonical(artifact: ForecastArtifact): CanonicalForecastData {
    const result: CanonicalForecastData = {};

    if (!artifact.variableMap || !artifact.data) {
        return result;
    }

    for (const [sourceKey, canonicalKey] of Object.entries(artifact.variableMap)) {
        const data = artifact.data[sourceKey];
        if (data) {
            // Check for potential length mismatch? 
            // The type definition says number[], but dealing with potential nulls or mismatched lengths is safe.
            // Artifact schema guarantees alignment to validTimes, but let's be safe.
            // We cast to (number | null)[] because forecast data "should" be numbers, 
            // but if there are gaps or issues, we might want to be permissive or just take it as is.
            // The CDN type says number[], so we assume valid numbers.
            result[canonicalKey] = data;
        }
    }

    return result;
}

// Icon-level normalization: collapse WMO codes that render the same graphics.
export const WEATHER_CODE_NORMALIZATION: Record<number, number> = {
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
    14: 61,
    61: 61,
    63: 61,
    65: 61,
    66: 71,
    67: 71,
    19: 71,
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
export const WEATHER_CODES: Record<number, { description: string }> = {
    0: { description: 'Clear sky' },
    1: { description: 'Mainly clear' },
    2: { description: 'Partly cloudy' },
    3: { description: 'Overcast' },
    45: { description: 'Fog' },
    48: { description: 'Depositing rime fog' },
    51: { description: 'Light drizzle' },
    53: { description: 'Moderate drizzle' },
    55: { description: 'Dense drizzle' },
    56: { description: 'Light freezing drizzle' },
    57: { description: 'Dense freezing drizzle' },
    61: { description: 'Rain' },
    63: { description: 'Moderate rain' },
    65: { description: 'Heavy rain' },
    66: { description: 'Light freezing rain' },
    67: { description: 'Heavy freezing rain' },
    71: { description: 'Snow' },
    73: { description: 'Moderate snow' },
    75: { description: 'Heavy snow' },
    77: { description: 'Snow grains' },
    80: { description: 'Rain showers' },
    81: { description: 'Moderate rain showers' },
    82: { description: 'Violent rain showers' },
    85: { description: 'Slight snow showers' },
    86: { description: 'Heavy snow showers' },
    95: { description: 'Thunderstorm' },
    96: { description: 'Thunderstorm with slight hail' },
    99: { description: 'Thunderstorm with heavy hail' }
};
