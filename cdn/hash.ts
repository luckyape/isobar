/**
 * Weather Forecast CDN — BLAKE3 Hashing Utilities
 *
 * Content-addressing: every artifact is identified by its BLAKE3 hash.
 * This module provides utilities for hashing and hex encoding.
 */

import { blake3 } from '@noble/hashes/blake3.js';

/**
 * Compute BLAKE3 hash of a Uint8Array.
 * Returns raw 32-byte hash.
 */
export function hash(data: Uint8Array): Uint8Array {
    return blake3(data);
}

/**
 * Compute BLAKE3 hash and return as lowercase hex string.
 */
export function hashHex(data: Uint8Array): string {
    return toHex(blake3(data));
}

/**
 * Convert Uint8Array to lowercase hex string.
 */
export function toHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Convert hex string to Uint8Array.
 */
export function fromHex(hex: string): Uint8Array {
    const cleanHex = hex.toLowerCase().replace(/^0x/, '');
    if (cleanHex.length % 2 !== 0) {
        throw new Error('Invalid hex string: odd length');
    }
    const bytes = new Uint8Array(cleanHex.length / 2);
    for (let i = 0; i < cleanHex.length; i += 2) {
        bytes[i / 2] = parseInt(cleanHex.slice(i, i + 2), 16);
    }
    return bytes;
}

/**
 * Verify that data matches expected hash.
 * Returns true if match, false otherwise.
 */
export function verifyHash(data: Uint8Array, expectedHex: string): boolean {
    const actualHex = hashHex(data);
    return actualHex === expectedHex.toLowerCase();
}

/**
 * Compare two hashes for equality (constant-time to prevent timing attacks).
 */
export function hashesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a[i] ^ b[i];
    }
    return result === 0;
}
