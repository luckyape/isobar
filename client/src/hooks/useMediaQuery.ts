/**
 * useMediaQuery Hook - Arctic Data Observatory
 *
 * Canonical media query hook for responsive behavior.
 * Consolidates the previously duplicated use-media-query.ts and useMobile.tsx.
 */

import { useEffect, useState } from 'react';

/**
 * Mobile breakpoint in pixels.
 * Matches Tailwind's `md` breakpoint.
 */
export const MOBILE_BREAKPOINT = 768;

/**
 * Subscribe to a CSS media query and return whether it matches.
 *
 * @param query - CSS media query string, e.g. "(min-width: 768px)"
 * @returns `true` if the query matches, `false` otherwise
 *
 * @example
 * const isLargeScreen = useMediaQuery('(min-width: 1024px)');
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);

    // Support legacy browsers without addEventListener on MediaQueryList
    const supportsAddEventListener =
      typeof (media as { addEventListener?: unknown }).addEventListener === 'function';

    update();

    if (supportsAddEventListener) {
      media.addEventListener('change', update);
    } else {
      media.addListener(update);
    }

    return () => {
      if (supportsAddEventListener) {
        media.removeEventListener('change', update);
      } else {
        media.removeListener(update);
      }
    };
  }, [query]);

  return matches;
}

/**
 * Convenience hook that returns `true` when viewport is below mobile breakpoint.
 *
 * @returns `true` if viewport width < 768px
 *
 * @example
 * const isMobile = useIsMobile();
 */
export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
}
