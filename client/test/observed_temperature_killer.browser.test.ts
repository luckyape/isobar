// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { chromium } from 'playwright';

type Location = {
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  province: string;
  timezone: string;
};

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

  const startDay = new Date(nowHourMs);
  startDay.setUTCHours(0, 0, 0, 0);
  const dailyTimes = Array.from({ length: 7 }, (_, i) => {
    return Math.floor((startDay.getTime() + i * 24 * 3600_000) / 1000);
  });
  const dailySeries = dailyTimes.map(() => 0);
  const dailyMax = dailyTimes.map(() => 16);
  const dailyMin = dailyTimes.map(() => 6);
  const sunrise = dailyTimes.map((t) => t + 6 * 3600);
  const sunset = dailyTimes.map((t) => t + 18 * 3600);

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
    },
    daily: {
      time: dailyTimes,
      temperature_2m_max: dailyMax,
      temperature_2m_min: dailyMin,
      precipitation_sum: dailySeries,
      precipitation_probability_max: dailySeries,
      wind_speed_10m_max: dailySeries,
      wind_gusts_10m_max: dailySeries,
      weather_code: dailySeries,
      sunrise,
      sunset
    }
  };
}

describe('Observed temperature killer flow', () => {
  it(
    'handles primary switching, stale response, and observed availability without leaking data',
    async () => {
      const appUrl = process.env.E2E_BASE_URL;
      if (!appUrl) throw new Error('Missing E2E_BASE_URL');

      const locA: Location = {
        name: 'Toronto',
        latitude: 43.6532,
        longitude: -79.3832,
        country: 'Canada',
        province: 'Ontario',
        timezone: 'America/Toronto'
      };

      const locB: Location = {
        name: 'Montreal',
        latitude: 45.5017,
        longitude: -73.5673,
        country: 'Canada',
        province: 'Quebec',
        timezone: 'America/Toronto'
      };

      const locAKey = `${locA.latitude.toFixed(4)},${locA.longitude.toFixed(4)}`;
      const locBKey = `${locB.latitude.toFixed(4)},${locB.longitude.toFixed(4)}`;

      const observationCalls = new Map<string, number>();
      let delayLocA = false;
      let delayedLocAResponses = 0;

      const browser = await chromium.launch({ timeout: 60_000 });
      try {
        const context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
          serviceWorkers: 'block'
        });

        await context.addInitScript((primaryKey, everSetKey, primaryLocation) => {
          window.localStorage.setItem(primaryKey, JSON.stringify(primaryLocation));
          window.localStorage.setItem(everSetKey, 'true');
        }, 'weather-consensus-primary-location', 'weather-consensus-primary-ever-set', locA);

        await context.route('**/api/observations**', async (route) => {
          const url = new URL(route.request().url());
          const lat = Number(url.searchParams.get('lat'));
          const lon = Number(url.searchParams.get('lon'));
          const locKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
          const count = (observationCalls.get(locKey) ?? 0) + 1;
          observationCalls.set(locKey, count);

          const nowMs = Date.now();
          const nowHourMs = Math.floor(nowMs / 3600_000) * 3600_000;
          const pastA = formatTimeKey(nowHourMs - 4 * 3600_000, locA.timezone);
          const pastB = formatTimeKey(nowHourMs - 3 * 3600_000, locA.timezone);
          const future = formatTimeKey(nowHourMs + 6 * 3600_000, locA.timezone);

          if (locKey === locAKey && delayLocA) {
            delayLocA = false;
            delayedLocAResponses += 1;
            await new Promise((res) => setTimeout(res, 1200));
          }

          const payload = locKey === locAKey
            ? { data: [
              { time: pastA, temp: 12.3 },
              { time: pastB, temp: 13.1 },
              { time: future, temp: 99 }
            ] }
            : { data: [] };

          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(payload)
          });
        });

        await context.route('https://api.open-meteo.com/data/**/static/meta.json', async (route) => {
          const payload = {
            last_run_initialisation_time: Math.floor(Date.now() / 1000) - 3600,
            last_run_availability_time: Math.floor(Date.now() / 1000),
            update_interval_seconds: 3600
          };
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(payload)
          });
        });

        await context.route('https://api.open-meteo.com/v1/**', async (route) => {
          const payload = buildForecastResponse(Date.now());
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(payload)
          });
        });

        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

        await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

        const chart = page.locator('.recharts-wrapper').first();
        await chart.waitFor({ state: 'visible', timeout: 30_000 });

        const probe = await page.evaluate(() => (window as any).__OBS_PROBE__);
        console.log('[OBS_PROBE]', probe);

        await chart.hover({ position: { x: 220, y: 80 } });
        const tooltip = page.locator('.recharts-tooltip-wrapper').first();
        await expect(tooltip).toContainText('Observed');
        await expect(tooltip).toContainText('12.3');

        await page.getByLabel('Table view').click();
        await expect(page.locator('th', { hasText: 'Observed' })).toBeVisible();
        await expect(page.locator('text=12.3 C')).toBeVisible();
        await expect(page.locator('text=99 C')).toHaveCount(0);

        delayLocA = true;
        await page.getByLabel('Refresh forecasts').click();

        await page.getByLabel('Select a location').click();
        await page.getByLabel('Set Montreal as primary location').click();

        const confirmChange = page.getByRole('button', { name: 'Change Primary' });
        try {
          await confirmChange.waitFor({ state: 'visible', timeout: 2000 });
          await confirmChange.click();
        } catch {
          // no confirmation dialog
        }

        await page.keyboard.press('Escape');

        await expect(page.locator('th', { hasText: 'Observed' })).toHaveCount(0);
        await expect(page.locator('text=12.3 C')).toHaveCount(0);

        await page.waitForTimeout(1500);
        await expect(page.locator('text=12.3 C')).toHaveCount(0);

        await page.getByLabel('Select a location').click();
        await page.getByLabel('Set Toronto as primary location').click();

        try {
          await confirmChange.waitFor({ state: 'visible', timeout: 2000 });
          await confirmChange.click();
        } catch {
          // no confirmation dialog
        }

        await page.keyboard.press('Escape');

        await expect(page.locator('th', { hasText: 'Observed' })).toBeVisible();
        await expect(page.locator('text=12.3 C')).toBeVisible();
        await expect(page.locator('text=99 C')).toHaveCount(0);

        expect(delayedLocAResponses).toBeGreaterThanOrEqual(1);
      } finally {
        await browser.close();
      }
    },
    { timeout: 120_000 }
  );
});
