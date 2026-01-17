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
      icon: 'text-3xl sm:text-5xl',
      value: 'text-5xl sm:text-7xl',
      valueLabel: 'text-[clamp(2.25rem,5vw,4.25rem)] sm:text-[clamp(3rem,4vw,5.25rem)]',
      unit: 'text-2xl sm:text-4xl',
      desc: 'text-[10px] sm:text-sm',
      iconMargin: 'mb-1 sm:mb-2',
      descMargin: 'mt-1 sm:mt-2'
    }
    : {
      icon: 'text-2xl sm:text-4xl',
      value: 'text-4xl sm:text-6xl',
      valueLabel: 'text-[clamp(1.85rem,4.2vw,3.25rem)] sm:text-[clamp(2.35rem,3.2vw,3.75rem)]',
      unit: 'text-xl sm:text-3xl',
      desc: 'text-[9px] sm:text-xs',
      iconMargin: 'mb-0.5 sm:mb-1.5',
      descMargin: 'mt-0.5 sm:mt-1.5'
    };

  return (
    <div className={cn('flex flex-col items-center text-center', className)}>
      <div className={cn(sizeStyles.icon, sizeStyles.iconMargin, 'opacity-80 leading-none')}>
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
          <div className="flex items-baseline justify-center">
            <span className={cn('font-mono font-bold tracking-tighter drop-shadow-lg leading-none', sizeStyles.value)}>
              {displayValue}
            </span>
            {displayUnit && numericValue !== null && (
              <span className={cn('ml-1 align-top font-medium opacity-50', sizeStyles.unit)}>
                {displayUnit}
              </span>
            )}
            {accessory && (
              <span className="ml-2 flex items-center">
                {accessory}
              </span>
            )}
          </div>
        )
      )}
      <div className={cn('font-bold uppercase tracking-[0.14em] opacity-50 leading-none', sizeStyles.desc, sizeStyles.descMargin)}>
        {description ?? '—'}
      </div>
    </div>
  );
}
