import { describe, it, expect } from 'vitest';
import {
    parseOpenMeteoDate,
    parseOpenMeteoDateTime,
    formatDateKey,
    formatDateTimeKey,
    shiftOpenMeteoDateTimeKey,
    isSameDate,
    isSameHour,
    addDays
} from './timeUtils';

describe('timeUtils', () => {
    describe('parsing', () => {
        it('should parse Open-Meteo date strings', () => {
            expect(parseOpenMeteoDate('2024-05-20')).toEqual({
                year: 2024,
                month: 5,
                day: 20
            });
            expect(parseOpenMeteoDate('invalid')).toBeNull();
        });

        it('should parse Open-Meteo datetime strings', () => {
            expect(parseOpenMeteoDateTime('2024-05-20T14:30')).toEqual({
                year: 2024,
                month: 5,
                day: 20,
                hour: 14,
                minute: 30
            });
            expect(parseOpenMeteoDateTime('2024-05-20 14:30')).toEqual({
                year: 2024,
                month: 5,
                day: 20,
                hour: 14,
                minute: 30
            });
            expect(parseOpenMeteoDateTime('invalid')).toBeNull();
        });
    });

    describe('formatting', () => {
        it('should format date keys correctly', () => {
            expect(formatDateKey({ year: 2024, month: 5, day: 20 })).toBe('2024-05-20');
            expect(formatDateKey({ year: 2024, month: 12, day: 5 })).toBe('2024-12-05');
        });

        it('should format datetime keys correctly', () => {
            expect(formatDateTimeKey({ year: 2024, month: 5, day: 20, hour: 14, minute: 30 })).toBe('2024-05-20T14:30');
            expect(formatDateTimeKey({ year: 2024, month: 5, day: 20 })).toBeNull();
        });
    });

    describe('manipulation', () => {
        it('should shift datetime keys by hours', () => {
            expect(shiftOpenMeteoDateTimeKey('2024-05-20T14:30', 2)).toBe('2024-05-20T16:30');
            expect(shiftOpenMeteoDateTimeKey('2024-05-20T23:00', 2)).toBe('2024-05-21T01:00');
            expect(shiftOpenMeteoDateTimeKey('2024-05-20T01:00', -2)).toBe('2024-05-19T23:00');
        });

        it('should add days correctly', () => {
            const start = { year: 2024, month: 5, day: 20 };
            expect(addDays(start, 2)).toEqual({ year: 2024, month: 5, day: 22 });
            expect(addDays(start, -2)).toEqual({ year: 2024, month: 5, day: 18 });
            // Leap year check
            expect(addDays({ year: 2024, month: 2, day: 28 }, 1)).toEqual({ year: 2024, month: 2, day: 29 });
            expect(addDays({ year: 2023, month: 2, day: 28 }, 1)).toEqual({ year: 2023, month: 3, day: 1 });
        });
    });

    describe('comparison', () => {
        it('should compare dates correctly', () => {
            const a = { year: 2024, month: 5, day: 20 };
            const b = { year: 2024, month: 5, day: 20 };
            const c = { year: 2024, month: 5, day: 21 };
            expect(isSameDate(a, b)).toBe(true);
            expect(isSameDate(a, c)).toBe(false);
        });

        it('should compare hours correctly', () => {
            const a = { year: 2024, month: 5, day: 20, hour: 14 };
            const b = { year: 2024, month: 5, day: 20, hour: 14 };
            const c = { year: 2024, month: 5, day: 20, hour: 15 };
            expect(isSameHour(a, b)).toBe(true);
            expect(isSameHour(a, c)).toBe(false);
        });
    });
});
