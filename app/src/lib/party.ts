import { create } from 'zustand';
import { DEFAULT_PARTY_SETTINGS } from '../../../shared/protocol';
import type { Attachment, PartyAction, PartyFile, PartyMemberStatus, PartySettings, PartyState } from '../../../shared/protocol';
import { rememberCopy, savedCopies } from './copies';
import { localMedia, type SharedFile } from './platform';
import { getHub } from './realtime';
import { featureOn } from './remote';
import { isSubtitle, toVtt } from './subtitles';
import { copyFile, requestMedia } from './transfer';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { useMedia } from '@/stores/media';
import { toast } from '@/stores/ui';
import { voice } from './voice/engine';
import { useVoice } from '@/stores/voice';

/**
 * Watch parties: everyone in a voice room plays their own copy of one file, in sync.
 *
 * A party opens as a lobby: the host has planned it (movie, subtitles, who controls it),
 * everyone gets the movie and says they're ready, and the host (or co-hosts) start it, all
 * together after a short countdown. Whoever arrives later, or wasn't ready, joins in at the
 * point everyone has reached with "Join them".
 *
 * Sync works on the hub's clock. Each client measures its offset to the hub (a few
 * round trips, keeping the fastest), so "the hub's time" means the same instant everywhere.
 * The shared state says "at hub time `at`, the movie was at `position`, playing or not".
 * A play is scheduled ~400 ms ahead so it reaches everyone first and they all start on the
 * same frame; a pause lands everyone on the exact same timestamp. While playing, each
 * player nudges its speed (or jumps, if far off) to stay on the shared timeline.
 */

/** With 'auto' control: above this many people in the room, only the host and co-hosts control playback. */
export const OPEN_LIMIT = 3;
/** How far ahead a play is scheduled, so it reaches everyone before it starts. */
const LEAD_MS = 400;

export interface PartyRequest {
  id: string;
  roomId: string;
  from: string;
  action: PartyAction;
  at: number;
}

/** This device's copy of a party's movie. */
export interface LocalCopy {
  state: 'none' | 'checking' | 'ready';
  url?: string;
  localId?: string;
}

interface PartyStore {
  parties: Record<string, PartyState>;
  /** By room, then by peer: where everyone stands. */
  statuses: Record<string, Record<string, PartyMemberStatus & { userId: string }>>;
  requests: PartyRequest[];
  copies: Record<string, LocalCopy>;
  /** Subtitle file id → WebVTT blob URL. */
  subtitles: Record<string, string>;
  /** Hub clock minus ours, in ms. */
  offset: number;
  /** Party ids this device is watching along with (rather than waiting to join in). */
  joined: Record<string, boolean>;
}

export const useParty = create<PartyStore>()(() => ({ parties: {}, statuses: {}, requests: [], copies: {}, subtitles: {}, offset: 0, joined: {} }));

/** A steady clock (unaffected by the computer's clock being changed), in ms since 1970. */
const clientNow = () => performance.timeOrigin + performance.now();
export const serverNow = () => clientNow() + useParty.getState().offset;

/** Where the shared timeline is right now (seconds). */
export function expectedPosition(party: Pick<PartyState, 'playing' | 'position' | 'at'>, now = serverNow()) {
  return party.playing ? party.position + Math.max(0, now - party.at) / 1000 : party.position;
}

/** People in the room, by user. */
export function roomPeople(roomId: string) {
  const vs = useVoice.getState();
  const snap = vs.channelId ? useChannels.getState().voice[vs.channelId] : undefined;
  return [...new Set((snap?.participants ?? []).filter((p) => p.roomId === roomId).map((p) => p.userId))];
}

export const isHost = (party: PartyState, userId: string | undefined) => !!userId && (party.hostId === userId || party.cohosts.includes(userId));

/** Plays, pauses and seeks directly (everyone else asks). */
export function canControl(roomId: string, userId: string | undefined) {
  const party = useParty.getState().parties[roomId];
  if (!party || !userId) return false;
  if (isHost(party, userId)) return true;
  const control = (party.settings ?? DEFAULT_PARTY_SETTINGS).control;
  return control === 'everyone' || (control === 'auto' && roomPeople(roomId).length <= OPEN_LIMIT);
}

