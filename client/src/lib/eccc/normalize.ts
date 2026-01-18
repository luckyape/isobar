import type { AlertItem, NormalizedAlert, NormalizedReadable, ReadableItem, ReadableKind } from './types';
import { deriveTags } from './tags';

type FeedItem = {
  id: string;
  title: string;
  updated?: string;
  published?: string;
  link?: string;
  summary?: string;
  content?: string;
};

function parseXml(xml: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(xml, 'text/xml');
}

function textFrom(node: Element | null, selector: string): string | null {
  if (!node) return null;
  const el = node.querySelector(selector);
  if (!el) return null;
  const text = el.textContent?.trim();
  return text && text.length > 0 ? text : null;
}

function stripHtml(input: string): string {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = input;
  return wrapper.textContent?.trim() || '';
}

function normalizeText(input: string | null | undefined): string {
  const text = input ?? '';
  return text.replace(/\s+/g, ' ').trim();
}

function pickInfo(alert: Element): Element | null {
  const infos = Array.from(alert.getElementsByTagName('info'));
  if (infos.length === 0) return null;
  const preferred = infos.find((info) => {
    const lang = info.querySelector('language')?.textContent?.trim();
    return lang === 'en-CA' || lang === 'en';
  });
  return preferred ?? infos[0];
}

function parseCapReferences(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/\s+/)
    .flatMap((chunk) => chunk.split(','))
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(',')[0]);
}

function buildReadable(
  kind: ReadableKind,
  sourceId: string,
  issuedAt: string,
  title: string,
  body: string,
  sourceUrl: string,
  rawRef: string,
  locationKeys: string[],
  sourceRank: number
): NormalizedReadable {
  const id = stableId(`ECCC|${sourceId}|${issuedAt}|${title}`);
  const cleanTitle = normalizeText(title);
  const cleanBody = normalizeText(body);
  const tagSource = `${cleanTitle} ${cleanBody}`.trim();
  return {
    id,
    authority: 'ECCC',
    kind,
    location_keys: locationKeys,
    issued_at: issuedAt,
    title: cleanTitle,
    body_text: cleanBody,
    source_url: sourceUrl,
    raw_ref: rawRef,
    tags: tagSource ? deriveTags(tagSource) : [],
    _source_rank: sourceRank
  };
}

