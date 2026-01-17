# Agreement / Consensus Methodology (Implementation Reference)

This document describes the **exact** agreement logic currently implemented in the app, including the constants and where each score is used.

## Source of truth (code)

- `client/src/lib/consensus.ts` computes hourly + daily consensus series and the forecast-level `metrics`.
- `client/src/lib/consensusMath.ts` implements the shared numeric helpers (`computeStats`, `calculateAgreement`, clamping).
- `client/src/lib/consensusConfig.ts` centralizes the agreement constants (weights, expected spreads, thresholds).
- `client/src/lib/weatherApi.ts` defines the model forecast fields and performs WMO weather-code normalization.

## Inputs (model values & units)

The app requests these Open‑Meteo fields (units are Open‑Meteo defaults; we do not request alternate units):

- Hourly:
  - `temperature_2m` → `HourlyForecast.temperature` (°C)
  - `precipitation` → `HourlyForecast.precipitation` (mm/hr)
  - `precipitation_probability` → `HourlyForecast.precipitationProbability` (%)
  - `wind_speed_10m` → `HourlyForecast.windSpeed` (km/h)
  - `wind_direction_10m` → `HourlyForecast.windDirection` (degrees, 0–360; circular)
  - `cloud_cover` → `HourlyForecast.cloudCover` (%)
  - `weather_code` → `HourlyForecast.weatherCode` (WMO code, normalized via `normalizeWeatherCode`)
- Daily:
  - `temperature_2m_max` → `DailyForecast.temperatureMax` (°C)
  - `temperature_2m_min` → `DailyForecast.temperatureMin` (°C)
  - `precipitation_sum` → `DailyForecast.precipitationSum` (mm/day)
  - `precipitation_probability_max` → `DailyForecast.precipitationProbabilityMax` (%)
  - `wind_speed_10m_max` → `DailyForecast.windSpeedMax` (km/h)
  - `weather_code` → `DailyForecast.weatherCode` (WMO code, normalized via `normalizeWeatherCode`)

## Guardrails (what counts as “available”)

For any metric (temperature, precipitation, wind, etc):

- Non-finite values (`NaN`, `±Infinity`) are ignored.
- A metric is **available** only if **≥ 2 models** have finite values for it at that time step/day.
- When building an overall score, **unavailable metrics are excluded** and weights are **renormalized** across the remaining metrics.

At the top level, consensus is marked `isAvailable: false` unless:

- at least 2 model forecasts succeeded, **and**
- there is at least one computed hourly consensus point and one daily consensus point, **and**
- at least one forecast-level metric contributes non-zero weight.

## Agreement scoring for numeric metrics (0–100)

For a numeric metric at a single hour/day:

1. Collect the values across models.
2. Compute **population** statistics (`computeStats`):
   - `mean`
   - `min` / `max`
   - `stdDev` (population standard deviation)
3. Convert `stdDev` to a 0–100 agreement score (`calculateAgreement`):

```
spreadEstimate = 2 × stdDev
agreement = clamp(100 × (1 - spreadEstimate / expectedSpread), 0, 100)
```

Notes:

- The `2 × stdDev` spread estimate is **exact for 2 models** (it equals `|a-b|`), and a convenient spread proxy for N>2.
- `expectedSpread` values are in `client/src/lib/consensusConfig.ts`.
- Returned scores are clamped to the inclusive range 0–100.

## Agreement scoring for weather codes (0–100)

Weather codes are compared as **normalized WMO codes** (`normalizeWeatherCode` collapses codes that render the same icon).

For a single hour/day:

- `dominant` = the most common normalized code among available models
- `agreement` = `(dominantCount / modelCountWithCodes) × 100`
- Availability requires `modelCountWithCodes ≥ 2`

Tie-breaking: if multiple codes share the top count, the implementation deterministically selects the first code by JS object entry ordering, but the agreement percentage still reflects the top count share.

## Hourly consensus (per time step)

Computed in `calculateHourlyConsensus` (`client/src/lib/consensus.ts`).

### Component agreements (and expected spreads)

All expected spreads are from `HOURLY_EXPECTED_SPREAD` (`client/src/lib/consensusConfig.ts`):

- Temperature: `HourlyForecast.temperature` (°C), expected spread **10°C**
- Precipitation intensity: `HourlyForecast.precipitation` (mm/hr), expected spread **5 mm/hr**
- Precipitation probability: `HourlyForecast.precipitationProbability` (%), expected spread **30%**
- Wind speed: `HourlyForecast.windSpeed` (km/h), expected spread **15 km/h**
- Cloud cover: `HourlyForecast.cloudCover` (%), expected spread **30%**
- Weather code: `HourlyForecast.weatherCode` (normalized WMO), dominant-share agreement