/** Watching along now (a late arrival first chooses to join in). */
const markJoined = (partyId: string) => useParty.setState((s) => ({ joined: { ...s.joined, [partyId]: true } }));
export const joinIn = (party: PartyState) => markJoined(party.id);

const hubFor = () => {
  const id = useVoice.getState().channelId;
  return id ? getHub(id) : undefined;
};

const asAttachment = (f: PartyFile): Attachment => ({ id: f.id, ownerId: f.ownerId, name: f.name, mime: f.mime, size: f.size });

function setCopy(fileId: string, copy: LocalCopy) {
  useParty.setState((s) => ({ copies: { ...s.copies, [fileId]: copy } }));
}

// ─── Clock ───────────────────────────────────────────────────────────────────

let samples: { rtt: number; offset: number }[] = [];
let lastSync = 0;

/** Measures the offset to the hub's clock (a few quick round trips; the fastest wins). */
export function syncClock(hub = hubFor()) {
  if (!hub || Date.now() - lastSync < 5_000) return;
  lastSync = Date.now();
  samples = [];
  for (let i = 0; i < 6; i++) setTimeout(() => hub.send({ t: 'clock', c: clientNow() }), i * 120);
}

export function onClock(c: number, s: number) {
  const rtt = clientNow() - c;
  if (rtt < 0 || rtt > 10_000) return;
  samples.push({ rtt, offset: s - (c + rtt / 2) });
  const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
  useParty.setState({ offset: best.offset });
}

// ─── From the hub ────────────────────────────────────────────────────────────

/** A channel's parties on (re)connecting; `roomIds` are its rooms, whose old parties this replaces. */
export function onParties(parties: Record<string, PartyState> | undefined, roomIds: string[]) {
  useParty.setState((s) => {
    const next = { ...s.parties };
    for (const id of roomIds) if (!parties?.[id]) delete next[id];
    return { parties: { ...next, ...parties } };
  });
}

export function onParty(roomId: string, party: PartyState | null, resolved?: string) {
  const before = useParty.getState().parties[roomId];
  useParty.setState((s) => {
    const parties = { ...s.parties };
    if (party) parties[roomId] = party;
    else delete parties[roomId];
    // A change answers any request made before it; an accepted one is gone for everyone.
    const requests = s.requests.filter((r) => r.roomId !== roomId || (!!party && r.id !== resolved && r.at > Date.now() - 30_000));
    return { parties, requests };
  });
  const me = useAuth.getState().me?.id;
  const here = useVoice.getState().roomId === roomId;
  if (!party) {
    if (before && here) toast({ kind: 'info', title: 'The watch party ended' });
    return;
  }
  const fresh = !before || before.id !== party.id;
  if (fresh && here) {
    syncClock();
    if (party.hostId !== me) toast({ kind: 'info', title: `${nameOf(party.hostId)} planned a watch party`, body: `${party.file.name}. Get the movie, then tap “I’m ready”.` });
  }
  // The party went live: whoever was ready (and whoever started it) watches along from the start.
  if (party.phase === 'live' && (fresh ? party.hostId === me : before.phase === 'lobby')) {
    if (party.ready.includes(me ?? '') || party.by === me || party.hostId === me) markJoined(party.id);
    if (here && !fresh && party.by !== me) toast({ kind: 'info', title: 'The watch party is starting' });
  }
  if (!fresh && party.phase === 'live' && before.phase === 'live' && party.by !== me && before.playing !== party.playing && here) {
    toast({ kind: 'info', title: `${nameOf(party.by)} ${party.playing ? 'pressed play' : 'paused'}` });
  }
  if (before?.hostId !== party.hostId && party.hostId === me && before) toast({ kind: 'info', title: 'You’re now the watch party’s host' });
  void prepare(roomId);
}

export function onStatus(roomId: string, peerId: string, userId: string, status: PartyMemberStatus) {
  useParty.setState((s) => ({ statuses: { ...s.statuses, [roomId]: { ...s.statuses[roomId], [peerId]: { ...status, userId } } } }));
}

export function onRequest(r: Omit<PartyRequest, 'at'>) {
  const party = useParty.getState().parties[r.roomId];
  const me = useAuth.getState().me?.id;
  if (!party || r.from === me || !canControl(r.roomId, me)) return;
  useParty.setState((s) => ({ requests: [...s.requests.filter((x) => x.from !== r.from || x.roomId !== r.roomId), { ...r, at: Date.now() }].slice(-6) }));
}

