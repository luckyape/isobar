import worker, { type Env } from '../worker/index';
import type { R2Bucket } from '../worker/r2-storage';
import { packageManifest } from '../manifest';
import { CURRENT_SCHEMA_VERSION, type DailyManifest } from '../types';

type Stored = {
    key: string;
    body?: Uint8Array;
    etag: string;
};

function textBytes(value: string): Uint8Array {
    return new TextEncoder().encode(value);
}

function makeHash(i: number): string {
    return i.toString(16).padStart(64, '0');
}

class MockBucket implements R2Bucket {
    private objects = new Map<string, Stored>();
    listCalls = 0;

    async put(key: string, value: ArrayBuffer | Uint8Array | string | ReadableStream): Promise<any> {
        const body = (() => {
            if (typeof value === 'string') return textBytes(value);
            if (value instanceof ArrayBuffer) return new Uint8Array(value);
            // In JSDOM, typed arrays may come from a different realm; `instanceof Uint8Array` can fail.
            if (ArrayBuffer.isView(value)) {
                return new Uint8Array(
                    value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
                );
            }
            return textBytes('[stream]');
        })();
        const etag = `W/"${key}-${body.length}"`;
        this.objects.set(key, { key, body, etag });
        return { key, size: body.length, etag };
    }

    async get(key: string): Promise<any | null> {
        const stored = this.objects.get(key);
        if (!stored?.body) return null;
        return {
            key,
            size: stored.body.length,
            etag: stored.etag,
            async arrayBuffer() {
                return stored.body!.buffer.slice(
                    stored.body!.byteOffset,
                    stored.body!.byteOffset + stored.body!.byteLength
                );
            }
        };
    }

    async head(key: string): Promise<any | null> {
        const stored = this.objects.get(key);
        if (!stored?.body) return null;
        return { key, size: stored.body.length, etag: stored.etag };
    }

    async list(options?: any): Promise<any> {
        this.listCalls++;

        const prefix: string = options?.prefix ?? '';
        const limit: number = options?.limit ?? 1000;
        const cursorRaw: string | undefined = options?.cursor;
        const start = cursorRaw ? Number(cursorRaw) : 0;

        const keys = Array.from(this.objects.keys())
            .filter((k) => k.startsWith(prefix))
            .sort();

        const slice = keys.slice(start, start + limit);
        const nextStart = start + slice.length;
        const truncated = nextStart < keys.length;

        return {
            objects: slice.map((key) => {
                const stored = this.objects.get(key)!;
                return { key, size: stored.body?.length ?? 0, etag: stored.etag };
            }),
            truncated,
            cursor: truncated ? String(nextStart) : undefined
        };
    }
}

function makeEnv(bucket: R2Bucket): Env {
    return {
        BUCKET: bucket,
        INGEST_LATITUDE: '0',
        INGEST_LONGITUDE: '0',
        INGEST_TIMEZONE: 'UTC'
    };
}

const ctx = {} as any;

test('worker 404 responses include CORS and are not cacheable', async () => {
    const bucket = new MockBucket();
    const env = makeEnv(bucket);

    const res = await worker.fetch(
        new Request('https://cdn.test/manifests/root.json'),
        env,
        ctx
    );

    expect(res.status).toBe(404);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
});

test('worker paginates and sorts manifest listings', async () => {
    const bucket = new MockBucket();
    const env = makeEnv(bucket);

    const date = '2026-01-01';
    const prefix = `manifests/${date}/`;

    for (let i = 0; i < 1500; i++) {
        await bucket.put(`${prefix}${makeHash(i)}`, textBytes(`m${i}`));
    }

    const res = await worker.fetch(
        new Request(`https://cdn.test/manifests/${date}/`),
        env,
        ctx
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');

    const hashes = (await res.json()) as string[];
    expect(hashes).toHaveLength(1500);
    expect(hashes[0]).toBe(makeHash(0));
    expect(hashes[1499]).toBe(makeHash(1499));
    expect(bucket.listCalls).toBeGreaterThan(1);
});

test('worker serves location-scoped root.json', async () => {
    const bucket = new MockBucket();
    const env = makeEnv(bucket);

    const locId = makeHash(42);
    await bucket.put(
        `locations/${locId}/manifests/root.json`,
        textBytes(JSON.stringify({ latest: '2026-01-02' }))
    );

    const res = await worker.fetch(
        new Request(`https://cdn.test/locations/${locId}/manifests/root.json`),
        env,
        ctx
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await res.json()).toEqual({ latest: '2026-01-02' });
});

test('worker serves /locations/<loc_key>/latest.json (manifest pointers only)', async () => {
    const bucket = new MockBucket();
    const env = makeEnv(bucket);

    const latestDate = '2026-01-02';
    const prevDate = '2026-01-01';
    const locKey = 'v1:44.6683,-65.7619';
    const otherLocKey = 'v1:44.6684,-65.7619';

    await bucket.put('manifests/root.json', textBytes(JSON.stringify({ latest: latestDate })));

    const artifactHash = makeHash(999);

    const matchingManifest: DailyManifest = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        date: latestDate,
        publishedAt: '2026-01-02T00:00:00.000Z',
        artifacts: [
            { hash: artifactHash, type: 'forecast', sizeBytes: 123, locKey }
        ]
    };

    const nonMatchingManifest: DailyManifest = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        date: latestDate,
        publishedAt: '2026-01-02T00:00:00.000Z',
        artifacts: [
            { hash: makeHash(1000), type: 'forecast', sizeBytes: 456, locKey: otherLocKey }
        ]
    };

    const packedA = await packageManifest(matchingManifest);
    const packedB = await packageManifest(nonMatchingManifest);

    await bucket.put(`manifests/${latestDate}/${packedA.hash}`, packedA.blob);
    await bucket.put(`manifests/${latestDate}/${packedB.hash}`, packedB.blob);

    const res = await worker.fetch(
        new Request(`https://cdn.test/locations/${encodeURIComponent(locKey)}/latest.json`),
        env,
        ctx
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');

    const bodyText = await res.text();
    expect(bodyText).not.toContain(artifactHash);

    const body = JSON.parse(bodyText) as any;
    expect(body.loc_key).toBe(locKey);
    expect(body.dates).toEqual([
        { date: latestDate, manifests: [packedA.hash] },
        { date: prevDate, manifests: [] }
    ]);
});

test('worker /locations/<loc_key>/latest.json rejects invalid loc_key', async () => {
    const bucket = new MockBucket();
    const env = makeEnv(bucket);

    const res = await worker.fetch(
        new Request('https://cdn.test/locations/v1:44.66,-65.76/latest.json'),
        env,
        ctx
    );

    expect(res.status).toBe(400);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await res.json()).toEqual({ error: 'INVALID_LOC_KEY' });
});
