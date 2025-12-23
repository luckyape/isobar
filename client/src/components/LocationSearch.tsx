/**
 * LocationSearch Component - Arctic Data Observatory
 * Search and select Canadian locations for weather forecasts
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, MapPin, X, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { searchLocations, CANADIAN_CITIES, type Location } from '@/lib/weatherApi';

interface LocationSearchProps {
  currentLocation: Location | null;
  onLocationSelect: (location: Location) => void;
  disabled?: boolean;
}

export function LocationSearch({ currentLocation, onLocationSelect, disabled = false }: LocationSearchProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Location[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Search locations when query changes
  useEffect(() => {
    if (disabled) {
      setResults([]);
      setIsSearching(false);
      return;
    }
    const timer = setTimeout(async () => {
      if (query.length >= 2) {
        setIsSearching(true);
        const locations = await searchLocations(query);
        setResults(locations);
        setIsSearching(false);
      } else {
        setResults([]);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, disabled]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (disabled && isOpen) {
      setIsOpen(false);
    }
  }, [disabled, isOpen]);

  const handleSelect = (location: Location) => {
    onLocationSelect(location);
    setIsOpen(false);
    setQuery('');
    setResults([]);
  };

  const displayLocations = query.length >= 2 ? results : CANADIAN_CITIES.slice(0, 8);

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <Button
        variant="outline"
        onClick={() => {
          if (disabled) return;
          setIsOpen(true);
        }}
        disabled={disabled}
        className="glass-card border-white/10 hover:border-primary/50 transition-colors gap-2 h-12 px-4"
      >
        <MapPin className="w-4 h-4 text-primary" />
        <span className="font-medium">
          {currentLocation?.name || 'Select Location'}
        </span>
        {currentLocation?.province && (
          <span className="text-foreground/80 text-sm">
            , {currentLocation.province}
          </span>
        )}
      </Button>

      {/* Search dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="absolute top-full left-0 mt-2 w-80 glass-card bg-background/95 backdrop-blur-xl border-white/15 shadow-2xl ring-1 ring-white/5 p-3 z-[120] readable-text"
          >
            {/* Search input */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/70" />
              <Input
                ref={inputRef}
                type="text"
                placeholder="Search Canadian cities..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-10 pr-10 bg-background/50 border-white/10 focus:border-primary/50"
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

            {/* Results list */}
            <div className="max-h-64 overflow-y-auto space-y-1">
              {isSearching ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                </div>
              ) : displayLocations.length > 0 ? (
                <>
                  {query.length < 2 && (
                    <p className="text-xs text-foreground/80 px-2 py-1 uppercase tracking-wider">
                      Popular Cities
                    </p>
                  )}
                  {displayLocations.map((location, index) => (
                    <motion.button
                      key={`${location.name}-${location.latitude}-${index}`}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.03 }}
                      onClick={() => handleSelect(location)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors text-left group"
                    >
                      <MapPin className="w-4 h-4 text-foreground/70 group-hover:text-primary transition-colors" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{location.name}</p>
                        <p className="text-sm text-foreground/80 truncate">
                          {location.province && `${location.province}, `}
                          {location.country}
                        </p>
                      </div>
                    </motion.button>
                  ))}
                </>
              ) : query.length >= 2 ? (
                <p className="text-center text-foreground/80 py-8">
                  No locations found
                </p>
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
