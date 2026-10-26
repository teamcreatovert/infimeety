import { invoke } from '@tauri-apps/api/core';
import { toast } from '@/stores/ui';

/**
 * The phone app (Android and iPhone) is the web app in a native shell: calls, chat and watch
 * parties work exactly as in a phone's browser. The shell adds what a WebView can't do on its
 * own: links open in the real browser, sign-in comes back to the app, and copies of friends'
 * files are saved where the phone's Files app finds them.
 */
const platform = import.meta.env.TAURI_ENV_PLATFORM as string | undefined;
export const isPhoneApp = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window && (platform === 'android' || platform === 'ios');

/** Where saved copies show up, for messages. */
export const savedPlace = platform === 'ios' ? 'Files › On My iPhone › Infimeety' : 'Downloads › Infimeety';

const CHUNK = 4 * 1024 * 1024;

/** Saves a finished copy to the phone (a WebView can't do a browser download). */
export async function saveOnPhone(file: Blob, name: string) {
  let id: number | null = null;
  try {
    const opened = await invoke<{ id: number; name: string }>('save_open', { name });
    id = opened.id;
    for (let at = 0; at < file.size; at += CHUNK) {
      const bytes = new Uint8Array(await file.slice(at, at + CHUNK).arrayBuffer());
      await invoke('save_write', bytes, { headers: { 'x-save': String(id) } });
    }
    await invoke('save_close', { id, ok: true });
    toast({ kind: 'success', title: `Saved ${opened.name}`, body: `In ${savedPlace}.` });
  } catch (err) {
    if (id !== null) await invoke('save_close', { id, ok: false }).catch(() => {});
    toast({ kind: 'error', title: `Couldn’t save ${name}`, body: String(err) });
  }
}

/** Links to other sites open in the phone's browser; inside the app they would go nowhere. */
export function startPhoneApp() {
  if (!isPhoneApp) return;
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || e.defaultPrevented) return;
    const url = new URL(a.href, location.href);
    if (url.origin === location.origin || !/^(https?|mailto):$/.test(url.protocol)) return;
    e.preventDefault();
    void import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(url.href));
  });
}
