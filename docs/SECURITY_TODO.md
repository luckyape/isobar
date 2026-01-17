Security TODO (aligned with public weather data, low-effort, anon, no accounts, no secrets in client):
	1.	Pin manifest verification in prod

	•	Ship VITE_MANIFEST_PUBKEY_HEX in production builds and make the client fail-closed if it’s missing (dev can stay permissive).

	2.	Sign the “root pointer”

	•	Whatever tells the client “latest manifest is X” (e.g. root.json, index file, or listing) must be tamper-evident too.
	•	Options (pick one):
	•	Sign root.json with the same key, or
	•	Make root.json contain { latestManifestHash } and serve it with a signature header.

	3.	Rollback protection

	•	Client should reject manifests older than its last-seen date unless explicitly allowed (prevents “serve old but validly signed” attacks).
	•	Store last-seen date/hash locally.

	4.	Strict caching rules for pointers

	•	root.json (or equivalent) should be Cache-Control: no-store or very short TTL.
	•	Manifests/artifacts can be long-lived immutable (Cache-Control: public, max-age=31536000, immutable).

	5.	Origin hardening

	•	Enforce HTTPS only.
	•	Add CORS explicitly (only the client origin(s) you control), and don’t allow credentials (keep it anonymous).
	•	Set X-Content-Type-Options: nosniff.

	6.	Rate limiting / abuse shaping

	•	Since it’s public + anon, do cheap rate limiting at the edge by IP + path class (pointer endpoints tighter than immutable artifacts).
	•	Log only aggregate counters (avoid storing IPs longer than necessary).

	7.	Key ops

	•	Rotate signing keys safely (support multiple allowed public keys during rotation window).
	•	Keep MANIFEST_SIGNING_PRIVATE_KEY_HEX only as a Worker secret; never committed, never in wrangler.toml.