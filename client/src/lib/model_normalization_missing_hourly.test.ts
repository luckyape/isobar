import { describe, it, expect } from 'vitest';
import { normalizeModel, type ModelForecast } from '@/lib/weatherApi';

describe('Model Normalization Guardrails', () => {

    it('normalizes missing hourly data into error model without crashing UI', () => {
        // Raw object mocking a malformed API response or partial state
        const raw = {
            model: { id: 'ECMWF', name: 'ECMWF' },
            hourly: undefined,
            daily: []
        } as unknown as ModelForecast;

        const model = normalizeModel(raw);

        expect(model.status).toBe('error');
        expect(model.reason).toBe('No hourly data');
        // Critical contract: Arrays must be present even if empty
        expect(model.hourly).toEqual([]);
        expect(model.daily).toEqual([]);
    });

    it('normalizes empty hourly data array into error', () => {
        const raw = {
            model: { id: 'GEM', name: 'GEM' },
            hourly: [],
            daily: []
        } as unknown as ModelForecast;

        const model = normalizeModel(raw);

        expect(model.status).toBe('error');
        expect(model.hourly.length).toBe(0);
    });

    it('preserves valid model data as ok', () => {
        const raw = {
            model: { id: 'GFS', name: 'GFS' },
            hourly: [{ time: '2024-01-01T00:00', temperature: 10 }],
            daily: [{ date: '2024-01-01' }]
        } as unknown as ModelForecast;

        const model = normalizeModel(raw);

        expect(model.status).toBe('ok');
        expect(model.hourly.length).toBe(1);
        expect(model.reason).toBeUndefined();
    });
});
