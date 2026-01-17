
import { describe, it, expect } from 'vitest';
import { canonicalMsgPack } from '../canonical';
import { hashHex, toHex } from '../hash';
import { computeArtifactId } from '../artifact';

/**
 * ⚠️ GOLDEN VECTOR DRIFT DISCIPLINE ⚠️
 * 
 * Rules:
 * 1. Golden vector updates require a dedicated PR label like `golden-update`.
 * 2. PR description must include: why the hash changed and why it’s acceptable.
 * 3. No “oops regenerated” merges.
 * 
 * These vectors represent the TRUSTED state of the protocol.
 * Changing them breaks backward compatibility or alters the canonical definition.
 */

describe('Golden Vectors (Logical Identity)', () => {

    // 1. Station Set
    // Expected ID: fe87cbdc276d1985ddda985f1f0367edae5bfe4e08577a2df575ed4adbc8c359
    const stationSet = {
        schemaVersion: 1,
        type: 'station_set',
        source: 'test_source',
        stations: [
            { id: 'STA1', lat: 45, lon: -75, name: 'Test Station' }
        ]
    };

    it('stationset: canonical bytes match golden', () => {
        const bytes = canonicalMsgPack(stationSet);
        const hash = hashHex(bytes);
        expect(hash).toBe('fe87cbdc276d1985ddda985f1f0367edae5bfe4e08577a2df575ed4adbc8c359');
    });

    // 2. Observation
    // Expected ID: 0efc5d8bb769ba2e2cf5c8d99173761e8b7e36eceb461c7d4ae39b7cf4f50511
    const observation = {
        schemaVersion: 1,
        type: 'observation',
        source: 'test_source',
        observedAtBucket: '2026-01-01T00:00:00.000Z',
        observedAtRaw: '2026-01-01T00:00:00.000Z',
        bucketMinutes: 60,
        fetchedAt: 1735689600,
        stationSetId: 'fe87cbdc276d1985ddda985f1f0367edae5bfe4e08577a2df575ed4adbc8c359',
        variables: ['var1'],
        data: { var1: { STA1: 12.5 } }
    };

    it('observation: canonical bytes match golden', () => {
        const bytes = canonicalMsgPack(observation);
        const hash = hashHex(bytes);
        expect(hash).toBe('0efc5d8bb769ba2e2cf5c8d99173761e8b7e36eceb461c7d4ae39b7cf4f50511');
    });

    // 3. Manifest (Signed)
    // Expected ID: 977279373c3a5b12a8cf890df064a911dad6605b618bbfa69376dc52d2cafc6c
    const manifest = {
        schemaVersion: 1,
        date: '2026-01-01',
        publishedAt: '2026-01-01T01:00:00.000Z',
        artifacts: [
            { hash: 'fe87cbdc276d1985ddda985f1f0367edae5bfe4e08577a2df575ed4adbc8c359', type: 'station_set', sizeBytes: 100 },
            { hash: '0efc5d8bb769ba2e2cf5c8d99173761e8b7e36eceb461c7d4ae39b7cf4f50511', type: 'observation', sizeBytes: 200, observedAtBucket: '2026-01-01T00:00:00.000Z' }
        ],
        signature: {
            signature: '5a93b9809fab4395a8c194bb8fe3bcf66557d4cddb69d4ceec95ea310a278384ca94643071fcd9ee6fed1b2c193972464ecb3fefac45afdf1515308a893d5f02',
            publicKey: '248acbdbaf9e050196de704bea2d68770e519150d103b587dae2d9cad53dd930',
            signedAt: '2026-01-01T01:00:01.000Z'
        }
    };

    it('manifest: canonical bytes match golden', () => {
        const bytes = canonicalMsgPack(manifest);
        const hash = hashHex(bytes);
        expect(hash).toBe('977279373c3a5b12a8cf890df064a911dad6605b618bbfa69376dc52d2cafc6c');
    });
});
