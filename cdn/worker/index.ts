/// <reference types="@cloudflare/workers-types" />
/**
 * Weather Forecast CDN — Cloudflare Worker Entry Point
 *
 * Handles:
 * 1. Scheduled ingest via cron triggers
 * 2. HTTP requests for manifest and chunk retrieval
 */
/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

import { runIngest } from '../ingest/pipeline';
import { R2Storage, type R2Bucket } from './r2-storage';
import { getBlobContentHash } from '../artifact';
import { unpackageManifest } from '../manifest';
import { canonicalizeLocKey, isValidLocationScopeId } from '../location';

export interface Env {
    BUCKET: R2Bucket;
    /** Optional Ed25519 private key (hex) for signing manifests. Configure via `wrangler secret put`. */
    MANIFEST_PRIVATE_KEY_HEX?: string;
    /**
     * Optional JSON array of ingest targets for scheduled jobs.
     *
     * Example:
     * [
     *   { "latitude": 44.65, "longitude": -63.57, "timezone": "America/Halifax" }
     * ]
     */
    INGEST_LOCATIONS_JSON?: string;
    /** Legacy single-location scheduled ingest (fallback when `INGEST_LOCATIONS_JSON` is unset). */
    INGEST_LATITUDE?: string;
    INGEST_LONGITUDE?: string;
    INGEST_TIMEZONE?: string;
}

