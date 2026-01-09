/**
 * Vitest Global Test Setup
 * 
 * Provides browser-like environment for tests:
 * - IndexedDB via fake-indexeddb
 * - TextEncoder/TextDecoder (Node 18+ native)
 */

import 'fake-indexeddb/auto';

// Ensure fetch is available (Node 18+ has native fetch)
if (typeof globalThis.fetch === 'undefined') {
    throw new Error('fetch is not available. Ensure Node 18+ is used.');
}
