/**
 * BlobStore Tests — Pack scaffolding strictness
 *
 * Tests pack fetch requirements and blob store behavior using mocks.
 * Does not require IndexedDB - tests the fetch/verification logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { packageArtifact, getBlobContentHash } from '@cdn/artifact';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a test artifact and package it.
 */
async function createTestBlob() {
    const artifact = {
        type: 'forecast' as const,
        schemaVersion: 1,
        model: 'test',
        runTime: '2026-01-08T00:00:00Z',
        issuedAt: Date.now(),
        validTimes: [],
        variables: [],
        grid: { type: 'point' as const, lat: 0, lon: 0 },
        data: {},
        variableMap: {},
        source: 'test'
    };
    return packageArtifact(artifact);
}

/**
 * Simulate pack fetch logic.
 */
async function fetchFromPack(
    packId: string,
    off: number,
    len: number,
    expectedHash: string,
    mockFetch: (url: string, options: any) => Promise<Response>
): Promise<Uint8Array> {
    const url = `http://test/packs/${packId}`;
    const response = await mockFetch(url, {
        headers: { 'Range': `bytes=${off}-${off + len - 1}` }
    });

    // STRICT: Must be 206 Partial Content
    if (response.status !== 206) {
        throw new Error(
            `Pack fetch failed - expected 206 Partial Content, got ${response.status}`
        );
    }

    const blob = new Uint8Array(await response.arrayBuffer());

    if (blob.length !== len) {
        throw new Error(`Pack fetch size mismatch - expected ${len} bytes, got ${blob.length}`);
    }

    const actualHash = getBlobContentHash(blob);
    if (actualHash !== expectedHash.toLowerCase()) {
        throw new Error(`Pack fetch integrity check failed - expected ${expectedHash}, got ${actualHash}`);
    }

    return blob;
}

/**
 * Simulate loose blob fetch.
 */
async function fetchLoose(
    hash: string,
    mockFetch: (url: string) => Promise<Response>
): Promise<Uint8Array> {
    const url = `http://test/chunks/${hash}`;
    const response = await mockFetch(url);

    if (!response.ok) {
        throw new Error(`Loose fetch failed - ${response.status} for hash ${hash}`);
    }

    const blob = new Uint8Array(await response.arrayBuffer());

    const actualHash = getBlobContentHash(blob);
    if (actualHash !== hash.toLowerCase()) {
        throw new Error(`Loose fetch integrity check failed - expected ${hash}, got ${actualHash}`);
    }

    return blob;
}

// =============================================================================
// Tests
// =============================================================================

describe('BlobStore Tests', () => {
    let testBlob: Uint8Array;
    let testHash: string;

    beforeEach(async () => {
        const packaged = await createTestBlob();
        testBlob = packaged.blob;
        testHash = packaged.hash;
    });

    describe('Pack Fetch Strictness', () => {
        it('succeeds when pack fetch returns 206 Partial Content', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                status: 206,
                ok: true,
                arrayBuffer: () => Promise.resolve(testBlob.buffer.slice(0))
            });

            const result = await fetchFromPack('pack-001', 0, testBlob.length, testHash, mockFetch);

            expect(result).toBeInstanceOf(Uint8Array);
            expect(result.length).toBe(testBlob.length);
            expect(mockFetch).toHaveBeenCalledWith(
                'http://test/packs/pack-001',
                expect.objectContaining({
                    headers: { 'Range': `bytes=0-${testBlob.length - 1}` }
                })
            );
        });

        it('throws error when pack fetch returns 200 instead of 206', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                status: 200,
                ok: true,
                arrayBuffer: () => Promise.resolve(testBlob.buffer.slice(0))
            });

            await expect(
                fetchFromPack('pack-002', 100, testBlob.length, testHash, mockFetch)
            ).rejects.toThrow(/expected 206 Partial Content, got 200/);
        });

        it('throws error on size mismatch from pack', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                status: 206,
                ok: true,
                arrayBuffer: () => Promise.resolve(testBlob.buffer.slice(0))
            });

            // Expect 999999 bytes but get testBlob.length
            await expect(
                fetchFromPack('pack-003', 0, 999999, testHash, mockFetch)
            ).rejects.toThrow(/size mismatch/);
        });
    });

    describe('Loose Blob Fallback', () => {
        it('fetches from /chunks/<hash> for loose blobs', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                status: 200,
                ok: true,
                arrayBuffer: () => Promise.resolve(testBlob.buffer.slice(0))
            });

            const result = await fetchLoose(testHash, mockFetch);

            expect(result).toBeInstanceOf(Uint8Array);
            expect(mockFetch).toHaveBeenCalledWith(`http://test/chunks/${testHash}`);
        });

        it('throws on loose fetch failure', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                status: 404,
                ok: false
            });

            await expect(
                fetchLoose(testHash, mockFetch)
            ).rejects.toThrow(/Loose fetch failed.*404/);
        });
    });

    describe('Hash Verification', () => {
        it('throws on hash mismatch from loose fetch', async () => {
            const wrongBlob = new Uint8Array([1, 2, 3, 4, 5]);

            const mockFetch = vi.fn().mockResolvedValue({
                status: 200,
                ok: true,
                arrayBuffer: () => Promise.resolve(wrongBlob.buffer.slice(0))
            });

            // Small blob fails before hash check (blob too small for header extraction)
            await expect(
                fetchLoose(testHash, mockFetch)
            ).rejects.toThrow(/too small|integrity check failed/);
        });

        it('accepts correct blob with matching hash', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                status: 200,
                ok: true,
                arrayBuffer: () => Promise.resolve(testBlob.buffer.slice(0))
            });

            const result = await fetchLoose(testHash, mockFetch);

            expect(result.length).toBe(testBlob.length);
        });
    });

    describe('Range Header Format', () => {
        it('uses correct range header format', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                status: 206,
                ok: true,
                arrayBuffer: () => Promise.resolve(testBlob.buffer.slice(0))
            });

            await fetchFromPack('pack-004', 100, testBlob.length, testHash, mockFetch);

            // Range should be bytes=100-{100+len-1}
            expect(mockFetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: { 'Range': `bytes=100-${100 + testBlob.length - 1}` }
                })
            );
        });
    });
});
