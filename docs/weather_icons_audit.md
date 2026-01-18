# Weather Icon Audit & Replacement Proposal

This document audits the current icon usage (Lucide + Emojis) and proposes a mapped subset of **Basmilius Weather Icons (Line)** for replacement.

## 1. Category Icons (UI Elements)

Current icons are from `lucide-react`.

| Category | Current Icon (Lucide) | Proposed Basmilius Icon | Rationale |
| :--- | :--- | :--- | :--- |
| **Temperature** | `Thermometer` | `thermometer` | Direct equivalent. |
| **Precipitation** | `Droplets` | `raindrops` | `raindrops` is more stylistic for "precip" than single `raindrop`. |
| **Wind** | `Wind` | `wind` | Direct equivalent. |
| **Conditions** | `Cloud` | `partly-cloudy-day` | Generic "weather" representation. |
| **UV Index** | (None/Text) | `uv-index` | Available in set if needed later. |
| **Pressure** | (None/Text) | `barometer` | Available in set. |
| **Sunrise** | (None/Text) | `sunrise` | Available in set. |
| **Sunset** | (None/Text) | `sunset` | Available in set. |

## 2. Weather Condition Codes (WMO)

Current icons are emojis mapped in `weatherNormalization.ts`.
Proposed mapping accounts for Day/Night variants where applicable (logic will need to handle `isDay` check).

| WMO Code | Description | Proposed Basmilius Icon (Day) | Proposed Basmilius Icon (Night) |
| :--- | :--- | :--- | :--- |
| **0** | Clear sky | `clear-day` | `clear-night` |
| **1** | Mainly clear | `partly-cloudy-day` | `partly-cloudy-night` |
| **2** | Partly cloudy | `partly-cloudy-day` | `partly-cloudy-night` |
| **3** | Overcast | `overcast` | `overcast` |
| **45, 48** | Fog | `fog` | `fog` |
| **51, 53, 55** | Drizzle | `drizzle` | `drizzle` |
| **56, 57** | Freezing Drizzle | `sleet` | `sleet` |
| **61, 63, 65** | Rain | `rain` | `rain` |
| **66, 67** | Freezing Rain | `sleet` | `sleet` |
| **71, 73** | Snow (Light/Mod) | `snow` | `snow` |
| **75** | Heavy Snow | `snow` | `snow` |
| **77** | Snow grains | `hail` | `hail` |
| **80, 81** | Rain showers | `partly-cloudy-day-rain` | `partly-cloudy-night-rain` |
| **82** | Violent showers | `partly-cloudy-day-rain` | `partly-cloudy-night-rain` |
| **85, 86** | Snow showers | `partly-cloudy-day-snow` | `partly-cloudy-night-snow` |
| **95** | Thunderstorm | `thunderstorms` | `thunderstorms` |
| **96, 99** | T-storm + heavy hail | `thunderstorms-rain` | `thunderstorms-rain` |

## 3. Recommended Subset List

To minimize asset size, include only these icons:

**General:**
- `thermometer`
- `raindrops`
- `wind`
- `barometer`
- `sunrise`
- `sunset`
- `code-day` (or generic `clear-day`)

**Conditions:**
- `clear-day`, `clear-night`
- `partly-cloudy-day`, `partly-cloudy-night`
- `cloudy` (if distinction from overcast needed), `overcast`
- `fog`
- `drizzle`
- `rain`
- `partly-cloudy-day-rain`, `partly-cloudy-night-rain`
- `sleet`
- `snow`
- `partly-cloudy-day-snow`, `partly-cloudy-night-snow`
- `hail`
- `thunderstorms`
- `thunderstorms-rain`
