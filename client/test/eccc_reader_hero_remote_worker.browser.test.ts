// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { chromium } from 'playwright';

type AnyObj = Record<string, any>;

function extractInitialState(raw: string, contentType?: string | null): AnyObj | null {
  const ct = (contentType ?? '').toLowerCase();

  // If the worker returns JSON, prefer parsing it.
  if (ct.includes('application/json') || raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(raw) as any;

      // Some endpoints may return the state directly.
      if (parsed && typeof parsed === 'object') {
        // If it already looks like the ECCC location payload shape used by the UI.
        // Common shapes:
        // - { location: { location: { [key]: {...} } } }
        // - { location: { [key]: {...} } }
        // - { [key]: {...} }
        const locationMap = parsed?.location?.location ?? parsed?.location;
        if (locationMap && typeof locationMap === 'object' && !Array.isArray(locationMap)) {
          const firstKey = Object.keys(locationMap)[0];
          if (firstKey) return locationMap[firstKey] as AnyObj;
        }

        // Fallback: if the payload itself is the location object.
        if (parsed?.forecast || parsed?.alerts || parsed?.observations) return parsed as AnyObj;
      }
    } catch {
      // fall through to HTML parsing
    }
  }

  // Otherwise treat it as HTML and extract window.__INITIAL_STATE__ JSON.
  const markerIndex = raw.indexOf('window.__INITIAL_STATE__');
  if (markerIndex === -1) return null;
  const braceStart = raw.indexOf('{', markerIndex);
  if (braceStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  let endIndex = -1;

  for (let i = braceStart; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      depth += 1;
      continue;
    }

    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        endIndex = i + 1;
        break;
      }
    }
  }

  if (endIndex === -1) return null;
  try {
    const jsonText = raw.slice(braceStart, endIndex);
    const state = JSON.parse(jsonText) as AnyObj;

    const locationMap = state?.location?.location;
    if (!locationMap || typeof locationMap !== 'object') return null;
    const firstKey = Object.keys(locationMap)[0];
    if (!firstKey) return null;
    return locationMap[firstKey] as AnyObj;
  } catch {
    return null;
  }
}

function pickForecastTitle(parsed: AnyObj): string | null {
  // Prefer the first daily forecast titleText if present.
  const daily = Array.isArray(parsed?.forecast?.daily) ? parsed.forecast.daily : [];
  for (const entry of daily) {
    const title = entry?.titleText ?? entry?.summary ?? entry?.title ?? '';
    if (typeof title === 'string' && title.trim()) return title.trim();
  }

  // Fallback: sometimes a headline exists in forecast metadata.
  const headline = parsed?.forecast?.headline ?? parsed?.forecast?.textSummary ?? parsed?.headline;
  if (typeof headline === 'string' && headline.trim()) return headline.trim();

  return null;
}

