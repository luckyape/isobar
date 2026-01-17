import { fetchTextWithCache, type FetchResult } from './cache';

const CAP_BASE_URL = 'https://dd.weather.gc.ca/alerts/cap/cap-cp';
const RSS_BASE_URL = 'https://weather.gc.ca/rss';
const CITY_API_BASE_URL = 'https://weather.gc.ca/api';

function resolveUrl(base: string, id: string | undefined, suffix: string): string | null {
  if (!id) return null;
  if (id.startsWith('http://') || id.startsWith('https://')) return id;
  return `${base}/${id}${suffix}`;
}

export function buildCapUrl(feedId?: string): string | null {
  return resolveUrl(CAP_BASE_URL, feedId, '.xml');
}

export function buildRssUrl(feedId?: string): string | null {
  return resolveUrl(RSS_BASE_URL, feedId, '_e.xml');
}

export function buildCityApiUrl(feedId?: string): string | null {
  return resolveUrl(CITY_API_BASE_URL, feedId, '');
}

export async function fetchCapFeed(
  feedId: string | undefined,
  opts: { minFreshMs?: number; force?: boolean; offline?: boolean } = {}
): Promise<FetchResult | null> {
  const url = buildCapUrl(feedId);
  if (!url) return null;
  return fetchTextWithCache(url, opts);
}

export async function fetchRssFeed(
  feedId: string | undefined,
  opts: { minFreshMs?: number; force?: boolean; offline?: boolean } = {}
): Promise<FetchResult | null> {
  const url = buildRssUrl(feedId);
  if (!url) return null;
  return fetchTextWithCache(url, opts);
}

export async function fetchCityApi(
  feedId: string | undefined,
  opts: { minFreshMs?: number; force?: boolean; offline?: boolean } = {}
): Promise<{ data: unknown; raw_ref: string; from_cache: boolean } | null> {
  const url = buildCityApiUrl(feedId);
  if (!url) return null;
  const result = await fetchTextWithCache(url, opts);
  const data = JSON.parse(result.text);
  return {
    data,
    raw_ref: result.raw_ref,
    from_cache: result.from_cache
  };
}

