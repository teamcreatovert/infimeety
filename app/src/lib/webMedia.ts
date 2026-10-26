import { randomId } from './api';
import { isPhoneApp, savedPlace, saveOnPhone } from './phone';
import type { ReceiveTarget, SharedFile } from './platform';
import { layout, read as readTar, unpack, type TarEntry } from './tar';

/**
 * The browser's version of the desktop file registry. Files you share stay on this device
 * and stream to friends from here while Infimeety is open, the same way the desktop app
 * streams them from disk. Nothing is uploaded.
 *
 * Small files are also kept in the browser's storage (IndexedDB) so they survive a reload;
 * big files and folders are shared straight from where they are, for as long as the tab is open.
 */

interface Stored {
  id: string;
  name: string;
  mime: string;
  size: number;
  blob: Blob;
}

type Live = SharedFile & { blob?: Blob; tar?: { entries: TarEntry[]; total: number } };

export const FOLDER_MIME = 'inode/directory';
/** Bigger files aren't copied into the browser's storage; they're shared while the tab is open. */
const KEEP_LIMIT = 64 * 1024 * 1024;

const live = new Map<string, Live>();
let db: Promise<IDBDatabase | null> | null = null;

function open() {
  db ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open('infimeety-media', 2);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('files')) req.result.createObjectStore('files', { keyPath: 'id' });
        if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null); // private mode: files last as long as the tab
    }
  });
  return db;
}

async function tx<T>(store: 'files' | 'kv', mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const d = await open();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const req = run(d.transaction(store, mode).objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Small settings that can't live in localStorage (e.g. a folder handle). */
export const kv = {
  get: <T>(key: string) => tx<T>('kv', 'readonly', (s) => s.get(key)),
  set: (key: string, value: unknown) => tx('kv', 'readwrite', (s) => s.put(value, key)),
};

function remember(file: Live) {
  live.set(file.id, file);
  return file;
}

const toShared = ({ id, name, mime, size, path }: Live): SharedFile => ({ id, name, mime, size, path });

/** Registers files picked, pasted or dropped in the browser. Folders (which drop as empty files) are skipped. */
export async function adopt(files: File[]): Promise<SharedFile[]> {
  const out: SharedFile[] = [];
  for (const f of files) {
    if (!f.size && !f.type) continue;
    const stored: Stored = { id: randomId(12), name: f.name || 'file', mime: f.type || 'application/octet-stream', size: f.size, blob: f };
    // Small files survive a reload; if storage is full they're shared for this visit only.
    if (f.size <= KEEP_LIMIT) await tx('files', 'readwrite', (s) => s.put(stored));
    out.push(toShared(remember({ ...stored, path: URL.createObjectURL(f) })));
  }
  return out;
}

/** Shares a folder: it streams as one archive and unpacks back into a folder on the other side. */
export function adoptFolder(name: string, files: { rel: string; file: Blob }[]): SharedFile | null {
  if (!files.length) return null;
  const tar = layout(files);
  return toShared(remember({ id: randomId(12), name, mime: FOLDER_MIME, size: tar.total, path: '', tar }));
}

/** Groups files picked from a folder (`webkitRelativePath` = "Folder/sub/file") by their folder. */
export function foldersFromInput(files: File[]) {
  const byFolder = new Map<string, { rel: string; file: Blob }[]>();
  for (const f of files) {
    const [top, ...rest] = (f.webkitRelativePath || f.name).split('/');
    if (!rest.length) continue;
    byFolder.set(top, [...(byFolder.get(top) ?? []), { rel: rest.join('/'), file: f }]);
  }
  return [...byFolder].map(([name, list]) => adoptFolder(name, list)).filter((f): f is SharedFile => !!f);
}

/** Files and folders dropped onto the page (folders are read through the browser's entry API). */
export async function fromDrop(dt: DataTransfer): Promise<SharedFile[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return adopt([...dt.files]);
  const out: SharedFile[] = [];
  const asFile = (e: FileSystemFileEntry) => new Promise<File>((res, rej) => e.file(res, rej));
  const children = async (d: FileSystemDirectoryEntry) => {
    const reader = d.createReader();
    const all: FileSystemEntry[] = [];
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) return all;
      all.push(...batch);
    }
  };
  const walk = async (d: FileSystemDirectoryEntry, prefix: string, list: { rel: string; file: Blob }[]) => {
    for (const child of await children(d)) {
      if (child.isFile) list.push({ rel: prefix + child.name, file: await asFile(child as FileSystemFileEntry) });
      else if (child.isDirectory) await walk(child as FileSystemDirectoryEntry, `${prefix}${child.name}/`, list);
    }
  };
  for (const e of entries) {
    if (e.isFile) out.push(...(await adopt([await asFile(e as FileSystemFileEntry)])));
    else if (e.isDirectory) {
      const list: { rel: string; file: Blob }[] = [];
      await walk(e as FileSystemDirectoryEntry, '', list);
      const folder = adoptFolder(e.name, list);
      if (folder) out.push(folder);
    }
  }
  return out;
}

const picker = (folder: boolean) =>
  new Promise<File[]>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (folder) input.webkitdirectory = true;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });

