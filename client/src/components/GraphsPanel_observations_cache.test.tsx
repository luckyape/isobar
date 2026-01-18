import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GraphsPanel } from './GraphsPanel';
import type { ObservationData } from '@/lib/observations/observations';
import { WEATHER_MODELS, type ModelForecast } from '@/lib/weatherApi';

vi.mock('@/lib/weatherApi', async () => {
  const actual = await vi.importActual<any>('@/lib/weatherApi');
  return {
    ...actual,
    fetchObservedHourlyFromApi: vi.fn().mockResolvedValue(null)
  };
});

vi.mock('@/hooks/useMediaQuery', () => ({
  useIsMobile: () => false
}));

global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn()
}));

const fetchObservationsForRange = vi.fn();
vi.mock('@/lib/observations/observations', () => ({
  fetchObservationsForRange: (...args: any[]) => fetchObservationsForRange(...args)
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function buildForecasts(nowHourMs: number): ModelForecast[] {
  const startEpochMs = nowHourMs - 24 * 3600_000;
  const hourly = Array.from({ length: 49 }, (_, i) => {
    const epoch = startEpochMs + i * 3600_000;
    return {
      time: new Date(epoch).toISOString().slice(0, 16),
      epoch,
      temperature: 10,
      precipitation: 0,
      precipitationProbability: 0,
      windSpeed: 0,
      windDirection: 0,
      windGusts: 0,
      cloudCover: 0,
      humidity: 0,
      pressure: 0,
      weatherCode: 0
    };
  });

  return [
    {
      model: WEATHER_MODELS[0],
      status: 'ok' as const,
      hourly,
      daily: [],
      fetchedAt: new Date(nowHourMs)
    }
  ] as ModelForecast[];
}

describe('GraphsPanel observations caching across location transitions', () => {
  async function switchToTableView() {
    const tableToggle = screen.getByLabelText('Table view');
    fireEvent.click(tableToggle);
  }

  it('keeps cached observations visible when switching back to a previously loaded location', async () => {
    const locA = { latitude: 45.421532, longitude: -75.697189 };
    const locB = { latitude: 43.653226, longitude: -79.383184 };

    const obsA: ObservationData = {
      stationId: 'TEST-STATION-A',
      distanceKm: 1.2,
      trust: { mode: 'trusted' } as any,
      series: {
        buckets: [Date.now() - 2 * 60 * 60 * 1000],
        tempC: [42.7],
        precipMm: [0],
        windKph: [null],
        windGustKph: [null],
        windDirDeg: [null],
        conditionCode: [null]
      }
    };

    const obsB: ObservationData = {
      stationId: 'TEST-STATION-B',
      distanceKm: 1.2,
      trust: { mode: 'trusted' } as any,
      series: {
        buckets: [Date.now() - 2 * 60 * 60 * 1000],
        tempC: [11],
        precipMm: [0],
        windKph: [null],
        windGustKph: [null],
        windDirDeg: [null],
        conditionCode: [null]
      }
    };

    const pending = createDeferred<ObservationData | null>();

    fetchObservationsForRange
      .mockResolvedValueOnce(obsA)
      .mockResolvedValueOnce(obsB)
      .mockImplementationOnce(() => pending.promise);

    const { rerender } = render(
      <GraphsPanel
        forecasts={[]}
        location={locA}
        timezone="America/Toronto"
        lastUpdated={new Date()}
      />
    );

    await screen.findByText(/Observed source: VAULT/i);

    rerender(
      <GraphsPanel
        forecasts={[]}
        location={locB}
        timezone="America/Toronto"
        lastUpdated={new Date()}
      />
    );
    await screen.findByText(/Observed source: VAULT/i);

    rerender(
      <GraphsPanel
        forecasts={[]}
        location={locA}
        timezone="America/Toronto"
        lastUpdated={new Date()}
      />
    );

    // Cached VAULT observations should remain visible while the refresh is still pending.
    expect(screen.getByText(/Observed source: VAULT/i)).toBeTruthy();
    expect(screen.queryByText(/Observed source: LOADING/i)).toBeNull();
    expect(document.body.textContent || '').not.toMatch(/\bNo data\b/i);
  });

  it('does not reuse cached observations for a different location', async () => {
    const locA = { latitude: 45.421532, longitude: -75.697189 };
    const locB = { latitude: 43.653226, longitude: -79.383184 };
    const nowHourMs = Math.floor(Date.now() / 3600_000) * 3600_000;
    const forecasts = buildForecasts(nowHourMs);
    const targetEpoch = forecasts[0].hourly[0].epoch;
    const obsA: ObservationData = {
      stationId: 'TEST-STATION-A',
      distanceKm: 1.2,
      trust: { mode: 'trusted' } as any,
      series: {
        buckets: [targetEpoch],
        tempC: [10],
        precipMm: [0],
        windKph: [null],
        windGustKph: [null],
        windDirDeg: [null],
        conditionCode: [null]
      }
    };

    fetchObservationsForRange
      .mockResolvedValueOnce(obsA)
      .mockResolvedValueOnce(null);

    const { rerender } = render(
      <GraphsPanel
        forecasts={forecasts}
        location={locA}
        timezone="America/Toronto"
        lastUpdated={new Date()}
      />
    );

    await screen.findByText(/Observed source: VAULT/i);
    await switchToTableView();
    expect(screen.getByText('Observed')).toBeTruthy();
    expect(screen.getByText('42.7 C')).toBeTruthy();

    rerender(
      <GraphsPanel
        forecasts={forecasts}
        location={locB}
        timezone="America/Toronto"
        lastUpdated={new Date()}
      />
    );

    await screen.findByText(/Observed source: NONE/i);
    expect(screen.queryByText('Observed')).toBeNull();
    expect(screen.queryByText('42.7 C')).toBeNull();
  });
});
