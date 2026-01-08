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

export interface Env {
    BUCKET: R2Bucket;
    INGEST_LATITUDE: string;
    INGEST_LONGITUDE: string;
    INGEST_TIMEZONE: string;
}

export default {
    /**
     * Handle scheduled cron triggers for ingest.
     */
    async scheduled(
        controller: ScheduledController,
        env: Env,
        ctx: ExecutionContext
    ): Promise<void> {
        console.log(`[cron] Ingest triggered at ${new Date().toISOString()}`);

        const storage = new R2Storage(env.BUCKET);
        const latitude = parseFloat(env.INGEST_LATITUDE) || 43.6532;
        const longitude = parseFloat(env.INGEST_LONGITUDE) || -79.3832;
        const timezone = env.INGEST_TIMEZONE || 'America/Toronto';

        try {
            const result = await runIngest({
                latitude,
                longitude,
                timezone,
                storage
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
        ctx: ExecutionContext
    ): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        // CORS headers for public CDN access
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Cache-Control': 'public, max-age=31536000, immutable'
        };

        // Handle preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        // Route: /manifests/root.json (mutable pointer)
        if (path === '/manifests/root.json') {
            const object = await env.BUCKET.get('manifests/root.json');
            if (!object) {
                return new Response('Not found', { status: 404 });
            }
            const body = await object.arrayBuffer();
            return new Response(body, {
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'application/json',
                    'Cache-Control': 'public, max-age=60' // Short cache for mutable root
                }
            });
        }

        // Route: /manifests/:date/:hash
        const manifestMatch = path.match(/^\/manifests\/(\d{4}-\d{2}-\d{2})\/([a-f0-9]+)$/);
        if (manifestMatch) {
            const [, date, hash] = manifestMatch;
            const key = `manifests/${date}/${hash}`;

            if (request.method === 'HEAD') {
                const object = await env.BUCKET.head(key);
                if (!object) {
                    return new Response(null, { status: 404 });
                }
                return new Response(null, {
                    headers: {
                        ...corsHeaders,
                        'Content-Length': object.size.toString(),
                        'ETag': object.etag
                    }
                });
            }

            const object = await env.BUCKET.get(key);
            if (!object) {
                return new Response('Not found', { status: 404 });
            }
            const body = await object.arrayBuffer();
            return new Response(body, {
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'application/octet-stream',
                    'ETag': object.etag
                }
            });
        }

        // Route: /chunks/:hash
        const chunkMatch = path.match(/^\/chunks\/([a-f0-9]+)$/);
        if (chunkMatch) {
            const [, hash] = chunkMatch;
            const key = `chunks/${hash}`;

            if (request.method === 'HEAD') {
                const object = await env.BUCKET.head(key);
                if (!object) {
                    return new Response(null, { status: 404 });
                }
                return new Response(null, {
                    headers: {
                        ...corsHeaders,
                        'Content-Length': object.size.toString(),
                        'ETag': object.etag
                    }
                });
            }

            const object = await env.BUCKET.get(key);
            if (!object) {
                return new Response('Not found', { status: 404 });
            }
            const body = await object.arrayBuffer();
            return new Response(body, {
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'application/octet-stream',
                    'ETag': object.etag
                }
            });
        }

        // Route: /manifests/:date/ (list manifests for a date)
        const listMatch = path.match(/^\/manifests\/(\d{4}-\d{2}-\d{2})\/$/);
        if (listMatch) {
            const [, date] = listMatch;
            const prefix = `manifests/${date}/`;
            const result = await env.BUCKET.list({ prefix });
            const hashes = result.objects.map((obj) => obj.key.replace(prefix, ''));

            return new Response(JSON.stringify(hashes), {
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'application/json',
                    'Cache-Control': 'public, max-age=300' // 5 min cache for listings
                }
            });
        }

        // 404 for unknown routes
        return new Response('Not found', { status: 404, headers: corsHeaders });
    }
};
