/**
 * City Autocomplete Module with Canada-First Ranking
 *
 * A provider-agnostic, deterministic city search module that:
 * - Returns Canadian cities first via additive scoring
 * - Supports multiple geocoding providers (Photon, Nominatim)
 * - Is safe for offline-tolerant systems via prefix caching
 * - Provides debuggable assistant JSON export
 *
 * @module cityAutocomplete
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

// ---------------------------------------------------------------------------
// DATA MODEL
// ---------------------------------------------------------------------------

/**
 * Normalized city candidate shape.
 * All providers MUST map into this exact structure.
 * No extra fields. No missing required fields.
 */
export interface CityCandidate {
    name: string;
    region: string | null;
    countryCode: string;
    lat: number;
    lon: number;
    population?: number;
    importance?: number;
    source: 'photon' | 'nominatim';
    raw: object;
}

/**
 * Scored candidate for internal ranking.
 * Score is computed once and attached to enable transparent sorting.
 */
interface ScoredCandidate extends CityCandidate {
    score: number;
}

/**
 * Provider adapter interface.
 * Each geocoding provider implements this to normalize responses.
 */
interface ProviderAdapter {
    name: 'photon' | 'nominatim';
    search(query: string, signal: AbortSignal): Promise<CityCandidate[]>;
}

/**
 * Provider health tracking for observability.
 */
interface ProviderStatus {
    lastStatus: 'ok' | 'error' | 'timeout' | 'aborted' | 'unknown';
    lastLatencyMs: number;
}

/**
 * Search configuration options.
 */
export interface SearchOptions {
    /** Maximum results to return. Default: 10 */
    limit?: number;
    /** Province/state code to bias results toward. Optional. */
    provinceBias?: string;
    /** Minimum Canadian results before querying Nominatim backstop. Default: 3 */
    canadianThreshold?: number;
    /** AbortSignal for cancellation. */
    signal?: AbortSignal;
}

/**
 * Assistant context export shape.
 * Safe to paste into chat/email - no secrets.
 */
export interface AssistantContext {
    environment: {
        platform: 'web' | 'ios' | 'android';
        storage_quota_tier: 'low' | 'medium' | 'high';
        client_version: string;
    };
    query_state: {
        current_query: string;
        debounce_ms: number;
        aborted_requests: number;
    };
    data_freshness: {
        latest_observation_iso: string;
        data_age_human: string;
    };
    providers: {
        photon: { last_status: string; last_latency_ms: number };
        nominatim: { last_status: string; last_latency_ms: number };
    };
    cache_state: {
        prefix_keys: string[];
        entry_count: number;
    };
    ranking_snapshot: {
        top_results: Array<{ name: string; region: string | null; countryCode: string; score: number }>;
    };
}

// ---------------------------------------------------------------------------
// STATE (Module-level, encapsulated)
// ---------------------------------------------------------------------------

// Prefix-based cache: maps normalized query prefixes to results
const prefixCache = new Map<string, CityCandidate[]>();

// Provider health tracking
const providerStatus: Record<'photon' | 'nominatim', ProviderStatus> = {
    photon: { lastStatus: 'unknown', lastLatencyMs: 0 },
    nominatim: { lastStatus: 'unknown', lastLatencyMs: 0 },
};

// Query state for observability
let currentQuery = '';
let abortedRequestCount = 0;
let lastSearchTimestamp: number | null = null;

// ---------------------------------------------------------------------------
// PROVIDER ADAPTERS
// ---------------------------------------------------------------------------

/**
 * Photon provider adapter.
 * Primary provider - fast, no rate limits, OSM-based.
 * Uses Canada bounding box and osm_tag filtering for settlements.
 */