Also computed:

- Wind direction agreement (circular): computed from circular std dev (degrees), expected spread **45°**

Combined precipitation agreement (used in hourly overall score):

- `precipitationCombined.agreement` = weighted average of:
  - intensity agreement (mm/hr)
  - probability agreement (%)
- Weights are from `PRECIPITATION_COMPONENT_WEIGHTS` (currently **50/50**).

### Hourly overall agreement weights

From `HOURLY_OVERALL_WEIGHTS`:

- Temperature **0.30**
- Precipitation (POP + amount) **0.25**
- Wind speed **0.20**
- Weather code **0.15**
- Cloud cover **0.10**

Overall hourly agreement is the weighted average of the available components, renormalized by available weights.

## Daily consensus (per day)

Computed in `calculateDailyConsensus` (`client/src/lib/consensus.ts`).

### Component agreements (and expected spreads)

All expected spreads are from `DAILY_EXPECTED_SPREAD`:

- Daily max temperature: `DailyForecast.temperatureMax` (°C), expected spread **8°C**
- Daily min temperature: `DailyForecast.temperatureMin` (°C), expected spread **8°C**
- Daily precipitation sum: `DailyForecast.precipitationSum` (mm/day), expected spread **15 mm**
- Daily max precipitation probability: `DailyForecast.precipitationProbabilityMax` (%), expected spread **30%**
- Daily max wind speed: `DailyForecast.windSpeedMax` (km/h), expected spread **20 km/h**
- Daily weather code: `DailyForecast.weatherCode` (normalized WMO), dominant-share agreement

Combined daily precipitation agreement (used in daily overall score):

- `precipitationCombined.agreement` = weighted average of:
  - precipitation sum agreement (mm/day)
  - max POP agreement (%)
- Weights are from `PRECIPITATION_COMPONENT_WEIGHTS` (currently **50/50**).

### Daily overall agreement weights

From `DAILY_OVERALL_WEIGHTS`:

- Max temp **0.25**
- Min temp **0.25**
- Precipitation (POP + amount) **0.25**
- Max wind speed **0.15**
- Weather code **0.10**

## Forecast-level agreement (`ConsensusResult.metrics`)

Computed in `calculateConsensus` (`client/src/lib/consensus.ts`) from the **daily** consensus series:

- `metrics.temperature` = average across days of `(temperatureMax.agreement + temperatureMin.agreement) / 2` (days where both are available)
- `metrics.precipitation` = average across days of `precipitationCombined.agreement`
- `metrics.wind` = average across days of `windSpeed.agreement`
- `metrics.conditions` = average across days of `weatherCode.agreement`

Overall forecast-level agreement:

- Weighted average of the four metrics using `FORECAST_OVERALL_WEIGHTS`:
  - Temperature **0.35**
  - Precipitation **0.30**
  - Wind **0.20**
  - Conditions **0.15**
- Unavailable metrics are excluded and weights are renormalized.

## Confidence labels (High / Moderate / Low)

`getConfidenceLevel` maps agreement scores to labels (from `AGREEMENT_LEVEL_THRESHOLDS`):

- High: **≥ 75**
- Moderate: **≥ 50**
- Low: **< 50**

## Where scores are used in the UI

This is a high-level map of which agreement values feed which UI elements:

- Overall “hero” gauge (`DualRingGauge`): current-hour `HourlyConsensus.overallAgreement` + per-category agreements (`HourlyConsensus.temperature.agreement`, `HourlyConsensus.precipitationCombined.agreement`, `HourlyConsensus.windSpeed.agreement`, `HourlyConsensus.weatherCode.agreement`)
- Hourly temperature chart tooltip (`HourlyChart`): `HourlyConsensus.temperature.agreement` (temp) and `HourlyConsensus.overallAgreement` (overall)
- Hourly wind chart tooltip (`WindChart`): `HourlyConsensus.windSpeed.agreement` (wind-speed agreement, not the full hourly overall)
- Daily cards (`DailyForecast`): `DailyConsensus.overallAgreement` and `DailyConsensus.weatherCode.agreement`
- Precipitation matrix tinting (`GraphsPanel`): `HourlyConsensus.precipitationCombined.agreement`
- Wind direction matrix ring (`WindDirectionMatrix`): prefers `HourlyConsensus.windDirection.agreement` (0–100, shown when < 50); falls back to circular clustering `R` (0–1, shown when `R < 0.6`) when direction agreement is unavailable
