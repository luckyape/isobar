// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

function contentTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

async function startStaticServer(baseDir: string): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const normalizedBase = path.resolve(baseDir);

  const server = http.createServer(async (req, res) => {
    try {
      const rawUrl = req.url ?? '/';
      const parsed = new URL(rawUrl, 'http://localhost');
      let pathname = decodeURIComponent(parsed.pathname);
      if (pathname === '/') pathname = '/demos/transition-a.html';

      const relativePath = pathname.replace(/^\/+/, '');
      const filePath = path.resolve(path.join(normalizedBase, relativePath));
      if (!filePath.startsWith(normalizedBase + path.sep)) {
        res.statusCode = 403;
        res.end('Forbidden');
        return;
      }

      const data = await fs.readFile(filePath);
      res.statusCode = 200;
      res.setHeader('content-type', contentTypeForPath(filePath));
      res.end(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Not found';
      res.statusCode = 404;
      res.end(message);
    }
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start test server');
  }
  const url = `http://127.0.0.1:${address.port}`;

  return {
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      })
  };
}

describe('ECCC reader (large screens)', () => {
  it(
    'renders visibly at >= 980px and hides below 980px',
    async () => {
      const server = await startStaticServer(process.cwd());
      let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
      try {
        browser = await chromium.launch({ timeout: 20_000 });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Playwright Chromium failed to launch. Run \`pnpm exec playwright install chromium\`.\n\n${message}`
        );
      }

      try {
        const context = await browser.newContext({
          viewport: { width: 1200, height: 800 }
        });
        const page = await context.newPage();
        await page.goto(`${server.url}/demos/transition-a.html`, { waitUntil: 'domcontentloaded', timeout: 20_000 });

        const readerRegion = page.locator('.readerCol');
        await readerRegion.waitFor({ timeout: 10_000 });

        const largeDisplay = await readerRegion.evaluate((el) => getComputedStyle(el).display);
        expect(largeDisplay).not.toBe('none');

        const largeBox = await readerRegion.boundingBox();
        expect(largeBox?.width ?? 0).toBeGreaterThan(40);
        expect(largeBox?.height ?? 0).toBeGreaterThan(40);

        const consensusBox = await page.locator('.consensusCol').boundingBox();
        expect(consensusBox).not.toBeNull();
        expect((largeBox?.x ?? 0) + (largeBox?.width ?? 0)).toBeLessThan((consensusBox?.x ?? 0) + 2);

        await page.setViewportSize({ width: 820, height: 800 });
        await page.waitForTimeout(50);

        const smallDisplay = await readerRegion.evaluate((el) => getComputedStyle(el).display);
        expect(smallDisplay).toBe('none');
      } finally {
        await browser?.close();
        await server.close();
      }
    },
    { timeout: 30_000 }
  );
});
