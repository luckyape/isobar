/**
 * ConfidenceGauge Component - Arctic Data Observatory
 * Circular gauge showing overall model agreement score
 */

import { motion } from 'framer-motion';
import { Thermometer, Droplets, Wind, Cloud } from 'lucide-react';
import type { ConsensusMetrics } from '@/lib/consensus';
import { getConfidenceLevel } from '@/lib/consensus';
import {
  ComparisonTooltipCard,
  ComparisonTooltipRow,
  ComparisonTooltipSection
} from '@/components/ComparisonTooltip';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface ConfidenceGaugeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  isUnavailable?: boolean;
  overviewText?: string | null;
  metrics?: ConsensusMetrics | null;
  className?: string;
}

export function ConfidenceGauge({
  score,
  size = 'md',
  showLabel = true,
  isUnavailable = false,
  overviewText = null,
  metrics = null,
  className
}: ConfidenceGaugeProps) {
  const safeScore = Number.isFinite(score) ? score : 0;
  const confidence = isUnavailable
    ? { label: 'Consensus Unavailable', description: 'Showing model forecast data.', color: 'neutral' as const }
    : getConfidenceLevel(safeScore);
  const description = overviewText && overviewText.trim().length > 0
    ? overviewText.trim()
    : confidence.description;

  const categories = metrics
    ? [
        { key: 'temperature', label: 'Temperature', icon: Thermometer, value: metrics.temperature },
        { key: 'precipitation', label: 'Precipitation', icon: Droplets, value: metrics.precipitation },
        { key: 'wind', label: 'Wind', icon: Wind, value: metrics.wind },
        { key: 'conditions', label: 'Conditions', icon: Cloud, value: metrics.conditions }
      ]
    : [];
  
  const dimensions = {
    sm: { width: 110, strokeWidth: 7, fontSize: 22 },
    md: { width: 160, strokeWidth: 9, fontSize: 32 },
    lg: { width: 190, strokeWidth: 10, fontSize: 40 }
  };
  
  const { width, strokeWidth, fontSize } = dimensions[size];
  const radius = (width - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = isUnavailable ? 0 : (safeScore / 100) * circumference;
  
  const colorClasses = {
    high: 'text-[oklch(0.72_0.19_160)]',
    medium: 'text-[oklch(0.75_0.18_85)]',
    low: 'text-[oklch(0.65_0.22_25)]',
    neutral: 'text-foreground/80'
  };
  
  const strokeColors = {
    high: 'oklch(0.72 0.19 160)',
    medium: 'oklch(0.75 0.18 85)',
    low: 'oklch(0.65 0.22 25)',
    neutral: 'oklch(0.45 0.02 240)'
  };
  
  const glowColors = {
    high: 'oklch(0.72 0.19 160 / 40%)',
    medium: 'oklch(0.75 0.18 85 / 40%)',
    low: 'oklch(0.65 0.22 25 / 40%)',
    neutral: 'oklch(0.45 0.02 240 / 40%)'
  };

  const categoryDimensions = {
    sm: { width: 52, strokeWidth: 4, iconSize: 16 },
    md: { width: 58, strokeWidth: 4, iconSize: 18 },
    lg: { width: 64, strokeWidth: 5, iconSize: 18 }
  };

  const tooltipContentClassName =
    "p-0 bg-transparent shadow-none border-none text-foreground [&>svg]:hidden";
  const consensusTooltipLabel = `${confidence.label}. ${description}`;
  const gaugeRing = (
    <div
      className={cn(
        "relative",
        showLabel && "cursor-help rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      )}
      style={{ width, height: width }}
      role={showLabel ? "img" : undefined}
      tabIndex={showLabel ? 0 : undefined}
      aria-label={showLabel ? consensusTooltipLabel : undefined}
    >
      {/* Background circle */}
      <svg
        width={width}
        height={width}
        className="transform -rotate-90"
      >
        <circle
          cx={width / 2}
          cy={width / 2}
          r={radius}
          fill="none"
          stroke="oklch(0.25 0.02 240)"
          strokeWidth={strokeWidth}
        />
        {/* Progress circle */}
        <motion.circle
          cx={width / 2}
          cy={width / 2}
          r={radius}
          fill="none"
          stroke={strokeColors[confidence.color]}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - progress }}
          transition={{ duration: 1.5, ease: 'easeOut' }}
          style={{
            filter: `drop-shadow(0 0 8px ${glowColors[confidence.color]})`
          }}
        />
      </svg>
      
      {/* Score display */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span
          className={`font-mono font-semibold ${colorClasses[confidence.color]}`}
          style={{ fontSize }}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.5, duration: 0.5 }}
        >
          {isUnavailable ? '--' : safeScore}
        </motion.span>
        <span className="text-foreground/70 text-xs uppercase tracking-wider">
          Score
        </span>
      </div>
    </div>
  );

  return (
    <div className={cn("flex flex-col items-center gap-4 w-full", className)}>
      {showLabel ? (
        <Tooltip>
          <TooltipTrigger asChild>{gaugeRing}</TooltipTrigger>
          <TooltipContent side="top" className={tooltipContentClassName}>
            <ComparisonTooltipCard title={confidence.label}>
              <p className="text-foreground/80 leading-snug">{description}</p>
            </ComparisonTooltipCard>
          </TooltipContent>
        </Tooltip>
      ) : (
        gaugeRing
      )}

      {categories.length > 0 && (
        <div className="grid w-full grid-cols-2 place-items-center gap-3 sm:grid-cols-4">
          {categories.map((category, index) => {
            const Icon = category.icon;
            const metricValue = !isUnavailable && Number.isFinite(category.value)
              ? Math.round(category.value)
              : null;
            const metricColor = metricValue === null
              ? 'neutral'
              : getConfidenceLevel(metricValue).color;
            const tooltipLabel = metricValue === null
              ? `${category.label} agreement unavailable`
              : `${category.label} agreement ${metricValue}%`;
            const ringWidth = categoryDimensions[size].width;
            const ringStroke = categoryDimensions[size].strokeWidth;
            const ringRadius = (ringWidth - ringStroke) / 2;
            const ringCircumference = 2 * Math.PI * ringRadius;
            const ringProgress = metricValue === null
              ? 0
              : (metricValue / 100) * ringCircumference;

            return (
              <Tooltip key={category.key}>
                <TooltipTrigger asChild>
                  <div
                    className="relative cursor-help rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    style={{ width: ringWidth, height: ringWidth }}
                    role="img"
                    tabIndex={0}
                    aria-label={tooltipLabel}
                  >
                    <svg
                      width={ringWidth}
                      height={ringWidth}
                      className="transform -rotate-90"
                    >
                      <circle
                        cx={ringWidth / 2}
                        cy={ringWidth / 2}
                        r={ringRadius}
                        fill="none"
                        stroke="oklch(0.25 0.02 240)"
                        strokeWidth={ringStroke}
                      />
                      <motion.circle
                        cx={ringWidth / 2}
                        cy={ringWidth / 2}
                        r={ringRadius}
                        fill="none"
                        stroke={strokeColors[metricColor as keyof typeof strokeColors]}
                        strokeWidth={ringStroke}
                        strokeLinecap="round"
                        strokeDasharray={ringCircumference}
                        initial={{ strokeDashoffset: ringCircumference }}
                        animate={{ strokeDashoffset: ringCircumference - ringProgress }}
                        transition={{ duration: 1, delay: index * 0.05, ease: 'easeOut' }}
                        style={{
                          filter: `drop-shadow(0 0 6px ${glowColors[metricColor as keyof typeof glowColors]})`
                        }}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Icon
                        className="text-foreground/80"
                        style={{ width: categoryDimensions[size].iconSize, height: categoryDimensions[size].iconSize }}
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className={tooltipContentClassName}>
                  <ComparisonTooltipCard title={category.label}>
                    <ComparisonTooltipSection>
                      <ComparisonTooltipRow
                        label="Agreement"
                        value={metricValue === null ? 'Unavailable' : `${metricValue}%`}
                      />
                    </ComparisonTooltipSection>
                  </ComparisonTooltipCard>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );
}
