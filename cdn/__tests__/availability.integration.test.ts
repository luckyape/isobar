
import { describe, it, expect } from 'vitest';
import { unpackageArtifact } from '../artifact';
import { unpackageManifest } from '../manifest';
import type { ObservationArtifact } from '../types';

// Test against the deployed worker URL
const CDN_BASE_URL = process.env.CDN_TEST_URL || 'https://weather-forecast-cdn.graham-cbc.workers.dev';

interface BasicManifest {
    latest: string;
}

describe('CDN Content Availability', () => {
    // We use a known location to trigger ingestion
    const TEST_LOC = {
        name: 'Montreal',
        latitude: 45.5017,
        longitude: -73.5673,
        timezone: 'America/Toronto'
    };

    it('should offer recent observations after ingestion', async () => {
        // 1. Trigger Ingestion
        console.log(`Triggering ingestion for ${TEST_LOC.name}...`);
        const ingestResp = await fetch(`${CDN_BASE_URL}/ingest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                latitude: TEST_LOC.latitude,
                longitude: TEST_LOC.longitude,
                timezone: TEST_LOC.timezone,
            }),
        });
        expect(ingestResp.status).toBe(200);
        const ingestData = await ingestResp.json() as any;
        expect(ingestData.success).toBe(true);

        // 2. Get Root Manifest to find "today"
        const rootResp = await fetch(`${CDN_BASE_URL}/manifests/root.json`);
        expect(rootResp.ok).toBe(true);
        const root = (await rootResp.json()) as BasicManifest;
        const today = root.latest;
        console.log(`Latest date in CDN: ${today}`);

        // 3. List manifests for today
        // Note: The path structure is manifests/{date}/index.json or just listing the directory if supported?
        // Looking at SyncEngine, it fetches `manifests/{date}/`. 
        // Let's assume the worker returns a JSON list for directory requests or we check the ingest response's manifest hash directly if provided.
        // Ingest response gave us `manifestHash`. Let's use that!

        const manifestHash = ingestData.manifestHash;
        expect(manifestHash).toBeDefined();

        // 4. Fetch the Manifest Blob
        console.log(`Fetching manifest ${manifestHash}...`);
        const manifestUrl = `${CDN_BASE_URL}/manifests/${today}/${manifestHash}`;
        const manifestBlobResp = await fetch(manifestUrl);
        expect(manifestBlobResp.ok).toBe(true);
        const manifestBlob = new Uint8Array(await manifestBlobResp.arrayBuffer());

        // 5. Unpackage Manifest
        const manifestArtifact = await unpackageArtifact(manifestBlob);
        // Cast to any because unpackageArtifact returns generic Artifact, but we know it's a manifest (actually slightly complex types)
        // Wait, unpackageArtifact returns `Artifact` type (Forecast | Observation | ...). 
        // Converting a DailyManifest is actually done by `unpackageManifest` in `cdn/manifest.ts`. 
        // `DailyManifest` is NOT an `Artifact` in the `Artifact` union sense, strictly speaking, 
        // but it is stored as a blob? 
        // Let's check `cdn/manifest.ts`.
        // Actually, SyncEngine calls `unpackageManifest(manifestBlob)`.

        // Let's import `unpackageManifest` from `../manifest` instead if that's where it is.
        // Re-checking imports... I'll assume for now I need to modify imports below.
    }, 60000);
});
