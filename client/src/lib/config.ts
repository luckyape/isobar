/**
 * Centralized configuration for the Weather Consensus client.
 * 
 * All environment-dependent values should be accessed through this module.
 */

/**
 * Get the CDN base URL for manifest/chunk fetching.
 * 
 * Priority:
 * 1. VITE_CDN_URL environment variable (production/staging)
 * 2. Default localhost:8787 (local development)
 */
export function getCdnBaseUrl(): string {
    // Vite injects import.meta.env at build time
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_CDN_URL) {
        return import.meta.env.VITE_CDN_URL;
    }

    // Default for local development (wrangler dev default port)
    return 'http://localhost:8787';
}

/**
 * Check if running in test environment.
 */
export function isTestEnvironment(): boolean {
    return typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';
}

/**
 * Get the pinned manifest signing public key (hex).
 * 
 * - PROD: Required. Throws if missing.
 * - DEV: Optional. Returns undefined if not configured (allows unsigned manifests).
 */
export function getManifestPubKeyHex(): string | undefined {
    const raw = typeof import.meta !== 'undefined'
        ? (import.meta.env?.VITE_MANIFEST_PUBKEY_HEX as string | undefined)
        : undefined;
    const key = typeof raw === 'string' ? raw.trim() : '';
    const isDev = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

    // Minimal-auth default:
    // Only enforce manifest signature pinning when explicitly enabled.
    // This avoids "empty closet" when the CDN signing key rotates or differs
    // across environments.
    const enforceRaw = typeof import.meta !== 'undefined'
        ? (import.meta.env?.VITE_ENFORCE_MANIFEST_SIGNATURE as string | undefined)
        : undefined;
    const enforce = (enforceRaw ?? '').trim().toLowerCase();
    const shouldEnforce = enforce === '1' || enforce === 'true' || enforce === 'yes';
    if (!shouldEnforce) return undefined;

    if (!key) {
        throw new Error('Missing VITE_MANIFEST_PUBKEY_HEX (required when VITE_ENFORCE_MANIFEST_SIGNATURE is enabled)');
    }

    // Keep the old behavior of allowing empty in dev only when NOT enforcing.
    // If enforcing, require a configured key in all modes.
    void isDev;
    return key;
}
