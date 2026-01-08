/**
 * Weather Forecast CDN — Ingest Pipeline
 *
 * Main entry point for the ingest process.
 * Fetches data, packages into artifacts, uploads to object store, publishes manifest.
 */

import { packageArtifact } from '../artifact';
import { createManifest, createManifestEntry, packageManifest, getTodayDateString } from '../manifest';
import { fetchAllForecasts, fetchObservations, type FetchForecastOptions } from './fetcher';
import type { Artifact, ManifestEntry } from '../types';

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
    const { latitude, longitude, timezone = 'UTC', storage } = options;
    const fetchOptions: FetchForecastOptions = { latitude, longitude, timezone };
    const artifacts: ManifestEntry[] = [];

    console.log('[ingest] Starting ingest cycle...');

    // 1. Fetch and package forecasts
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

        artifacts.push(createManifestEntry(forecast, hash, blob.length));
    }

    // 2. Fetch and package observations
    try {
        const result = await fetchObservations({ latitude, longitude });
        if (result) {
            const { stationSet, observation } = result;

            // 2a. Package & Upload Station Set (Metadata)
            // Ideally check if this stationSetId already exists to skip re-uploading common metadata
            const stationSetPkg = await packageArtifact(stationSet);
            const ssKey = `chunks/${stationSetPkg.hash}`;

            if (!(await storage.exists(ssKey))) {
                await storage.put(ssKey, stationSetPkg.blob);
                console.log(`[ingest] Uploaded StationSet → ${stationSetPkg.hash.slice(0, 12)}...`);
            }
            // Always add to manifest so clients can discover it if they need it?
            // Actually, clients find it via the ObservationArtifact's stationSetId reference.
            // But we add it to manifest so the "set of all valid chunks" is complete for this day.
            artifacts.push(createManifestEntry(stationSet, stationSetPkg.hash, stationSetPkg.blob.length));

            // 2b. Package & Upload Observation (Data)
            const obsPkg = await packageArtifact(observation);
            const obsKey = `chunks/${obsPkg.hash}`;

            if (!(await storage.exists(obsKey))) {
                await storage.put(obsKey, obsPkg.blob);
                console.log(`[ingest] Uploaded Observation → ${obsPkg.hash.slice(0, 12)}...`);
            }

            artifacts.push(createManifestEntry(observation, obsPkg.hash, obsPkg.blob.length));
        }
    } catch (error) {
        console.warn('[ingest] Failed to fetch observations:', error);
    }

    // 3. Get previous manifest hash for chain
    const today = getTodayDateString();
    const existingManifests = await storage.list(`manifests/${today}/`);
    const previousManifestHash = existingManifests.length > 0
        ? existingManifests[existingManifests.length - 1].split('/').pop()
        : undefined;

    // 4. Create and upload manifest
    const manifest = createManifest({
        date: today,
        artifacts,
        previousManifestHash
    });

    const { blob: manifestBlob, hash: manifestHash } = await packageManifest(manifest);
    await storage.put(`manifests/${today}/${manifestHash}`, manifestBlob);
    console.log(`[ingest] Published manifest → ${manifestHash.slice(0, 12)}...`);

    // 5. Update root pointer (the ONLY mutable object)
    const rootJson = JSON.stringify({ latest: today });
    await storage.put('manifests/root.json', new TextEncoder().encode(rootJson));

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
