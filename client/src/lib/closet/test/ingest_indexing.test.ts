import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onSyncComplete, MaintenanceParams } from '../maintenance';
import * as dbModule from '../db';
import * as storeModule from '../../vault/store';
import { packageArtifact } from '@cdn/artifact';
import { createManifest, packageManifest } from '@cdn/manifest';

describe('Ingest Indexing', () => {
    let mockVault: any;
    let mockDB: any;

    beforeEach(() => {
        // Mock Vault
        const vaultStorage = new Map<string, Uint8Array>();
        mockVault = {
            open: vi.fn(),
            getBlob: vi.fn().mockImplementation(async (id) => vaultStorage.get(id)),
            getMeta: vi.fn().mockReturnValue(null), // Empty manifest index
            setMeta: vi.fn(),
        };
        mockVault.put = async (id: string, data: Uint8Array) => vaultStorage.set(id, data);

        vi.spyOn(storeModule, 'getVault').mockReturnValue(mockVault);

        // Mock ClosetDB
        mockDB = {
            open: vi.fn(),
            upsertManifestRef: vi.fn(),
            upsertObservationIndex: vi.fn(),
            upsertForecastIndex: vi.fn(),
            getBlobMeta: vi.fn(),
            upsertBlobMeta: vi.fn(),
            getTotalBytesPresent: vi.fn().mockReturnValue(0),
            getLastGcAt: vi.fn().mockReturnValue(0),
            setTotalBytesPresent: vi.fn(),
        };
        vi.spyOn(dbModule, 'getClosetDB').mockReturnValue(mockDB);
    });

    it('indexes observations from new manifests', async () => {
        // 1. Create a fake observation artifact
        const obsData = {
            type: 'observation',
            source: 'test-source',
            observedAtBucket: '2024-01-01T12:00:00Z',
            stationSetId: 'station-set-123',
            data: {}
        };
        const { blob: obsBlob, hash: obsHash } = await packageArtifact(obsData as any);
        await mockVault.put(obsHash, obsBlob);

        // 2. Create a manifest pointing to it
        const manifest = createManifest({
            date: '2024-01-01',
            artifacts: [
                { hash: obsHash, type: 'observation', sizeBytes: obsBlob.length, source: 'test-source', observedAtBucket: '2024-01-01T12:00:00Z', stationSetId: 'station-set-123' }
            ]
        });
        const { blob: manifestBlob, hash: manifestHash } = await packageManifest(manifest);
        await mockVault.put(manifestHash, manifestBlob);

        // 3. Run onSyncComplete
        const params: MaintenanceParams = {
            sync: {
                newArtifactHashes: [obsHash],
                newManifestHashes: [manifestHash]
            },
            policy: {
                retentionDays: { observation: 7, forecast: 7 },
                quotaBytes: 1000
            } as any,
            nowMs: Date.now(),
            trustMode: 'unverified'
        };

        const result = await onSyncComplete(params);

        // 4. Verify indexing calls
        expect(mockDB.upsertManifestRef).toHaveBeenCalledWith('2024-01-01', 'daily', '', manifestHash);

        expect(mockDB.upsertObservationIndex).toHaveBeenCalledWith(expect.objectContaining({
            source: 'test-source',
            observedAtBucket: '2024-01-01T12:00', // Normalized to minute
            stationSetId: 'station-set-123',
            hash: obsHash
        }));

        expect(result.indexedObservations).toBe(1);
    });
});
