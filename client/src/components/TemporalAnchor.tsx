import { useEffect, useMemo, useState } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
    parseToDate,
    getTemporalDeltaLabel,
    getSolarStatus,
} from '@/lib/timeUtils';
import { Moon, Sun } from 'lucide-react';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export type DesignDirection = 'solar' | 'delta' | 'hybrid';
export type TemporalMode = 'live' | 'historical' | 'forecast';

export interface SolarContext {
    sunrise: string; // ISO or OpenMeteo
    sunset: string;  // ISO or OpenMeteo
}

export interface TemporalAnchorProps {
    timestamp: string; // ISO or OpenMeteo
    timezone?: string;
    mode?: TemporalMode;
    designDirection: DesignDirection;
    solarContext?: SolarContext;
    className?: string;
}

/**
 * Top-Right Temporal Anchor
 *
 * Anchors the user in Time (Civil), Context (Solar), and Uncertainty (Epistemic).
 * Implements "Temporal Confidence Gradient" via typography weight/opacity.
 * 
 * FINAL SPEC:
 * - Solar Direction: Countdown grammar (Daylight HH:MM:SS), Solid Icons.
 * - Live: Ticking.
 * - Historical/Forecast: Frozen value.
 */
export function TemporalAnchor({
    timestamp,
    timezone = 'UTC',
    mode = 'live',
    designDirection,
    solarContext,
    className,
}: TemporalAnchorProps) {
    // 1. Unify Time Objects
    const { current, now, isNow } = useMemo(() => {
        const d = parseToDate(timestamp) || new Date();
        const n = new Date(); // Real-world Now
        const diffMin = Math.abs(d.getTime() - n.getTime()) / (1000 * 60);
        // "Now Snap": Within +/- 5 mins, we are effectively Live
        const snap = diffMin <= 5;
        return { current: d, now: n, isNow: snap };
    }, [timestamp]);

    // If snapped to now, override mode to live
    const effectiveMode = isNow ? 'live' : mode;
    const isLive = effectiveMode === 'live';

    // 2. Ticking Logic for Live Mode
    // We need a tick to update the countdown second-by-second if we are in Live Solar mode.
    const [tick, setTick] = useState(0);
    useEffect(() => {
        if (!isLive || designDirection !== 'solar') return;
        const interval = setInterval(() => setTick((t) => t + 1), 1000);
        return () => clearInterval(interval);
    }, [isLive, designDirection]);

    // Derived Display Time
    // If Live, we use real-world Date.now() to ensure distinct ticking.
    // If Historical/Forecast, we use the static `current`.
    const displayTime = useMemo(() => {
        return isLive ? new Date() : current;
    }, [current, isLive, tick]); // tick dependency forces re-calc


    // 3. Epistemic Confidence Gradient
    const confidenceStyle = useMemo(() => {
        if (isLive) return 'font-bold opacity-100'; // Live: Solid / Bold

        // Calculate distance in hours relative to REAL Now
        const diffHours = Math.abs(current.getTime() - now.getTime()) / (1000 * 60 * 60);

        // Historical (Observed) -> Solid / Medium
        if (current < now) return 'font-medium opacity-100';

        // Near Forecast (+1h to +6h) -> Solid / Regular
        if (diffHours <= 6) return 'font-normal opacity-100';

        // Far Forecast (+24h+) -> Slightly Muted / Light Weight
        // Constraint: Opacity floor 85%, no thinner than font-normal/light fallback
        if (diffHours > 24) return 'font-normal opacity-85';

        // Mid Forecast
        return 'font-normal opacity-95';
    }, [current, now, isLive]);

    // 4. Formatters
    const formatTime = (date: Date) => {
        return new Intl.DateTimeFormat('en-CA', {
            hour: 'numeric',
            minute: 'numeric',
            hourCycle: 'h23',
            timeZone: timezone,
        }).format(date);
    };

    const formatDate = (date: Date) => {
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            timeZone: timezone,
        }).format(date);
    };

    const formatDay = (date: Date) => {
        return new Intl.DateTimeFormat('en-US', {
            weekday: 'short',
            timeZone: timezone,
        }).format(date);
    };

    const formatCountdown = (ms: number) => {
        const totalSeconds = Math.max(0, Math.floor(ms / 1000));
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        return `${h.toString()}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    // 5. Direction Logic
    const renderContent = () => {
        // --- Direction A: Solar-Relative (FINAL SPEC) ---
        if (designDirection === 'solar') {
            // Fallback if no context
            if (!solarContext) {
                return <span>{formatDate(displayTime)} · {formatTime(displayTime)}</span>;
            }

            const sr = parseToDate(solarContext.sunrise);
            const ss = parseToDate(solarContext.sunset);

            if (!sr || !ss) {
                return <span>{formatDate(displayTime)} · {formatTime(displayTime)}</span>;
            }

            const solarStatus = getSolarStatus(displayTime, sr, ss);

            // Countdown Logic
            const countdownStyle = "text-[10px] text-foreground/50 uppercase tracking-wide tabular-nums font-medium -mt-2";

            if (solarStatus.isDay) {
                // Dynamic Opacity: 100% at Solar Noon, 30% at Horizon
                const totalDaylight = ss.getTime() - sr.getTime();
                const solarNoon = sr.getTime() + (totalDaylight / 2);
                const distToNoon = Math.abs(displayTime.getTime() - solarNoon);
                const halfDay = totalDaylight / 2;

                // Normalize distance (0 at noon, 1 at horizon)
                const normalizedDist = Math.min(distToNoon / halfDay, 1);

                // Opacity curve: 1.0 -> 0.3
                const solarOpacity = 1.0 - (normalizedDist * 0.7);

                // Count down to sunset
                const nextEventMs = ss.getTime() - displayTime.getTime();
                return (
                    <div className="flex flex-col items-center justify-center">
                        <SoloSunsetIcon className="w-10 h-10 transition-opacity duration-1000" style={{ opacity: solarOpacity }} />
                        <span className={countdownStyle}>{formatCountdown(nextEventMs)}</span>
                    </div>
                );
            } else {
                // Night Phase - Resting at 30% opacity
                // If pre-dawn (before sunrise), count down to sunrise
                if (displayTime < sr) {
                    const nextEventMs = sr.getTime() - displayTime.getTime();
                    return (
                        <div className="flex flex-col items-center justify-center">
                            <SoloSunriseIcon className="w-10 h-10 transition-opacity duration-1000" style={{ opacity: 0.3 }} />
                            <span className={countdownStyle}>{formatCountdown(nextEventMs)}</span>
                        </div>
                    );
                } else {
                    // Post-sunset fallback
                    return (
                        <div className="flex flex-col items-center justify-center">
                            <Moon className="w-10 h-10 text-blue-300 transition-opacity duration-1000" style={{ opacity: 0.3 }} strokeWidth={0} fill="currentColor" />
                            <span className={countdownStyle}>Night</span>
                        </div>
                    );
                }
            }
        }

        // --- Direction B: Epistemic Delta ---
        if (designDirection === 'delta') {
            const deltaLabel = getTemporalDeltaLabel(displayTime, now);

            if (isLive) {
                return (
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-accent">Now</span>
                        <span className="text-muted-foreground/50">·</span>
                        <span className="font-mono">{formatTime(displayTime)}</span>
                    </div>
                );
            }

            if (effectiveMode === 'historical') {
                return <span>{deltaLabel} · {formatDate(displayTime)}</span>;
            }

            return <span>{deltaLabel} · {formatTime(displayTime)}</span>;
        }

        // --- Direction C: Civil / Solar Hybrid ---
        if (designDirection === 'hybrid') {
            const timeStr = formatTime(displayTime);
            const dayStr = formatDay(displayTime);
            const dateStr = formatDate(displayTime);

            let label = '';
            if (solarContext) {
                const sr = parseToDate(solarContext.sunrise);
                const ss = parseToDate(solarContext.sunset);
                if (sr && ss) {
                    const status = getSolarStatus(displayTime, sr, ss);
                    if (status.isDay) label = 'Day';
                    else if (status.hoursUntilSunrise < 0.5 && status.hoursUntilSunrise > 0) label = 'Dawn';
                    else label = 'Night';
                    if (Math.abs(status.hoursUntilSunset) < 0.5) label = 'Sunset';
                }
            }

            if (isLive) return <span>{dayStr} {timeStr} · {label}</span>;
            if (effectiveMode === 'historical') return <span>{dateStr} {timeStr} · {label}</span>;
            return <span>{dayStr} {timeStr} · {label}</span>;
        }

        return null;
    };

    return (
        <div
            className={cn(
                'flex items-center space-x-2 text-sm select-none transition-opacity duration-300',
                // Invariants: Structure/Weights
                confidenceStyle,
                className
            )}
            data-testid="temporal-anchor"
            data-mode={effectiveMode}
            data-direction={designDirection}
        >
            {renderContent()}
        </div>
    );
}

// Internal Icon Components with scoped IDs to avoid conflicts
function SoloSunsetIcon(props: React.SVGProps<SVGSVGElement>) {
    const idPrefix = 'sunset-icon';
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" {...props}>
            <defs>
                <linearGradient id={`${idPrefix}-a`} x1="150" x2="234" y1="119.2" y2="264.8" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="#fbbf24" /><stop offset=".5" stopColor="#fbbf24" /><stop offset="1" stopColor="#f59e0b" />
                </linearGradient>
                <clipPath id={`${idPrefix}-b`}>
                    <path fill="none" d="M512 306H296a21.5 21.5 0 00-14 5.3L256 334l-26-22.7a21.5 21.5 0 00-14-5.3H0V0h512Z" />
                </clipPath>
                <symbol id={`${idPrefix}-c`} viewBox="0 0 384 384">
                    <circle cx="192" cy="192" r="84" fill={`url(#${idPrefix}-a)`} stroke="#f8af18" strokeMiterlimit="10" strokeWidth="6" />
                    <path fill="none" stroke="#fbbf24" strokeLinecap="round" strokeMiterlimit="10" strokeWidth="24" d="M192 61.7V12m0 360v-49.7m92.2-222.5 35-35M64.8 319.2l35.1-35.1m0-184.4-35-35m254.5 254.5-35.1-35.1M61.7 192H12m360 0h-49.7" />
                </symbol>
            </defs>
            <g clipPath={`url(#${idPrefix}-b)`}>
                <use href={`#${idPrefix}-c`} width="384" height="384" transform="translate(64 100)" />
            </g>
            <path fill="none" stroke="rgba(255, 255, 255, 0.70)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="18" d="M128 332h88l40 36 40-36h88" />
        </svg>
    );
}

