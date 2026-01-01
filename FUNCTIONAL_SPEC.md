# Weather Consensus PWA - Functional Specification

## Executive Summary

Weather Consensus is a Progressive Web Application that aggregates weather forecasts from multiple meteorological models and provides users with an agreement score indicating the degree of alignment between models. This design addresses a critical gap in weather forecasting: while individual weather models are sophisticated, they often diverge significantly in their predictions, especially for uncertain weather patterns. By presenting consensus metrics alongside individual model forecasts, users with mission-critical weather considerations—such as event planners, outdoor workers, emergency responders, and aviation professionals—can make informed decisions based on forecast reliability rather than blindly trusting a single model.

---

## 1. Problem Statement & Design Rationale

### 1.1 The Core Problem

Modern weather forecasting relies on multiple competing models:
- **GEM (Global Environmental Multiscale)** - Environment Canada's primary model, optimized for North American conditions
- **GFS (Global Forecast System)** - NOAA's global model, widely used in the US
- **ECMWF (European Centre for Medium-Range Weather Forecasts)** - Often considered the most accurate globally
- **ICON (Icosahedral Nonhydrostatic)** - Germany's high-resolution model

Each model uses different physics, initialization data, and computational methods. For stable weather patterns, models converge and produce similar forecasts. For uncertain patterns (frontal boundaries, convection, rapidly changing systems), models can diverge dramatically.

**Current user experience:** Most weather apps show a single forecast, often without indicating the underlying uncertainty. Users don't know if the forecast is highly confident or speculative.

**Weather Consensus solution:** Aggregate all available models, normalize their outputs, calculate agreement metrics, and present both the consensus forecast and individual model predictions with visual agreement indicators.

### 1.2 Design Philosophy: Scandinavian Functionalism Meets Data Visualization

The application adopts **Arctic Data Observatory** aesthetic—a fusion of:

1. **Scandinavian Functionalism**
   - Minimal visual noise, maximum information density
   - Whitespace as an active design ingredient
   - Function-driven layout, not decorative
   - Clear hierarchy and visual relationships

2. **Data Visualization Art**
   - Aurora-inspired color palette (arctic blues, cyan, teal)
   - Subtle gradients and depth effects (frosted glass cards)
   - Animated gauge for agreement scoring
   - Multi-line charts showing model agreement bands

3. **Canadian Context**
   - Emphasis on GEM (Environment Canada) model
   - Focus on 15 major Canadian cities with quick access
   - Support for Canadian provinces and territories
   - Consideration for Canadian weather patterns (winter precipitation types)

**Rationale:** Users making mission-critical decisions need to trust the interface. Scandinavian design conveys professionalism and reliability. Data visualization techniques help users quickly grasp complex information (model agreement) at a glance.

---

## 2. Core Features & Functional Requirements

### 2.1 Multi-Model Forecast Aggregation

#### 2.1.1 Supported Weather Models

| Model | Provider | Coverage | Primary Use | Color |
|-------|----------|----------|-------------|-------|
| GEM | Environment Canada | North America (optimized for Canada) | Primary Canadian forecasts | Arctic Cyan |
| GFS | NOAA (US) | Global | US-centric, global coverage | Purple |
| ECMWF | European Centre | Global | Often most accurate, longer range | Green |
| ICON | DWD (Germany) | Global | High-resolution, convection-focused | Amber |

**Rationale for model selection:**
- **GEM first:** As a Canadian app, Environment Canada's model is the authoritative source for Canadian weather
- **GFS inclusion:** NOAA's model is widely used and provides US perspective, important for border regions
- **ECMWF addition:** Provides independent European perspective; often outperforms other models in medium-range forecasts
- **ICON inclusion:** Adds high-resolution perspective; particularly valuable for complex terrain and convective systems

#### 2.1.2 Data Fetching Process

**Functional flow:**
1. User selects a location (latitude/longitude)
2. Application initiates parallel forecast requests to all four models via Open-Meteo API
3. Application initiates parallel metadata requests to Open-Meteo model update endpoints for each model
4. Each model returns:
   - Hourly data (next 7 days): temperature, precipitation, wind, humidity, cloud cover, pressure, weather codes
   - Daily data (next 7 days): high/low temps, precipitation sum, wind speed, sunrise/sunset
5. Metadata returns:
   - last_run_initialisation_time (unix seconds)
   - last_run_availability_time (unix seconds)
   - update interval and temporal resolution (informational only)
   Metadata is cached in memory for 10 minutes and applied asynchronously without blocking rendering
6. Forecast requests complete asynchronously; UI renders as soon as forecasts arrive (metadata updates later if available)
7. Partial failures handled gracefully: if one forecast fails, app continues with remaining models and displays error indicator; if metadata fails, run age is shown as unknown for that model

**Rationale:** Parallel fetching ensures responsiveness. Graceful degradation allows app to function even if one model is temporarily unavailable. Open-Meteo API chosen because it's free, requires no authentication, and provides consistent data format across models.

### 2.2 Data Normalization & Consensus Calculation

#### 2.2.1 Normalization Strategy

Different models may have slightly different output formats or timing. Normalization ensures apples-to-apples comparison:

**Temperature normalization:**
- All temperatures converted to Celsius
- Rounded to 0.1°C precision for consistency
- Time-aligned to hourly intervals

**Precipitation normalization:**
- All precipitation converted to millimeters
- Probability values normalized to 0-100% scale
- Accumulation periods standardized to hourly/daily

**Wind normalization:**
- Wind speed converted to km/h
- Wind direction converted to degrees (0-360)
- Wind gusts normalized to same scale as sustained wind

**Weather codes:**
- All models mapped to WMO (World Meteorological Organization) weather code standard
- Ensures consistent interpretation across models

**Rationale:** Normalization enables meaningful statistical comparison. Without it, model differences would reflect format variations rather than true forecast divergence.

#### 2.2.2 Consensus Metrics Calculation

For each time step (hour) and day, the application calculates:

**Temperature Agreement:**
```
stdDev = standard deviation of all model temperatures
agreement_score = 100 × (1 - (stdDev / expected_range))
expected_range = 10°C (typical model spread for temperature)
```

