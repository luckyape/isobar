/**
 * useWeather Hook - Arctic Data Observatory
 * Manages weather data fetching, caching, and consensus calculation
 *
 * PRIMARY vs ACTIVE LOCATION:
 * - activeLocation: Currently viewed location (what charts display)
 * - primaryLocation: The "weatherman assigned" location for deeper features
 *
 * OBSERVATIONS GATING:
 * Observations are ONLY fetched for the primary location. When browsing
 * a non-primary location, forecasts are shown but observations are not.
 */

import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import { fetchForecastsWithMetadata, getCachedForecasts, fetchObservedHourly, type ObservedConditions, type ModelForecast, type Location, type DataCompleteness } from '@/lib/weatherApi';
import { calculateConsensus, type ConsensusResult } from '@/lib/consensus';
import { getSyncEngine, SyncEngine, type SyncProgress } from '@/lib/vault/sync';
import {
  getActiveLocation,
  getPrimaryLocation,
  setActiveLocation as storeSetActive,
  setPrimaryLocation as storeSetPrimary,
  isPrimaryLocation,
  subscribeToLocationChanges,
  getLocationSnapshot
} from '@/lib/locationStore';

interface WeatherState {
  location: Location | null;
  primaryLocation: Location | null;
  isPrimary: boolean;
  forecasts: ModelForecast[];
  consensus: ConsensusResult | null;
  observations: ObservedConditions | null;
  dataCompleteness: DataCompleteness | null;
  isLoading: boolean;
  isOffline: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refreshNotice: {
    type: 'no-new-runs';
    latestRunAvailabilityTime?: number;
  } | null;
  syncProgress: SyncProgress | null;
}

