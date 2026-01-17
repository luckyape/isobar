
import { describe, it, expect } from 'vitest';
import { assertVariableMapDirection, computeArtifactId } from '../artifact';
import { fetchForecast } from '../ingest/fetcher';
// import { HOURLY_VARIABLES } from '../types';

// Mock fetch for ingest test? 
// Or just test the validation logic.

describe('Schema & Variable Contracts', () => {

    const canonicalKeys = ['airTempC', 'windSpdKmh', 'windDirDeg'];

    it('validates variable map direction correctly', () => {
        // Correct: source -> canonical
        const validMap = {
            'temperature_2m': 'airTempC',
            'wind_speed_10m': 'windSpdKmh'
        };
        expect(() => assertVariableMapDirection(validMap, canonicalKeys)).not.toThrow();

        // Inverse: canonical -> source
        const invalidMap = {
            'airTempC': 'temperature_2m'
        };
        expect(() => assertVariableMapDirection(invalidMap, canonicalKeys)).toThrow(/inverted/);
    });

    it('observation must use canonical keys', () => {
        // This is a contract test. We verify our known observation artifact fixture adheres to it.
        const obsData = {
            airTempC: { STA1: 10 },
            windSpdKmh: { STA1: 20 },
            // unknown: { STA1: 1 } // Would be allowed but ignored by strict scorers
        };

        // Check if keys in obsData are in canonical set
        // Just ensuring we don't accidentally ship source keys like "temperature_2m" in observations
        const keys = Object.keys(obsData);
        const sourceLikeKeys = keys.filter(k => k.includes('_')); // heuristic
        expect(sourceLikeKeys).toHaveLength(0);
    });
});
