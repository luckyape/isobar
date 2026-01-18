import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Location } from '@/lib/weatherTypes';
import { fetchTextWithCache } from '@/lib/eccc/cache';
import { useEcccAlerts } from './useEcccAlerts';
import type { ReadableItem, AlertItem } from '@/lib/eccc/types';
import { getCdnBaseUrl } from '@/lib/config';

// Import parsing logic
import {
    parseLocationState,
    buildForecastItems,
    buildConditionsItem,
    buildNotesItems,
    buildAlertItems
} from '@/lib/eccc/parsing';

export type EcccDataState = {
    alerts: AlertItem[];
    newAlerts: AlertItem[];
    updates: ReadableItem[];
    forecast: ReadableItem[];
    loading: boolean;
    error: Error | null;
    lastUpdated: number;
    refresh: () => Promise<void>;
};

const ECCC_LOCATION_URL = `${getCdnBaseUrl()}/api/eccc/location`;
const ECCC_CACHE_MS = 20 * 60 * 1000;

export function useEcccData(location: Location | null): EcccDataState {
    const [updates, setUpdates] = useState<ReadableItem[]>([]);
    const [forecast, setForecast] = useState<ReadableItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [incomingAlerts, setIncomingAlerts] = useState<import('@/lib/eccc/types').NormalizedAlert[] | undefined>(undefined);

    const locationKey = useMemo(() => {
        if (!location) return null;
        const lat = location.latitude.toFixed(4);
        const lon = location.longitude.toFixed(4);
        return `${lat}|${lon}`;
    }, [location]);

    const { alerts, newAlerts, lastUpdated } = useEcccAlerts(locationKey, incomingAlerts);

    const fetchData = useCallback(async () => {
        if (!location || !locationKey) return;

        setLoading(true);
        setError(null);
        setIncomingAlerts(undefined);

        try {
            const url = `${ECCC_LOCATION_URL}?coords=${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
            const offline = typeof navigator !== 'undefined' && !navigator.onLine;

            const result = await fetchTextWithCache(url, {
                minFreshMs: ECCC_CACHE_MS,
                offline
            });

            const parsed = parseLocationState(result.text);
            if (!parsed) {
                setLoading(false);
                return;
            }

            const forecastItems = buildForecastItems(parsed.forecast, locationKey, url, result.raw_ref);
            const conditionsItem = buildConditionsItem(parsed.obs, locationKey, url, result.raw_ref);
            const notesItems = buildNotesItems(parsed.metNotes, locationKey, url, result.raw_ref);
            const fetchedAlerts = buildAlertItems(parsed.alerts, locationKey, url, result.raw_ref);

            setIncomingAlerts(fetchedAlerts);

            const newUpdates = notesItems.slice(0, 6);
            const newForecast = [
                ...(conditionsItem ? [conditionsItem] : []),
                ...forecastItems
            ].slice(0, 6);

            setUpdates(newUpdates);
            setForecast(newForecast);
        } catch (err) {
            setError(err instanceof Error ? err : new Error('Failed to fetch ECCC data'));
        } finally {
            setLoading(false);
        }
    }, [location, locationKey]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    return {
        alerts,
        newAlerts,
        updates,
        forecast,
        loading,
        error,
        lastUpdated,
        refresh: fetchData
    };
}
