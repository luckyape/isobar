import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    generateLocationId,
    getActiveLocation,
    getPrimaryLocation,
    setActiveLocation,
    setPrimaryLocation,
    isPrimaryLocation,
    isViewingPrimary,
    subscribeToLocationChanges,
    getLocationSnapshot,
    __resetStoreForTesting
} from './locationStore';
import type { Location } from './weatherTypes';

// Mock locations
const TORONTO: Location = {
    name: 'Toronto',
    latitude: 43.6532,
    longitude: -79.3832,
    country: 'Canada',
    province: 'Ontario',
    timezone: 'America/Toronto'
};

const VANCOUVER: Location = {
    name: 'Vancouver',
    latitude: 49.2827,
    longitude: -123.1207,
    country: 'Canada',
    province: 'British Columbia',
    timezone: 'America/Vancouver'
};

const MONTREAL: Location = {
    name: 'Montreal',
    latitude: 45.5017,
    longitude: -73.5673,
    country: 'Canada',
    province: 'Quebec',
    timezone: 'America/Toronto'
};

describe('locationStore', () => {
    beforeEach(() => {
        // Clear localStorage before each test
        localStorage.clear();
        __resetStoreForTesting();
    });

    describe('generateLocationId', () => {
        it('generates stable IDs from coordinates', () => {
            const id = generateLocationId(TORONTO);
            expect(id).toBe('43.6532,-79.3832');
        });

        it('generates same ID for same coordinates', () => {
            const id1 = generateLocationId(TORONTO);
            const id2 = generateLocationId({ ...TORONTO, name: 'Different Name' });
            expect(id1).toBe(id2);
        });

        it('generates different IDs for different coordinates', () => {
            const id1 = generateLocationId(TORONTO);
            const id2 = generateLocationId(VANCOUVER);
            expect(id1).not.toBe(id2);
        });
    });

    describe('primary location persistence', () => {
        it('setPrimaryLocation persists to localStorage', () => {
            setPrimaryLocation(VANCOUVER);

            const stored = localStorage.getItem('weather-consensus-primary-location');
            expect(stored).toBeTruthy();

            const parsed = JSON.parse(stored!);
            expect(parsed.name).toBe('Vancouver');
            expect(parsed.latitude).toBe(VANCOUVER.latitude);
        });

        it('getPrimaryLocation returns the set primary', () => {
            setPrimaryLocation(MONTREAL);

            const primary = getPrimaryLocation();
            expect(primary.name).toBe('Montreal');
        });
    });

    describe('active and primary independence', () => {
        it('setActiveLocation does NOT change primary', () => {
            setPrimaryLocation(TORONTO);
            setActiveLocation(VANCOUVER);

            expect(getPrimaryLocation().name).toBe('Toronto');
            expect(getActiveLocation().name).toBe('Vancouver');
        });

        it('active and primary can have different values', () => {
            setPrimaryLocation(TORONTO);
            setActiveLocation(MONTREAL);

            expect(generateLocationId(getActiveLocation())).not.toBe(
                generateLocationId(getPrimaryLocation())
            );
        });

        it('setPrimaryLocation also updates active (by design)', () => {
            setActiveLocation(VANCOUVER);
            expect(getActiveLocation().name).toBe('Vancouver');

            setPrimaryLocation(TORONTO);

            // Both should now be Toronto
            expect(getPrimaryLocation().name).toBe('Toronto');
            expect(getActiveLocation().name).toBe('Toronto');
        });
    });

    describe('isPrimaryLocation predicate', () => {
        it('returns true for current primary', () => {
            setPrimaryLocation(TORONTO);
            expect(isPrimaryLocation(TORONTO)).toBe(true);
        });

        it('returns false for non-primary', () => {
            setPrimaryLocation(TORONTO);
            expect(isPrimaryLocation(VANCOUVER)).toBe(false);
        });

        it('returns false for null', () => {
            expect(isPrimaryLocation(null)).toBe(false);
        });

        it('matches by coordinates, not reference', () => {
            setPrimaryLocation(TORONTO);

            const torontoCopy = { ...TORONTO, name: 'Toronto Copy' };
            expect(isPrimaryLocation(torontoCopy)).toBe(true);
        });
    });

    describe('isViewingPrimary', () => {
        it('returns true when active equals primary', () => {
            setPrimaryLocation(TORONTO);
            setActiveLocation(TORONTO);
            expect(isViewingPrimary()).toBe(true);
        });

        it('returns false when browsing different location', () => {
            setPrimaryLocation(TORONTO);
            setActiveLocation(VANCOUVER);
            expect(isViewingPrimary()).toBe(false);
        });
    });

    describe('subscription API', () => {
        it('notifies listeners on setActiveLocation', () => {
            const listener = vi.fn();
            subscribeToLocationChanges(listener);

            setActiveLocation(VANCOUVER);

            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('notifies listeners on setPrimaryLocation', () => {
            const listener = vi.fn();
            subscribeToLocationChanges(listener);

            setPrimaryLocation(MONTREAL);

            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('unsubscribe stops notifications', () => {
            const listener = vi.fn();
            const unsubscribe = subscribeToLocationChanges(listener);

            unsubscribe();
            setActiveLocation(VANCOUVER);

            expect(listener).not.toHaveBeenCalled();
        });
    });

    describe('getLocationSnapshot', () => {
        it('returns current state', () => {
            setPrimaryLocation(TORONTO);
            setActiveLocation(VANCOUVER);

            const snapshot = getLocationSnapshot();

            expect(snapshot.primaryLocation.name).toBe('Toronto');
            expect(snapshot.activeLocation.name).toBe('Vancouver');
            expect(snapshot.isViewingPrimary).toBe(false);
        });

        it('isViewingPrimary is true when both match', () => {
            setPrimaryLocation(MONTREAL);
            // setPrimaryLocation also sets active

            const snapshot = getLocationSnapshot();
            expect(snapshot.isViewingPrimary).toBe(true);
        });
    });
});
