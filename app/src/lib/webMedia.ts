import { randomId } from './api';
import type { SharedFile } from './platform';

/**
 * The browser's version of the desktop media registry: files you share stay in this
 * browser (IndexedDB) and stream to viewers from here while Infimeety is open, the same
 * way the desktop app streams them from disk. Nothing is uploaded.
 */

interface Stored {
  id: string;
  name: string;
  mime: string;
  size: number;
  blob: Blob;
}

const SHAREABLE = /^(image|video|audio)\//;
const live = new Map<string, SharedFile & { blob: Blob }>();
let db: Promise<IDBDatabase | null> | null = null;

function open() {
  db ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open('infimeety-media', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null); // private mode: files last as long as the tab
    }
  });
  return db;
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const d = await open();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const req = run(d.transaction('files', mode).objectStore('files'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function remember(s: Stored) {
  const file = { id: s.id, name: s.name, mime: s.mime, size: s.size, path: URL.createObjectURL(s.blob), blob: s.blob };
  live.set(s.id, file);
  return file;
}

const toShared = ({ blob: _blob, ...file }: SharedFile & { blob: Blob }): SharedFile => file;

/** Registers files picked, pasted or dropped in the browser. Anything but media is skipped. */
export async function adopt(files: File[]): Promise<SharedFile[]> {
  const out: SharedFile[] = [];
  for (const f of files) {
    if (!SHAREABLE.test(f.type)) continue;
    const stored: Stored = { id: randomId(12), name: f.name || 'file', mime: f.type, size: f.size, blob: f };
    await tx('readwrite', (s) => s.put(stored)); // if storage is full, it's shared for this visit only
    out.push(toShared(remember(stored)));
  }
  return out;
}

export const webMedia = {
  available: true,
  pick: () =>
    new Promise<SharedFile[]>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = 'image/*,video/*,audio/*';
      input.onchange = () => void adopt(Array.from(input.files ?? [])).then(resolve);
      input.oncancel = () => resolve([]);
      input.click();
    }),
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
    return file.blob.slice(offset, offset + length).arrayBuffer();
  },
  stat: async (id: string) => {
    const file = live.get(id) ?? (await load(id));
    return file ? toShared(file) : null;
  },
  /** Browsers don't lose files behind our back the way a deleted file on disk is lost. */
  missing: async () => [] as string[],
  forget: async (id: string) => {
    const file = live.get(id);
    if (file) URL.revokeObjectURL(file.path);
    live.delete(id);
    await tx('readwrite', (s) => s.delete(id));
  },
  src: (path: string) => path,
};

async function load(id: string) {
  const stored = await tx<Stored | undefined>('readonly', (s) => s.get(id));
  return stored ? remember(stored) : null;
}
