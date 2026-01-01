/**
 * ModelBadgeIcon - Visual indicator for model-specific data access
 * Side-caret design: right-pointing triangle + model color dots
 */

import { cn } from '@/lib/utils';

interface ModelBadgeIconProps {
    className?: string;
}

// Standardized model colors in canonical order: ECMWF, GFS, ICON, GEM
const MODEL_COLORS = [
    'oklch(0.72 0.19 160)', // ECMWF - Green
    'oklch(0.70 0.16 280)', // GFS - Purple  
    'oklch(0.75 0.18 85)',  // ICON - Amber
    'oklch(0.75 0.15 195)'  // GEM - Arctic cyan
];

export function ModelBadgeIcon({ className }: ModelBadgeIconProps) {
    return (
        <div
            className={cn(
                "inline-flex items-center gap-1.5",
                className
            )}
            aria-label="View model breakdown"
        >
            <div
                className="w-2 h-2 triangle-icon rotate-90"
                style={{ backgroundColor: 'oklch(0.75 0.15 195)' }} // Arctic cyan
            />

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
