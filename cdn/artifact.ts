/**
 * Weather Forecast CDN — Artifact Serialization
 *
 * CRITICAL: Artifact ID is the BLAKE3 hash of CANONICAL UNCOMPRESSED bytes.
 *
 * Binary blob format:
 * [Header (46 bytes)] + [gzip-compressed MsgPack payload]
 *
 * Header layout:
 *   Bytes 0-3:   Magic number (0x57464344 = "WFCD")
 *   Bytes 4-5:   Schema version (uint16 BE)
 *   Bytes 6-9:   Uncompressed size (uint32 BE)
 *   Bytes 10-41: Canonical payload hash (32 bytes) — THIS IS THE ARTIFACT ID
 *   Bytes 42-45: Encoding flags (uint32 BE) — for future extensibility
 *
 * The artifact ID is derived from:
 *   BLAKE3(canonicalJsonBytes(artifact))
 *
 * Storage uses MsgPack+gzip for compactness, but the ID is stable
 * regardless of compression algorithm/level/implementation.
 */

import { canonicalJsonBytes, canonicalMsgPack, decodeMsgPack } from './canonical';
import { compress, decompressWithEncoding, ENCODING_GZIP_MSGPACK } from './compress';
import { hash, toHex, hashesEqual } from './hash';
import {
    type Artifact,
    BLOB_MAGIC,
    CURRENT_SCHEMA_VERSION
} from './types';

// Header size: 46 bytes
export const BLOB_HEADER_SIZE = 46;

// Schema version enforcement
const MIN_SUPPORTED_SCHEMA = 1;
const MAX_SUPPORTED_SCHEMA = CURRENT_SCHEMA_VERSION; // Strict: reject future versions

export interface BlobHeader {
    magic: number;
    schemaVersion: number;
    uncompressedSize: number;
    /** Hash of canonical JSON bytes — THIS IS THE ARTIFACT ID */
    artifactId: Uint8Array;
    encodingFlags: number;
}

/**
 * Package an artifact into a content-addressed blob.
 *
 * Returns:
 *   - blob: The binary blob (header + compressed payload)
 *   - hash: The artifact ID (hash of CANONICAL MsgPack bytes)
 *
 * INVARIANT: Same logical artifact → same hash, regardless of:
 *   - Compression algorithm/level
 *   - MsgPack implementation
 *   - Library versions
 *   - Build environment
 */
export async function packageArtifact(
    artifact: Artifact
): Promise<{ blob: Uint8Array; hash: string }> {
    // 1. Serialize to Canonical MsgPack (Sorted Keys, No undefined)
    // This throws if the artifact contains forbidden types (undefined, function, etc.)
    const payloadBytes = canonicalMsgPack(artifact);

    // 2. Artifact ID = hash of canonical payload bytes (STABLE)
    const artifactId = hash(payloadBytes);
    const artifactIdHex = toHex(artifactId);

    // 3. Compress for transport
    const compressed = await compress(payloadBytes);

    // 4. Build header
    const header = new Uint8Array(BLOB_HEADER_SIZE);
    const view = new DataView(header.buffer);

    view.setUint32(0, BLOB_MAGIC, false);           // Magic
    view.setUint16(4, CURRENT_SCHEMA_VERSION, false); // Schema version
    view.setUint32(6, payloadBytes.length, false);  // Uncompressed size
    header.set(artifactId, 10);                     // Artifact ID (32 bytes)
    view.setUint32(42, ENCODING_GZIP_MSGPACK, false); // Encoding flags

    // 5. Concatenate header + compressed payload
    const blob = new Uint8Array(BLOB_HEADER_SIZE + compressed.length);
    blob.set(header, 0);
    blob.set(compressed, BLOB_HEADER_SIZE);

    return { blob, hash: artifactIdHex };
}

/**
 * Unpackage a blob into an artifact.
 *
 * Enforces:
 *   - Schema version bounds (strict reject for unsupported)
 *   - Encoding flag dispatch (hard fail for unknown)
 *   - Canonical hash verification
 */
