
import { describe, it, expect } from 'vitest';
import { canonicalMsgPack } from '../canonical';
import { hashHex } from '../hash';

describe('Strict Numeric Rules & Canonicalization', () => {

    it('rejects NaN', () => {
        const obj = { value: NaN };
        expect(() => canonicalMsgPack(obj)).toThrow(/NaN/);
    });

    it('rejects Infinity', () => {
        const obj = { value: Infinity };
        expect(() => canonicalMsgPack(obj)).toThrow(/Infinity/);
    });

    it('rejects -Infinity', () => {
        const obj = { value: -Infinity };
        expect(() => canonicalMsgPack(obj)).toThrow(/Infinity/);
    });

    it('normalizes -0 to 0', () => {
        const objNeg = { value: -0 };
        const objPos = { value: 0 };

        const bytesNeg = canonicalMsgPack(objNeg);
        const bytesPos = canonicalMsgPack(objPos);

        expect(hashHex(bytesNeg)).toBe(hashHex(bytesPos));

        // Verify explicit byte check if possible, or just re-decode
        // But hash equality is good enough proof of normalization.
    });

    it('rejects undefined values (strict)', () => {
        const obj = { a: 1, b: undefined };
        expect(() => canonicalMsgPack(obj)).toThrow(/undefined/);
    });

    it('sorts keys recursively', () => {
        const obj1 = { b: 2, a: 1, c: { y: 9, x: 8 } };
        const obj2 = { a: 1, c: { x: 8, y: 9 }, b: 2 };

        expect(hashHex(canonicalMsgPack(obj1))).toBe(hashHex(canonicalMsgPack(obj2)));
    });
});
