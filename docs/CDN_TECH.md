# Weather Forecast CDN — Technical DOC

Date: 2026-01-09  
Repo: `weather-consensus`  
Scope: `cdn/` protocol + `cdn/worker/` Cloudflare Worker + client consumption paths that interact with the CDN.

---

## 1) Executive Summary

This repository implements a **content-addressed, client-synchronized CDN** for weather artifacts (forecasts + observations) stored in Cloudflare R2 and served via a Cloudflare Worker. The core design is sound: artifacts are immutable blobs addressed by a BLAKE3 hash of **canonical, deterministic** bytes, with runtime integrity checks on fetch.

The main audit findings are:

- **Integrity is strong, authenticity is currently optional**: artifacts/manifests are verifiable by hash, but the ingest path does not currently sign manifests, and the client does not currently pin/verify a manifest signing key.
- **Manifest chaining is present but brittle**: the ingest pipeline selects `previousManifestHash` based on storage list order, which is not a reliable “previous” definition.
- **Worker manifest listing route does not paginate** (potentially incomplete listings if manifests per day exceed 1000).
- **Several comments/spec statements disagree with the actual implementation** (e.g., artifact ID derivation mentions canonical JSON, but code hashes canonical MsgPack bytes).

Overall: the system is very close to “audit-ready”; with a small set of targeted changes (sign manifests + pin key + define chain head semantics + paginate list route), the protocol becomes substantially more robust against CDN/bucket compromise, rollback, and tampering.

---

## 2) Goals & Non-Goals

### Goals
- Immutable, content-addressed artifacts for deterministic caching and tamper evidence.
- Stateless CDN: no per-user server state; clients self-manage sync cursor.
- Efficient transport: gzip-compressed payloads with stable identity hash independent of compression.
- Ability to add authenticity via signatures (Ed25519).

### Non-goals (as currently implemented)
- Confidentiality (everything is public + CORS `*`).
- Strong freshness guarantees (root pointer is mutable and short-cached).
- Global consistency / consensus around a single linear manifest chain.

---

## 3) Components Inventory

### CDN library (`cdn/`)
Key modules:
- `cdn/artifact.ts`: blob format, packaging/unpackaging, header parsing.
- `cdn/canonical.ts`: canonical serialization (sorted keys, strict value rules).
- `cdn/hash.ts`: BLAKE3 hashing + hex utilities.
- `cdn/compress.ts`: gzip via CompressionStream/DecompressionStream.
- `cdn/manifest.ts`: daily manifests, manifest packaging/unpackaging, optional signature verification.
- `cdn/signing.ts`: Ed25519 key utilities + envelopes.
- `cdn/ingest/pipeline.ts`: fetch → package → upload → publish manifest → update root pointer.
- `cdn/ingest/fetcher.ts`: Open-Meteo forecast fetch + ECCC (MSC GeoMet) hourly observation fetch.
- `cdn/types.ts`: artifact and manifest schema types.

### Worker (`cdn/worker/`)
- `cdn/worker/index.ts`: HTTP routes + cron scheduled ingest.
- `cdn/worker/r2-storage.ts`: R2 backend implementation of `StorageBackend`.

### Client consumption (selected)
- `client/src/lib/config.ts`: `getCdnBaseUrl()` default `http://localhost:8787`.
- `client/src/lib/vault/sync.ts`: sync engine (root → manifests → chunks) with hash verification.
- `client/src/lib/closet/blobStore.ts`: fetches `/chunks/<hash>` and verifies hash.

### Deployment config
- `wrangler.toml`: Worker entry, R2 binding, cron schedule, ingest coordinates/timezone.

---

## 4) System Overview & Data Flow

### 4.1 High-level flow

```
         (cron: forecasts every 6 hours; observations hourly)
                 |
                 v
      Cloudflare Worker (scheduled)
                 |
                 v
          runIngest(options)
                 |
   +-------------+------------------+
   |                                |
   v                                v
fetch forecasts (Open-Meteo)   fetch observations (ECCC / MSC GeoMet)
   |                                |
   v                                v
packageArtifact()                  packageArtifact()
(canonical MsgPack -> BLAKE3)      (canonical MsgPack -> BLAKE3)
   |                                |
   v                                v
PUT chunks/<hash> (R2)         PUT chunks/<hash> (R2)
   \                                /
    \                              /
     v                            v
        createManifest(artifacts)
                 |
                 v
         packageManifest()
 (canonical MsgPack -> BLAKE3; optional Ed25519 signature)
                 |
                 v
 PUT manifests/<date>/<manifestHash> (R2)
                 |
                 v
 PUT manifests/root.json (R2)  <-- ONLY mutable object
```

### 4.2 Serving / client sync flow

```
Client SyncEngine
  |
  | GET /manifests/root.json  (short cache)
  v
latest date
  |
  | GET /manifests/<date>/    (list)
  v
manifest hashes
  |
  | GET /manifests/<date>/<hash>
  |  - verify hash (blob header)
  |  - optionally verify signature (NOT enabled today)
  v
manifest artifacts
  |
  | GET /chunks/<hash>
  |  - verify hash (blob header)
  v
local vault/closet storage
```

