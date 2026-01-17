/**
 * PrecipPatterns - SVG pattern definitions for precipitation visualization
 * Renders particle-based patterns that mimic real weather radar aesthetics
 */

export type IntensityLevel = 'none' | 'drizzle' | 'light' | 'moderate' | 'heavy' | 'extreme';
export type PrecipType = 'rain' | 'snow';

export function getIntensityLevel(mmPerHour: number | null): IntensityLevel {
  if (!Number.isFinite(mmPerHour) || mmPerHour === null || mmPerHour <= 0) return 'none';
  if (mmPerHour <= 0.3) return 'drizzle';
  if (mmPerHour <= 1.0) return 'light';
  if (mmPerHour <= 2.5) return 'moderate';
  if (mmPerHour <= 5.0) return 'heavy';
  return 'extreme';
}

/**
 * Determine precipitation type from WMO weather code
 * Snow codes: 71-77 (snow), 85-86 (snow showers)
 * Sleet/freezing: 66-67 (freezing rain), 56-57 (freezing drizzle) - treat as snow
 * Rain codes: everything else with precip (51-55, 61-65, 80-82, etc.)
 * 
 * If weather code is missing/invalid and temperature is provided,
 * uses temperature to determine type (snow if temp <= 2°C)
 */
export function getPrecipTypeFromWeatherCode(
  weatherCode: number | null | undefined,
  temperatureCelsius?: number | null
): PrecipType {
  // First check weather code if available
  if (Number.isFinite(weatherCode) && weatherCode !== null && weatherCode !== undefined) {
    // Snow: 71-77 (snow fall), 85-86 (snow showers)
    if ((weatherCode >= 71 && weatherCode <= 77) || (weatherCode >= 85 && weatherCode <= 86)) {
      return 'snow';
    }
    // Freezing precipitation: 56-57 (freezing drizzle), 66-67 (freezing rain) - show as snow
    if ((weatherCode >= 56 && weatherCode <= 57) || (weatherCode >= 66 && weatherCode <= 67)) {
      return 'snow';
    }
    // If weather code indicates precipitation (not just clouds), trust it
    if (weatherCode >= 51) {
      return 'rain';
    }
  }

  // Fallback: use temperature if available
  // Snow typically forms at or below 2°C (35.6°F) due to atmospheric conditions
  if (temperatureCelsius !== undefined && temperatureCelsius !== null && Number.isFinite(temperatureCelsius)) {
    if (temperatureCelsius <= 2) {
      return 'snow';
    }
  }

  return 'rain'; // default
}

export function getPatternId(
  intensity: number | null,
  variant: 'forecast' | 'observed' = 'forecast',
  precipType: PrecipType = 'rain'
): string {
  const level = getIntensityLevel(intensity);
  if (level === 'none') return '';
  const typePrefix = precipType === 'snow' ? 'snow' : 'precip';
  return `${typePrefix}-${level}${variant === 'observed' ? '-observed' : ''}`;
}

export function getTracePatternId(
  variant: 'forecast' | 'observed' = 'forecast',
  precipType: PrecipType = 'rain'
): string {
  const typePrefix = precipType === 'snow' ? 'snow' : 'precip';
  return `${typePrefix}-trace${variant === 'observed' ? '-observed' : ''}`;
}

/**
 * Render this component once at the top of your precipitation chart.
 * It provides all the SVG pattern definitions that cells reference via fill="url(#pattern-id)"
 */
