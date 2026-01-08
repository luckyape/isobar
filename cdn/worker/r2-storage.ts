/**
 * Weather Forecast CDN — R2 Storage Backend
 *
 * Implementation of StorageBackend for Cloudflare R2.
 */

import type { StorageBackend } from '../ingest/pipeline';

export interface R2Bucket {
    put(key: string, value: ArrayBuffer | Uint8Array | string | ReadableStream): Promise<R2Object>;
    get(key: string): Promise<R2ObjectBody | null>;
    head(key: string): Promise<R2Object | null>;
    list(options?: R2ListOptions): Promise<R2Objects>;
}

interface R2Object {
    key: string;
    size: number;
    etag: string;
}

interface R2ObjectBody extends R2Object {
    arrayBuffer(): Promise<ArrayBuffer>;
}

interface R2ListOptions {
    prefix?: string;
    limit?: number;
    cursor?: string;
}

interface R2Objects {
    objects: R2Object[];
    truncated: boolean;
    cursor?: string;
}

/**
 * R2 storage backend for the CDN.
 */
export class R2Storage implements StorageBackend {
    constructor(private bucket: R2Bucket) { }

    async exists(key: string): Promise<boolean> {
        const object = await this.bucket.head(key);
        return object !== null;
    }

    async put(key: string, data: Uint8Array): Promise<void> {
        // R2 put is idempotent - same key = overwrite, but since we're content-addressed
        // the content will be identical, which is fine
        await this.bucket.put(key, data);
    }

    async get(key: string): Promise<Uint8Array | null> {
        const object = await this.bucket.get(key);
        if (!object) return null;
        const buffer = await object.arrayBuffer();
        return new Uint8Array(buffer);
    }

    async list(prefix: string): Promise<string[]> {
        const keys: string[] = [];
        let cursor: string | undefined;

        do {
            const result = await this.bucket.list({
                prefix,
                limit: 1000,
                cursor
            });

            for (const object of result.objects) {
                keys.push(object.key);
            }

            cursor = result.truncated ? result.cursor : undefined;
        } while (cursor);

        return keys;
    }
}
