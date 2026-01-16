# Proposal: Location-Scoped Manifest Pointer Endpoint (Option A)

**Status:** Proposed  
**Scope:** CDN protocol / Worker routing (read-only view)  
**Non-goal:** Introducing a second source of truth or duplicating artifact identity

---

## 1. Problem Statement

The current CDN protocol is globally indexed:

- `root.json` → latest date
- `/manifests/<date>/` → list of manifest hashes
- `/manifests/<date>/<hash>` → manifest entries
- `/chunks/<hash>` → immutable artifacts

Clients must:
1. Fetch global manifests
2. Parse all entries
3. Filter by `loc_key` locally

This is correct but inefficient once:
- multiple locations exist
- clients are constrained (mobile, offline-first)
- MVP enforces exactly one location per device

We want a **location-aware entry point** that:
- reduces client work
- avoids duplication
- preserves the manifest as the canonical ledger

---

## 2. Design Goal

Introduce a **location-scoped endpoint** that answers:

> “Which manifest(s) should I read for this location right now?”

without:
- inventing new artifact hashes
- bypassing manifest verification
- fragmenting the trust model

---

## 3. Core Principle (Non-Negotiable)

> **Manifests remain the sole source of truth.**

The new endpoint is a **view** over existing manifests, not a parallel index.

It may *reference* manifest hashes.  
It must *never* invent artifact hashes.

---

## 4. Proposed Endpoint (Option A)

### Endpoint
```
GET /locations/<loc_key>/latest.json
```

### Responsibility
Return **manifest pointers**, not artifacts.

### Response (conceptual)
```json
{
  "loc_key": "v1:44.6683,-65.7619",
  "dates": [
    {
      "date": "2026-01-15",
      "manifests": ["abc123..."]
    },
    {
      "date": "2026-01-14",
      "manifests": ["def456..."]
    }
  ]
}
```

Notes:
- For MVP, the Worker returns up to two dates (latest + previous day) to avoid empty states during ingest skew.
- Dates are included even if `manifests` is empty (debuggability > omission).
- No artifact hashes included.
- No user identity involved.

---

## 5. How the Endpoint Is Derived (Revised)

### 5.1 Conceptual Model

The `/locations/<loc_key>/latest.json` endpoint is a **read-only view** over the existing manifest ledger. It does not define truth; it identifies *which existing manifest(s)* are likely to contain data for a given location.

This endpoint MUST NOT require a full scan of manifest bodies on every request at scale.

---

### 5.2 Implementation Strategies

There are two acceptable implementation strategies, depending on deployment scale and cost tolerance.

#### Strategy A — MVP / Low-Scale (Dynamic Scan)

For MVP or low-volume deployments, the Worker MAY derive the response dynamically:

1. Read `root.json` to determine `latestDate`
2. List all manifest objects for that date
3. Fetch and parse each manifest
4. Select manifests that contain at least one entry with `loc_key`
5. Return their hashes to the client

**Trade-off (Explicit):**
- Higher latency
- Read amplification proportional to manifests-per-date
- Acceptable for personal, pilot, or pre-QA environments

This strategy is intentionally simple and correctness-first.

---

#### Strategy B — Production / Optimized (Recommended)

For production-scale use, the ingest pipeline SHOULD emit **location coverage metadata** at publish time, allowing the Worker to answer location queries **without fetching manifest bodies**.

##### Option B1 — R2 Custom Metadata

When uploading a manifest object, the ingest pipeline attaches custom metadata indicating which locations it covers.

Example (conceptual):
- Object: `manifests/2026-01-15/<hash>`
- Metadata: `locations: v1:44.6683,-65.7619,v1:44.6450,-63.5724`

At request time:
1. Worker lists manifests for the date
2. Worker filters objects by metadata match on `loc_key`
3. Worker returns matching manifest hashes

##### Option B2 — Location Pointer Objects

Alternatively, ingest MAY write small pointer objects:
```
/locations/<loc_key>/latest.json
```

Containing:
- `latestDate`
- `manifestHash[]`

These pointer objects are **derived artifacts**, not a second ledger:
- They reference only existing manifest hashes
- They can be regenerated at any time from manifests
- They never introduce new artifact identity

---

### 5.3 Invariants

Regardless of implementation:
- Every manifest hash returned MUST correspond to an actual manifest object
- Every artifact hash ultimately fetched MUST originate from a verified manifest
- The location endpoint MUST NOT invent or cache artifact hashes
- If the endpoint fails, clients may fall back to global manifest scan

---

### ⚠️ Deployment Note: Phased Rollout

For the initial release (MVP), **Strategy A (Dynamic Scan)** will be deployed. The current expected scale (<100 locations) fits within Worker CPU and R2 limits.

TTFB on this endpoint will be monitored. When latency approaches ~300ms p95, the system will migrate to **Strategy B2 (Pointer Objects)**. This migration requires **no client-side changes**, as the API contract remains identical.

---

## 6. Client Flow

### 6.1 Handshake Sequence

1. Client → Worker: `GET /locations/v1:44.66,-65.76/latest.json`
2. Worker → R2: Identify relevant manifest hashes
3. Worker → Client: `{ manifests: [...] }`
4. Client → Worker: `GET /manifests/<date>/<hash>`
5. Client: Verifies hash & signature
6. Client: Extracts entries for `loc_key`
7. Client → Worker: `GET /chunks/<artifact_hash>`

---

## 7. Failure Modes & Expected Behavior

| Scenario | Behavior |
|--------|----------|
| No data yet for `loc_key` | `dates[]` present, but `manifests: []` |
| Endpoint lies | Client filters manifests, shows no data |
| Endpoint unavailable | Client falls back to global scan |

---

## 8. Location Key Canonicalization

To avoid ambiguity and floating-point mismatch, `loc_key` MUST be canonicalized as follows:

- Coordinates snapped to a fixed resolution (e.g., `0.0001°`)
- Decimal formatted to a fixed precision (exactly 4 decimal places)
- `-0.0000` normalized to `0.0000`
- Version-prefixed (e.g., `v1:`)

This canonical form is used consistently by ingest, CDN routing, and clients.

---

## 9. Security Posture

The location endpoint does not require signing. Integrity and authenticity are enforced exclusively via:
- Manifest hash verification
- Optional manifest signature verification

A malicious or faulty endpoint can cause omission but not spoofing.

---

## 10. Alternatives Considered

### Option B: Artifact-Level Indexing (Rejected)

We considered an endpoint that maps `loc_key` directly to artifact hashes (e.g., `GET /locations/x/y → { artifactHash: "..." }`).

**Reason for Rejection:**

This creates a **Dual Ledger** problem. If the Location Index points to an artifact that is not present in the Daily Manifest (or vice versa), the system enters a split-brain state.

Furthermore, referencing artifacts directly bypasses the Manifest Signature verification loop. To preserve security, the Location Index would require its own signing and trust root, effectively duplicating the ledger.

Option A avoids this entirely by keeping the Manifest as the sole, verifiable source of truth.

---

## 11. Summary

This proposal introduces a location-scoped **view layer** that:
- reduces over-fetching for constrained clients
- preserves manifest sovereignty
- scales cleanly from MVP to production
- introduces no irreversible protocol commitments

It is intentionally boring, auditable, and correct.
