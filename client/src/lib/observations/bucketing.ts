/**
 * Standardized bucketing logic for observation alignment.
 * Ensures strict floor rounding to bucket start.
 */

// Milliseconds per minute
const MS_PER_MIN = 60 * 1000;

/**
 * Returns the start timestamp (epoch ms) of the bucket containing the given timestamp.
 * Buckets are aligned to 0 epoch time.
 * @param tsMs Timestamp in milliseconds
 * @param bucketMinutes Bucket size in minutes (default 60)
 */
export function bucketMs(tsMs: number, bucketMinutes: number = 60): number {
    const bucketDurationMs = bucketMinutes * MS_PER_MIN;
    return Math.floor(tsMs / bucketDurationMs) * bucketDurationMs;
}

/**
 * Returns the end timestamp (epoch ms) of the bucket (exclusive).
 */
export function bucketEndMs(tsMs: number, bucketMinutes: number = 60): number {
    return bucketMs(tsMs, bucketMinutes) + (bucketMinutes * MS_PER_MIN);
}

/**
 * Checks if a bucket is fully in the past (completed).
 * Rule: bucketEnd <= now
 */
export function isBucketCompleted(bucketStartMs: number, bucketMinutes: number, nowMs: number): boolean {
    return bucketEndMs(bucketStartMs, bucketMinutes) <= nowMs;
}
