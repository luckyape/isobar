import { useState, useEffect } from 'react';
import { Star, Check, Search, MapPin, Loader2, X, ChevronDown, Crown } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerTrigger, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { searchLocations, CANADIAN_CITIES, type Location } from '@/lib/weatherApi';
import { hasEverSetPrimary, markPrimaryAsSet } from '@/lib/locationStore';
import { PrimaryLocationDialog } from '@/components/PrimaryLocationDialog';
import { ComparisonTooltipCard } from '@/components/ComparisonTooltip';
import { cn } from '@/lib/utils';

const TOOLTIP_CONTENT_CLASSNAME = 'p-0 bg-transparent shadow-none border-none text-foreground [&>svg]:hidden';

const FAVORITES_STORAGE_KEY = 'weather-consensus-favorites';

interface FavoriteLocation extends Location {
  id: string;
  addedAt: string;
}

const generateLocationId = (location: Location): string => {
  return `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;
};

interface LocationSearchProps {
  currentLocation: Location | null;
  primaryLocation?: Location | null;
  onLocationSelect: (location: Location) => void;
  onSetPrimary?: (location: Location) => void;
  disabled?: boolean;
}

export function LocationSearch({ currentLocation, primaryLocation, onLocationSelect, onSetPrimary, disabled = false }: LocationSearchProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Location[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteLocation[]>([]);
  const isDesktop = useMediaQuery('(min-width: 768px)');

  // Confirmation dialog state
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [pendingPrimaryLocation, setPendingPrimaryLocation] = useState<Location | null>(null);

  useEffect(() => {
    try {
      const storedFavorites = localStorage.getItem(FAVORITES_STORAGE_KEY);
      if (storedFavorites) {
        setFavorites(JSON.parse(storedFavorites));
      }
    } catch (error) {
      console.error('Failed to load favorites:', error);
    }
  }, []);

  const saveFavorites = (newFavorites: FavoriteLocation[]) => {
    setFavorites(newFavorites);
    try {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(newFavorites));
    } catch (error) {
      console.error('Failed to save favorites:', error);
    }
  };

  const toggleFavorite = (location: Location) => {
    const id = generateLocationId(location);
    const isFavorite = favorites.some(fav => fav.id === id);
    if (isFavorite) {
      saveFavorites(favorites.filter(fav => fav.id !== id));
    } else {
      const newFavorite: FavoriteLocation = { ...location, id, addedAt: new Date().toISOString() };
      saveFavorites([newFavorite, ...favorites]);
    }
  };

  /**
   * Handle "Set as Primary" click with confirmation flow:
   * - First time: set immediately + show toast
   * - Changing: show confirmation dialog
   */
  const handleSetPrimary = (location: Location) => {
    if (!onSetPrimary) return;

    // First time setting primary - no confirmation needed
    if (!hasEverSetPrimary()) {
      onSetPrimary(location);
      markPrimaryAsSet();
      toast.success(`${location.name} is now your Primary Location`, {
        description: 'Observations will start collecting here.',
        duration: 4000,
      });
      return;
    }

    // Changing primary - show confirmation dialog
    setPendingPrimaryLocation(location);
    setConfirmDialogOpen(true);
  };

  /**
   * Handle confirmation of Primary Location change
   */
  const handleConfirmPrimary = () => {
    if (!onSetPrimary || !pendingPrimaryLocation) return;

    onSetPrimary(pendingPrimaryLocation);
    toast.success(`${pendingPrimaryLocation.name} is now your Primary Location`, {
      description: 'Observations will start collecting here.',
      duration: 4000,
    });
    setPendingPrimaryLocation(null);
  };

  useEffect(() => {
    if (disabled) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    const timer = setTimeout(async () => {
      if (query.length >= 2) {
        setIsSearching(true);
        const locations = await searchLocations(query);
        setSearchResults(locations);
        setIsSearching(false);
      } else {
        setSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, disabled]);

  const handleSelect = (location: Location) => {
    onLocationSelect(location);
    const id = generateLocationId(location);
    if (!favorites.some(fav => fav.id === id)) {
      const newFavorite: FavoriteLocation = { ...location, id, addedAt: new Date().toISOString() };
      saveFavorites([newFavorite, ...favorites]);
    }
    setIsOpen(false);
    setQuery('');
  };

  const LocationTrigger = (
    <Button
      variant="outline"
      disabled={disabled}
      role="combobox"
      aria-expanded={isOpen}
      aria-label="Select a location"
      className="group glass-card border-white/10 hover:border-primary/50 transition-colors gap-2 h-9 px-3 w-48 justify-start">
      <MapPin className="w-4 h-4 text-primary shrink-0" />
      <div className="flex-1 text-left min-w-0">
        <p className="font-medium truncate text-sm">
          {currentLocation?.name || 'Select Location'}
        </p>
      </div>
      <ChevronDown className="w-4 h-4 text-foreground/70 group-hover:text-foreground transition-colors" />
    </Button>
  );

  const LocationContent = (
    <div className={cn(isDesktop ? 'w-[400px]' : 'h-[80vh]')}>
      <Command shouldFilter={false} loop>
        <div className={cn('p-3 border-b border-white/10', isDesktop ? '' : 'sticky top-0 bg-background/95 backdrop-blur-xl z-10')}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/70" />
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Search Canadian cities..."
              className="pl-10 pr-10 bg-background/50 border-white/10 h-11 focus:border-primary/50"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/70 hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        <CommandList className="max-h-[calc(80vh-100px)] px-2 pb-2">
          {isSearching && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            </div>
          )}
          {!isSearching && query.length >= 2 && searchResults.length === 0 && (
            <p className="text-center text-sm text-foreground/80 py-4">No locations found.</p>
          )}
          {query.length >= 2 && searchResults.length > 0 && (
            <CommandGroup heading="Search Results">
              {searchResults.map(location => (
                <LocationItem key={generateLocationId(location)} location={location} onSelect={handleSelect} isFavorite={favorites.some(f => f.id === generateLocationId(location))} onFavoriteToggle={toggleFavorite} isSelected={currentLocation?.name === location.name} isPrimary={primaryLocation ? generateLocationId(location) === generateLocationId(primaryLocation) : false} onSetPrimary={handleSetPrimary} />
              ))}
            </CommandGroup>
          )}
          {favorites.length > 0 && !query && (
            <CommandGroup heading="Favorites">
              {favorites.map(fav => (
                <LocationItem key={fav.id} location={fav} onSelect={handleSelect} isFavorite onFavoriteToggle={toggleFavorite} isSelected={currentLocation?.name === fav.name} isPrimary={primaryLocation ? generateLocationId(fav) === generateLocationId(primaryLocation) : false} onSetPrimary={handleSetPrimary} />
              ))}
            </CommandGroup>
          )}
          {!query && favorites.length === 0 && (
            <CommandGroup heading="Popular Cities">
              {CANADIAN_CITIES.slice(0, 5).map(location => (
                <LocationItem key={generateLocationId(location)} location={location} onSelect={handleSelect} isFavorite={false} onFavoriteToggle={toggleFavorite} isSelected={currentLocation?.name === location.name} isPrimary={primaryLocation ? generateLocationId(location) === generateLocationId(primaryLocation) : false} onSetPrimary={handleSetPrimary} />
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </div>
  );

  if (isDesktop) {
    return (
      <>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>{LocationTrigger}</DialogTrigger>
          <DialogContent className="p-0 w-auto glass-card bg-background/90 backdrop-blur-xl border-white/15 shadow-2xl">
            {LocationContent}
          </DialogContent>
        </Dialog>
        {primaryLocation && pendingPrimaryLocation && (
          <PrimaryLocationDialog
            open={confirmDialogOpen}
            onOpenChange={setConfirmDialogOpen}
            currentPrimary={primaryLocation}
            newLocation={pendingPrimaryLocation}
            onConfirm={handleConfirmPrimary}
          />
        )}
      </>
    );
  }

  return (
    <>
      <Drawer open={isOpen} onOpenChange={setIsOpen}>
        <DrawerTrigger asChild>{LocationTrigger}</DrawerTrigger>
        <DrawerContent className="bg-background/95 backdrop-blur-xl border-t border-white/15">
          <DrawerHeader className="text-left sr-only">
            <DrawerTitle>Select a Location</DrawerTitle>
          </DrawerHeader>
          {LocationContent}
        </DrawerContent>
      </Drawer>
      {primaryLocation && pendingPrimaryLocation && (
        <PrimaryLocationDialog
          open={confirmDialogOpen}
          onOpenChange={setConfirmDialogOpen}
          currentPrimary={primaryLocation}
          newLocation={pendingPrimaryLocation}
          onConfirm={handleConfirmPrimary}
        />
      )}
    </>
  );
}

interface LocationItemProps {
  location: Location;
  onSelect: (location: Location) => void;
  isFavorite: boolean;
  onFavoriteToggle: (location: Location) => void;
  isSelected: boolean;
  isPrimary: boolean;
  onSetPrimary?: (location: Location) => void;
}

function LocationItem({ location, onSelect, isFavorite, onFavoriteToggle, isSelected, isPrimary, onSetPrimary }: LocationItemProps) {
  return (
    <CommandItem
      onSelect={() => onSelect(location)}
      value={`${location.name} ${location.province}`}
      className="group flex items-center">
      {isSelected ? <Check className="w-4 h-4 mr-3 text-primary" /> : <MapPin className="w-4 h-4 mr-3 text-foreground/70" />}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium truncate">{location.name}</p>
          {isPrimary && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-primary/20 text-primary">
              <Crown className="w-3 h-3" />
              Primary
            </span>
          )}
        </div>
        <p className="text-sm text-foreground/80 truncate">
          {location.province && `${location.province}, `}{location.country}
        </p>
      </div>
      {/* Set as Primary button - only show if not already primary and handler exists */}
      {!isPrimary && onSetPrimary && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-foreground/60 hover:text-foreground md:opacity-0 md:group-hover:opacity-100 transition-opacity"
              aria-label={`Set ${location.name} as primary location`}
              onClick={(e) => {
                e.stopPropagation();
                onSetPrimary(location);
              }}>
              Set Primary
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className={TOOLTIP_CONTENT_CLASSNAME}>
            <ComparisonTooltipCard title="Set Primary">
              <p className="text-xs text-foreground/70">Collect observations for deeper weather analysis over time.</p>
            </ComparisonTooltipCard>
          </TooltipContent>
        </Tooltip>
      )}
      <Button
        variant="ghost"
        size="icon"
        className={cn("w-8 h-8 -mr-2", isFavorite ? 'text-primary' : 'text-foreground/70')}
        aria-label={isFavorite ? `Remove ${location.name} from favorites` : `Add ${location.name} to favorites`}
        onClick={(e) => {
          e.stopPropagation();
          onFavoriteToggle(location);
        }}>
        <Star className={cn("w-5 h-5", isFavorite && 'fill-current')} />
      </Button>
    </CommandItem>
  );
}