**Precipitation Agreement:**
```
stdDev = standard deviation of precipitation amounts
agreement_score = 100 × (1 - (stdDev / expected_range))
expected_range = 5mm (typical model spread)
```

**Wind Speed Agreement:**
```
stdDev = standard deviation of wind speeds
agreement_score = 100 × (1 - (stdDev / expected_range))
expected_range = 15 km/h
```

**Wind Direction Agreement (circular):**
- Uses circular statistics (not linear) because direction wraps at 360°
- Calculates angular standard deviation
- Scores agreement based on directional clustering

**Weather Condition Agreement:**
```
dominant_code = most common weather code among models
agreement_score = (count_of_dominant_code / total_models) × 100
```

**Overall Hourly Agreement:**
```
overall = (0.30 × temp_agreement) + 
          (0.25 × precip_agreement) + 
          (0.20 × wind_agreement) + 
          (0.15 × condition_agreement) +
          (0.10 × cloud_agreement)
```

**Overall Daily Agreement:**
```
overall = (0.25 × max_temp_agreement) +
          (0.25 × min_temp_agreement) +
          (0.25 × precip_agreement) +
          (0.15 × wind_agreement) +
          (0.10 × condition_agreement)
```

**Overall Forecast Agreement (7-day):**
```
overall = (0.35 × avg_temperature_agreement) +
          (0.30 × avg_precipitation_agreement) +
          (0.20 × avg_wind_agreement) +
          (0.15 × avg_condition_agreement)
```

**Rationale for weighting:**
- **Temperature (35% overall):** Most important for user planning; most models agree on temperature
- **Precipitation (30% overall):** Critical for event planning; models often diverge significantly
- **Wind (20% overall):** Important for safety; moderate divergence typical
- **Conditions (15% overall):** Qualitative; less precise than quantitative measures

#### 2.2.3 Consensus Guardrails

To prevent NaN or misleading outputs, consensus math is hardened:
- Filter to finite numeric values before mean/stddev calculations
- Require at least 2 valid model values for a metric to be considered available
- If critical series (hourly or daily) cannot be computed, consensus is marked unavailable

**Rationale:** Agreement should only be reported when there is enough valid data to compare like-with-like.

### 2.3 Agreement Scoring System

**Scope:** The agreement score reflects model alignment only and is not reduced due to model run age. Freshness is reported separately to avoid conflating data quality with forecast agreement.

#### 2.3.1 Agreement Levels

| Score Range | Label | Description | Visual Indicator | Use Case |
|-------------|-------|-------------|------------------|----------|
| 75-100 | High Agreement | Models strongly agree; forecast is reliable | Green/Cyan glow | Safe to plan outdoor events, rely on forecast |
| 50-74 | Moderate Agreement | Some model disagreement; check back for updates | Amber/Yellow glow | Proceed with caution; monitor updates |
| 0-49 | Low Agreement | Significant disagreement; weather pattern uncertain | Red glow | Don't rely on specific details; prepare for multiple scenarios |

**Rationale:** Three-tier system balances simplicity with nuance. Users can quickly assess reliability without needing to understand statistical details.

#### 2.3.2 Agreement Gauge Visualization

The agreement score is displayed as an animated circular gauge:
- **Arc fill:** Represents agreement percentage (0-100%)
- **Color:** Changes based on agreement level (green → amber → red)
- **Glow effect:** Aurora-inspired shadow creates visual emphasis
- **Animation:** Arc animates from 0 to final score when page loads, creating visual feedback
- **In-card breakdown:** Four compact category rings (icon-only) appear directly under the gauge
- **Consensus tooltip:** Agreement label + overview sentence appear only on hover/focus of the main gauge

**Rationale:** Circular gauge is intuitive (like a speedometer or fuel gauge). Animation draws attention and creates sense of data being "calculated in real-time." Color coding leverages universal associations (green=good, red=caution).

#### 2.3.3 Freshness Indicators (Model Run Currency)

Freshness is derived from model run availability times and displayed separately from the agreement score:
- **Per-model freshness dots** appear beside the hero gauge
- **Color thresholds:** <=6h (green), 6-12h (amber), >12h (red), unknown (neutral)
- **Tooltip:** Uses the shared glass-card tooltip standard; the dot cluster opens a single tooltip with the freshness score (based on oldest run age) and per-model run ages (triangle icon in model color)
- **Pending state:** If a newer run is detected but still within the consistency delay window, label it as stabilizing
- **Model cards** show run availability age and a "Stale" badge if a model is >6h older than the freshest available model

**Rationale:** Model agreement can be strong even when one run is older; keeping freshness separate avoids "lying-by-design."

### 2.4 Location Selection & Search

#### 2.4.1 Location Input Methods

**Method 1: Quick Select from Preset Cities**
- 15 pre-loaded Canadian cities displayed by default
- Includes major cities across all provinces/territories
- Instant selection, no network latency

**Method 2: Search by Name**
- User types city name (minimum 2 characters)
- Real-time search against Open-Meteo geocoding API
- Results include city name, province/state, country
- Filters to show Canadian locations first, then international
- Debounced search (300ms) to reduce API calls

**Method 3: Geolocation (Future)**
- Browser geolocation API integration
- Automatic detection of user's current location
- Requires user permission

**Rationale:** Multiple input methods accommodate different user preferences. Preset cities provide instant gratification. Search enables global coverage. Geolocation (future) will enhance mobile experience.

#### 2.4.2 Location Persistence

Selected location is saved to browser's localStorage with key `weather-consensus-location`. On app reload, previously selected location is restored automatically.

**Rationale:** Users typically check weather for the same location repeatedly. Persistence reduces friction.

### 2.5 Forecast Display Formats

#### 2.5.1 Hero Section (Current Conditions & Overall Score)

**Content displayed:**
- Location name and province
- Current temperature (consensus mean; falls back to ECMWF when consensus unavailable)
- Current weather condition (dominant model prediction; falls back to ECMWF when consensus unavailable)
- Weather icon (emoji representation)
- Agreement gauge (animated circular score)
- Agreement label and description (tooltip on gauge)
- Agreement breakdown rings (Temp, Precip, Wind, Conditions) rendered as icon-only mini gauges inside the gauge card
- Freshness indicators (small dots per model with tooltips)
- Model status indicators (which models succeeded/failed)
- Consensus unavailable badge (shown when fallback is in use)
- Updated time based on latest run availability (location timezone)