export function PrecipPatterns() {
  return (
    <svg className="absolute w-0 h-0 overflow-hidden" aria-hidden="true">
      <defs>
        {/* ===== RAIN PATTERNS (Blue) ===== */}

        {/* Trace: Two sparse drops (match drizzle style) for POP-only cells */}
        <pattern
          id="precip-trace"
          width="28"
          height="28"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="12" cy="12" r="1" fill="oklch(0.65 0.18 240)" opacity="0.45" />
          <circle cx="18" cy="16" r="0.9" fill="oklch(0.65 0.18 240)" opacity="0.4" />
        </pattern>

        {/* Drizzle: Sparse small dots, nearly vertical */}
        <pattern
          id="precip-drizzle"
          width="14"
          height="14"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="3" cy="3" r="1" fill="oklch(0.65 0.18 240)" opacity="0.5" />
          <circle cx="10" cy="8" r="0.8" fill="oklch(0.65 0.18 240)" opacity="0.45" />
          <circle cx="6" cy="12" r="1" fill="oklch(0.65 0.18 240)" opacity="0.4" />
        </pattern>

        {/* Light rain: Small elongated drops, slight angle */}
        <pattern
          id="precip-light"
          width="12"
          height="16"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(8)"
        >
          <line x1="3" y1="0" x2="3.5" y2="6" stroke="oklch(0.62 0.2 235)" strokeWidth="1.2" strokeLinecap="round" opacity="0.55" />
          <line x1="9" y1="5" x2="9.5" y2="11" stroke="oklch(0.62 0.2 235)" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
          <line x1="6" y1="10" x2="6.5" y2="15" stroke="oklch(0.62 0.2 235)" strokeWidth="1" strokeLinecap="round" opacity="0.45" />
        </pattern>

        {/* Moderate rain: Longer streaks, more angle */}
        <pattern
          id="precip-moderate"
          width="10"
          height="18"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(15)"
        >
          <line x1="2" y1="0" x2="3" y2="10" stroke="oklch(0.58 0.22 230)" strokeWidth="1.5" strokeLinecap="round" opacity="0.65" />
          <line x1="7" y1="4" x2="8" y2="14" stroke="oklch(0.58 0.22 230)" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
          <line x1="4.5" y1="12" x2="5.5" y2="18" stroke="oklch(0.58 0.22 230)" strokeWidth="1.3" strokeLinecap="round" opacity="0.55" />
        </pattern>

        {/* Heavy rain: Dense long streaks, steeper angle */}
        <pattern
          id="precip-heavy"
          width="8"
          height="20"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(25)"
        >
          <line x1="1" y1="0" x2="2.5" y2="14" stroke="oklch(0.55 0.24 225)" strokeWidth="1.8" strokeLinecap="round" opacity="0.75" />
          <line x1="5" y1="3" x2="6.5" y2="17" stroke="oklch(0.55 0.24 225)" strokeWidth="1.8" strokeLinecap="round" opacity="0.7" />
          <line x1="3" y1="10" x2="4" y2="20" stroke="oklch(0.55 0.24 225)" strokeWidth="1.5" strokeLinecap="round" opacity="0.65" />
        </pattern>

        {/* Extreme rain: Very dense, steep angle, overlapping */}
        <pattern
          id="precip-extreme"
          width="6"
          height="22"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(35)"
        >
          <line x1="0.5" y1="0" x2="2.5" y2="16" stroke="oklch(0.52 0.26 220)" strokeWidth="2.2" strokeLinecap="round" opacity="0.85" />
          <line x1="3.5" y1="2" x2="5.5" y2="18" stroke="oklch(0.52 0.26 220)" strokeWidth="2.2" strokeLinecap="round" opacity="0.8" />
          <line x1="2" y1="8" x2="3.5" y2="22" stroke="oklch(0.52 0.26 220)" strokeWidth="1.8" strokeLinecap="round" opacity="0.75" />
        </pattern>

        {/* ===== RAIN OBSERVED PATTERNS (Grayscale Blue) ===== */}

        <pattern
          id="precip-trace-observed"
          width="28"
          height="28"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="12" cy="12" r="1" fill="oklch(0.7 0.05 240)" opacity="0.4" />
          <circle cx="18" cy="16" r="0.9" fill="oklch(0.7 0.05 240)" opacity="0.35" />
        </pattern>

        <pattern
          id="precip-drizzle-observed"
          width="14"
          height="14"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="3" cy="3" r="1" fill="oklch(0.7 0.05 240)" opacity="0.45" />
          <circle cx="10" cy="8" r="0.8" fill="oklch(0.7 0.05 240)" opacity="0.4" />
          <circle cx="6" cy="12" r="1" fill="oklch(0.7 0.05 240)" opacity="0.35" />
        </pattern>

        <pattern
          id="precip-light-observed"
          width="12"
          height="16"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(8)"
        >
          <line x1="3" y1="0" x2="3.5" y2="6" stroke="oklch(0.68 0.05 240)" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
          <line x1="9" y1="5" x2="9.5" y2="11" stroke="oklch(0.68 0.05 240)" strokeWidth="1.2" strokeLinecap="round" opacity="0.45" />
          <line x1="6" y1="10" x2="6.5" y2="15" stroke="oklch(0.68 0.05 240)" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
        </pattern>

        <pattern
          id="precip-moderate-observed"
          width="10"
          height="18"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(15)"
        >
          <line x1="2" y1="0" x2="3" y2="10" stroke="oklch(0.65 0.05 240)" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
          <line x1="7" y1="4" x2="8" y2="14" stroke="oklch(0.65 0.05 240)" strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
          <line x1="4.5" y1="12" x2="5.5" y2="18" stroke="oklch(0.65 0.05 240)" strokeWidth="1.3" strokeLinecap="round" opacity="0.5" />
        </pattern>

        <pattern
          id="precip-heavy-observed"
          width="8"
          height="20"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(25)"
        >
          <line x1="1" y1="0" x2="2.5" y2="14" stroke="oklch(0.6 0.05 240)" strokeWidth="1.8" strokeLinecap="round" opacity="0.7" />
          <line x1="5" y1="3" x2="6.5" y2="17" stroke="oklch(0.6 0.05 240)" strokeWidth="1.8" strokeLinecap="round" opacity="0.65" />
          <line x1="3" y1="10" x2="4" y2="20" stroke="oklch(0.6 0.05 240)" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
        </pattern>

        <pattern
          id="precip-extreme-observed"
          width="6"
          height="22"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(35)"
        >
          <line x1="0.5" y1="0" x2="2.5" y2="16" stroke="oklch(0.55 0.05 240)" strokeWidth="2.2" strokeLinecap="round" opacity="0.8" />
          <line x1="3.5" y1="2" x2="5.5" y2="18" stroke="oklch(0.55 0.05 240)" strokeWidth="2.2" strokeLinecap="round" opacity="0.75" />
          <line x1="2" y1="8" x2="3.5" y2="22" stroke="oklch(0.55 0.05 240)" strokeWidth="1.8" strokeLinecap="round" opacity="0.7" />
        </pattern>

        {/* ===== SNOW PATTERNS (White) ===== */}

        {/* Trace snow: Two light flakes with extra spacing */}
        <pattern
          id="snow-trace"
          width="28"
          height="28"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="10" cy="12" r="1.2" fill="oklch(0.95 0.01 240)" opacity="0.6" />
          <circle cx="19" cy="16" r="1" fill="oklch(0.95 0.01 240)" opacity="0.5" />
        </pattern>

        {/* Light snow: Sparse small flakes, gentle drift */}
        <pattern
          id="snow-drizzle"
          width="16"
          height="16"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="4" cy="4" r="1.2" fill="oklch(0.95 0.01 240)" opacity="0.6" />
          <circle cx="12" cy="9" r="1" fill="oklch(0.95 0.01 240)" opacity="0.5" />
          <circle cx="7" cy="14" r="0.9" fill="oklch(0.95 0.01 240)" opacity="0.55" />
        </pattern>

        {/* Light snow: More flakes, slight movement */}
        <pattern
          id="snow-light"
          width="14"
          height="14"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(5)"
        >
          <circle cx="2" cy="3" r="1.3" fill="oklch(0.93 0.02 240)" opacity="0.65" />
          <circle cx="9" cy="6" r="1.1" fill="oklch(0.93 0.02 240)" opacity="0.6" />
          <circle cx="5" cy="11" r="1.4" fill="oklch(0.93 0.02 240)" opacity="0.55" />
          <circle cx="12" cy="12" r="1" fill="oklch(0.93 0.02 240)" opacity="0.5" />
        </pattern>

        {/* Moderate snow: Dense flakes with varied sizes */}
        <pattern
          id="snow-moderate"
          width="12"
          height="12"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(8)"
        >
          <circle cx="2" cy="2" r="1.5" fill="oklch(0.92 0.02 240)" opacity="0.7" />
          <circle cx="8" cy="4" r="1.2" fill="oklch(0.92 0.02 240)" opacity="0.65" />
          <circle cx="4" cy="8" r="1.6" fill="oklch(0.92 0.02 240)" opacity="0.6" />
          <circle cx="10" cy="10" r="1.3" fill="oklch(0.92 0.02 240)" opacity="0.55" />
          <circle cx="6" cy="6" r="0.9" fill="oklch(0.92 0.02 240)" opacity="0.5" />
        </pattern>

        {/* Heavy snow: Very dense, larger flakes */}
        <pattern
          id="snow-heavy"
          width="10"
          height="10"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(12)"
        >
          <circle cx="2" cy="2" r="1.7" fill="oklch(0.9 0.03 240)" opacity="0.75" />
          <circle cx="7" cy="3" r="1.4" fill="oklch(0.9 0.03 240)" opacity="0.7" />
          <circle cx="4" cy="6" r="1.8" fill="oklch(0.9 0.03 240)" opacity="0.65" />
          <circle cx="9" cy="8" r="1.5" fill="oklch(0.9 0.03 240)" opacity="0.6" />
          <circle cx="1" cy="9" r="1.3" fill="oklch(0.9 0.03 240)" opacity="0.55" />
          <circle cx="6" cy="9" r="1" fill="oklch(0.9 0.03 240)" opacity="0.5" />
        </pattern>

        {/* Extreme snow: Blizzard conditions */}
        <pattern
          id="snow-extreme"
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(18)"
        >
          <circle cx="1" cy="1" r="1.8" fill="oklch(0.88 0.04 240)" opacity="0.8" />
          <circle cx="5" cy="2" r="1.5" fill="oklch(0.88 0.04 240)" opacity="0.75" />
          <circle cx="3" cy="5" r="2" fill="oklch(0.88 0.04 240)" opacity="0.7" />
          <circle cx="7" cy="6" r="1.6" fill="oklch(0.88 0.04 240)" opacity="0.65" />
          <circle cx="1" cy="7" r="1.4" fill="oklch(0.88 0.04 240)" opacity="0.6" />
          <circle cx="5" cy="7" r="1.2" fill="oklch(0.88 0.04 240)" opacity="0.55" />
        </pattern>

        {/* ===== SNOW OBSERVED PATTERNS (Dimmer white) ===== */}

        <pattern
          id="snow-trace-observed"
          width="28"
          height="28"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="10" cy="12" r="1.2" fill="oklch(0.75 0 0)" opacity="0.45" />
          <circle cx="19" cy="16" r="1" fill="oklch(0.75 0 0)" opacity="0.4" />
        </pattern>

        <pattern
          id="snow-drizzle-observed"
          width="16"
          height="16"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="4" cy="4" r="1.2" fill="oklch(0.75 0 0)" opacity="0.5" />
          <circle cx="12" cy="9" r="1" fill="oklch(0.75 0 0)" opacity="0.4" />
          <circle cx="7" cy="14" r="0.9" fill="oklch(0.75 0 0)" opacity="0.45" />
        </pattern>

        <pattern
          id="snow-light-observed"
          width="14"
          height="14"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(5)"
        >
          <circle cx="2" cy="3" r="1.3" fill="oklch(0.75 0 0)" opacity="0.55" />
          <circle cx="9" cy="6" r="1.1" fill="oklch(0.75 0 0)" opacity="0.5" />
          <circle cx="5" cy="11" r="1.4" fill="oklch(0.75 0 0)" opacity="0.45" />
          <circle cx="12" cy="12" r="1" fill="oklch(0.75 0 0)" opacity="0.4" />
        </pattern>

        <pattern
          id="snow-moderate-observed"
          width="12"
          height="12"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(8)"
        >
          <circle cx="2" cy="2" r="1.5" fill="oklch(0.75 0 0)" opacity="0.6" />
          <circle cx="8" cy="4" r="1.2" fill="oklch(0.75 0 0)" opacity="0.55" />
          <circle cx="4" cy="8" r="1.6" fill="oklch(0.75 0 0)" opacity="0.5" />
          <circle cx="10" cy="10" r="1.3" fill="oklch(0.75 0 0)" opacity="0.45" />
          <circle cx="6" cy="6" r="0.9" fill="oklch(0.75 0 0)" opacity="0.4" />
        </pattern>

        <pattern
          id="snow-heavy-observed"
          width="10"
          height="10"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(12)"
        >
          <circle cx="2" cy="2" r="1.7" fill="oklch(0.75 0 0)" opacity="0.65" />
          <circle cx="7" cy="3" r="1.4" fill="oklch(0.75 0 0)" opacity="0.6" />
          <circle cx="4" cy="6" r="1.8" fill="oklch(0.75 0 0)" opacity="0.55" />
          <circle cx="9" cy="8" r="1.5" fill="oklch(0.75 0 0)" opacity="0.5" />
          <circle cx="1" cy="9" r="1.3" fill="oklch(0.75 0 0)" opacity="0.45" />
          <circle cx="6" cy="9" r="1" fill="oklch(0.75 0 0)" opacity="0.4" />
        </pattern>

        <pattern
          id="snow-extreme-observed"
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(18)"
        >
          <circle cx="1" cy="1" r="1.8" fill="oklch(0.75 0 0)" opacity="0.7" />
          <circle cx="5" cy="2" r="1.5" fill="oklch(0.75 0 0)" opacity="0.65" />
          <circle cx="3" cy="5" r="2" fill="oklch(0.75 0 0)" opacity="0.6" />
          <circle cx="7" cy="6" r="1.6" fill="oklch(0.75 0 0)" opacity="0.55" />
          <circle cx="1" cy="7" r="1.4" fill="oklch(0.75 0 0)" opacity="0.5" />
          <circle cx="5" cy="7" r="1.2" fill="oklch(0.75 0 0)" opacity="0.45" />
        </pattern>
        <pattern
          id="precip-unavailable"
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="8" stroke="oklch(1 0 0 / 0.1)" strokeWidth="1" />
        </pattern>
      </defs>
    </svg>
  );
}
