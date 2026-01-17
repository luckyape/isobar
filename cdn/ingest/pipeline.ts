/**
 * Weather Forecast CDN — Ingest Pipeline
 *
 * Main entry point for the ingest process.
 * Fetches data, packages into artifacts, uploads to object store, publishes manifest.
 */
/* eslint-disable no-console */

import { packageArtifact } from '../artifact';
import { createManifest, createManifestEntry, packageManifest, getTodayDateString } from '../manifest';
import { fetchAllForecasts, fetchObservations, type FetchForecastOptions } from './fetcher';
import type { ManifestEntry } from '../types';
import { computeLocationScopeId, makeLocKey, normalizeLocationScope } from '../location';

// =============================================================================
// Storage Interface (abstract over S3/R2/local)
// =============================================================================

export interface StorageBackend {
    /** Check if object exists */
    exists(key: string): Promise<boolean>;

    /** Upload object (idempotent: no-op if exists) */
    put(key: string, data: Uint8Array): Promise<void>;

    /** Get object */
    get(key: string): Promise<Uint8Array | null>;

    /** List objects with prefix */
    list(prefix: string): Promise<string[]>;
}

// =============================================================================
// Ingest Runner
// =============================================================================

export interface IngestOptions {
    latitude: number;
    longitude: number;
    timezone?: string;
    storage: StorageBackend;
    /** Optional Ed25519 private key (hex) to sign manifests. */
    manifestSigningKeyHex?: string;
    /** Ingest forecasts in this run (default: true). */
    includeForecasts?: boolean;
    /** Ingest observations in this run (default: true). */
    includeObservations?: boolean;
    /** Override ingest clock (for deterministic scheduling). */
    now?: Date;
    /** If true, also publish legacy unscoped manifests/root.json. Default: true. */
    publishLegacyGlobal?: boolean;
}

export interface IngestResult {
    artifacts: ManifestEntry[];
    manifestHash: string;
    timestamp: string;
}

/**
 * Run a complete ingest cycle:
 * 1. Fetch forecasts from all models
 * 2. Fetch observations (if available)
 * 3. Package all artifacts
 * 4. Upload to storage (idempotent)
 * 5. Publish manifest
 */
