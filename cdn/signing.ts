/**
 * Weather Forecast CDN — Cryptographic Signing
 *
 * Ed25519 signatures for manifest authenticity.
 * Hash chains prove internal consistency; signatures prove origin.
 *
 * Usage:
 * - Ingest pipeline signs manifests with private key (server-side secret)
 * - Clients verify signatures with embedded public key
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { toHex, fromHex } from './hash';

// =============================================================================
// Key Types
// =============================================================================

export interface KeyPair {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
}

export interface SignedEnvelope {
    /** Hex-encoded Ed25519 signature (64 bytes) */
    signature: string;
    /** Hex-encoded public key (32 bytes) */
    publicKey: string;
    /** ISO 8601 timestamp when signed */
    signedAt: string;
}

// =============================================================================
// Key Management
// =============================================================================

/**
 * Generate a new Ed25519 keypair.
 * The private key should be stored securely (e.g., Cloudflare secret).
 */
export function generateKeyPair(): KeyPair {
    const privateKey = ed25519.utils.randomSecretKey();
    const publicKey = ed25519.getPublicKey(privateKey);
    return { publicKey, privateKey };
}

/**
 * Export keypair to hex strings for storage.
 */
export function exportKeyPair(pair: KeyPair): { publicKey: string; privateKey: string } {
    return {
        publicKey: toHex(pair.publicKey),
        privateKey: toHex(pair.privateKey)
    };
}

/**
 * Import keypair from hex strings.
 */
export function importKeyPair(exported: { publicKey: string; privateKey: string }): KeyPair {
    return {
        publicKey: fromHex(exported.publicKey),
        privateKey: fromHex(exported.privateKey)
    };
}

// =============================================================================
// Signing
// =============================================================================

/**
 * Sign a message with Ed25519.
 * Returns the signature as a Uint8Array (64 bytes).
 */
export function sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
    return ed25519.sign(message, privateKey);
}

/**
 * Verify an Ed25519 signature.
 * Returns true if valid, false otherwise.
 */
export function verify(
    message: Uint8Array,
    signature: Uint8Array,
    publicKey: Uint8Array
): boolean {
    try {
        return ed25519.verify(signature, message, publicKey);
    } catch {
        return false;
    }
}

/**
 * Create a signed envelope for a message.
 */
export function createSignedEnvelope(
    message: Uint8Array,
    privateKey: Uint8Array
): SignedEnvelope {
    const publicKey = ed25519.getPublicKey(privateKey);
    const signature = sign(message, privateKey);
    return {
        signature: toHex(signature),
        publicKey: toHex(publicKey),
        signedAt: new Date().toISOString()
    };
}

/**
 * Verify a signed envelope against a message.
 * Optionally verify against an expected public key (pinned).
 */
export function verifySignedEnvelope(
    message: Uint8Array,
    envelope: SignedEnvelope,
    expectedPublicKey?: string
): boolean {
    // If a pinned public key is provided, verify it matches
    if (expectedPublicKey && envelope.publicKey !== expectedPublicKey.toLowerCase()) {
        return false;
    }

    const signature = fromHex(envelope.signature);
    const publicKey = fromHex(envelope.publicKey);

    return verify(message, signature, publicKey);
}
