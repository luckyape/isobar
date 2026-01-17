/**
 * Vitest Global Test Setup
 * 
 * Provides browser-like environment for tests:
 * - IndexedDB via fake-indexeddb
 * - TextEncoder/TextDecoder (Node 18+ native)
 * - IntersectionObserver shim for components relying on it
 */

import 'fake-indexeddb/auto';

// Ensure fetch is available (Node 18+ has native fetch)
if (typeof globalThis.fetch === 'undefined') {
    throw new Error('fetch is not available. Ensure Node 18+ is used.');
}

// Basic IntersectionObserver mock for JSDOM
if (typeof globalThis.IntersectionObserver === 'undefined') {
    class MockIntersectionObserver implements IntersectionObserver {
        readonly root: Element | null = null;
        readonly rootMargin = '0px';
        readonly thresholds: ReadonlyArray<number> = [0];

        constructor(
            public readonly callback: IntersectionObserverCallback,
            public readonly options?: IntersectionObserverInit
        ) {}

        observe(): void {
            // Immediately signal intersection to keep components mounted in tests
            this.callback([], this);
        }
        unobserve(): void {}
        disconnect(): void {}
        takeRecords(): IntersectionObserverEntry[] {
            return [];
        }
    }

    // @ts-expect-error: assign to global for test environment
    globalThis.IntersectionObserver = MockIntersectionObserver;
}

// Basic ResizeObserver mock for JSDOM
if (typeof globalThis.ResizeObserver === 'undefined') {
    class MockResizeObserver implements ResizeObserver {
        constructor(
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            public readonly callback: ResizeObserverCallback
        ) {}

        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
    }

    // @ts-expect-error: assign to global for test environment
    globalThis.ResizeObserver = MockResizeObserver;
}
