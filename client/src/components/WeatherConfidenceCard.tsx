import { motion } from 'framer-motion';
import {
  ChevronDown,
  Cloud,
  Droplets,
  Thermometer,
  Wind
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

export interface WeatherConfidenceCardProps {
  location: { name: string; region: string };
  current: { temp: number; condition: string; icon: string };
  overallConfidence: number;
  freshness?: number | null;
  categories: {
    temp: number;
    precip: number;
    wind: number;
    cloud: number;
  };
  modelCount: number;
  updatedAt: string;
}

type ConfidenceTone = {
  textClass: string;
  stroke: string;
  bandLabel: string;
  glow: string;
};

type RingTone = {
  stroke: string;
  glow: string;
};

const CONFIDENCE_TONES: Record<'high' | 'moderate' | 'low', ConfidenceTone> = {
  high: {
    textClass: 'text-teal-300',
    stroke: 'oklch(0.76 0.11 160)',
    bandLabel: 'High',
    glow: 'oklch(0.76 0.11 160 / 0.22)'
  },
  moderate: {
    textClass: 'text-amber-300',
    stroke: 'oklch(0.78 0.11 85)',
    bandLabel: 'Moderate',
    glow: 'oklch(0.78 0.11 85 / 0.2)'
  },
  low: {
    textClass: 'text-rose-400',
    stroke: 'oklch(0.70 0.12 25)',
    bandLabel: 'Low',
    glow: 'oklch(0.70 0.12 25 / 0.22)'
  }
};

const FRESHNESS_TONES: Record<'high' | 'moderate' | 'low', RingTone> = {
  high: {
    stroke: 'oklch(0.72 0.19 160)',
    glow: 'oklch(0.72 0.19 160 / 0.18)'
  },
  moderate: {
    stroke: 'oklch(0.75 0.18 85)',
    glow: 'oklch(0.75 0.18 85 / 0.18)'
  },
  low: {
    stroke: 'oklch(0.65 0.22 25)',
    glow: 'oklch(0.65 0.22 25 / 0.18)'
  }
};

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function getConfidenceTone(value: number): ConfidenceTone {
  const safeValue = clampPercent(value);
  if (safeValue >= 80) return CONFIDENCE_TONES.high;
  if (safeValue >= 50) return CONFIDENCE_TONES.moderate;
  return CONFIDENCE_TONES.low;
}

function getFreshnessTone(value: number): RingTone {
  const safeValue = clampPercent(value);
  if (safeValue >= 80) return FRESHNESS_TONES.high;
  if (safeValue >= 50) return FRESHNESS_TONES.moderate;
  return FRESHNESS_TONES.low;
}

function RingGauge({
  value,
  size,
  strokeWidth,
  trackColor,
  progressColor,
  progressGlow,
  delay = 0,
  ariaLabel,
  children
}: {
  value: number;
  size: number;
  strokeWidth: number;
  trackColor: string;
  progressColor: string;
  progressGlow?: string;
  delay?: number;
  ariaLabel?: string;
  children?: ReactNode;
}) {
  const safeValue = clampPercent(value);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (safeValue / 100) * circumference;

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
    >
      <svg
        width={size}
        height={size}
        className="-rotate-90"
        viewBox={`0 0 ${size} ${size}`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={progressColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          style={progressGlow ? { filter: `drop-shadow(0 0 12px ${progressGlow})` } : undefined}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - progress }}
          transition={{ duration: 1.2, ease: 'easeOut', delay }}
        />
      </svg>
      {children && (
        <div className="absolute inset-0 flex items-center justify-center">
          {children}
        </div>
      )}
    </div>
  );
}

function renderCurrentIcon(icon: string, condition: string) {
  if (icon.startsWith('http') || icon.includes('/')) {
    return (
      <img
        src={icon}
        alt={condition}
        className="h-16 w-16 object-contain drop-shadow"
      />
    );
  }

  return (
    <span className="text-5xl leading-none drop-shadow" aria-hidden="true">
      {icon}
    </span>
  );
}

