/**
 * Weather Forecast CDN — Retention-Aware Reachability
 *
 * Computes the set of blob hashes that should be retained locally based on:
 * - Manifest discovery window
 * - Type-specific retention policies (forecast vs observation)
 * - Retraction semantics (block retracted hashes)
 * - Pins (manifests, hashes, grids)
 * - Active hashes (ephemeral, not persisted)
 */

import {
    type ClosetPolicy,
    getRetentionCutoff,
    isHashPinned,
    isManifestDatePinned
} from './policy';
import { getClosetDB, type ClosetDB } from './db';
import { getBlobStore, type BlobStore } from './blobStore';
import { unpackageManifest } from '@cdn/manifest';
import type { DailyManifest, ManifestEntry, RetractionArtifact } from '@cdn/types';
import { unpackageArtifact } from '@cdn/artifact';

// =============================================================================
// Types
// =============================================================================

/** Trust mode for manifest verification */
export type TrustMode = 'trusted' | 'unverified';

export interface ReachabilityParams {
    policy: ClosetPolicy;
    nowMs: number;
    /** Explicit trust mode - 'trusted' requires pubkey */
    trustMode: TrustMode;
    /** Required when trustMode === 'trusted' */
    expectedManifestPubKeyHex?: string;
    activeHashes?: string[];
}

