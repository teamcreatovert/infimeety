import type { Update } from '@tauri-apps/plugin-updater';
import { create } from 'zustand';
import { isTauri } from './platform';

type Status = 'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'uptodate' | 'error' | 'unsupported';

interface UpdaterState {
  status: Status;
  update: Update | null;
  progress: number;
  error: string | null;
  dismissed: boolean;
  /** The check at start: 'pending' keeps the update screen up until it's done. */
  launch: 'pending' | 'done';
  launchCheck: () => Promise<void>;
  check: (manual?: boolean) => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
}

/**
 * Updates, Discord-style: every start looks for a new version first and installs it before the
 * app opens, so everyone is on the latest. The app checks a signed `latest.json`, downloads the
 * new installer, installs it silently and relaunches. The session lives in the WebView profile,
 * which updates never touch, so users stay signed in. While it runs, it checks again every half
 * hour and offers a restart.
 */
export const useUpdater = create<UpdaterState>()((set, get) => ({
  status: 'idle',
  update: null,
  progress: 0,
  error: null,
  dismissed: false,
  launch: isTauri && !import.meta.env.DEV ? 'pending' : 'done',

  async launchCheck() {
    if (get().launch === 'done') return;
    // Offline or slow: open the app after a few seconds rather than keep everyone waiting.
    await Promise.race([get().check(), new Promise((r) => setTimeout(r, 8000))]);
    if (get().status === 'available') return get().install();
    set({ launch: 'done' });
  },

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
      // A failed update at start still opens the app; it tries again next time.
      set({ status: 'error', error: String(err), launch: 'done' });
    }
  },

  dismiss: () => set({ dismissed: true }),
}));

let started = false;

export function startUpdateChecks() {
  if (started || !isTauri) return;
  started = true;
  void useUpdater.getState().launchCheck();
  setInterval(() => void useUpdater.getState().check(), 30 * 60_000);
}
