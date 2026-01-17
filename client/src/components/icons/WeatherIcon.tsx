import React from 'react';
import { WeatherIcons, type WeatherIconName } from '../../icons/weather';
import { cn } from '@/lib/utils';

export interface WeatherIconProps extends React.SVGProps<SVGSVGElement> {
    name: WeatherIconName;
    className?: string;
    title?: string;
}

export const WeatherIcon: React.FC<WeatherIconProps> = ({ name, className, title, ...props }) => {
    const Icon = WeatherIcons[name];

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
            {...props}
        >
            {title && <title>{title}</title>}
        </Icon>
    );
};
