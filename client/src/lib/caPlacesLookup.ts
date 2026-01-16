export type Place = {
    id: number;
    name: string;
    prov: string;
    provName: string | null;
    lat: number;
    lon: number;
    pop: number;
    keys: string[];
};

type PrefixIndexPayload = {
    version: number;
    maxPrefix: number;
    index: Record<string, number[]>;
};

export type CaPlacesStore = {
    placesById: Map<number, Place>;
    index: Record<string, number[]>;
    maxPrefix: number;
};

export type SearchOptions = {
    limit?: number;
};

export type SearchResult = Place & {
    matchType: 'exact' | 'prefix' | 'substring';
    score: number;
};

const PUNCTUATION_REGEX = /[.,'’/()[\]-]/g;
const DIACRITICS_REGEX = /[\u0300-\u036f]/g;

let cachedStorePromise: Promise<CaPlacesStore> | null = null;

function normalizeKey(input: string): string {
    let s = String(input);
    s = s.normalize('NFKD').replace(DIACRITICS_REGEX, '');
    s = s.toLowerCase();
    s = s.replace(PUNCTUATION_REGEX, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
}

function asciiSortKey(input: string): string {
    return normalizeKey(input).replace(/[^a-z0-9 ]/g, '');
}

function clampPrefixLength(value: number, maxPrefix: number): number {
    const max = Math.max(2, maxPrefix || 2);
    return Math.min(Math.max(2, value), max);
}

async function fetchJsonAsset<T>(relativePath: string): Promise<T> {
    const url = new URL(relativePath, window.location.origin);
    const response = await fetch(url.href);
    if (!response.ok) {
        throw new Error(`Failed to load asset ${relativePath}: ${response.status}`);
    }
    return response.json() as Promise<T>;
}

export async function loadCaPlaces(): Promise<CaPlacesStore> {
    if (!cachedStorePromise) {
        cachedStorePromise = (async () => {
            const [places, indexPayload] = await Promise.all([
                fetchJsonAsset<Place[]>('/ca_places.json'),
                fetchJsonAsset<PrefixIndexPayload>('/ca_places_index.json'),
            ]);

            const placesById = new Map<number, Place>();
            for (const place of places) {
                placesById.set(place.id, place);
            }

            return {
                placesById,
                index: indexPayload.index ?? {},
                maxPrefix: indexPayload.maxPrefix ?? 8,
            };
        })();
    }
    return cachedStorePromise;
}

function computeMatchQuality(place: Place, normalizedQuery: string): { rank: number; type: SearchResult['matchType'] } {
    if (place.keys.some(key => key === normalizedQuery)) {
        return { rank: 3, type: 'exact' };
    }
    if (place.keys.some(key => key.startsWith(normalizedQuery))) {
        return { rank: 2, type: 'prefix' };
    }
    return { rank: 1, type: 'substring' };
}

export function searchCaPlaces(store: CaPlacesStore, query: string, opts: SearchOptions = {}): SearchResult[] {
    const limit = opts.limit ?? 10;
    const normalizedQuery = normalizeKey(query);

    if (normalizedQuery.length < 2) return [];

    const prefixLength = clampPrefixLength(normalizedQuery.length, store.maxPrefix);
    const prefix = normalizedQuery.slice(0, prefixLength);
    const ids = store.index[prefix] ?? [];

    const candidates: SearchResult[] = [];

    for (const id of ids) {
        const place = store.placesById.get(id);
        if (!place) continue;

        const matches = place.keys.some(key => key.startsWith(normalizedQuery) || key.includes(normalizedQuery));
        if (!matches) continue;

        const { rank, type } = computeMatchQuality(place, normalizedQuery);
        candidates.push({
            ...place,
            matchType: type,
            score: rank,
        });
    }

    candidates.sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        if (a.pop !== b.pop) return b.pop - a.pop;

        const aName = asciiSortKey(a.name);
        const bName = asciiSortKey(b.name);
        if (aName !== bName) return aName < bName ? -1 : 1;

        return a.id - b.id;
    });

    return candidates.slice(0, Math.max(0, limit));
}

export function __testOnly__normalizeKey(input: string): string {
    return normalizeKey(input);
}
