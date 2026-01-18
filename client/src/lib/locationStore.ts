/**
 * Location Store - Arctic Data Observatory
 * 
 * Centralized state management for location:
 * - activeLocation: Currently viewed location (charts display this)
 * - primaryLocation: "Weatherman assigned" location for deeper features (observations, sync)
 * 
 * PERSISTENCE:
 * - primaryLocationId is persisted to localStorage
 * - activeLocation is NOT persisted (resets to primary on reload)
 * 
 * BEHAVIOR:
 * - Setting primary also sets active (reduces user confusion)
 * - Initial state: primary = null until hydration, active defaults to CANADIAN_CITIES[0]
 */

import type { Location } from './weatherTypes';
import { CANADIAN_CITIES } from './weatherApi';

// ─────────────────────────────────────────────────────────────────────────────
// Storage Keys
// ─────────────────────────────────────────────────────────────────────────────

const PRIMARY_LOCATION_KEY = 'weather-consensus-primary-location';
const PRIMARY_EVER_SET_KEY = 'weather-consensus-primary-ever-set';
const FAVORITES_STORAGE_KEY = 'weather-consensus-favorites';

// ─────────────────────────────────────────────────────────────────────────────
// Core Location ID Generator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a stable, unique ID for a location based on coordinates.
 * Format: "lat,lon" with 4 decimal precision.
 */