const photonAdapter: ProviderAdapter = {
    name: 'photon',

    async search(query: string, signal: AbortSignal): Promise<CityCandidate[]> {
        const start = performance.now();
        const url = new URL('https://photon.komoot.io/api');
        url.searchParams.set('q', query);
        url.searchParams.set('lang', 'en');
        url.searchParams.set('limit', '30'); // Get more to have good coverage after filtering

        // Canada bounding box: minLon,minLat,maxLon,maxLat
        // Rough bounds: -141 (Yukon) to -52 (Newfoundland), 41 (southern Ontario) to 84 (Arctic)
        url.searchParams.set('bbox', '-141,41,-52,84');

        // Filter to settlements using osm_tag (place:city, place:town, place:village)
        // Photon supports multiple osm_tag params
        url.searchParams.append('osm_tag', 'place:city');
        url.searchParams.append('osm_tag', 'place:town');
        url.searchParams.append('osm_tag', 'place:village');
        url.searchParams.append('osm_tag', 'place:municipality');
        url.searchParams.append('osm_tag', 'place:hamlet');

        try {
            const response = await fetch(url.toString(), { signal });
            const latency = performance.now() - start;
            providerStatus.photon.lastLatencyMs = Math.round(latency);

            if (!response.ok) {
                providerStatus.photon.lastStatus = 'error';
                return [];
            }

            const data: { features?: any[] } = await response.json();
            providerStatus.photon.lastStatus = 'ok';

            if (!data.features || !Array.isArray(data.features)) {
                return [];
            }

            // Normalize results - osm_tag filter already constrains to settlements
            return data.features
                .map((f: any): CityCandidate => ({
                    name: f.properties.name || '',
                    region: f.properties.state || f.properties.county || null,
                    countryCode: (f.properties.countrycode || '').toUpperCase(),
                    lat: f.geometry?.coordinates?.[1] ?? 0,
                    lon: f.geometry?.coordinates?.[0] ?? 0,
                    population: f.properties.population,
                    importance: undefined,
                    source: 'photon',
                    raw: f,
                }))
                .filter((c: CityCandidate) => c.name.length > 0);
        } catch (err: any) {
            const latency = performance.now() - start;
            providerStatus.photon.lastLatencyMs = Math.round(latency);

            if (err.name === 'AbortError') {
                providerStatus.photon.lastStatus = 'aborted';
                abortedRequestCount++;
            } else {
                providerStatus.photon.lastStatus = 'error';
            }
            return [];
        }
    },
};

/**
 * Nominatim provider adapter.
 * Backstop provider - supports countrycodes and featureType filters.
 * Must respect rate limits (1 req/sec) - this is a design constraint, not enforced here.
 */
const nominatimAdapter: ProviderAdapter = {
    name: 'nominatim',

    async search(query: string, signal: AbortSignal): Promise<CityCandidate[]> {
        const start = performance.now();
        const url = new URL('https://nominatim.openstreetmap.org/search');
        url.searchParams.set('q', query);
        url.searchParams.set('format', 'json');
        url.searchParams.set('countrycodes', 'ca'); // Canada filter
        url.searchParams.set('featuretype', 'settlement'); // Constrains to settlements only
        url.searchParams.set('limit', '15');
        url.searchParams.set('addressdetails', '1');

        try {
            const response = await fetch(url.toString(), {
                signal,
                headers: {
                    'User-Agent': 'WeatherConsensus/1.0', // Required by Nominatim ToS
                },
            });
            const latency = performance.now() - start;
            providerStatus.nominatim.lastLatencyMs = Math.round(latency);

            if (!response.ok) {
                providerStatus.nominatim.lastStatus = 'error';
                return [];
            }

            const data: any[] | object = await response.json();
            providerStatus.nominatim.lastStatus = 'ok';

            if (!Array.isArray(data)) {
                return [];
            }

            // featureType=settlement already filters at API level
            // Just normalize the results
            return data.map((r: any): CityCandidate => ({
                name: r.name || r.display_name?.split(',')[0] || '',
                region: r.address?.state || r.address?.province || null,
                countryCode: (r.address?.country_code || 'CA').toUpperCase(),
                lat: parseFloat(r.lat) || 0,
                lon: parseFloat(r.lon) || 0,
                population: undefined,
                importance: typeof r.importance === 'number' ? r.importance : undefined,
                source: 'nominatim',
                raw: r,
            }))
                .filter((c: CityCandidate) => c.name.length > 0);
        } catch (err: any) {
            const latency = performance.now() - start;
            providerStatus.nominatim.lastLatencyMs = Math.round(latency);

            if (err.name === 'AbortError') {
                providerStatus.nominatim.lastStatus = 'aborted';
                abortedRequestCount++;
            } else {
                providerStatus.nominatim.lastStatus = 'error';
            }
            return [];
        }
    },
};

// Provider registry for extensibility
const providers: ProviderAdapter[] = [photonAdapter, nominatimAdapter];

