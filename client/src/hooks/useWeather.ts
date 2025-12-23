/**
 * useWeather Hook - Arctic Data Observatory
 * Manages weather data fetching, caching, and consensus calculation
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchForecastsWithMetadata,
  getCachedForecasts,
  fetchObservedHourly,
  type ObservedConditions,
  type ModelForecast,
  type Location,
  type DataCompleteness,
  CANADIAN_CITIES
} from '@/lib/weatherApi';
import { calculateConsensus, type ConsensusResult } from '@/lib/consensus';

interface WeatherState {
  location: Location | null;
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
}

const STORAGE_KEY = 'weather-consensus-location';

// Get saved location from localStorage
function getSavedLocation(): Location | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Error reading saved location:', e);
  }
  return null;
}

// Save location to localStorage
function saveLocation(location: Location): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(location));
  } catch (e) {
    console.error('Error saving location:', e);
  }
}

export function useWeather() {
  const requestIdRef = useRef(0);
  const pendingRetryRef = useRef<Map<string, number>>(new Map());
  const [state, setState] = useState<WeatherState>({
    location: null,
    forecasts: [],
    consensus: null,
    observations: null,
    dataCompleteness: null,
    isLoading: false,
    isOffline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
    error: null,
    lastUpdated: null,
    refreshNotice: null
  });

  // Fetch weather data for a location
  const fetchWeather = useCallback(async (
    location: Location,
    options: { force?: boolean; userInitiated?: boolean; refresh?: boolean } = {}
  ) => {
    const requestId = ++requestIdRef.current;
    const isOffline = typeof navigator !== 'undefined' ? !navigator.onLine : false;
    setState(prev => ({
      ...prev,
      isLoading: !isOffline,
      isOffline,
      error: null,
      observations: null,
      refreshNotice: null
    }));
    const cachedForecasts = getCachedForecasts(
      location.latitude,
      location.longitude,
      location.timezone
    );
    if (cachedForecasts.length > 0) {
      const cachedConsensus = calculateConsensus(cachedForecasts);
      const runTime = cachedConsensus.freshness.freshestRunAvailabilityTime;
      setState(prev => ({
        ...prev,
        location,
        forecasts: cachedForecasts,
        consensus: cachedConsensus,
        lastUpdated: Number.isFinite(runTime ?? NaN) ? new Date((runTime as number) * 1000) : null
      }));
    }

    try {
      const observationsPromise = isOffline
        ? null
        : fetchObservedHourly(
          location.latitude,
          location.longitude,
          location.timezone
        );
      const { forecasts, pending, refreshSummary, completeness } = await fetchForecastsWithMetadata(
        location.latitude,
        location.longitude,
        location.timezone,
        {
          force: options.force,
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

      setState({
        location,
        forecasts,
        consensus,
        observations: null,
        dataCompleteness: completeness,
        isLoading: false,
        isOffline,
        error: null,
        lastUpdated: Number.isFinite(runTime ?? NaN) ? new Date((runTime as number) * 1000) : null,
        refreshNotice
      });

      saveLocation(location);

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

  // Set location and fetch weather
  const setLocation = useCallback((location: Location) => {
    fetchWeather(location, { userInitiated: true, refresh: false });
  }, [fetchWeather]);

  // Refresh current location data
  const refresh = useCallback((options?: { force?: boolean; userInitiated?: boolean }) => {
    if (state.location && !state.isOffline) {
      fetchWeather(state.location, { userInitiated: true, refresh: true, ...options });
    }
  }, [state.location, state.isOffline, fetchWeather]);

  // Initialize with saved location or default
  useEffect(() => {
    const savedLocation = getSavedLocation();
    const initialLocation = savedLocation || CANADIAN_CITIES[0]; // Default to Toronto
    fetchWeather(initialLocation);
  }, [fetchWeather]);

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
    refresh
  };
}
