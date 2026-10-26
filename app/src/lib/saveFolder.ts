import { invoke } from '@tauri-apps/api/core';
import { isTauri, type ReceiveTarget, type SharedFile } from './platform';
import { canPickFolder, kv, receiveWeb } from './webMedia';
import { useSettings } from '@/stores/settings';

/**
 * Where copies of friends' files are saved. The desktop app asks once for a folder (say
 * C:\Infimeety) and saves everything there; Chrome and Edge do the same with a folder the
 * user grants. Other browsers keep copies in their own storage and download them at the end.
 */

type Granting = FileSystemDirectoryHandle & {
  queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
};
type Picker = (o: { id?: string; mode?: 'readwrite'; startIn?: string }) => Promise<FileSystemDirectoryHandle>;

const HANDLE_KEY = 'saveFolder';
/** This visit's copy of the handle (also kept in IndexedDB for next time). */
let current: Granting | null = null;

/** Can copies go into a folder the user picks here? (Always in the app; Chrome and Edge on the web.) */
export const canChooseFolder = isTauri || canPickFolder;

/** Asks for the save folder. Returns its path (app) or name (browser), or null if cancelled. */
export async function chooseSaveFolder(): Promise<string | null> {
  if (isTauri) {
    const path = await invoke<string | null>('media_choose_folder', { title: 'Choose where Infimeety saves copied files' });
    if (path) useSettings.getState().set({ saveFolder: path });
    return path;
  }
  if (!canPickFolder) return null;
  try {
    const handle = await (window as unknown as { showDirectoryPicker: Picker }).showDirectoryPicker({ id: 'infimeety-copies', mode: 'readwrite', startIn: 'downloads' });
    current = handle;
    await kv.set(HANDLE_KEY, handle);
    useSettings.getState().set({ saveFolderName: handle.name });
    return handle.name;
  } catch {
    return null; // the picker was closed
  }
}

/** The granted folder (the browser re-asks for permission each visit; this must run from a click). */
async function grantedFolder(): Promise<FileSystemDirectoryHandle | null> {
  let handle = current ?? (current = await kv.get<Granting>(HANDLE_KEY));
  if (!handle) {
    if (!(await chooseSaveFolder())) return null;
    handle = current;
  }
  if (!handle) return null;
  if ((await handle.queryPermission?.({ mode: 'readwrite' })) === 'granted') return handle;
  if ((await handle.requestPermission?.({ mode: 'readwrite' })) === 'granted') return handle;
  return null;
}

/**
 * Opens a place for an incoming copy, asking for the save folder the first time. Returns null
 * if the user backed out. `handOver`: in a browser without a folder, download it when done
 * (a chat copy), rather than keeping it in the browser's storage (a watch-party copy).
 */
export async function startReceive(file: { name: string; mime: string; size: number }, opts: { folder: boolean; handOver: boolean }): Promise<ReceiveTarget | null> {
  if (isTauri) {
    // The app saves into the folder last picked in the system dialog; it asks if there's none yet.
    const open = () => invoke<{ id: string; path: string }>('media_receive_open', { name: file.name, size: file.size, folder: opts.folder });
    let t: { id: string; path: string };
    try {
      t = await open();
    } catch (err) {
      if (err !== 'no_folder') throw err;
      if (!(await chooseSaveFolder())) return null;
      t = await open();
    }
    return {
      where: t.path,
      write: (offset, data) => invoke<void>('media_receive_write', data, { headers: { 'x-receive': t.id, 'x-offset': String(offset) } }),
      close: (ok) => invoke<SharedFile | null>('media_receive_close', { id: t.id, ok }),
    };
  }
  const dir = canPickFolder ? await grantedFolder() : null;
  if (canPickFolder && !dir) return null;
  return receiveWeb(dir, file.name, file.mime, opts.folder, opts.handOver);
}