function SoloSunriseIcon(props: React.SVGProps<SVGSVGElement>) {
    const idPrefix = 'sunrise-icon';
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" {...props}>
            <defs>
                <linearGradient id={`${idPrefix}-a`} x1="150" x2="234" y1="119.2" y2="264.8" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="#fbbf24" /><stop offset=".5" stopColor="#fbbf24" /><stop offset="1" stopColor="#f59e0b" />
                </linearGradient>
                <clipPath id={`${idPrefix}-b`}>
                    <path fill="none" d="M512 306H304l-35.9-31.4a18.4 18.4 0 00-24.2 0L208 306H0V0h512Z" />
                </clipPath>
                <symbol id={`${idPrefix}-c`} viewBox="0 0 384 384">
                    <circle cx="192" cy="192" r="84" fill={`url(#${idPrefix}-a)`} stroke="#f8af18" strokeMiterlimit="10" strokeWidth="6" />
                    <path fill="none" stroke="#fbbf24" strokeLinecap="round" strokeMiterlimit="10" strokeWidth="24" d="M192 61.7V12m0 360v-49.7m92.2-222.5 35-35M64.8 319.2l35.1-35.1m0-184.4-35-35m254.5 254.5-35.1-35.1M61.7 192H12m360 0h-49.7" />
                </symbol>
            </defs>
            <g clipPath={`url(#${idPrefix}-b)`}>
                <use href={`#${idPrefix}-c`} width="384" height="384" transform="translate(64 100)" />
            </g>
            <path fill="none" stroke="rgba(255, 255, 255, 0.70)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="18" d="M128 332h88l40-36 40 36h88" />
        </svg>
    );
}

