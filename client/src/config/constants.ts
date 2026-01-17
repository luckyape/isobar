/**
 * Application Constants - Arctic Data Observatory
 *
 * Centralized configuration constants to eliminate magic numbers
 * and provide a single source of truth for configurable values.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Time Window Configuration
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum number of hours to display in forecast charts */
export const FORECAST_WINDOW_HOURS = 48;

/** Maximum number of past hours to show (for historical context) */
export const PAST_WINDOW_HOURS = 24;

/** Number of hours in one day */
export const HOURS_PER_DAY = 24;

/** Number of days in the 7-day forecast */
export const FORECAST_DAYS = 7;

// ─────────────────────────────────────────────────────────────────────────────
// Precipitation Thresholds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimum Probability of Precipitation (POP) to display in UI.
 * Below this threshold, precipitation is considered negligible.
 */
export const POP_DISPLAY_THRESHOLD = 20;

/**
 * Precipitation intensity thresholds (mm/hr) for visual encoding.
 */
export const PRECIPITATION_INTENSITY = {
    /** Below this: no precipitation */
    NONE: 0.1,
    /** Drizzle range: 0.1 - 1.0 mm/hr */
    DRIZZLE: 1,
    /** Light rain range: 1.0 - 2.5 mm/hr */
    LIGHT: 2.5,
    /** Moderate rain range: 2.5 - 7.5 mm/hr */
    MODERATE: 7.5,
    /** Heavy rain range: 7.5 - 50 mm/hr */
    HEAVY: 50,
    /** Above 50 mm/hr: extreme */
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Freshness Thresholds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Model run freshness thresholds (hours).
 * Used for visual indicators and stale warnings.
 */
export const FRESHNESS_THRESHOLDS = {
    /** Model data is considered "fresh" if run age is below this */
    FRESH_HOURS: 6,
    /** Model data is "aging" between FRESH_HOURS and STALE_HOURS */
    AGING_HOURS: 12,
    /** Model data is "stale" if run age exceeds this */
    STALE_HOURS: 12,
    /** Model is marked stale if it's this many hours older than freshest model */
    STALE_DELTA_HOURS: 6,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Condition Sampling
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Interval for sampling weather conditions in the chart view.
 * Every Nth hour is shown to avoid visual clutter.
 */
export const CONDITION_SAMPLE_INTERVAL_HOURS = 3;

// ─────────────────────────────────────────────────────────────────────────────
// UI Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Debounce delay for location search input (milliseconds).
 */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * Minimum characters required before initiating location search.
 */
export const SEARCH_MIN_CHARS = 2;

/**
 * Mobile breakpoint in pixels (re-exported from useMediaQuery for convenience).
 */
export { MOBILE_BREAKPOINT } from '@/hooks/useMediaQuery';

// ─────────────────────────────────────────────────────────────────────────────
// Chart Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Matrix spacing standard (used for precipitation and wind direction matrices).
 */
export const MATRIX_DIMENSIONS = {
    /** Column width on desktop (px) */
    COLUMN_WIDTH_DESKTOP: 28,
    /** Column width on mobile (px) */
    COLUMN_WIDTH_MOBILE: 22,
    /** Header row height (px) */
    HEADER_HEIGHT: 24,
    /** Data row height (px) */
    ROW_HEIGHT: 32,
    /** Inner glyph canvas size (px) */
    GLYPH_CANVAS_SIZE: 28,
} as const;
