import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TemporalAnchor, type DesignDirection } from './TemporalAnchor';

// Mock Lucide icons to avoid rendering issues in tests
vi.mock('lucide-react', () => ({
    Sun: (props: any) => <div data-testid="icon-sun" {...props} />,
    Moon: (props: any) => <div data-testid="icon-moon" {...props} />,
    CloudSun: (props: any) => <div data-testid="icon-cloud-sun" {...props} />,
    Sunrise: (props: any) => <div data-testid="icon-sunrise" {...props} />,
    Sunset: (props: any) => <div data-testid="icon-sunset" {...props} />,
}));

const MOCK_NOW = new Date('2026-01-18T12:00:00Z').getTime();

describe('TemporalAnchor', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(MOCK_NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('Direction A: Solar (Final Spec)', () => {
        // 12:00 is Day. Sunset at 18:00. 6h remaining.
        const solarContext = {
            sunrise: '2026-01-18T06:00:00Z',
            sunset: '2026-01-18T18:00:00Z',
        };

        it('renders daylight countdown correctly in Live mode', () => {
            render(
                <TemporalAnchor
                    timestamp="2026-01-18T12:00:00Z" // Exact Now
                    designDirection="solar"
                    mode="live"
                    timezone="UTC"
                    solarContext={solarContext}
                />
            );

            // Should show countdown: 18:00 - 12:00 = 6 hours -> 6:00:00
            // Text "Daylight" is replaced by Icon. Should verify time presence.
            expect(screen.getByText(/6:00:00/)).toBeDefined();
            // Icon check removed as we use custom SVG now (integration check would be better but simple unit test is sufficient here)
        });

        it('ticks seconds in Live mode', () => {
            render(
                <TemporalAnchor
                    timestamp="2026-01-18T12:00:00Z"
                    designDirection="solar"
                    mode="live"
                    timezone="UTC"
                    solarContext={solarContext}
                />
            );

            expect(screen.getByText(/6:00:00/)).toBeDefined();

            // fast-forward 1 second
            act(() => {
                vi.advanceTimersByTime(1000);
            });

            // Now should be 12:00:01. Sunset is 18:00:00. Diff is 5:59:59.
            expect(screen.getByText(/5:59:59/)).toBeDefined();
        });

        it('freezes in Historical mode (Scrubbing)', () => {
            // User scrubs to 10:00 AM (Past)
            render(
                <TemporalAnchor
                    timestamp="2026-01-18T10:00:00Z"
                    designDirection="solar"
                    mode="historical"
                    timezone="UTC"
                    solarContext={solarContext}
                />
            );

            // 10:00 to 18:00 = 8 hours
            expect(screen.getByText(/8:00:00/)).toBeDefined();

            // fast-forward 5 seconds
            act(() => {
                vi.advanceTimersByTime(5000);
            });

            // Should NOT have changed
            expect(screen.getByText(/8:00:00/)).toBeDefined();
        });

        it('shows Night fallback if post-sunset without next sunrise', () => {
            // 20:00 (Night). Sunset was 18:00.
            const nightTime = new Date('2026-01-18T20:00:00Z').getTime();
            vi.setSystemTime(nightTime);

            render(
                <TemporalAnchor
                    timestamp="2026-01-18T20:00:00Z"
                    designDirection="solar"
                    mode="live"
                    timezone="UTC"
                    solarContext={solarContext}
                />
            );

            expect(screen.getByText(/Night/)).toBeDefined();
            // Fallback Moon icon (Lucide) is still used here
            expect(screen.getByTestId('icon-moon')).toBeDefined();
        });

        it('shows Sunrise countdown if pre-dawn', () => {
            // 04:00 (Night, 2h to sunrise at 06:00).
            const preDawnTime = new Date('2026-01-18T04:00:00Z').getTime();
            vi.setSystemTime(preDawnTime);

            render(
                <TemporalAnchor
                    timestamp="2026-01-18T04:00:00Z"
                    designDirection="solar"
                    mode="live"
                    timezone="UTC"
                    solarContext={solarContext}
                />
            );

            // 06:00 - 04:00 = 2 hours -> 2:00:00
            // Text "Sunrise" is replaced by Icon.
            expect(screen.getByText(/2:00:00/)).toBeDefined();
            // Custom SVG used, removing Lucide check
        });
    });

    describe('Direction B: Delta', () => {
        it('shows Now for live state', () => {
            render(
                <TemporalAnchor
                    timestamp="2026-01-18T12:00:00Z"
                    designDirection="delta"
                    mode="live"
                    timezone="UTC"
                />
            );
            expect(screen.getByText('Now')).toBeDefined();
        });
    });

    describe('Confidence Gradient', () => {
        it('applies bold for Live', () => {
            render(
                <TemporalAnchor
                    timestamp="2026-01-18T12:00:00Z"
                    designDirection="solar"
                    mode="live"
                    timezone="UTC"
                />
            );
            const el = screen.getByTestId('temporal-anchor');
            expect(el.className).toContain('font-bold');
        });

        it('applies light opacity for far forecast', () => {
            render(
                <TemporalAnchor
                    timestamp="2026-01-20T12:00:00Z" // 2 days in future
                    designDirection="delta"
                    mode="forecast"
                    timezone="UTC"
                />
            );

            const el = screen.getByTestId('temporal-anchor');
            // 24h+ -> opacity-85
            expect(el.className).toContain('opacity-85');
        });
    });
});
