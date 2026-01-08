/**
 * ForecastConsole Component (Decomposed Gauges Layout)
 * 
 * Forecast-first layout with:
 * - Hero temperature display (dominant)
 * - Confidence summary line (tappable)
 * - Four small category agreement gauges
 * 
 * No large enclosing rings. Clean, analytical, enterprise-grade.
 */

import { useCallback, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Thermometer, Droplets, Wind, Cloud, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getConfidenceLevel, type ConsensusMetrics } from '@/lib/consensus';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ForecastDisplay } from '@/components/ForecastDisplay';
import { ModelBadgeIcon } from '@/components/ModelBadgeIcon';

// ─────────────────────────────────────────────────────────────────────────────
// Types & Props
// ─────────────────────────────────────────────────────────────────────────────

interface DualRingGaugeProps {
    /** Overall agreement score 0-100 */
    score: number;
    /** Per-category consensus metrics */
    metrics?: ConsensusMetrics | null;
    /** Forecast data to display in center */
    forecast?: {
        temperature: number;
        icon: React.ReactNode;
        description: string;
    };
    /** Called when model detail caret is tapped */
    onModelDetailsToggle?: () => void;
    /** Whether model details are currently open */
    modelDetailsOpen?: boolean;
    /** aria-controls id for model detail panel */
    modelDetailsControlsId?: string;
    /** aria-label for model detail caret */
    modelDetailsLabel?: string;
    /** Size variant */
    size?: 'sm' | 'md' | 'lg';
    /** Called when a category gauge is tapped */
    onCategoryTap?: (key: string) => void;
    /** Active category key for detail view */
    activeCategoryKey?: string | null;
    /** Called when the overall agreement line is tapped */
    onOverallTap?: () => void;
    /** Whether consensus is unavailable */
    isUnavailable?: boolean;
    /** Additional class names */
    className?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// Category definitions
const CATEGORIES: Array<{
    key: keyof ConsensusMetrics;
    label: string;
    shortLabel: string;
    icon: LucideIcon;
    ariaLabel: string;
}> = [
        { key: 'temperature', label: 'Temperature', shortLabel: 'Temp', icon: Thermometer, ariaLabel: 'Open temperature agreement details for this hour' },
        { key: 'precipitation', label: 'Precipitation (POP + amount)', shortLabel: 'Precip', icon: Droplets, ariaLabel: 'Open precipitation agreement details for this hour' },
        { key: 'wind', label: 'Wind', shortLabel: 'Wind', icon: Wind, ariaLabel: 'Open wind agreement details for this hour' },
        { key: 'conditions', label: 'Conditions', shortLabel: 'Cond', icon: Cloud, ariaLabel: 'Open conditions agreement details for this hour' },
    ];

// Semantic agreement colors
const AGREEMENT_COLORS = {
    high: { stroke: 'oklch(0.72 0.19 160)', text: 'text-green-400', bg: 'bg-green-500/15' },
    medium: { stroke: 'oklch(0.75 0.18 85)', text: 'text-yellow-400', bg: 'bg-yellow-500/15' },
    low: { stroke: 'oklch(0.65 0.22 25)', text: 'text-red-400', bg: 'bg-red-500/15' },
    neutral: { stroke: 'oklch(0.45 0.02 240)', text: 'text-foreground/50', bg: 'bg-white/5' },
};

// Track color
const TRACK_COLOR = 'oklch(0.25 0.02 240 / 50%)';

// Small gauge dimensions
const GAUGE_SIZE = 48;
const GAUGE_STROKE = 4;

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

function getAgreementLevel(value: number | undefined, isUnavailable: boolean): keyof typeof AGREEMENT_COLORS {
    if (isUnavailable || !Number.isFinite(value)) return 'neutral';
    const v = value as number;
    if (v >= 70) return 'high';
    if (v >= 40) return 'medium';
    return 'low';
}

function getConfidenceLabel(value: number): string {
    if (value >= 70) return 'High';
    if (value >= 40) return 'Moderate';
    return 'Low';
}

// ─────────────────────────────────────────────────────────────────────────────
// Small Gauge Component
// ─────────────────────────────────────────────────────────────────────────────

interface SmallGaugeProps {
    value: number | undefined;
    label: string;
    shortLabel: string;
    icon: LucideIcon;
    ariaLabel: string;
    isUnavailable: boolean;
    onClick: () => void;
    isActive?: boolean;
}

function SmallGauge({
    value,
    label,
    shortLabel,
    icon: Icon,
    ariaLabel,
    isUnavailable,
    onClick,
    isActive = false
}: SmallGaugeProps) {
    const reduceMotion = useReducedMotion();
    const [isHovered, setIsHovered] = useState(false);

    const safeValue = Number.isFinite(value) ? Math.round(value as number) : 0;
    const level = getAgreementLevel(value, isUnavailable);
    const colors = AGREEMENT_COLORS[level];

    const radius = (GAUGE_SIZE - GAUGE_STROKE) / 2;
    const circumference = 2 * Math.PI * radius;
    const arcLength = isUnavailable ? 0 : (safeValue / 100) * circumference;
    const center = GAUGE_SIZE / 2;

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    className={cn(
                        "flex flex-col items-center gap-1.5 p-2 rounded-lg transition-all outline-none",
                        "focus-visible:ring-2 focus-visible:ring-white/30",
                        "hover:bg-white/5 active:scale-95",
                        (isHovered || isActive) && "bg-white/5"
                    )}
                    onClick={onClick}
                    onMouseEnter={() => setIsHovered(true)}
                    onMouseLeave={() => setIsHovered(false)}
                    aria-label={ariaLabel}
                    aria-pressed={isActive}
                >
                    {/* Small Circular Gauge */}
                    <div className="relative">
                        <svg width={GAUGE_SIZE} height={GAUGE_SIZE} className="transform -rotate-90">
                            {/* Track */}
                            <circle
                                cx={center}
                                cy={center}
                                r={radius}
                                fill="none"
                                stroke={TRACK_COLOR}
                                strokeWidth={GAUGE_STROKE}
                            />
                            {/* Progress Arc */}
                            <motion.circle
                                cx={center}
                                cy={center}
                                r={radius}
                                fill="none"
                                stroke={colors.stroke}
                                strokeWidth={GAUGE_STROKE}
                                strokeLinecap="round"
                                strokeDasharray={circumference}
                                initial={{ strokeDashoffset: circumference }}
                                animate={{ strokeDashoffset: circumference - arcLength }}
                                transition={{ duration: reduceMotion ? 0 : 0.8, ease: 'easeOut' }}
                            />
                        </svg>
                        {/* Icon in Center */}
                        <div className="absolute inset-0 flex items-center justify-center">
                            <Icon className="w-4 h-4 text-foreground/60" />
                        </div>
                    </div>

                    {/* Value + Label */}
                    <div className="flex flex-col items-center">
                        <span className={cn("text-sm font-bold tabular-nums", colors.text)}>
                            {isUnavailable ? '—' : safeValue}
                        </span>
                        <span className="text-[10px] text-foreground/50 uppercase tracking-wide">
                            {shortLabel}
                        </span>
                    </div>
                </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
                {label}: {isUnavailable ? 'Unavailable' : `${safeValue}% agreement`}
            </TooltipContent>
        </Tooltip>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function DualRingGauge({
    score,
    metrics = null,
    forecast,
    size = 'md',
    onCategoryTap,
    onOverallTap,
    activeCategoryKey = null,
    onModelDetailsToggle,
    modelDetailsOpen = false,
    modelDetailsControlsId,
    modelDetailsLabel = 'Show individual model forecasts',
    isUnavailable = false,
    className,
}: DualRingGaugeProps) {
    // Overall agreement
    const safeScore = Number.isFinite(score) ? Math.round(score) : 0;
    const overallLevel = getAgreementLevel(score, isUnavailable);
    const overallColors = AGREEMENT_COLORS[overallLevel];
    const overallLabel = isUnavailable ? 'Unavailable' : getConfidenceLabel(safeScore);

    const handleCategoryClick = useCallback((key: string) => {
        onCategoryTap?.(key);
    }, [onCategoryTap]);

    const handleOverallClick = useCallback(() => {
        onOverallTap?.();
    }, [onOverallTap]);

    const modelDetailsToggle = onModelDetailsToggle ? (
        <button
            type="button"
            onClick={onModelDetailsToggle}
            className={cn(
                'ml-2 inline-flex items-center justify-center rounded-full text-foreground/60 transition-colors outline-none',
                'hover:text-foreground focus-visible:ring-2 focus-visible:ring-white/30'
            )}
            aria-label={modelDetailsLabel}
            aria-expanded={modelDetailsOpen}
            aria-controls={modelDetailsControlsId}
        >
            <span aria-hidden="true">
                <ModelBadgeIcon
                    className={cn(
                        'transition-opacity',
                        modelDetailsOpen ? 'opacity-100' : 'opacity-70'
                    )}
                />
            </span>
        </button>
    ) : null;

    return (
        <div className={cn('flex flex-col items-center', className)}>
            {/* Hero Forecast Display */}
            {forecast && (
                <ForecastDisplay
                    temperature={forecast.temperature}
                    icon={forecast.icon}
                    description={forecast.description}
                    accessory={modelDetailsToggle}
                    size="hero"
                    className="mb-4"
                />
            )}

            {/* Agreement Containment Card — Groups aggregate score with component gauges */}
            <div className={cn(
                "relative rounded-xl py-3 px-4",
                "bg-white/[0.03] border border-white/[0.06]",
                "backdrop-blur-sm",
                "shadow-[0_2px_12px_-4px_oklch(0_0_0/25%),inset_0_1px_0_oklch(1_0_0/3%)]"
            )}>
                {/* Aggregate Agreement Header (Tappable) */}
                <button
                    className={cn(
                        "w-full flex items-center justify-center gap-1.5",
                        "py-1 rounded-lg text-sm font-medium transition-all outline-none",
                        "hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-white/30",
                        "active:scale-[0.98]"
                    )}
                    onClick={handleOverallClick}
                    aria-label="Open aggregate agreement details"
                >
                    {/* Σ Summation Icon — indicates computed aggregate */}
                    <span
                        className="font-mono text-[11px] text-foreground/40 select-none"
                        aria-hidden="true"
                    >
                        Σ
                    </span>
                    <span className="text-foreground/60 text-[13px]">Agreement</span>
                    <span className={cn("font-bold tabular-nums", overallColors.text)}>
                        {isUnavailable ? 'N/A' : safeScore}
                    </span>
                    <span className="text-foreground/50 text-[13px]">·</span>
                    <span className={cn("font-medium text-[13px]", overallColors.text)}>
                        {isUnavailable ? '' : overallLabel}
                    </span>
                </button>

                {/* Separator — visual link between aggregate and components */}
                {metrics && (
                    <div
                        className="mx-2 my-2 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent"
                        role="separator"
                        aria-hidden="true"
                    />
                )}

                {/* Category Component Gauges */}
                {metrics && (
                    <div className="flex items-center justify-center gap-1">
                        {CATEGORIES.map((category) => (
                            <SmallGauge
                                key={category.key}
                                value={metrics[category.key]}
                                label={category.label}
                                shortLabel={category.shortLabel}
                                icon={category.icon}
                                ariaLabel={category.ariaLabel}
                                isUnavailable={isUnavailable}
                                isActive={activeCategoryKey === category.key}
                                onClick={() => handleCategoryClick(category.key)}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
