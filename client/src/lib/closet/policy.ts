/**
 * Weather Forecast CDN — Closet Policy
 *
 * Defines retention windows, quota limits, and pinning rules
 * for the local content-addressed cache.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Pin types for preserving specific content from GC.
 */
export type Pin =
    | { type: 'manifest'; date: string }           // pin a day's manifest(s)
    | { type: 'hash'; hash: string }               // pin a specific blob hash
    | { type: 'grid'; gridKey: string; days: number }; // pin forecasts for a gridKey

/**
 * Closet policy configuration.
 * Controls what gets kept locally and quota limits.
 */
export interface ClosetPolicy {
    /** Manifest discovery window in days (default 30) */
    windowDays: number;

    /** Keep forecast runs for this many days (default 14) */
    keepForecastRunsDays: number;

    /** Keep observations for this many days (default 30) */
    keepObservationDays: number;

    /** Local storage quota in bytes (default 1GB) */
    quotaBytes: number;

    /** Pinned content - immune to GC */
    pins: Pin[];
}

// =============================================================================
// Defaults
// =============================================================================

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_KEEP_FORECAST_RUNS_DAYS = 14;
const DEFAULT_KEEP_OBSERVATION_DAYS = 30;
const DEFAULT_QUOTA_BYTES = 1_000_000_000; // 1GB

/**
 * Get the default closet policy.
 */
export function getDefaultClosetPolicy(): ClosetPolicy {
    return {
        windowDays: DEFAULT_WINDOW_DAYS,
        keepForecastRunsDays: DEFAULT_KEEP_FORECAST_RUNS_DAYS,
        keepObservationDays: DEFAULT_KEEP_OBSERVATION_DAYS,
        quotaBytes: DEFAULT_QUOTA_BYTES,
        pins: []
    };
}

// =============================================================================
// Normalization
// =============================================================================

/**
 * Normalize and validate a policy, ensuring all values are sane.
 * Clamps values to reasonable bounds and ensures integers.
 */
export function normalizePolicy(policy: Partial<ClosetPolicy>): ClosetPolicy {
    const defaults = getDefaultClosetPolicy();

    const windowDays = clampInt(
        policy.windowDays ?? defaults.windowDays,
        1,
        365
    );

    const keepForecastRunsDays = clampInt(
        policy.keepForecastRunsDays ?? defaults.keepForecastRunsDays,
        1,
        windowDays // Can't keep forecasts longer than window
    );

    const keepObservationDays = clampInt(
        policy.keepObservationDays ?? defaults.keepObservationDays,
        1,
        windowDays // Can't keep observations longer than window
    );

    const quotaBytes = clampInt(
        policy.quotaBytes ?? defaults.quotaBytes,
        10_000_000,      // Min 10MB
        100_000_000_000  // Max 100GB
    );

    // Validate and filter pins
    const pins = (policy.pins ?? defaults.pins).filter(isValidPin);

    return {
        windowDays,
        keepForecastRunsDays,
        keepObservationDays,
        quotaBytes,
        pins
    };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Clamp an integer to a range.
 */
function clampInt(value: number, min: number, max: number): number {
    const int = Math.floor(value);
    return Math.max(min, Math.min(max, int));
}

/**
 * Validate a pin object.
 */
function isValidPin(pin: Pin): boolean {
    if (!pin || typeof pin !== 'object') return false;

    switch (pin.type) {
        case 'manifest':
            return typeof pin.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(pin.date);
        case 'hash':
            return typeof pin.hash === 'string' && /^[a-f0-9]{64}$/i.test(pin.hash);
        case 'grid':
            return (
                typeof pin.gridKey === 'string' &&
                pin.gridKey.length > 0 &&
                typeof pin.days === 'number' &&
                pin.days > 0 &&
                pin.days <= 365
            );
        default:
            return false;
    }
}

/**
 * Check if a hash is pinned by the policy.
 */
export function isHashPinned(policy: ClosetPolicy, hash: string): boolean {
    return policy.pins.some(
        (pin) => pin.type === 'hash' && pin.hash.toLowerCase() === hash.toLowerCase()
    );
}

/**
 * Check if a manifest date is pinned by the policy.
 */
export function isManifestDatePinned(policy: ClosetPolicy, date: string): boolean {
    return policy.pins.some(
        (pin) => pin.type === 'manifest' && pin.date === date
    );
}

/**
 * Get grid pins for a specific gridKey.
 */
export function getGridPins(policy: ClosetPolicy, gridKey: string): Pin[] {
    return policy.pins.filter(
        (pin) => pin.type === 'grid' && pin.gridKey === gridKey
    );
}

/**
 * Calculate the cutoff timestamp for a retention window.
 */
export function getRetentionCutoff(nowMs: number, days: number): number {
    return nowMs - days * 24 * 60 * 60 * 1000;
}