const nameOf = (userId: string) => useChannels.getState().users[userId]?.name ?? 'Someone';

// ─── This device's copy ──────────────────────────────────────────────────────

let lastStatus = '';

/** Tells the room where this device stands with the movie. */
export function sendStatus(roomId: string, force = false) {
  const party = useParty.getState().parties[roomId];
  const hub = hubFor();
  if (!party || !hub || useVoice.getState().roomId !== roomId) return;
  const copy = useParty.getState().copies[party.file.id];
  const entry = useMedia.getState().items[party.file.id];
  const status: PartyMemberStatus =
    copy?.state === 'ready'
      ? { state: 'ready' }
      : entry?.status === 'loading' || entry?.status === 'requesting' || entry?.status === 'waiting' || entry?.status === 'saving'
        ? { state: 'copying', progress: Math.round((entry.progress ?? 0) * 100) / 100 }
        : entry?.status === 'error' || entry?.status === 'offline'
          ? { state: 'failed' }
          : { state: 'choosing' };
  const key = `${roomId}|${status.state}|${Math.round((status.progress ?? 0) * 20)}`;
  if (key === lastStatus && !force) return;
  lastStatus = key;
  hub.send({ t: 'party.status', roomId, status });
}

/** Finds this device's copy of the party's movie (and loads its subtitles). */
export async function prepare(roomId: string) {
  const party = useParty.getState().parties[roomId];
  if (!party) return;
  void loadSubtitle(party.subtitle);
  const existing = useParty.getState().copies[party.file.id];
  if (existing?.state === 'ready' || existing?.state === 'checking') return sendStatus(roomId);
  setCopy(party.file.id, { state: 'checking' });
  // The host has the original; anyone else may have copied it before (or picked their own).
  const candidates = [party.file.id, savedCopies()[party.file.id], useMedia.getState().items[party.file.id]?.savedId].filter((x): x is string => !!x);
  for (const id of candidates) {
    const file = await localMedia.stat(id).catch(() => null);
    if (file && (id !== party.file.id || party.file.ownerId === useAuth.getState().me?.id)) {
      setCopy(party.file.id, { state: 'ready', url: localMedia.src(file.path), localId: file.id });
      return sendStatus(roomId, true);
    }
  }
  setCopy(party.file.id, { state: 'none' });
  sendStatus(roomId, true);
}

/** Copies the movie from the host, into the save folder (asked the first time). */
export async function copyMovie(roomId: string) {
  const party = useParty.getState().parties[roomId];
  const hub = hubFor();
  if (!party || !hub) return;
  const started = await copyFile(hub, asAttachment(party.file), { handOver: false });
  if (!started) return;
  sendStatus(roomId, true);
}

/** Uses a copy this person already has (picked from their computer). */
export async function pickOwnCopy(roomId: string) {
  const party = useParty.getState().parties[roomId];
  if (!party) return;
  const [file] = await localMedia.pick().catch(() => [] as SharedFile[]);
  if (!file) return;
  if (file.size !== party.file.size) {
    toast({ kind: 'info', title: 'That file is a different size', body: 'If it’s a different version of the movie, it may not line up with everyone else’s.' });
  }
  rememberCopy(party.file.id, file.id);
  setCopy(party.file.id, { state: 'ready', url: localMedia.src(file.path), localId: file.id });
  sendStatus(roomId, true);
}

// A finished copy becomes this device's movie.
useMedia.subscribe((s, prev) => {
  for (const [roomId, party] of Object.entries(useParty.getState().parties)) {
    const entry = s.items[party.file.id];
    if (!entry || entry === prev.items[party.file.id]) continue;
    if (entry.status === 'ready' && entry.savedId) {
      const localId = entry.savedId;
      rememberCopy(party.file.id, localId);
      if (entry.url) setCopy(party.file.id, { state: 'ready', url: entry.url, localId });
      // Saved under a type the chat doesn't play inline (e.g. an unknown one): find it by id.
      else void localMedia.stat(localId).then((f) => f && setCopy(party.file.id, { state: 'ready', url: localMedia.src(f.path), localId }));
    }
    sendStatus(roomId);
  }
});