export async function unpackageArtifact(blob: Uint8Array): Promise<Artifact> {
    if (blob.length < BLOB_HEADER_SIZE) {
        throw new Error('Blob too small: missing header');
    }

    // 1. Parse header
    const header = parseHeader(blob.slice(0, BLOB_HEADER_SIZE));

    // 2. Verify magic
    if (header.magic !== BLOB_MAGIC) {
        throw new Error(`Invalid magic: expected 0x${BLOB_MAGIC.toString(16)}, got 0x${header.magic.toString(16)}`);
    }

    // 3. Verify schema version (STRICT: reject future versions)
    if (header.schemaVersion < MIN_SUPPORTED_SCHEMA) {
        throw new Error(`Schema version ${header.schemaVersion} is too old (min: ${MIN_SUPPORTED_SCHEMA})`);
    }
    if (header.schemaVersion > MAX_SUPPORTED_SCHEMA) {
        throw new Error(`Schema version ${header.schemaVersion} is unsupported (max: ${MAX_SUPPORTED_SCHEMA})`);
    }

    // 4. Decompress using encoding-aware dispatch (hard fail for unknown)
    const compressedPayload = blob.slice(BLOB_HEADER_SIZE);
    const payloadBytes = await decompressWithEncoding(compressedPayload, header.encodingFlags);

    // 5. Verify size
    if (payloadBytes.length !== header.uncompressedSize) {
        throw new Error(
            `Size mismatch: expected ${header.uncompressedSize}, got ${payloadBytes.length}`
        );
    }

    // 6. CRITICAL: Verify canonical hash matches payload bytes directly
    // We hash the raw payload bytes because they ARE the canonical form
    const actualId = hash(payloadBytes);
    if (!hashesEqual(actualId, header.artifactId)) {
        throw new Error('Integrity check failed: artifact ID mismatch');
    }

    // 7. Decode MsgPack
    return decodeMsgPack<Artifact>(payloadBytes);
}

/**
 * Extract artifact ID from blob header WITHOUT full deserialization.
 * Useful for quick lookups.
 */
export function getArtifactId(blob: Uint8Array): string {
    if (blob.length < BLOB_HEADER_SIZE) {
        throw new Error('Blob too small');
    }
    return toHex(blob.slice(10, 42));
}

/**
 * Compute artifact ID from artifact object (without packaging).
 */
export function computeArtifactId(artifact: Artifact): string {
    const canonicalBytes = canonicalMsgPack(artifact);
    return toHex(hash(canonicalBytes));
}

/**
 * Parse blob header.
 */
export function parseHeader(headerBytes: Uint8Array): BlobHeader {
    if (headerBytes.length !== BLOB_HEADER_SIZE) {
        throw new Error(`Invalid header size: expected ${BLOB_HEADER_SIZE}`);
    }

    const view = new DataView(
        headerBytes.buffer,
        headerBytes.byteOffset,
        headerBytes.length
    );

    return {
        magic: view.getUint32(0, false),
        schemaVersion: view.getUint16(4, false),
        uncompressedSize: view.getUint32(6, false),
        artifactId: headerBytes.slice(10, 42),
        encodingFlags: view.getUint32(42, false)
    };
}

/**
 * Quick check if blob has valid header.
 */
export function hasValidHeader(blob: Uint8Array): boolean {
    if (blob.length < BLOB_HEADER_SIZE) return false;
    const view = new DataView(blob.buffer, blob.byteOffset, blob.length);
    return view.getUint32(0, false) === BLOB_MAGIC;
}

// Legacy export for compatibility
export function getBlobContentHash(blob: Uint8Array): string {
    return getArtifactId(blob);
}

/**
 * Validate that a variable map follows the direction: sourceKey -> canonicalKey.
 * Throws if keys look like canonical keys (heuristic).
 */
export function assertVariableMapDirection(
    variableMap: Record<string, string>,
    knownCanonicalKeys: string[]
): void {
    const canonicalSet = new Set(knownCanonicalKeys);

    for (const [sourceKey, canonicalKey] of Object.entries(variableMap)) {
        // Heuristic: if sourceKey IS a canonical key, and mapped to something else? 
        // Or if canonicalKey is NOT a known canonical key?

        if (!canonicalSet.has(canonicalKey)) {
            // It's acceptable if we have new metrics, but warning is strict mode.
            // But the main error is if the KEY is canonical, mapping TO source.
            if (canonicalSet.has(sourceKey)) {
                throw new Error(`Variable map seems inverted: ${sourceKey} (canonical) -> ${canonicalKey} (source). Expected source -> canonical.`);
            }
        }
    }
}
