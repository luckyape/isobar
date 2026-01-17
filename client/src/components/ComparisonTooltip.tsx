import { Children } from 'react';
import { cn } from '@/lib/utils';

export function ComparisonTooltipCard({
  title,
  children,
  className,
  isUnverified
}: {
  title: string;
  children?: React.ReactNode;
  className?: string;
  isUnverified?: boolean;
}) {
  const hasChildren = Children.count(children) > 0;
  return (
    <div
      className={cn(
        'glass-card p-3 text-sm max-w-[min(85vw,22rem)] break-words',
        className
      )}
    >
      <p className={cn('font-semibold', hasChildren && 'mb-2')}>{title}</p>
      {hasChildren ? children : null}
      {isUnverified && (
        <div className="mt-2 pt-2 border-t border-white/10 text-[10px] text-amber-400/80 font-mono text-right">
          UNVERIFIED
        </div>
      )}
    </div>
  );
}

export function ComparisonTooltipSection({
  children,
  divider = false,
  className
}: {
  children: React.ReactNode;
  divider?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'space-y-1',
        divider && 'mt-2 pt-2 border-t border-white/10',
        className
      )}
    >
      {children}
    </div>
  );
}

export function ComparisonTooltipRow({
  label,
  value,
  icon,
  labelClassName,
  valueClassName
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  labelClassName?: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-2 min-w-0">
        {icon}
        <span className={cn('text-foreground/80 truncate', labelClassName)}>
          {label}
        </span>
      </div>
      <span className={cn('font-mono text-right', valueClassName)}>{value}</span>
    </div>
  );
}

