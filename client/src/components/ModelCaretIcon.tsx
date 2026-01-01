import { cn } from '@/lib/utils';

interface ModelCaretIconProps {
  className?: string;
  color: string;
  dotCount?: number;
}

export function ModelCaretIcon({
  className,
  color,
  dotCount = 4
}: ModelCaretIconProps) {
  return (
    <div
      className={cn('inline-flex items-center gap-1.5', className)}
      aria-hidden="true"
    >
      <div
        className="w-2 h-2 triangle-icon rotate-90"
        style={{ backgroundColor: color }}
      />
      <div className="inline-flex gap-0.5">
        {Array.from({ length: dotCount }, (_, index) => (
          <div
            key={index}
            className="w-1 h-1 rounded-full"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
    </div>
  );
}