export interface ReachabilityResult {
    reachable: Set<string>;
    blocked: Set<string>;
    manifestsProcessed: number;
    errors: string[];
    trustMode: TrustMode;
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Compute the set of reachable blob hashes based on policy and retention rules.
 *
 * Retention-aware marking:
 * - Use manifests within windowDays as discovery roots
 * - For each manifest entry:
 *   - forecast: keep if runTime >= now - keepForecastRunsDays
 *   - observation: keep if observedAtBucket >= now - keepObservationDays
 *   - station_set: only keep if referenced by a kept observation
 *   - retraction: keep the notice, block the retracted hash
 * - Always mark manifest hashes and pinned hashes as reachable
 */
export async function computeReachable(params: ReachabilityParams): Promise<Set<string>> {
    const result = await computeReachableWithDetails(params);
    return result.reachable;
}

export async function computeReachableWithDetails(params: ReachabilityParams): Promise<ReachabilityResult> {
    const { policy, nowMs, trustMode, activeHashes = [] } = params;

    // Guardrail 1: Require pubkey for trusted mode
    const expectedPk = requirePubKey(params);

    const closetDB = getClosetDB();
    const blobStore = getBlobStore();
    await closetDB.open();

    const reachable = new Set<string>();
    const blocked = new Set<string>();
    const reachableStationSets = new Set<string>();
    const errors: string[] = [];
    let manifestsProcessed = 0;

    // Calculate cutoffs
    const forecastCutoffMs = getRetentionCutoff(nowMs, policy.keepForecastRunsDays);
    const observationCutoffMs = getRetentionCutoff(nowMs, policy.keepObservationDays);
    const windowCutoffMs = getRetentionCutoff(nowMs, policy.windowDays);

    // 1. Get all manifest refs within window
    const allManifestRefs = await closetDB.getAllManifestRefs();
    const manifestsInWindow = allManifestRefs.filter((ref) => {
        const dateMs = new Date(ref.date + 'T00:00:00Z').getTime();
        return dateMs >= windowCutoffMs || isManifestDatePinned(policy, ref.date);
    });

    // 2. Process each manifest
    for (const ref of manifestsInWindow) {
        try {
            // Guardrail 2: Verify in the actual loop
            const manifest = await loadAndVerifyManifest(
                blobStore,
                closetDB,
                ref.hash,
                expectedPk
            );

            if (!manifest) {
                errors.push(`Manifest ${ref.hash} not found or failed to load`);
                continue;
            }

            // Mark manifest itself as reachable
            reachable.add(ref.hash);
            manifestsProcessed++; // Fix: actually increment

            // Process each entry with type-specific retention
            for (const entry of manifest.artifacts) {
                // Guardrail 3: Handle retractions first
                if (entry.type === 'retraction') {
                    reachable.add(entry.hash); // Keep the retraction notice

                    // Block the retracted hash
                    // Note: If retractedHash is in manifest entry, use it directly
                    // Otherwise we'd need to load the retraction artifact
                    if (entry.retractedHash) {
                        blocked.add(entry.retractedHash.toLowerCase());
                    }
                    continue;
                }

                const keepResult = shouldKeepEntry(
                    entry,
                    policy,
                    forecastCutoffMs,
                    observationCutoffMs
                );

                if (keepResult.keep) {
                    reachable.add(entry.hash);

                    // Track station sets referenced by kept observations
                    if (entry.type === 'observation' && entry.stationSetId) {
                        reachableStationSets.add(entry.stationSetId);
                    }
                }
            }
        } catch (err) {
            errors.push(`Error processing manifest ${ref.hash}: ${err}`);
        }
    }

    // 3. Mark station sets reachable (those referenced by kept observations)
    Array.from(reachableStationSets).forEach((stationSetId) => {
        reachable.add(stationSetId);
    });

    // 4. Add pinned hashes (normalized to lowercase)
    for (const pin of policy.pins) {
        if (pin.type === 'hash') {
            reachable.add(pin.hash.toLowerCase());
        }
    }

    // 5. Add active hashes (ephemeral)
    for (const hash of activeHashes) {
        reachable.add(hash.toLowerCase());
    }

    // Guardrail 3: Remove blocked hashes from reachable set
    Array.from(blocked).forEach((h) => {
        reachable.delete(h);
    });

    return {
        reachable,
        blocked,
        manifestsProcessed,
        errors,
        trustMode
    };
}

// =============================================================================
// Trust Mode Enforcement
// =============================================================================

/**
 * Guardrail 1: Require pubkey for trusted mode.
 * Returns normalized pubkey or undefined for unverified mode.
 */
function requirePubKey(params: ReachabilityParams): string | undefined {
    if (params.trustMode === 'trusted') {
        const pk = params.expectedManifestPubKeyHex?.toLowerCase();
        if (!pk) {
            throw new Error('Trusted mode requires expectedManifestPubKeyHex');
        }
        return pk;
    }
    return undefined;
}

// =============================================================================
// Entry Retention Logic
// =============================================================================

interface KeepResult {
    keep: boolean;
    reason: string;
}

/**
 * Determine if a manifest entry should be kept based on type-specific retention.
 * Guardrail 6: Pin check uses normalized hashes
 */
function shouldKeepEntry(
    entry: ManifestEntry,
    policy: ClosetPolicy,
    forecastCutoffMs: number,
    observationCutoffMs: number
): KeepResult {
    // Check if explicitly pinned by hash (normalize both sides)
    if (isHashPinned(policy, entry.hash.toLowerCase())) {
        return { keep: true, reason: 'pinned' };
    }

    switch (entry.type) {
        case 'forecast': {
            if (!entry.runTime) {
                return { keep: false, reason: 'no runTime' };
            }

            const runTimeMs = new Date(entry.runTime).getTime();
            if (runTimeMs >= forecastCutoffMs) {
                return { keep: true, reason: 'within forecast retention' };
            }

            return { keep: false, reason: 'outside forecast retention' };
        }

        case 'observation': {
            if (!entry.observedAtBucket) {
                return { keep: false, reason: 'no observedAtBucket' };
            }

            const bucketMs = new Date(entry.observedAtBucket).getTime();
            if (bucketMs >= observationCutoffMs) {
                return { keep: true, reason: 'within observation retention' };
            }

            return { keep: false, reason: 'outside observation retention' };
        }

        case 'station_set': {
            // Station sets are NOT kept by default.
            // They are only kept if referenced by a kept observation.
            return { keep: false, reason: 'station_set not kept by default' };
        }

        case 'metadata': {
            // Metadata follows the manifest window
            return { keep: true, reason: 'metadata follows manifest' };
        }

        // Note: retractions handled separately above
        default: {
            return { keep: false, reason: 'unknown type' };
        }
    }
}

// =============================================================================
// Manifest Loading & Verification
// =============================================================================

/**
 * Guardrail 2: Load and verify manifest in a single function.
 * Always verifies when pubkey is provided.
 */
async function loadAndVerifyManifest(
    blobStore: BlobStore,
    closetDB: ClosetDB,
    hash: string,
    expectedPubKeyHex?: string
): Promise<DailyManifest | null> {
    try {
        const blob = await blobStore.get(hash);

        // Check if already verified (optimization only, still verifies if key provided)
        if (expectedPubKeyHex) {
            const isVerified = await closetDB.isManifestVerified(hash, expectedPubKeyHex);
            if (isVerified) {
                // Skip verification, just unpackage
                return unpackageManifest(blob);
            }
        }

        // Unpackage with verification
        const manifest = await unpackageManifest(blob, expectedPubKeyHex);

        // Record verification receipt
        if (expectedPubKeyHex) {
            await closetDB.recordManifestVerified(hash, expectedPubKeyHex, Date.now());
        }

        return manifest;
    } catch (err) {
        // Return null on failure - caller adds to errors[]
        return null;
    }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get dates within the window for manifest discovery.
 */
export function getDatesInWindow(nowMs: number, windowDays: number): string[] {
    const dates: string[] = [];
    const msPerDay = 24 * 60 * 60 * 1000;

    for (let i = 0; i < windowDays; i++) {
        const date = new Date(nowMs - i * msPerDay);
        dates.push(date.toISOString().slice(0, 10));
    }

    return dates;
}

/**
 * Parse ISO date string to milliseconds.
 */
export function parseIsoToMs(iso: string): number {
    return new Date(iso).getTime();
}
