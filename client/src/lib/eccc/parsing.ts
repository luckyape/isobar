import type { ReadableItem, AlertItem } from './types';
import { deriveTags } from './tags';

export function stableId(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
        hash = (hash << 5) - hash + input.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}

export function toIso(value: unknown): string {
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

export function parseLocationState(html: string): Record<string, any> | null {
    // Regex updated to avoid /s flag for broader compatibility (using [\s\S] instead of dotAll)
    const match = html.match(/window.__INITIAL_STATE__=(\{[\s\S]*?\});/);
    if (!match) return null;
    const state = JSON.parse(match[1]) as Record<string, any>;
    const locationMap = state?.location?.location;
    if (!locationMap || typeof locationMap !== 'object') return null;
    const firstKey = Object.keys(locationMap)[0];
    if (!firstKey) return null;
    return locationMap[firstKey] as Record<string, any>;
}

export function buildExcerpt(text: string, limit = 180): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length <= limit) return clean;
    return `${clean.slice(0, limit).replace(/\s+\S*$/, '')}...`;
}

export function stripHtml(input: string): string {
    return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function formatIssued(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: '2-digit'
    }).format(date);
}

export function buildConditionsText(obs: Record<string, any>): string {
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

export function buildForecastItems(
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

export function buildConditionsItem(
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

export function buildNotesItems(
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

export function buildAlertItems(
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