export function generateLocationId(location: Location): string {
    return `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function canUseStorage(): boolean {
    try {
        return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
    } catch {
        return false;
    }
}

interface FavoriteLocation extends Location {
    id: string;
    addedAt: string;
}

function isValidLocation(value: unknown): value is Location {
    return Boolean(
        value
        && typeof (value as Location).latitude === 'number'
        && typeof (value as Location).longitude === 'number'
        && typeof (value as Location).name === 'string'
    );
}

function loadFavorites(): FavoriteLocation[] {
    if (!canUseStorage()) return [];
    try {
        const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
        if (!raw) return [];
        return JSON.parse(raw) as FavoriteLocation[];
    } catch {
        return [];
    }
}

function savePrimaryLocation(location: Location): void {
    if (!canUseStorage()) return;
    if (!isValidLocation(location)) return;
    try {
        localStorage.setItem(PRIMARY_LOCATION_KEY, JSON.stringify(location));
    } catch {
        // Ignore storage write failures
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Store State (Module-level singleton)
// ─────────────────────────────────────────────────────────────────────────────

let _primaryLocation: Location | null = null;
let _activeLocation: Location = CANADIAN_CITIES[0];
let _isHydrated = false;
let _hydrationResult: {
    ok: boolean;
    reason: string | null;
    storagePrimaryRaw: string | null;
    storagePrimaryParsed: Location | null;
    storageKeyPresent: boolean;
    storageEverSet: boolean;
    primaryLocationKey: string | null;
} = {
    ok: false,
    reason: 'not-hydrated',
    storagePrimaryRaw: null,
    storagePrimaryParsed: null,
    storageKeyPresent: false,
    storageEverSet: false,
    primaryLocationKey: null
};
const _listeners: Set<() => void> = new Set();

export function hydrateLocationStore(): {
    ok: boolean;
    reason: string | null;
    storagePrimaryRaw: string | null;
    storagePrimaryParsed: Location | null;
    storageKeyPresent: boolean;
    storageEverSet: boolean;
    primaryLocationKey: string | null;
} {
    if (_isHydrated) return _hydrationResult;

    let storagePrimaryRaw: string | null = null;
    let storagePrimaryParsed: Location | null = null;
    let storageKeyPresent = false;
    let storageEverSet = false;
    let reason: string | null = null;
    let ok = false;
    const storageAvailable = canUseStorage();

    if (!storageAvailable) {
        reason = 'storage-unavailable';
    } else {
        storageEverSet = localStorage.getItem(PRIMARY_EVER_SET_KEY) === 'true';
        storagePrimaryRaw = localStorage.getItem(PRIMARY_LOCATION_KEY);
        storageKeyPresent = storagePrimaryRaw !== null;
        if (!storageKeyPresent) {
            reason = 'storage-empty';
        } else {
            const normalized = storagePrimaryRaw.trim().toLowerCase();
            if (!normalized || normalized === 'undefined' || normalized === 'null') {
                reason = 'storage-invalid-sentinel';
                try {
                    localStorage.removeItem(PRIMARY_LOCATION_KEY);
                } catch {
                    // Ignore storage failures
                }
            } else {
            try {
                const parsed = JSON.parse(storagePrimaryRaw);
                if (isValidLocation(parsed)) {
                    storagePrimaryParsed = parsed as Location;
                    _primaryLocation = storagePrimaryParsed;
                    _activeLocation = storagePrimaryParsed;
                    ok = true;
                } else {
                    reason = 'storage-invalid';
                }
            } catch {
                reason = 'storage-parse-error';
            }
            }
        }
    }

    if (!ok) {
        const favorites = loadFavorites();
        if (favorites.length > 0) {
            const fallbackPrimary = favorites[0];
            _primaryLocation = fallbackPrimary;
            _activeLocation = fallbackPrimary;
            ok = true;
            reason = 'favorite-fallback';
        } else if (reason === 'storage-invalid-sentinel') {
            _primaryLocation = _activeLocation;
            ok = true;
            reason = 'storage-invalid-sentinel-fallback';
        } else if (storageEverSet) {
            _primaryLocation = _activeLocation;
            ok = true;
            reason = 'ever-set-fallback';
        }
    }

    _hydrationResult = {
        ok,
        reason,
        storagePrimaryRaw,
        storagePrimaryParsed,
        storageKeyPresent,
        storageEverSet,
        primaryLocationKey: _primaryLocation ? generateLocationId(_primaryLocation) : null
    };

    _isHydrated = true;
    notifyListeners();
    return _hydrationResult;
}

export function isLocationStoreHydrated(): boolean {
    return _isHydrated;
}

export function getLocationHydrationDebug(): {
    ok: boolean;
    reason: string | null;
    storagePrimaryRaw: string | null;
    storagePrimaryParsed: Location | null;
    storageKeyPresent: boolean;
    storageEverSet: boolean;
    primaryLocationKey: string | null;
} {
    return _hydrationResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the currently viewed location (what charts display).
 */
export function getActiveLocation(): Location {
    return _activeLocation;
}

/**
 * Get the primary "weatherman assigned" location.
 */
export function getPrimaryLocation(): Location | null {
    return _primaryLocation;
}

/**
 * Set the active (viewed) location.
 * Does NOT change the primary location.
 */
export function setActiveLocation(location: Location): void {
    _activeLocation = location;
    notifyListeners();
}

/**
 * Set the primary location.
 * This also sets activeLocation to the new primary (reduces user confusion).
 * Persists to localStorage.
 */
export function setPrimaryLocation(location: Location): void {
    if (!isValidLocation(location)) return;
    _primaryLocation = location;
    _activeLocation = location; // Switch view to new primary
    savePrimaryLocation(location);
    notifyListeners();
}

/**
 * Check if a given location is the primary location.
 */
export function isPrimaryLocation(location: Location | null): boolean {
    if (!location) return false;
    if (!location || !_primaryLocation) return false;
    return generateLocationId(location) === generateLocationId(_primaryLocation);
}

/**
 * Check if currently viewing the primary location.
 */
export function isViewingPrimary(): boolean {
    if (!_primaryLocation) return false;
    return generateLocationId(_activeLocation) === generateLocationId(_primaryLocation);
}

// ─────────────────────────────────────────────────────────────────────────────
// Subscription API (for React integration)
// ─────────────────────────────────────────────────────────────────────────────

// Cached snapshot for useSyncExternalStore - MUST be referentially stable
// Only update when state actually changes to prevent infinite loops
let _cachedSnapshot: {
    activeLocation: Location;
    primaryLocation: Location | null;
    isViewingPrimary: boolean;
    isHydrated: boolean;
} = {
    activeLocation: _activeLocation,
    primaryLocation: _primaryLocation,
    isViewingPrimary: _primaryLocation ? generateLocationId(_activeLocation) === generateLocationId(_primaryLocation) : false,
    isHydrated: _isHydrated
};

function updateCachedSnapshot(): void {
    _cachedSnapshot = {
        activeLocation: _activeLocation,
        primaryLocation: _primaryLocation,
        isViewingPrimary: _primaryLocation ? generateLocationId(_activeLocation) === generateLocationId(_primaryLocation) : false,
        isHydrated: _isHydrated
    };
}

function notifyListeners(): void {
    updateCachedSnapshot();
    _listeners.forEach((listener) => listener());
}

/**
 * Subscribe to location changes.
 * Returns an unsubscribe function.
 */
export function subscribeToLocationChanges(listener: () => void): () => void {
    _listeners.add(listener);
    return () => {
        _listeners.delete(listener);
    };
}

/**
 * Get a snapshot of the current location state.
 * IMPORTANT: Returns a cached object to prevent infinite re-renders
 * when used with React's useSyncExternalStore.
 */
export function getLocationSnapshot(): {
    activeLocation: Location;
    primaryLocation: Location | null;
    isViewingPrimary: boolean;
    isHydrated: boolean;
} {
    return _cachedSnapshot;
}

// ─────────────────────────────────────────────────────────────────────────────
// Edge Case: Primary Location Removal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate that the current primary still exists in available locations.
 * If not, fallback to first favorite or CANADIAN_CITIES[0].
 * Call this when favorites change.
 */
export function validatePrimaryLocation(availableLocations?: Location[]): void {
    const favorites = loadFavorites();

    // If we have a valid primary that's in favorites, keep it
    if (!_primaryLocation) return;
    const primaryId = generateLocationId(_primaryLocation);
    const foundInFavorites = favorites.some((fav) => fav.id === primaryId);
    const foundInAvailable = availableLocations?.some(
        (loc) => generateLocationId(loc) === primaryId
    );

    if (foundInFavorites || foundInAvailable) {
        return; // Primary is valid
    }

    // Primary was removed; fall back
    const newPrimary = favorites[0] ?? CANADIAN_CITIES[0];
    setPrimaryLocation(newPrimary);
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirmation Flow Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a Primary Location has ever been explicitly set by the user.
 * Used to distinguish first-time set (no confirmation needed) from change (needs confirmation).
 */
export function hasEverSetPrimary(): boolean {
    if (!canUseStorage()) return false;
    try {
        return localStorage.getItem(PRIMARY_EVER_SET_KEY) === 'true';
    } catch {
        return false;
    }
}

/**
 * Mark that user has explicitly set a Primary Location.
 * Called after first-time primary set to enable confirmation dialogs for future changes.
 */
export function markPrimaryAsSet(): void {
    if (!canUseStorage()) return;
    try {
        localStorage.setItem(PRIMARY_EVER_SET_KEY, 'true');
    } catch {
        // Ignore storage write failures
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reset store to initial state. FOR TESTING ONLY.
 */
export function __resetStoreForTesting(): void {
    _primaryLocation = null;
    _activeLocation = CANADIAN_CITIES[0];
    _isHydrated = false;
    _hydrationResult = {
        ok: false,
        reason: 'not-hydrated',
        storagePrimaryRaw: null,
        storagePrimaryParsed: null,
        storageKeyPresent: false,
        storageEverSet: false,
        primaryLocationKey: null
    };
    _listeners.clear();
    updateCachedSnapshot();
}
