import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ForecastDisplayProps {
  temperature?: number | null;
  value?: number | null;
  valueLabel?: string | null;
  unit?: string;
  precision?: number;
  hideValue?: boolean;
  icon?: ReactNode;
  description?: string | null;
  accessory?: ReactNode;
  size?: 'card' | 'hero';
  className?: string;
}

export function ForecastDisplay({
  temperature,
  value,
  valueLabel,
  unit,
  precision = 0,
  hideValue = false,
  icon,
  description,
  accessory,
  size = 'card',
  className
}: ForecastDisplayProps) {
  const resolvedValue = value ?? temperature;
  const hasCustomValue = value !== undefined;
  const displayUnit = unit ?? (hasCustomValue ? '' : '°');
  const normalizedPrecision = Number.isFinite(precision ?? NaN)
    ? Math.max(0, Math.min(Math.round(precision), 3))
    : 0;
  const numericValue = Number.isFinite(resolvedValue ?? NaN) ? (resolvedValue as number) : null;
  const roundedValue = numericValue === null
    ? null
    : Math.round(numericValue * 10 ** normalizedPrecision) / 10 ** normalizedPrecision;
  const formattedValue = roundedValue === null ? null : roundedValue.toFixed(normalizedPrecision);
  const hasValueLabel = valueLabel !== undefined && valueLabel !== null;
  const displayValue = hasValueLabel
    ? valueLabel
    : formattedValue !== null
      ? formattedValue
      : '—';
  const sizeStyles = size === 'hero'
    ? {
      icon: 'w-48 h-48 sm:w-64 sm:h-64 text-primary/10 mix-blend-overlay',
      value: 'relative z-10 text-7xl sm:text-9xl font-black text-foreground drop-shadow-[0_15px_15px_rgba(0,0,0,0.4)]',
      valueLabel: 'relative z-10 text-[clamp(2.25rem,5vw,4.25rem)] sm:text-[clamp(3rem,4vw,5.25rem)] text-foreground',
      unit: 'relative z-10 text-3xl sm:text-5xl text-foreground/80',
      desc: 'relative z-10 text-xs sm:text-sm font-bold tracking-[0.3em] text-foreground/70 drop-shadow-md',
      iconMargin: '-mb-24 sm:-mb-32',
      descMargin: 'mt-0'
    }
    : {
      icon: 'text-2xl sm:text-4xl text-foreground/80',
      value: 'text-4xl sm:text-6xl text-foreground',
      valueLabel: 'text-[clamp(1.85rem,4.2vw,3.25rem)] sm:text-[clamp(2.35rem,3.2vw,3.75rem)] text-foreground',
      unit: 'text-xl sm:text-3xl text-foreground/50',
      desc: 'text-[9px] sm:text-xs text-foreground/50',
      iconMargin: 'mb-0.5 sm:mb-1.5',
      descMargin: 'mt-0.5 sm:mt-1.5'
    };

  return (
    <div className={cn('flex flex-col items-center text-center', className)}>
      <div className={cn(sizeStyles.icon, sizeStyles.iconMargin, 'leading-none flex items-center justify-center transition-all duration-500 ease-out')}>
        {icon ?? '—'}
      </div>
      {!hideValue && (
        hasValueLabel ? (
          <div className="w-full">
            <div
              className={cn(
                'font-sans font-bold tracking-tight drop-shadow-lg text-balance whitespace-normal break-words hyphens-auto leading-[0.95]',
                sizeStyles.valueLabel
              )}
            >
              {displayValue}
            </div>
            {accessory && (
              <div className="mt-2 flex justify-center">
                {accessory}
              </div>
            )}
          </div>
        ) : (
          <div className="relative inline-flex items-center justify-center">
            {/* Value & Unit Group - Centered */}
            <div className="flex items-baseline z-20">
              <span className={cn('font-mono font-bold tracking-tighter drop-shadow-2xl leading-none filter', sizeStyles.value)}>
                {displayValue}
              </span>
              {displayUnit && numericValue !== null && (
                <span className={cn('ml-1 align-top font-medium opacity-60 drop-shadow-lg', sizeStyles.unit)}>
                  {displayUnit}
                </span>
              )}
            </div>

            {/* Accessory - Absolute positioned relative to the centered block */}
            {accessory && (
              <div className={cn(
                "absolute left-full top-1/2 -translate-y-1/2",
                size === 'hero' ? "pl-6" : "pl-2"
              )}>
                {accessory}
              </div>
            )}
          </div>
        )
      )}
      <div className={cn('uppercase leading-none', sizeStyles.desc, sizeStyles.descMargin)}>
        {description ?? '—'}
      </div>
    </div >
  );
}
