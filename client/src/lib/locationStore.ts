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
 * - Initial state: primary = first favorite OR CANADIAN_CITIES[0]
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

function loadPrimaryLocation(): Location | null {
    if (!canUseStorage()) return null;
    try {
        const raw = localStorage.getItem(PRIMARY_LOCATION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        // Basic validation
        if (
            typeof parsed?.latitude === 'number' &&
            typeof parsed?.longitude === 'number' &&
            typeof parsed?.name === 'string'
        ) {
            return parsed as Location;
        }
        return null;
    } catch {
        return null;
    }
}

function savePrimaryLocation(location: Location): void {
    if (!canUseStorage()) return;
    try {
        localStorage.setItem(PRIMARY_LOCATION_KEY, JSON.stringify(location));
    } catch {
        // Ignore storage write failures
    }
}

/**
 * Get the initial primary location.
 * Priority: saved primary > first favorite > CANADIAN_CITIES[0]
 */
function getInitialPrimaryLocation(): Location | null {
    // 1. Check for saved primary
    const saved = loadPrimaryLocation();
    if (saved) return saved;

    // 2. Check for first favorite
    const favorites = loadFavorites();
    if (favorites.length > 0) {
        return favorites[0];
    }

    // 3. No primary location available
    // User Requirement: No hidden defaults. Explicitly return null if no primary set.
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store State (Module-level singleton)
// ─────────────────────────────────────────────────────────────────────────────

let _primaryLocation: Location | null = getInitialPrimaryLocation();
let _activeLocation: Location = _primaryLocation || CANADIAN_CITIES[0]; // Active must be valid, confirm fallback for active only
const _listeners: Set<() => void> = new Set();

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
} = {
    activeLocation: _activeLocation,
    primaryLocation: _primaryLocation,
    isViewingPrimary: _primaryLocation ? generateLocationId(_activeLocation) === generateLocationId(_primaryLocation) : false
};

function updateCachedSnapshot(): void {
    _cachedSnapshot = {
        activeLocation: _activeLocation,
        primaryLocation: _primaryLocation,
        isViewingPrimary: _primaryLocation ? generateLocationId(_activeLocation) === generateLocationId(_primaryLocation) : false
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
    _primaryLocation = getInitialPrimaryLocation();
    _activeLocation = _primaryLocation || CANADIAN_CITIES[0];
    _listeners.clear();
}
