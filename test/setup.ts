/**
 * Vitest Global Test Setup
 * 
 * Provides browser-like environment for tests:
 * - IndexedDB via fake-indexeddb
 * - TextEncoder/TextDecoder (Node 18+ native)
 * - IntersectionObserver shim for components relying on it
 */

import 'fake-indexeddb/auto';
import type { Locator } from 'playwright';
import { expect } from 'vitest';

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

type ToContainTextOptions = {
    timeout?: number;
};

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

expect.extend({
    async toContainText(
        received: Locator,
        expected: string | RegExp,
        options?: ToContainTextOptions
    ) {
        const locator = received as any;
        if (!locator || typeof locator.innerText !== 'function') {
            return {
                pass: false,
                message: () =>
                    `toContainText expects a Playwright Locator. Received: ${this.utils.printReceived(received)}`
            };
        }

        const timeout = Math.max(0, options?.timeout ?? 5_000);
        const deadline = Date.now() + timeout;
        let lastText = '';
        let lastError: unknown;

        try {
            await locator.waitFor({ state: 'attached', timeout });
        } catch (err) {
            lastError = err;
        }

        const matches = (text: string): boolean =>
            typeof expected === 'string' ? text.includes(expected) : expected.test(text);

        let pass = false;
        while (Date.now() <= deadline) {
            try {
                lastText = await locator.innerText();
                if (matches(lastText)) {
                    pass = true;
                    break;
                }
            } catch (err) {
                lastError = err;
            }
            await sleep(50);
        }

        const detail = lastError ? `\nLast error: ${String(lastError)}` : '';

        if (pass) {
            return {
                pass: true,
                message: () =>
                    this.isNot
                        ? `Expected locator not to contain ${this.utils.printExpected(expected)}, but it did.\nLast text: ${lastText}`
                        : `Expected locator to contain ${this.utils.printExpected(expected)}, and it did.\nLast text: ${lastText}`
            };
        }

        return {
            pass: false,
            message: () =>
                this.isNot
                    ? `Expected locator not to contain ${this.utils.printExpected(expected)}, but it was missing for ${timeout}ms${detail}`
                    : `Expected locator to contain ${this.utils.printExpected(expected)} within ${timeout}ms\nLast text: ${lastText}${detail}`
        };
    }
});

declare module 'vitest' {
    interface Assertion {
        toContainText(expected: string | RegExp, options?: ToContainTextOptions): Promise<void>;
    }
    interface AsymmetricMatchersContaining {
        toContainText(expected: string | RegExp, options?: ToContainTextOptions): Promise<void>;
    }
}
