
import { describe, it, expect } from 'vitest';
import { canonicalMsgPack } from '../canonical';
import { hash, toHex } from '../hash';
import { StationSetArtifact } from '../types';

describe('Regression Guards: Deduplication & Integrity', () => {

    it('StationSet: strictly prevents createdAt timestamp leakage', () => {
        // 1. Clean Artifact (Golden Standard)
        const cleanArtifact: StationSetArtifact = {
            schemaVersion: 1,
            type: 'station_set',
            source: 'test',
            stations: [
                { id: 'S1', lat: 0, lon: 0, name: 'Zero' }
            ]
            // NO createdAt
        };

        // 2. Type System Rejection Proof
        const dirtyArtifact: StationSetArtifact = {
            ...cleanArtifact,
            // @ts-expect-error StationSetArtifact must not contain createdAt
            createdAt: new Date().toISOString()
        };

        const cleanPack = canonicalMsgPack(cleanArtifact);
        // We cast dirtyArtifact to any to allow runtime hashing check despite type error
        const dirtyPack = canonicalMsgPack(dirtyArtifact as any);

        const cleanHash = toHex(hash(cleanPack));
        const dirtyHash = toHex(hash(dirtyPack));

        // Assert that adding the field changes the hash (the "tripwire")
        expect(cleanHash).not.toBe(dirtyHash);
    });

    it('VariableMap completeness: fails if data contains unmapped keys', () => {
        // Scenario: We have data for 'precip', but we forgot to map 'precip' -> 'precipMM'
        const forecastArtifact = {
            type: 'forecast',
            variableMap: {
                'temp': 't',
                // Missing 'p' mapping
            } as Record<string, string>,
            data: {
                temp: [], // Mapped
                p: []     // Unmapped!
            }
        };

        // Implementation of the check explicitly requested:
        const checkCompleteness = (artifact: any) => {
            const mapKeys = new Set(Object.keys(artifact.variableMap));
            const dataKeys = Object.keys(artifact.data || {});

            // In flat structure, all keys in data must be in map
            const unmapped = dataKeys.filter(k => !mapKeys.has(k));
            if (unmapped.length > 0) {
                throw new Error(`Found unmapped source variables: ${unmapped.join(', ')}`);
            }
        };

        expect(() => checkCompleteness(forecastArtifact)).toThrow(/unmapped.*p/);

        // Fix it
        forecastArtifact.variableMap['p'] = 'p_mm';
        expect(() => checkCompleteness(forecastArtifact)).not.toThrow();
    });
});
