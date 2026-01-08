
import { describe, it, expect } from 'vitest';
import { compress, decompressWithEncoding, ENCODING_GZIP_MSGPACK } from '../compress';

describe('Compression Safety', () => {
    it('round trips correctly', async () => {
        const data = new Uint8Array([1, 2, 3, 4]);
        const compressed = await compress(data);
        const decompressed = await decompressWithEncoding(compressed, ENCODING_GZIP_MSGPACK);
        expect(decompressed).toEqual(data);
    });

    it('fails if encoding flag unknown', async () => {
        const data = new Uint8Array([1, 2, 3]);
        // Valid gzip
        const compressed = await compress(data);
        // Invalid flag (e.g. 99)
        await expect(decompressWithEncoding(compressed, 99))
            .rejects.toThrow(/Unknown encoding/);
    });

    it('fails if claimed gzip is not gzip', async () => {
        const fakeGzip = new Uint8Array([1, 2, 3]); // Not gzip
        await expect(decompressWithEncoding(fakeGzip, ENCODING_GZIP_MSGPACK))
            .rejects.toThrow(); // Should throw from decompress stream
    });
});
