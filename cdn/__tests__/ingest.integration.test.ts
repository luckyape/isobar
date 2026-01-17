/**
 * CDN Worker - Ingest Endpoint Integration Tests
 *
 * These tests verify that the POST /ingest endpoint correctly triggers
 * data ingestion for arbitrary locations.
 */

import { describe, it, expect, beforeAll } from 'vitest';

// Test against the deployed worker URL
const CDN_BASE_URL = process.env.CDN_TEST_URL || 'https://weather-forecast-cdn.graham-cbc.workers.dev';

interface IngestResponse {
    success?: boolean;
    manifestHash?: string;
    artifacts?: number;
    timestamp?: string;
    error?: string;
    message?: string;
}

interface RootManifest {
    latest: string;
    latestManifestHash: string;
    scope: {
        version: number;
        latitude: number;
        longitude: number;
        timezone: string;
        decimals: number;
    };
}

const TEST_LOCATIONS = [
    { name: 'Montreal', latitude: 45.5017, longitude: -73.5673, timezone: 'America/Toronto' },
    { name: 'Vancouver', latitude: 49.2827, longitude: -123.1207, timezone: 'America/Vancouver' },
    { name: 'Calgary', latitude: 51.0447, longitude: -114.0719, timezone: 'America/Edmonton' },
];

describe('CDN POST /ingest endpoint', () => {
    describe('Input validation', () => {
        it('should reject requests with missing latitude', async () => {
            const response = await fetch(`${CDN_BASE_URL}/ingest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ longitude: -73.5673, timezone: 'America/Toronto' }),
            });

            expect(response.status).toBe(400);
            const data = (await response.json()) as IngestResponse;
            expect(data.error).toBe('INVALID_LOCATION');
        }, 30000);

        it('should reject requests with missing longitude', async () => {
            const response = await fetch(`${CDN_BASE_URL}/ingest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ latitude: 45.5017, timezone: 'America/Toronto' }),
            });

            expect(response.status).toBe(400);
            const data = (await response.json()) as IngestResponse;
            expect(data.error).toBe('INVALID_LOCATION');
        }, 30000);

        it('should reject requests with non-finite coordinates', async () => {
            const response = await fetch(`${CDN_BASE_URL}/ingest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ latitude: NaN, longitude: -73.5673, timezone: 'America/Toronto' }),
            });

            expect(response.status).toBe(400);
            const data = (await response.json()) as IngestResponse;
            expect(data.error).toBe('INVALID_LOCATION');
        }, 30000);
    });

    describe('Successful ingestion', () => {
        it.each(TEST_LOCATIONS)(
            'should ingest data for $name and return valid manifest',
            async ({ name, latitude, longitude, timezone }) => {
                const response = await fetch(`${CDN_BASE_URL}/ingest`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ latitude, longitude, timezone }),
                });

                expect(response.status).toBe(200);
                const data = (await response.json()) as IngestResponse;

                expect(data.success).toBe(true);
                expect(data.manifestHash).toMatch(/^[a-f0-9]{64}$/i);
                expect(data.artifacts).toBeGreaterThanOrEqual(1);
                expect(data.timestamp).toBeDefined();

                console.log(`[${name}] Ingested ${data.artifacts} artifacts, manifest: ${data.manifestHash?.slice(0, 12)}...`);
            },
            { timeout: 30000 } // Give each ingest up to 30s
        );
    });

    describe('Manifest verification', () => {
        it('should update root.json scope to match last ingested location', async () => {
            // Ingest for a specific location first
            const testLoc = TEST_LOCATIONS[0];
            await fetch(`${CDN_BASE_URL}/ingest`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    latitude: testLoc.latitude,
                    longitude: testLoc.longitude,
                    timezone: testLoc.timezone,
                }),
            });

            // Then check root.json
            const rootResponse = await fetch(`${CDN_BASE_URL}/manifests/root.json`);
            expect(rootResponse.ok).toBe(true);

            const root = (await rootResponse.json()) as RootManifest;
            expect(root.latest).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(root.latestManifestHash).toMatch(/^[a-f0-9]{64}$/i);
            expect(root.scope).toBeDefined();
            expect(root.scope.latitude).toBeCloseTo(testLoc.latitude, 3);
            expect(root.scope.longitude).toBeCloseTo(testLoc.longitude, 3);
        }, 30000);
    });
});
