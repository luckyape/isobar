# Closet Dashboard — UI/UX Brief (Review-Ready)

## 1) What this is

The Closet Dashboard is a user-legible view of the app’s **local offline corpus** (“the closet”): what’s stored, what’s growing, what’s healthy, and what’s safe to remove.

It is not a settings page and not an ops console.

Route:
- `GET /closet` (dashboard + assistant export)
- `GET /ops/closet` (advanced / destructive tooling)

## 2) Who it’s for

Primary: curious non-technical users who want confidence that offline data is present, current, and working *for them* — even if they don’t yet understand how.

Secondary: power users, internal QA, and support workflows that require deep visibility into system state and provenance.

The dashboard is designed to *teach the system gradually*, rewarding curiosity with deeper truth rather than forcing users into a separate “debug mode.”

## 3) Goals

- Make “what’s in the closet” understandable in under 10 seconds.
- Surface the *why* behind storage usage: coverage, retention, pinned items, inflight work.
- Provide a **single assistant-friendly JSON export** that captures state without screenshots.
- Keep the dashboard safe: no destructive actions; ops stay in `/ops/closet`.
- Allow users to progressively explore deeper layers of truth (why → data → raw) without leaving the dashboard or consulting documentation.

## 4) Non-goals

- No pass/fail gating for the product (the dashboard never blocks app usage; it explains state but does not enforce it).
- No “optimize for perfect accuracy” at the expense of robustness.
- No background mutations triggered by opening the page.

## 5) Information Architecture (Layered Depth Model)

The dashboard exposes a single canonical data model through progressively deeper UI layers.
All friendly statements must be mechanically provable by deeper layers.

### Layer 0 — Unlabeled (Default View)
- Human-readable assertions only (e.g. “You’re covered”, “Storage is healthy”).
- Relative time and qualitative summaries (“4 hours ago”, “About half full”).
- No raw counts or IDs unless emotionally legible.

### Layer 1 — “Why?” / “Details”
- Inline expand beneath the originating statement.
- Answers: “Why does the system believe this?”
- Uses derived fields and evaluated booleans only.
- Must also explain system standards (e.g. freshness thresholds).

### Layer 2 — “Data” / “Source”
- Opens in a persistent right-side inspector panel.
- Shows concrete timestamps, counts, thresholds, IDs, and evaluated flags.
- This is the authoritative human-readable truth layer.

### Layer 3 — “JSON”
- Full canonical snapshot (Assistant JSON).
- Syntax-highlighted, collapsible, copyable.
- Serves as the ultimate source of truth for support and assistants.

### 5.1 Interaction Rules

- Layer 1 expands inline; multiple sections may be open simultaneously.
- Layer 2 uses a single persistent inspector panel; only one dataset active at a time.
- Layer 3 opens a full-width drawer or dedicated tab.

Click budget:
- ≤1 click to answer “Why is this true?”
- ≤2 clicks to see the data behind it.
- ≤3 clicks to reach raw JSON.

State:
- Layer 1 expansion state persists during navigation within `/closet`.
- Layer 2 inspector selection persists until explicitly closed.
- URL state MUST encode depth for deep linking (e.g. `#coverage?details=open`, `#coverage?data=forecast`, `#coverage?json=full`).

Inspector behavior:
- Clicking a new Layer 2 trigger replaces the inspector panel contents with a smooth slide transition.
- Clicking the currently active Layer 2 trigger again closes the inspector.
- Inspector transitions must never briefly show an empty or blank panel.

### 5.2 Empty / Degraded States

When the closet is empty, partially initialized, or degraded:

- Layer 0 MUST still render meaningful assertions (e.g. “No data stored yet”, not “Loading…”).
- Layer 1 MUST explain *why* (e.g. “First download pending”, “Offline mode not yet enabled”, “No connectivity detected”).
- Layer 2 and Layer 3 MUST show structural skeletons (empty indexes, zero counts, known thresholds), not “N/A” or hidden content.

The goal is to teach the system’s structure even when it contains no data.

## 6) Content tone + copy rules

- Prefer plain language (“storage”, “coverage”, “retention”) over internal jargon.
- When exposing jargon (`manifest`, `trusted mode`), pair it with a short clarifier.
- Use “signals” framing: this page informs decisions; it doesn’t judge the user.
- When system assessments may conflict with user intuition (e.g. “fresh” but older than expected), Layer 1 MUST explain the system’s definition and thresholds.
- Prefer explanation over override; understanding precedes control.

### 6.1 Core Dashboard Sections (Minimum Viable)

The dashboard MUST include the following sections, each supporting all four layers:

1. **Coverage** — presence and freshness of observation and forecast data.
2. **Storage** — quota usage, largest blobs, retention and pinning state.
3. **Activity** — recent downloads, indexing events, cleanup actions, and errors.
4. **Trust** — manifest signature status, trusted mode state, and reasons destructive ops are disabled.

Additional sections may be added later, but these define the baseline scope.

## 7) Assistant JSON export contract

The Assistant JSON represents the deepest layer of the dashboard.
All Layer 0–2 UI statements MUST be derivable from fields in this export.

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

Expected sizes:
- `summary`: typically 5–20 KB
- `full`: typically 50–500 KB, up to ~2 MB with large indexes

If a `full` export exceeds 1 MB, the UI MUST warn the user and recommend switching to `summary` or applying list limits before copying.

## 8) Accessibility + ergonomics

- All interactions keyboard accessible; no hover-only controls.
- Visible focus indicators for all interactive elements.
- Expand/collapse controls have screen-reader labels describing the action and target.
- Any status colors MUST meet WCAG AA contrast requirements.
- Loading states use inline messages or skeletons; avoid indeterminate spinners for primary content.
- Read-only JSON view uses monospaced font, syntax highlighting, collapsible objects, and scroll containment.
- Action buttons have explicit labels (e.g. “Copy (123 KB)”).

## 9) Review checklist

- Does the top row tell a coherent story in <10s?
- Does the dashboard remain useful in “empty closet” state?
- Is the assistant JSON payload understandable and stable?
- Are destructive actions clearly separated into `/ops/closet`?
- For any Layer 0 statement, can a curious user reach the underlying data and raw truth in ≤3 interactions?
- When expectations diverge from system assessments, does the UI explain the system’s logic clearly without redirecting to documentation?
- [ ] Usability test: Can at least 3 unfamiliar users identify (a) whether any data is present and (b) approximate storage usage within 10 seconds of seeing Layer 0?