describe('Hero Reader: ECCC aggregated data renders from remote Worker (integration)', () => {
  it(
    'renders remote Worker-curated ECCC data inside the hero Reader UI (full client path)',
    async () => {
      const appUrl = process.env.E2E_BASE_URL;
      const workerBaseUrl = process.env.REMOTE_WORKER_BASE_URL;
      if (!appUrl) throw new Error('Missing E2E_BASE_URL');
      if (!workerBaseUrl) throw new Error('Missing REMOTE_WORKER_BASE_URL');

      const appOrigin = new URL(appUrl).origin;
      const normalizedWorkerBase = workerBaseUrl.replace(/\/+$/, '');
      const workerOrigin = new URL(normalizedWorkerBase).origin;
      if (workerOrigin === appOrigin) {
        throw new Error('REMOTE_WORKER_BASE_URL must be a different origin than the app under test');
      }
      const expectedWorkerPrefix = `${normalizedWorkerBase}/api/eccc/location`;

      const browser = await chromium.launch({ timeout: 60_000 });
      try {
        const context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
          serviceWorkers: 'block'
        });

        // Use a slightly-jittered coordinate to avoid cached/stale results and to guarantee a unique request.
        const jitter = () => (Math.random() - 0.5) * 0.1; // ~±5km-ish
        const toronto = {
          name: 'Toronto',
          latitude: 43.6532 + jitter(),
          longitude: -79.3832 + jitter(),
          timezone: 'America/Toronto',
          country: 'Canada',
          province: 'Ontario'
        };
        const e2eNonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

        // Tag the remote worker request so we can unambiguously identify it among any background requests.
        await context.route(`${expectedWorkerPrefix}**`, async (route) => {
          const url = new URL(route.request().url());
          url.searchParams.set('__e2e', e2eNonce);
          await route.continue({ url: url.toString() });
        });

        const page = await context.newPage();

        // Harden against cache/serviceworker interference.
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

        const candidateRequests: string[] = [];
        const requestFailures: Array<{ url: string; error: string | null }> = [];
        page.on('request', (req) => {
          const url = req.url();
          if (url.includes('/api/eccc/location')) candidateRequests.push(url);
        });
        page.on('requestfailed', (req) => {
          const url = req.url();
          if (url.includes('/api/eccc/location')) {
            requestFailures.push({ url, error: req.failure()?.errorText ?? null });
          }
        });

        // Load the app route that includes the hero + reader.
        await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

        // === Full-path integration contract ===
        // 1) The app must request ECCC location data from the REMOTE worker.
        // 2) The client must process that payload.
        // 3) The Reader UI must render values sourced from that payload.

        // Wait for the exact remote worker response initiated by the UI.
        const workerResponse = await page
          .waitForResponse((res) => {
            const url = res.url();
            return (
              url.startsWith(expectedWorkerPrefix) &&
              url.includes(`__e2e=${encodeURIComponent(e2eNonce)}`)
            );
          }, { timeout: 45_000 })
          .catch(() => null);

        if (!workerResponse) {
          throw new Error(
            [
              `No remote worker response observed within timeout.`,
              `Expected URL prefix: ${expectedWorkerPrefix}`,
              `Observed ECCC location requests (${candidateRequests.length}):`,
              ...candidateRequests.slice(0, 10),
              `Observed failures (${requestFailures.length}):`,
              ...requestFailures.slice(0, 10).map((entry) => `${entry.url} (${entry.error ?? 'unknown'})`)
            ].join('\n')
          );
        }

        // Prove it was remote (origin differs from app).
        expect(new URL(workerResponse.url()).origin).toBe(workerOrigin);
        expect(workerResponse.fromServiceWorker()).toBe(false);

        // Extract a stable UI-visible value from the *actual response* the client receives.
        // NOTE: This is intentionally not an endpoint test. We only use the response body to
        // compute the expected UI text, then assert the UI renders it.
        const raw = await workerResponse.text();
        const contentType = workerResponse.headers()['content-type'] ?? null;
        const state = extractInitialState(raw, contentType);
        if (!state) {
          const snippet = raw.slice(0, 500).replace(/\s+/g, ' ').trim();
          throw new Error(
            [
              'Could not extract usable state from remote Worker response.',
              `content-type: ${contentType ?? 'unknown'}`,
              `url: ${workerResponse.url()}`,
              `body-snippet: ${snippet}`
            ].join('\n')
          );
        }

        const expectedForecastTitle = pickForecastTitle(state);
        if (!expectedForecastTitle) throw new Error('Remote Worker ECCC response missing forecast titleText');

        // Now assert the Reader UI renders that value after client-side processing.
        const reader = page.locator('aside[aria-label="ECCC Reader"]');
        await reader.waitFor({ state: 'attached', timeout: 60_000 });

        // Ensure we’re viewing the Forecast tab (this is where the forecast title must appear).
        await reader.getByRole('tab', { name: 'Forecast' }).click();

        // The core integration assertion: UI contains the forecast title that came from the remote worker.
        // We do NOT assert CSS/layout; we assert user-visible content.
        await expect(reader).toContainText(expectedForecastTitle, { timeout: 60_000 });

        // Extra guardrail: if the UI has an error banner/empty state, fail loudly.
        // (Keep this broad to avoid coupling to markup.)
        await expect(reader).not.toContainText('Error', { timeout: 1_000 });
        await expect(reader).not.toContainText('Failed', { timeout: 1_000 });
        await expect(reader).not.toContainText('Something went wrong', { timeout: 1_000 });
      } finally {
        await browser.close();
      }
    },
    120_000
  );
});
