/**
 * Weather Forecast CDN — Closet Module
 *
 * Client-side data management layer for offline-first weather forecasts.
 *
 * Features:
 * - Policy-driven retention (type-specific windows for forecasts vs observations)
 * - Deterministic mark-and-sweep GC
 * - Quota enforcement with stable deletion order
 * - BlobStore abstraction (pack-compatible)
 * - Post-sync maintenance hooks
 */

// Policy
export {
    type ClosetPolicy,
    type Pin,
    getDefaultClosetPolicy,
    normalizePolicy,
    isHashPinned,
    isManifestDatePinned,
    getGridPins,
    getRetentionCutoff
} from './policy';

// Database
export {
    type BlobMeta,
    type ManifestRef,
    type ObservationIndexEntry,
    type ForecastIndexEntry,
    type PackIndexEntry,
    ClosetDB,
    getClosetDB,
    buildManifestKey,
    buildObservationKey,
    buildForecastKey,
    META_TOTAL_BYTES_PRESENT,
    META_LAST_GC_AT
} from './db';

// Blob Store
export {
    type BlobStore,
    type BlobStoreConfig,
    ClosetBlobStore,
    getBlobStore,
    createBlobStore
} from './blobStore';

// Reachability
export {
    type ReachabilityParams,
    type ReachabilityResult,
    computeReachable,
    computeReachableWithDetails,
    getDatesInWindow,
    parseIsoToMs
} from './reachability';

// GC
export {
    type GCParams,
    type GCResult,
    sweepAndEnforce,
    getGCStats
} from './gc';

// Maintenance
export {
    type SyncResult,
    type MaintenanceParams,
    type MaintenanceResult,
    onSyncComplete,
    runMaintenance,
    forceGC
} from './maintenance';

// Locks
export {
    withClosetLock
} from './locks';
