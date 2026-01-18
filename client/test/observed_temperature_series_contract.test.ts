// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { ModelForecast } from '@/lib/weatherApi';
import { WEATHER_MODELS } from '@/lib/weatherApi';
import { buildHourlySpine, buildHourlyTemperatureSeries, getSlotIndexAtX } from '@/lib/graphUtils';
import { isBucketCompleted } from '@/lib/observations/bucketing';

function formatTimeKey(tsMs: number, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
  const parts = formatter.formatToParts(new Date(tsMs));
  const map: Record<string, string> = {};
  parts.forEach((part) => {
    if (part.type !== 'literal') map[part.type] = part.value;
  });
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
}

function buildForecastResponse(nowMs: number) {
  const nowHourMs = Math.floor(nowMs / 3600_000) * 3600_000;
  const startHourMs = nowHourMs - 24 * 3600_000;
  const hours = Array.from({ length: 49 }, (_, i) => startHourMs + i * 3600_000);
  const hourlyTimes = hours.map((ms) => Math.floor(ms / 1000));
  const series = hours.map((_, i) => Math.round((10 + i * 0.2) * 10) / 10);
  const zeros = hours.map(() => 0);

  return {
    hourly: {
      time: hourlyTimes,
      temperature_2m: series,
      precipitation: zeros,
      precipitation_probability: zeros,
      wind_speed_10m: zeros,
      wind_direction_10m: zeros,
      wind_gusts_10m: zeros,
      cloud_cover: zeros,
      relative_humidity: zeros,
      pressure_msl: zeros,
      weather_code: zeros
    }
  };
}

function buildForecastFixture(nowMs: number, timeZone: string): ModelForecast {
  const payload = buildForecastResponse(nowMs);
  const model = WEATHER_MODELS[0];
  const hourly = payload.hourly.time.map((timeSeconds, index) => {
    const epoch = timeSeconds * 1000;
    return {
      time: formatTimeKey(epoch, timeZone),
      epoch,
      temperature: payload.hourly.temperature_2m[index],
      precipitation: payload.hourly.precipitation[index],
      precipitationProbability: payload.hourly.precipitation_probability[index],
      windSpeed: payload.hourly.wind_speed_10m[index],
      windDirection: payload.hourly.wind_direction_10m[index],
      windGusts: payload.hourly.wind_gusts_10m[index],
      cloudCover: payload.hourly.cloud_cover[index],
      humidity: payload.hourly.relative_humidity[index],
      pressure: payload.hourly.pressure_msl[index],
      weatherCode: payload.hourly.weather_code[index]
    };
  });

  return {
    model,
    hourly,
    daily: [],
    fetchedAt: new Date(nowMs),
    status: 'ok'
  };
}

describe('Observed temperature series contract', () => {
  it('maps the killer hover slot to an eligible observed value', () => {
    const timeZone = 'America/Toronto';
    const nowMs = Date.UTC(2026, 0, 18, 15, 30);
    const forecast = buildForecastFixture(nowMs, timeZone);
    const forecasts = [forecast];
    const spine = buildHourlySpine({
      forecasts,
      showConsensus: false,
      timezone: timeZone,
      nowMs
    });

    const slotEpochByTimeKey = new Map<string, number>();
    const slotCount = Math.min(spine.slotEpochs.length, spine.slotTimeKeys.length);
    for (let i = 0; i < slotCount; i += 1) {
      slotEpochByTimeKey.set(spine.slotTimeKeys[i], spine.slotEpochs[i]);
    }

    const nowHourMs = Math.floor(nowMs / 3600_000) * 3600_000;
    const observedRows = [
      { time: formatTimeKey(nowHourMs - 4 * 3600_000, timeZone), temperature: 12.3 },
      { time: formatTimeKey(nowHourMs - 3 * 3600_000, timeZone), temperature: 13.1 },
      { time: formatTimeKey(nowHourMs + 6 * 3600_000, timeZone), temperature: 99 }
    ];

    const observedTempByEpoch = new Map<number, number>();
    observedRows.forEach((row) => {
      const epoch = slotEpochByTimeKey.get(row.time);
      if (!Number.isFinite(epoch ?? NaN)) return;
      if (!isBucketCompleted(epoch as number, 60, nowMs)) return;
      if (!Number.isFinite(row.temperature ?? NaN)) return;
      observedTempByEpoch.set(epoch as number, row.temperature);
    });

    const series = buildHourlyTemperatureSeries({
      forecasts,
      showConsensus: false,
      timezone: timeZone,
      observedTempByEpoch,
      nowMs
    });

    expect(series.points.length).toBe(48);

    const chartWidth = 1200;
    const hoverIndex = getSlotIndexAtX({
      width: chartWidth,
      x: 220,
      slotCount: series.points.length,
      marginLeft: -10,
      marginRight: 10
    });
    const hovered = series.points[hoverIndex];
    expect(hovered?.observed).toBe(12.3);
    expect(series.points.some((point) => point.observed === 99)).toBe(false);
  });
});
