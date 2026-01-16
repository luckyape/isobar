/// <reference types="@cloudflare/workers-types" />
/**
 * Weather Forecast CDN — Cloudflare Worker Entry Point
 *
 * Handles:
 * 1. Scheduled ingest via cron triggers
 * 2. HTTP requests for manifest and chunk retrieval
 */

import { runIngest } from '../ingest/pipeline';
import { R2Storage, type R2Bucket } from './r2-storage';
import { getBlobContentHash } from '../artifact';
import { unpackageManifest } from '../manifest';
import { canonicalizeLocKey, isValidLocationScopeId, computeLocationScopeId, normalizeLocationScope } from '../location';

export interface Env {
    BUCKET: R2Bucket;
    INGEST_LATITUDE: string;
    INGEST_LONGITUDE: string;
    INGEST_TIMEZONE: string;
    /** Optional Ed25519 private key (hex) for signing manifests. Configure via `wrangler secret put`. */
    MANIFEST_PRIVATE_KEY_HEX?: string;
}

const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, If-None-Match, Range',
    'Access-Control-Max-Age': '86400'
};

const SECURITY_HEADERS: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff'
};

const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';
const CACHE_ROOT = 'public, max-age=60';
const CACHE_LIST = 'public, max-age=300';
const CACHE_ERROR = 'no-store';

type ResponseInitWithHeaders = Omit<ResponseInit, 'headers'> & { headers?: Record<string, string> };

function withHeaders(extra?: Record<string, string>): HeadersInit {
    return {
        ...CORS_HEADERS,
        ...SECURITY_HEADERS,
        ...extra
    };
}

function textResponse(
    body: string,
    init: ResponseInitWithHeaders
): Response {
    return new Response(body, {
        ...init,
        headers: withHeaders(init.headers)
    });
}

function emptyResponse(init: ResponseInitWithHeaders): Response {
    return new Response(null, {
        ...init,
        headers: withHeaders(init.headers)
    });
}

function jsonResponse(body: unknown, init: ResponseInitWithHeaders): Response {
    return new Response(JSON.stringify(body), {
        ...init,
        headers: withHeaders({
            'Content-Type': 'application/json; charset=utf-8',
            ...init.headers
        })
    });
}

type LocationRouting = { scopeKeyPrefix: string; routePath: string; isExplicit: boolean };

function parseLocationRouting(pathname: string): LocationRouting {
    // Supports both legacy global paths and location-scoped paths:
    //   /manifests/...                         -> key: manifests/...
    //   /locations/<locId>/manifests/...       -> key: locations/<locId>/manifests/...
    const match = pathname.match(/^\/locations\/([a-f0-9]{64})(\/.*)$/);
    if (!match) {
        return { scopeKeyPrefix: '', routePath: pathname, isExplicit: false };
    }
    const [, locId, rest] = match;
    if (!isValidLocationScopeId(locId)) {
        return { scopeKeyPrefix: '', routePath: pathname, isExplicit: false };
    }
    return { scopeKeyPrefix: `locations/${locId}`, routePath: rest, isExplicit: true };
}

function keyFor(scopeKeyPrefix: string, key: string): string {
    return scopeKeyPrefix ? `${scopeKeyPrefix}/${key}` : key;
}

function parseUtcDate(date: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime())) return null;
    if (parsed.toISOString().slice(0, 10) !== date) return null;
    return parsed;
}

function addUtcDays(date: string, deltaDays: number): string | null {
    const parsed = parseUtcDate(date);
    if (!parsed) return null;
    parsed.setUTCDate(parsed.getUTCDate() + deltaDays);
    return parsed.toISOString().slice(0, 10);
}

