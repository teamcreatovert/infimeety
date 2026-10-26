import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isPhoneApp } from './phone';
import { webMedia } from './webMedia';

export { isPhoneApp };
/** True inside the desktop app; false in a plain browser (the web app) and in the phone app. */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window && !isPhoneApp;
/** Inside one of the Infimeety apps (desktop or phone) rather than a browser tab. */
export const isApp = isTauri || isPhoneApp;

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
export const isWindows = /Windows/.test(ua);
/** A Mac (iPads also report "Macintosh", so check for touch). */
export const isMac = /Macintosh/.test(ua) && !(typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
/** Phones and tablets: no screen sharing, touch instead of hover, and a smaller screen. */
export const isMobile = /Android|iPhone|iPad|iPod|Mobile/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
/** Whether this browser can share its screen at all (phones can't). */
export const canShareScreen = typeof navigator !== 'undefined' && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices && !isMobile;

export async function openExternal(url: string) {
  if (isApp) {
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

/** An incoming copy being written to disk, piece by piece and in any order. */
export interface ReceiveTarget {
  /** Where it's going, to show the user. */
  where: string;
  write: (offset: number, data: Uint8Array) => Promise<void>;
  /** Finishes the copy (or with ok=false throws it away). The copy is then shared on from this device. */
  close: (ok: boolean) => Promise<SharedFile | null>;
}

export interface SharedFile {
  id: string;
  path: string;
  name: string;
  mime: string;
  size: number;
}

/** Bridge to the Rust media registry. Files stay on this PC; the webview reads them by id. */
const desktopMedia = {
  available: true,
  pick: () => invoke<SharedFile[]>('media_pick'),
  /** Shares a whole folder; it copies over as one and unpacks back into a folder. */
  pickFolder: () => invoke<SharedFile[]>('media_pick_folder'),
  takeDropped: () => invoke<SharedFile[]>('media_take_dropped'),
  saveBytes: (name: string, bytes: Uint8Array) =>
    invoke<SharedFile>('media_save_bytes', bytes, { headers: { 'x-file-name': encodeURIComponent(name) } }),
  read: (id: string, offset: number, length: number) => invoke<ArrayBuffer>('media_read', { id, offset, length }),
  stat: (id: string) => invoke<SharedFile | null>('media_stat', { id }),
  missing: () => invoke<string[]>('media_missing'),
  forget: (id: string) => invoke<void>('media_forget', { id }),
  src: (path: string) => convertFileSrc(path),
  /** Shows the file in Explorer / Finder. */
  reveal: (id: string) => invoke<void>('media_reveal', { id }),
};

/** Where your shared files live: on disk in the desktop app, in the browser's storage on the web. */
export const localMedia: typeof desktopMedia = isTauri ? desktopMedia : webMedia;