**Rationale:** Hero section provides immediate answer to "What's the weather and how aligned are the models?" Prominent agreement gauge ensures users see reliability metric before detailed data.

##### 2.5.1.1 Detail Panels (Model & Category)

**Triggers:**
- **Location caret:** Opens the model breakdown panel (agreement/freshness).
- **Forecast value caret:** Opens the per-model forecast panel.
- **Category rings:** Open the category detail panel for the tapped metric (Temperature, Precipitation, Wind, Conditions).
- **Per-model caret (on category cards):** Opens a per-model drilldown with a dense hour-by-hour “weather bug” view plus chart/table modes.

**Behavior:**
- **Desktop:** Inline expansion directly under the hero section (no page transitions).
- **Mobile:** Bottom sheet drawer; same content, same data.
- Only one detail panel is open at a time; opening a new panel closes the previous one.
- Keyboard accessible; caret controls are focusable and toggle the panel in place.

**Content rules (visual parity with hero forecast):**
- Each model uses the same forecast display system as the hero (icon, value, unit, label).
- Only labeling and subtle tinting differentiate models; layout stays consistent.
- Deterministic model order: ECMWF, GFS, ICON, GEM, then any extras.
- **Conditions panel:** Uses the condition label in the primary value slot.
- **Precipitation panel:** Shows POP as the primary value plus precipitation amount (mm/hr) as a secondary inline value.
- **Wind panel:** Shows speed with cardinal direction (N/NE/E/SE/S/SW/W/NW).

**Layout:**
- 2×2 grid on mobile; 4 columns on larger screens.
- Model label and forecast content stay grouped to preserve scanability.

##### 2.5.1.2 Per-Model Drilldown (Heads-Up / Chart / Table)

**Goal:** Let users drill into the complete set of model-specific data across all categories, without leaving the current context.

**Modes (tabs):**
- **Heads-Up:** A dense, vertical list of hourly “weather bug” cards for a 48-hour window around “now”.
- **Chart:** Compact per-category charts (temperature, precipitation, wind, conditions sampling).
- **Table:** A single hourly table combining all categories (temp, POP/intensity, wind speed/gust/direction, conditions).

**Heads-Up card (HourlyWeatherBugCard) content:**
- Time label (location timezone) with a “Now” highlight for the current hour
- Condition icon + short description
- Temperature (primary)
- Wind summary (speed + direction; gust when available)
- Verbose line: POP, precip intensity (`mm/hr`), cloud cover, humidity, pressure

**Visual consistency:**
- The drilldown is model-scoped; its accent color matches the model color.
- Current hour is emphasized to anchor scanning.

**Interaction & ergonomics:**
- On open, the panel auto-scrolls so the current hour is positioned at the top of the list (just under the header).
- The header is sticky inside the scroll container and includes: model identity, the mode tabs, and the close action.
- The scroll container uses a subtle themed scrollbar to fit the Arctic UI.
- Long hour lists are optimized to reduce render cost (content visibility / incremental paint).

#### 2.5.2 48-Hour Temperature Forecast Chart

**Chart type:** Multi-line chart with consensus band

**Visual elements:**
- X-axis: Time (hourly, 48 hours)
- Y-axis: Temperature (°C)
- Individual model lines: One line per model in model's designated color
- Consensus mean line: Dashed white line showing average
- Consensus band: Shaded area between min/max model predictions
- Interactive tooltip: Shows consensus mean, range, individual model values, agreement %

**Consensus unavailable behavior:** Consensus band/mean and agreement values are hidden; the chart shows only model lines.

**Rationale:** Chart allows users to see:
1. How much models diverge (band width)
2. Which models are outliers
3. Consensus trend over time
4. Specific timing of temperature changes

Band visualization is more intuitive than showing error bars or confidence intervals.

#### 2.5.3 48-Hour Precipitation Comparison Grid

**Grid type:** Multi-row swimlane with particle-based weather visualization

**Visual structure:**
- X-axis: Time (hourly columns, 48 hours)
- Y-axis: Model rows (GEM, GFS, ECMWF, ICON) + Consensus row + Observed row
- Each cell represents one hour for one model/consensus

**Matrix spacing standard (apply to all matrix-style grids):**
- Column width: 28px desktop, 22px mobile
- Header row height: 24px (h-6)
- Data row height: 32px (h-8)
- Cell padding: 1px horizontal, 2px vertical around the glyph/cell
- Inner glyph canvas: 28×28 coordinate space (aligns with padding above)
- Row label styling: model rows show the triangle marker; consensus/observed rows show label only; observed shows "Unavailable" when no data.

**Cell visualization — "Weather Bug" approach:**

Each precipitation cell uses a dual-encoding system inspired by weather radar displays:

1. **Background: SVG Pattern Fill (Intensity)**
   - **Rain patterns:** Diagonal blue streaks at varying densities
   - **Snow patterns:** White asterisks/flakes scattered at varying densities
   - **Intensity levels:** drizzle (sparse), light, moderate, heavy, extreme (dense)
   - **Intensity thresholds:** Based on mm/hr
     - None: < 0.1 mm/hr
     - Drizzle: 0.1-1 mm/hr
     - Light: 1-2.5 mm/hr
     - Moderate: 2.5-7.5 mm/hr
     - Heavy: 7.5-50 mm/hr
     - Extreme: > 50 mm/hr

2. **Overlay: Circular Arc (Probability of Precipitation)**
   - Arc renders as a "loader" style circular progress indicator
   - Arc fills clockwise from 12 o'clock position
   - Arc percentage corresponds directly to POP (0-100%)
   - Semi-transparent stroke allows pattern visibility beneath
   - Only renders when POP ≥ threshold (default 10%)

**Rain vs Snow Detection:**

Precipitation type is determined from WMO weather codes with temperature fallback:

