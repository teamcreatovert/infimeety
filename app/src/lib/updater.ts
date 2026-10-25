import type { Update } from '@tauri-apps/plugin-updater';
import { create } from 'zustand';
import { isTauri } from './platform';
import { useSettings } from '@/stores/settings';

type Status = 'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'uptodate' | 'error' | 'unsupported';

interface UpdaterState {
  status: Status;
  update: Update | null;
  progress: number;
  error: string | null;
  dismissed: boolean;
  check: (manual?: boolean) => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
}

/**
 * One-click updates: the app checks a signed `latest.json`, downloads the new installer,
 * installs it silently and relaunches. The session lives in the WebView profile, which
 * updates never touch, so users stay signed in.
 */
export const useUpdater = create<UpdaterState>()((set, get) => ({
  status: 'idle',
  update: null,
  progress: 0,
  error: null,
  dismissed: false,

  async check(manual = false) {
    if (!isTauri || import.meta.env.DEV) {
      if (manual) set({ status: 'unsupported' });
      return;
    }
    if (get().status === 'downloading' || get().status === 'installing') return;
    set({ status: 'checking', error: null });
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update) set({ status: 'available', update, dismissed: false });
      else set({ status: 'uptodate' });
    } catch (err) {
      set({ status: manual ? 'error' : 'idle', error: String(err) });
    }
  },

  async install() {
    const update = get().update;
    if (!update) return;
    let total = 0;
    let done = 0;
    set({ status: 'downloading', progress: 0 });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') total = event.data.contentLength ?? 0;
        else if (event.event === 'Progress') {
          done += event.data.chunkLength;
          set({ progress: total ? done / total : 0 });
        } else if (event.event === 'Finished') set({ status: 'installing', progress: 1 });
      });
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (err) {
      set({ status: 'error', error: String(err) });
    }
  },

  dismiss: () => set({ dismissed: true }),
}));

let started = false;

export function startUpdateChecks() {
  if (started || !isTauri) return;
  started = true;
  setTimeout(() => void useUpdater.getState().check(), 5000);
  setInterval(() => {
    if (useSettings.getState().autoUpdate) void useUpdater.getState().check();
  }, 30 * 60_000);
}
