import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchObservations } from '../ingest/fetcher';

const SAMPLE_XML = `<?xml version='1.0' encoding="UTF-8" ?>
<wfs:FeatureCollection xmlns:ec-msc="urn:x-msc-smc:md:weather-meteo" xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:wfs="http://www.opengis.net/wfs/2.0">
  <wfs:member>
    <ec-msc:CURRENT_CONDITIONS gml:id="CURRENT_CONDITIONS.Oakville">
      <ec-msc:msGeometry>
        <gml:Point srsName="urn:ogc:def:crs:EPSG::4326">
          <gml:pos>43.460000 -79.690000</gml:pos>
        </gml:Point>
      </ec-msc:msGeometry>
      <ec-msc:station_en>Burlington Lift Bridge</ec-msc:station_en>
      <ec-msc:temp>-10.5</ec-msc:temp>
      <ec-msc:speed>11</ec-msc:speed>
      <ec-msc:gust></ec-msc:gust>
      <ec-msc:bearing>280.8</ec-msc:bearing>
      <ec-msc:timestamp>2026-01-16T01:00:00Z</ec-msc:timestamp>
    </ec-msc:CURRENT_CONDITIONS>
  </wfs:member>
</wfs:FeatureCollection>`;

describe('fetchObservations (eccc)', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('maps CURRENT_CONDITIONS into station_set + hourly observation', async () => {
        const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: async () => SAMPLE_XML
        } as any);

        const result = await fetchObservations({
            latitude: 43.6532,
            longitude: -79.3832,
            radiusKm: 200,
            now: new Date('2026-01-16T01:10:00.000Z')
        });

        expect(result).not.toBeNull();
        expect(result!.stationSet.source).toBe('eccc');
        expect(result!.observations).toHaveLength(1);

        const obs = result!.observations[0];
        expect(obs.source).toBe('eccc');
        expect(obs.observedAtBucket).toBe('2026-01-16T01:00:00.000Z');
        expect(obs.bucketMinutes).toBe(60);

        const stationId = result!.stationSet.stations[0].id;
        expect(stationId).toBe('CURRENT_CONDITIONS.Oakville');
        expect(obs.data.airTempC[stationId]).toBe(-10.5);
        expect(obs.data.windSpdKmh[stationId]).toBe(11);
        expect(obs.data.windDirDeg[stationId]).toBe(280.8);
    });
});

