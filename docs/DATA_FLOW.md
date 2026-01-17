# UI Data Flow Audit (What Feeds What)

This is a wiring audit of how forecast + consensus data moves through the UI. It’s meant to answer: **“Which values are used where?”** and highlight places where the chosen data may not match the user’s mental model.

For the agreement math itself, see `docs/AGREEMENT.md`.

## Primary data sources

### Model forecasts (raw model outputs)

- Produced by: `client/src/lib/weatherApi.ts`
- Shape: `ModelForecast`
  - Hourly: `HourlyForecast[]` (per-model, per-hour values)
  - Daily: `DailyForecast[]` (per-model, per-day values)
  - Metadata: run times, freshness, etc.

### Consensus outputs (computed in-app)

- Produced by: `client/src/lib/consensus.ts`
- Shape: `ConsensusResult`
  - `hourly: HourlyConsensus[]` (per-hour aggregated values + per-metric agreements + `overallAgreement`)
  - `daily: DailyConsensus[]` (per-day aggregated values + per-metric agreements + `overallAgreement`)
  - `metrics: ConsensusMetrics` (forecast-level aggregated agreement metrics, derived from daily series)
  - `freshness: FreshnessInfo`

### Observations (if available)

- Produced by: `client/src/lib/weatherApi.ts` (`fetchObservedHourly`)
- Shape: `ObservedConditions`

## Time alignment rules (important)

- “Current hour” selection is done by `findCurrentHourIndex(...)` (`client/src/lib/timeUtils.ts`) which matches *the hour* in the configured timezone.
- Most hourly UI keys data by the Open‑Meteo hourly `time` string (treated as the start of the hour interval).
- The precipitation matrix uses a shifted “hour-end” timeline for display:
  - Columns are labeled at `time + 1h` (`precipTimeSlots` in `client/src/components/GraphsPanel.tsx`)
  - Values are read from `time - 1h` (`shiftOpenMeteoDateTimeKey(slot.time, -1)` in `PrecipitationComparisonGraph`)
  - This is intended to show precipitation “during the previous hour” under the hour-end label.

## Top-level wiring

### `useWeather` → `Home`

- Hook: `client/src/hooks/useWeather.ts`
  - Fetches `forecasts: ModelForecast[]`
  - Computes `consensus: ConsensusResult` via `calculateConsensus(forecasts)`
- Page: `client/src/pages/Home.tsx`
  - Derives `consensusAvailable = Boolean(consensus?.isAvailable)`
  - Selects “current” hourly consensus via `findCurrentHourIndex(consensus.hourly[].time, timezone)`
  - Selects fallback “current” model hour when consensus is unavailable.

## Hero section (Home)

### Displayed weather (value + icon)

- Temperature:
  - When consensus is available: `currentConsensus.temperature.mean`
  - Fallback: `currentForecastHour.temperature`
- Conditions icon/label:
  - When consensus is available: `currentConsensus.weatherCode.dominant` → `WEATHER_CODES[...]`
  - Fallback: `currentForecastHour.weatherCode` → `WEATHER_CODES[...]`

### Hero agreement card (`DualRingGauge`)

- Component: `client/src/components/DualRingGauge.tsx`
  - Inputs are assembled in `client/src/pages/Home.tsx`:
    - Overall score: `currentConsensus.overallAgreement` (current hour)
    - Category scores (current hour):
      - Temperature: `currentConsensus.temperature.agreement`
      - Precipitation: `currentConsensus.precipitationCombined.agreement` (combined POP + amount)
      - Wind: `currentConsensus.windSpeed.agreement`
      - Conditions: `currentConsensus.weatherCode.agreement`

Note: This intentionally keeps the hero agreement values time-aligned with the hero “current conditions” display.

## Drawer/detail panels (Home)

### `ModelForecastDetailPanel` (Overall tab)

- Component: `client/src/components/ModelForecastDetailPanel.tsx`
- Uses raw per-model “current hour” values:
  - `HourlyForecast.temperature`
  - `HourlyForecast.precipitationProbability` (POP)
  - `HourlyForecast.windSpeed` (+ direction arrow)
  - `HourlyForecast.weatherCode`

### `CategoryDetailPanel` (Temp / Precip / Wind / Conditions tabs)

- Component: `client/src/components/CategoryDetailPanel.tsx`
- Uses raw per-model “current hour” values:
  - Temperature: `HourlyForecast.temperature`
  - Precipitation: `HourlyForecast.precipitationProbability` (primary) + `HourlyForecast.precipitation` (mm/hr accessory)
  - Wind: `HourlyForecast.windSpeed` + `HourlyForecast.windDirection`
  - Conditions: `HourlyForecast.weatherCode`