| Weather Code Range | Precipitation Type |
|-------------------|-------------------|
| 71-77 | Snow (snow fall) |
| 85-86 | Snow (snow showers) |
| 56-57 | Snow (freezing drizzle) |
| 66-67 | Snow (freezing rain) |
| 51-55, 61-65, 80-82, etc. | Rain |
| Missing/unclear code | Use temperature: ≤2°C = snow, >2°C = rain |

**Color palette (OKLCH):**

| Rain Intensity | Color |
|---------------|-------|
| Drizzle | oklch(0.70 0.12 220) — light blue |
| Light | oklch(0.60 0.18 225) — medium blue |
| Moderate | oklch(0.58 0.22 230) — vivid blue |
| Heavy | oklch(0.52 0.26 235) — deep blue |
| Extreme | oklch(0.45 0.28 240) — dark blue |

| Snow Intensity | Color |
|---------------|-------|
| All levels | oklch(0.88-0.95 0.01 240) — white with slight variation |

**Special row styling:**

- **Consensus row:** Subtle primary-tinted background highlight, slightly thicker arc stroke
- **Observed row:** Solid fill (no arc) — actual measured precipitation, not probability
- **Disabled models:** Reduced opacity, no pattern fill

**Column hover interaction:**
- Hovering a column highlights entire vertical slice
- Non-hovered columns fade to 60% opacity
- Tooltip appears showing:
  - Full timestamp
  - Consensus POP and intensity
  - Observed intensity (if available)
  - Per-model breakdown

**Legend:**
- Shows sample patterns for rain (light/heavy) and snow
- Explains arc = probability, fill = intensity

**Rationale:** Traditional precipitation charts use abstract color scales that fail at glance distance. The particle-based approach leverages familiar weather iconography:
- Rain streaks and snow flakes are universally understood
- Density communicates intensity intuitively (more drops = heavier rain)
- Arc overlay separates "how likely" from "how much"
- Blue rain stands out from the teal interface palette

#### 2.5.4 7-Day Forecast Table

**Columns:**
- Date (formatted as "Today", "Tomorrow", or "Mon, Dec 23")
- Weather icon
- High/Low temperature
- Precipitation amount
- Wind speed
- Model agreement % (with color indicator)

**Consensus unavailable behavior:** Agreement column and legend are hidden, and the table displays ECMWF values as the primary forecast.

**Row styling:**
- Rows with 75%+ agreement: Green accent
- Rows with 50-74% agreement: Amber accent
- Rows with <50% agreement: Red accent

**Rationale:** Table format allows quick scanning of week-long trends. Color coding provides instant visual feedback on forecast agreement. Precipitation and wind are key decision factors for outdoor activities.

#### 2.5.4 Agreement Breakdown Rings (In-Card)

**Displayed inside the Confidence Gauge card, directly under the overall score.**

**Displays four metrics:**
1. **Temperature Agreement** - How well models agree on temperature
2. **Precipitation Agreement** - How well models agree on rain/snow
3. **Wind Agreement** - How well models agree on wind speed
4. **Conditions Agreement** - How well models agree on weather type

Each ring shows:
- Small icon centered in the ring
- Arc length representing the score (0-100)
- Ring color matches agreement thresholds
- Frosted styling consistent with the gauge card
- Exact values available via tooltip/aria-label

**Layout:**
- 2x2 grid on mobile
- 4 columns on larger screens when space allows

**Rationale:** Icon-only rings keep the card compact while preserving quick visual cues for weak/strong categories.

#### 2.5.5 Hourly Comparison Graphs Panel

**Tab structure:** Icon-based tabs for switching between comparison views:
- **Temperature** (thermometer icon): 48-Hour Temperature Forecast Chart
- **Precipitation** (droplets icon): 48-Hour Precipitation Comparison Grid
- **Wind** (wind icon): 48-Hour Wind Comparison
- **Conditions** (cloud icon): 48-Hour Conditions Comparison (future)

**Wind tab enhancements:**
- Chart mode renders sustained + gust per model plus consensus band, with optional gradient fill between sustained and gust (toggleable).
- Direction Matrix mode (toggle) replaces the chart with a per-hour direction grid:
  - Rows: GEM, GFS, ECMWF, ICON, Consensus; Observed row uses the same availability behavior as precipitation.
  - Columns: same hourly window as chart (48h), aligned to time labels.
  - Glyph: head-only triangle, rotated to flow-to direction `(windFrom + 180) % 360`; calm (<3 km/h) renders a dot.
  - Size bins (fixed): small <15 km/h, medium 15–30 km/h, large >30 km/h.
  - Consensus row uses near-white color and a slightly stronger outline; shows a faint ring when direction agreement is low (resultant length R < 0.6).
- Fill toggle is disabled while in Direction Matrix mode.
 - Observed row behavior matches precipitation matrix: always shown, displays "Unavailable" when no observed direction data, and future observed cells are hidden.

**Shared features across tabs:**
- Consistent column width and time labeling
- Column hover highlighting
- Tooltips with detailed per-model breakdown
- Model color legend
- Consensus row (when available)
- Observed data row (when available)

**Tooltip standard (comparison charts and matrices):**
- Shared glass-card layout with title set to the full time label for the hovered hour (location timezone).
- Section order: Consensus (if available), Observed (if available), then model list.
- Rows show a label + monospaced value; model rows use the triangle icon in model color, observed uses a neutral dot, consensus uses near-white.
- Temperature chart: consensus mean, min/max range, agreement percent; model/observed values in °C (0.1 precision).
- Wind chart: consensus mean, range, agreement percent; model/observed sustained and gust values in km/h.
- Precip matrix: POP and intensity in `mm/hr` for consensus/models (with weather icon when WMO code is present); observed shows intensity only.
- Wind direction matrix: wind-from degrees, flow-to degrees, sustained/gust; consensus includes agreement R.
- Rows with no valid data for that hour are omitted; observed rows do not show data beyond "now".
- This glass-card tooltip format is the global standard; compact tooltips (e.g., Confidence Gauge and category rings) reuse the same shell with a short title and 1-2 lines of content.

**Rationale:** Tabbed interface keeps the panel compact while allowing deep exploration of any weather variable. Icon-only tabs work well on mobile.

#### 2.5.6 Individual Model Cards

**Four cards, one per model:**

