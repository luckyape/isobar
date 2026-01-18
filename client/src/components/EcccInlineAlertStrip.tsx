// client/src/components/EcccInlineAlertStrip.tsx
import React, { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';

type Severity = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';

export type AlertViewModel = {
    id: string;
    headline: string;
    event?: string;
    area?: string;
    severity?: Severity;
    sentAt?: string | number | Date;
    expiresAt: string | number | Date;
    summary?: string;
    instruction?: string;
};

type Props = {
    alerts: AlertViewModel[];
    onViewDetails?: (alertId: string) => void;
    className?: string;
};

function fmtTime(v?: string | number | Date): string {
    if (!v) return '';
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
}

function getSeverityDetails(severity?: Severity) {
    switch (severity?.toLowerCase()) {
        case 'extreme': return 'bg-red-500/15 text-red-200 border-red-500/25 shadow-[0_0_10px_-3px_rgba(239,68,68,0.3)]';
        case 'severe': return 'bg-orange-500/15 text-orange-200 border-orange-500/25 shadow-[0_0_10px_-3px_rgba(249,115,22,0.3)]';
        case 'moderate': return 'bg-yellow-500/15 text-yellow-200 border-yellow-500/25 shadow-[0_0_10px_-3px_rgba(234,179,8,0.3)]';
        case 'minor': return 'bg-emerald-500/15 text-emerald-200 border-emerald-500/25 shadow-[0_0_10px_-3px_rgba(16,185,129,0.3)]';
        default: return 'bg-white/5 text-muted-foreground border-white/10';
    }
}

export function EcccInlineAlertStrip({ alerts, onViewDetails, className }: Props) {
    const [index, setIndex] = useState(0);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const startRef = useRef<{ x: number; y: number; t: number } | null>(null);

    // keep index valid when alerts change
    useEffect(() => {
        if (!alerts.length) return;
        setIndex((i) => clamp(i, 0, alerts.length - 1));
    }, [alerts.length]);

    // collapse when switching cards
    useEffect(() => {
        if (!alerts.length) return;
        setExpandedId(null);
    }, [index, alerts.length]);

    const active = alerts.length > 0;
    if (!active) return null;

    const a = alerts[index];

    // swipe handling
    const onPointerDown = (e: React.PointerEvent) => {
        startRef.current = { x: e.clientX, y: e.clientY, t: performance.now() };
    };

    const onPointerUp = (e: React.PointerEvent) => {
        const s = startRef.current;
        startRef.current = null;
        if (!s) return;

        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;

        // require horizontal intent
        if (Math.abs(dx) < 40) return;
        if (Math.abs(dx) < Math.abs(dy) * 1.2) return;

        if (dx < 0 && index < alerts.length - 1) setIndex(index + 1);
        if (dx > 0 && index > 0) setIndex(index - 1);
    };

    const isExpanded = expandedId === a.id;
    const severity = a.severity ?? 'Unknown';
    const sent = fmtTime(a.sentAt);
    const exp = fmtTime(a.expiresAt);

    return (
        <div className={cn("w-full relative z-10 border-b border-white/5 bg-background/30 backdrop-blur-md", className)}>
            <div
                role="region"
                aria-label="Local weather alerts"
                onPointerDown={onPointerDown}
                onPointerUp={onPointerUp}
            >
                <div className="container py-3 flex items-start gap-5">

                    {/* Desktop Nav: Previous */}
                    {alerts.length > 1 && (
                        <button
                            type="button"
                            onClick={() => setIndex((i) => clamp(i - 1, 0, alerts.length - 1))}
                            disabled={index === 0}
                            className="hidden md:flex mt-0.5 p-2 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-20 disabled:hover:bg-white/5 transition-all text-white/90 shadow-sm"
                            aria-label="Previous alert"
                        >
                            <ChevronLeft size={18} />
                        </button>
                    )}

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                            <span
                                aria-label={`Severity ${severity}`}
                                className={cn(
                                    "px-2.5 py-1 rounded-md border font-bold tracking-widest transition-colors",
                                    getSeverityDetails(severity)
                                )}
                            >
                                {severity}
                            </span>

                            {a.event && (
                                <span className="truncate opacity-90 font-semibold text-foreground/80">
                                    {a.event}
                                </span>
                            )}

                            <div className="flex-1" />

                            {/* Pagination Counter: Prominent */}
                            {alerts.length > 1 && (
                                <span className="tabular-nums font-bold text-xs text-foreground/60 bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
                                    {index + 1} <span className="text-white/20 px-0.5">/</span> {alerts.length}
                                </span>
                            )}
                        </div>

                        <div className="group cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : a.id)}>
                            <div className="flex items-start gap-2 mt-2">
                                <h3
                                    className="text-base md:text-lg font-display font-medium tracking-tight text-foreground/90 group-hover:text-foreground transition-colors truncate leading-snug"
                                    aria-expanded={isExpanded}
                                    aria-controls={`alert-panel-${a.id}`}
                                >
                                    {a.headline}
                                </h3>
                                <ChevronDown
                                    size={20}
                                    className={cn(
                                        "text-muted-foreground transition-transform duration-300 mt-0.5",
                                        isExpanded && "rotate-180 text-foreground"
                                    )}
                                />
                            </div>

                            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground uppercase tracking-wider opacity-60">
                                {a.area && <span>{a.area}</span>}
                                {sent && <span>Upd: {sent}</span>}
                                {exp && <span>Exp: {exp}</span>}
                            </div>
                        </div>

                        <div
                            id={`alert-panel-${a.id}`}
                            className={cn(
                                "overflow-hidden transition-all duration-300 ease-out",
                                isExpanded ? "max-h-[500px] opacity-100 mt-4" : "max-h-0 opacity-0"
                            )}
                        >
                            <div className="text-sm text-foreground/80 leading-relaxed space-y-3 pb-2 border-t border-white/5 pt-3 font-body">
                                {a.summary && <p>{a.summary}</p>}
                                {a.instruction && <p className="opacity-70 italic">{a.instruction}</p>}


                            </div>
                        </div>

                        {/* Pagination Dots (Mobile Only) */}
                        {alerts.length > 1 && (
                            <div className="mt-4 flex gap-1.5 md:hidden">
                                {alerts.map((x, i) => (
                                    <div
                                        key={x.id}
                                        className={cn(
                                            "h-1 rounded-full transition-all duration-300",
                                            i === index ? "w-6 bg-primary/60" : "w-1.5 bg-white/10"
                                        )}
                                    />
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Desktop Nav: Next */}
                    {alerts.length > 1 && (
                        <button
                            type="button"
                            onClick={() => setIndex((i) => clamp(i + 1, 0, alerts.length - 1))}
                            disabled={index === alerts.length - 1}
                            className="hidden md:flex mt-0.5 p-2 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-20 disabled:hover:bg-white/5 transition-all text-white/90 shadow-sm"
                            aria-label="Next alert"
                        >
                            <ChevronRight size={18} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
