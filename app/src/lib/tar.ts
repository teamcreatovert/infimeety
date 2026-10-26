/**
 * The browser's half of folder sharing; the same format the desktop app streams
 * (src-tauri/src/tarball.rs). A shared folder travels as one tar archive that's never built
 * in full: any byte range is made on request from the files themselves, so several
 * connections can fetch different parts at once. The receiver unpacks it back into a folder.
 */

const BLOCK = 512;
const enc = new TextEncoder();

export interface TarEntry {
  rel: string;
  file: Blob;
  size: number;
  /** Where its header starts in the archive, and where its data starts. */
  start: number;
  data: number;
  head: Uint8Array;
}

const padded = (n: number) => Math.ceil(n / BLOCK) * BLOCK;

function writeOctal(block: Uint8Array, at: number, width: number, value: number) {
  if (value >= 8 ** (width - 1)) {
    // GNU base-256 for sizes past 8 GB: high bit set, big-endian number.
    block[at] = 0x80;
    let v = value;
    for (let i = at + width - 1; i > at; i--) {
      block[i] = v % 256;
      v = Math.floor(v / 256);
    }
    return;
  }
  block.set(enc.encode(value.toString(8).padStart(width - 1, '0')), at);
}

function headerBlock(name: Uint8Array, size: number, type: string) {
  const b = new Uint8Array(BLOCK);
  b.set(name.subarray(0, 100), 0);
  b.set(enc.encode('0000644'), 100);
  b.set(enc.encode('0000000'), 108);
  b.set(enc.encode('0000000'), 116);
  writeOctal(b, 124, 12, size);
  b.set(enc.encode('00000000000'), 136);
  b[156] = type.charCodeAt(0);
  b.set(enc.encode('ustar  \0'), 257); // GNU magic + version
  b.fill(0x20, 148, 156);
  const sum = b.reduce((a, x) => a + x, 0);
  b.set(enc.encode(sum.toString(8).padStart(6, '0')), 148);
  b[154] = 0;
  b[155] = 0x20;
  return b;
}

/** A file's header block(s); long paths get a GNU long-name entry in front. */
function header(rel: string) {
  const name = enc.encode(rel);
  if (name.length <= 100) return (size: number) => headerBlock(name, size, '0');
  return (size: number) => {
    const longName = new Uint8Array(BLOCK + padded(name.length + 1));
    longName.set(headerBlock(enc.encode('././@LongLink'), name.length + 1, 'L'), 0);
    longName.set(name, BLOCK);
    const out = new Uint8Array(longName.length + BLOCK);
    out.set(longName, 0);
    out.set(headerBlock(name, size, '0'), longName.length);
    return out;
  };
}

/** Lays out files (with folder-relative paths) as an archive. Returns the entries and its total size. */
export function layout(files: { rel: string; file: Blob }[]) {
  const sorted = [...files].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  let pos = 0;
  const entries: TarEntry[] = sorted.map(({ rel, file }) => {
    const head = header(rel)(file.size);
    const entry = { rel, file, size: file.size, start: pos, data: pos + head.length, head };
    pos += head.length + padded(file.size);
    return entry;
  });
  return { entries, total: pos + 2 * BLOCK };
}

/** Bytes `offset..offset+length` of the archive. */
export async function read(entries: TarEntry[], total: number, offset: number, length: number) {
  const end = Math.min(offset + length, total);
  const out = new Uint8Array(Math.max(0, end - offset));
  let pos = offset;
  let i = entries.findIndex((e) => e.data + padded(e.size) > pos);
  if (i < 0) i = entries.length;
  while (pos < end) {
    const e = entries[i];
    if (!e) break; // the rest is the closing empty blocks, already zero
    if (pos < e.data) {
      const upto = Math.min(e.data, end);
      out.set(e.head.subarray(pos - e.start, upto - e.start), pos - offset);
      pos = upto;
    } else if (pos < e.data + e.size) {
      const upto = Math.min(e.data + e.size, end);
      out.set(new Uint8Array(await e.file.slice(pos - e.data, upto - e.data).arrayBuffer()), pos - offset);
      pos = upto;
    } else {
      pos = Math.min(e.data + padded(e.size), end); // padding, already zero
    }
    if (pos >= e.data + padded(e.size)) i++;
  }
  return out.buffer;
}

function parseOctal(b: Uint8Array) {
  if (b[0] & 0x80) {
    let v = 0;
    for (let i = 1; i < b.length; i++) v = v * 256 + b[i];
    return v;
  }
  const s = new TextDecoder().decode(b).replace(/\0.*$/, '').trim();
  return s ? parseInt(s, 8) : 0;
}

/**
 * Reads a received archive and hands each file to `put` (path segments, file data as a slice of
 * the archive, so nothing is copied into memory). Paths that try to leave the folder are skipped.
 */
export async function unpack(archive: Blob, put: (segments: string[], data: Blob) => Promise<void>) {
  const dec = new TextDecoder();
  let pos = 0;
  let longName: string | null = null;
  while (pos + BLOCK <= archive.size) {
    const block = new Uint8Array(await archive.slice(pos, pos + BLOCK).arrayBuffer());
    if (block.every((x) => x === 0)) break;
    const size = parseOctal(block.subarray(124, 136));
    const type = String.fromCharCode(block[156] || 48);
    const dataStart = pos + BLOCK;
    pos = dataStart + padded(size);
    if (type === 'L') {
      longName = dec.decode(await archive.slice(dataStart, dataStart + size).arrayBuffer()).replace(/\0+$/, '');
      continue;
    }
    const name = longName ?? dec.decode(block.subarray(0, 100)).replace(/\0.*$/, '');
    longName = null;
    if (type !== '0' && type !== '\0') continue;
    const segments = name.split('/').filter((s) => s && s !== '.');
    if (!segments.length || segments.some((s) => s === '..')) continue;
    await put(segments, archive.slice(dataStart, dataStart + size));
  }
}