Each card displays:
- Model name and provider
- Current weather icon
- Current temperature
- High/Low for the day
- Precipitation probability
- Wind speed
- Model run availability age (humanized)
- "Stale" badge if model run is >6h older than freshest model with metadata
- Success/failure indicator

**Rationale:** Individual model cards allow advanced users to:
- See which models are outliers
- Understand provider biases (e.g., GEM tends wetter, GFS tends drier)
- Make decisions based on specific models they trust

---

## 3. User Workflows

### 3.1 Primary Workflow: Check Weather for Current Location

1. User opens app (or returns to previously selected location)
2. App displays Toronto forecast by default (or saved location)
3. User sees:
   - Current conditions with agreement gauge
   - 48-hour temperature chart
   - 7-day forecast with agreement indicators
   - Agreement breakdown rings (in-card)
   - Individual model cards
4. User can scroll to see all information
5. User can click refresh button to update forecasts

**Expected duration:** 30-60 seconds from open to understanding forecast reliability

### 3.2 Secondary Workflow: Check Weather for Different Location

1. User clicks location button in header
2. Dropdown opens showing:
   - Search input field
   - Popular Canadian cities (if not searching)
   - Search results (if typing)
3. User either:
   - Clicks a preset city, OR
   - Types city name and clicks result
4. App fetches forecasts for new location
5. All displays update to show new location's data
6. Location is saved for next visit

**Expected duration:** 15-30 seconds from click to updated forecast

### 3.3 Advanced Workflow: Analyze Model Disagreement

1. User notices low agreement score (e.g., 35%)
2. User checks the in-card Agreement Breakdown rings under the overall score to see which metrics are problematic
3. User scrolls to 48-hour chart to visualize model spread
4. User scrolls to Individual Model Cards to see which models diverge
5. User can infer:
   - If precipitation agreement is low but temperature high: "Temperature is certain, rain amount is uncertain"
   - If wind agreement is low: "Wind direction/speed may change; prepare for multiple scenarios"
6. User makes decision based on this analysis (e.g., "I'll plan the event but have a backup indoor location")

**Expected duration:** 2-3 minutes for detailed analysis

---

## 4. Data Model & Information Architecture

### 4.1 Core Data Structures

#### Location Object
```
{
  name: string              // e.g., "Toronto"
  latitude: number          // e.g., 43.6532
  longitude: number         // e.g., -79.3832
  country: string           // e.g., "Canada"
  province?: string         // e.g., "Ontario"
  timezone: string          // e.g., "America/Toronto"
}
```

#### HourlyForecast Object
```
{
  time: string              // ISO 8601 local timestamp (no offset; use location timezone)
  temperature: number       // Celsius
  precipitation: number     // mm
  precipitationProbability: number  // 0-100%
  windSpeed: number         // km/h
  windDirection: number     // 0-360 degrees
  windGusts: number         // km/h
  cloudCover: number        // 0-100%
  humidity: number          // 0-100%
  pressure: number          // hPa
  weatherCode: number       // WMO code
}
```

#### DailyForecast Object
```
{
  date: string              // YYYY-MM-DD (local date in location timezone)
  temperatureMax: number    // Celsius
  temperatureMin: number    // Celsius
  precipitationSum: number  // mm
  precipitationProbabilityMax: number  // 0-100%
  windSpeedMax: number      // km/h
  windGustsMax: number      // km/h
  weatherCode: number       // WMO code
  sunrise: string           // HH:MM
  sunset: string            // HH:MM
}
```

#### ModelForecast Object
```
{
  model: WeatherModel       // Model metadata
  hourly: HourlyForecast[]  // 168 hours of data
  daily: DailyForecast[]    // 7 days of data
  fetchedAt: Date           // When data was retrieved
  snapshotTime?: number     // Unix ms snapshot time for cached payload
  lastForecastFetchTime?: number // Unix ms of last fetch attempt
  lastSeenRunAvailabilityTime?: number | null // Last availability time used for gating (per model+location)
  lastForecastSnapshotId?: string // Snapshot identifier for audit/debug
  snapshotHash?: string     // Hash of hourly+daily payload
  etag?: string             // Optional response ETag
  runInitialisationTime?: number  // Unix seconds (model run init)
  runAvailabilityTime?: number    // Unix seconds (model run available)
  metadataFetchedAt?: number      // Unix ms (metadata fetch time)
  pendingAvailabilityTime?: number // Unix seconds when new run is pending stabilization
  updateError?: string       // Error if refresh failed but cache remains
  error?: string            // Error message if fetch failed
}
```

#### ConsensusResult Object
```
{
  metrics: {
    overall: number         // 0-100
    temperature: number     // 0-100
    precipitation: number   // 0-100
    wind: number            // 0-100
    conditions: number      // 0-100
  }
  hourly: HourlyConsensus[]
  daily: DailyConsensus[]
  modelCount: number
  successfulModels: string[]
  failedModels: string[]
  isAvailable: boolean
  freshness: FreshnessInfo
}
```

#### FreshnessInfo Object
```
{
  hasMetadata: boolean
  spreadHours?: number
  freshnessScore?: number
  freshestRunAvailabilityTime?: number
  oldestRunAvailabilityTime?: number
  staleModelCount?: number
  staleModelIds?: string[]
  freshnessPenalty?: number
}
```

#### DataCompleteness Object
```
{
  byModel: Record<string, {
    modelId: string
    hasSnapshot: boolean
    snapshotAgeSeconds: number | null
    hasMetadata: boolean
    runAgeKnown: boolean
    updatedThisRefresh: boolean
    isPending: boolean
    isFailed: boolean
  }>
  countModelsFresh: number
  countModelsStale: number
  countModelsUnknown: number
  countModelsFailed: number
}
```

### 4.2 Information Architecture

```
Weather Consensus App
├── Header
│   ├── Logo & Title
│   ├── Location Selector (dropdown)
│   └── Refresh Button
├── Main Content
│   ├── Hero Section
│   │   ├── Location Info
│   │   ├── Current Conditions
│   │   └── Confidence Gauge (overall + agreement rings)
│   ├── 48-Hour Chart
│   ├── 7-Day Forecast Table
│   ├── Individual Model Cards (4 cards)
│   └── Footer (data attribution)
└── Location Dropdown (modal)
    ├── Search Input
    ├── Popular Cities (or search results)
    └── City List
```