export default {
    /**
     * Handle scheduled cron triggers for ingest.
     */
    async scheduled(
        controller: ScheduledController,
        env: Env,
        _ctx: ExecutionContext
    ): Promise<void> {
        console.log(`[cron] Ingest triggered at ${new Date().toISOString()}`);

        const storage = new R2Storage(env.BUCKET);
        const latitude = parseFloat(env.INGEST_LATITUDE) || 43.6532;
        const longitude = parseFloat(env.INGEST_LONGITUDE) || -79.3832;
        const timezone = env.INGEST_TIMEZONE || 'America/Toronto';
        const manifestSigningKeyHex = env.MANIFEST_PRIVATE_KEY_HEX?.trim() || undefined;

        const cron = (controller as any)?.cron as string | undefined;
        const isHourlyObs = cron === '0 * * * *';

        try {
            const result = await runIngest({
                latitude,
                longitude,
                timezone,
                storage,
                manifestSigningKeyHex,
                includeForecasts: !isHourlyObs,
                includeObservations: true,
                now: new Date((controller as any)?.scheduledTime ?? Date.now())
            });

            console.log(`[cron] Ingest complete: ${result.artifacts.length} artifacts, manifest ${result.manifestHash.slice(0, 12)}...`);
        } catch (error) {
            console.error('[cron] Ingest failed:', error);
            throw error;
        }
    },

    /**
     * Handle HTTP requests for CDN content.
     *
     * Routes:
     *   GET /manifests/root.json         → Latest manifest pointer
     *   GET /manifests/:date/:hash       → Manifest blob
     *   GET /chunks/:hash                → Artifact blob
     *   HEAD /chunks/:hash               → Check if artifact exists
     */
    async fetch(
        request: Request,
        env: Env,
        _ctx: ExecutionContext
    ): Promise<Response> {
        const url = new URL(request.url);
        let { scopeKeyPrefix, routePath: path, isExplicit } = parseLocationRouting(url.pathname);

        // Precedence: explicit location > primary location (default)
        // If no explicit location is provided, default to the primary location derived from Env.
        if (!isExplicit) {
            const primaryLat = parseFloat(env.INGEST_LATITUDE);
            const primaryLon = parseFloat(env.INGEST_LONGITUDE);
            const primaryTz = env.INGEST_TIMEZONE;

            if (Number.isFinite(primaryLat) && Number.isFinite(primaryLon)) {
                const primaryScopeId = computeLocationScopeId({
                    latitude: primaryLat,
                    longitude: primaryLon,
                    timezone: primaryTz,
                    decimals: 4 // Use default decimals for consistency with valid scope IDs
                });
                scopeKeyPrefix = `locations/${primaryScopeId}`;
            }
        }

        // Add headers for observability
        const effectiveLocationScope = scopeKeyPrefix ? scopeKeyPrefix.replace('locations/', '') : 'global';
        const effectiveLocationSource = isExplicit ? 'explicit' : 'primary';

        const addObservabilityHeaders = (res: Response): Response => {
            res.headers.set('X-Weather-Location-Scope', effectiveLocationScope);
            res.headers.set('X-Weather-Location-Source', effectiveLocationSource);
            return res;
        };

        // Handle preflight
        if (request.method === 'OPTIONS') {
            return addObservabilityHeaders(emptyResponse({ status: 204 }));
        }

        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return textResponse('Method not allowed', {
                status: 405,
                headers: { Allow: 'GET, HEAD, OPTIONS', 'Cache-Control': CACHE_ERROR }
            });
        }

        // Route: /locations/<loc_key>/latest.json (mutable hint pointer)
        const locationLatestMatch = path.match(/^\/locations\/([^/]+)\/latest\.json$/);
        if (locationLatestMatch) {
            let canonicalLocKey: string;
            try {
                canonicalLocKey = canonicalizeLocKey(decodeURIComponent(locationLatestMatch[1]));
            } catch {
                return addObservabilityHeaders(jsonResponse(
                    { error: 'INVALID_LOC_KEY' },
                    { status: 400, headers: { 'Cache-Control': CACHE_ERROR } }
                ));
            }

            const rootObject = await env.BUCKET.get('manifests/root.json');
            if (!rootObject) {
                return addObservabilityHeaders(jsonResponse(
                    { error: 'CDN_UNAVAILABLE' },
                    { status: 503, headers: { 'Cache-Control': CACHE_ERROR } }
                ));
            }

            let latestDate: string;
            try {
                const rootBody = await rootObject.arrayBuffer();
                const root = JSON.parse(new TextDecoder().decode(rootBody)) as { latest?: unknown };
                if (typeof root.latest !== 'string' || !parseUtcDate(root.latest)) {
                    throw new Error('Invalid root.json');
                }
                latestDate = root.latest;
            } catch {
                return addObservabilityHeaders(jsonResponse(
                    { error: 'CDN_UNAVAILABLE' },
                    { status: 503, headers: { 'Cache-Control': CACHE_ERROR } }
                ));
            }

            const previousDate = addUtcDays(latestDate, -1);
            if (!previousDate) {
                return addObservabilityHeaders(jsonResponse(
                    { error: 'CDN_UNAVAILABLE' },
                    { status: 503, headers: { 'Cache-Control': CACHE_ERROR } }
                ));
            }

            const listManifestHashes = async (date: string): Promise<string[]> => {
                const prefix = `manifests/${date}/`;
                const hashes: string[] = [];

                let cursor: string | undefined;
                do {
                    const result = await env.BUCKET.list({ prefix, limit: 1000, cursor });
                    for (const obj of result.objects) {
                        const hash = obj.key.replace(prefix, '');
                        if (/^[a-f0-9]{64}$/i.test(hash)) {
                            hashes.push(hash);
                        }
                    }
                    cursor = result.truncated ? result.cursor : undefined;
                } while (cursor);

                hashes.sort();
                return hashes;
            };

            const dateMatches = async (
                date: string
            ): Promise<{ date: string; manifests: string[]; scanned: number; skipped: number }> => {
                const hashes = await listManifestHashes(date);
                const matches: string[] = [];
                let skipped = 0;

                for (const hash of hashes) {
                    const key = `manifests/${date}/${hash}`;
                    const object = await env.BUCKET.get(key);
                    if (!object) {
                        skipped += 1;
                        continue;
                    }

                    let blob: Uint8Array;
                    try {
                        blob = new Uint8Array(await object.arrayBuffer());
                    } catch (error) {
                        console.warn('[locations/latest] Failed to read manifest blob', {
                            date,
                            hash,
                            error: (error as Error)?.message ?? String(error)
                        });
                        skipped += 1;
                        continue;
                    }

                    try {
                        const contentHash = getBlobContentHash(blob);
                        if (contentHash.toLowerCase() !== hash.toLowerCase()) {
                            console.warn('[locations/latest] Manifest hash mismatch; skipping', {
                                date,
                                expected: hash,
                                actual: contentHash
                            });
                            skipped += 1;
                            continue;
                        }

                        const manifest = await unpackageManifest(blob);
                        if (manifest.artifacts.some((entry) => entry.locKey === canonicalLocKey)) {
                            matches.push(hash);
                        }
                    } catch (error) {
                        console.warn('[locations/latest] Failed to verify/unpackage manifest; skipping', {
                            date,
                            hash,
                            error: (error as Error)?.message ?? String(error)
                        });
                        skipped += 1;
                        continue;
                    }
                }

                return { date, manifests: matches, scanned: hashes.length, skipped };
            };

            const latestResult = await dateMatches(latestDate);
            const previousResult = await dateMatches(previousDate);
            console.log('[locations/latest] scan complete', {
                loc_key: canonicalLocKey,
                dates: [
                    {
                        date: latestResult.date,
                        scanned: latestResult.scanned,
                        skipped: latestResult.skipped,
                        matches: latestResult.manifests.length
                    },
                    {
                        date: previousResult.date,
                        scanned: previousResult.scanned,
                        skipped: previousResult.skipped,
                        matches: previousResult.manifests.length
                    }
                ]
            });

            if (request.method === 'HEAD') {
                return addObservabilityHeaders(emptyResponse({
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json; charset=utf-8',
                        'Cache-Control': CACHE_ROOT
                    }
                }));
            }

            return addObservabilityHeaders(jsonResponse(
                {
                    loc_key: canonicalLocKey,
                    dates: [
                        { date: latestDate, manifests: latestResult.manifests },
                        { date: previousDate, manifests: previousResult.manifests }
                    ]
                },
                {
                    status: 200,
                    headers: { 'Cache-Control': CACHE_ROOT }
                }
            ));
        }

        // Route: /manifests/root.json (mutable pointer)
        if (path === '/manifests/root.json') {
            const object = await env.BUCKET.get(keyFor(scopeKeyPrefix, 'manifests/root.json'));
            if (!object) {
                return addObservabilityHeaders(textResponse('Not found', { status: 404, headers: { 'Cache-Control': CACHE_ERROR } }));
            }
            const body = await object.arrayBuffer();
            return addObservabilityHeaders(new Response(body, {
                headers: {
                    ...withHeaders({
                        'Content-Type': 'application/json; charset=utf-8',
                        'Cache-Control': CACHE_ROOT,
                        'ETag': object.etag
                    })
                }
            }));
        }

        // Route: /manifests/:date/:hash
        const manifestMatch = path.match(/^\/manifests\/(\d{4}-\d{2}-\d{2})\/([a-f0-9]{64})$/);
        if (manifestMatch) {
            const [, date, hash] = manifestMatch;
            const key = keyFor(scopeKeyPrefix, `manifests/${date}/${hash}`);

            if (request.method === 'HEAD') {
                const object = await env.BUCKET.head(key);
                if (!object) {
                    return emptyResponse({ status: 404, headers: { 'Cache-Control': CACHE_ERROR } });
                }
                return addObservabilityHeaders(emptyResponse({
                    status: 200,
                    headers: {
                        'Content-Type': 'application/octet-stream',
                        'Cache-Control': CACHE_IMMUTABLE,
                        'ETag': object.etag,
                        'Content-Length': object.size.toString()
                    }
                }));
            }

            const object = await env.BUCKET.get(key);
            if (!object) {
                return addObservabilityHeaders(textResponse('Not found', { status: 404, headers: { 'Cache-Control': CACHE_ERROR } }));
            }

            const body = await object.arrayBuffer();
            return addObservabilityHeaders(new Response(body, {
                headers: withHeaders({
                    'Content-Type': 'application/octet-stream',
                    'Cache-Control': CACHE_IMMUTABLE,
                    'ETag': object.etag,
                    'Content-Length': object.size.toString()
                })
            }));
        }

        // Route: /chunks/:hash
        const chunkMatch = path.match(/^\/chunks\/([a-f0-9]{64})$/);
        if (chunkMatch) {
            const [, hash] = chunkMatch;
            const key = `chunks/${hash}`;

            if (request.method === 'HEAD') {
                const object = await env.BUCKET.head(key);
                if (!object) {
                    return emptyResponse({ status: 404, headers: { 'Cache-Control': CACHE_ERROR } });
                }
                return addObservabilityHeaders(emptyResponse({
                    status: 200,
                    headers: {
                        'Content-Type': 'application/octet-stream',
                        'Cache-Control': CACHE_IMMUTABLE,
                        'ETag': object.etag,
                        'Content-Length': object.size.toString()
                    }
                }));
            }

            const object = await env.BUCKET.get(key);
            if (!object) {
                return addObservabilityHeaders(textResponse('Not found', { status: 404, headers: { 'Cache-Control': CACHE_ERROR } }));
            }

            const body = await object.arrayBuffer();
            return addObservabilityHeaders(new Response(body, {
                headers: withHeaders({
                    'Content-Type': 'application/octet-stream',
                    'Cache-Control': CACHE_IMMUTABLE,
                    'ETag': object.etag,
                    'Content-Length': object.size.toString()
                })
            }));
        }

        // Route: /manifests/:date/ (list manifests for a date)
        const listMatch = path.match(/^\/manifests\/(\d{4}-\d{2}-\d{2})\/$/);
        if (listMatch) {
            const [, date] = listMatch;
            const prefix = keyFor(scopeKeyPrefix, `manifests/${date}/`);
            const hashes: string[] = [];

            let cursor: string | undefined;
            do {
                const result = await env.BUCKET.list({ prefix, limit: 1000, cursor });
                for (const obj of result.objects) {
                    hashes.push(obj.key.replace(prefix, ''));
                }
                cursor = result.truncated ? result.cursor : undefined;
            } while (cursor);

            hashes.sort();
            return addObservabilityHeaders(new Response(JSON.stringify(hashes), {
                headers: withHeaders({
                    'Content-Type': 'application/json; charset=utf-8',
                    'Cache-Control': CACHE_LIST
                })
            }));
        }

        // 404 for unknown routes
        return addObservabilityHeaders(textResponse('Not found', { status: 404, headers: { 'Cache-Control': CACHE_ERROR } }));
    }
};