export function WeatherConfidenceCard({
  location,
  current,
  overallConfidence,
  freshness = null,
  categories,
  modelCount,
  updatedAt
}: WeatherConfidenceCardProps) {
  const [expanded, setExpanded] = useState(false);
  const overallPercent = Math.round(clampPercent(overallConfidence));
  const overallTone = getConfidenceTone(overallPercent);
  const trackColor = 'rgba(148, 163, 184, 0.16)';
  const freshnessTrackColor = 'rgba(148, 163, 184, 0.12)';
  const freshnessPercent = Number.isFinite(freshness ?? NaN)
    ? clampPercent(freshness as number)
    : null;
  const freshnessTone = freshnessPercent !== null
    ? getFreshnessTone(freshnessPercent)
    : null;
  const ringSize = 200;
  const outerRingSize = ringSize + 24;
  const outerRingStroke = 4;
  const tempTone = getConfidenceTone(categories.temp);
  const precipTone = getConfidenceTone(categories.precip);
  const windTone = getConfidenceTone(categories.wind);
  const cloudTone = getConfidenceTone(categories.cloud);

  const categoryItems = [
    {
      key: 'temp',
      label: 'Temperature',
      value: categories.temp,
      icon: Thermometer,
      tone: tempTone
    },
    {
      key: 'precip',
      label: 'Precipitation',
      value: categories.precip,
      icon: Droplets,
      tone: precipTone
    },
    {
      key: 'wind',
      label: 'Wind',
      value: categories.wind,
      icon: Wind,
      tone: windTone
    },
    {
      key: 'cloud',
      label: 'Conditions',
      value: categories.cloud,
      icon: Cloud,
      tone: cloudTone
    }
  ];

  const confidenceAriaLabel =
    `Confidence: ${overallTone.bandLabel} (${overallPercent}%). Based on ${modelCount} models.` +
    (freshnessPercent !== null
      ? ` Model freshness ${Math.round(freshnessPercent)}%.`
      : ' Model freshness unavailable.');

  return (
    <div className="rounded-3xl border border-white/10 bg-[#0B1120] p-6 text-slate-100 shadow-[0_24px_60px_rgba(5,8,18,0.45)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold leading-none">
            {location.name}
          </h2>
          <p className="mt-1 text-sm text-slate-400">{location.region}</p>
        </div>
      </div>

      <div className="mt-6 flex flex-col items-center text-center">
        <div
          className="relative flex items-center justify-center"
          style={{ width: outerRingSize, height: outerRingSize }}
        >
          {freshnessPercent !== null && freshnessTone && (
            <div className="absolute">
              <RingGauge
                size={outerRingSize}
                strokeWidth={outerRingStroke}
                trackColor={freshnessTrackColor}
                progressColor={freshnessTone.stroke}
                progressGlow={freshnessTone.glow}
                value={freshnessPercent}
              />
            </div>
          )}
          <RingGauge
            size={ringSize}
            strokeWidth={6}
            trackColor={trackColor}
            progressColor={overallTone.stroke}
            progressGlow={overallTone.glow}
            value={overallPercent}
            ariaLabel={confidenceAriaLabel}
          >
            <div className="flex flex-col items-center gap-2">
              {renderCurrentIcon(current.icon, current.condition)}
              <div className="text-5xl font-semibold leading-none">
                {Math.round(current.temp)}
                {'\u00B0'}
              </div>
              <div className="text-sm text-slate-300">{current.condition}</div>
            </div>
          </RingGauge>
        </div>

        <div className="mt-4 flex flex-col items-center gap-1">
          <span className={`text-sm font-medium ${overallTone.textClass}`}>
            Confidence: {overallTone.bandLabel} ({overallPercent}%)
          </span>
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-slate-400 transition hover:text-slate-200"
            aria-expanded={expanded}
            aria-controls="confidence-breakdown"
            onClick={() => setExpanded((prev) => !prev)}
          >
            Based on {modelCount} models
            <ChevronDown
              className={`h-3.5 w-3.5 transition ${
                expanded ? 'rotate-180' : ''
              }`}
              aria-hidden="true"
            />
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
          {categoryItems.map((item, index) => {
            const Icon = item.icon;
            return (
              <RingGauge
                key={`${item.key}-icon-ring`}
                value={item.value}
                size={48}
                strokeWidth={4}
                trackColor={trackColor}
                progressColor={item.tone.stroke}
                progressGlow={item.tone.glow}
                delay={0.1 + index * 0.05}
                ariaLabel={`${Math.round(clampPercent(item.value))}% ${item.label} agreement`}
              >
                <Icon className="h-4 w-4 text-slate-200" aria-hidden="true" />
              </RingGauge>
            );
          })}
        </div>
      </div>

      {expanded && (
        <div
          id="confidence-breakdown"
          className="mt-5 border-t border-white/10 pt-4"
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {categoryItems.map((item, index) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.key}
                  className="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2"
                >
                  <RingGauge
                    value={item.value}
                    size={52}
                    strokeWidth={4}
                    trackColor={trackColor}
                    progressColor={item.tone.stroke}
                    delay={0.05 + index * 0.05}
                    ariaLabel={`${Math.round(clampPercent(item.value))}% ${item.label} agreement`}
                  >
                    <Icon className="h-4 w-4 text-slate-200" aria-hidden="true" />
                  </RingGauge>
                  <div className="space-y-1">
                    <div className="text-[11px] text-slate-400">
                      {item.label}
                    </div>
                    <div className="text-sm font-semibold text-slate-100">
                      {Math.round(clampPercent(item.value))}%
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 text-xs text-slate-400">
            Updated {updatedAt}
          </div>
        </div>
      )}
    </div>
  );
}
