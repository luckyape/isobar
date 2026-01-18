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
            let text = '';
            let Icon = Sun;
            let iconColor = 'text-primary';

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
            if (solarStatus.isDay) {
                // Count down to sunset
                const nextEventMs = ss.getTime() - displayTime.getTime();
                text = `Daylight ${formatCountdown(nextEventMs)}`;
                Icon = Sun;
                iconColor = 'text-amber-400';
            } else {
                // Night
                Icon = Moon;
                iconColor = 'text-blue-300';

                // If pre-dawn (before sunrise), count down to sunrise
                if (displayTime < sr) {
                    const nextEventMs = sr.getTime() - displayTime.getTime();
                    text = `Sunrise ${formatCountdown(nextEventMs)}`;
                } else {
                    // Post-sunset. 
                    // We don't have "tomorrow's sunrise". 
                    // Constraint: "☾ Sunrise HH:MM:SS (countdown to next sunrise)"
                    // Robust Fallback: If we can't calc next sunrise, just show "Night".
                    // Or, if difference is negative, assume next day?
                    // Not safe without next day's data. 
                    // But usually `solarContext` comes from daily forecast which should cover the day.
                    // If local time is 23:00, and sunrise is 06:00 (past), we need tomorrow's 06:00.
                    // We can estimate +24h to SR if strict needed, but that's risky.
                    // Let's degrade gracefully.
                    text = 'Night';
                }
            }

            return (
                <div className="flex items-center gap-2">
                    <Icon className={cn("w-4 h-4 fill-current", iconColor)} strokeWidth={0} />
                    <span className="tabular-nums tracking-wide">{text}</span>
                </div>
            );
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
                'flex items-center space-x-2 text-sm select-none',
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
