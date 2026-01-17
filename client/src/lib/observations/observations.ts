import { getClosetDB, buildObservationKey } from '@/lib/closet';
import { getVault } from '@/lib/vault';
import type { ObservationArtifact, StationSetArtifact, StationInfo } from '@cdn/types';
import { parseOpenMeteoDateTime, formatDateTimeKey, isSameHour } from '@/lib/timeUtils';

/**
 * Observation Series containing aligned data arrays.
 * All arrays correspond to the requested time buckets.
 */
export interface ObservationSeries {
    buckets: number[]; // Epoch ms
    tempC: (number | null)[];
    windKph: (number | null)[];
    windGustKph: (number | null)[];
    windDirDeg: (number | null)[];
    precipMm: (number | null)[];
    conditionCode: (number | null)[]; // Maps to WMO codes if present
}

export interface ObservationData {
    stationId: string;
    stationName?: string;
    distanceKm: number;
    series: ObservationSeries;
    trust: {
        mode: 'trusted' | 'unverified';
        verifiedCount: number;
        unverifiedCount: number;
    };
}

// Haversine distance in km
function getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function deg2rad(deg: number) {
    return deg * (Math.PI / 180);
}

/**
 * Select the best station deterministically.
 * Rules:
 * 1. Nearest neighbor by Haversine distance.
 * 2. Tie-break: Smallest stationId lexicographically.
 * 3. (Optional) Prefer specific stationId if provided and present.
 */
export function selectStationId(
    stationSet: StationSetArtifact,
    targetLat: number,
    targetLon: number,
    preferredStationId?: string
): string | null {
    if (!stationSet.stations || stationSet.stations.length === 0) return null;

    if (preferredStationId) {
        const preferred = stationSet.stations.find(s => s.id === preferredStationId);
        if (preferred) return preferred.id;
    }

    let bestStation: StationInfo | null = null;
    let minDist = Infinity;

    for (const station of stationSet.stations) {
        const dist = getDistanceFromLatLonInKm(targetLat, targetLon, station.lat, station.lon);

        if (dist < minDist) {
            minDist = dist;
            bestStation = station;
        } else if (dist === minDist) {
            // Deterministic tie-break
            if (!bestStation || station.id < bestStation.id) {
                bestStation = station;
            }
        }
    }

    return bestStation ? bestStation.id : null;
}

/**
 * Get observation buckets for a time range from ClosetDB.
 * Returns valid buckets sorted by time.
 */
