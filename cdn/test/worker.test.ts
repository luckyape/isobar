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

function makeEnv(bucket: R2Bucket, overrides?: Partial<Env>): Env {
    return {
        BUCKET: bucket,
        INGEST_LATITUDE: '0',
        INGEST_LONGITUDE: '0',
        INGEST_TIMEZONE: 'UTC',
        ...overrides
    };
}

const ctx = {} as any;

// ... (existing tests)

test('worker defaults to primary location when explicit location missing', async () => {
    const bucket = new MockBucket();
    // Primary: Toronto
    const env = makeEnv(bucket, {
        INGEST_LATITUDE: '43.6532',
        INGEST_LONGITUDE: '-79.3832',
        INGEST_TIMEZONE: 'America/Toronto'
    });

    // Compute expected primary scope ID (locally replicated logic for test)
    // 43.6532, -79.3832, America/Toronto, decimals=4
    // We can rely on the worker importing the actual helper, but for black-box testing we check behavior.

    // Seed primary location data
    // We don't know the exact hash here without importing `computeLocationScopeId`, 
    // but we can spy on the bucket or check the response header which returns the scope.

    // Let's first make a request to see what scope it generates in the header
    // We expect a 404 because we haven't seeded data, but the header should be present.
    const resProbe = await worker.fetch(
        new Request('https://cdn.test/manifests/root.json'),
        env,
        ctx
    );
    expect(resProbe.headers.get('X-Weather-Location-Source')).toBe('primary');
    const primaryScope = resProbe.headers.get('X-Weather-Location-Scope');
    expect(primaryScope).toMatch(/^[a-f0-9]{64}$/);

    // Now seed data at that scope
    await bucket.put(
        `locations/${primaryScope}/manifests/root.json`,
        textBytes(JSON.stringify({ latest: '2026-02-01' }))
    );

    // Request again (no explicit location)
    const res = await worker.fetch(
        new Request('https://cdn.test/manifests/root.json'),
        env,
        ctx
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Weather-Location-Source')).toBe('primary');
    expect(res.headers.get('X-Weather-Location-Scope')).toBe(primaryScope!);
    expect(await res.json()).toEqual({ latest: '2026-02-01' });
});

test('worker prefers explicit location over primary', async () => {
    const bucket = new MockBucket();
    const env = makeEnv(bucket, {
        INGEST_LATITUDE: '43.6532', // Primary
        INGEST_LONGITUDE: '-79.3832',
        INGEST_TIMEZONE: 'America/Toronto'
    });

    // Explicit: Halifax (random scope id)
    const explicitScope = makeHash(88);

    // Seed explicit data
    await bucket.put(
        `locations/${explicitScope}/manifests/root.json`,
        textBytes(JSON.stringify({ latest: '2026-03-01' }))
    );

    const res = await worker.fetch(
        new Request(`https://cdn.test/locations/${explicitScope}/manifests/root.json`),
        env,
        ctx
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Weather-Location-Source')).toBe('explicit');
    expect(res.headers.get('X-Weather-Location-Scope')).toBe(explicitScope);
    expect(await res.json()).toEqual({ latest: '2026-03-01' });
});

test('worker falls back to global if primary invalid/missing (legacy support)', async () => {
    const bucket = new MockBucket();
    const env = makeEnv(bucket, {
        INGEST_LATITUDE: 'invalid', // Invalid primary
        INGEST_LONGITUDE: '0',
        INGEST_TIMEZONE: 'UTC'
    });

    // Seed global data
    await bucket.put(
        `manifests/root.json`, // No location prefix
        textBytes(JSON.stringify({ latest: '2026-01-01' }))
    );

    const res = await worker.fetch(
        new Request('https://cdn.test/manifests/root.json'),
        env,
        ctx
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Weather-Location-Source')).toBe('primary'); // It tries primary logic...
    // Wait, if primary is invalid, my code sets scopeKeyPrefix to ''?
    // Let's check logic:
    // const primaryLat = parseFloat('invalid') -> NaN.
    // if (Number.isFinite(primaryLat)...) -> False.
    // scopeKeyPrefix remains ''.
    // effectiveLocationScope -> '' ? replace -> 'global'.

    expect(res.headers.get('X-Weather-Location-Scope')).toBe('global');
    expect(await res.json()).toEqual({ latest: '2026-01-01' });
});


test('worker paginates and sorts manifest listings', async () => {
    const bucket = new MockBucket();
    const env = makeEnv(bucket);

    const date = '2026-01-01';
    const locId = makeHash(999);
    // Use explicit location to test pagination logic independent of default primary
    const prefix = `locations/${locId}/manifests/${date}/`;

    for (let i = 0; i < 1500; i++) {
        await bucket.put(`${prefix}${makeHash(i)}`, textBytes(`m${i}`));
    }

    const res = await worker.fetch(
        new Request(`https://cdn.test/locations/${locId}/manifests/${date}/`),
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

    const body = (await res.json()) as any;

    expect(Object.keys(body).sort()).toEqual(['dates', 'loc_key']);
    expect(body.loc_key).toBe(locKey);

    expect(Array.isArray(body.dates)).toBe(true);
    expect(body.dates).toHaveLength(2);

    for (const entry of body.dates) {
        expect(Object.keys(entry).sort()).toEqual(['date', 'manifests']);
        expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Array.isArray(entry.manifests)).toBe(true);
        for (const hash of entry.manifests) {
            expect(hash).toMatch(/^[a-f0-9]{64}$/i);
        }
    }

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
    expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(await res.json()).toEqual({ error: 'INVALID_LOC_KEY' });
});

test('worker /locations/<loc_key>/latest.json returns CDN_UNAVAILABLE when root missing', async () => {
    const bucket = new MockBucket();
    const env = makeEnv(bucket);

    const res = await worker.fetch(
        new Request('https://cdn.test/locations/v1:44.6683,-65.7619/latest.json'),
        env,
        ctx
    );

    expect(res.status).toBe(503);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(await res.json()).toEqual({ error: 'CDN_UNAVAILABLE' });
});

test('worker /locations/<loc_key>/latest.json supports HEAD with CORS', async () => {
    const bucket = new MockBucket();
    const env = makeEnv(bucket);

    await bucket.put('manifests/root.json', textBytes(JSON.stringify({ latest: '2026-01-02' })));

    const res = await worker.fetch(
        new Request('https://cdn.test/locations/v1:44.6683,-65.7619/latest.json', { method: 'HEAD' }),
        env,
        ctx
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
});
