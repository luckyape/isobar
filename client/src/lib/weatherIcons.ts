import type { WeatherIconName } from '@/icons/weather';

/**
 * Maps WMO weather code to the appropriate Basmilius icon name.
 * Handles day/night variants.
 */
export function conditionToIconName(code: number, isDay: boolean = true): WeatherIconName {
    // Helper to select variant
    const variant = (day: WeatherIconName, night: WeatherIconName) => isDay ? day : night;

    switch (code) {
        case 0: return variant('ClearDay', 'ClearNight');
        case 1: return variant('PartlyCloudyDay', 'PartlyCloudyNight'); // Mainly clear
        case 2: return variant('PartlyCloudyDay', 'PartlyCloudyNight'); // Partly cloudy
        case 3: return 'Overcast';

        case 45: return 'Fog';
        case 48: return 'Fog'; // Depositing rime fog

        case 51: return 'Drizzle'; // Light
        case 53: return 'Drizzle'; // Moderate
        case 55: return 'Drizzle'; // Dense

        case 56: return 'Sleet'; // Freezing drizzle treated as sleet/mixed ideally, or just sleet icon
        case 57: return 'Sleet';

        case 61: return 'Rain'; // Slight
        case 63: return 'Rain'; // Moderate
        case 65: return 'Rain'; // Heavy

        case 66: return 'Sleet'; // Freezing rain
        case 67: return 'Sleet';

        case 71: return 'Snow'; // Slight
        case 73: return 'Snow'; // Moderate
        case 75: return 'Snow'; // Heavy

        case 77: return 'Hail'; // Snow grains -> Hail/Snow

        case 80: return variant('PartlyCloudyDayRain', 'PartlyCloudyNightRain'); // Rain showers
        case 81: return variant('PartlyCloudyDayRain', 'PartlyCloudyNightRain');
        case 82: return variant('PartlyCloudyDayRain', 'PartlyCloudyNightRain'); // Violent

        case 85: return variant('PartlyCloudyDaySnow', 'PartlyCloudyNightSnow'); // Snow showers
        case 86: return variant('PartlyCloudyDaySnow', 'PartlyCloudyNightSnow');

        case 95: return 'Thunderstorms';
        case 96: return 'ThunderstormsRain'; // Thunderstorm with slight hail
        case 99: return 'ThunderstormsRain'; // Thunderstorm with heavy hail

        default: return variant('PartlyCloudyDay', 'PartlyCloudyNight'); // Fallback
    }
}