// ---------------------------------------------------------------------------
// RANKING ALGORITHM
// ---------------------------------------------------------------------------

/**
 * Compute deterministic score for a city candidate.
 * Higher score wins. Scoring is additive and transparent.
 *
 * Score components:
 * 1. Country Priority: CA = +1,000,000; else = 0
 * 2. Text Match Quality: exact=+200k, prefix=+120k, word-prefix=+90k, substring=+30k
 * 3. Size/Importance: log10(population+1)*10k OR importance*50k
 * 4. Province Bias: same province = +80,000
 * 5. Type Penalty: locality/village/neighborhood = -50,000
 */
function computeScore(
    candidate: CityCandidate,
    query: string,
    provinceBias?: string
): number {
    let score = 0;
    const normalizedQuery = query.toLowerCase().trim();
    const normalizedName = candidate.name.toLowerCase().trim();

    // 1. Country Priority
    // Canadian cities get massive boost to ensure they always sort first
    if (candidate.countryCode === 'CA') {
        score += 1_000_000;
    }

    // 2. Text Match Quality
    // Determines how well the candidate name matches the query
    if (normalizedName === normalizedQuery) {
        // Exact match: "London" matches "London"
        score += 200_000;
    } else if (normalizedName.startsWith(normalizedQuery)) {
        // Prefix match: "Lon" matches "London"
        score += 120_000;
    } else if (normalizedName.split(/\s+/).some(word => word.startsWith(normalizedQuery))) {
        // Word-prefix match: "Jo" matches "Saint John"
        score += 90_000;
    } else if (normalizedName.includes(normalizedQuery)) {
        // Substring match: "ondo" matches "London"
        score += 30_000;
    }

    // 3. Size / Importance
    // Larger cities score higher. Two methods depending on data availability.
    if (typeof candidate.population === 'number' && candidate.population > 0) {
        // Population-based: Toronto (2.7M) scores ~64k, small town (1000) scores ~30k
        score += Math.log10(candidate.population + 1) * 10_000;
    } else if (typeof candidate.importance === 'number') {
        // Importance-based (Nominatim): typically 0-1 scale
        score += candidate.importance * 50_000;
    }

    // 4. Province Bias
    // If caller specifies a preferred province, boost matches
    if (provinceBias && candidate.region) {
        const normalizedBias = provinceBias.toLowerCase();
        const normalizedRegion = candidate.region.toLowerCase();
        if (normalizedRegion === normalizedBias || normalizedRegion.includes(normalizedBias)) {
            score += 80_000;
        }
    }

    // 5. Type Penalty
    // Small localities get penalized to promote proper cities
    // We infer type from raw data when available
    const rawProperties = (candidate.raw as any)?.properties;
    const osmValue = rawProperties?.osm_value || rawProperties?.type || '';
    if (['village', 'locality', 'neighbourhood', 'neighborhood', 'hamlet'].includes(osmValue)) {
        score -= 50_000;
    }

    return Math.round(score);
}

// ---------------------------------------------------------------------------
// DE-DUPLICATION
// ---------------------------------------------------------------------------

/**
 * De-duplicate candidates.
 * Two candidates are duplicates if:
 * - name + region + countryCode match, OR
 * - lat/lon rounded to 3 decimal places match
 *
 * Keeps the highest-scoring duplicate.
 */
function deduplicateCandidates(candidates: ScoredCandidate[]): ScoredCandidate[] {
    // Sort by score descending so we encounter best matches first
    const sorted = [...candidates].sort((a, b) => b.score - a.score);

    const seenByKey = new Set<string>();
    const seenByCoords = new Set<string>();
    const deduplicated: ScoredCandidate[] = [];

    for (const candidate of sorted) {
        // Key-based deduplication: name + region + countryCode
        const nameKey = `${candidate.name.toLowerCase()}|${(candidate.region || '').toLowerCase()}|${candidate.countryCode}`;

        // Coordinate-based deduplication: lat/lon rounded to 3 decimals
        const coordKey = `${candidate.lat.toFixed(3)}|${candidate.lon.toFixed(3)}`;

        if (seenByKey.has(nameKey) || seenByCoords.has(coordKey)) {
            // Duplicate - skip (we already have a higher-scoring match)
            continue;
        }

        seenByKey.add(nameKey);
        seenByCoords.add(coordKey);
        deduplicated.push(candidate);
    }

    return deduplicated;
}

