import { cn } from '@/lib/utils';
import { ModelFlag } from '@/components/ModelFlag';
import type { WeatherModel } from '@/lib/weatherApi';

interface ModelEmblemProps {
    model: WeatherModel | { name: string; color: string; countryCode?: string };
    className?: string;
    iconClassName?: string;
    textClassName?: string;
    flagClassName?: string;
}

export function ModelEmblem({
    model,
    className,
    iconClassName,
    textClassName,
    flagClassName
}: ModelEmblemProps) {
    return (
        <div className={cn("inline-flex items-center gap-1.5", className)}>
            <span
                className={cn("h-2.5 w-2.5 shrink-0 rounded-[1px] triangle-icon", iconClassName)}
                style={{ backgroundColor: model.color }}
            />
            <span className={cn("font-medium text-[11px] leading-none text-foreground/80 pt-[1px]", textClassName)}>
                {model.name}
            </span>
            {model.countryCode && (
                <ModelFlag
                    countryCode={model.countryCode}
                    className={cn("h-2.5 w-auto shrink-0 opacity-70", flagClassName)}
                />
            )}
        </div>
    );
}
