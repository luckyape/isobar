/**
 * Weather Forecast CDN — Time Utilities
 */

/**
 * Floor a date to the start of a bucket.
 * 
 * @param date The date to floor (or ISO string)
 * @param bucketMinutes The duration of the bucket in minutes (e.g., 60)
 * @returns A new Date object floored to the bucket boundary (UTC)
 */
export function floorToBucketUtc(date: Date | string, bucketMinutes: number): Date {
    const d = typeof date === 'string' ? new Date(date) : date;
    const ms = d.getTime();
    const bucketMs = bucketMinutes * 60_000;
    return new Date(Math.floor(ms / bucketMs) * bucketMs);
}
