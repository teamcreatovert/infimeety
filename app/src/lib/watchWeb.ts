import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import type { WebStatus, WebWatch } from '../../../shared/protocol';
import { expectedPosition, serverNow, syncClock } from './party';
import { isTauri } from './platform';
import { getHub } from './realtime';
import { useAuth } from '@/stores/auth';
import { toast } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

/**
 * Watching a website together. Everyone opens the same page in their own Infimeety browser,
 * signed in to their own account; this keeps play, pause and the time in step. The page's
 * logins never leave the device: only the link and the shared timeline go through the hub.
 */
interface WebStore {
  webs: Record<string, WebWatch>;
  /** By room, then by person: opening, signing in, ready, in an ad, not along. */
  statuses: Record<string, Record<string, WebStatus>>;
  /** The room whose website this device is watching along with, if any. */
  joined: string | null;
}

export const useWeb = create<WebStore>()(() => ({ webs: {}, statuses: {}, joined: null }));

/** Websites watch together the best when they're big: shortcuts for the usual ones. */
export const WEB_SITES = [
  { name: 'Netflix', url: 'https://www.netflix.com/browse' },
  { name: 'YouTube', url: 'https://www.youtube.com/' },
  { name: 'Prime Video', url: 'https://www.primevideo.com/' },
  { name: 'Disney+', url: 'https://www.disneyplus.com/' },
  { name: 'Crunchyroll', url: 'https://www.crunchyroll.com/' },
];

export const canWatchWeb = isTauri;

const hubFor = () => {
  const id = useVoice.getState().channelId;
  return id ? getHub(id) : undefined;
};

// ─── From the hub ────────────────────────────────────────────────────────────

export function onWebs(webs: Record<string, WebWatch> | undefined, roomIds: string[]) {
  useWeb.setState((s) => {
    const next = { ...s.webs };
    for (const id of roomIds) if (!webs?.[id]) delete next[id];
    return { webs: { ...next, ...webs } };
  });
}

export function onWeb(roomId: string, web: WebWatch | null) {
  const before = useWeb.getState().webs[roomId];
  useWeb.setState((s) => {
    const webs = { ...s.webs };
    if (web) webs[roomId] = web;
    else delete webs[roomId];
    return { webs, ...(web ? {} : { statuses: { ...s.statuses, [roomId]: {} } }) };
  });
  // Someone in your room started one: say so (the Watch party tab has Join).
  const me = useAuth.getState().me?.id;
  if (web && !before && web.by !== me && useVoice.getState().roomId === roomId)
    toast({ kind: 'info', title: `Watching ${siteName(web.url)} together`, body: canWatchWeb ? 'Open the Watch party tab to join on your own account.' : 'Join from the Infimeety app.' });
  const st = useWeb.getState();
  if (st.joined !== roomId) return;
  if (!web) return void leaveWeb(true);
  // Following along: the host opened another title, so this browser goes there too.
  if (before && !sameVideo(before.url, web.url)) void openBrowser(web.url);
}

export function onWebStatus(roomId: string, userId: string, status: WebStatus) {
  useWeb.setState((s) => ({ statuses: { ...s.statuses, [roomId]: { ...s.statuses[roomId], [userId]: status } } }));
}

// ─── Starting, joining, leaving ──────────────────────────────────────────────

export const openBrowser = (url: string) => invoke('browser_open', { url });
export const showBrowser = () => void invoke('browser_show').catch(() => {});

/** Opens a site in the Infimeety browser for the room: whatever you open there, the room follows. */
export async function startWeb(roomId: string, url: string) {
  if (!canWatchWeb) return;
  const hub = hubFor();
  if (!hub) return;
  syncClock(hub);
  try {
    await openBrowser(url);
  } catch (err) {
    return toast({ kind: 'error', title: 'Couldn’t open the browser', body: String(err) });
  }
  hub.send({ t: 'web.set', roomId, web: { url, title: siteName(url), playing: false, position: 0, at: serverNow() } });
  join(roomId);
}

/** Joins the room's website: your browser opens the same page (you sign in there if you need to). */
export async function joinWeb(roomId: string) {
  const web = useWeb.getState().webs[roomId];
  if (!web || !canWatchWeb) return;
  syncClock();
  try {
    await openBrowser(web.url);
  } catch (err) {
    return toast({ kind: 'error', title: 'Couldn’t open the browser', body: String(err) });
  }
  join(roomId);
}

/** Stops watching along (the others keep going). */
export function leaveWeb(ended = false) {
  const roomId = useWeb.getState().joined;
  stopLoop();
  useWeb.setState({ joined: null });
  if (roomId && !ended) hubFor()?.send({ t: 'web.status', roomId, status: { state: 'away' } });
  void invoke('browser_close').catch(() => {});
}

/** Ends it for everyone. */
export function endWeb(roomId: string) {
  hubFor()?.send({ t: 'web.set', roomId, web: null });
  leaveWeb(true);
}

// ─── Keeping in step ─────────────────────────────────────────────────────────

interface PageState {
  url: string;
  title: string;
  signin: boolean;
  video: { t: number; d: number; p: boolean; r: number; ad: boolean } | null;
  userAt: number;
}

