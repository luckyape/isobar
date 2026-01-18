
import { cn } from '@/lib/utils';
import CAFlag from '@/icons/flags/ca.svg';
import USFlag from '@/icons/flags/us.svg';
import EUFlag from '@/icons/flags/eu.svg';
import DEFlag from '@/icons/flags/de.svg';

interface ModelFlagProps {
    countryCode?: string;
    className?: string;
}

const FLAG_MAP: Record<string, string> = {
    CA: CAFlag,
    US: USFlag,
    EU: EUFlag,
    DE: DEFlag,
};

export function ModelFlag({ countryCode, className }: ModelFlagProps) {
    if (!countryCode) return null;

    const flagSrc = FLAG_MAP[countryCode];
    if (!flagSrc) return null;

    return (
        <img
            src={flagSrc}
            alt={`${countryCode} Flag`}
            className={cn("inline-block rounded-[1px] object-cover border border-white/10 shadow-sm", className)}
            style={{ aspectRatio: '4/3' }}
        />
    );
}