## Graphs panel (Home)

### Temperature tab

- Chart: `client/src/components/HourlyChart.tsx`
- Uses:
  - Consensus band: `HourlyConsensus.temperature.{mean,min,max}`
  - Tooltip agreements:
    - Temp agreement: `HourlyConsensus.temperature.agreement`
    - Overall agreement: `HourlyConsensus.overallAgreement`

### Precipitation tab

- Matrix: `PrecipitationComparisonGraph` inside `client/src/components/GraphsPanel.tsx`
- Uses:
  - Model rows: per-model `HourlyForecast.precipitationProbability` + `HourlyForecast.precipitation`
  - “Consensus” row (for POP + intensity **display**): `HourlyConsensus.precipitationProbability.mean` + `HourlyConsensus.precipitation.mean`
  - Precipitation cell tint uses: `HourlyConsensus.precipitationCombined.agreement` (combined POP + amount)
  - Weather type for pattern selection uses: `HourlyConsensus.weatherCode.dominant` + `HourlyConsensus.temperature.mean`

### Wind tab

- `WindChart` (`client/src/components/WindChart.tsx`)
  - Uses `HourlyConsensus.windSpeed.{mean,min,max}` and `HourlyConsensus.windSpeed.agreement`
- `WindDirectionMatrix` (`client/src/components/WindDirectionMatrix.tsx`)
  - Uses `HourlyConsensus.windDirection.mean` for consensus arrow direction
  - Uses `HourlyConsensus.windDirection.agreement` (0–100) for the ring + tooltip when available
  - Also shows **circular clustering R** (`resultantLengthR`, 0–1) as a supplemental “how clustered are directions” signal

### Conditions tab

- `ConditionsComparisonGraph` inside `client/src/components/GraphsPanel.tsx`
  - Uses `HourlyConsensus.weatherCode.dominant` for consensus icon
  - Uses `HourlyConsensus.weatherCode.agreement` to draw the disagreement ring when low

## Daily forecast panel (Home)

- Component: `client/src/components/DailyForecast.tsx`

### Daily rows

- Uses `DailyConsensus`:
  - Weather icon: `DailyConsensus.weatherCode.dominant`
  - Daily precip value shown: `DailyConsensus.precipitation.mean` (mm/day)
  - Agreement shown: `DailyConsensus.overallAgreement`

### Hourly rows (inside daily forecast)

- Uses `HourlyConsensus`:
  - Hourly precip value shown: `HourlyConsensus.precipitationProbability.mean` (% POP)
  - Agreement shown: `HourlyConsensus.overallAgreement`
  - Hourly overall agreement includes precipitation as a combined POP + amount component (`HourlyConsensus.precipitationCombined.agreement`)

## Individual model cards (Home)

- Component: `client/src/components/ModelCard.tsx`
- Uses raw per-model “current hour” values:
  - Temperature: `HourlyForecast.temperature` (rounded for display)
  - Precip: `HourlyForecast.precipitationProbability` (%)
  - Wind: `HourlyForecast.windSpeed` (+ direction arrow)
  - Weather icon: `HourlyForecast.weatherCode`

## Known decision points / potential mismatches

These aren’t necessarily “bugs”, but they are places where the site can feel “off” unless the data scope is explicit.

1. **Hourly vs 7-day agreement scope**
   - `ConsensusResult.metrics.*` is forecast-level (derived from daily series).
   - `HourlyConsensus.*` is time-step-level.
   - Any UI that shows “current conditions” next to “agreement” should prefer hourly scope unless it clearly labels “7‑day”.

2. **What “Precipitation agreement” means**
   - Many UI surfaces show POP (%) as the primary precipitation value.
   - Agreement math uses a combined precipitation agreement: POP (%) + amount (mm/hr hourly, mm/day daily), currently weighted 50/50.

3. **Rounding hides disagreements**
   - Many displays round numeric values to integers (see `client/src/components/ForecastDisplay.tsx`), but agreement uses the underlying floats.
   - This can make values look identical while agreement is < 100.

4. **Wind direction agreement uses R, not the 0–100 mapping**
   - `WindDirectionMatrix` shows direction agreement (0–100) when available, and also shows resultant-length `R` as a clustering diagnostic.
   - The consensus engine also computes a 0–100 wind-direction agreement, but it’s not currently surfaced.
