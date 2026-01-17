/**
 * Canonical variable registry for observation semantics.
 */

// List of allowed canonical keys that represent bucketed accumulation.
// These are safe to display as total amounts over the bucket duration.
const BUCKETED_ACCUMULATION_VARS = new Set([
    'p_mm', // Precipitation in mm (accumulation)
    'snow_mm', // Snowfall in mm (accumulation)
]);

// Map of canonical keys to their expected bucket duration in minutes.
// Only includes variables where bucket size is strictly enforced.
const OBSERVED_BUCKET_MINUTES: Record<string, number> = {
    'p_mm': 60,
    'snow_mm': 60,
};

/**
 * Checks if a canonical variable key represents a bucketed accumulation.
 * If true, the value should be treated as a sum over the bucket.
 * If false (e.g. rate, instantaneous), it should generally not be displayed
 * as a simple bar in an hourly sum graph without further processing.
 */
export function isBucketedAccumulation(canonicalKey: string): boolean {
    return BUCKETED_ACCUMULATION_VARS.has(canonicalKey);
}

/**
 * Returns the expected bucket duration in minutes for a given observed variable.
 * Returns null if the variable does not have a strict bucket duration or is unknown.
 */
export function bucketMinutesForObserved(canonicalKey: string): number | null {
    return OBSERVED_BUCKET_MINUTES[canonicalKey] ?? null;
}
