# Closet Dashboard — UI/UX Brief (Review-Ready)

## 1) What this is

The Closet Dashboard is a user-legible view of the app’s **local offline corpus** (“the closet”): what’s stored, what’s growing, what’s healthy, and what’s safe to remove.

It is not a settings page and not an ops console.

Route:
- `GET /closet` (dashboard + assistant export)
- `GET /ops/closet` (advanced / destructive tooling)

## 2) Who it’s for

Primary: power users and internal QA who want confidence that offline data is present, current, and not silently broken.

Secondary: support/debug workflows where users can copy a single JSON blob for remote diagnosis.

## 3) Goals

- Make “what’s in the closet” understandable in under 10 seconds.
- Surface the *why* behind storage usage: coverage, retention, pinned items, inflight work.
- Provide a **single assistant-friendly JSON export** that captures state without screenshots.
- Keep the dashboard safe: no destructive actions; ops stay in `/ops/closet`.

## 4) Non-goals

- No pass/fail gating for the product.
- No “optimize for perfect accuracy” at the expense of robustness.
- No background mutations triggered by opening the page.

## 5) Information Architecture

### Header (centered)
- Title: “Closet”
- Trust badge: `Trusted` vs `Unverified`
- Actions:
  - `Refresh` (recompute snapshot)
  - `Open Ops` (new tab to `/ops/closet`)

### KPI row (3 cards)
1) **Storage**
   - `bytesUsed`, `quota`, headroom
   - `present blobs`, `pinned blobs`, `inflight` count
   - progress bar

2) **Coverage**
   - `obsIndexCount`, `forecastIndexCount`
   - newest observation bucket + “data age” (e.g. “Latest obs: 4h ago”)
   - newest forecast runtime

3) **Retention**
   - manifests in window, total manifest refs
   - window + keep days summary
   - last GC timestamp

### Tabs
- **Dashboard**
  - “Signals”: top observation sources + top forecast models (simple frequency lists)
  - “Largest blobs”: top N by size (what’s driving storage)

- **Assistant JSON**
  - One “copy/paste” payload (pretty-printed JSON)
  - Controls:
    - Export: `full` or `summary`
    - List limit (caps raw arrays)
    - Rebuild + Copy buttons

- **Config**
  - Trust mode selector + expected manifest pubkey
  - Policy summary (quota/window/retention)
  - Clear note: destructive actions live in `/ops/closet`

## 6) Content tone + copy rules

- Prefer plain language (“storage”, “coverage”, “retention”) over internal jargon.
- When exposing jargon (`manifest`, `trusted mode`), pair it with a short clarifier.
- Use “signals” framing: this page informs decisions; it doesn’t judge the user.

## 7) Assistant JSON export contract

Payload name/version:
- `version: "closet_dashboard_v1"`

Environment context (required):
- `environment.platform`: `web` | `ios` | `android`
- `environment.storage_quota_tier`: `low` | `medium` | `high` | `unknown` (derived from browser storage estimate)
- `environment.client_version`: app/build version string (or `dev`/`unknown` if unavailable)

Intended usage:
- Paste into an assistant/support thread.
- Should be sufficient to reason about:
  - storage pressure
  - indexing coverage
  - trust state and why destructive ops are disabled
  - “what grew” symptoms (via largest blobs + index counts)

Export levels:
- `summary`: no raw index arrays; only `ops` + `derived`.
- `full`: includes `raw.observationIndexEntries`, `raw.forecastIndexEntries`, and `raw.inflight` (capped by list limit).

Privacy/sanitization:
- The export MUST redact common secret-like fields if they appear unexpectedly (e.g. `authorization`, `cookie`, `token`, `secret`, `password`, `apiKey`).
- Public keys (e.g. manifest pubkeys) are not considered secret and may be included.

Size guidance:
- Always display approximate size to the user.
- Default to `full` but provide easy downgrade to `summary`.

## 8) Accessibility + ergonomics

- Everything keyboard accessible; no hover-only controls.
- Read-only JSON textarea with monospaced font and scroll containment.
- Buttons have clear labels (“Copy (123 KB)”).

## 9) Review checklist

- Does the top row tell a coherent story in <10s?
- Does the dashboard remain useful in “empty closet” state?
- Is the assistant JSON payload understandable and stable?
- Are destructive actions clearly separated into `/ops/closet`?
