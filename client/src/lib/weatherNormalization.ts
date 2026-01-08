// Icon-level normalization: collapse WMO codes that render the same graphics.
export const WEATHER_CODE_NORMALIZATION: Record<number, number> = {
    0: 0,
    1: 1,
    2: 2,
    3: 3,
    45: 45,
    48: 45,
    51: 61,
    53: 61,
    55: 61,
    56: 71,
    57: 71,
    61: 61,
    63: 61,
    65: 61,
    66: 71,
    67: 71,
    71: 71,
    73: 71,
    75: 75,
    77: 71,
    80: 80,
    81: 80,
    82: 95,
    85: 71,
    86: 75,
    95: 95,
    96: 95,
    99: 95
};

export function normalizeWeatherCode(code: unknown): number {
    const parsed = typeof code === 'number' ? code : Number(code);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
        return NaN;
    }
    return WEATHER_CODE_NORMALIZATION[parsed] ?? parsed;
}

// WMO Weather interpretation codes
export const WEATHER_CODES: Record<number, { description: string; icon: string }> = {
    0: { description: 'Clear sky', icon: '☀️' },
    1: { description: 'Mainly clear', icon: '🌤️' },
    2: { description: 'Partly cloudy', icon: '⛅' },
    3: { description: 'Overcast', icon: '☁️' },
    45: { description: 'Fog', icon: '🌫️' },
    48: { description: 'Depositing rime fog', icon: '🌫️' },
    51: { description: 'Light drizzle', icon: '🌧️' },
    53: { description: 'Moderate drizzle', icon: '🌧️' },
    55: { description: 'Dense drizzle', icon: '🌧️' },
    56: { description: 'Light freezing drizzle', icon: '🌨️' },
    57: { description: 'Dense freezing drizzle', icon: '🌨️' },
    61: { description: 'Rain', icon: '🌧️' },
    63: { description: 'Moderate rain', icon: '🌧️' },
    65: { description: 'Heavy rain', icon: '🌧️' },
    66: { description: 'Light freezing rain', icon: '🌨️' },
    67: { description: 'Heavy freezing rain', icon: '🌨️' },
    71: { description: 'Snow', icon: '🌨️' },
    73: { description: 'Moderate snow', icon: '🌨️' },
    75: { description: 'Heavy snow', icon: '❄️' },
    77: { description: 'Snow grains', icon: '🌨️' },
    80: { description: 'Rain showers', icon: '🌦️' },
    81: { description: 'Moderate rain showers', icon: '🌦️' },
    82: { description: 'Violent rain showers', icon: '⛈️' },
    85: { description: 'Slight snow showers', icon: '🌨️' },
    86: { description: 'Heavy snow showers', icon: '❄️' },
    95: { description: 'Thunderstorm', icon: '⛈️' },
    96: { description: 'Thunderstorm with slight hail', icon: '⛈️' },
    99: { description: 'Thunderstorm with heavy hail', icon: '⛈️' }
};
