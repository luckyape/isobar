import type { AlertItem, CollectionResult, NormalizedAlert, NormalizedReadable, ReadableItem, RoutingRecord } from './types';
import { fetchCapFeed, fetchCityApi, fetchRssFeed, buildCapUrl, buildCityApiUrl, buildRssUrl } from './sources';
import {
  normalizeCapAlerts,
  normalizeStatement,
  normalizeDiscussion,
  normalizeMisc,
  normalizeForecastFromApi,
  normalizeForecastFromRss,
  normalizeMarine,
  parseAtomOrRss
} from './normalize';
import { loadAlertsForLocation, persistAlertsForLocation } from './alerts';

const ALERTS_POLL_MS = 8 * 60 * 1000;
const FEEDS_POLL_MS = 20 * 60 * 1000;

function sortByRecency<T extends { issued_at?: string; sent_at?: string }>(items: T[]): T[] {
  return items.sort((a, b) => {
    const aTime = Date.parse(a.issued_at || a.sent_at || '') || 0;
    const bTime = Date.parse(b.issued_at || b.sent_at || '') || 0;
    return bTime - aTime;
  });
}

function dedupeReadable(items: NormalizedReadable[]): NormalizedReadable[] {
  const byId = new Map<string, NormalizedReadable>();
  items.forEach((item) => {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      return;
    }
    const existingRank = existing._source_rank ?? 0;
    const nextRank = item._source_rank ?? 0;
    if (nextRank > existingRank) {
      byId.set(item.id, item);
      return;
    }
    const existingTime = Date.parse(existing.issued_at) || 0;
    const nextTime = Date.parse(item.issued_at) || 0;
    if (nextTime > existingTime) {
      byId.set(item.id, item);
    }
  });
  return Array.from(byId.values());
}

function rankReadable(items: NormalizedReadable[], routing: RoutingRecord, kindOrder: string[]): ReadableItem[] {
  const locationSet = new Set([...routing.location_keys, ...routing.area_keys]);
  const kindWeight = new Map(kindOrder.map((kind, index) => [kind, kindOrder.length - index]));

  return items
    .slice()
    .sort((a, b) => {
      const aLocation = a.location_keys.some((key) => locationSet.has(key)) ? 1 : 0;
      const bLocation = b.location_keys.some((key) => locationSet.has(key)) ? 1 : 0;
      if (aLocation !== bLocation) return bLocation - aLocation;

      const aKind = kindWeight.get(a.kind) ?? 0;
      const bKind = kindWeight.get(b.kind) ?? 0;
      if (aKind !== bKind) return bKind - aKind;

      const aTime = Date.parse(a.issued_at) || 0;
      const bTime = Date.parse(b.issued_at) || 0;
      return bTime - aTime;
    })
    .map(({ _source_rank, ...item }) => item);
}

function capItems<T>(items: T[], limit: number): T[] {
  return items.slice(0, Math.max(0, limit));
}

export async function collectAlerts(
  routing: RoutingRecord,
  opts: { offline?: boolean } = {}
): Promise<CollectionResult<AlertItem>> {
  const locationKey = routing.area_keys[0] ?? routing.location_keys[0] ?? 'unknown';
  const now = Date.now();
  const stored = loadAlertsForLocation(locationKey, now);

  if (opts.offline) {
    return { items: sortByRecency(stored), from_cache: true };
  }

  const capResult = await fetchCapFeed(routing.feed_ids.cap_alerts, {
    minFreshMs: ALERTS_POLL_MS,
    offline: opts.offline
  });
  const capUrl = buildCapUrl(routing.feed_ids.cap_alerts) ?? '';
  const parsed: NormalizedAlert[] = capResult?.text
    ? normalizeCapAlerts(capResult.text, capUrl, capResult.raw_ref, routing.area_keys)
    : [];

  const active = persistAlertsForLocation(locationKey, parsed, now);
  const fromCache = capResult?.from_cache ?? true;
  return { items: sortByRecency(active), from_cache: fromCache };
}

