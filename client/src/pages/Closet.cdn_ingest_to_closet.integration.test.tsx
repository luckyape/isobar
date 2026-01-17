import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ClosetDashboardPage from './Closet';
import { computeLocationScopeId } from '@cdn/location';
import { SyncEngine } from '@/lib/vault/sync';
import { getVault } from '@/lib/vault/store';
import { getClosetDB } from '@/lib/closet';
import { setPrimaryLocation } from '@/lib/locationStore';

const CDN_BASE_URL = process.env.CDN_TEST_URL || 'https://weather-forecast-cdn.graham-cbc.workers.dev';

function parseMinuteKeyUtcMs(minuteKey: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(minuteKey)) return null;
  const ms = Date.parse(`${minuteKey}:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

describe('Closet /closet JSON reflects CDN ingest data', () => {
  const TEST_LOC = {
    name: 'Montreal',
    latitude: 45.5017,
    longitude: -73.5673,
    country: 'Canada',
    timezone: 'America/Toronto'
  };

  beforeEach(async () => {
    window.localStorage.clear();
    window.location.hash = '';

    await getVault().clear();
    await getClosetDB().clear();

    setPrimaryLocation(TEST_LOC);
  });

  it('ingests via CDN and surfaces observation entries in /closet JSON export', async () => {
    const scopeId = computeLocationScopeId({
      latitude: TEST_LOC.latitude,
      longitude: TEST_LOC.longitude,
      timezone: TEST_LOC.timezone
    });

    const ingestResp = await fetch(`${CDN_BASE_URL}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        latitude: TEST_LOC.latitude,
        longitude: TEST_LOC.longitude,
        timezone: TEST_LOC.timezone
      })
    });
    expect(ingestResp.ok).toBe(true);
    const ingestData = (await ingestResp.json()) as { success?: boolean; manifestHash?: string };
    expect(ingestData.success).toBe(true);
    expect(ingestData.manifestHash).toMatch(/^[a-f0-9]{64}$/i);

    const rootResp = await fetch(`${CDN_BASE_URL}/locations/${scopeId}/manifests/root.json`);
    expect(rootResp.ok).toBe(true);
    const root = (await rootResp.json()) as { latest?: string };
    expect(root.latest).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const engine = new SyncEngine({
      cdnUrl: CDN_BASE_URL,
      syncDays: 2,
      concurrency: 2,
      expectedManifestPubKeyHex: null,
      location: {
        latitude: TEST_LOC.latitude,
        longitude: TEST_LOC.longitude,
        timezone: TEST_LOC.timezone
      }
    });

    const state = await engine.sync(undefined, { syncDays: 2 });
    expect(state.blobsDownloaded).toBeGreaterThan(0);

    render(<ClosetDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Coverage')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Export JSON'));

    await waitFor(() => {
      expect(screen.getByText('Assistant JSON Export')).toBeTruthy();
    });

    const textareas = screen.getAllByRole('textbox');
    const exportTextarea = textareas.find((el) =>
      (el as HTMLTextAreaElement).value.includes('"closet_dashboard_v1"')
    ) as HTMLTextAreaElement | undefined;
    expect(exportTextarea).toBeDefined();

    const exported = JSON.parse(exportTextarea!.value) as any;

    expect(exported.version).toBe('closet_dashboard_v1');
    expect(exported.derived?.obsIndexCount).toBeGreaterThan(0);
    expect(Array.isArray(exported.raw?.observationIndexEntries)).toBe(true);

    const ecccObs = (exported.raw?.observationIndexEntries ?? []).filter((e: any) => e?.source === 'eccc');
    expect(ecccObs.length).toBeGreaterThan(0);

    const newestBucket = exported.derived?.newestObservationBucket as string | null;
    expect(typeof newestBucket === 'string' || newestBucket === null).toBe(true);

    if (typeof newestBucket === 'string') {
      const ms = parseMinuteKeyUtcMs(newestBucket);
      expect(ms).not.toBeNull();
      const ageHours = (Date.now() - (ms as number)) / (1000 * 60 * 60);
      expect(ageHours).toBeLessThan(48);
    }
  }, 120000);
});
