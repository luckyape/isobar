/**
 * Tests for City Autocomplete Module
 *
 * These tests validate:
 * 1. Canada-first ranking algorithm
 * 2. API-level filtering (bbox for Photon, featureType for Nominatim)
 * 3. Client-side ranking after API responses
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
    searchCities,
    exportAssistantContext,
    clearCache,
    resetState,
    getProviderStatus,
    type CityCandidate,
} from './cityAutocomplete';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('cityAutocomplete', () => {
    beforeEach(() => {
        resetState();
        mockFetch.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('Photon API configuration', () => {
        it('should query Photon with Canada bbox and osm_tag filters', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ features: [] }),
            });

            const controller = new AbortController();
            await searchCities('test', { signal: controller.signal });

            // Verify Photon was called with correct params
            expect(mockFetch).toHaveBeenCalled();
            const url = mockFetch.mock.calls[0][0];
            expect(url).toContain('photon.komoot.io');
            // Note: commas are URL-encoded as %2C
            expect(url).toContain('bbox=-141');
            expect(url).toContain('osm_tag=place');
        });
    });

    describe('Nominatim API configuration', () => {
        it('should query Nominatim with countrycodes=ca and featureType=settlement', async () => {
            // Empty Photon response to trigger Nominatim fallback
            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({ features: [] }),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve([]),
                });

            const controller = new AbortController();
            await searchCities('test', { signal: controller.signal, canadianThreshold: 10 });

            // Verify Nominatim was called with correct params
            expect(mockFetch).toHaveBeenCalledTimes(2);
            const nominatimUrl = mockFetch.mock.calls[1][0];
            expect(nominatimUrl).toContain('nominatim.openstreetmap.org');
            expect(nominatimUrl).toContain('countrycodes=ca');
            expect(nominatimUrl).toContain('featuretype=settlement');
        });
    });

    describe('Canada-first ranking algorithm', () => {
        it('should always rank CA cities above non-CA regardless of population', async () => {
            const photonResponse = {
                features: [
                    // US city with huge population
                    { geometry: { coordinates: [-73.97, 40.71] }, properties: { name: 'New York', countrycode: 'us', osm_value: 'city', population: 8000000 } },
                    // UK city with huge population
                    { geometry: { coordinates: [-0.12, 51.50] }, properties: { name: 'London', countrycode: 'gb', osm_value: 'city', population: 9000000 } },
                    // CA city with tiny population - should still win
                    { geometry: { coordinates: [-79.38, 43.65] }, properties: { name: 'SmallCanadianTown', countrycode: 'ca', osm_value: 'town', population: 1000 } },
                ],
            };

            mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(photonResponse) });

            const controller = new AbortController();
            const results = await searchCities('city', { signal: controller.signal });

            // Canadian city must be first regardless of population
            expect(results[0].countryCode).toBe('CA');
            expect(results[0].name).toBe('SmallCanadianTown');
        });

        it('should rank exact matches higher than partial matches', async () => {
            const photonResponse = {
                features: [
                    { geometry: { coordinates: [-79.38, 43.65] }, properties: { name: 'Torontoville', countrycode: 'ca', osm_value: 'city' } },
                    { geometry: { coordinates: [-79.40, 43.70] }, properties: { name: 'Toronto', countrycode: 'ca', osm_value: 'city' } },
                ],
            };

            mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(photonResponse) });

            const controller = new AbortController();
            const results = await searchCities('Toronto', { signal: controller.signal });

            expect(results[0].name).toBe('Toronto');
        });
    });

    describe('Integration: Expected search behavior', () => {
        it('should return St. John\'s Canada first for "st j" query', async () => {
            const photonResponse = {
                features: [
                    {
                        geometry: { coordinates: [-52.7066964, 47.5646794] },
                        properties: {
                            name: "St. John's",
                            countrycode: 'ca',
                            osm_value: 'city',
                            state: 'Newfoundland and Labrador',
                        },
                    },
                    {
                        geometry: { coordinates: [-5.67, 50.12] },
                        properties: {
                            name: 'St Just',
                            countrycode: 'gb',
                            osm_value: 'town',
                        },
                    },
                ],
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(photonResponse),
            });

            const controller = new AbortController();
            const results = await searchCities('st j', { signal: controller.signal });

            expect(results.length).toBeGreaterThan(0);
            expect(results[0].name).toBe("St. John's");
            expect(results[0].countryCode).toBe('CA');
            expect(results[0].region).toBe('Newfoundland and Labrador');
        });

        it('should return Saint John NB for "Saint John" query', async () => {
            const photonResponse = {
                features: [
                    {
                        geometry: { coordinates: [-66.0585188, 45.2787992] },
                        properties: {
                            name: 'City of Saint John',
                            countrycode: 'ca',
                            osm_value: 'city',
                            state: 'New Brunswick',
                        },
                    },
                ],
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(photonResponse),
            });

            const controller = new AbortController();
            const results = await searchCities('Saint John', { signal: controller.signal });

            expect(results.length).toBeGreaterThan(0);
            expect(results[0].name).toBe('City of Saint John');
            expect(results[0].countryCode).toBe('CA');
            expect(results[0].region).toBe('New Brunswick');
        });

        it('should return Canadian London before UK London', async () => {
            const photonResponse = {
                features: [
                    {
                        geometry: { coordinates: [-0.1276, 51.5074] },
                        properties: { name: 'London', countrycode: 'gb', osm_value: 'city', population: 8136000 },
                    },
                    {
                        geometry: { coordinates: [-81.2453, 42.9849] },
                        properties: { name: 'London', countrycode: 'ca', osm_value: 'city', state: 'Ontario', population: 383822 },
                    },
                ],
            };

            mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(photonResponse) });

            const controller = new AbortController();
            const results = await searchCities('London', { signal: controller.signal });

            expect(results[0].countryCode).toBe('CA');
            expect(results[0].region).toBe('Ontario');
            expect(results[1].countryCode).toBe('GB');
        });

        it('should return Canadian cities for "saint" query via bbox', async () => {
            // Simulates real Photon response with bbox - returns CA and nearby US cities
            const photonResponse = {
                features: [
                    { geometry: { coordinates: [-94.00, 45.00] }, properties: { name: 'Saint Paul', countrycode: 'us', osm_value: 'city', state: 'Minnesota' } },
                    { geometry: { coordinates: [-66.05, 45.27] }, properties: { name: 'City of Saint John', countrycode: 'ca', osm_value: 'city', state: 'New Brunswick' } },
                    { geometry: { coordinates: [-74.00, 45.95] }, properties: { name: 'Saint-Jérôme', countrycode: 'ca', osm_value: 'city', state: 'Quebec' } },
                ],
            };

            mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(photonResponse) });

            const controller = new AbortController();
            const results = await searchCities('saint', { signal: controller.signal });

            // Canadian cities should be ranked first
            expect(results[0].countryCode).toBe('CA');
            expect(results[1].countryCode).toBe('CA');
            expect(results[2].countryCode).toBe('US');
        });
    });

    describe('Edge cases', () => {
        it('should return empty array for queries less than 2 characters', async () => {
            const controller = new AbortController();
            const results = await searchCities('a', { signal: controller.signal });

            expect(results).toEqual([]);
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('should handle Photon API errors gracefully', async () => {
            mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

            const controller = new AbortController();
            const results = await searchCities('Toronto', { signal: controller.signal });

            expect(results).toEqual([]);
            expect(getProviderStatus().photon.lastStatus).toBe('error');
        });
    });
});
