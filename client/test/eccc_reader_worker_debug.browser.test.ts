// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { chromium } from 'playwright';

describe('Debug: ECCC reader remote worker path', () => {
  it(
    'captures worker request/response and reader snapshot',
    async () => {
      const appUrl = process.env.E2E_BASE_URL;
      const workerBase = process.env.REMOTE_WORKER_BASE_URL;
      if (!appUrl) throw new Error('Missing E2E_BASE_URL');
      if (!workerBase) throw new Error('Missing REMOTE_WORKER_BASE_URL');

      const normalizedWorkerBase = workerBase.replace(/\/+$/, '');
      const expectedWorkerPrefix = `${normalizedWorkerBase}/api/eccc/location`;
      const debugNonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const browser = await chromium.launch({ timeout: 60_000 });
      try {
        const context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
          serviceWorkers: 'block'
        });
        const page = await context.newPage();

        const consoleErrors: string[] = [];
        const requestFailures: Array<{ url: string; error: string | null }> = [];
        const ecccRequests: string[] = [];

        page.on('console', (msg) => {
          if (msg.type() === 'error') consoleErrors.push(msg.text());
        });
        page.on('pageerror', (err) => consoleErrors.push(err.message));
        page.on('request', (req) => {
          if (req.url().includes('/api/eccc/location')) ecccRequests.push(req.url());
        });
        page.on('requestfailed', (req) => {
          if (req.url().includes('/api/eccc/location')) {
            requestFailures.push({ url: req.url(), error: req.failure()?.errorText ?? null });
          }
        });

        // Tag the worker request to identify the exact response.
        await context.route(`${expectedWorkerPrefix}**`, async (route) => {
          const url = new URL(route.request().url());
          url.searchParams.set('__debug', debugNonce);
          await route.continue({ url: url.toString() });
        });

        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

        await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

        const workerResponse = await page
          .waitForResponse((res) => {
            const url = res.url();
            return (
              url.startsWith(expectedWorkerPrefix) &&
              url.includes(`__debug=${encodeURIComponent(debugNonce)}`)
            );
          }, { timeout: 45_000 })
          .catch(() => null);

        if (!workerResponse) {
          console.log('[debug] no worker response within timeout');
          console.log('[debug] expected prefix:', expectedWorkerPrefix);
          console.log('[debug] observed ECCC requests:', ecccRequests);
          console.log('[debug] request failures:', requestFailures);
          console.log('[debug] console errors:', consoleErrors);
          throw new Error('No remote worker response observed');
        }

        const status = workerResponse.status();
        const contentType = workerResponse.headers()['content-type'] ?? 'unknown';
        const body = await workerResponse.text();
        const snippet = body.slice(0, 400).replace(/\s+/g, ' ').trim();

        console.log('[debug] worker url:', workerResponse.url());
        console.log('[debug] worker status:', status);
        console.log('[debug] worker content-type:', contentType);
        console.log('[debug] worker body snippet:', snippet);

        const reader = page.locator('aside[aria-label="ECCC Reader"]');
        await reader.waitFor({ state: 'attached', timeout: 60_000 });
        await reader.getByRole('tab', { name: 'Forecast' }).click();
        const readerText = await reader.innerText();
        console.log('[debug] reader text snapshot:', readerText);

        if (consoleErrors.length) console.log('[debug] console errors:', consoleErrors);
        if (requestFailures.length) console.log('[debug] failed ECCC requests:', requestFailures);
        console.log('[debug] observed ECCC requests:', ecccRequests);

        // Sanity-check that we hit the remote origin and got a response.
        expect(status).toBeGreaterThan(0);
      } finally {
        await browser.close();
      }
    },
    120_000
  );
});
