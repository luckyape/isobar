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

    if (!isDev && !key) {
        throw new Error(
            'Missing VITE_MANIFEST_PUBKEY_HEX (required in production to verify signed manifests)'
        );
    }

    return key || undefined;
}
