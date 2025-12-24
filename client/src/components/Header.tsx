import { memo } from 'react';
import { CloudSnow, RefreshCw, ChevronDown } from 'lucide-react';
import { LocationSearch } from '@/components/LocationSearch';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { ComparisonTooltipCard } from '@/components/ComparisonTooltip';
import type { Location } from '@/lib/weatherApi';

interface HeaderProps {
  location: Location | null;
  isOffline: boolean;
  isLoading: boolean;
  onLocationSelect: (location: Location) => void;
  onRefresh: (options: { force: boolean; userInitiated: boolean }) => void;
}

const TOOLTIP_CONTENT_CLASSNAME = 'p-0 bg-transparent shadow-none border-none text-foreground [&>svg]:hidden';

const Header = memo(({ location, isOffline, isLoading, onLocationSelect, onRefresh }: HeaderProps) => {
  const handleRefreshClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const force = event.altKey || event.metaKey || event.ctrlKey || event.shiftKey;
    onRefresh({ force, userInitiated: true });
  };

  return (
    <header className="relative z-20 border-b border-white/10 backdrop-blur-sm">
      <div className="container flex items-center justify-between h-16">
        <div className="flex items-baseline gap-3">
          <CloudSnow className="w-7 h-7 text-primary" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Weather Consensus</h1>
            <p className="text-xs text-foreground/70 -mt-1 hidden sm:block">Multi-Model Forecast Agreement</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <LocationSearch 
            currentLocation={location} 
            onLocationSelect={onLocationSelect}
            disabled={isOffline}
          />
          {isOffline && (
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-wide text-foreground/70">
              Offline
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={handleRefreshClick}
                disabled={isLoading || isOffline}
                className="glass-card border-white/10 h-9 w-9"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className={TOOLTIP_CONTENT_CLASSNAME}>
              <ComparisonTooltipCard title="Refresh forecasts" />
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </header>
  );
});

Header.displayName = 'Header';

export { Header };