---

## 5) Artifact Format & Identity

### 5.1 Blob format
Artifacts and manifests are stored as a binary blob:

- Header (46 bytes) + gzip-compressed MsgPack payload
- Header layout (`cdn/artifact.ts`):
  - bytes 0–3: magic (`WFCD` / `0x57464344`)
  - bytes 4–5: schema version (uint16 BE)
  - bytes 6–9: uncompressed payload size (uint32 BE)
  - bytes 10–41: 32-byte content hash (artifact ID)
  - bytes 42–45: encoding flags (uint32 BE)

### 5.2 Identity hash
- **Actual implementation:** ID = `BLAKE3(canonicalMsgPack(artifactOrManifest))`
- The compressed form does not affect identity.

Audit note: comments in `cdn/artifact.ts` currently mention canonical JSON bytes in places; the code uses canonical MsgPack bytes. The code behavior is what matters; comments should be aligned.

### 5.3 Canonicalization rules
`cdn/canonical.ts` enforces:
- Recursively sorted object keys.
- Arrays preserve order.
- Forbid `undefined`, functions, symbols, bigint.
- Forbid non-finite numbers (`NaN`, `Infinity`, `-Infinity`).
- Normalize `-0` → `0`.

This is backed by tests in `cdn/test/canonical.test.ts`.

---

## 6) Compression & Encoding Registry

`cdn/compress.ts` uses:
- `CompressionStream('gzip')` and `DecompressionStream('gzip')`.
- Encoding flag registry:
  - `0x00000001` = gzip + MsgPack (current)
  - `0x00000002`/`0x00000003` reserved for brotli/zstd

Security posture:
- Unknown encoding flags hard-fail.
- Regression test covers a historical DecompressionStream deadlock case (`cdn/test/compress_regression.test.ts`).

Operational note:
- This relies on Web Streams compression APIs being available (Cloudflare Worker + modern browsers; Node compatibility depends on runtime).

---

## 7) Manifest Design

### 7.1 Daily manifest
`DailyManifest` (`cdn/types.ts`) contains:
- `schemaVersion`
- `date` (YYYY-MM-DD)
- `publishedAt` (ISO)
- `artifacts: ManifestEntry[]`
- optional `previousManifestHash`
- optional `signature: SignedEnvelope`

### 7.2 Signing semantics
- `packageManifest(manifest, privateKeyHex?)` optionally adds `manifest.signature`.
- Signing scope is: **canonical bytes of the manifest WITHOUT `signature` field**.
- Verification (`unpackageManifest(blob, expectedPublicKeyHex?)`) checks:
  1) hash matches header ID
  2) if expected key provided:
     - signature exists
     - signature public key matches expected
     - signature verifies over canonical(manifest minus signature)

Important nuance:
- Because the signature envelope includes `signedAt`, re-signing the same logical manifest will change the manifest ID (hash of canonical MsgPack of the full manifest including signature). This is not inherently wrong, but it should be a conscious protocol decision.

### 7.3 Hash chain semantics
- `previousManifestHash` is intended for continuity.
- Current ingest chooses `previousManifestHash` by listing `manifests/<date>/` and taking the last element returned.

Audit risk:
- Storage listing order is not a durable definition of “previous”. This can create accidental forks or invalid chains.

Recommendation:
- Define chain head explicitly (e.g., store `latestManifestHash` in `root.json`, or store a per-date `manifests/<date>/latest.json` pointer), and/or sort deterministically if using list order.

---

## 8) Ingest Pipeline Review

### 8.1 Forecast ingest
- Fetcher (`cdn/ingest/fetcher.ts`) pulls Open-Meteo GEM/GFS endpoints.
- Artifact fields include `issuedAt = now()` and `runTime` derived from first forecast time (fallback to floored current hour).

Note:
- Using `issuedAt` means IDs will change every ingest, which is expected if each ingest represents a new “publication”.

### 8.2 Observation ingest
- Observations are fetched from ECCC MSC GeoMet WFS `ec-msc:CURRENT_CONDITIONS` and ingested as hourly buckets.
- Current implementation selects the nearest station within a radius around the ingest location.
- Observation includes both `observedAtBucket` (bucket start) and optional `observedAtRaw` (source time string).
- Time bucketing is implemented in `cdn/time.ts` and tested in `cdn/test/time.test.ts`.

### 8.3 Upload behavior
- Chunks are uploaded idempotently via `exists()` check.
- Manifests are always uploaded as new immutable objects.
- `manifests/root.json` is overwritten each ingest and is the only mutable key.

---

## 9) Worker Serving Behavior

### 9.1 Routes
`cdn/worker/index.ts` implements:
- `GET /manifests/root.json`: returns pointer `{ latest: <date> }` (short cache).
- `GET|HEAD /manifests/:date/:hash`: returns manifest blob.
- `GET|HEAD /chunks/:hash`: returns artifact blob.
- `GET /manifests/:date/`: lists manifest hashes for that date.

