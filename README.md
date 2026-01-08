# Weather Consensus

Progressive Web App that compares multiple weather models and surfaces agreement confidence.

## Agreement methodology

See:
- `docs/AGREEMENT.md` (math + constants)
- `docs/DATA_FLOW.md` (UI bindings audit)

## Metadata Gating and Refresh

Forecast calls are gated by Open-Meteo metadata to reduce unnecessary requests.

- Metadata is fetched per model and compared against the last ingested run.
- Forecasts are fetched only when a newer run is available (after the consistency delay), no cached data exists for the current location, or a force refresh is used.
- A consistency delay (default 10 minutes) avoids eventual-consistency gaps; pending runs are marked as stabilizing until retry.
- Metadata responses are cached in-memory for 10 minutes; if metadata is unavailable and cached data is older than the fallback TTL, a refresh is attempted.

Force refresh:
- Desktop: hold a modifier key while clicking Refresh.
- Mobile: long-press the Refresh button.

### Config (optional)

These can be overridden with Vite env vars:
- `VITE_METADATA_CONSISTENCY_DELAY_MINUTES`
- `VITE_METADATA_MEMORY_TTL_MINUTES`
- `VITE_METADATA_FALLBACK_TTL_HOURS`
- `VITE_MAX_CACHED_LOCATIONS`
- `VITE_METADATA_MIN_INTERVAL_SECONDS`
- `VITE_FRESHNESS_STALE_HOURS`
- `VITE_FRESHNESS_SPREAD_THRESHOLD_HOURS`
- `VITE_FRESHNESS_MAX_PENALTY`
- `VITE_DEBUG_GATING`