export async function runIngest(options: IngestOptions): Promise<IngestResult> {
    const {
        latitude,
        longitude,
        timezone = 'UTC',
        storage,
        manifestSigningKeyHex,
        includeForecasts = true,
        includeObservations = true,
        now,
        publishLegacyGlobal = true
    } = options;
    const fetchOptions: FetchForecastOptions = { latitude, longitude, timezone };
    const artifacts: ManifestEntry[] = [];
    const locKey = makeLocKey(latitude, longitude);

    console.log('[ingest] Starting ingest cycle...');

    // 1. Fetch and package forecasts
    if (includeForecasts) {
        const forecasts = await fetchAllForecasts(fetchOptions);
        console.log(`[ingest] Fetched ${forecasts.length} forecasts`);

        for (const forecast of forecasts) {
            const { blob, hash } = await packageArtifact(forecast);
            const key = `chunks/${hash}`;

            // Idempotent upload
            const exists = await storage.exists(key);
            if (!exists) {
                await storage.put(key, blob);
                console.log(`[ingest] Uploaded ${forecast.model} → ${hash.slice(0, 12)}...`);
            } else {
                console.log(`[ingest] Skipped ${forecast.model} (exists)`);
            }

            artifacts.push(createManifestEntry(forecast, hash, blob.length, locKey));
        }
    }

    // 2. Fetch and package observations
    if (includeObservations) {
        try {
            const result = await fetchObservations({
                latitude,
                longitude,
                radiusKm: 80,
                now
            });
            if (result) {
                const { stationSet, observations } = result;

                // 2a. Package & Upload Station Set (Metadata)
                const stationSetPkg = await packageArtifact(stationSet);
                const ssKey = `chunks/${stationSetPkg.hash}`;

                if (!(await storage.exists(ssKey))) {
                    await storage.put(ssKey, stationSetPkg.blob);
                    console.log(`[ingest] Uploaded StationSet → ${stationSetPkg.hash.slice(0, 12)}...`);
                }
                artifacts.push(createManifestEntry(stationSet, stationSetPkg.hash, stationSetPkg.blob.length, locKey));

                // 2b. Package & Upload Observation buckets (Data)
                for (const observation of observations) {
                    const obsPkg = await packageArtifact(observation);
                    const obsKey = `chunks/${obsPkg.hash}`;

                    if (!(await storage.exists(obsKey))) {
                        await storage.put(obsKey, obsPkg.blob);
                        console.log(`[ingest] Uploaded Observation → ${obsPkg.hash.slice(0, 12)}... (${observation.observedAtBucket})`);
                    }

                    artifacts.push(createManifestEntry(observation, obsPkg.hash, obsPkg.blob.length, locKey));
                }
            }
        } catch (error) {
            console.warn('[ingest] Failed to fetch observations:', error);
        }
    }

    const today = getTodayDateString();

    // 3. Get previous manifest hash for chain (explicit head via root pointer)
    const scope = normalizeLocationScope({ latitude, longitude, timezone });
    const locationScopeId = computeLocationScopeId(scope);

    async function readPreviousManifestHash(rootKey: string): Promise<string | undefined> {
        try {
            const rootBytes = await storage.get(rootKey);
            if (!rootBytes) return undefined;
            const root = JSON.parse(new TextDecoder().decode(rootBytes)) as {
                latest?: string;
                latestManifestHash?: string;
            };
            if (root.latest === today && typeof root.latestManifestHash === 'string' && root.latestManifestHash) {
                return root.latestManifestHash;
            }
        } catch {
            // Ignore root parse errors; chaining is best-effort.
        }
        return undefined;
    }

    const scopedRootKey = `locations/${locationScopeId}/manifests/root.json`;
    const previousManifestHash = await readPreviousManifestHash(scopedRootKey);

    // 4. Create and upload manifest
    const manifest = createManifest({
        date: today,
        artifacts,
        previousManifestHash
    });

    const { blob: manifestBlob, hash: manifestHash } = await packageManifest(manifest, manifestSigningKeyHex);
    const scopedManifestKey = `locations/${locationScopeId}/manifests/${today}/${manifestHash}`;
    await storage.put(scopedManifestKey, manifestBlob);

    // Optional legacy global publish (single-location deployments)
    if (publishLegacyGlobal) {
        await storage.put(`manifests/${today}/${manifestHash}`, manifestBlob);
    }

    console.log(`[ingest] Published manifest → ${manifestHash.slice(0, 12)}... (scope ${locationScopeId.slice(0, 12)}...)`);

    // 5. Update scoped root pointer (mutable per location)
    const rootJson = JSON.stringify({
        latest: today,
        latestManifestHash: manifestHash,
        scope
    });
    await storage.put(scopedRootKey, new TextEncoder().encode(rootJson));

    // Optional legacy global root pointer (ONLY safe for single-location deployments)
    if (publishLegacyGlobal) {
        await storage.put('manifests/root.json', new TextEncoder().encode(rootJson));
    }

    console.log(`[ingest] Ingest complete: ${artifacts.length} artifacts`);

    return {
        artifacts,
        manifestHash,
        timestamp: manifest.publishedAt
    };
}

// =============================================================================
// Local File Storage (for testing)
// =============================================================================

/**
 * Simple in-memory storage backend for testing.
 */
export class MemoryStorage implements StorageBackend {
    private store = new Map<string, Uint8Array>();

    async exists(key: string): Promise<boolean> {
        return this.store.has(key);
    }

    async put(key: string, data: Uint8Array): Promise<void> {
        this.store.set(key, data);
    }

    async get(key: string): Promise<Uint8Array | null> {
        return this.store.get(key) ?? null;
    }

    async list(prefix: string): Promise<string[]> {
        return Array.from(this.store.keys()).filter((k) => k.startsWith(prefix));
    }

    /** Get all keys (for debugging) */
    keys(): string[] {
        return Array.from(this.store.keys());
    }

    /** Clear storage */
    clear(): void {
        this.store.clear();
    }
}
