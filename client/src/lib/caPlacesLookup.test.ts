import { describe, expect, it } from 'vitest';
import { type CaPlacesStore, type Place, searchCaPlaces, __testOnly__normalizeKey } from './caPlacesLookup';

function buildStore(places: Place[], maxPrefix = 8): CaPlacesStore {
    const index: Record<string, number[]> = {};

    for (const place of places) {
        for (const key of place.keys) {
            const capped = Math.min(maxPrefix, key.length);
            for (let len = 2; len <= capped; len += 1) {
                const prefix = key.slice(0, len);
                const bucket = index[prefix] ?? [];
                bucket.push(place.id);
                index[prefix] = bucket;
            }
        }
    }

    for (const prefix of Object.keys(index)) {
        index[prefix] = Array.from(new Set(index[prefix])).sort((a, b) => a - b);
    }

    return {
        placesById: new Map(places.map(p => [p.id, p])),
        index,
        maxPrefix,
    };
}

const places: Place[] = [
    {
        id: 1,
        name: 'Saint John',
        prov: 'NB',
        provName: 'New Brunswick',
        lat: 45.273,
        lon: -66.063,
        pop: 70000,
        keys: [__testOnly__normalizeKey('Saint John'), 'st john'],
    },
    {
        id: 2,
        name: 'Saint-Jérôme',
        prov: 'QC',
        provName: 'Quebec',
        lat: 45.780,
        lon: -74.003,
        pop: 75000,
        keys: [__testOnly__normalizeKey('Saint-Jérôme'), 'saint jerome', 'st jerome'],
    },
    {
        id: 3,
        name: 'Sainte-Anne-des-Monts',
        prov: 'QC',
        provName: 'Quebec',
        lat: 49.125,
        lon: -66.492,
        pop: 6000,
        keys: [__testOnly__normalizeKey('Sainte-Anne-des-Monts'), 'sainte anne', 'ste anne'],
    },
    {
        id: 4,
        name: 'St. Albert',
        prov: 'AB',
        provName: 'Alberta',
        lat: 53.637,
        lon: -113.625,
        pop: 65000,
        keys: [__testOnly__normalizeKey('St. Albert'), 'saint albert', 'st albert'],
    },
    {
        id: 5,
        name: 'Saint Andrews',
        prov: 'NB',
        provName: 'New Brunswick',
        lat: 45.073,
        lon: -67.054,
        pop: 65000,
        keys: [__testOnly__normalizeKey('Saint Andrews'), 'st andrews'],
    },
];

const store = buildStore(places);

describe('caPlacesLookup.searchCaPlaces', () => {
    it('returns deterministic ordering for broad saint query', () => {
        const results = searchCaPlaces(store, 'saint', { limit: 10 });
        expect(results.map(r => r.name)).toEqual([
            'Saint-Jérôme',
            'Saint John',
            'Saint Andrews',
            'St. Albert',
            'Sainte-Anne-des-Monts',
        ]);
    });

    it('matches saint expansions via keys (st john -> Saint John)', () => {
        const results = searchCaPlaces(store, 'st john', { limit: 5 });
        expect(results[0]?.name).toBe('Saint John');
        expect(results[0]?.matchType).toBe('exact');
    });

    it('handles diacritics and punctuation (sainte anne)', () => {
        const results = searchCaPlaces(store, 'sainte anne', { limit: 5 });
        expect(results[0]?.name).toBe('Sainte-Anne-des-Monts');
        expect(results[0]?.matchType).toBe('exact');
    });

    it('honors maxPrefix clamp when querying beyond max length', () => {
        const results = searchCaPlaces(store, 'saskatoon', { limit: 5 });
        expect(results).toEqual([]);

        const extendedStore = buildStore(
            [{
                id: 9,
                name: 'Saskatoon',
                prov: 'SK',
                provName: 'Saskatchewan',
                lat: 52.133,
                lon: -106.670,
                pop: 246000,
                keys: [__testOnly__normalizeKey('Saskatoon')],
            }],
            8
        );
        const hit = searchCaPlaces(extendedStore, 'saskatoon', { limit: 5 });
        expect(hit[0]?.name).toBe('Saskatoon');
    });

    it('applies deterministic secondary ordering when scores tie', () => {
        const results = searchCaPlaces(store, 'st a', { limit: 5 });
        expect(results.slice(0, 2).map(r => r.name)).toEqual([
            'Saint Andrews',
            'St. Albert',
        ]);
        expect(results.every(r => r.matchType === 'prefix' || r.matchType === 'substring')).toBe(true);
    });
});
