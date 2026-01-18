import { useState, useEffect, useRef, useCallback } from 'react';
import {
    loadAlertsForLocation,
    persistAlertsForLocation,
    pruneExpiredAlerts,
    type StoredAlert
} from '@/lib/eccc/alerts';
import type { NormalizedAlert } from '@/lib/eccc/types';
import { getCdnBaseUrl } from '@/lib/config';

// Debug flag helper
function getDebugFakeAlertParams() {
    if (typeof window === 'undefined') return null;
    const search = new URLSearchParams(window.location.search);
    const countStr = search.get('debugEcccFakeAlert');
    if (!countStr) return null;

    const count = parseInt(countStr, 10);
    return {
        count: isNaN(count) ? 1 : Math.max(1, count),
        expiresSeconds: parseInt(search.get('expires') || '300', 10) // bump default to 5m for testing
    };
}

export type UseEcccAlertsResult = {
    alerts: StoredAlert[];
    newAlerts: StoredAlert[]; // Only emitted on change/fetch
    lastUpdated: number;
};

export function useEcccAlerts(
    locationKey: string | null,
    incomingAlerts?: NormalizedAlert[]
): UseEcccAlertsResult {
    const [alerts, setAlerts] = useState<StoredAlert[]>([]);
    const [newAlerts, setNewAlerts] = useState<StoredAlert[]>([]);
    const [lastUpdated, setLastUpdated] = useState(Date.now());
    const prevAlertsRef = useRef<Set<string>>(new Set());

    // Initial load from storage
    useEffect(() => {
        if (!locationKey) {
            setAlerts([]);
            setNewAlerts([]);
            return;
        }

        const load = () => {
            const now = Date.now();
            pruneExpiredAlerts(locationKey, now);
            const stored = loadAlertsForLocation(locationKey, now);
            setAlerts(stored);
            // Initialize known IDs so we don't treat existing stored alerts as "new" on first load
            // (unless we specifically want to notify on page refresh, but usually not)
            prevAlertsRef.current = new Set(stored.map(a => a.id));
        };

        load();
    }, [locationKey]);

    // Handle incoming data (from fetch)
    useEffect(() => {
        if (!locationKey || !incomingAlerts) return;

        const now = Date.now();

        // Inject fake alerts if debug flag is present
        const debugParams = getDebugFakeAlertParams();
        let effectiveIncoming = incomingAlerts;

        if (debugParams) {
            const fakes: NormalizedAlert[] = [];
            const severities = ['Extreme', 'Severe', 'Moderate', 'Minor'];
            const events = ['Tornado Warning', 'Severe Thunderstorm Watch', 'Heat Warning', 'Air Quality Statement'];

            for (let i = 0; i < debugParams.count; i++) {
                const fakeId = `debug-fake-alert-${i + 1}`;
                fakes.push({
                    id: fakeId,
                    authority: 'ECCC',
                    kind: 'alert',
                    location_keys: [locationKey],
                    sent_at: new Date().toISOString(),
                    expires: new Date(now + debugParams.expiresSeconds * 1000).toISOString(),
                    msg_type: 'Alert',
                    status: 'Actual',
                    severity: severities[i % severities.length],
                    event: events[i % events.length],
                    headline: `Debug Test Alert ${i + 1}`,
                    description: `This is generated test alert #${i + 1} for debugging purposes. It has ${severities[i % severities.length]} severity.`,
                    source_url: '',
                    raw_ref: ''
                });
            }
            effectiveIncoming = [...incomingAlerts, ...fakes];
        }

        // Persist and merge
        const currentStored = persistAlertsForLocation(locationKey, effectiveIncoming, now);

        // Diff for new alerts
        const newlyAdded: StoredAlert[] = [];
        const currentIds = new Set<string>();

        currentStored.forEach(alert => {
            currentIds.add(alert.id);
            if (!prevAlertsRef.current.has(alert.id)) {
                newlyAdded.push(alert);
            }
        });

        // Update state
        setAlerts(currentStored);
        prevAlertsRef.current = currentIds;
        setLastUpdated(now);

        // Emit new alerts if any found
        if (newlyAdded.length > 0) {
            setNewAlerts(newlyAdded);
        }
    }, [locationKey, incomingAlerts]);

    // Optional: Periodic prune (coarse, e.g., every minute)
    useEffect(() => {
        if (!locationKey) return;
        const interval = setInterval(() => {
            const now = Date.now();
            const stored = loadAlertsForLocation(locationKey, now);
            // Only update state if something changed (length difference)
            // This is a simple heuristic; strictly we should check IDs.
            setAlerts(prev => {
                if (prev.length !== stored.length) return stored;
                return prev;
            });
            // We don't emit newAlerts on prune
        }, 60000);
        return () => clearInterval(interval);
    }, [locationKey]);

    return { alerts, newAlerts, lastUpdated };
}
