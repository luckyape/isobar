/**
 * Weather Forecast CDN — Determinism Tests
 *
 * CRITICAL: These tests verify that content-addressing is stable.
 * If any of these tests fail, dedupe will rot.
 */

import { describe, it, expect } from 'vitest';
import { canonicalJsonBytes, sortKeys, isCanonicallyEqual, canonicalMsgPack } from '@cdn/canonical';
import { computeArtifactId, packageArtifact, unpackageArtifact } from '@cdn/artifact';
import { hash, toHex } from '@cdn/hash';
import type { ForecastArtifact } from '@cdn/types';

// =============================================================================
// Golden Vectors
// =============================================================================

const SAMPLE_FORECAST: ForecastArtifact = {
    schemaVersion: 1,
    type: 'forecast',
    model: 'gem_seamless',
    runTime: '2026-01-08T00:00:00Z',
    issuedAt: 1736294400,
    validTimes: ['2026-01-08T00:00:00Z', '2026-01-08T01:00:00Z'],
    variables: ['temperature_2m', 'precipitation'],
    grid: { type: 'point', lat: 43.6532, lon: -79.3832 },
    data: {
        temperature_2m: [-5.2, -4.8],
        precipitation: [0.0, 0.1]
    },
    source: 'open-meteo'
};

// =============================================================================
// Test: Key Sorting Determinism
// =============================================================================

describe('canonical serialization', () => {
    it('sorts object keys alphabetically', () => {
        const unsorted = { z: 1, a: 2, m: 3 };
        const sorted = sortKeys(unsorted);
        expect(Object.keys(sorted)).toEqual(['a', 'm', 'z']);
    });

    it('sorts nested object keys recursively', () => {
        const nested = { outer: { z: 1, a: 2 }, b: { y: 3, x: 4 } };
        const sorted = sortKeys(nested);
        expect(Object.keys(sorted)).toEqual(['b', 'outer']);
        expect(Object.keys(sorted.outer)).toEqual(['a', 'z']);
        expect(Object.keys(sorted.b)).toEqual(['x', 'y']);
    });

    it('preserves array order', () => {
        const withArrays = { items: [3, 1, 2], name: 'test' };
        const sorted = sortKeys(withArrays);
        expect(sorted.items).toEqual([3, 1, 2]);
    });

    it('handles special float values', () => {
        const special = {
            nan: NaN,
            inf: Infinity,
            negInf: -Infinity,
            negZero: -0
        };

        // Expect non-finite numbers to throw
        expect(() => canonicalJsonBytes(special)).toThrow(/non-finite/);

        // Expect -0 to be normalized to 0
        const inputWithNegZero = { val: -0 };
        const bytes = canonicalJsonBytes(inputWithNegZero);
        const json = new TextDecoder().decode(bytes);
        expect(json).toBe('{"val":0}');
    });
});

// =============================================================================
// Test: Same Input → Same Hash (Cross-Path)
// =============================================================================

describe('artifact ID determinism', () => {
    it('same forecast produces same hash regardless of object creation order', () => {
        const forecast1 = { ...SAMPLE_FORECAST };
        const forecast2: ForecastArtifact = {
            source: SAMPLE_FORECAST.source,
            data: SAMPLE_FORECAST.data,
            grid: SAMPLE_FORECAST.grid,
            variables: SAMPLE_FORECAST.variables,
            validTimes: SAMPLE_FORECAST.validTimes,
            issuedAt: SAMPLE_FORECAST.issuedAt,
            runTime: SAMPLE_FORECAST.runTime,
            model: SAMPLE_FORECAST.model,
            type: SAMPLE_FORECAST.type,
            schemaVersion: SAMPLE_FORECAST.schemaVersion
        };

        const id1 = computeArtifactId(forecast1);
        const id2 = computeArtifactId(forecast2);

        expect(id1).toBe(id2);
    });

    it('canonical bytes are identical for equivalent objects', () => {
        const forecast1 = { ...SAMPLE_FORECAST };
        const forecast2 = { ...SAMPLE_FORECAST };

        expect(isCanonicallyEqual(forecast1, forecast2)).toBe(true);
    });

    it('different data produces different hash', () => {
        const modified = {
            ...SAMPLE_FORECAST,
            data: { ...SAMPLE_FORECAST.data, temperature_2m: [-5.3, -4.8] }
        };

        const id1 = computeArtifactId(SAMPLE_FORECAST);
        const id2 = computeArtifactId(modified);

        expect(id1).not.toBe(id2);
    });
});

