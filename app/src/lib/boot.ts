/**
 * Crash recovery, loaded before anything else (main.tsx imports it first, so it runs before
 * the stores read what's saved).
 *
 * Every start is marked as "not yet healthy" and becomes healthy once the app has been up for a
 * few seconds (or closes normally). A start that never got there counts as a crash. After two
 * in a row, Infimeety starts in Safe Mode: your settings and the last open screen are set aside
 * (kept, to bring back), so whatever broke it isn't loaded again. You stay signed in.
 */

const BOOT_KEY = 'infimeety.boot';
const SETTINGS_KEY = 'infimeety.settings';
const BACKUP_KEY = 'infimeety.settings.safe-backup';
/** Saved on this device but safe to drop: the app rebuilds them. The sign-in and shared files stay. */
const RESETTABLE = ['infimeety.settings', 'infimeety.selection', 'infimeety.partySettings', 'infimeety.partyVolume', 'infimeety.recentEmoji', BACKUP_KEY];

interface BootMark {
  crashes: number;
  healthy: boolean;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or full storage: recovery just won't kick in */
  }
}

const previous = read<BootMark>(BOOT_KEY) ?? { crashes: 0, healthy: true };
/** Starts in a row that crashed before becoming healthy, this one not counted. */
export const recentCrashes = previous.healthy ? 0 : previous.crashes + 1;
const asked = typeof location !== 'undefined' && new URLSearchParams(location.search).has('safe');

export const safeMode = asked || recentCrashes >= 2;

if (safeMode) {
  try {
    // Keep the first backup if Safe Mode starts again before it's resolved.
    const settings = localStorage.getItem(SETTINGS_KEY);
    if (settings && !localStorage.getItem(BACKUP_KEY)) localStorage.setItem(BACKUP_KEY, settings);
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem('infimeety.selection');
  } catch {
    /* nothing to set aside */
  }
}

write(BOOT_KEY, { crashes: recentCrashes, healthy: false } satisfies BootMark);

let settled = false;

/** The app is up and working: the next start is a normal one. */
export function markHealthy() {
  if (settled) return;
  settled = true;
  write(BOOT_KEY, { crashes: 0, healthy: true } satisfies BootMark);
}

/** The whole app fell over (the last-resort error screen): the next start counts it. */
export function markCrashed() {
  settled = true;
  write(BOOT_KEY, { crashes: recentCrashes, healthy: false } satisfies BootMark);
}

/** Restarts in Safe Mode now, from the error screen. */
export function restartInSafeMode() {
  const url = new URL(location.href);
  url.searchParams.set('safe', '1');
  location.replace(url);
}

export const hasSettingsBackup = () => !!localStorage.getItem(BACKUP_KEY);

/** Leaves Safe Mode, putting your own settings back. */
export function restoreSettings() {
  try {
    const backup = localStorage.getItem(BACKUP_KEY);
    if (backup) localStorage.setItem(SETTINGS_KEY, backup);
    localStorage.removeItem(BACKUP_KEY);
  } catch {
    /* keep the defaults */
  }
  markHealthy();
  reloadNormally();
}

/** Leaves Safe Mode and keeps the default settings. */
export function keepDefaults() {
  try {
    localStorage.removeItem(BACKUP_KEY);
  } catch {
    /* already gone */
  }
  markHealthy();
  reloadNormally();
}

/** "Reset Infimeety": settings and remembered screens go back to new; you stay signed in. */
export function resetApp() {
  try {
    for (const key of RESETTABLE) localStorage.removeItem(key);
  } catch {
    /* nothing stored */
  }
  write(BOOT_KEY, { crashes: 0, healthy: true } satisfies BootMark);
  reloadNormally();
}

function reloadNormally() {
  const url = new URL(location.href);
  url.searchParams.delete('safe');
  location.replace(url);
}

// A normal close is a healthy one, even if it came quickly.
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => !settled && markHealthy());
