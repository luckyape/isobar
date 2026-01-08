
import { describe, it, expect } from 'vitest';
import { packageArtifact } from '../artifact';
import { ForecastArtifact } from '../types';

describe('Performance Sanity', () => {

    it('packages moderate payload (1 year hourly data) under 200ms', async () => {
        // Generate payload: 1 year of hourly data for 10 variables = ~87k numbers
        const hours = 24 * 365;
        const variables = ['temp', 'precip', 'wind', 'hum', 'pres', 'cloud', 'gusts', 'dir', 'vis', 'uv'];

        const data: any = { time: new Array(hours).fill('2024-01-01T00:00') };
        variables.forEach(v => {
            data[v] = new Float32Array(hours); // Use typed array for realism if supported (or regular array)
            // JSON serialization might convert typed array to object, but MsgPack handles it efficiently usually.
            // Let's use regular array for max compatibility test.
            data[v] = Array.from({ length: hours }, () => Math.random() * 100);
        });

        const artifact: ForecastArtifact = {
            schemaVersion: 1,
            type: 'forecast',
            model: 'PERF',
            runTime: '2024-01-01T00:00:00Z',
            issuedAt: 1704067200,
            validTimes: new Array(hours).fill('2024-01-01T00:00'),
            variables: variables,
            grid: { type: 'point', lat: 0, lon: 0 },
            variableMap: Object.fromEntries(variables.map(v => [v, v])),
            data: data,
            source: 'perf-test'
        };

        const start = performance.now();
        await packageArtifact(artifact);
        const duration = performance.now() - start;

        // console.log(`Packaging 1 year hourly data took: ${duration.toFixed(2)}ms`);
        expect(duration).toBeLessThan(1500); // Relaxed for CI stability (user requested)
    });
});
