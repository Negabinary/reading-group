import { useCallback, useState } from 'react';
import { isDemo } from './api';

export const LAST_VISIT_KEY = `mplse.last-visit.${isDemo ? 'demo' : 'live'}.v1`;

function lastVisit(now: number): number | null {
  try {
    const value = localStorage.getItem(LAST_VISIT_KEY);
    const time = value ? Date.parse(value) : NaN;
    return Number.isFinite(time) && time <= now ? time : null;
  } catch {
    return null;
  }
}

export function useVisit() {
  // Capture once. Refreshes and votes must not clear the current New view.
  const [visit] = useState(() => {
    const openedAt = Date.now();
    const previous = lastVisit(openedAt);
    return { since: previous ?? openedAt, returning: previous !== null };
  });
  const recordVisit = useCallback((requestedAt: number) => {
    try {
      // Do not move backwards when another tab has already refreshed.
      const latest = lastVisit(Date.now());
      localStorage.setItem(
        LAST_VISIT_KEY,
        new Date(Math.max(latest ?? requestedAt, requestedAt)).toISOString(),
      );
    } catch {
      // Browsing still works when browser storage is unavailable.
    }
  }, []);
  return { ...visit, recordVisit };
}
