import React from 'react';
import { WeatherIcons, WeatherIconName } from '../../icons/weather';
import { WeatherIconsFill } from '../../icons/weather-fill';
import { cn } from '@/lib/utils';

export interface WeatherIconProps extends React.SVGProps<SVGSVGElement> {
    name: WeatherIconName;
    className?: string;
    title?: string;
    isStatic?: boolean;
    variant?: 'line' | 'fill';
}

export const WeatherIcon: React.FC<WeatherIconProps> = ({ name, className, title, isStatic, variant = 'line', ...props }) => {
    const Icon = variant === 'fill' ? WeatherIconsFill[name] : WeatherIcons[name];

    if (!Icon) {
        console.warn(`WeatherIcon: "${name}" not found.`);
        return null;
    }

    return (
        <Icon
            className={cn("w-6 h-6", className)}
            aria-label={title}
            role={title ? "img" : "presentation"}
            aria-hidden={!title}
            isStatic={isStatic}
            {...props}
        >
            {title && <title>{title}</title>}
        </Icon>
    );
};
