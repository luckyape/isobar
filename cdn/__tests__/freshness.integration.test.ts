
import { describe, it, expect } from 'vitest';
import { computeLocationScopeId } from '../location';
import { unpackageArtifact } from '../artifact';
import { unpackageManifest } from '../manifest';
import { type ObservationArtifact } from '../types';

const CDN_BASE_URL = process.env.CDN_TEST_URL || 'https://weather-forecast-cdn.graham-cbc.workers.dev';
const FRESHNESS_THRESHOLD_HOURS = 6; // Align with closet freshness signal
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type RootManifest = { latest: string; latestManifestHash: string };

describe('Observation Freshness', () => {
    // User's specific "Montreal" from search results
    const TEST_LOC = {
        name: 'Montreal (User)',
        latitude: 45.5088,
        longitude: -73.5878,
        timezone: 'America/Toronto'
    };

    it('ingests on-demand and exposes fresh observations', async () => {
        // Kick off a fresh ingest for this location to avoid stale roots
        const ingestResp = await fetch(`${CDN_BASE_URL}/ingest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                latitude: TEST_LOC.latitude,
                longitude: TEST_LOC.longitude,
                timezone: TEST_LOC.timezone
            })
        });
        expect(ingestResp.status).toBe(200);
        const ingestData = await ingestResp.json() as { success?: boolean; manifestHash?: string };
        expect(ingestData.success).toBe(true);
        expect(ingestData.manifestHash).toMatch(/^[a-f0-9]{64}$/i);

        const scopeId = computeLocationScopeId({
            latitude: TEST_LOC.latitude,
            longitude: TEST_LOC.longitude,
            timezone: TEST_LOC.timezone
        });
        const rootUrl = `${CDN_BASE_URL}/locations/${scopeId}/manifests/root.json`;
        console.log(`Fetching root: ${rootUrl}`);

        const fetchRoot = async (): Promise<RootManifest> => {
            const resp = await fetch(rootUrl);
            if (!resp.ok) {
                console.error(`Status: ${resp.status} ${resp.statusText}`);
                console.error(await resp.text());
            }
            expect(resp.status).toBe(200);
            return resp.json() as Promise<RootManifest>;
        };

        let root = await fetchRoot();
        for (let attempt = 0; attempt < 3 && root.latestManifestHash !== ingestData.manifestHash; attempt += 1) {
            console.log(`Root mismatch (got ${root.latestManifestHash}, expected ${ingestData.manifestHash}); retrying...`);
            await sleep(1000);
            root = await fetchRoot();
        }

        expect(root.latestManifestHash).toMatch(/^[a-f0-9]{64}$/i);
        // Newly ingested manifest should be the active pointer
        expect(root.latestManifestHash).toBe(ingestData.manifestHash);

        const manifestUrl = `${CDN_BASE_URL}/locations/${scopeId}/manifests/${root.latest}/${root.latestManifestHash}`;
        console.log(`Fetching manifest: ${manifestUrl}`);

        const manifestResp = await fetch(manifestUrl);
        expect(manifestResp.ok).toBe(true);
        const manifestBlob = await manifestResp.arrayBuffer();

        // Unpackage the manifest
        const manifest = await unpackageManifest(new Uint8Array(manifestBlob));
        console.log(`Manifest published at: ${manifest.publishedAt}`);

        // VERIFY LISTING ENDPOINT (Critical for Client SyncEngine)
        // Client performs: GET /locations/<scopeId>/manifests/<date>/ to find hashes
        const listUrl = `${CDN_BASE_URL}/locations/${scopeId}/manifests/${root.latest}/`;
        console.log(`Verifying listing endpoint: ${listUrl}`);
        const listResp = await fetch(listUrl);
        expect(listResp.ok).toBe(true);
        const listHashes = await listResp.json() as string[];
        console.log(`Listing returned ${listHashes.length} hashes:`, listHashes);
        expect(listHashes).toContain(root.latestManifestHash);

        // Find the latest observation entry
        const obsEntries = manifest.artifacts
            .filter((a: any) => a.type === 'observation')
            .sort((a: any, b: any) => (b.observedAtBucket || '').localeCompare(a.observedAtBucket || ''));

        const obsEntry = obsEntries[0];
        expect(obsEntry).toBeDefined();
        console.log(`Found observation entry: ${obsEntry.hash} (bucket: ${obsEntry.observedAtBucket})`);

        // Fetch the observation blob
        const blobUrl = `${CDN_BASE_URL}/chunks/${obsEntry.hash}`;
        console.log(`Fetching observation blob: ${blobUrl}`);
        const blobResp = await fetch(blobUrl);
        expect(blobResp.ok).toBe(true);

        const blobData = await blobResp.arrayBuffer();
        const artifact = await unpackageArtifact(new Uint8Array(blobData)) as ObservationArtifact;

        console.log(`Observation Artifact Bucket: ${artifact.observedAtBucket}`);
        console.log(`Observation Artifact FetchedAt: ${new Date(artifact.fetchedAt * 1000).toISOString()}`);

        const obsTime = new Date(artifact.observedAtBucket).getTime();
        const now = Date.now();
        const ageHours = (now - obsTime) / (1000 * 60 * 60);

        console.log(`Observation Age: ${ageHours.toFixed(2)} hours`);

        // Assert freshness: Must be within the freshness window
        expect(ageHours).toBeLessThan(FRESHNESS_THRESHOLD_HOURS);
    }, 60000);
});
