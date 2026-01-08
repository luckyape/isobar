/**
 * Weather Forecast CDN — Core Type Definitions
 *
 * These types define the immutable artifact schema for the content-addressed
 * forecast distribution network. All artifacts are self-describing and versioned.
 */

// =============================================================================
// Artifact Types
// =============================================================================

/**
 * Base interface for all CDN artifacts.
 * Every artifact is self-describing with schema version and type.
 */
export interface ArtifactBase {
    schemaVersion: number;
    type: ArtifactType;
}

export type ArtifactType =
    | 'forecast'
    | 'observation'
    | 'station_set'
    | 'metadata'
    | 'retraction';

// =============================================================================
// Forecast Artifacts
// =============================================================================

/**
 * A single forecast run from a weather model.
 * Immutable: one artifact per (model, runTime, grid).
 */
export interface ForecastArtifact extends ArtifactBase {
    type: 'forecast';

    /** Model identifier (e.g., "gem_seamless", "gfs_seamless") */
    model: string;

    /** Model run initialization time (ISO 8601 UTC) */
    runTime: string;

    /** Unix epoch seconds when this data became available from the source */
    issuedAt: number;

    /** Array of valid forecast times (ISO 8601 UTC) */
    validTimes: string[];

    /** List of variable names included in this artifact */
    variables: string[];

    /** Spatial definition for this forecast */
    grid: PointGrid | BboxGrid;

    /** Variable data: variable name → array of values (aligned with validTimes) */
    data: Record<string, number[]>;

    /** 
     * sourceKey -> canonicalKey (e.g., { "temperature_2m": "airTempC" })
     * Essential for aligning scoring.
     */
    variableMap: Record<string, string>;

    /** Data source identifier */
    source: string;

    /** Original API URL for provenance (optional) */
    sourceUrl?: string;
}

export interface PointGrid {
    type: 'point';
    lat: number;
    lon: number;
}

export interface BboxGrid {
    type: 'bbox';
    north: number;
    south: number;
    east: number;
    west: number;
    resolution?: number;
}

// =============================================================================
// Observation Artifacts
// =============================================================================

/**
 * A snapshot of station observations at a point in time.
 * Immutable: one artifact per (source, observedAtBucket, stationSetId).
 * 
 * OBSERVATION-SPECIFIC RULES:
 * - `data` values must be finite numbers (no NaN/Infinity).
 * - `data` missing values must be omitted or null (canonical JSON/MsgPack handles null).
 * - `stationSetId` enables metadata decoupling (reducing blob size).
 */
export interface ObservationArtifact extends ArtifactBase {
    type: 'observation';

    /** Data source identifier (e.g., "eccc", "noaa") */
    source: string;

    /** 
     * Snapshot logic:
     * - `observedAtBucket`: The start of the time bucket (ISO 8601 UTC).
     * - `observedAtRaw`: The actual source timestamp (optional).
     * - `bucketMinutes`: Duration of the bucket (e.g., 60 for hourly).
     */
    observedAtBucket: string;
    observedAtRaw?: string;
    bucketMinutes: number;

    /** Unix epoch seconds when this data was fetched */
    fetchedAt: number;

    /** 
     * ID of the StationSetArtifact containing metadata for stations in this snapshot.
     * MUST be the BLAKE3 hash of the canonical MsgPack of the referenced `StationSetArtifact`.
     */
    stationSetId: string;

    /** 
     * List of variable keys included in this artifact (e.g., "airTempC").
     * Stable naming convention required.
     */
    variables: string[];

    /** 
     * Observation data: variableKey → stationId → value (null if missing).
     * Keys must be stable (e.g. "airTempC", "windSpdKmh").
     */
    data: Record<string, Record<string, number | null>>;
}

/**
 * A reusable set of station metadata.
 * Referenced by ObservationArtifacts to avoid repetition.
 */
export interface StationSetArtifact extends ArtifactBase {
    type: 'station_set';

    /** Source of these stations (e.g. "eccc") */
    source: string;

    /** CreatedAt must NOT be included in StationSet to prevent hash drift */
    createdAt?: never;

    /** List of stations with full metadata */
    stations: StationInfo[];
}

export interface StationInfo {
    /** Unique station identifier (alphanumeric, stable) */
    id: string;

    /** Latitude (decimal degrees) */
    lat: number;

    /** Longitude (decimal degrees) */
    lon: number;

    /** Human-readable name */
    name?: string;

    /** Elevation in meters */
    elevation?: number;

    /** WMO ID or other alternate identifiers */
    wmoId?: string;
}

// =============================================================================
// Metadata Artifacts
// =============================================================================

/**
 * Metadata about a model or station set.
 * Rarely changes; separate lifecycle from forecast/observation data.
 */
export interface MetadataArtifact extends ArtifactBase {
    type: 'metadata';

    /** What this metadata describes */
    subject: 'model' | 'stationSet';

    /** Subject identifier */
    id: string;

    /** Human-readable name */
    name: string;

    /** Description */
    description?: string;

    /** Provider organization */
    provider?: string;

    /** Additional properties (schema-dependent) */
    properties: Record<string, unknown>;

    /** When this metadata was created (ISO 8601 UTC) */
    createdAt: string;
}

// =============================================================================
// Retraction Artifacts
// =============================================================================

/**
 * A retraction notice for a previously published artifact.
 * The retracted artifact remains in storage but clients can filter it out.
 */
export interface RetractionArtifact extends ArtifactBase {
    type: 'retraction';

    /** BLAKE3 hash of the retracted artifact */
    retractedHash: string;

    /** Reason for retraction */
    reason: string;

    /** Who issued the retraction */
    issuedBy: string;

    /** When the retraction was issued (ISO 8601 UTC) */
    issuedAt: string;
}

// =============================================================================
// Union Type
// =============================================================================

export type Artifact =
    | ForecastArtifact
    | ObservationArtifact
    | StationSetArtifact
    | MetadataArtifact
    | RetractionArtifact;

// =============================================================================
// Manifest Types
// =============================================================================

/**
 * A daily manifest listing all artifacts published on a given date.
 * Manifests are also content-addressed, immutable, and SIGNED.
 */
export interface DailyManifest {
    schemaVersion: number;

    /** Date this manifest covers (YYYY-MM-DD) */
    date: string;

    /** BLAKE3 hash of the previous manifest for hash-chain integrity */
    previousManifestHash?: string;

    /** When this manifest was published (ISO 8601 UTC) */
    publishedAt: string;

    /** List of artifacts published in this manifest */
    artifacts: ManifestEntry[];

    /** Ed25519 signature envelope (authenticity proof) */
    signature?: SignedEnvelope;
}

/** Signature envelope for authenticity verification */
export interface SignedEnvelope {
    /** Hex-encoded Ed25519 signature (64 bytes) */
    signature: string;
    /** Hex-encoded public key (32 bytes) */
    publicKey: string;
    /** ISO 8601 timestamp when signed */
    signedAt: string;
}

export interface ManifestEntry {
    /** Artifact ID (BLAKE3 hash of canonical bytes) — also the object key */
    hash: string;

    /** Artifact type */
    type: ArtifactType;

    /** Size in bytes (compressed blob) */
    sizeBytes: number;

    // Type-specific metadata for filtering without downloading
    model?: string;
    runTime?: string;
    source?: string;
    observedAtBucket?: string;
    stationSetId?: string;
}

// =============================================================================
// Constants
// =============================================================================

export const BLOB_MAGIC = 0x57464344; // "WFCD" in ASCII

// =============================================================================
// Current Schema Version
// =============================================================================

export const CURRENT_SCHEMA_VERSION = 1;