function stableId(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function parseAtomOrRss(xml: string): FeedItem[] {
  const doc = parseXml(xml);
  const entries = Array.from(doc.getElementsByTagName('entry'));
  const items = entries.length > 0 ? entries : Array.from(doc.getElementsByTagName('item'));

  return items.map((item) => {
    const title = textFrom(item, 'title') ?? '';
    const id = textFrom(item, 'id') ?? textFrom(item, 'guid') ?? title;
    const updated = textFrom(item, 'updated') ?? textFrom(item, 'pubDate') ?? undefined;
    const published = textFrom(item, 'published') ?? undefined;
    const linkEl = item.querySelector('link');
    const link = linkEl?.getAttribute('href') ?? textFrom(item, 'link') ?? undefined;
    const summaryRaw = textFrom(item, 'summary') ?? textFrom(item, 'description') ?? null;
    const contentRaw = textFrom(item, 'content') ?? null;

    const summary = summaryRaw ? stripHtml(summaryRaw) : undefined;
    const content = contentRaw ? stripHtml(contentRaw) : undefined;

    return {
      id,
      title,
      updated,
      published,
      link,
      summary,
      content
    };
  });
}

export function normalizeStatement(
  item: FeedItem,
  locationKeys: string[],
  rawRef: string,
  sourceUrl: string
): NormalizedReadable {
  const issuedAt = item.updated || item.published || new Date().toISOString();
  const body = item.content || item.summary || '';
  return buildReadable('statement', item.id, issuedAt, item.title, body, sourceUrl, rawRef, locationKeys, 2);
}

export function normalizeDiscussion(
  item: FeedItem,
  locationKeys: string[],
  rawRef: string,
  sourceUrl: string
): NormalizedReadable {
  const issuedAt = item.updated || item.published || new Date().toISOString();
  const body = item.content || item.summary || '';
  return buildReadable('discussion', item.id, issuedAt, item.title, body, sourceUrl, rawRef, locationKeys, 2);
}

export function normalizeMisc(
  item: FeedItem,
  locationKeys: string[],
  rawRef: string,
  sourceUrl: string
): NormalizedReadable {
  const issuedAt = item.updated || item.published || new Date().toISOString();
  const body = item.content || item.summary || '';
  return buildReadable('misc_official', item.id, issuedAt, item.title, body, sourceUrl, rawRef, locationKeys, 2);
}

export function normalizeMarine(
  item: FeedItem,
  locationKeys: string[],
  rawRef: string,
  sourceUrl: string
): NormalizedReadable {
  const issuedAt = item.updated || item.published || new Date().toISOString();
  const body = item.content || item.summary || '';
  return buildReadable('marine', item.id, issuedAt, item.title, body, sourceUrl, rawRef, locationKeys, 2);
}

export function normalizeForecastFromApi(
  payload: unknown,
  locationKeys: string[],
  rawRef: string,
  sourceUrl: string
): NormalizedReadable[] {
  const items: NormalizedReadable[] = [];
  const data = payload as Record<string, any>;
  const issuedAt = data?.forecastGroup?.issuedAt
    ?? data?.forecastGroup?.dateTime
    ?? data?.dateTime?.[0]?.timeStamp
    ?? new Date().toISOString();

  const forecasts = Array.isArray(data?.forecastGroup?.forecast)
    ? data.forecastGroup.forecast
    : [];

  for (const forecast of forecasts) {
    const title = forecast?.period ?? 'Forecast';
    const body = forecast?.textSummary ?? forecast?.text ?? '';
    if (!body) continue;
    items.push(
      buildReadable(
        'forecast_text',
        `${issuedAt}:${title}`,
        issuedAt,
        title,
        body,
        sourceUrl,
        rawRef,
        locationKeys,
        3
      )
    );
  }

  const conditionsText = data?.currentConditions?.textSummary ?? data?.currentConditions?.comment ?? null;
  if (conditionsText) {
    items.push(
      buildReadable(
        'conditions_text',
        `${issuedAt}:conditions`,
        issuedAt,
        'Current conditions',
        conditionsText,
        sourceUrl,
        rawRef,
        locationKeys,
        3
      )
    );
  }

  return items;
}

export function normalizeForecastFromRss(
  item: FeedItem,
  locationKeys: string[],
  rawRef: string,
  sourceUrl: string
): NormalizedReadable {
  const issuedAt = item.updated || item.published || new Date().toISOString();
  const body = item.content || item.summary || '';
  return buildReadable('forecast_text', item.id, issuedAt, item.title, body, sourceUrl, rawRef, locationKeys, 2);
}

export function normalizeConditionsFromApi(
  payload: unknown,
  locationKeys: string[],
  rawRef: string,
  sourceUrl: string
): NormalizedReadable | null {
  const data = payload as Record<string, any>;
  const issuedAt = data?.dateTime?.[0]?.timeStamp ?? new Date().toISOString();
  const text = data?.currentConditions?.textSummary ?? data?.currentConditions?.comment ?? null;
  if (!text) return null;
  return buildReadable(
    'conditions_text',
    `${issuedAt}:conditions`,
    issuedAt,
    'Current conditions',
    text,
    sourceUrl,
    rawRef,
    locationKeys,
    3
  );
}

export function normalizeCapAlerts(
  xml: string,
  sourceUrl: string,
  rawRef: string,
  locationFallback: string[]
): NormalizedAlert[] {
  const doc = parseXml(xml);
  const alerts = Array.from(doc.getElementsByTagName('alert'));

  return alerts.map((alert) => {
    const info = pickInfo(alert);
    const identifier = textFrom(alert, 'identifier') ?? 'unknown';
    const sent = textFrom(alert, 'sent') ?? new Date().toISOString();
    const status = textFrom(alert, 'status') ?? 'Actual';
    const msgType = textFrom(alert, 'msgType') ?? 'Alert';
    const references = parseCapReferences(textFrom(alert, 'references'));

    const event = info ? textFrom(info, 'event') ?? 'Alert' : 'Alert';
    const severity = info ? textFrom(info, 'severity') ?? undefined : undefined;
    const urgency = info ? textFrom(info, 'urgency') ?? undefined : undefined;
    const certainty = info ? textFrom(info, 'certainty') ?? undefined : undefined;
    const headline = info ? textFrom(info, 'headline') ?? undefined : undefined;
    const description = info ? textFrom(info, 'description') ?? undefined : undefined;
    const instruction = info ? textFrom(info, 'instruction') ?? undefined : undefined;
    const effective = info ? textFrom(info, 'effective') ?? undefined : undefined;
    const onset = info ? textFrom(info, 'onset') ?? undefined : undefined;
    const expires = info ? textFrom(info, 'expires') ?? undefined : undefined;

    const areaNodes = info ? Array.from(info.getElementsByTagName('area')) : [];
    const areaDesc = areaNodes[0]?.querySelector('areaDesc')?.textContent?.trim();
    const geocodes = areaNodes.flatMap((area) =>
      Array.from(area.getElementsByTagName('geocode')).map((geo) =>
        geo.querySelector('value')?.textContent?.trim() || ''
      )
    ).filter(Boolean);

    const locationKeys = geocodes.length > 0 ? geocodes : areaDesc ? [areaDesc] : locationFallback;
    const areaKey = locationKeys[0] ?? 'unknown';
    const id = stableId(`${identifier}:${areaKey}`);

    const result: AlertItem = {
      id,
      authority: 'ECCC',
      kind: 'alert',
      location_keys: locationKeys,
      sent_at: sent,
      effective: effective ?? undefined,
      onset: onset ?? undefined,
      expires: expires ?? sent,
      msg_type: msgType as AlertItem['msg_type'],
      status,
      event,
      severity: severity ?? undefined,
      urgency: urgency ?? undefined,
      certainty: certainty ?? undefined,
      headline: headline ?? undefined,
      description: description ?? undefined,
      instruction: instruction ?? undefined,
      source_url: sourceUrl,
      raw_ref: rawRef
    };

    return {
      ...result,
      cap_identifier: identifier,
      references,
      area_key: areaKey
    };
  });
}