---

## 5. User Interface & Visual Design

### 5.1 Design System

#### Color Palette

| Role | Color | OKLCH | Usage |
|------|-------|-------|-------|
| Background | Deep Arctic | oklch(0.12 0.02 240) | Page background |
| Foreground | Glacier White | oklch(0.95 0.01 240) | Text |
| Card | Frosted | oklch(0.16 0.025 240 / 80%) | Card backgrounds with transparency |
| Primary | Arctic Cyan | oklch(0.75 0.15 195) | Buttons, highlights, GEM model |
| Accent | Aurora Teal | oklch(0.78 0.18 180) | Interactive elements |
| Success | Aurora Green | oklch(0.72 0.19 160) | High agreement (75%+) |
| Warning | Aurora Amber | oklch(0.75 0.18 85) | Moderate agreement (50-74%) |
| Danger | Aurora Red | oklch(0.65 0.22 25) | Low agreement (<50%) |
| Border | Subtle | oklch(0.30 0.03 240 / 50%) | Card borders |

**Rationale:** OKLCH color space chosen for perceptual uniformity. Colors are inspired by Arctic aurora and Canadian landscapes. Transparency on cards creates "frosted glass" effect, suggesting data layers.

#### Typography

| Element | Font | Weight | Size | Usage |
|---------|------|--------|------|-------|
| Headings | Space Grotesk | 600 | 24-48px | Page titles, section headers |
| Body | Inter | 400 | 14-16px | Paragraph text, descriptions |
| Data | JetBrains Mono | 500 | 12-14px | Numbers, temperatures, percentages |

**Rationale:** Space Grotesk (geometric sans-serif) conveys technology and precision. Inter provides excellent readability for body text. Monospace for data ensures numbers align vertically and feel "computational."

#### Spacing System

- **xs:** 4px
- **sm:** 8px
- **md:** 16px
- **lg:** 24px
- **xl:** 32px
- **2xl:** 48px

**Rationale:** 8px base unit (common in design systems) allows flexible, predictable spacing.

#### Border Radius

- **sm:** 8px
- **md:** 12px
- **lg:** 16px

**Rationale:** Moderate border radius (not fully rounded) maintains professional appearance while softening hard edges.

### 5.2 Component Behaviors

#### Confidence Gauge
- **Animation:** Arc animates from 0° to final angle over 1.5 seconds on load
- **Color transition:** Smoothly transitions between green/amber/red based on score
- **Glow effect:** Aurora-inspired drop shadow creates depth
- **Responsive:** Scales from 110px (mobile) to 190px (desktop)
- **Consensus tooltip:** Label and overview sentence appear only via tooltip on hover/focus using the shared glass-card tooltip standard
- **Freshness tooltip:** Dot cluster opens a shared tooltip showing freshness score and per-model run ages
- **Breakdown rings:** 2x2 grid under the overall score on mobile, 4 columns on larger screens when space allows

#### Location Dropdown
- **Trigger:** Click location button in header
- **Animation:** Dropdown slides down with fade-in (200ms)
- **Search:** Debounced 300ms to reduce API calls
- **Results:** Fade in as they arrive
- **Close:** Clicking a city or clicking outside dropdown closes it

#### 48-Hour Chart
- **Tooltip:** Appears on hover, shows detailed data for that time
- **Responsive:** Scales to container width; maintains aspect ratio
- **Legend:** Shows which color represents which model
- **Interaction:** No zoom/pan (keep simple for mobile)

#### Agreement Indicators
- **Color coding:** Rings use the same agreement color mapping
- **Animation:** Ring arcs animate from 0 to final sweep on load (1 second)
- **Placement:** Rings live inside the in-card breakdown area beneath the Confidence Gauge

### 5.3 Responsive Design

#### Breakpoints
- **Mobile:** 0-640px (single column)
- **Tablet:** 640-1024px (two columns where appropriate)
- **Desktop:** 1024px+ (full layout)

#### Mobile Optimizations
- Location dropdown takes full width
- 7-day forecast follows the hero section; agreement breakdown stays inside the Agreement Gauge as a 2x2 ring grid
- Model cards display 2 per row (instead of 4)
- Chart height reduced to fit viewport
- Touch-friendly button sizes (minimum 44px)

**Rationale:** Mobile users are often checking weather on-the-go. Simplified layout prioritizes key information (current conditions, agreement score, 7-day forecast).

---

## 6. Data Sources & API Integration

### 6.1 Open-Meteo API

**Endpoint:** `https://api.open-meteo.com/v1/{model_id}`

**Model metadata endpoint:** `https://api.open-meteo.com/data/{metadata_id}/static/meta.json`
- Used to retrieve model run initialization and availability timestamps

### 6.2 Metadata Gating & Forecast Cache

**Goal:** Reduce forecast calls while keeping data fresh and reliable.

**Metadata gating rules:**
- Fetch metadata per model and compare `last_run_availability_time` to the last ingested run (cached per model).
- Fetch forecasts only when:
  - No cached forecast exists for the current location, OR
  - A newer run is available and the consistency delay has elapsed, OR
  - User forces refresh.
- If metadata is missing/failed: fall back to cached data when available; otherwise fetch.
- If metadata is missing/failed and cached data is older than a conservative TTL (default 6h, configurable), fetch to avoid never-refresh scenarios.

**Consistency delay:**
- Default 10 minutes (configurable).
- New runs inside the delay are marked "stabilizing" and scheduled for a single retry per model.

**Caching:**
- Store per-model metadata (run times + update interval).
- Store per-location forecasts with associated run availability time.
- Persist full forecast snapshots (hourly + daily) with snapshotTime and snapshot id per model+location.
- Track last seen run availability per model+location to gate refreshes.
- Cache metadata in memory for 10 minutes (configurable) to reduce metadata calls.
- Cap cached locations to prevent unbounded growth.

