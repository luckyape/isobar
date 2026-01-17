import type { DailyForecast } from '@/lib/weatherTypes';

/**
 * Determines if it is currently "day" time based on available data.
 * 
 * Precedence:
 * 1. Explicit `isDay` boolean (e.g. from current weather API if available).
 * 2. `currentEpoch` vs `sunrise`/`sunset` epochs (if available in daily forecast).
 * 3. Local time heuristic (6am - 6pm) as last resort.
 */
export function getIsDay(
    currentEpoch?: number,
    dailyForecast?: DailyForecast,
    timezone?: string
): boolean {
    // Option 1: Explicit isDay logic - handled by caller usually, but if we pass it in, we use it.
    // Here we assume parameters are providing the source data for calculation.

    const now = currentEpoch ? new Date(currentEpoch * 1000) : new Date();

    // Option 2: Sunrise/Sunset logic
    if (dailyForecast && dailyForecast.sunrise && dailyForecast.sunset) {
        const sunrise = new Date(dailyForecast.sunrise).getTime();
        const sunset = new Date(dailyForecast.sunset).getTime();
        const currentTime = now.getTime();

        // Check if within today's sunlight window
        if (currentTime >= sunrise && currentTime < sunset) {
            return true;
        }
        return false;
    }

    // Option 3: Local time heuristic (Fallback)
    // Determine hours in the target timezone or local if not provided
    let hour: number;
    if (timezone) {
        try {
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone,
                hour: 'numeric',
                hour12: false
            }).formatToParts(now);
            const hourPart = parts.find(p => p.type === 'hour');
            hour = hourPart ? parseInt(hourPart.value, 10) : now.getHours();
        } catch (e) {
            // Fallback if timezone is invalid
            hour = now.getHours();
        }
    } else {
        hour = now.getHours();
    }

    // Simple heuristic: Day is 6:00 to 18:00
    return hour >= 6 && hour < 18;
}
