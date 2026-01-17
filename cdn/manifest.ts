/**
 * Weather Forecast CDN — Manifest Management
 *
 * Daily manifests list all artifacts published on a given date.
 * Manifests are themselves content-addressed artifacts (signed for authenticity).
 */

import { canonicalMsgPack, decodeMsgPack } from './canonical';
import { compress, decompressWithEncoding, ENCODING_GZIP_MSGPACK } from './compress';
import { hash, toHex, fromHex, hashesEqual } from './hash';
import { BLOB_HEADER_SIZE } from './artifact';
import {
    type DailyManifest,
    type ManifestEntry,
    type Artifact,
    type ArtifactType,
    BLOB_MAGIC,
    CURRENT_SCHEMA_VERSION
} from './types';

/**
 * Create a manifest entry from an artifact and its hash.
 */
export function createManifestEntry(
    artifact: Artifact,
    artifactHash: string,
    sizeBytes: number,
    locKey?: string
): ManifestEntry {
    const entry: ManifestEntry = {
        hash: artifactHash,
        type: artifact.type,
        sizeBytes
    };

    if (locKey) {
        entry.locKey = locKey;
    }

    // Add type-specific metadata for filtering
    if (artifact.type === 'forecast') {
        entry.model = artifact.model;
        entry.runTime = artifact.runTime;
    } else if (artifact.type === 'observation') {
        entry.source = artifact.source;
        entry.observedAtBucket = artifact.observedAtBucket;
        entry.stationSetId = artifact.stationSetId;
    } else if (artifact.type === 'station_set') {
        entry.source = artifact.source;
        // Station sets don't need time info, they are content-addressed metadata
    }

    return entry;
}

/**
 * Create a new daily manifest.
 */
export function createManifest(params: {
    date: string;
    artifacts: ManifestEntry[];
    previousManifestHash?: string;
}): DailyManifest {
    const manifest: DailyManifest = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        date: params.date,
        publishedAt: new Date().toISOString(),
        artifacts: params.artifacts
    };

    if (params.previousManifestHash) {
        manifest.previousManifestHash = params.previousManifestHash;
    }

    return manifest;
}

/**
 * Package a manifest into a content-addressed blob.
 * Uses same stable hashing as artifacts: ID = BLAKE3(canonicalMsgPack).
 */
// @ts-ignore: Package resolution issue in local check, works in runtime
import { ed25519 } from '@noble/curves/ed25519.js';

// ...

/**
 * Package a manifest into a content-addressed blob.
 * Optionally signs the manifest if a private key is provided.
 */
export async function packageManifest(
    manifest: DailyManifest,
    privateKeyHex?: string
): Promise<{ blob: Uint8Array; hash: string }> {
    // 1. Handle Signing
    if (privateKeyHex) {
        // Strip existing signature to get canonical content bytes
        const { signature: _signature, ...cleanManifest } = manifest;
        const payloadBytes = canonicalMsgPack(cleanManifest);

        // Sign the content
        const privateKey = fromHex(privateKeyHex);
        const publicKey = ed25519.getPublicKey(privateKey);
        const sig = ed25519.sign(payloadBytes, privateKey);

        manifest.signature = {
            signature: toHex(sig),
            publicKey: toHex(publicKey),
            signedAt: new Date().toISOString()
        };
    }

    // 2. Serialize to Canonical MsgPack (Sorted Keys, No undefined)
    const payloadBytes = canonicalMsgPack(manifest);

    // 3. Manifest ID = hash of canonical bytes (STABLE)
    const manifestId = hash(payloadBytes);
    const manifestIdHex = toHex(manifestId);

    // 4. Compress for transport
    const compressed = await compress(payloadBytes);

    // 5. Build header (same format as artifacts)
    const header = new Uint8Array(BLOB_HEADER_SIZE);
    const view = new DataView(header.buffer);
    view.setUint32(0, BLOB_MAGIC, false);         // Magic
    view.setUint16(4, CURRENT_SCHEMA_VERSION, false); // Schema version
    view.setUint32(6, payloadBytes.length, false);  // Uncompressed size
    header.set(manifestId, 10);                    // Manifest ID (32 bytes)
    view.setUint32(42, ENCODING_GZIP_MSGPACK, false);        // Encoding flags

    // 6. Concatenate header + compressed payload
    const blob = new Uint8Array(BLOB_HEADER_SIZE + compressed.length);
    blob.set(header, 0);
    blob.set(compressed, BLOB_HEADER_SIZE);

    return { blob, hash: manifestIdHex };
}