let loop: ReturnType<typeof setInterval> | null = null;
let busy = false;
let lastUserAt = 0;
let lastStatus = '';
let heldForAd = false;
let missing = 0;

function join(roomId: string) {
  stopLoop();
  useWeb.setState({ joined: roomId });
  lastUserAt = 0;
  lastStatus = '';
  heldForAd = false;
  missing = 0;
  loop = setInterval(() => void tick(roomId), 500);
}

function stopLoop() {
  if (loop) clearInterval(loop);
  loop = null;
}

// Leaving the call (or the room) stops it.
useVoice.subscribe((s, prev) => {
  const joined = useWeb.getState().joined;
  if (joined && s.roomId !== prev.roomId && s.roomId !== joined) leaveWeb();
});

async function tick(roomId: string) {
  if (busy) return;
  busy = true;
  try {
    await step(roomId);
  } finally {
    busy = false;
  }
}

async function step(roomId: string) {
  const web = useWeb.getState().webs[roomId];
  if (!web) return leaveWeb(true);
  const raw = await invoke<string>('browser_state').catch(() => 'null');
  const page = JSON.parse(raw) as PageState | null;
  if (!page) {
    // Closed the browser window (a page that's loading also skips an answer now and then).
    if (++missing >= 4) leaveWeb();
    return;
  }
  missing = 0;
  const hub = hubFor();
  const me = useAuth.getState().me?.id;
  if (!hub || !me) return;
  const v = page.video;

  // Where I stand, for the others ("signing in", "watching an ad"...), sent when it changes.
  const state: WebStatus['state'] = page.signin ? 'signin' : !v ? 'opening' : v.ad ? 'ad' : 'ready';
  if (state !== lastStatus) {
    lastStatus = state;
    hub.send({ t: 'web.status', roomId, status: { state } });
  }

  // The host leads: a new title they open becomes the room's.
  if (web.hostId === me && !page.signin && !sameVideo(page.url, web.url) && /^https:/.test(page.url)) {
    hub.send({ t: 'web.set', roomId, web: { url: cleanUrl(page.url), title: page.title || siteName(page.url), playing: false, position: 0, at: serverNow() } });
    return;
  }
  if (!v || !sameVideo(page.url, web.url)) return;
  const now = serverNow();
  // The host's page names the title better than the site's name.
  if (web.hostId === me && page.title && page.title !== web.title && !page.signin) {
    hub.send({ t: 'web.set', roomId, web: { url: web.url, title: page.title, playing: web.playing, position: web.position, at: web.at } });
    return;
  }

  // An ad holds everyone: pause the room where it is, and carry on together after.
  if (v.ad) {
    if (web.playing && !heldForAd) {
      heldForAd = true;
      hub.send({ t: 'web.set', roomId, web: { url: web.url, title: web.title, playing: false, position: expectedPosition(web, now), at: now } });
    }
    return;
  }
  if (heldForAd) {
    heldForAd = false;
    const others = Object.entries(useWeb.getState().statuses[roomId] ?? {}).some(([u, s]) => u !== me && s.state === 'ad');
    if (!others) hub.send({ t: 'web.set', roomId, web: { url: web.url, title: web.title, playing: true, position: web.position, at: now + 1200 } });
    return;
  }

  // Something I did in the page myself (play, pause, a jump): share it.
  if (page.userAt > lastUserAt) {
    const first = lastUserAt === 0;
    lastUserAt = page.userAt;
    if (!first) {
      hub.send({ t: 'web.set', roomId, web: { url: web.url, title: page.title || web.title, playing: v.p, position: v.t, at: v.p ? now + 1000 : now } });
      return;
    }
  }

  // Follow the shared timeline. A start a moment ahead waits on its first frame.
  if (web.playing && now < web.at) {
    if (v.p || Math.abs(v.t - web.position) > 0.5) void invoke('browser_apply', { command: { t: web.position, tol: 0.5, p: false } });
    return;
  }
  const target = expectedPosition(web, now);
  const off = Math.abs(v.t - target);
  // Web players can't be nudged frame by frame like ours: a jump only when clearly apart.
  const tol = web.playing ? 2 : 0.75;
  if (v.p !== web.playing || off > tol) void invoke('browser_apply', { command: { t: target, tol, p: web.playing } });
}

// ─── Links ───────────────────────────────────────────────────────────────────

/** The same title on the same site (each person's link carries their own tracking bits). */
export function sameVideo(a: string, b: string) {
  try {
    const x = new URL(a);
    const y = new URL(b);
    const host = (u: URL) => u.hostname.replace(/^www\./, '');
    return host(x) === host(y) && x.pathname.replace(/\/$/, '') === y.pathname.replace(/\/$/, '') && x.searchParams.get('v') === y.searchParams.get('v');
  } catch {
    return a === b;
  }
}

/** A link worth sharing: no tracking bits, no fragment. */
function cleanUrl(url: string) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|trackId|tctx|si$|pp$|feature$|t$)/.test(k)) u.searchParams.delete(k);
    return u.href;
  } catch {
    return url;
  }
}

export function siteName(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return WEB_SITES.find((s) => new URL(s.url).hostname.replace(/^www\./, '') === host)?.name ?? host;
  } catch {
    return url;
  }
}