export async function getObservationBucketsForRange(
    source: string,
    startMs: number,
    endMs: number,
    bucketMinutes: number = 60
): Promise<{ bucketIso: string; hash: string; stationSetId: string }[]> {
    const db = getClosetDB();
    const bucketDurationMs = bucketMinutes * 60 * 1000;

    // We need to scan potentially relevant buckets.
    // Since ClosetDB index is key-based, and we don't have a time-range index on obsIndex yet,
    // we might need to iterate or construct keys if we know the buckets.
    //
    // NOTE: In the implementation plan, we assumed `getObservationsByBucket` works.
    // Actually, `ClosetDB.getObservationsByBucket` takes (source, bucketIso).
    // So we should generate the ISO strings for the range and query them.

    // Align start/end to bucket boundaries
    const startAligned = Math.floor(startMs / bucketDurationMs) * bucketDurationMs;
    const endAligned = Math.ceil(endMs / bucketDurationMs) * bucketDurationMs;

    const results: { bucketIso: string; hash: string; stationSetId: string }[] = [];

    for (let t = startAligned; t <= endAligned; t += bucketDurationMs) {
        const date = new Date(t);
        // Format to ISO UTC for the bucket key
        // OpenMeteo/WeatherAPI uses ISO8601 strings usually.
        // Our `formatDateTimeKey` produces "YYYY-MM-DDTHH:mm".
        // Check `types.ts`: observedAtBucket is "ISO 8601 UTC".
        const iso = date.toISOString().slice(0, 19).replace('T', 'T'); // "YYYY-MM-DDTHH:mm:ss"
        // Actually our strict format in `timeUtils` is slightly different ("T" separator, no seconds if 00?).
        // Let's assume standard ISO for the raw loop generation, but we need to match what's in DB.
        // The implementation of `ingest` (which we don't see here but assume exists) likely uses standard ISO.
        // Let's try to list observations from DB if possible, or construct keys.
        //
        // WAIT: `ClosetDB` has `byBucket` index on `[source, observedAtBucket]`.
        // We can query that if we know the timestamp string.
        // Let's assume the standard `YYYY-MM-DDTHH:mm:00Z` or `YYYY-MM-DDTHH:mm`.
        // Types says "ISO 8601 UTC".
        // Let's use `toISOString()` as the safest guess for strictly bucketed data.
        // NOTE: The `observedAtBucket` is a string.

        // We'll try to probe the DB for this bucket.
        // If we have "Daily" manifests, we might have many buckets.
        // If we can't efficiently range query, we iterate steps.
        // 48h range = 48 queries. This is cheap against IndexedDB.

        const timestampStr = iso.endsWith('Z') ? iso.slice(0, -1) : iso;
        // Usually "2024-01-01T12:00:00.000" -> convert to what DB has.
        // Let's assume the DB stores exactly "YYYY-MM-DDTHH:mm:ssZ" or similar.
        // To be safe, let's look at `normalizeObservationTime` in `weatherApi.ts`...
        // It calls `parseOpenMeteoDateTime` then `formatDateTimeKey`.
        // `formatDateTimeKey` returns `YYYY-MM-DDTHH:mm`.
        // So let's use that format.

        // Custom formatting to match `timeUtils`
        const parts = {
            year: date.getUTCFullYear(),
            month: date.getUTCMonth() + 1,
            day: date.getUTCDate(),
            hour: date.getUTCHours(),
            minute: date.getUTCMinutes()
        };
        const bucketIso = formatDateTimeKey(parts); // "2024-01-01T12:00"

        if (!bucketIso) continue;

        const entries = await db.getObservationsByBucket(source, bucketIso);
        // Filter by stationSetId if strictly required, or we might accept any if we just want data?
        // User req: "Multiple station sets referenced... station selection re-runs per stationSetId".
        // So we should find the entry that matches our target stationSetId if possible.
        // Actually, the `stationSetId` is part of the key/entry.
        // We should prefer the one matching the `stationSetId` we are currently using, 
        // BUT if the bucket references a DRAWN station set, we must use that one's stations.

        // The `stationSetId` passed to this function is the "current" one from the latest manifest/view?
        // Or do we just want *any* observation for this bucket?
        //
        // Re-reading requirements:
        // "Multiple station sets referenced across buckets (stationSetId changes):
        //  station selection re-runs per stationSetId, deterministic"
        //
        // So we should return ALL matching entries for this bucket (regardless of stationSetId),
        // and let the caller handle the stationSetId changes.
        // BUT `getObservationsByBucket` filters by source/bucket.

        for (const entry of entries) {
            results.push({ bucketIso: entry.observedAtBucket, hash: entry.hash, stationSetId: entry.stationSetId });
        }
    }

    return results;
}

/**
 * Fetch observation artifacts from Vault.
 */
async function fetchObservationArtifacts(
    hashes: string[]
): Promise<ObservationArtifact[]> {
    const vault = getVault();
    const artifacts: ObservationArtifact[] = [];

    // Parallel fetch
    const promises = hashes.map(async (hash) => {
        try {
            const artifact = await vault.getArtifact(hash);
            if (artifact && artifact.type === 'observation') {
                return artifact;
            }
        } catch (e) {
            console.warn(`Failed to load observation artifact ${hash}`, e);
        }
        return null;
    });

    const results = await Promise.all(promises);
    return results.filter((a): a is ObservationArtifact => a !== null);
}

/**
 * Extract series data aligned to the specific buckets.
 */