export async function collectUpdates(
  routing: RoutingRecord,
  opts: { offline?: boolean } = {}
): Promise<CollectionResult<ReadableItem>> {
  const updates: NormalizedReadable[] = [];
  const locationKeys = routing.location_keys.length ? routing.location_keys : routing.area_keys;

  const statementResult = await fetchRssFeed(routing.feed_ids.statements, {
    minFreshMs: FEEDS_POLL_MS,
    offline: opts.offline
  });
  const statementUrl = buildRssUrl(routing.feed_ids.statements) ?? '';
  if (statementResult?.text) {
    const items = parseAtomOrRss(statementResult.text);
    items.forEach((item) => updates.push(normalizeStatement(item, locationKeys, statementResult.raw_ref, statementUrl)));
  }

  const discussionResult = await fetchRssFeed(routing.feed_ids.discussion_rss, {
    minFreshMs: FEEDS_POLL_MS,
    offline: opts.offline
  });
  const discussionUrl = buildRssUrl(routing.feed_ids.discussion_rss) ?? '';
  if (discussionResult?.text) {
    const items = parseAtomOrRss(discussionResult.text);
    items.forEach((item) => updates.push(normalizeDiscussion(item, locationKeys, discussionResult.raw_ref, discussionUrl)));
  }

  const miscResult = await fetchRssFeed(routing.feed_ids.misc_rss, {
    minFreshMs: FEEDS_POLL_MS,
    offline: opts.offline
  });
  const miscUrl = buildRssUrl(routing.feed_ids.misc_rss) ?? '';
  if (miscResult?.text) {
    const items = parseAtomOrRss(miscResult.text);
    items.forEach((item) => updates.push(normalizeMisc(item, locationKeys, miscResult.raw_ref, miscUrl)));
  }

  const ranked = rankReadable(dedupeReadable(updates), routing, ['statement', 'discussion', 'misc_official']);
  return {
    items: capItems(ranked, 8),
    from_cache: Boolean(statementResult?.from_cache && discussionResult?.from_cache && miscResult?.from_cache)
  };
}

export async function collectForecast(
  routing: RoutingRecord,
  opts: { offline?: boolean } = {}
): Promise<CollectionResult<ReadableItem>> {
  const locationKeys = routing.location_keys.length ? routing.location_keys : routing.area_keys;
  const items: NormalizedReadable[] = [];

  const apiResult = await fetchCityApi(routing.feed_ids.forecast_api ?? routing.feed_ids.conditions_api, {
    minFreshMs: FEEDS_POLL_MS,
    offline: opts.offline
  });
  const apiUrl = buildCityApiUrl(routing.feed_ids.forecast_api ?? routing.feed_ids.conditions_api) ?? '';
  if (apiResult?.data) {
    items.push(...normalizeForecastFromApi(apiResult.data, locationKeys, apiResult.raw_ref, apiUrl));
  }

  if (items.length === 0) {
    const rssResult = await fetchRssFeed(routing.feed_ids.forecast_rss, {
      minFreshMs: FEEDS_POLL_MS,
      offline: opts.offline
    });
    const rssUrl = buildRssUrl(routing.feed_ids.forecast_rss) ?? '';
    if (rssResult?.text) {
      const entries = parseAtomOrRss(rssResult.text);
      entries.forEach((entry) => items.push(normalizeForecastFromRss(entry, locationKeys, rssResult.raw_ref, rssUrl)));
    }
  }

  const ranked = rankReadable(dedupeReadable(items), routing, ['forecast_text', 'conditions_text']);
  return {
    items: capItems(ranked, 6),
    from_cache: Boolean(apiResult?.from_cache)
  };
}

export async function collectMarine(
  routing: RoutingRecord,
  opts: { offline?: boolean } = {}
): Promise<CollectionResult<ReadableItem>> {
  if (!routing.feed_ids.marine_rss && !routing.marine_relevance) {
    return { items: [], from_cache: true };
  }
  const locationKeys = routing.location_keys.length ? routing.location_keys : routing.area_keys;
  const items: NormalizedReadable[] = [];
  const marineResult = await fetchRssFeed(routing.feed_ids.marine_rss, {
    minFreshMs: FEEDS_POLL_MS,
    offline: opts.offline
  });
  const marineUrl = buildRssUrl(routing.feed_ids.marine_rss) ?? '';
  if (marineResult?.text) {
    const entries = parseAtomOrRss(marineResult.text);
    entries.forEach((entry) => items.push(normalizeMarine(entry, locationKeys, marineResult.raw_ref, marineUrl)));
  }

  const ranked = rankReadable(dedupeReadable(items), routing, ['marine']);
  return { items: capItems(ranked, 6), from_cache: marineResult?.from_cache ?? true };
}

export async function collectNotes(
  routing: RoutingRecord,
  opts: { offline?: boolean } = {}
): Promise<CollectionResult<ReadableItem>> {
  const locationKeys = routing.location_keys.length ? routing.location_keys : routing.area_keys;
  const items: NormalizedReadable[] = [];
  const discussionResult = await fetchRssFeed(routing.feed_ids.discussion_rss, {
    minFreshMs: FEEDS_POLL_MS,
    offline: opts.offline
  });
  const discussionUrl = buildRssUrl(routing.feed_ids.discussion_rss) ?? '';
  if (discussionResult?.text) {
    const entries = parseAtomOrRss(discussionResult.text);
    entries.forEach((entry) => items.push(normalizeDiscussion(entry, locationKeys, discussionResult.raw_ref, discussionUrl)));
  }
  const ranked = rankReadable(dedupeReadable(items), routing, ['discussion']);
  return { items: capItems(ranked, 6), from_cache: discussionResult?.from_cache ?? true };
}