/**
 * Unpackage and parse a manifest blob.
 * Verifies integrity (hash) and authenticity (signature) if expectedPublicKey is provided.
 */
export async function unpackageManifest(
    blob: Uint8Array,
    expectedPublicKeyHex?: string
): Promise<DailyManifest> {
    if (blob.length < BLOB_HEADER_SIZE) {
        throw new Error('Blob too small: missing header');
    }

    const view = new DataView(blob.buffer, blob.byteOffset, blob.length);
    const magic = view.getUint32(0, false);
    if (magic !== BLOB_MAGIC) {
        throw new Error(`Invalid magic number: expected ${BLOB_MAGIC}, got ${magic}`);
    }

    const uncompressedSize = view.getUint32(6, false);
    const expectedId = blob.slice(10, 42);
    const encodingFlags = view.getUint32(42, false);
    const compressedPayload = blob.slice(BLOB_HEADER_SIZE);

    const payloadBytes = await decompressWithEncoding(compressedPayload, encodingFlags);
    if (payloadBytes.length !== uncompressedSize) {
        throw new Error(`Size mismatch: expected ${uncompressedSize}, got ${payloadBytes.length}`);
    }

    // CRITICAL: Verify canonical hash matches payload bytes directly
    const actualId = hash(payloadBytes);
    if (!hashesEqual(actualId, expectedId)) {
        throw new Error('Integrity check failed: manifest ID mismatch');
    }

    // Decode MsgPack
    const manifest = decodeMsgPack<DailyManifest>(payloadBytes);

    // CRITICAL: Verify Signature
    if (expectedPublicKeyHex) {
        if (!manifest.signature) {
            throw new Error('Authenticity check failed: manifest is not signed');
        }

        // Reconstruct what was signed (the manifest WITHOUT the signature)
        const { signature: _signature, ...cleanManifest } = manifest;
        const signedBytes = canonicalMsgPack(cleanManifest);
        const sigBytes = fromHex(manifest.signature.signature);
        const pubKeyBytes = fromHex(expectedPublicKeyHex); // Trust the provided key, not the envelope key

        // Verify matches expected key
        if (expectedPublicKeyHex.toLowerCase() !== manifest.signature.publicKey.toLowerCase()) {
            throw new Error(
                `Authenticity check failed: signed by unexpected key (expected ${expectedPublicKeyHex}, got ${manifest.signature.publicKey})`
            );
        }

        const isValid = ed25519.verify(sigBytes, signedBytes, pubKeyBytes);
        if (!isValid) {
            throw new Error('Authenticity check failed: invalid signature');
        }
    }

    return manifest;
}

/**
 * Filter manifest entries by type.
 */
export function filterByType(
    manifest: DailyManifest,
    type: ArtifactType
): ManifestEntry[] {
    return manifest.artifacts.filter((entry) => entry.type === type);
}

/**
 * Filter manifest entries by model.
 */
export function filterByModel(
    manifest: DailyManifest,
    model: string
): ManifestEntry[] {
    return manifest.artifacts.filter((entry) => entry.model === model);
}

/**
 * Filter observations by source and bucket.
 */
export function filterObservationsByBucket(
    manifest: DailyManifest,
    source: string,
    observedAtBucket: string
): ManifestEntry[] {
    return manifest.artifacts.filter((entry) =>
        entry.type === 'observation' &&
        entry.source === source &&
        entry.observedAtBucket === observedAtBucket
    );
}

/**
 * Get the date string for today in UTC (YYYY-MM-DD).
 */
export function getTodayDateString(): string {
    return new Date().toISOString().slice(0, 10);
}

/**
 * Get date strings for the last N days.
 */
export function getLastNDays(n: number, fromDate?: string): string[] {
    const dates: string[] = [];
    const start = fromDate ? new Date(fromDate) : new Date();
    for (let i = 0; i < n; i++) {
        const date = new Date(start);
        date.setUTCDate(date.getUTCDate() - i);
        dates.push(date.toISOString().slice(0, 10));
    }
    return dates;
}
