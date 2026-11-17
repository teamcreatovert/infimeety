import { create } from 'zustand';
import { DEFAULT_PARTY_SETTINGS } from '../../../shared/protocol';
import type { Attachment, PartyAction, PartyFile, PartyMemberStatus, PartySettings, PartyState } from '../../../shared/protocol';
import { rememberCopy, savedCopies } from './copies';
import { canConvert, convertMovie, isHevc, isMac, isTauri, localMedia, probeMkv, type SharedFile } from './platform';
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
/** Play after a pause: 3, 2, 1 (the player's countdown), while every copy lines up on the same frame. */
const PLAY_LEAD_MS = 3000;

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
  if (party.by && party.by !== me) holds.delete(roomId); // someone else pressed play or pause: theirs wins
  void prepare(roomId);
}

export function onStatus(roomId: string, peerId: string, userId: string, status: PartyMemberStatus) {
  useParty.setState((s) => ({ statuses: { ...s.statuses, [roomId]: { ...s.statuses[roomId], [peerId]: { ...status, userId } } } }));
  holdForLoading(roomId);
}

/** Rooms the host's app paused because someone was still loading: since when. */
const holds = new Map<string, number>();
const HOLD_MAX = 15_000;

/**
 * Everyone starts together, like Teleparty: while anyone in the room is still loading the part
 * being played, the host's app pauses the party right there, then plays it for all at once when
 * nobody is (or after 15 s, so one slow copy doesn't hold everyone forever).
 */
function holdForLoading(roomId: string) {
  const party = useParty.getState().parties[roomId];
  const me = useAuth.getState().me?.id;
  if (!party || party.phase !== 'live' || party.hostId !== me) return;
  const here = new Set(roomPeople(roomId));
  const loading = Object.values(useParty.getState().statuses[roomId] ?? {}).some((s) => s.state === 'buffering' && here.has(s.userId));
  const since = holds.get(roomId);
  if (party.playing && loading && since === undefined) {
    holds.set(roomId, Date.now());
    set(roomId, { playing: false, position: expectedPosition(party), at: serverNow() });
  } else if (since !== undefined && !party.playing && (!loading || Date.now() - since > HOLD_MAX)) {
    holds.delete(roomId);
    // A moment ahead, so every copy is on the frame when it starts.
    set(roomId, { playing: true, position: party.position, at: serverNow() + PLAY_LEAD_MS });
  }
}
setInterval(() => holds.forEach((_, roomId) => holdForLoading(roomId)), 1000);

export function onRequest(r: Omit<PartyRequest, 'at'>) {
  const party = useParty.getState().parties[r.roomId];
  const me = useAuth.getState().me?.id;
  if (!party || r.from === me || !canControl(r.roomId, me)) return;
  useParty.setState((s) => ({ requests: [...s.requests.filter((x) => x.from !== r.from || x.roomId !== r.roomId), { ...r, at: Date.now() }].slice(-6) }));
}

const nameOf = (userId: string) => useChannels.getState().users[userId]?.name ?? 'Someone';

// ─── This device's copy ──────────────────────────────────────────────────────

let lastStatus = '';
/** This device has the movie but is loading the part being played. */
let buffering = false;

export function setBuffering(roomId: string, on: boolean) {
  if (buffering === on) return;
  buffering = on;
  sendStatus(roomId);
}

