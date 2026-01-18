import React from 'react';
import { cn } from '@/lib/utils';

type MatrixRowType = 'model' | 'consensus' | 'observed';

export function MatrixRowLabel({
  label,
  type,
  color,
  available,
  labelTint,
  unavailableReason,
  countryCode
}: {
  label: string;
  type: MatrixRowType;
  color?: string;
  available: boolean;
  labelTint?: string;
  unavailableReason?: string;
  countryCode?: string;
}) {
  return (
    <div
      className={cn(
        'h-8 flex items-center justify-end gap-2 px-[1px] py-[2px] rounded-sm',
        !available && 'text-foreground/40'
      )}
      style={labelTint ? { background: labelTint } : undefined}
    >
      {type === 'model' && color && (
        <span
          className="h-2 w-2 triangle-icon"
          style={{ backgroundColor: color }}
        />
      )}
      <span>{label}</span>
      {!available && type === 'observed' && unavailableReason && (
        <span
          className="text-[10px] text-foreground/40"
          title={unavailableReason}
        >
          – {unavailableReason}
        </span>
      )}
    </div>
  );
}