export function useWeather() {
  const requestIdRef = useRef(0);
  const pendingRetryRef = useRef<Map<string, number>>(new Map());

  // Subscribe to location store changes
  const locationSnapshot = useSyncExternalStore(
    subscribeToLocationChanges,
    getLocationSnapshot,
    getLocationSnapshot
  );

  const [state, setState] = useState<WeatherState>({
    location: locationSnapshot.activeLocation,
    primaryLocation: locationSnapshot.primaryLocation,
    isPrimary: locationSnapshot.isViewingPrimary,
    forecasts: [],
    consensus: null,
    observations: null,
    dataCompleteness: null,
    isLoading: false,
    isOffline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
    error: null,
    lastUpdated: null,
    refreshNotice: null,
    syncProgress: null
  });

  // Fetch weather data for a location
  const fetchWeather = useCallback(async (
    location: Location,
    options: { force?: boolean; bypassAllCaches?: boolean; userInitiated?: boolean; refresh?: boolean } = {}
  ) => {
    const requestId = ++requestIdRef.current;
    const isOffline = typeof navigator !== 'undefined' ? !navigator.onLine : false;
    const cachedForecasts = getCachedForecasts(
      location.latitude,
      location.longitude,
      location.timezone
    );
    const hasCachedForecasts = cachedForecasts.length > 0;
    const cachedConsensus = hasCachedForecasts ? calculateConsensus(cachedForecasts) : null;
    const cachedRunTime = cachedConsensus?.freshness.freshestRunAvailabilityTime ?? null;

    // Single state update on fetch start to avoid transient empty/loading flashes.
    // If we have cached data for the target location, apply it immediately as the "loading snapshot".
    setState(prev => ({
      ...prev,
      isLoading: !isOffline,
      isOffline,
      error: null,
      observations: null,
      refreshNotice: null,
      ...(hasCachedForecasts
        ? {
          location,
          forecasts: cachedForecasts,
          consensus: cachedConsensus,
          lastUpdated: Number.isFinite(cachedRunTime ?? NaN) ? new Date((cachedRunTime as number) * 1000) : null,
          primaryLocation: getPrimaryLocation(),
          isPrimary: isPrimaryLocation(location)
        }
        : null)
    }));

    try {
      // GATING: Only fetch observations for the PRIMARY location.
      // When browsing non-primary locations, we skip observation fetches
      // to avoid unnecessary API calls and confusion about which location's
      // observations are being displayed.
      const shouldFetchObservations = !isOffline && isPrimaryLocation(location);
      const observationsPromise = shouldFetchObservations
        ? fetchObservedHourly(
          location.latitude,
          location.longitude,
          location.timezone
        )
        : null;
      const { forecasts, pending, refreshSummary, completeness } = await fetchForecastsWithMetadata(
        location.latitude,
        location.longitude,
        location.timezone,
        {
          force: options.force,
          bypassAllCaches: options.bypassAllCaches,
          userInitiated: options.userInitiated,
          offline: isOffline
        }
      );

      if (requestIdRef.current !== requestId) return;

      const consensus = calculateConsensus(forecasts);
      const runTime = consensus.freshness.freshestRunAvailabilityTime;
      const refreshNotice = refreshSummary.noNewRuns && options.refresh
        ? {
          type: 'no-new-runs' as const,
          latestRunAvailabilityTime: refreshSummary.latestRunAvailabilityTime
        }
        : null;

      setState(prev => ({
        location,
        forecasts,
        consensus,
        observations: null,
        dataCompleteness: completeness,
        isLoading: false,
        isOffline,
        error: null,
        lastUpdated: Number.isFinite(runTime ?? NaN) ? new Date((runTime as number) * 1000) : null,
        refreshNotice,
        syncProgress: prev.syncProgress,
        primaryLocation: getPrimaryLocation(),
        isPrimary: isPrimaryLocation(location)
      }));

      // Update the store's active location
      storeSetActive(location);

      const pendingIds = new Set(pending.map((item) => item.modelId));
      pendingRetryRef.current.forEach((timeoutId, modelId) => {
        if (!pendingIds.has(modelId)) {
          clearTimeout(timeoutId);
          pendingRetryRef.current.delete(modelId);
        }
      });
      pending.forEach((item) => {
        if (pendingRetryRef.current.has(item.modelId)) return;
        const delayMs = Math.max(0, item.retryAt - Date.now());
        const timeoutId = window.setTimeout(() => {
          pendingRetryRef.current.delete(item.modelId);
          if (requestIdRef.current !== requestId) return;
          fetchWeather(location);
        }, delayMs);
        pendingRetryRef.current.set(item.modelId, timeoutId);
      });

      if (observationsPromise) {
        observationsPromise
          .then((observations) => {
            if (requestIdRef.current !== requestId) return;
            if (!observations) return;
            setState(prev => ({
              ...prev,
              observations
            }));
          })
          .catch((observationsError) => {
            console.warn('Observations refresh failed:', observationsError);
          });
      }
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      setState(prev => ({
        ...prev,
        isLoading: false,
        isOffline,
        error: error instanceof Error ? error.message : 'Failed to fetch weather data'
      }));
    }
  }, []);

  // Set active location (for browsing) and fetch weather
  const setLocation = useCallback((location: Location) => {
    storeSetActive(location);
    fetchWeather(location, { userInitiated: true, refresh: false });
  }, [fetchWeather]);

  // Set primary location (the "weatherman assigned" location)
  const setPrimaryLocation = useCallback((location: Location) => {
    storeSetPrimary(location);
    // Setting primary also updates active (handled by store)
    // Fetch weather for the new primary
    fetchWeather(location, { userInitiated: true, refresh: false });

    // Trigger historical backfill (fire and forget)
    // We create a standalone engine to avoid interference with the main sync effect
    const backfillEngine = new SyncEngine({
      location: {
        latitude: location.latitude,
        longitude: location.longitude,
        timezone: location.timezone
      }
    });
    console.log(`[useWeather] Triggering 365-day backfill for new primary: ${location.name}`);
    backfillEngine.sync(undefined, { syncDays: 365 }).catch(err => {
      console.warn('[useWeather] Backfill failed:', err);
    });
  }, [fetchWeather]);

  // Refresh current location data
  const refresh = useCallback((options?: { force?: boolean; bypassAllCaches?: boolean; userInitiated?: boolean }) => {
    if (state.location && !state.isOffline) {
      fetchWeather(state.location, { userInitiated: true, refresh: true, ...options });
    }
  }, [state.location, state.isOffline, fetchWeather]);

  // Initialize with location from store (already initialized with proper defaults)
  useEffect(() => {
    const initialLocation = getActiveLocation();
    fetchWeather(initialLocation);
  }, [fetchWeather]);

  // Location-scoped background sync from CDN
  useEffect(() => {
    if (!state.location) return;
    if (state.isOffline) return;

    const syncEngine = getSyncEngine({
      location: {
        latitude: state.location.latitude,
        longitude: state.location.longitude,
        timezone: state.location.timezone
      }
    });

    let active = true;
    syncEngine
      .sync((progress) => {
        if (!active) return;
        setState(prev => ({ ...prev, syncProgress: progress }));
      })
      .then((syncState) => {
        if (!active) return;
        console.log(`[sync] Finished: ${syncState.blobsDownloaded} blobs, ${syncState.bytesDownloaded} bytes`);
        if (syncState.blobsDownloaded > 0) {
          refresh({ force: false, bypassAllCaches: false, userInitiated: false });
        }
      })
      .catch((err) => {
        if (!active) return;
        console.warn('[sync] Failed:', err);
      });

    return () => {
      active = false;
      syncEngine.abort();
    };
  }, [state.location?.latitude, state.location?.longitude, state.location?.timezone, state.isOffline, refresh]);

  useEffect(() => {
    const handleOnline = () => {
      setState(prev => ({ ...prev, isOffline: false }));
    };
    const handleOffline = () => {
      setState(prev => ({ ...prev, isOffline: true }));
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    return () => {
      pendingRetryRef.current.forEach((timeoutId) => {
        clearTimeout(timeoutId);
      });
      pendingRetryRef.current.clear();
    };
  }, []);

  return {
    ...state,
    setLocation,
    setPrimaryLocation,
    refresh
  };
}