// =============================================================================
// Test: Compression Independence
// =============================================================================

describe('compression independence', () => {
    it('artifact ID is independent of compression', async () => {
        const directId = computeArtifactId(SAMPLE_FORECAST);
        const { hash: packagedId } = await packageArtifact(SAMPLE_FORECAST);
        expect(packagedId).toBe(directId);
    });

    it('round-trip preserves artifact ID', async () => {
        const originalId = computeArtifactId(SAMPLE_FORECAST);
        const { blob } = await packageArtifact(SAMPLE_FORECAST);
        const unpacked = await unpackageArtifact(blob);
        const unpackedId = computeArtifactId(unpacked);
        expect(unpackedId).toBe(originalId);
    });
});

// =============================================================================
// Test: Corruption Detection
// =============================================================================

describe('integrity verification', () => {
    it('detects artifact ID tampering in header', async () => {
        const { blob } = await packageArtifact(SAMPLE_FORECAST);
        const tampered = new Uint8Array(blob);
        // Corrupt the artifact ID (bytes 10-41)
        tampered[20] ^= 0xFF;
        await expect(unpackageArtifact(tampered)).rejects.toThrow(/mismatch/i);
    });

    it('detects size field tampering', async () => {
        const { blob } = await packageArtifact(SAMPLE_FORECAST);
        const tampered = new Uint8Array(blob);
        // Corrupt the size field (bytes 6-9)
        tampered[7] ^= 0x01;
        await expect(unpackageArtifact(tampered)).rejects.toThrow();
    });
});

// =============================================================================
// Test: Golden Vectors (Regression Protection)
// =============================================================================

describe('golden vectors', () => {
    it('SAMPLE_FORECAST produces 64-char hex hash', () => {
        const id = computeArtifactId(SAMPLE_FORECAST);
        expect(typeof id).toBe('string');
        expect(id.length).toBe(64);
    });

    it('rejection of undefined values', async () => {
        const withUndefined = {
            ...SAMPLE_FORECAST,
            data: { ...SAMPLE_FORECAST.data, invalid: undefined }
        };
        // Should throw when computing ID or packaging because sortKeys detects undefined
        expect(() => computeArtifactId(withUndefined as any)).toThrow(/undefined/);
        await expect(packageArtifact(withUndefined as any)).rejects.toThrow(/undefined/);
    });

    it('canonical MsgPack bytes are stable', () => {
        const bytes = canonicalMsgPack(SAMPLE_FORECAST);
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes.length).toBeGreaterThan(0);

        // Re-encoding same object should produce identical bytes
        const bytes2 = canonicalMsgPack({ ...SAMPLE_FORECAST });
        expect(bytes).toEqual(bytes2);
    });

    it('canonical JSON bytes are stable', () => {
        const bytes = canonicalJsonBytes(SAMPLE_FORECAST);
        const json = new TextDecoder().decode(bytes);

        // Verify JSON starts with sorted keys
        // Top-level keys in order: data, grid, issuedAt, model, runTime, schemaVersion, source, type, validTimes, variables
        expect(json.startsWith('{"data":')).toBe(true);

        // Verify no whitespace
        expect(json).not.toContain(' ');
        expect(json).not.toContain('\n');
    });

    it('identical logical objects produce identical hashes', () => {
        // Build from scratch in different order
        const obj1 = {
            schemaVersion: 1,
            type: 'forecast' as const,
            model: 'gem_seamless',
            runTime: '2026-01-08T00:00:00Z',
            issuedAt: 1736294400,
            validTimes: ['2026-01-08T00:00:00Z', '2026-01-08T01:00:00Z'],
            variables: ['temperature_2m', 'precipitation'],
            grid: { type: 'point' as const, lat: 43.6532, lon: -79.3832 },
            data: { temperature_2m: [-5.2, -4.8], precipitation: [0.0, 0.1] },
            source: 'open-meteo'
        };

        const obj2 = {
            source: 'open-meteo',
            data: { precipitation: [0.0, 0.1], temperature_2m: [-5.2, -4.8] },
            grid: { lon: -79.3832, type: 'point' as const, lat: 43.6532 },
            variables: ['temperature_2m', 'precipitation'],
            validTimes: ['2026-01-08T00:00:00Z', '2026-01-08T01:00:00Z'],
            issuedAt: 1736294400,
            runTime: '2026-01-08T00:00:00Z',
            type: 'forecast' as const,
            model: 'gem_seamless',
            schemaVersion: 1
        };

        expect(computeArtifactId(obj1)).toBe(computeArtifactId(obj2));
    });
});
