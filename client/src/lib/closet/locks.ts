
/**
 * Unified locking mechanism for Closet operations.
 * Prevents race conditions between Sync, GC, and other mutations across tabs.
 */

export interface LockProvider {
    /**
     * Acquire a named lock and execute the provided function.
     * The lock is released when the function promise resolves or rejects.
     */
    withLock<T>(
        name: string,
        fn: () => Promise<T>,
        options?: { timeout?: number; signal?: AbortSignal }
    ): Promise<T>;
}

/**
 * Browser implementation using User Agent Web Locks API (navigator.locks).
 */
export class BrowserLockProvider implements LockProvider {
    async withLock<T>(
        name: string,
        fn: () => Promise<T>,
        options?: { timeout?: number; signal?: AbortSignal }
    ): Promise<T> {
        if (typeof navigator === 'undefined' || !navigator.locks) {
            console.warn('Web Locks API not available, falling back to unsafe execution');
            return fn();
        }

        // Web Locks API supports 'signal' directly, but typical polyfills or older usage
        // might benefit from explicit AbortSignal handling or timeouts if needed.
        // Standard navigator.locks.request handles queueing.

        const lockOptions: LockOptions = {
            mode: 'exclusive',
            signal: options?.signal
        };

        // Note: timeout is a bit tricky with raw Lock API (it creates a request that aborts itself).
        // For simplicity, we rely on the signal for cancellation if provided.
        // If a timeout is strictly required, the caller should wrap the signal with AbortSignal.timeout().

        return navigator.locks.request(name, lockOptions, async () => {
            return await fn();
        });
    }
}

/**
 * In-memory test implementation.
 * Serializes requests locally (does NOT coordinate across processes/tabs).
 */
export class TestLockProvider implements LockProvider {
    private locks = new Map<string, Promise<void>>();

    async withLock<T>(
        name: string,
        fn: () => Promise<T>,
        options?: { timeout?: number; signal?: AbortSignal }
    ): Promise<T> {
        // Wait for any existing lock to release
        const existing = this.locks.get(name);
        if (existing) {
            await existing;
        }

        // Create our lock
        let release: () => void;
        const lockPromise = new Promise<void>(resolve => {
            release = resolve;
        });
        this.locks.set(name, lockPromise);

        try {
            if (options?.signal?.aborted) {
                throw new Error('Lock request aborted');
            }
            return await fn();
        } finally {
            release!();
            if (this.locks.get(name) === lockPromise) {
                this.locks.delete(name);
            }
        }
    }
}

/**
 * Strict test lock provider with overlap detection (tripwire).
 * Throws if a second caller enters while first is still in critical section.
 * Use this to PROVE mutual exclusion in tests.
 */
export class StrictTestLockProvider implements LockProvider {
    private inCritical = new Map<string, boolean>();
    public overlapDetected = false;
    public overlapCount = 0;

    async withLock<T>(
        name: string,
        fn: () => Promise<T>,
        options?: { timeout?: number; signal?: AbortSignal }
    ): Promise<T> {
        // TRIPWIRE: Detect overlap
        if (this.inCritical.get(name)) {
            this.overlapDetected = true;
            this.overlapCount++;
            throw new Error(`TRIPWIRE: Lock overlap detected for "${name}"`);
        }

        // Mark entering critical section
        this.inCritical.set(name, true);

        try {
            if (options?.signal?.aborted) {
                throw new Error('Lock request aborted');
            }
            return await fn();
        } finally {
            this.inCritical.set(name, false);
        }
    }

    /** Reset tripwire state for next test */
    reset(): void {
        this.overlapDetected = false;
        this.overlapCount = 0;
        this.inCritical.clear();
    }
}

// Singleton provider instance
let provider: LockProvider | null = null;

export function getLockProvider(): LockProvider {
    if (!provider) {
        if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
            provider = new BrowserLockProvider();
        } else {
            provider = new TestLockProvider();
        }
    }
    return provider;
}

/**
 * Inject a provider (for testing).
 */
export function setLockProvider(p: LockProvider) {
    provider = p;
}

/**
 * Unified unified lock helper.
 * Uses a single lock namespace 'closet:mutex' to ensure mutual exclusion
 * between GC, Sync, and other critical sections.
 */
export async function withClosetLock<T>(
    resource: 'closet', // Reserved for future expansion, currently single global lock
    fn: () => Promise<T>,
    options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<T> {
    const p = getLockProvider();

    // If strict timeout requested, compose a signal
    let signal = options?.signal;
    if (options?.timeoutMs && typeof AbortSignal.timeout === 'function') {
        const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
        if (signal) {
            // Merge signals? Not natively supported easily.
            // For now, if caller provides signal, they handle timeout.
            // If they don't, we use the timeout.
        } else {
            signal = timeoutSignal;
        }
    }

    return p.withLock('closet:mutex', fn, {
        timeout: options?.timeoutMs,
        signal
    });
}
