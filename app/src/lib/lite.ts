import { useSettings } from '@/stores/settings';

/**
 * Lite mode: slow PCs (few cores or little memory) get the app without glass, blur or
 * animations, the costliest things it draws. 'auto' decides from the hardware; a setting overrides.
 */
export function isWeakDevice() {
  const cores = navigator.hardwareConcurrency || 8;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return cores <= 4 || memory <= 4;
}

export const liteOn = (lite: 'auto' | 'on' | 'off') => lite === 'on' || (lite === 'auto' && isWeakDevice());

/** Keeps the page's data-lite in step with the setting (styles.css). */
export function watchLite() {
  const apply = () => document.documentElement.toggleAttribute('data-lite', liteOn(useSettings.getState().lite));
  apply();
  useSettings.subscribe((s, prev) => s.lite !== prev.lite && apply());
}
