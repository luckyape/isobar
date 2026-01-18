import type { AlertItem, NormalizedAlert } from './types';

export type StoredAlert = AlertItem & {
  _canceled?: boolean;
};

type AlertStore = {
  version: 1;
  by_location: Record<string, StoredAlert[]>;
};

const ALERT_STORE_KEY = 'eccc-alerts-v1';

function canUseStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function loadStore(): AlertStore {
  if (!canUseStorage()) return { version: 1, by_location: {} };
  try {
    const raw = window.localStorage.getItem(ALERT_STORE_KEY);
    if (!raw) return { version: 1, by_location: {} };
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || typeof parsed?.by_location !== 'object') {
      return { version: 1, by_location: {} };
    }
    return parsed as AlertStore;
  } catch {
    return { version: 1, by_location: {} };
  }
}

function saveStore(store: AlertStore): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(ALERT_STORE_KEY, JSON.stringify(store));
  } catch {
    // ignore storage write failures
  }
}

function toEpoch(value?: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function alertChainKey(alert: NormalizedAlert): string {
  if (alert.references && alert.references.length > 0) {
    return alert.references[0];
  }
  if (alert.cap_identifier) {
    return alert.cap_identifier;
  }
  const area = alert.area_key ?? alert.location_keys[0] ?? 'unknown';
  return `${alert.event}:${area}`;
}

function markCanceled(targets: Map<string, StoredAlert>, chainKey: string): void {
  const existing = targets.get(chainKey);
  if (existing) {
    existing._canceled = true;
    targets.set(chainKey, existing);
  }
}

export function mergeAlertChain(
  incoming: NormalizedAlert[],
  existing: StoredAlert[] = []
): StoredAlert[] {
  const byChain = new Map<string, StoredAlert>();

  existing.forEach((alert) => {
    const key = alertChainKey(alert);
    byChain.set(key, { ...alert });
  });

  incoming.forEach((alert) => {
    const key = alertChainKey(alert);
    if (alert.msg_type === 'Cancel') {
      markCanceled(byChain, key);
      return;
    }

    const prior = byChain.get(key);
    if (!prior) {
      byChain.set(key, { ...alert });
      return;
    }

    const priorTime = toEpoch(prior.sent_at);
    const nextTime = toEpoch(alert.sent_at);
    if (nextTime >= priorTime) {
      byChain.set(key, { ...alert });
    }
  });

  return Array.from(byChain.values());
}

export function filterActiveAlerts(alerts: StoredAlert[], nowMs: number): StoredAlert[] {
  return alerts.filter((alert) => {
    if (alert._canceled) return false;
    const expiresAt = toEpoch(alert.expires);
    if (!expiresAt) return true;
    return expiresAt > nowMs;
  });
}

export function loadAlertsForLocation(locationKey: string, nowMs: number): StoredAlert[] {
  const store = loadStore();
  const items = store.by_location[locationKey] ?? [];
  return filterActiveAlerts(items, nowMs);
}

export function persistAlertsForLocation(
  locationKey: string,
  incoming: NormalizedAlert[],
  nowMs: number
): StoredAlert[] {
  const store = loadStore();
  const existing = store.by_location[locationKey] ?? [];
  const merged = mergeAlertChain(incoming, existing);
  const pruned = merged.filter((alert) => {
    const expiresAt = toEpoch(alert.expires);
    return !expiresAt || expiresAt > nowMs || alert._canceled;
  });
  store.by_location[locationKey] = pruned;
  saveStore(store);
  return filterActiveAlerts(pruned, nowMs);
}

export function pruneExpiredAlerts(locationKey: string, nowMs: number): void {
  const store = loadStore();
  const existing = store.by_location[locationKey] ?? [];
  const next = existing.filter((alert) => {
    const expiresAt = toEpoch(alert.expires);
    return !expiresAt || expiresAt > nowMs;
  });
  store.by_location[locationKey] = next;
  saveStore(store);
}