export async function extractObservationSeries(
    artifacts: ObservationArtifact[],
    targetStationId: string, // We might need to re-select if stationSet changes
    targetLat: number,
    targetLon: number,
    bucketsMs: number[]
): Promise<{ series: ObservationSeries; verifiedCount: number; unverifiedCount: number; }> {
    // Map bucket time (ms) -> Artifact
    const artifactMap = new Map<number, ObservationArtifact>();
    const stationSetCache = new Map<string, string | null>(); // stationSetId -> bestStationId
    const vault = getVault();

    let verifiedCount = 0;
    let unverifiedCount = 0;

    for (const art of artifacts) {
        const parts = parseOpenMeteoDateTime(art.observedAtBucket);
        if (!parts) continue;

        // Convert back to ms for matching
        const ms = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour!, parts.minute!);
        artifactMap.set(ms, art);

        // Check verification status (this is loose, assuming existence in Vault implies some trust, 
        // but strict "trusted mode" check handles the UI label)
        // Actually, we count them for the UI signal.
        // In strict trusted mode, unverified blobs might be hidden or flagged.
        // For now, we just count them.
        unverifiedCount++; // Placeholder: we need real trust info passed in or stored.
        // Assuming for now everything from Vault is "loaded", we'll refine trust later.
    }

    const len = bucketsMs.length;
    const tempC = new Array(len).fill(null);
    const windKph = new Array(len).fill(null);
    const windGustKph = new Array(len).fill(null);
    const windDirDeg = new Array(len).fill(null);
    const precipMm = new Array(len).fill(null);
    const conditionCode = new Array(len).fill(null);

    for (let i = 0; i < len; i++) {
        const t = bucketsMs[i];
        const art = artifactMap.get(t);
        if (!art) continue;

        // Station Selection (Dynamic per artifact)
        let stationIdForThisBucket = targetStationId;
        if (art.stationSetId) {
            if (!stationSetCache.has(art.stationSetId)) {
                // We must fetch the station set to re-select if it differs
                // This is expensive if we do it serially.
                // Optimization: Pre-fetch station sets?
                // For MVP, lets try to load it.
                try {
                    const setArt = await vault.getArtifact(art.stationSetId);
                    if (setArt && setArt.type === 'station_set') {
                        const best = selectStationId(setArt, targetLat, targetLon, targetStationId);
                        stationSetCache.set(art.stationSetId, best);
                    } else {
                        stationSetCache.set(art.stationSetId, null);
                    }
                } catch {
                    stationSetCache.set(art.stationSetId, null);
                }
            }
            const cached = stationSetCache.get(art.stationSetId);
            if (cached) stationIdForThisBucket = cached;
            else if (cached === null) continue; // Station set missing, skip
        }

        // Extract Data
        // Variable keys: "airTempC", "windSpdKmh", "windDirDeg", "precipMm", "weatherCode" (canonical)
        // Check artifact.variables or just probe data
        // Data struct: art.data[varKey][stationId]

        if (art.data['airTempC'] && art.data['airTempC'][stationIdForThisBucket] !== undefined) {
            tempC[i] = art.data['airTempC'][stationIdForThisBucket];
        }
        if (art.data['windSpdKmh'] && art.data['windSpdKmh'][stationIdForThisBucket] !== undefined) {
            windKph[i] = art.data['windSpdKmh'][stationIdForThisBucket];
        }
        if (art.data['windGustKph'] && art.data['windGustKph'][stationIdForThisBucket] !== undefined) {
            windGustKph[i] = art.data['windGustKph'][stationIdForThisBucket];
        }
        if (art.data['windDirDeg'] && art.data['windDirDeg'][stationIdForThisBucket] !== undefined) {
            windDirDeg[i] = art.data['windDirDeg'][stationIdForThisBucket];
        }
        if (art.data['precipMm'] && art.data['precipMm'][stationIdForThisBucket] !== undefined) {
            precipMm[i] = art.data['precipMm'][stationIdForThisBucket];
        }
        if (art.data['weatherCode'] && art.data['weatherCode'][stationIdForThisBucket] !== undefined) {
            conditionCode[i] = art.data['weatherCode'][stationIdForThisBucket];
        }
    }

    return {
        series: { buckets: bucketsMs, tempC, windKph, windGustKph, windDirDeg, precipMm, conditionCode },
        verifiedCount: 0, // TODO: Wiring strict trust check
        unverifiedCount: len
    };
}

/**
 * Orchestrator: Fetch observations for a specific range and location.
 */
