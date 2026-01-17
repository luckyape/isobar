/**
 * Weather Forecast CDN — Compression Utilities
 *
 * Cross-environment compression using gzip (native CompressionStream API).
 *
 * ENCODING REGISTRY:
 *   0x00000001 = GZIP + MsgPack (current default)
 *   0x00000002 = Reserved (Brotli + MsgPack for future)
 *   0x00000003 = Reserved (Zstd + MsgPack for future)
 */

// Encoding flag constants
export const ENCODING_GZIP_MSGPACK = 0x00000001;
export const ENCODING_BR_MSGPACK = 0x00000002;   // Reserved
export const ENCODING_ZSTD_MSGPACK = 0x00000003; // Reserved

/**
 * Compress data using gzip.
 */
export async function compress(data: Uint8Array): Promise<Uint8Array> {
    return compressGzip(data);
}

/**
 * Decompress data based on encoding flags.
 * CRITICAL: Unknown encoding = hard fail. No silent fallbacks.
 */
export async function decompressWithEncoding(
    data: Uint8Array,
    encodingFlags: number
): Promise<Uint8Array> {
    switch (encodingFlags) {
        case ENCODING_GZIP_MSGPACK:
            return decompressGzip(data);

        case ENCODING_BR_MSGPACK:
            throw new Error('Brotli encoding not yet implemented (reserved)');

        case ENCODING_ZSTD_MSGPACK:
            throw new Error('Zstd encoding not yet implemented (reserved)');

        default:
            throw new Error(`Unknown encoding flags: 0x${encodingFlags.toString(16).padStart(8, '0')}`);
    }
}

/**
 * Legacy decompress (assumes gzip). Use decompressWithEncoding for new code.
 */
export async function decompress(data: Uint8Array): Promise<Uint8Array> {
    return decompressGzip(data);
}

// =============================================================================
// Gzip Implementation
// =============================================================================

async function compressGzip(data: Uint8Array): Promise<Uint8Array> {
    if (typeof CompressionStream === 'undefined') {
        throw new Error('CompressionStream not available: cannot produce gzip artifacts. Polyfill required in this environment.');
    }

    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(data);
    writer.close();

    const chunks: Uint8Array[] = [];
    const reader = cs.readable.getReader();

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
    }

    return concatChunks(chunks);
}

async function decompressGzip(data: Uint8Array): Promise<Uint8Array> {
    if (typeof DecompressionStream === 'undefined') {
        throw new Error('DecompressionStream not available: cannot read gzip artifacts. Polyfill required in this environment.');
    }

    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();

    // Write in background so we can read concurrently (avoids deadlock on backpressure)
    const writePromise = (async () => {
        await writer.write(data);
        await writer.close();
    })();

    const chunks: Uint8Array[] = [];

    // Read loop
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) chunks.push(value);
        }
    } finally {
        // Ensure proper cleanup if reading fails
        await writePromise;
    }

    return concatChunks(chunks);
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}
