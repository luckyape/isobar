import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

const fetchObservationsForRange = vi.fn();
vi.mock('@/lib/observations/observations', () => ({
  fetchObservationsForRange: (...args: any[]) => fetchObservationsForRange(...args)
}));

vi.mock('@/hooks/useMediaQuery', () => ({
  useIsMobile: () => false
}));

global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn()
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
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
      temperature: 12,
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

function makeObservation(epoch: number, temp: number): ObservationData {
  return {
    stationId: 'TEST-STATION',
    distanceKm: 1.2,
    trust: { mode: 'trusted', verifiedCount: 1, unverifiedCount: 0 },
    series: {
      buckets: [epoch],
      tempC: [temp],
      precipMm: [0],
      windKph: [null],
      windGustKph: [null],
      windDirDeg: [null],
      conditionCode: [null]
    }
  };
}

async function switchToTableView() {
  const tableToggle = screen.getByLabelText('Table view');
  fireEvent.click(tableToggle);
}

describe('GraphsPanel observed location switching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchObservationsForRange).mockImplementation(() => Promise.resolve(null));
  });

  it('clears observed immediately when primary location switches', async () => {
    const nowMs = Date.now();
    const nowHourMs = Math.floor(nowMs / 3600_000) * 3600_000;
    const forecasts = buildForecasts(nowHourMs);
    const pastEpoch = forecasts[0].hourly[0].epoch;

    const pendingB = createDeferred<ObservationData | null>();

    vi.mocked(fetchObservationsForRange)
      .mockResolvedValueOnce(makeObservation(pastEpoch, 16.2))
      .mockImplementationOnce(() => pendingB.promise);

    const { rerender } = render(
      <GraphsPanel
        forecasts={forecasts}
        location={{ latitude: 45.4215, longitude: -75.6972 }}
        timezone="America/Toronto"
        lastUpdated={new Date(nowMs)}
      />
    );

    await screen.findByText(/Observed source: VAULT/i);
    await switchToTableView();

    expect(screen.getByText('Observed')).toBeTruthy();
    expect(screen.getByText('16.2 C')).toBeTruthy();

    rerender(
      <GraphsPanel
        forecasts={forecasts}
        location={{ latitude: 43.6532, longitude: -79.3832 }}
        timezone="America/Toronto"
        lastUpdated={new Date(nowMs)}
      />
    );

    expect(screen.queryByText('Observed')).toBeNull();
    expect(screen.queryByText('16.2 C')).toBeNull();
    expect(screen.getByText(/Observed source: LOADING/i)).toBeTruthy();

    pendingB.resolve(null);
    await screen.findByText(/Observed source: NONE/i);
    expect(screen.queryByText('Observed')).toBeNull();
  });

  it('drops stale observation responses after a location switch', async () => {
    const nowMs = Date.now();
    const nowHourMs = Math.floor(nowMs / 3600_000) * 3600_000;
    const forecasts = buildForecasts(nowHourMs);
    const pastEpoch = forecasts[0].hourly[0].epoch;

    const pendingA = createDeferred<ObservationData | null>();
    const pendingB = createDeferred<ObservationData | null>();

    vi.mocked(fetchObservationsForRange)
      .mockImplementationOnce(() => pendingA.promise)
      .mockImplementationOnce(() => pendingB.promise);

    const { rerender } = render(
      <GraphsPanel
        forecasts={forecasts}
        location={{ latitude: 45.4215, longitude: -75.6972 }}
        timezone="America/Toronto"
        lastUpdated={new Date(nowMs)}
      />
    );

    await switchToTableView();

    rerender(
      <GraphsPanel
        forecasts={forecasts}
        location={{ latitude: 43.6532, longitude: -79.3832 }}
        timezone="America/Toronto"
        lastUpdated={new Date(nowMs)}
      />
    );

    pendingB.resolve(null);
    await screen.findByText(/Observed source: NONE/i);

    pendingA.resolve(makeObservation(pastEpoch, 18.4));

    await waitFor(() => {
      expect(screen.queryByText('Observed')).toBeNull();
      expect(screen.queryByText('18.4 C')).toBeNull();
      expect(screen.getByText(/Observed source: NONE/i)).toBeTruthy();
    });
  });
});
