import { useSyncExternalStore } from 'react';

/** Phones, and phones held sideways. Keep in sync with the `compact` variant in styles.css. */
const COMPACT = '(max-width: 767.98px), (max-height: 499.98px)';

const query = typeof window !== 'undefined' ? window.matchMedia(COMPACT) : null;

export const isCompactNow = () => !!query?.matches;

const subscribe = (fn: () => void) => {
  query?.addEventListener('change', fn);
  return () => query?.removeEventListener('change', fn);
};

/** True while the window is phone-sized: one pane at a time, sheets instead of side panels. */
export function useCompact() {
  return useSyncExternalStore(subscribe, isCompactNow, () => false);
}
