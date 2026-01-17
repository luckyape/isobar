/**
 * ModelBadgeIcon - Visual indicator for model-specific data access
 * Model color dots (ECMWF, GFS, ICON, GEM)
 */

import { cn } from '@/lib/utils';

interface ModelBadgeIconProps {
    className?: string;
    open?: boolean;
}

// Standardized model colors in canonical order: ECMWF, GFS, ICON, GEM
const MODEL_COLORS = [
    'oklch(0.72 0.19 160)', // ECMWF - Green
    'oklch(0.70 0.16 280)', // GFS - Purple  
    'oklch(0.75 0.18 85)',  // ICON - Amber
    'oklch(0.75 0.15 195)'  // GEM - Arctic cyan
];

export function ModelBadgeIcon({ className, open = false }: ModelBadgeIconProps) {
    return (
        <div
            className={cn(
                "inline-flex items-center justify-center origin-center",
                className
            )}
            style={{
                transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
                transitionProperty: 'transform',
                transitionDuration: '200ms',
                transitionTimingFunction: 'ease-out',
                willChange: 'transform'
            }}
            aria-hidden="true"
        >
            <div className="inline-flex gap-0.5">
                {MODEL_COLORS.map((color, index) => (
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