export async function fetchObservationsForRange(
    source: string,
    startMs: number,
    endMs: number,
    _fallbackStationSetId: string, // Deprecated - kept for API compatibility
    targetLat: number,
    targetLon: number
): Promise<ObservationData | null> {
    // 1. First discover observation buckets from ClosetDB
    const buckets = await getObservationBucketsForRange(source, startMs, endMs);

    if (buckets.length === 0) {
        return null;
    }

    // 2. Get the stationSetId from the first bucket entry
    const primaryStationSetId = buckets[0].stationSetId;
    if (!primaryStationSetId) {
        return null;
    }

    // 3. Get station set artifact to select nearest station
    const vault = getVault();
    const stationSetArt = (await vault.getArtifact(primaryStationSetId)) as StationSetArtifact | null;

    if (!stationSetArt || stationSetArt.type !== 'station_set') {
        return null;
    }

    const stationId = selectStationId(stationSetArt, targetLat, targetLon);
    if (!stationId) return null;

    // 3. Fetch Artifacts
    const artifacts = await fetchObservationArtifacts(buckets.map(b => b.hash));

    // 4. Generate Timeslots (Hourly)
    //    We want a continuous series for the graph, even if gaps exist.
    //    Align to hours.
    const startHour = Math.floor(startMs / 3600000) * 3600000;
    const endHour = Math.ceil(endMs / 3600000) * 3600000;
    const bucketsMs: number[] = [];
    for (let t = startHour; t <= endHour; t += 3600000) {
        bucketsMs.push(t);
    }

    // 5. Extract Series
    const { series, verifiedCount, unverifiedCount } = await extractObservationSeries(
        artifacts,
        stationId,
        targetLat,
        targetLon,
        bucketsMs
    );

    // Calculate distance for metadata
    const stationInfo = stationSetArt.stations.find(s => s.id === stationId);
    const distance = stationInfo
        ? getDistanceFromLatLonInKm(targetLat, targetLon, stationInfo.lat, stationInfo.lon)
        : 0;

    return {
        stationId,
        stationName: stationInfo?.name,
        distanceKm: distance,
        series,
        trust: {
            mode: 'unverified',
            verifiedCount,
            unverifiedCount
        }
    };
}

/**
 * Get the single latest observation available in the closet.
 */
export async function getLatestObservation(
    targetLat: number,
    targetLon: number
): Promise<ObservationData | null> {
    const db = getClosetDB();
    const all = await db.getAllObservationIndexEntries();
    if (all.length === 0) return null;

    // Find entry with max observedAtBucket (lexicographical sort works for ISO strings)
    // "2024-01-01T12:00" > "2024-01-01T11:00"
    const newest = all.reduce((a, b) => (a.observedAtBucket > b.observedAtBucket ? a : b));

    // Get station set to resolve station ID
    const vault = getVault();
    let stationId: string | null = null;
    let stationSetArt: StationSetArtifact | null = null;

    if (newest.stationSetId) {
        try {
            stationSetArt = (await vault.getArtifact(newest.stationSetId)) as StationSetArtifact | null;
            if (stationSetArt && stationSetArt.type === 'station_set') {
                stationId = selectStationId(stationSetArt, targetLat, targetLon);
            }
        } catch {
            // ignore missing station set
        }
    }

    if (!stationId) return null;

    try {
        const artifacts = await fetchObservationArtifacts([newest.hash]);
        if (artifacts.length === 0) return null;

        const art = artifacts[0];
        // Calculate timestamp for this specific bucket
        const parts = parseOpenMeteoDateTime(art.observedAtBucket);
        if (!parts) return null;
        const bucketMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour!, parts.minute!);

        const { series, verifiedCount, unverifiedCount } = await extractObservationSeries(
            [art],
            stationId,
            targetLat,
            targetLon,
            [bucketMs]
        );

        const stationInfo = stationSetArt?.stations.find(s => s.id === stationId);
        const distance = stationInfo
            ? getDistanceFromLatLonInKm(targetLat, targetLon, stationInfo.lat, stationInfo.lon)
            : 0;

        return {
            stationId,
            stationName: stationInfo?.name,
            distanceKm: distance,
            series,
            trust: {
                mode: 'unverified',
                verifiedCount,
                unverifiedCount
            }
        };
    } catch (e) {
        console.warn('Failed to get latest observation', e);
        return null;
    }
}