// ---------------------------------------------------------------------------
// CACHE
// ---------------------------------------------------------------------------

/**
 * Normalize query for cache key.
 * Lowercase, trimmed, whitespace-collapsed.
 */
function normalizeCacheKey(query: string): string {
    return query.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Check cache for a query or any prefix of it.
 * Returns cached results if a relevant prefix exists.
 */
function getCachedResults(query: string): CityCandidate[] | null {
    const normalized = normalizeCacheKey(query);

    // Check exact match first
    if (prefixCache.has(normalized)) {
        return prefixCache.get(normalized)!;
    }

    // Check prefixes (useful for "sain" when we have "sa" cached)
    // We don't use prefix matches to avoid stale data - only exact cache hits
    return null;
}

/**
 * Store results in cache.
 * Uses normalized query as key.
 */
function setCachedResults(query: string, results: CityCandidate[]): void {
    const normalized = normalizeCacheKey(query);
    prefixCache.set(normalized, results);

    // Also cache shorter prefixes if this is a longer query
    // This enables prefix-based cache hits for incremental typing
    if (normalized.length >= 3) {
        for (let i = 2; i < normalized.length; i++) {
            const prefix = normalized.slice(0, i);
            if (!prefixCache.has(prefix)) {
                // Filter results that still match the prefix
                const prefixResults = results.filter(r =>
                    r.name.toLowerCase().startsWith(prefix) ||
                    r.name.toLowerCase().includes(prefix)
                );
                if (prefixResults.length > 0) {
                    prefixCache.set(prefix, prefixResults);
                }
            }
        }
    }
}

/**
 * Clear the entire cache.
 * Useful for testing or memory management.
 */
export function clearCache(): void {
    prefixCache.clear();
}

// ---------------------------------------------------------------------------
// MAIN SEARCH FUNCTION
// ---------------------------------------------------------------------------

/**
 * Search for cities with Canada-first ranking.
 *
 * This is the primary entry point. It:
 * 1. Checks the cache for existing results
 * 2. Queries Photon (primary provider)
 * 3. If Canadian results < threshold, queries Nominatim (backstop)
 * 4. Scores, deduplicates, and sorts all candidates
 * 5. Returns top N results
 *
 * @param query - User input string (minimum 2 characters)
 * @param options - Search configuration
 * @returns Promise resolving to ranked, de-duplicated city candidates
 */
export async function searchCities(
    query: string,
    options: SearchOptions = {}
): Promise<CityCandidate[]> {
    const {
        limit = 10,
        provinceBias,
        canadianThreshold = 3,
        signal,
    } = options;

    // Update query state for observability
    currentQuery = query;
    lastSearchTimestamp = Date.now();

    // Validate input
    if (!query || query.trim().length < 2) {
        return [];
    }

    const normalizedQuery = query.trim();

    // Check cache first
    const cached = getCachedResults(normalizedQuery);
    if (cached) {
        // Re-score and re-sort cached results (provinceBias might have changed)
        const scored: ScoredCandidate[] = cached.map(c => ({
            ...c,
            score: computeScore(c, normalizedQuery, provinceBias),
        }));
        return deduplicateCandidates(scored).slice(0, limit);
    }

    // Create abort signal if not provided
    const abortController = signal ? undefined : new AbortController();
    const effectiveSignal = signal || abortController?.signal;

    if (!effectiveSignal) {
        throw new Error('AbortSignal required for cancellation support');
    }

    // Query Photon first (primary provider)
    const photonResults = await photonAdapter.search(normalizedQuery, effectiveSignal);

    // Count Canadian results from Photon
    const canadianFromPhoton = photonResults.filter(r => r.countryCode === 'CA');

    // Query Nominatim if we don't have enough Canadian results
    // Nominatim is filtered to Canada so it only returns Canadian cities
    let nominatimResults: CityCandidate[] = [];
    if (canadianFromPhoton.length < canadianThreshold) {
        nominatimResults = await nominatimAdapter.search(normalizedQuery, effectiveSignal);
    }

    // Combine all results
    const allResults = [...photonResults, ...nominatimResults];

    // Score all candidates
    const scored: ScoredCandidate[] = allResults.map(c => ({
        ...c,
        score: computeScore(c, normalizedQuery, provinceBias),
    }));

    // De-duplicate and sort
    const deduplicated = deduplicateCandidates(scored);

    // Sort by score descending (already done in deduplication, but ensure it)
    deduplicated.sort((a, b) => b.score - a.score);

    // Take top N
    const results = deduplicated.slice(0, limit);

    // Cache results (store without score to keep cache provider-agnostic)
    const cacheResults: CityCandidate[] = results.map(({ score, ...rest }) => rest);
    setCachedResults(normalizedQuery, cacheResults);

    return results;
}

// ---------------------------------------------------------------------------
// ASSISTANT JSON EXPORT
// ---------------------------------------------------------------------------

/**
 * Export assistant context for debugging.
 *
 * Returns a sanitized JSON object safe to paste into chat/email.
 * Explicitly omits: headers, tokens, API keys, auth config.
 *
 * @returns Sanitized context object
 */
export function exportAssistantContext(): AssistantContext {
    // Compute data age if we have a last search timestamp
    let dataAgeHuman = 'never';
    let latestObservationIso = new Date().toISOString();

    if (lastSearchTimestamp) {
        const ageMs = Date.now() - lastSearchTimestamp;
        const ageMinutes = Math.floor(ageMs / 60000);
        const ageHours = Math.floor(ageMinutes / 60);

        if (ageHours > 0) {
            dataAgeHuman = `${ageHours}h ago`;
        } else if (ageMinutes > 0) {
            dataAgeHuman = `${ageMinutes}m ago`;
        } else {
            dataAgeHuman = 'just now';
        }

        latestObservationIso = new Date(lastSearchTimestamp).toISOString();
    }

    // Get current cache state
    const prefixKeys = Array.from(prefixCache.keys()).sort();

    // Get last scored results for ranking snapshot
    const lastCached = currentQuery ? getCachedResults(currentQuery) : null;
    const topResults = (lastCached || []).slice(0, 5).map(c => ({
        name: c.name,
        region: c.region,
        countryCode: c.countryCode,
        score: computeScore(c, currentQuery || ''),
    }));

    // Determine storage tier heuristically
    let storageTier: 'low' | 'medium' | 'high' = 'medium';
    if (typeof navigator !== 'undefined' && 'storage' in navigator) {
        // In a real implementation, we'd check navigator.storage.estimate()
        storageTier = 'high';
    }

    // Get client version from env if available
    const clientVersion = typeof import.meta !== 'undefined'
        ? ((import.meta as any).env?.VITE_APP_VERSION || '1.0.0')
        : '1.0.0';

    return {
        environment: {
            platform: 'web',
            storage_quota_tier: storageTier,
            client_version: clientVersion,
        },
        query_state: {
            current_query: currentQuery,
            debounce_ms: 300, // Recommended debounce, not enforced here
            aborted_requests: abortedRequestCount,
        },
        data_freshness: {
            latest_observation_iso: latestObservationIso,
            data_age_human: dataAgeHuman,
        },
        providers: {
            photon: {
                last_status: providerStatus.photon.lastStatus,
                last_latency_ms: providerStatus.photon.lastLatencyMs,
            },
            nominatim: {
                last_status: providerStatus.nominatim.lastStatus,
                last_latency_ms: providerStatus.nominatim.lastLatencyMs,
            },
        },
        cache_state: {
            prefix_keys: prefixKeys,
            entry_count: prefixCache.size,
        },
        ranking_snapshot: {
            top_results: topResults,
        },
    };
}

// ---------------------------------------------------------------------------
// CONVENIENCE EXPORTS
// ---------------------------------------------------------------------------

/**
 * Reset all module state.
 * Useful for testing or when switching contexts.
 */
export function resetState(): void {
    prefixCache.clear();
    currentQuery = '';
    abortedRequestCount = 0;
    lastSearchTimestamp = null;
    providerStatus.photon = { lastStatus: 'unknown', lastLatencyMs: 0 };
    providerStatus.nominatim = { lastStatus: 'unknown', lastLatencyMs: 0 };
}

/**
 * Get current provider health status.
 * Useful for UI indicators or monitoring.
 */
export function getProviderStatus(): Record<'photon' | 'nominatim', ProviderStatus> {
    return { ...providerStatus };
}
