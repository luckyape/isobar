/**
 * Weather Forecast CDN — Location Scoping
 *
 * Provides a stable location identifier to namespace manifests by location.
 * Chunks remain global/content-addressed; only manifests + root pointers are scoped.
 */

import { canonicalMsgPack } from './canonical';
import { hashHex } from './hash';

export const LOCATION_SCOPE_VERSION = 1;
export const DEFAULT_LOCATION_DECIMALS = 4;

export const LOC_KEY_VERSION = 1;
export const LOC_KEY_DECIMALS = 4;

export interface LocationScopeInput {
    latitude: number;
    longitude: number;
    /** Optional IANA tz string; used only for scoping manifests. */
    timezone?: string;
    /**
     * Decimal places used to normalize lat/lon before hashing.
     * Defaults to 4 (~11m). Use a lower value to coarsen scope keys.
     */
    decimals?: number;
}

export interface NormalizedLocationScope {
    latitude: number;
    longitude: number;
    timezone: string;
    decimals: number;
    version: number;
}

function normalizeFixed(value: number, decimals: number): number {
    // Avoid float representation noise by rounding to a fixed number of decimals.
    return Number(value.toFixed(decimals));
}

export function normalizeLocationScope(input: LocationScopeInput): NormalizedLocationScope {
    const decimals = Number.isFinite(input.decimals ?? NaN)
        ? Math.max(0, Math.min(8, Math.trunc(input.decimals as number)))
        : DEFAULT_LOCATION_DECIMALS;

    if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) {
        throw new Error('Invalid location: latitude/longitude must be finite numbers');
    }
    if (input.latitude < -90 || input.latitude > 90) {
        throw new Error('Invalid location: latitude out of range');
    }
    if (input.longitude < -180 || input.longitude > 180) {
        throw new Error('Invalid location: longitude out of range');
    }

    return {
        version: LOCATION_SCOPE_VERSION,
        latitude: normalizeFixed(input.latitude, decimals),
        longitude: normalizeFixed(input.longitude, decimals),
        timezone: (input.timezone ?? 'UTC').trim() || 'UTC',
        decimals
    };
}

/**
 * Compute a stable 32-byte (64-hex) location scope id.
 *
 * This id is used ONLY for manifest scoping (path namespace), not security.
 */
export function computeLocationScopeId(input: LocationScopeInput): string {
    const normalized = normalizeLocationScope(input);
    const bytes = canonicalMsgPack(normalized);
    return hashHex(bytes);
}

export function isValidLocationScopeId(value: string): boolean {
    return /^[a-f0-9]{64}$/i.test(value);
}

function formatLocCoord(value: number): string {
    const formatted = value.toFixed(LOC_KEY_DECIMALS);
    return formatted === '-0.0000' ? '0.0000' : formatted;
}

/**
 * Location key used by clients and manifests for location association.
 *
 * Format: "v1:<lat>,<lon>" (exactly 4 decimals, -0.0000 normalized to 0.0000).
 */
export function makeLocKey(latitude: number, longitude: number): string {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error('Invalid loc_key: latitude/longitude must be finite numbers');
    }
    if (latitude < -90 || latitude > 90) {
        throw new Error('Invalid loc_key: latitude out of range');
    }
    if (longitude < -180 || longitude > 180) {
        throw new Error('Invalid loc_key: longitude out of range');
    }

    // Round to fixed resolution first, then stringify for canonical form.
    const roundedLat = Number(latitude.toFixed(LOC_KEY_DECIMALS));
    const roundedLon = Number(longitude.toFixed(LOC_KEY_DECIMALS));

    return `v${LOC_KEY_VERSION}:${formatLocCoord(roundedLat)},${formatLocCoord(roundedLon)}`;
}

/**
 * Validate and canonicalize a `loc_key` string.
 *
 * Hard rules:
 * - Must be versioned: "v1:"
 * - Must be canonical already (exactly 4 decimals), except "-0.0000" which is normalized to "0.0000"
 * - Rejects inputs that would require rounding or reformatting
 */
export function canonicalizeLocKey(value: string): string {
    if (typeof value !== 'string') {
        throw new Error('Invalid loc_key');
    }

    const expectedPrefix = `v${LOC_KEY_VERSION}:`;
    if (!value.startsWith(expectedPrefix)) {
        throw new Error('Invalid loc_key: unsupported version');
    }

    const rest = value.slice(expectedPrefix.length);
    const parts = rest.split(',');
    if (parts.length !== 2) {
        throw new Error('Invalid loc_key: expected "v1:<lat>,<lon>"');
    }

    const [latRaw, lonRaw] = parts;

    // Strict canonical format: no whitespace, no plus sign, exactly 4 decimals.
    const coordPattern = /^-?\d+\.\d{4}$/;
    if (!coordPattern.test(latRaw) || !coordPattern.test(lonRaw)) {
        throw new Error('Invalid loc_key: coordinates must have exactly 4 decimal places');
    }

    const latitude = Number(latRaw);
    const longitude = Number(lonRaw);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error('Invalid loc_key: coordinates must be finite numbers');
    }
    if (latitude < -90 || latitude > 90) {
        throw new Error('Invalid loc_key: latitude out of range');
    }
    if (longitude < -180 || longitude > 180) {
        throw new Error('Invalid loc_key: longitude out of range');
    }

    const canonical = makeLocKey(latitude, longitude);
    const normalizedInput = `${expectedPrefix}${latRaw === '-0.0000' ? '0.0000' : latRaw},${lonRaw === '-0.0000' ? '0.0000' : lonRaw}`;

    if (normalizedInput !== canonical) {
        throw new Error('Invalid loc_key: must already be canonical');
    }

    return canonical;
}
