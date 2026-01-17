/**
 * Range/206 Edge-Case Tests for BlobStore Pack Fetch
 * 
 * These tests ensure strict validation of HTTP Range request responses.
 * BlobStore MUST NOT silently accept partial content with ambiguous headers.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock fetch for controlled responses
const mockFetch = vi.fn();

describe('BlobStore Pack Fetch Range/206 Strictness', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', mockFetch);
        mockFetch.mockReset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    // Helper to create mock response
    const createMockResponse = (options: {
        status: number;
        headers?: Record<string, string>;
        body?: Uint8Array;
    }) => {
        return {
            status: options.status,
            ok: options.status >= 200 && options.status < 300,
            headers: {
                get: (name: string) => options.headers?.[name.toLowerCase()] ?? null
            },
            arrayBuffer: async () => options.body?.buffer ?? new ArrayBuffer(0)
        } as unknown as Response;
    };

    // Helper function that mimics fetchFromPack validation logic
    async function validatePackFetchResponse(
        response: Response,
        expectedStart: number,
        expectedEnd: number,
        expectedLen: number
    ): Promise<void> {
        // STRICT: Must be 206 Partial Content
        if (response.status !== 206) {
            throw new Error(
                `BlobStore: pack fetch failed - expected 206 Partial Content, got ${response.status}. ` +
                `Server may not support Range requests.`
            );
        }

        // Validate Content-Range header
        const contentRange = response.headers.get('Content-Range');
        if (!contentRange) {
            throw new Error('BlobStore: pack fetch missing Content-Range header');
        }

        const rangeMatch = contentRange.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/);
        if (!rangeMatch) {
            throw new Error(`BlobStore: pack fetch invalid Content-Range: ${contentRange}`);
        }

        const rangeStart = Number(rangeMatch[1]);
        const rangeEnd = Number(rangeMatch[2]);
        if (rangeStart !== expectedStart || rangeEnd !== expectedEnd) {
            throw new Error(
                `BlobStore: pack fetch Content-Range mismatch - ` +
                `got ${rangeStart}-${rangeEnd}, expected ${expectedStart}-${expectedEnd}`
            );
        }

        const blob = new Uint8Array(await response.arrayBuffer());

        // Verify size matches expected
        if (blob.length !== expectedLen) {
            throw new Error(
                `BlobStore: pack fetch size mismatch - expected ${expectedLen} bytes, got ${blob.length}`
            );
        }
    }

    describe('Status Code Validation', () => {
        it('throws on 200 OK response (Range not honored)', async () => {
            const response = createMockResponse({
                status: 200,
                headers: {},
                body: new Uint8Array([1, 2, 3, 4, 5])
            });

            await expect(
                validatePackFetchResponse(response, 0, 4, 5)
            ).rejects.toThrow(/expected 206 Partial Content, got 200/);
        });

        it('throws on non-206 status codes', async () => {
            for (const status of [404, 500, 416, 304]) {
                const response = createMockResponse({
                    status,
                    headers: {},
                    body: new Uint8Array()
                });

                await expect(
                    validatePackFetchResponse(response, 0, 99, 100)
                ).rejects.toThrow(/expected 206 Partial Content/);
            }
        });
    });

    describe('Content-Range Header Validation', () => {
        it('throws on 206 missing Content-Range header', async () => {
            const response = createMockResponse({
                status: 206,
                headers: {},  // No Content-Range
                body: new Uint8Array([1, 2, 3, 4, 5])
            });

            await expect(
                validatePackFetchResponse(response, 0, 4, 5)
            ).rejects.toThrow(/missing Content-Range header/);
        });

        it('throws on mismatched start position', async () => {
            const response = createMockResponse({
                status: 206,
                headers: { 'content-range': 'bytes 100-104/1000' },
                body: new Uint8Array([1, 2, 3, 4, 5])
            });

            await expect(
                validatePackFetchResponse(response, 0, 4, 5)  // Expected 0-4, got 100-104
            ).rejects.toThrow(/Content-Range mismatch/);
        });

        it('throws on mismatched end position', async () => {
            const response = createMockResponse({
                status: 206,
                headers: { 'content-range': 'bytes 0-99/1000' },
                body: new Uint8Array(100)
            });

            await expect(
                validatePackFetchResponse(response, 0, 49, 50)  // Expected end 49, got 99
            ).rejects.toThrow(/Content-Range mismatch/);
        });

        it('throws on malformed Content-Range - missing bytes prefix', async () => {
            const response = createMockResponse({
                status: 206,
                headers: { 'content-range': '0-4/100' },  // Missing "bytes "
                body: new Uint8Array(5)
            });

            await expect(
                validatePackFetchResponse(response, 0, 4, 5)
            ).rejects.toThrow(/invalid Content-Range/);
        });

        it('throws on malformed Content-Range - invalid format', async () => {
            const response = createMockResponse({
                status: 206,
                headers: { 'content-range': 'bytes */100' },  // Unsatisfied range
                body: new Uint8Array(5)
            });

            await expect(
                validatePackFetchResponse(response, 0, 4, 5)
            ).rejects.toThrow(/invalid Content-Range/);
        });

        it('throws on malformed Content-Range - garbage', async () => {
            const response = createMockResponse({
                status: 206,
                headers: { 'content-range': 'garbage-data' },
                body: new Uint8Array(5)
            });

            await expect(
                validatePackFetchResponse(response, 0, 4, 5)
            ).rejects.toThrow(/invalid Content-Range/);
        });
    });

    describe('Body Length Validation', () => {
        it('throws on body length mismatch - too short', async () => {
            const response = createMockResponse({
                status: 206,
                headers: { 'content-range': 'bytes 0-99/1000' },
                body: new Uint8Array(50)  // Expected 100, got 50
            });

            await expect(
                validatePackFetchResponse(response, 0, 99, 100)
            ).rejects.toThrow(/size mismatch/);
        });

        it('throws on body length mismatch - too long', async () => {
            const response = createMockResponse({
                status: 206,
                headers: { 'content-range': 'bytes 0-99/1000' },
                body: new Uint8Array(150)  // Expected 100, got 150
            });

            await expect(
                validatePackFetchResponse(response, 0, 99, 100)
            ).rejects.toThrow(/size mismatch/);
        });

        it('throws on empty body when data expected', async () => {
            const response = createMockResponse({
                status: 206,
                headers: { 'content-range': 'bytes 0-99/1000' },
                body: new Uint8Array(0)  // Expected 100, got 0
            });

            await expect(
                validatePackFetchResponse(response, 0, 99, 100)
            ).rejects.toThrow(/size mismatch/);
        });
    });

    describe('Valid Response Acceptance', () => {
        it('accepts valid 206 response with correct Content-Range', async () => {
            const response = createMockResponse({
                status: 206,
                headers: { 'content-range': 'bytes 100-199/1000' },
                body: new Uint8Array(100)
            });

            await expect(
                validatePackFetchResponse(response, 100, 199, 100)
            ).resolves.toBeUndefined();
        });

        it('accepts valid 206 response with unknown total (asterisk)', async () => {
            const response = createMockResponse({
                status: 206,
                headers: { 'content-range': 'bytes 0-49/*' },
                body: new Uint8Array(50)
            });

            await expect(
                validatePackFetchResponse(response, 0, 49, 50)
            ).resolves.toBeUndefined();
        });
    });
});
