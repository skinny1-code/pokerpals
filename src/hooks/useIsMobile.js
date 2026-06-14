// src/hooks/useIsMobile.js
// Runtime device/viewport detection. SSR-safe: returns false on the server and
// on first client render, then resolves after mount so it never causes a
// hydration mismatch. Tracks the live viewport via matchMedia, so it updates
// when a phone rotates or a desktop window is resized across the breakpoint.
'use client';
import { useState, useEffect } from 'react';

// Matches the 640px breakpoint used by the CSS media queries in globals.css,
// keeping JS-driven and CSS-driven responsive behavior in sync.
export const MOBILE_BREAKPOINT = 640;
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT}px)`;

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange(); // sync immediately on mount
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** True when the viewport is phone-sized (≤640px). */
export function useIsMobile() {
  return useMediaQuery(MOBILE_QUERY);
}
