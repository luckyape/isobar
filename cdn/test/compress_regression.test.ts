/**
 * Gzip Decompression Regression Test
 * 
 * Regression test for the gzip deadlock fix in cdn/compress.ts.
 * The fix ensures concurrent write/read on DecompressionStream to prevent
 * buffering deadlocks on large payloads.
 */

import { describe, it, expect } from 'vitest';
import { compress, decompress } from '../compress';

describe('Gzip Decompression Regression', () => {
    it('does not deadlock on payloads larger than stream buffer (64KB+)', async () => {
        // Create a payload larger than typical stream buffer sizes
        // DecompressionStream typically uses ~64KB internal buffers
        const largePayloadSize = 128 * 1024; // 128KB
        const largePayload = new Uint8Array(largePayloadSize);

        // Fill with compressible data pattern
        for (let i = 0; i < largePayloadSize; i++) {
            largePayload[i] = i % 256;
        }

        // Compress
        const compressed = await compress(largePayload);
        expect(compressed.length).toBeLessThan(largePayloadSize); // Verify compression worked

        // Decompress with timeout to detect deadlock
        // OLD BUG: Sequential write-then-read could deadlock if compressed data
        // was large enough to fill internal buffers before read started.
        // FIX: Concurrent write/read via Promise.all
        const decompressPromise = decompress(compressed);

        // Use Promise.race with timeout to detect deadlock
        const timeout = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('DEADLOCK: Decompression timed out')), 5000);
        });

        const decompressed = await Promise.race([decompressPromise, timeout]);

        // Verify integrity
        expect(decompressed.length).toBe(largePayloadSize);
        expect(decompressed).toEqual(largePayload);
    });

    it('handles empty payloads correctly', async () => {
        const empty = new Uint8Array(0);
        const compressed = await compress(empty);
        const decompressed = await decompress(compressed);
        expect(decompressed.length).toBe(0);
    });

    it('handles small payloads correctly', async () => {
        const small = new Uint8Array([1, 2, 3, 4, 5]);
        const compressed = await compress(small);
        const decompressed = await decompress(compressed);
        expect(decompressed).toEqual(small);
    });
});
