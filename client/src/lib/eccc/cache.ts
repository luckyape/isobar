type HttpCacheEntry = {
  url: string;
  etag?: string;
  lastModified?: string;
  fetchedAt: number;
  body: string;
};

type HttpCacheStore = {
  version: 1;
  entries: Record<string, HttpCacheEntry>;
};

const HTTP_CACHE_KEY = 'eccc-reader-http-cache-v1';

function canUseStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function loadStore(): HttpCacheStore {
  if (!canUseStorage()) return { version: 1, entries: {} };
  try {
    const raw = window.localStorage.getItem(HTTP_CACHE_KEY);
    if (!raw) return { version: 1, entries: {} };
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || typeof parsed?.entries !== 'object') {
      return { version: 1, entries: {} };
    }
    return parsed as HttpCacheStore;
  } catch {
    return { version: 1, entries: {} };
  }
}

function saveStore(store: HttpCacheStore): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(HTTP_CACHE_KEY, JSON.stringify(store));
  } catch {
    // ignore cache write failures
  }
}

function hashString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export type FetchResult = {
  text: string;
  updated: boolean;
  from_cache: boolean;
  raw_ref: string;
};

export async function fetchTextWithCache(
  url: string,
  opts: {
    minFreshMs?: number;
    force?: boolean;
    offline?: boolean;
  } = {}
): Promise<FetchResult> {
  const store = loadStore();
  const key = hashString(url);
  const existing = store.entries[key];
  const now = Date.now();

  if (!opts.force && opts.minFreshMs && existing && now - existing.fetchedAt < opts.minFreshMs) {
    return {
      text: existing.body,
      updated: false,
      from_cache: true,
      raw_ref: `eccc-http-cache:${key}`
    };
  }

  if (opts.offline && existing) {
    return {
      text: existing.body,
      updated: false,
      from_cache: true,
      raw_ref: `eccc-http-cache:${key}`
    };
  }

  const headers: HeadersInit = {};
  if (existing?.etag) headers['If-None-Match'] = existing.etag;
  if (existing?.lastModified) headers['If-Modified-Since'] = existing.lastModified;

  let response: Response | null = null;
  try {
    response = await fetch(url, { headers });
  } catch {
    if (existing) {
      return {
        text: existing.body,
        updated: false,
        from_cache: true,
        raw_ref: `eccc-http-cache:${key}`
      };
    }
    throw new Error(`ECCC fetch failed for ${url}`);
  }

  if (response.status === 304 && existing) {
    store.entries[key] = { ...existing, fetchedAt: now };
    saveStore(store);
    return {
      text: existing.body,
      updated: false,
      from_cache: true,
      raw_ref: `eccc-http-cache:${key}`
    };
  }

  if (!response.ok) {
    if (existing) {
      return {
        text: existing.body,
        updated: false,
        from_cache: true,
        raw_ref: `eccc-http-cache:${key}`
      };
    }
    throw new Error(`ECCC fetch failed for ${url}: ${response.status}`);
  }

  const text = await response.text();
  store.entries[key] = {
    url,
    etag: response.headers.get('etag') ?? undefined,
    lastModified: response.headers.get('last-modified') ?? undefined,
    fetchedAt: now,
    body: text
  };
  saveStore(store);

  return {
    text,
    updated: true,
    from_cache: false,
    raw_ref: `eccc-http-cache:${key}`
  };
}