export const webMedia = {
  available: true,
  pick: async () => adopt(await picker(false)),
  pickFolder: async () => foldersFromInput(await picker(true)),
  takeDropped: async () => [] as SharedFile[],
  saveBytes: async (name: string, bytes: Uint8Array) => {
    const mime = /\.(png|jpe?g|gif|webp)$/i.test(name) ? `image/${name.split('.').pop()!.toLowerCase().replace('jpg', 'jpeg')}` : 'application/octet-stream';
    const [file] = await adopt([new File([bytes as BlobPart], name, { type: mime })]);
    if (!file) throw new Error('unsupported');
    return file;
  },
  read: async (id: string, offset: number, length: number) => {
    const file = live.get(id) ?? (await load(id));
    if (!file) throw new Error('gone');
    if (file.tar) return readTar(file.tar.entries, file.tar.total, offset, length);
    return file.blob!.slice(offset, offset + length).arrayBuffer();
  },
  stat: async (id: string) => {
    const file = live.get(id) ?? (await load(id));
    return file ? toShared(file) : null;
  },
  /** Browsers don't lose files behind our back the way a deleted file on disk is lost. */
  missing: async () => [] as string[],
  forget: async (id: string) => {
    const file = live.get(id);
    if (file?.path) URL.revokeObjectURL(file.path);
    live.delete(id);
    await tx('files', 'readwrite', (s) => s.delete(id));
  },
  src: (path: string) => path,
  /** Browsers can't open a file's folder; the copy is in the folder (or Downloads) the user chose. */
  reveal: async (_id: string) => {},
};

async function load(id: string) {
  const stored = await tx<Stored | undefined>('files', 'readonly', (s) => s.get(id));
  return stored ? remember({ ...stored, path: URL.createObjectURL(stored.blob) }) : null;
}

// ─── Receiving copies ──────────────────────────────────────────────────────────

/** Can this browser write into a folder the user picks (Chrome, Edge)? */
export const canPickFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

type Dir = FileSystemDirectoryHandle;

const clean = (name: string) => name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 150) || 'file';

async function exists(dir: Dir, name: string) {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    try {
      await dir.getDirectoryHandle(name);
      return true;
    } catch {
      return false;
    }
  }
}

/** `name`, or "name (2).ext"… if the folder already has one. */
async function unique(dir: Dir, name: string) {
  if (!(await exists(dir, name))) return name;
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let n = 2; n < 10_000; n++) if (!(await exists(dir, `${stem} (${n})${ext}`))) return `${stem} (${n})${ext}`;
  return name;
}

/** The finished copy is shared on from here (so it can be played, or passed along). */
function registerReceived(file: File, name: string, mime: string) {
  return toShared(remember({ id: randomId(12), name, mime, size: file.size, path: URL.createObjectURL(file), blob: file }));
}

/** Writes pieces in place, one at a time (a writable stream takes one write at a time). */
async function placeWriter(handle: FileSystemFileHandle) {
  if (!('createWritable' in handle)) return null;
  const w = await handle.createWritable();
  let queue = Promise.resolve();
  return {
    write: (offset: number, data: Uint8Array) => (queue = queue.then(() => w.write({ type: 'write', position: offset, data: data as BufferSource }))),
    close: async () => {
      await queue;
      await w.close();
    },
    abort: async () => {
      await queue.catch(() => {});
      await w.abort().catch(() => {});
    },
  };
}

/** Saves a finished file with a regular browser download (no folder to write into). */
export function download(file: Blob, name: string) {
  if (isPhoneApp) return void saveOnPhone(file, name);
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

/**
 * Starts receiving a copy. With a folder handle the file goes straight into the user's folder;
 * without one it goes to the browser's own storage, and `handOver` downloads it at the end.
 */
export async function receiveWeb(dir: Dir | null, name: string, mime: string, isFolder: boolean, handOver: boolean): Promise<ReceiveTarget> {
  let root: Dir | null = dir;
  if (!root) {
    try {
      root = await (await navigator.storage.getDirectory()).getDirectoryHandle('received', { create: true });
    } catch {
      root = null; // no private storage either: the copy is kept in memory
    }
  }
  const target = root ? await unique(root, clean(name)) : clean(name);
  // A folder arrives as an archive, written next to where it will be unpacked.
  const fileName = isFolder ? `${target}.infimeety-part` : target;
  const handle = root ? await root.getFileHandle(fileName, { create: true }) : null;
  const writer = handle ? await placeWriter(handle) : null;
  const pieces = writer ? null : new Map<number, Uint8Array>();
  const where = dir ? `${dir.name}/${target}` : isPhoneApp ? savedPlace : 'Downloads';

  return {
    where,
    write: async (offset, data) => {
      if (writer) await writer.write(offset, data);
      else pieces!.set(offset, data.slice());
    },
    async close(ok) {
      if (!ok) {
        await writer?.abort();
        if (root && handle) await root.removeEntry(fileName).catch(() => {});
        return null;
      }
      let file: File;
      if (writer && handle) {
        await writer.close();
        file = await handle.getFile();
      } else {
        const parts = [...pieces!].sort((a, b) => a[0] - b[0]).map(([, p]) => p as BlobPart);
        file = new File(parts, target, { type: mime });
      }
      if (!isFolder) {
        if (handOver) download(file, target);
        return registerReceived(file, target, mime);
      }
      if (!dir) {
        // Nowhere to unpack a folder: hand over the archive itself.
        if (handOver) download(file, `${target}.tar`);
        return registerReceived(file, `${target}.tar`, 'application/x-tar');
      }
      const into = await dir.getDirectoryHandle(target, { create: true });
      await unpack(file, async (segments, data) => {
        let d = into;
        for (const s of segments.slice(0, -1)) d = await d.getDirectoryHandle(clean(s), { create: true });
        const fh = await d.getFileHandle(clean(segments[segments.length - 1]), { create: true });
        const w = await fh.createWritable();
        await w.write(data);
        await w.close();
      });
      await dir.removeEntry(fileName).catch(() => {});
      return { id: randomId(12), name: target, mime: FOLDER_MIME, size: file.size, path: '' };
    },
  };
}
