import { describe, it, expect } from 'vitest';
import { conditionToIconName } from './weatherIcons';
import { getIsDay } from './dayNight';

describe('weatherIcons', () => {
    describe('conditionToIconName', () => {
        it('maps clear sky (0) correctly', () => {
            expect(conditionToIconName(0, true)).toBe('ClearDay');
            expect(conditionToIconName(0, false)).toBe('ClearNight');
        });

        it('maps cloudy variants (1, 2) correctly', () => {
            expect(conditionToIconName(1, true)).toBe('PartlyCloudyDay');
            expect(conditionToIconName(1, false)).toBe('PartlyCloudyNight');
            expect(conditionToIconName(2, true)).toBe('PartlyCloudyDay');
            expect(conditionToIconName(2, false)).toBe('PartlyCloudyNight');
        });

        it('maps overcast (3) to single variant', () => {
            expect(conditionToIconName(3, true)).toBe('Overcast');
            expect(conditionToIconName(3, false)).toBe('Overcast');
        });

        it('maps fog (45, 48) correctly', () => {
            expect(conditionToIconName(45)).toBe('Fog');
            expect(conditionToIconName(48)).toBe('Fog');
        });

        it('maps drizzle (51, 53, 55) correctly', () => {
            expect(conditionToIconName(51)).toBe('Drizzle');
            expect(conditionToIconName(53)).toBe('Drizzle');
            expect(conditionToIconName(55)).toBe('Drizzle');
        });

        it('maps rain (61, 63, 65) correctly', () => {
            expect(conditionToIconName(61)).toBe('Rain');
            expect(conditionToIconName(63)).toBe('Rain');
            expect(conditionToIconName(65)).toBe('Rain');
        });

        it('maps snow (71, 73, 75) correctly', () => {
            expect(conditionToIconName(71)).toBe('Snow');
            expect(conditionToIconName(73)).toBe('Snow');
            expect(conditionToIconName(75)).toBe('Snow');
        });

        it('maps showers (80) with day/night variants', () => {
            expect(conditionToIconName(80, true)).toBe('PartlyCloudyDayRain');
            expect(conditionToIconName(80, false)).toBe('PartlyCloudyNightRain');
        });

        it('maps thunderstorms (95) correctly', () => {
            expect(conditionToIconName(95)).toBe('Thunderstorms');
        });
    });

    describe('getIsDay', () => {
        // 2024-01-01 12:00:00 UTC = 1704110400
        const noonUtc = 1704110400;
        // 2024-01-01 00:00:00 UTC = 1704067200
        const midnightUtc = 1704067200;

        it('uses sunrise/sunset if available', () => {
            const forecast = {
                time: '2024-01-01',
                sunrise: '2024-01-01T06:00',
                sunset: '2024-01-01T18:00',
                temperatureMax: 0,
                temperatureMin: 0,
                precipitationProbability: 0
            };

            // 12:00 is between 06:00 and 18:00
            const noonDate = new Date('2024-01-01T12:00').getTime() / 1000;
            expect(getIsDay(noonDate, forecast)).toBe(true);

            // 20:00 is after 18:00
            const nightDate = new Date('2024-01-01T20:00').getTime() / 1000;
            expect(getIsDay(nightDate, forecast)).toBe(false);
        });

        it('uses timezone heuristic when forecast missing', () => {
            // 12:00 UTC in London (GMT) is 12:00 -> Day
            expect(getIsDay(noonUtc, undefined, 'Europe/London')).toBe(true);

            // 12:00 UTC in Los Angeles (PST -8) is 04:00 -> Night
            // (Assuming getIsDay checks 6am-6pm local hour)
            expect(getIsDay(noonUtc, undefined, 'America/Los_Angeles')).toBe(false);
        });
    });
});
