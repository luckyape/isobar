import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { HourlyChart, HourlyChartTooltip } from './HourlyChart';
import { WEATHER_MODELS } from '@/lib/weatherApi';

vi.mock('@/hooks/useMediaQuery', () => ({
  useIsMobile: () => false
}));

class ResizeObserver {
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    this.callback(
      [
        {
          target,
          contentRect: { width: 900, height: 320 } as DOMRectReadOnly
        } as ResizeObserverEntry
      ],
      this
    );
  }

  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = ResizeObserver as unknown as typeof ResizeObserver;

Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
  configurable: true,
  value: () => ({
    width: 900,
    height: 320,
    top: 0,
    left: 0,
    right: 900,
    bottom: 320
  })
});

function buildForecasts(nowMs: number) {
  const model = WEATHER_MODELS[0];
  const hours = [-2, -1, 0, 1].map((offset) => nowMs + offset * 3600_000);
  const hourly = hours.map((epoch) => ({
    time: new Date(epoch).toISOString().slice(0, 16),
    epoch,
    temperature: 20,
    precipitation: 0,
    precipitationProbability: 0,
    windSpeed: 0,
    windDirection: 0,
    windGusts: 0,
    cloudCover: 0,
    humidity: 0,
    pressure: 0,
    weatherCode: 0
  }));

  return [
    {
      model,
      hourly,
      daily: [],
      status: 'ok' as const
    }
  ];
}

function buildTooltipPayload(observed: number) {
  return [
    {
      payload: {
        fullLabel: 'Tue 10:00',
        observed,
        [WEATHER_MODELS[0].id]: 14.5
      }
    }
  ];
}

describe('HourlyChart observed visibility', () => {
  it('renders observed line even when observationsStatus is not vault', () => {
    const nowMs = Date.now();
    const forecasts = buildForecasts(nowMs);
    const observedEpoch = new Date(forecasts[0].hourly[1].time).getTime();
    const observedTempByEpoch = new Map([[observedEpoch, 12.3]]);
    const visibleLines = {
      [WEATHER_MODELS[0].name]: true,
      Observed: true
    };

    const { container } = render(
      <HourlyChart
        forecasts={forecasts as any}
        observationsStatus="none"
        observedTempByEpoch={observedTempByEpoch}
        timezone="UTC"
        visibleLines={visibleLines}
      />
    );

    const observedPath = container.querySelector('path[stroke="var(--color-observed)"]');
    expect(observedPath).toBeTruthy();
  });

  it('shows observed tooltip rows when Observed is visible', () => {
    const payload = buildTooltipPayload(12.3);
    const { getByText } = render(
      <HourlyChartTooltip
        active
        payload={payload as any}
        observedVisible
      />
    );

    expect(getByText('Observed')).toBeTruthy();
    expect(getByText(/12\.3/)).toBeTruthy();
  });

  it('hides observed tooltip rows when Observed is toggled off', () => {
    const payload = buildTooltipPayload(12.3);
    const { queryByText } = render(
      <HourlyChartTooltip
        active
        payload={payload as any}
        observedVisible={false}
      />
    );

    expect(queryByText('Observed')).toBeNull();
  });
});
