import { create } from 'zustand';
import { DOWNLOAD_PAGE } from '@/config';

/**
 * The soundboard's sound pack: the clips in the repo's sounds/ folder, published with the
 * website (server/scripts/sound-pack.mjs). Every app keeps its own copy (Cache Storage), so
 * sounds play instantly and offline; at each start it fetches what's new and drops what was
 * removed. The browser does the same, from the same site.
 */

export interface PackSound {
  id: string;
  name: string;
  file: string;
  size: number;
  hash: string;
}

/** The website hosts the pack (same origin for the web app, cross-origin for the desktop one). */
const SITE = new URL(DOWNLOAD_PAGE).origin;
const CACHE = 'infimeety-sounds';
const LIST = `${SITE}/sounds/sounds.json`;
/** The last list that synced, kept with the files so the soundboard works offline. */
const SAVED_LIST = `${SITE}/sounds/__saved.json`;

export const useSoundPack = create<{ sounds: PackSound[]; ready: boolean }>()(() => ({ sounds: [], ready: false }));

const urlFor = (s: PackSound) => `${SITE}/${s.file}?v=${s.hash}`;

/** Fetches the list, downloads new or changed sounds, drops removed ones. Safe to call any time. */
export async function syncSoundPack() {
  if (typeof caches === 'undefined') return;
  let cache: Cache;
  try {
    cache = await caches.open(CACHE);
  } catch {
    return;
  }
  try {
    const res = await fetch(LIST, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`sounds.json ${res.status}`);
    const { sounds } = (await res.json()) as { sounds: PackSound[] };
    const wanted = new Set(sounds.map(urlFor));
    // New and changed sounds, a few at a time; one that fails is tried again next start.
    const missing = [];
    for (const s of sounds) if (!(await cache.match(urlFor(s)))) missing.push(urlFor(s));
    for (let i = 0; i < missing.length; i += 4) await Promise.allSettled(missing.slice(i, i + 4).map((url) => cache.add(url)));
    for (const req of await cache.keys()) if (!wanted.has(req.url) && req.url !== SAVED_LIST) await cache.delete(req);
    await cache.put(SAVED_LIST, new Response(JSON.stringify(sounds), { headers: { 'Content-Type': 'application/json' } }));
    useSoundPack.setState({ sounds, ready: true });
  } catch {
    // Offline: the copy from the last sync.
    const saved = await cache.match(SAVED_LIST);
    const sounds = saved ? ((await saved.json()) as PackSound[]) : [];
    useSoundPack.setState({ sounds, ready: true });
  }
}

const decoded = new Map<string, Promise<AudioBuffer>>();

/** A sound ready to play in `ctx`, from this device's copy (or the site, if it isn't here yet). */
export function packBuffer(ctx: BaseAudioContext, sound: PackSound) {
  const key = urlFor(sound);
  let buffer = decoded.get(key);
  if (!buffer) {
    buffer = (async () => {
      const cache = typeof caches !== 'undefined' ? await caches.open(CACHE).catch(() => null) : null;
      const res = (await cache?.match(key)) ?? (await fetch(key));
      return ctx.decodeAudioData(await res.arrayBuffer());
    })();
    buffer.catch(() => decoded.delete(key));
    decoded.set(key, buffer);
  }
  return buffer;
}
