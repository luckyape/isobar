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