### 9.2 Caching & CORS
- CORS: `Access-Control-Allow-Origin: *`, methods `GET, HEAD, OPTIONS`.
- Cache defaults:
  - long cache: `public, max-age=31536000, immutable` (chunks and manifests)
  - root pointer override: `public, max-age=60`

### 9.3 Known operational gaps
- Manifest listing uses `env.BUCKET.list({ prefix })` once and does **not** paginate. If objects > 1000, listing will be incomplete.

Recommendation:
- Implement pagination loop (similar to `R2Storage.list()` implementation).

---

## 10) Client Verification & Trust Model

### 10.1 Integrity verification (implemented)
- Client verifies every fetched blob using `getBlobContentHash(blob)` and compares it to the expected hash from URL/list.
- This prevents accidental corruption and many classes of tampering.

### 10.2 Authenticity verification

**Environment variable:** `VITE_MANIFEST_PUBKEY_HEX`

| Mode | Env var | Behavior |
|------|---------|----------|
| DEV  | absent  | Unsigned manifests allowed (signature verification skipped) |
| DEV  | present | Manifests MUST be signed by that key; unsigned/mismatched fails |
| PROD | absent  | **App throws immediately** with `Missing VITE_MANIFEST_PUBKEY_HEX` |
| PROD | present | Manifests MUST be signed by that key; unsigned/mismatched fails |

Implementation:
- `client/src/lib/config.ts` exports `getManifestPubKeyHex()` which enforces the above rules.
- `client/src/lib/vault/sync.ts` calls `unpackageManifest(blob, pinnedManifestPubKeyHex)` with the pinned key (or `undefined` in dev if not configured).

Risk (if key not configured in prod):
- An attacker controlling the CDN origin (or R2) can publish a fully self-consistent alternate universe: manifests + chunks that hash correctly.

### 10.3 Rollback / freeze attacks
- `root.json` is mutable and unsigned.
- Without signature + chain enforcement, an attacker can point clients to an old date or withhold newer manifests.

Recommendation:
- Add monotonic “latest” semantics to root pointer (include date + manifest hash + signed envelope), and have clients refuse to move backwards unless explicitly configured.

---

## 11) Determinism & Reproducibility Audit

### 11.1 What is deterministic
- Canonical MsgPack encoding of sorted-key object graphs with strict numeric rules.
- Artifact IDs derived from canonical bytes.
- Golden vectors exist (`cdn/test/golden.test.ts` and `cdn/golden-vector.json`).

### 11.2 What is intentionally non-deterministic
- `publishedAt`, `issuedAt`, `signedAt` include wall-clock time.
- Therefore ingest outputs will naturally change each run.

### 11.3 Environmental dependencies
- Compression relies on platform gzip implementation (`CompressionStream`). Identity hash does not depend on compression.
- MsgPack encoding relies on `@msgpack/msgpack`; sorting keys before encode reduces nondeterminism risk.

---

## 12) Findings & Recommendations (Prioritized)

### P0 (should address before claiming “secure CDN”)
1) **~~Enable manifest signing in ingest and require pinned verification in clients.~~** ✅ Done
   - ~~Add a Worker secret for private key (Wrangler secret).~~
   - ~~Pass `privateKeyHex` into `packageManifest`.~~
   - ~~Configure client with `VITE_MANIFEST_PUBKEY_HEX` (or similar) and verify on read.~~
   - **Client-side verification implemented.** Ingest-side signing still requires adding the Worker secret.

2) **Define and enforce a stable chain head.**
   - Current `previousManifestHash` selection is not reliable.
   - Prefer storing `{ latestDate, latestManifestHash, signature? }` in `root.json`.

### P1 (robustness / correctness)
3) **Paginate Worker manifest listing** (`/manifests/:date/`).
4) **Sort manifest hashes** in listing responses for stable results.
5) **Align comments/spec with implementation** (canonical JSON vs MsgPack references).

### P2 (operational improvements)
6) Add structured logging (ingest results, per-model failures, durations).
7) Consider rate limiting / backoff on upstream fetch failures.
8) Consider content-type for manifest blobs (still octet-stream OK).

---

## 13) Open Questions (to confirm intended protocol)

1) Should manifest ID include signature envelope fields like `signedAt`?
   - If “no”, move signature out-of-band or exclude `signedAt` from canonicalized manifest.

2) Should the system support multiple ingests per day (multiple manifests per date)?
   - If yes, define ordering and chain semantics explicitly.

3) Should `root.json` include manifest hash and be signed?
   - Strongly recommended if clients need freshness guarantees.

---

## Appendix A: Key File Map

- Worker entry: `cdn/worker/index.ts`
- R2 backend: `cdn/worker/r2-storage.ts`
- Ingest: `cdn/ingest/pipeline.ts`, `cdn/ingest/fetcher.ts`
- Artifact format: `cdn/artifact.ts`
- Manifest format: `cdn/manifest.ts`
- Canonicalization: `cdn/canonical.ts`
- Compression: `cdn/compress.ts`
- Signing utilities: `cdn/signing.ts`
- Types: `cdn/types.ts`
- Client sync: `client/src/lib/vault/sync.ts`
- Client blob fetch: `client/src/lib/closet/blobStore.ts`
- Worker config: `wrangler.toml`
