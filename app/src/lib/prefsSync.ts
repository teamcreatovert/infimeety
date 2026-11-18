import type { UserPrefs } from '../../../shared/protocol';
import { api } from './api';
import { useAuth } from '@/stores/auth';
import { ACCENTS, WALLPAPERS, useSettings, type Accent, type Wallpaper } from '@/stores/settings';

/**
 * The look someone picks (theme, accent, wallpaper) follows their account: signing in on
 * another computer, the browser or a phone shows the same. The account's choice wins when it
 * arrives; a change here is saved to the account a moment later.
 */
let applying = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastSent = '';

const pick = (s: ReturnType<typeof useSettings.getState>): UserPrefs => ({ theme: s.theme, accent: s.accent, wallpaper: s.wallpaper });

function apply(prefs: UserPrefs | undefined) {
  if (!prefs) return;
  const patch: Partial<ReturnType<typeof useSettings.getState>> = {};
  if (prefs.theme) patch.theme = prefs.theme;
  if (prefs.accent && prefs.accent in ACCENTS) patch.accent = prefs.accent as Accent;
  if (prefs.wallpaper && prefs.wallpaper in WALLPAPERS) patch.wallpaper = prefs.wallpaper as Wallpaper;
  if (!Object.keys(patch).length) return;
  applying = true;
  useSettings.getState().set(patch);
  applying = false;
  lastSent = JSON.stringify(pick(useSettings.getState()));
}

export function startPrefsSync() {
  // Signed in (or a fresh copy of the account arrived): take its look.
  apply(useAuth.getState().me?.prefs);
  useAuth.subscribe((s, prev) => {
    if (s.me && s.me.prefs !== prev.me?.prefs) apply(s.me.prefs);
  });
  useSettings.subscribe((s, prev) => {
    if (applying || !useAuth.getState().me || useAuth.getState().me?.guest) return;
    if (s.theme === prev.theme && s.accent === prev.accent && s.wallpaper === prev.wallpaper) return;
    const json = JSON.stringify(pick(s));
    if (json === lastSent) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      lastSent = json;
      void api('/me/prefs', { method: 'PUT', json: JSON.parse(json) }).catch(() => (lastSent = ''));
    }, 800);
  });
}
