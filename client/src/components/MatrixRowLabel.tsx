import { cn } from '@/lib/utils';

type MatrixRowType = 'model' | 'consensus' | 'observed';

export function MatrixRowLabel({
  label,
  type,
  color,
  available,
  labelTint
}: {
  label: string;
  type: MatrixRowType;
  color?: string;
  available: boolean;
  labelTint?: string;
}) {
  return (
    <div
      className={cn(
        'h-8 flex items-center justify-end gap-2 px-[1px] py-[2px] rounded-sm',
        !available && 'text-foreground/40'
      )}
      style={labelTint ? { background: labelTint } : undefined}
    >
      {type === 'model' && (
        <span
          className="h-2.5 w-2.5 triangle-icon"
          style={{ backgroundColor: color }}
        />
      )}
      <span>{label}</span>
      {!available && type === 'observed' && (
        <span className="text-[10px] text-foreground/40">
          Unavailable
        </span>
      )}
    </div>
  );
}