**Refresh behavior:**
- Normal refresh uses metadata gating.
- Force refresh (modifier key or long-press) bypasses gating.
- Manual refresh skips forecast calls if no new runs are detected; UI shows "No new runs since [time]" and updates freshness only.
- Metadata calls are not counted toward request limits (per Open-Meteo docs)
- Example metadata IDs: `cmc_gem_gdps`, `ncep_gfs013`, `ecmwf_ifs`, `dwd_icon`

**Advantages:**
- Free, no authentication required
- Consistent data format across all models
- Reliable uptime
- Supports multiple weather models
- Includes historical data and forecasts

**Rate limiting:** 10,000 requests per day per IP (sufficient for typical usage)

**Data freshness:** Updated every 6-12 hours depending on model

### 6.2 Geocoding API

**Endpoint:** `https://geocoding-api.open-meteo.com/v1/search`

**Used for:** Location search functionality

**Parameters:**
- `name`: Search query (minimum 2 characters)
- `count`: Number of results (limited to 10)
- `language`: Set to "en" for English results
- `format`: "json"

### 6.3 Data Refresh Strategy

**Automatic refresh:**
- Forecasts are fetched when user selects a location
- Subsequent refreshes require manual click of refresh button
- Refresh uses metadata gating; only fetches models that need updates
- Model metadata is fetched in parallel and applied asynchronously (does not block render)
- Cached snapshots render immediately when available; new data streams in per model

**Manual refresh:**
- User clicks refresh button in header
- Shows loading spinner during fetch
- Updates displays with new data for models that refreshed
- If no new runs are detected, forecasts are not re-fetched and UI shows "No new runs since [time]"
- Shows "Updated [time]" indicator

**Error handling:**
- If all models fail: Display error message, suggest retry
- If some models fail: Continue with successful models, show error indicators for failed ones
- Timeout: 30 seconds per model before timeout

**Rationale:** Automatic fetch on location change ensures fresh data. Manual refresh gives users control. Parallel fetching minimizes wait time.

---

## 7. Accessibility & Usability

### 7.1 Accessibility Features

**Color contrast:**
- All text meets WCAG AA standard (4.5:1 for normal text, 3:1 for large text)
- Color is not the only indicator of status (also uses icons, text labels)
- Body text uses Glacier White foreground; model colors are reserved for accents and charts

**Keyboard navigation:**
- All interactive elements accessible via Tab key
- Location dropdown navigable with arrow keys
- Enter key selects items

**Screen reader support:**
- Semantic HTML structure
- ARIA labels on interactive elements
- Gauge score announced as percentage
- Agreement levels announced with descriptive text

**Focus indicators:**
- Visible focus ring on all interactive elements
- Focus ring color matches primary accent color

### 7.2 Usability Principles

**Progressive disclosure:**
- Hero section shows most important info (current conditions, overall agreement, category rings)
- Detailed charts below (scroll to see)
- Individual model cards at bottom (for advanced users)

**Cognitive load reduction:**
- Confidence gauge provides single "at a glance" answer
- Color coding provides instant visual feedback
- Tooltips explain technical terms (e.g., "Agreement on temperature forecasts")

**Error prevention:**
- Location search filters to Canadian cities first
- Preset cities prevent typos
- Confirmation of location change before fetching

---

## 8. PWA Features

### 8.1 Offline Functionality

**Service Worker caching strategy:**
- **Static assets** (HTML, CSS, JS): Cache-first (serve from cache, update in background)
- **API responses**: Network-first with fallback to cache (try network, use cached data if offline)
- **Images**: Cache-first with 30-day expiry

**Offline behavior:**
- App loads and displays previously cached forecast
- Location search unavailable (requires network)
- Refresh button disabled (no network to fetch)
- "Offline mode" indicator shown in header
- No metadata or forecast fetch attempts while offline; cached snapshots are used

**Rationale:** Users checking weather before outdoor activities may be in areas with poor connectivity. Offline mode allows viewing previously cached forecasts.

### 8.2 Installability

**Web app manifest:**
- App name: "Weather Consensus"
- Short name: "Weather"
- Icon: 192x192 and 512x512 PNG
- Theme color: Arctic blue
- Display mode: Standalone (full-screen app appearance)
- Start URL: "/"

**Installation methods:**
- **iOS:** Add to Home Screen via Safari share menu
- **Android:** "Install app" prompt appears in Chrome
- **Desktop:** "Install" option in browser menu

**Rationale:** Installability increases engagement. Users can access app from home screen without opening browser.

### 8.3 App Shell Architecture

**App shell:**
- Header (location selector, refresh button)
- Main content area
- Footer (data attribution)

**Benefits:**
- Minimal initial load (shell loads instantly from cache)
- Content loads asynchronously
- Smooth transitions between locations

---

## 9. Error Handling & Edge Cases

### 9.1 Network Errors

**Scenario:** API request fails

**Handling:**
- Retry with exponential backoff (1s, 2s, 4s)
- After 3 retries, display error message
- Show which models failed
- Suggest manual refresh

**User message:** "Failed to fetch forecast from [Model Name]. Check your connection and try again."

### 9.2 Partial Model Failure

**Scenario:** One model succeeds, others fail

**Handling:**
- Calculate consensus with available models (requires at least 2 valid models)
- Adjust weighting if fewer than 4 models available
- Show error indicators for failed models
- Display warning: "Forecast based on [N] of 4 models"

**Rationale:** Forecast is still valuable with 3 models. Users should know it's partial data.

### 9.3 Invalid Location

**Scenario:** User searches for location that doesn't exist

**Handling:**
- Geocoding API returns empty results
- Show "No locations found" message
- Suggest checking spelling
- Show popular cities again

### 9.4 Extreme Values

**Scenario:** Model returns unrealistic value (e.g., -100°C)

**Handling:**
- Validate data before display
- Flag suspicious values
- Exclude from consensus calculation if outside reasonable range
- Log issue for debugging

**Rationale:** Data validation prevents displaying nonsensical forecasts that would erode user trust.

### 9.5 Timezone Handling

**Scenario:** User location is in different timezone than browser

**Handling:**
- Open-Meteo timestamps are treated as local time for the selected location (no implicit timezone offsets)
- Timestamps are parsed as local date/time strings (not via `new Date()` on raw strings) to avoid timezone shifts
- "Current hour" selection uses the location's timezone clock
- Sunrise/sunset and chart labels show local time
- Timezone displayed in location info