// Newcomers to the room hear where everyone stands.
let lastPeople = '';
useChannels.subscribe((s) => {
  const vs = useVoice.getState();
  if (!vs.roomId || !vs.channelId || !useParty.getState().parties[vs.roomId]) return;
  const people = (s.voice[vs.channelId]?.participants ?? []).filter((p) => p.roomId === vs.roomId).map((p) => p.peerId).sort().join();
  if (people === lastPeople) return;
  lastPeople = people;
  sendStatus(vs.roomId, true);
});

async function loadSubtitle(sub: PartyFile | null) {
  if (!sub || useParty.getState().subtitles[sub.id]) return;
  const mark = (url: string) => useParty.setState((s) => ({ subtitles: { ...s.subtitles, [sub.id]: url } }));
  const own = await localMedia.stat(sub.id).catch(() => null);
  let text: string | null = null;
  if (own) text = new TextDecoder().decode(await localMedia.read(sub.id, 0, Math.min(sub.size, 8 * 1024 * 1024)));
  else {
    const hub = hubFor();
    if (!hub) return;
    requestMedia(hub, asAttachment(sub));
    const blob = await new Promise<Blob | null>((resolve) => {
      const off = useMedia.subscribe((s) => {
        const e = s.items[sub.id];
        if (e?.status === 'ready' && e.blob) (off(), resolve(e.blob));
        else if (e && ['offline', 'gone', 'error'].includes(e.status)) (off(), resolve(null));
      });
    });
    if (blob) text = await blob.text();
  }
  if (text) mark(URL.createObjectURL(new Blob([toVtt(sub.name, text)], { type: 'text/vtt' })));
}

// ─── Actions ─────────────────────────────────────────────────────────────────

const fileOf = (f: SharedFile, ownerId: string): PartyFile => ({ id: f.id, ownerId, name: f.name, mime: f.mime, size: f.size });

/** The player registers itself, so a pause lands on the frame people actually see. */
let player: HTMLVideoElement | null = null;
export const attachPlayer = (video: HTMLVideoElement | null) => void (player = video);

function currentPosition(party: PartyState) {
  return player && !Number.isNaN(player.currentTime) && player.readyState > 0 ? player.currentTime : expectedPosition(party);
}

function set(roomId: string, patch: Partial<Pick<PartyState, 'file' | 'subtitle' | 'playing' | 'position' | 'at'>> | null, resolves?: string) {
  const hub = hubFor();
  const party = useParty.getState().parties[roomId];
  if (!hub) return;
  if (patch === null) return hub.send({ t: 'party.set', roomId, party: null });
  if (!party) return;
  const next = { file: party.file, subtitle: party.subtitle, playing: party.playing, position: party.position, at: party.at, ...patch };
  hub.send({ t: 'party.set', roomId, party: next, resolves });
  // Show it here at once; the hub's copy follows.
  useParty.setState((s) => ({ parties: { ...s.parties, [roomId]: { ...party, ...next } } }));
}

/** Picks a movie (and maybe its subtitles) from this device, for planning a party. */
export async function pickMovie() {
  const files = await localMedia.pick().catch(() => [] as SharedFile[]);
  const movie = files.find((f) => f.mime.startsWith('video/') || /\.(mkv|mp4|m4v|webm|mov|avi)$/i.test(f.name)) ?? files.find((f) => !isSubtitle(f.name));
  return { movie: movie ?? null, subtitle: files.find((f) => isSubtitle(f.name)) ?? null };
}

/** Picks a subtitle file from this device. */
export async function pickSubtitle() {
  const [file] = await localMedia.pick().catch(() => [] as SharedFile[]);
  if (file && !isSubtitle(file.name)) {
    toast({ kind: 'info', title: 'Pick a subtitle file', body: '.srt, .vtt, .ass or .ssa' });
    return null;
  }
  return file ?? null;
}

/** Resolves once the hub lists this device in `roomId`'s call (false if that takes too long). */
export function whenInRoom(roomId: string, timeout = 8000) {
  const inRoom = () => {
    const vs = useVoice.getState();
    const snap = vs.channelId ? useChannels.getState().voice[vs.channelId] : undefined;
    return vs.roomId === roomId && !!snap?.participants.some((p) => p.roomId === roomId && p.peerId === voice.peerId);
  };
  return new Promise<boolean>((resolve) => {
    if (inRoom()) return resolve(true);
    const done = (ok: boolean) => (offA(), offB(), clearTimeout(timer), resolve(ok));
    const check = () => inRoom() && done(true);
    const offA = useChannels.subscribe(check);
    const offB = useVoice.subscribe(check);
    const timer = setTimeout(() => done(false), timeout);
  });
}