/** Tells the room where this device stands with the movie. */
export function sendStatus(roomId: string, force = false) {
  const party = useParty.getState().parties[roomId];
  const hub = hubFor();
  if (!party || !hub || useVoice.getState().roomId !== roomId) return;
  const copy = useParty.getState().copies[party.file.id];
  const entry = useMedia.getState().items[party.file.id];
  const status: PartyMemberStatus =
    copy?.state === 'ready'
      ? { state: buffering ? 'buffering' : 'ready' }
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

/** The built-in subtitles of movies this device hosts, by movie id, for the subtitle menu. */
export const useEmbedded = create<Record<string, { label: string; file: SharedFile }[]>>()(() => ({}));

/** Sound formats web engines don't play: the picture shows, the sound doesn't. */
const SILENT_SOUND = /^A_(AC3|EAC3|DTS|TRUEHD|MLP)/;
const LANGUAGES: Record<string, string> = { eng: 'en', spa: 'es', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', ita: 'it', por: 'pt', rus: 'ru', jpn: 'ja', kor: 'ko', chi: 'zh', zho: 'zh', ara: 'ar', hin: 'hi', ben: 'bn', tur: 'tr', urd: 'ur', ind: 'id', tha: 'th', vie: 'vi', pol: 'pl', dut: 'nl', nld: 'nl', swe: 'sv' };

function languageName(code: string) {
  const tag = LANGUAGES[code.toLowerCase()] ?? code;
  if (!tag || tag === 'und') return '';
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/**
 * The host picked an MKV: its built-in subtitles become subtitle files friends get like any other
 * (browsers too), the best one turned on (the movie's default, or English), and a sound format
 * the app can't play is said up front.
 */
async function scanMovie(roomId: string, movie: SharedFile, pickSubtitle: boolean) {
  if (!isTauri || !/\.(mkv|webm|mk3d)$/i.test(movie.name)) return;
  const probe = await probeMkv(movie.id).catch(() => null);
  if (!probe) return;
  // The sound to play: the movie's default track, else English, else the first.
  const sounds = probe.tracks.filter((t) => t.kind === 'audio');
  const pickSound = Math.max(0, sounds.findIndex((t) => t.default) >= 0 ? sounds.findIndex((t) => t.default) : sounds.findIndex((t) => /^en/i.test(t.language)));
  const sound = sounds[pickSound];
  if (sound && SILENT_SOUND.test(sound.codec)) {
    if (await canConvert()) void convertSound(roomId, movie, pickSound, isHevc(probe));
    else {
      const format = /DTS/.test(sound.codec) ? 'DTS' : 'Dolby';
      toast({ kind: 'info', title: `This movie’s sound is ${format}`, body: 'This app can’t play that sound format, so the movie would be silent. A copy with AAC or MP3 sound plays fine.' });
    }
  }
  if (!probe.subtitles.length) {
    if (probe.tracks.some((t) => t.kind === 'subtitle'))
      toast({ kind: 'info', title: 'Its subtitles are pictures', body: 'This movie’s built-in subtitles are images, which can’t be shown yet. Add an .srt file instead.' });
    return;
  }
  const base = movie.name.replace(/\.[^.]+$/, '');
  const saved: { label: string; file: SharedFile; sub: (typeof probe.subtitles)[number] }[] = [];
  for (const sub of probe.subtitles) {
    const label = (sub.name || languageName(sub.language) || `Track ${sub.track}`) + (sub.forced ? ' (forced)' : '');
    const file = await localMedia.saveBytes(`${base}.${sub.language || sub.track}.vtt`, new TextEncoder().encode(sub.vtt)).catch(() => null);
    if (file) saved.push({ label, file, sub });
  }
  useEmbedded.setState({ [movie.id]: saved.map(({ label, file }) => ({ label, file })) });
  if (!pickSubtitle || !saved.length) return;
  const pick =
    saved.find((s) => s.sub.default && !s.sub.forced) ?? saved.find((s) => /^en/i.test(s.sub.language) && !s.sub.forced) ?? saved.find((s) => !s.sub.forced) ?? saved[0];
  // The party appears a moment after it's sent; wait for it (not long).
  for (let i = 0; i < 25; i++) {
    const party = useParty.getState().parties[roomId];
    if (party?.file.id === movie.id) {
      const me = useAuth.getState().me?.id;
      if (me && !party.subtitle) set(roomId, { subtitle: fileOf(pick.file, me) });
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Movies whose sound is being made playable, by movie id: how far along (0 to 1). */
export const useConverting = create<Record<string, number>>()(() => ({}));

/**
 * Dolby or DTS sound: the host's app makes a copy with AAC sound (the bundled converter, a
 * minute or two) and the party switches to it, keeping its subtitles. Friends get that copy.
 */
async function convertSound(roomId: string, movie: SharedFile, audio: number, hevc: boolean) {
  toast({ kind: 'info', title: 'Making the sound playable', body: 'This movie’s Dolby or DTS sound is being turned into a format every device plays. It takes a minute or two, and the party switches over by itself.' });
  useConverting.setState({ [movie.id]: 0 });
  try {
    const file = await convertMovie(movie.id, audio, hevc, (done) => useConverting.setState({ [movie.id]: done }));
    useEmbedded.setState((s) => ({ [file.id]: s[movie.id] ?? [] }));
    const party = useParty.getState().parties[roomId];
    const me = useAuth.getState().me?.id;
    if (me && party?.file.id === movie.id) set(roomId, { file: fileOf(file, me), subtitle: party.subtitle, playing: false, position: 0, at: serverNow() });
    toast({ kind: 'success', title: 'The sound is ready', body: 'Everyone gets the copy with sound that plays everywhere.' });
  } catch (err) {
    toast({ kind: 'error', title: 'Couldn’t convert the sound', body: String(err) });
  } finally {
    useConverting.setState((s) => {
      const next = { ...s };
      delete next[movie.id];
      return next;
    }, true);
  }
}

/** The built-in subtitle tracks of this device's own copy of a party movie, by movie id: anyone can pick theirs. */
export const useLocalTracks = create<Record<string, { label: string; url: string }[]>>()(() => ({}));

/** Desktop: reads the subtitle tracks of this device's MKV copy, for the "just for me" menu. */
export async function inspectCopy(fileId: string, name: string) {
  const localId = useParty.getState().copies[fileId]?.localId;
  if (!isTauri || !localId || !/\.(mkv|webm)$/i.test(name) || useLocalTracks.getState()[fileId]) return;
  const probe = await probeMkv(localId).catch(() => null);
  if (!probe) return;
  const list = probe.subtitles.map((sub) => ({
    label: (sub.name || languageName(sub.language) || `Track ${sub.track}`) + (sub.forced ? ' (forced)' : ''),
    url: URL.createObjectURL(new Blob([sub.vtt], { type: 'text/vtt' })),
  }));
  useLocalTracks.setState({ [fileId]: list });
}

const repacking = new Set<string>();

/**
 * Macs can't open MKV files at all (WebKit has no MKV reader), even when what's inside plays fine.
 * This device's copy is repacked as an MP4 with the bundled converter: picture copied, every sound
 * track kept (as AAC), HEVC labelled the way Macs play it. Only for this device; the party is unchanged.
 */
export async function repackForMac(fileId: string) {
  const localId = useParty.getState().copies[fileId]?.localId;
  if (!isTauri || !isMac || !localId || repacking.has(fileId) || !(await canConvert())) return false;
  repacking.add(fileId);
  useConverting.setState({ [fileId]: 0 });
  try {
    const probe = await probeMkv(localId).catch(() => null);
    const file = await convertMovie(localId, null, !!probe && isHevc(probe), (done) => useConverting.setState({ [fileId]: done }));
    rememberCopy(fileId, file.id);
    setCopy(fileId, { state: 'ready', url: localMedia.src(file.path), localId: file.id });
    return true;
  } catch (err) {
    toast({ kind: 'error', title: 'Couldn’t make a copy this Mac plays', body: String(err) });
    return false;
  } finally {
    repacking.delete(fileId);
    useConverting.setState((s) => {
      const next = { ...s };
      delete next[fileId];
      return next;
    }, true);
  }
}

/** Turns on one of the movie's built-in subtitles for everyone. */
export function chooseEmbeddedSubtitle(roomId: string, file: SharedFile) {
  const me = useAuth.getState().me?.id;
  if (me) set(roomId, { subtitle: fileOf(file, me) });
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
  void scanMovie(roomId, movie, !subtitle);
}

/** The host (or a co-host) starts the lobby for everyone. */
export const startNow = (roomId: string) => hubFor()?.send({ t: 'party.start', roomId });

export const setReady = (roomId: string, ready: boolean) => hubFor()?.send({ t: 'party.ready', roomId, ready });

export const saveSettings = (roomId: string, settings: PartySettings) => hubFor()?.send({ t: 'party.settings', roomId, settings });

/** Changes the movie: back to the lobby so everyone gets the new one. */
export function changeMovie(roomId: string, movie: SharedFile, subtitle: SharedFile | null) {
  const me = useAuth.getState().me?.id;
  if (me) set(roomId, { file: fileOf(movie, me), subtitle: subtitle ? fileOf(subtitle, me) : null, playing: false, position: 0, at: serverNow() });
  void scanMovie(roomId, movie, !subtitle);
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
  if (action.kind === 'play') return set(roomId, { playing: true, position: action.position ?? currentPosition(party), at: now + (party.playing ? LEAD_MS : PLAY_LEAD_MS) }, resolves);
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


// Dev builds: for testing parties from the console (like __voice in voice/engine.ts).
if (import.meta.env.DEV) Object.assign(window, { __party: { createParty, useParty, useEmbedded, saveBytes: localMedia.saveBytes } });