**Rationale:** Users expect times in their local timezone, not UTC or browser timezone.

### 9.6 Consensus Unavailable Fallback

**Scenario:** Consensus calculations yield invalid results (NaN, Infinity, missing series, or too few valid values)

**Handling:**
- Mark consensus as unavailable and do not render consensus bands or agreement overlays
- Fall back to ECMWF as the primary forecast in the hero and daily views
- Display badge: "Consensus unavailable (showing ECMWF)"
- Still render individual model cards if they loaded

**Rationale:** Avoids presenting misleading consensus data while keeping the app useful.

---

## 10. Performance Considerations

### 10.1 Load Time Targets

- **First contentful paint:** <2 seconds
- **Interactive (all models loaded):** <5 seconds
- **Location change:** <3 seconds

### 10.2 Optimization Strategies

**Code splitting:**
- Chart library loaded only when needed
- Location search API called only on user input

**Caching:**
- Service worker caches static assets
- Forecast data cached in localStorage for 1 hour
- Location search results cached for 24 hours

**Lazy loading:**
- Individual model cards load after main content
- Chart loads after 7-day forecast

**Rationale:** Users expect weather apps to load quickly. Caching reduces API calls and improves offline experience.

---

## 11. Future Enhancements

### 11.1 Planned Features (Priority Order)

1. **Weather Alerts Integration**
   - Connect to Environment Canada weather warnings
   - Display active alerts for selected location
   - Push notifications for severe weather

2. **Precipitation Type Details**
   - Show whether precipitation is rain, snow, or freezing rain
   - Important for Canadian winter planning

3. **Geolocation Support**
   - Auto-detect user's current location
   - Reduce friction for mobile users

4. **Historical Comparison**
   - Show how accurate each model was for past forecasts
   - Build trust by demonstrating model performance

5. **Custom Alerts**
   - User sets thresholds (e.g., "Alert if temperature drops below -20°C")
   - Push notifications when thresholds met

6. **Detailed Model Information**
   - Explain what each model specializes in
   - Show model update frequency and data sources

7. **Export/Share**
   - Share forecast as image or link
   - Export to calendar (for event planning)

8. **Multi-location Comparison**
   - Compare forecasts across multiple cities
   - Useful for trip planning

### 11.2 Potential Integrations

- **Calendar apps:** Export forecast to Google Calendar, Outlook
- **Notification services:** SMS alerts for severe weather
- **Social media:** Share forecast images
- **Weather-dependent services:** Integration with event booking platforms

---

## 12. Success Metrics

### 12.1 User Engagement

- **Daily active users:** Target 1,000+ within first month
- **Session duration:** Average 3-5 minutes
- **Location changes per session:** Average 1-2

### 12.2 Feature Usage

- **Confidence gauge clicks:** % of users who interact with gauge
- **Chart interactions:** % of users who hover over chart
- **Model card views:** % of users who scroll to model cards

### 12.3 Technical Metrics

- **API success rate:** >99% (models available)
- **Load time:** <2 seconds for first contentful paint
- **Crash rate:** <0.1%

### 12.4 User Satisfaction

- **App rating:** Target 4.5+ stars (if published to app stores)
- **User feedback:** Monitor for feature requests and pain points

---

## 13. Glossary

| Term | Definition |
|------|-----------|
| **Consensus** | Agreement between multiple weather models on a forecast value |
| **Model** | A mathematical representation of atmospheric physics used to generate forecasts |
| **WMO Code** | World Meteorological Organization weather code (0-99) describing weather condition |
| **Standard Deviation** | Statistical measure of how spread out values are from the mean |
| **Confidence Score** | Percentage (0-100) indicating how well weather models agree |
| **Freshness** | Indicator of how current each model run is based on run availability time |
| **Run Availability Time** | Timestamp when a model run became available on Open-Meteo |
| **Frosted Glass** | UI design effect using transparency and blur to create depth |
| **Service Worker** | Browser technology enabling offline functionality and caching |
| **Geocoding** | Converting location names to latitude/longitude coordinates |
| **OKLCH** | Perceptually uniform color space (alternative to RGB/HSL) |

---

## 14. Appendix: Design Decisions Rationale

### Why Multiple Models?

Single-model forecasts are inherently uncertain. By aggregating multiple models, we:
1. Reduce bias from any single model
2. Identify when weather is genuinely uncertain (low agreement)
3. Provide users with more reliable forecasts

### Why These Four Models?

- **GEM:** Canadian authority; optimized for North American weather
- **GFS:** US standard; provides independent perspective
- **ECMWF:** Often most accurate; adds European perspective
- **ICON:** High-resolution; valuable for complex terrain and convection

Together, they represent the best publicly available global forecast models.

### Why Confidence Score Instead of Probability?

**Probability** (e.g., "40% chance of rain") describes likelihood of an event at a specific location.

**Confidence** (e.g., "65% model agreement") describes how certain the forecast is.

These are different concepts. Confidence score helps users understand forecast reliability, which is often more important than any single probability.

### Why Scandinavian Design?

Scandinavian design emphasizes:
- Minimalism and clarity
- Function over decoration
- Trust through simplicity

For a weather app where users make important decisions, these principles build confidence in the interface.

### Why Frosted Glass Cards?

Frosted glass (transparency + blur) suggests:
- Data layers (multiple models)
- Depth and sophistication
- Modern, premium aesthetic

It's more visually interesting than flat cards while maintaining readability.

### Why Aurora Colors?

Aurora (Northern Lights) are:
- Visually striking and memorable
- Associated with Canada and Arctic regions
- Scientifically interesting (appeals to data-conscious users)
- Distinct from typical weather app colors (which tend to be sky-blue)

---

## 15. Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-21 | Initial functional specification |
| 1.1 | 2025-12-22 | Added model metadata, freshness indicators, consensus fallback, and timezone handling updates |
| 1.2 | 2025-12-22 | Added 48-Hour Precipitation Comparison Grid documentation (particle-based rain/snow visualization, POP arc overlay, weather code detection) |