/** Opens a planned party as a lobby in `roomId` (this device must be in that room's call). */
export function createParty(roomId: string, movie: SharedFile, subtitle: SharedFile | null, settings: PartySettings) {
  if (!featureOn('watchParty')) return toast({ kind: 'info', title: 'Watch parties are paused', body: 'We switched them off for a moment while we fix something. They’ll be back soon.' });
  const me = useAuth.getState().me?.id;
  const hub = hubFor();
  if (!me || !hub) return;
  syncClock();
  hub.send({
    t: 'party.set',
    roomId,
    party: { file: fileOf(movie, me), subtitle: subtitle ? fileOf(subtitle, me) : null, playing: false, position: 0, at: serverNow(), settings },
  });
}

/** The host (or a co-host) starts the lobby for everyone. */
export const startNow = (roomId: string) => hubFor()?.send({ t: 'party.start', roomId });

export const setReady = (roomId: string, ready: boolean) => hubFor()?.send({ t: 'party.ready', roomId, ready });

export const saveSettings = (roomId: string, settings: PartySettings) => hubFor()?.send({ t: 'party.settings', roomId, settings });

/** Changes the movie: back to the lobby so everyone gets the new one. */
export function changeMovie(roomId: string, movie: SharedFile, subtitle: SharedFile | null) {
  const me = useAuth.getState().me?.id;
  if (me) set(roomId, { file: fileOf(movie, me), subtitle: subtitle ? fileOf(subtitle, me) : null, playing: false, position: 0, at: serverNow() });
}

export async function addSubtitles(roomId: string) {
  const me = useAuth.getState().me?.id;
  if (!me) return;
  const [file] = await localMedia.pick().catch(() => [] as SharedFile[]);
  if (!file) return;
  if (!isSubtitle(file.name)) return toast({ kind: 'info', title: 'Pick a subtitle file', body: '.srt, .vtt, .ass or .ssa' });
  set(roomId, { subtitle: fileOf(file, me) });
}

export const removeSubtitles = (roomId: string) => set(roomId, { subtitle: null });

export function apply(roomId: string, action: PartyAction, resolves?: string) {
  const party = useParty.getState().parties[roomId];
  if (!party) return;
  const now = serverNow();
  if (action.kind === 'pause') return set(roomId, { playing: false, position: currentPosition(party), at: now }, resolves);
  if (action.kind === 'play') return set(roomId, { playing: true, position: action.position ?? currentPosition(party), at: now + LEAD_MS }, resolves);
  const position = Math.max(0, action.position);
  set(roomId, { position, at: party.playing ? now + LEAD_MS : now }, resolves);
}

/** Play/pause/seek: done directly by those in control, asked of the host by everyone else. */
export function act(roomId: string, action: PartyAction) {
  const party = useParty.getState().parties[roomId];
  const me = useAuth.getState().me?.id;
  if (!party) return;
  if (canControl(roomId, me)) return apply(roomId, action);
  if (!(party.settings ?? DEFAULT_PARTY_SETTINGS).requests) return toast({ kind: 'info', title: 'Only the host controls playback', body: 'The host has turned off requests.' });
  hubFor()?.send({ t: 'party.request', roomId, action });
  toast({ kind: 'info', title: 'Asked the host', body: describe(action) });
}

export function accept(r: PartyRequest) {
  apply(r.roomId, r.action, r.id);
  dismiss(r.id);
}

export const dismiss = (id: string) => useParty.setState((s) => ({ requests: s.requests.filter((r) => r.id !== id) }));

export const endParty = (roomId: string) => set(roomId, null);

export function setCohost(roomId: string, userId: string, on: boolean) {
  hubFor()?.send({ t: 'party.cohost', roomId, userId, on });
}

export function formatTime(t: number) {
  const s = Math.max(0, Math.floor(t));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function describe(action: PartyAction) {
  return action.kind === 'pause' ? 'Pause' : action.kind === 'seek' ? `Jump to ${formatTime(action.position)}` : action.position !== undefined ? `Play from ${formatTime(action.position)}` : 'Play';
}

