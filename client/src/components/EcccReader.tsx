import React, { useEffect, useMemo, useState } from 'react';
import type { Location } from '@/lib/weatherTypes';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fetchTextWithCache } from '@/lib/eccc/cache';
import { deriveTags } from '@/lib/eccc/tags';
import { loadAlertsForLocation, persistAlertsForLocation, pruneExpiredAlerts } from '@/lib/eccc/alerts';
import type { AlertItem, ReadableItem } from '@/lib/eccc/types';
import { getCdnBaseUrl } from '@/lib/config';

type Props = {
  location: Location | null;
};

type ReaderState = {
  alerts: AlertItem[];
  updates: ReadableItem[];
  forecast: ReadableItem[];
  loading: boolean;
};

const ECCC_LOCATION_URL = `${getCdnBaseUrl()}/api/eccc/location`;
const ECCC_CACHE_MS = 20 * 60 * 1000;

function stableId(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function toIso(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function parseLocationState(html: string): Record<string, any> | null {
  const match = html.match(/window.__INITIAL_STATE__=(\{.*?\});/s);
  if (!match) return null;
  const state = JSON.parse(match[1]) as Record<string, any>;
  const locationMap = state?.location?.location;
  if (!locationMap || typeof locationMap !== 'object') return null;
  const firstKey = Object.keys(locationMap)[0];
  if (!firstKey) return null;
  return locationMap[firstKey] as Record<string, any>;
}

function buildExcerpt(text: string, limit = 180): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit).replace(/\s+\S*$/, '')}...`;
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatIssued(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function buildConditionsText(obs: Record<string, any>): string {
  const condition = obs?.condition ?? '';
  const temp = obs?.temperature?.metric ?? obs?.temperature?.imperial ?? '';
  const windDir = obs?.windDirection ?? '';
  const windSpeed = obs?.windSpeed?.metric ?? obs?.windSpeed?.imperial ?? '';
  const parts = [];
  if (condition) parts.push(condition);
  if (temp) parts.push(`Temperature ${temp} C`);
  if (windDir && windSpeed) parts.push(`Wind ${windDir} ${windSpeed} km/h`);
  return parts.join('. ');
}

function buildForecastItems(
  forecast: Record<string, any>,
  locationKey: string,
  sourceUrl: string,
  rawRef: string
): ReadableItem[] {
  const issuedAt = forecast?.dailyIssuedTimeEpoch
    ? toIso(Number(forecast.dailyIssuedTimeEpoch))
    : forecast?.dailyIssuedTime
      ? toIso(forecast.dailyIssuedTime)
      : new Date().toISOString();

  const entries = Array.isArray(forecast?.daily) ? forecast.daily : [];
  return entries
    .map((entry: Record<string, any>) => {
      const title = entry?.titleText ?? entry?.summary ?? 'Forecast';
      const body = stripHtml(entry?.text ?? entry?.summary ?? '');
      if (!body) return null;
      return {
        id: stableId(`ECCC|forecast|${issuedAt}|${title}`),
        authority: 'ECCC',
        kind: 'forecast_text',
        location_keys: [locationKey],
        issued_at: issuedAt,
        title,
        body_text: body.trim(),
        source_url: sourceUrl,
        raw_ref: rawRef,
        tags: deriveTags(`${title} ${body}`.trim())
      } as ReadableItem;
    })
    .filter(Boolean) as ReadableItem[];
}

function buildConditionsItem(
  obs: Record<string, any>,
  locationKey: string,
  sourceUrl: string,
  rawRef: string
): ReadableItem | null {
  if (!obs) return null;
  const issuedAt = obs?.timeStamp ? toIso(obs.timeStamp) : new Date().toISOString();
  const body = buildConditionsText(obs);
  if (!body) return null;
  return {
    id: stableId(`ECCC|conditions|${issuedAt}`),
    authority: 'ECCC',
    kind: 'conditions_text',
    location_keys: [locationKey],
    issued_at: issuedAt,
    title: 'Current conditions',
    body_text: body,
    source_url: sourceUrl,
    raw_ref: rawRef,
    tags: deriveTags(body)
  };
}

function buildNotesItems(
  notes: unknown,
  locationKey: string,
  sourceUrl: string,
  rawRef: string
): ReadableItem[] {
  if (!Array.isArray(notes)) return [];
  return notes
    .map((note: Record<string, any>) => {
      const title = note?.title ?? note?.titleText ?? note?.heading ?? 'Notes';
      const body = stripHtml(note?.text ?? note?.textSummary ?? note?.summary ?? note?.body ?? '');
      if (!body) return null;
      const issuedAt = note?.issuedTime || note?.issuedAt || note?.dateTime || new Date().toISOString();
      return {
        id: stableId(`ECCC|notes|${issuedAt}|${title}`),
        authority: 'ECCC',
        kind: 'discussion',
        location_keys: [locationKey],
        issued_at: toIso(issuedAt),
        title,
        body_text: body.trim(),
        source_url: sourceUrl,
        raw_ref: rawRef,
        tags: deriveTags(`${title} ${body}`.trim())
      } as ReadableItem;
    })
    .filter(Boolean) as ReadableItem[];
}

function buildAlertItems(
  alerts: unknown,
  locationKey: string,
  sourceUrl: string,
  rawRef: string
): AlertItem[] {
  if (!Array.isArray(alerts)) return [];
  return alerts
    .map((alert: Record<string, any>) => {
      const headline =
        alert?.headline ??
        alert?.title ??
        alert?.titleText ??
        alert?.event ??
        alert?.type ??
        '';
      const description = stripHtml(alert?.description ?? alert?.text ?? alert?.summary ?? '');
      if (!headline && !description) return null;
      const headlineLower = String(headline).toLowerCase();
      if (headlineLower.includes('no watches') && headlineLower.includes('warnings')) return null;

      const sentAt = alert?.issuedTime || alert?.issuedAt || alert?.sent || alert?.dateTime;
      const expires = alert?.expires || alert?.expiry || alert?.end || sentAt || new Date().toISOString();

      return {
        id: stableId(`ECCC|alert|${sentAt}|${headline}`),
        authority: 'ECCC',
        kind: 'alert',
        location_keys: [locationKey],
        sent_at: toIso(sentAt ?? new Date().toISOString()),
        effective: alert?.effective ? toIso(alert.effective) : undefined,
        onset: alert?.onset ? toIso(alert.onset) : undefined,
        expires: toIso(expires),
        msg_type: (alert?.msgType ?? 'Alert') as AlertItem['msg_type'],
        status: (alert?.status ?? 'Actual') as AlertItem['status'],
        event: alert?.event ?? alert?.type ?? 'Alert',
        severity: alert?.severity ?? undefined,
        urgency: alert?.urgency ?? undefined,
        certainty: alert?.certainty ?? undefined,
        headline: headline || undefined,
        description: description || undefined,
        instruction: alert?.instruction ?? alert?.instructions ?? undefined,
        source_url: alert?.url ?? sourceUrl,
        raw_ref: rawRef
      } as AlertItem;
    })
    .filter(Boolean) as AlertItem[];
}

export function EcccReader({ location }: Props) {
  const isCanadian = !location || !location.country || location.country === 'Canada';

  const [state, setState] = useState<ReaderState>({
    alerts: [],
    updates: [],
    forecast: [],
    loading: false
  });

  const locationKey = useMemo(() => {
    if (!location) return null;
    const lat = location.latitude.toFixed(4);
    const lon = location.longitude.toFixed(4);
    return `${lat}|${lon}`;
  }, [location]);

  useEffect(() => {
    let canceled = false;
    async function load() {
      if (!isCanadian) return;
      if (!location || !locationKey) return;
      if (typeof window === 'undefined') return;

      setState((prev) => ({ ...prev, loading: true }));

      const url = `${ECCC_LOCATION_URL}?coords=${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
      const offline = typeof navigator !== 'undefined' && !navigator.onLine;
      const now = Date.now();
      pruneExpiredAlerts(locationKey, now);

      try {
        const result = await fetchTextWithCache(url, {
          minFreshMs: ECCC_CACHE_MS,
          offline
        });
        const parsed = parseLocationState(result.text);
        if (!parsed) {
          if (!canceled) setState((prev) => ({ ...prev, loading: false }));
          return;
        }

        const forecastItems = buildForecastItems(parsed.forecast, locationKey, url, result.raw_ref);
        const conditionsItem = buildConditionsItem(parsed.obs, locationKey, url, result.raw_ref);
        const notesItems = buildNotesItems(parsed.metNotes, locationKey, url, result.raw_ref);
        const incomingAlerts = buildAlertItems(parsed.alerts, locationKey, url, result.raw_ref);

        const persisted = incomingAlerts.length
          ? persistAlertsForLocation(locationKey, incomingAlerts, now)
          : loadAlertsForLocation(locationKey, now);

        const updates = notesItems.slice(0, 6);
        const forecast = [
          ...(conditionsItem ? [conditionsItem] : []),
          ...forecastItems
        ].slice(0, 6);

        if (!canceled) {
          setState({
            alerts: persisted,
            updates,
            forecast,
            loading: false
          });
        }
      } catch {
        if (!canceled) {
          setState((prev) => ({
            alerts: locationKey ? loadAlertsForLocation(locationKey, now) : prev.alerts,
            updates: prev.updates,
            forecast: prev.forecast,
            loading: false
          }));
        }
      }
    }

    load();
    return () => {
      canceled = true;
    };
  }, [isCanadian, location, locationKey]);

  if (!isCanadian) return null;

  return (
    <aside
      aria-label="ECCC Reader"
      className="hidden lg:block max-w-[520px] mt-10"
    >
      <section className="bg-white/[0.03] border border-white/10 rounded-xl p-4">
        <header className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] tracking-[0.22em] font-medium text-foreground/70">
              ECCC Reader
            </div>
            <div className="text-xs text-foreground/60">
              Environment and Climate Change Canada
            </div>
          </div>
          <div className="text-[11px] text-foreground/60 whitespace-nowrap">
            {location?.name ?? ''}
          </div>
        </header>

        <Tabs defaultValue="updates" className="mt-3 gap-3">
          <TabsList className="w-full grid grid-cols-2 gap-1 bg-white/[0.04] border border-white/10">
            <TabsTrigger value="updates" className="text-xs">
              Updates
            </TabsTrigger>
            <TabsTrigger value="forecast" className="text-xs">
              Forecast
            </TabsTrigger>
          </TabsList>

          <TabsContent value="updates" className="min-h-[180px]">
            <div className="mt-3 grid gap-3">
              {state.alerts.map((alert) => (
                <article
                  key={alert.id}
                  className="rounded-lg border border-white/10 bg-white/[0.04] p-3"
                >
                  <div className="text-xs font-semibold text-foreground">
                    {alert.headline || alert.event}
                  </div>
                  <div className="mt-1 text-[11px] text-foreground/60">
                    {alert.sent_at ? `Issued ${formatIssued(alert.sent_at)}` : ''}
                  </div>
                  <p className="mt-2 text-xs text-foreground/80 line-clamp-2">
                    {buildExcerpt(alert.description || alert.instruction || alert.event)}
                  </p>
                  {alert.source_url && (
                    <a
                      className="mt-2 inline-flex text-[11px] text-foreground/60 underline underline-offset-2 hover:text-foreground"
                      href={alert.source_url}
                      target="_blank"
                      rel="noopener"
                    >
                      Open source
                    </a>
                  )}
                </article>
              ))}
              {state.updates.map((item) => (
                <article
                  key={item.id}
                  className="rounded-lg border border-white/10 bg-white/[0.04] p-3"
                >
                  <div className="text-xs font-semibold text-foreground">
                    {item.title}
                  </div>
                  <div className="mt-1 text-[11px] text-foreground/60">
                    {item.issued_at ? `Issued ${formatIssued(item.issued_at)}` : ''}
                  </div>
                  <p className="mt-2 text-xs text-foreground/80 line-clamp-2">
                    {buildExcerpt(item.body_text)}
                  </p>
                  <a
                    className="mt-2 inline-flex text-[11px] text-foreground/60 underline underline-offset-2 hover:text-foreground"
                    href={item.source_url}
                    target="_blank"
                    rel="noopener"
                  >
                    Open source
                  </a>
                </article>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="forecast" className="min-h-[180px]">
            <div className="mt-3 grid gap-3">
              {state.forecast.map((item) => (
                <article
                  key={item.id}
                  className="rounded-lg border border-white/10 bg-white/[0.04] p-3"
                >
                  <div className="text-xs font-semibold text-foreground">
                    {item.title}
                  </div>
                  <div className="mt-1 text-[11px] text-foreground/60">
                    {item.issued_at ? `Issued ${formatIssued(item.issued_at)}` : ''}
                  </div>
                  <p className="mt-2 text-xs text-foreground/80 line-clamp-2">
                    {buildExcerpt(item.body_text)}
                  </p>
                  <a
                    className="mt-2 inline-flex text-[11px] text-foreground/60 underline underline-offset-2 hover:text-foreground"
                    href={item.source_url}
                    target="_blank"
                    rel="noopener"
                  >
                    Open source
                  </a>
                </article>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </section>
    </aside>
  );
}