const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
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
     *
     * Uses `INGEST_LOCATIONS_JSON` (preferred) or legacy `INGEST_LATITUDE`/`INGEST_LONGITUDE`/`INGEST_TIMEZONE`.
     *
     * Cron conventions:
     * - Hourly (`0 * * * *`): observations only
     * - Every 6h (`0 *\/6 * * *`): forecasts only
     * - Anything else: forecasts + observations
     */
    async scheduled(
        controller: ScheduledController,
        env: Env,
        _ctx: ExecutionContext
    ): Promise<void> {
        const cron = typeof controller.cron === 'string' ? controller.cron.trim() : '';

        const defaultInclude = (() => {
            if (/^0\s+\*\/6\s+\*\s+\*\s+\*$/.test(cron) || cron.includes('*/6')) {
                return { includeForecasts: true, includeObservations: false };
            }
            if (/^0\s+\*\s+\*\s+\*\s+\*$/.test(cron)) {
                return { includeForecasts: false, includeObservations: true };
            }
            return { includeForecasts: true, includeObservations: true };
        })();

        const parseNumber = (value: unknown): number | null => {
            const n = typeof value === 'number' ? value : Number(value);
            return Number.isFinite(n) ? n : null;
        };

        type IngestTarget = {
            latitude: number;
            longitude: number;
            timezone?: string;
            includeForecasts?: boolean;
            includeObservations?: boolean;
            publishLegacyGlobal?: boolean;
        };

        const parseTargets = (): IngestTarget[] => {
            const raw = env.INGEST_LOCATIONS_JSON?.trim();
            if (raw) {
                try {
                    const parsed = JSON.parse(raw) as unknown;
                    const arr = Array.isArray(parsed) ? parsed : null;
                    if (!arr) throw new Error('INGEST_LOCATIONS_JSON must be a JSON array');

                    const out: IngestTarget[] = [];
                    for (const entry of arr) {
                        if (!entry || typeof entry !== 'object') continue;
                        const e = entry as Record<string, unknown>;
                        const latitude = parseNumber(e.latitude);
                        const longitude = parseNumber(e.longitude);
                        if (latitude === null || longitude === null) continue;
                        out.push({
                            latitude,
                            longitude,
                            timezone: typeof e.timezone === 'string' ? e.timezone : undefined,
                            includeForecasts: typeof e.includeForecasts === 'boolean' ? e.includeForecasts : undefined,
                            includeObservations: typeof e.includeObservations === 'boolean' ? e.includeObservations : undefined,
                            publishLegacyGlobal: typeof e.publishLegacyGlobal === 'boolean' ? e.publishLegacyGlobal : undefined
                        });
                    }
                    return out;
                } catch (error) {
                    console.error('[cron] Failed to parse INGEST_LOCATIONS_JSON; falling back to legacy vars', {
                        error: (error as Error)?.message ?? String(error)
                    });
                }
            }

            const latitude = parseNumber(env.INGEST_LATITUDE);
            const longitude = parseNumber(env.INGEST_LONGITUDE);
            if (latitude === null || longitude === null) return [];
            return [
                {
                    latitude,
                    longitude,
                    timezone: env.INGEST_TIMEZONE || 'UTC'
                }
            ];
        };

        const targets = parseTargets();
        if (targets.length === 0) {
            console.warn('[cron] No ingest targets configured; set INGEST_LOCATIONS_JSON or legacy INGEST_LATITUDE/INGEST_LONGITUDE');
            return;
        }

        const storage = new R2Storage(env.BUCKET);
        const manifestSigningKeyHex = env.MANIFEST_PRIVATE_KEY_HEX?.trim() || undefined;
        const scheduledAt = Number.isFinite((controller as any).scheduledTime)
            ? new Date((controller as any).scheduledTime)
            : new Date();

        console.log('[cron] ingest start', {
            cron,
            scheduledAt: scheduledAt.toISOString(),
            targets: targets.length,
            defaults: defaultInclude
        });

        for (const target of targets) {
            const includeForecasts = target.includeForecasts ?? defaultInclude.includeForecasts;
            const includeObservations = target.includeObservations ?? defaultInclude.includeObservations;
            const timezone = target.timezone || 'UTC';

            try {
                const result = await runIngest({
                    latitude: target.latitude,
                    longitude: target.longitude,
                    timezone,
                    storage,
                    manifestSigningKeyHex,
                    includeForecasts,
                    includeObservations,
                    now: scheduledAt,
                    // Multi-location scheduled ingest must not clobber global roots.
                    publishLegacyGlobal: target.publishLegacyGlobal ?? false
                });

                console.log('[cron] ingest ok', {
                    cron,
                    latitude: target.latitude,
                    longitude: target.longitude,
                    timezone,
                    includeForecasts,
                    includeObservations,
                    artifacts: result.artifacts.length,
                    manifestHash: result.manifestHash,
                    publishedAt: result.timestamp
                });
            } catch (error) {
                console.error('[cron] ingest failed', {
                    cron,
                    latitude: target.latitude,
                    longitude: target.longitude,
                    timezone,
                    includeForecasts,
                    includeObservations,
                    error: (error as Error)?.message ?? String(error)
                });
            }
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
        const { scopeKeyPrefix, routePath: path, isExplicit } = parseLocationRouting(url.pathname);

        // Precedence: explicit location only.
        // We no longer fallback to a "primary location" defined in Env.

        // Add headers for observability
        const effectiveLocationScope = scopeKeyPrefix ? scopeKeyPrefix.replace('locations/', '') : 'global';
        const effectiveLocationSource = isExplicit ? 'explicit' : 'none';

        const addObservabilityHeaders = (res: Response): Response => {
            res.headers.set('X-Weather-Location-Scope', effectiveLocationScope);
            res.headers.set('X-Weather-Location-Source', effectiveLocationSource);
            return res;
        };

        // Route: POST /ingest (trigger manual ingest)
        const ingestMatch = path.match(/^\/ingest$/);
        if (ingestMatch && request.method === 'POST') {
            try {
                const body = await request.json() as any;
                const latitude = typeof body.latitude === 'number' ? body.latitude : parseFloat(body.latitude);
                const longitude = typeof body.longitude === 'number' ? body.longitude : parseFloat(body.longitude);
                const timezone = body.timezone || 'UTC';

                if (
                    !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
                    !Number.isFinite(longitude) || longitude < -180 || longitude > 180
                ) {
                    return addObservabilityHeaders(jsonResponse(
                        { error: 'INVALID_LOCATION', message: 'latitude must be -90..90, longitude must be -180..180' },
                        { status: 400, headers: { 'Cache-Control': CACHE_ERROR } }
                    ));
                }

                if (!timezone || typeof timezone !== 'string' || timezone.trim() === '') {
                    return addObservabilityHeaders(jsonResponse(
                        { error: 'INVALID_TIMEZONE', message: 'timezone must be a non-empty string' },
                        { status: 400, headers: { 'Cache-Control': CACHE_ERROR } }
                    ));
                }

                const storage = new R2Storage(env.BUCKET);
                const manifestSigningKeyHex = env.MANIFEST_PRIVATE_KEY_HEX?.trim() || undefined;

                const result = await runIngest({
                    latitude,
                    longitude,
                    timezone,
                    storage,
                    manifestSigningKeyHex,
                    includeForecasts: true,
                    includeObservations: true,
                    now: new Date()
                });

                return addObservabilityHeaders(jsonResponse(
                    {
                        success: true,
                        manifestHash: result.manifestHash,
                        artifacts: result.artifacts.length,
                        timestamp: result.timestamp
                    },
                    { status: 200, headers: { 'Cache-Control': CACHE_ERROR } }
                ));
            } catch (error) {
                console.error('[ingest] Failed:', error);
                return addObservabilityHeaders(jsonResponse(
                    { error: 'INGEST_FAILED', message: (error as Error).message },
                    { status: 500, headers: { 'Cache-Control': CACHE_ERROR } }
                ));
            }
        }

        // Route: /api/eccc/location?coords=<lat,lon> (proxy weather.gc.ca location page for CORS)
        if (path === '/api/eccc/location') {
            const coords = url.searchParams.get('coords')?.trim() ?? '';
            if (!coords) {
                return addObservabilityHeaders(jsonResponse(
                    { error: 'MISSING_COORDS' },
                    { status: 400, headers: { 'Cache-Control': CACHE_ERROR } }
                ));
            }

            if (request.method === 'HEAD') {
                return addObservabilityHeaders(emptyResponse({
                    status: 200,
                    headers: {
                        'Content-Type': 'text/html; charset=utf-8',
                        'Cache-Control': CACHE_ROOT
                    }
                }));
            }

            try {
                const upstream = new URL('https://weather.gc.ca/en/location/index.html');
                upstream.searchParams.set('coords', coords);

                const headers: Record<string, string> = {};
                const ifNoneMatch = request.headers.get('if-none-match');
                const ifModifiedSince = request.headers.get('if-modified-since');
                if (ifNoneMatch) headers['If-None-Match'] = ifNoneMatch;
                if (ifModifiedSince) headers['If-Modified-Since'] = ifModifiedSince;

                const response = await fetch(upstream.toString(), {
                    headers,
                    redirect: 'follow'
                });

                const contentType = response.headers.get('content-type') ?? 'text/html; charset=utf-8';
                const etag = response.headers.get('etag');
                const lastModified = response.headers.get('last-modified');

                if (response.status === 304) {
                    return addObservabilityHeaders(emptyResponse({
                        status: 304,
                        headers: {
                            ...(etag ? { ETag: etag } : null),
                            ...(lastModified ? { 'Last-Modified': lastModified } : null),
                            'Cache-Control': CACHE_ROOT
                        }
                    }));
                }

                if (!response.ok) {
                    return addObservabilityHeaders(textResponse('Upstream error', {
                        status: 502,
                        headers: { 'Cache-Control': CACHE_ERROR }
                    }));
                }

                const body = await response.text();
                return addObservabilityHeaders(new Response(body, {
                    status: 200,
                    headers: withHeaders({
                        'Content-Type': contentType,
                        ...(etag ? { ETag: etag } : null),
                        ...(lastModified ? { 'Last-Modified': lastModified } : null),
                        'Cache-Control': CACHE_ROOT
                    })
                }));
            } catch (error) {
                console.error('[eccc/location] proxy failed', {
                    coords,
                    error: (error as Error)?.message ?? String(error)
                });
                return addObservabilityHeaders(jsonResponse(
                    { error: 'ECCC_PROXY_FAILED' },
                    { status: 502, headers: { 'Cache-Control': CACHE_ERROR } }
                ));
            }
        }

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
