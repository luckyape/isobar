/**
 * Weather Forecast CDN — Canonical Serialization
 *
 * CRITICAL: Content-addressing requires deterministic serialization.
 * Same logical data must ALWAYS produce identical bytes.
 *
 * This module provides:
 * 1. Recursive key sorting for objects
 * 2. Stable JSON serialization (used to derive canonical bytes)
 * 3. Deterministic MsgPack encoding for storage
 */

import { encode as msgpackEncode, decode as msgpackDecode } from '@msgpack/msgpack';

/**
 * Recursively sort object keys alphabetically.
 * Arrays are preserved in order.
 *
 * CRITICAL: Throws if 'undefined', functions, or symbols are encountered.
 * These types are not valid in content-addressed artifacts.
 */
export function sortKeys<T>(value: T): T {
    // 1. Handle null/primitive types
    if (value === null || typeof value !== 'object') {
        if (value === undefined) throw new Error('Artifact contains undefined value (forbidden)');
        if (typeof value === 'function') throw new Error('Artifact contains function (forbidden)');
        if (typeof value === 'symbol') throw new Error('Artifact contains symbol (forbidden)');
        if (typeof value === 'bigint') throw new Error('Artifact contains bigint (forbidden - use string)');
        return value;
    }

    // 2. Handle Arrays
    if (Array.isArray(value)) {
        return value.map(sortKeys) as T;
    }

    // 3. Handle Objects (sort keys)
    const sorted: Record<string, unknown> = {};
    // Object.keys ignores symbols, which is good for JSON, but we strictly ban them above if passed directly
    const keys = Object.keys(value as object).sort();

    for (const key of keys) {
        let val = (value as Record<string, unknown>)[key];

        // Check for undefined explicitly in object properties (JSON.stringify would drop them)
        if (val === undefined) {
            throw new Error(`Artifact key '${key}' is undefined (forbidden)`);
        }

        // Numeric stability enforcement
        if (typeof val === 'number') {
            if (!Number.isFinite(val)) {
                throw new Error(`Artifact key '${key}' has non-finite value ${val} (forbidden)`);
            }
            // Normalize -0 to 0
            if (Object.is(val, -0)) {
                val = 0;
            }
        }

        sorted[key] = sortKeys(val);
    }
    return sorted as T;
}

/**
 * Produce canonical JSON bytes for content-addressing.
 *
 * Rules:
 * - Keys are sorted alphabetically (recursive)
 * - No whitespace
 * - Numbers: standard JSON serialization (IEEE 754 double)
 * - Floats: NaN → null, Infinity → null (not valid JSON)
 *
 * This is used ONLY for computing the artifact ID (hash).
 * Storage uses MsgPack (more compact).
 */
export function canonicalJsonBytes<T>(value: T): Uint8Array {
    const sorted = sortKeys(value);
    const json = JSON.stringify(sorted, floatReplacer);
    return new TextEncoder().encode(json);
}

/**
 * JSON replacer for handling special float values.
 * NaN, Infinity, -Infinity are not valid JSON and must be normalized.
 */
function floatReplacer(_key: string, value: unknown): unknown {
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            return null; // NaN, Infinity → null
        }
        // Normalize -0 to 0
        if (Object.is(value, -0)) {
            return 0;
        }
    }
    return value;
}

/**
 * Encode object to MsgPack with sorted keys.
 * Used for storage (more compact than JSON).
 */
export function canonicalMsgPack<T>(value: T): Uint8Array {
    const sorted = sortKeys(value);
    return new Uint8Array(msgpackEncode(sorted));
}

/**
 * Decode MsgPack bytes to object.
 */
export function decodeMsgPack<T>(bytes: Uint8Array): T {
    return msgpackDecode(bytes) as T;
}

/**
 * Test helper: verify that two values produce identical canonical bytes.
 */
export function isCanonicallyEqual<T>(a: T, b: T): boolean {
    const bytesA = canonicalJsonBytes(a);
    const bytesB = canonicalJsonBytes(b);
    if (bytesA.length !== bytesB.length) return false;
    for (let i = 0; i < bytesA.length; i++) {
        if (bytesA[i] !== bytesB[i]) return false;
    }
    return true;
}
