import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

/** True inside the desktop app; false in a plain browser (future web build). */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function openExternal(url: string) {
  if (isTauri) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export const appWindow = {
  minimize: () => isTauri && getCurrentWindow().minimize(),
  toggleMaximize: () => isTauri && getCurrentWindow().toggleMaximize(),
  close: () => (isTauri ? getCurrentWindow().close() : window.close()),
  async setFullscreen(on: boolean) {
    if (isTauri) return getCurrentWindow().setFullscreen(on);
    if (on) await document.documentElement.requestFullscreen?.();
    else if (document.fullscreenElement) await document.exitFullscreen();
  },
  async isFullscreen() {
    return isTauri ? getCurrentWindow().isFullscreen() : !!document.fullscreenElement;
  },
  attention: () => isTauri && getCurrentWindow().requestUserAttention(2),
};

export interface SharedFile {
  id: string;
  path: string;
  name: string;
  mime: string;
  size: number;
}

/** Bridge to the Rust media registry. Files stay on this PC; the webview reads them by id. */
export const localMedia = {
  available: isTauri,
  pick: () => invoke<SharedFile[]>('media_pick'),
  takeDropped: () => invoke<SharedFile[]>('media_take_dropped'),
  saveBytes: (name: string, bytes: Uint8Array) =>
    invoke<SharedFile>('media_save_bytes', bytes, { headers: { 'x-file-name': encodeURIComponent(name) } }),
  read: (id: string, offset: number, length: number) => invoke<ArrayBuffer>('media_read', { id, offset, length }),
  stat: (id: string) => invoke<SharedFile | null>('media_stat', { id }),
  missing: () => invoke<string[]>('media_missing'),
  forget: (id: string) => invoke<void>('media_forget', { id }),
  src: (path: string) => convertFileSrc(path),
};
