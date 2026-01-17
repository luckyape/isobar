import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GraphsPanel } from './GraphsPanel';
import type { ObservationData } from '@/lib/observations/observations';

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

describe('GraphsPanel observations caching across location transitions', () => {
  it('keeps cached observations visible when switching back to a previously loaded location', async () => {
    const locA = { latitude: 45.421532, longitude: -75.697189 };
    const locB = { latitude: 43.653226, longitude: -79.383184 };

    const obsA: ObservationData = {
      trust: { mode: 'trusted' } as any,
      series: {
        buckets: [Date.now() - 2 * 60 * 60 * 1000],
        tempC: [10],
        precipMm: [0],
        windKph: [null],
        windGustKph: [null],
        windDirDeg: [null],
        conditionCode: [null]
      }
    };

    const obsB: ObservationData = {
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
});

