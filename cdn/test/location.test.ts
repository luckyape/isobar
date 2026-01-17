import { canonicalizeLocKey, computeLocationScopeId, makeLocKey, normalizeLocationScope } from '../location';

test('location scope id is stable for same input', () => {
    const a = computeLocationScopeId({
        latitude: 43.6532,
        longitude: -79.3832,
        timezone: 'America/Toronto'
    });
    const b = computeLocationScopeId({
        latitude: 43.6532,
        longitude: -79.3832,
        timezone: 'America/Toronto'
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
});

test('location scope normalization rounds to fixed decimals', () => {
    const scope = normalizeLocationScope({
        latitude: 10.123456789,
        longitude: -20.987654321,
        timezone: 'UTC',
        decimals: 4
    });
    expect(scope.latitude).toBe(10.1235);
    expect(scope.longitude).toBe(-20.9877);
});

test('loc_key canonicalization accepts canonical format', () => {
    expect(canonicalizeLocKey('v1:44.6683,-65.7619')).toBe('v1:44.6683,-65.7619');
});

test('loc_key canonicalization normalizes -0.0000', () => {
    expect(canonicalizeLocKey('v1:-0.0000,-0.0000')).toBe('v1:0.0000,0.0000');
});

test('loc_key canonicalization enforces 4 decimals and strict formatting', () => {
    expect(() => canonicalizeLocKey('v1:44.66,-65.7600')).toThrow(/canonical|decimal/i);
    expect(() => canonicalizeLocKey('v1:44.66830,-65.7619')).toThrow(/canonical|decimal/i);
    expect(() => canonicalizeLocKey('v1:+44.6683,-65.7619')).toThrow(/canonical|decimal/i);
    expect(() => canonicalizeLocKey('v1:044.6683,-65.7619')).toThrow(/canonical|decimal/i);
});

test('makeLocKey produces canonical 4-decimal loc_key', () => {
    expect(makeLocKey(44.66834, -65.76194)).toBe('v1:44.6683,-65.7619');
    expect(makeLocKey(-0, -0)).toBe('v1:0.0000,0.0000');
});
