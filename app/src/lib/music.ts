import type { MusicAction, MusicState, MusicTrack } from '../../../shared/protocol';
import { serverNow, syncClock } from './party';
import { getHub } from './realtime';
import { useChannels } from '@/stores/channels';
import { useSettings } from '@/stores/settings';
import { toast } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

/**
 * The music bot: a voice room's shared queue (kept by the hub, like a watch party) that every
 * app in the room plays itself, in sync on the hub's clock. Songs come from Audius (free full
 * songs) and internet radio, searched straight from here: no links, no keys.
 */

export type MusicResult = Omit<MusicTrack, 'id' | 'by'>;

const APP = 'Infimeety';
let audiusHost: Promise<string> | null = null;
/** Audius picks a server for each app; any healthy one works. */
const host = () =>
  (audiusHost ??= fetch('https://api.audius.co')
    .then((r) => r.json() as Promise<{ data: string[] }>)
    .then((r) => r.data[0])
    .catch((err) => {
      audiusHost = null;
      throw err;
    }));

export async function searchSongs(q: string): Promise<MusicResult[]> {
  const h = await host();
  const res = await fetch(`${h}/v1/tracks/search?query=${encodeURIComponent(q)}&app_name=${APP}`);
  const { data } = (await res.json()) as { data?: { id: string; title: string; duration: number; is_streamable?: boolean; user?: { name?: string }; artwork?: Record<string, string> }[] };
  // Some tracks are listed but their artists don't allow playing them in other apps.
  return (data ?? [])
    .filter((t) => t.is_streamable !== false)
    .slice(0, 8)
    .map((t) => ({
    source: 'audius',
    ref: t.id,
    title: t.title,
    artist: t.user?.name ?? '',
    thumb: t.artwork?.['150x150'] ?? null,
    duration: Math.round(t.duration ?? 0),
  }));
}

export async function searchStations(q: string): Promise<MusicResult[]> {
  const res = await fetch(`https://de1.api.radio-browser.info/json/stations/search?name=${encodeURIComponent(q)}&limit=6&hidebroken=true&order=clickcount&reverse=true`);
  const list = (await res.json()) as { name: string; url_resolved: string; favicon?: string; country?: string; tags?: string }[];
  return list
    .filter((s) => /^https?:\/\//.test(s.url_resolved))
    .map((s) => ({
      source: 'radio',
      ref: s.url_resolved,
      title: s.name.trim(),
      artist: [s.country, s.tags?.split(',')[0]].filter(Boolean).join(' · '),
      thumb: s.favicon?.startsWith('https://') ? s.favicon : null,
      duration: 0,
    }));
}

const streamOf = async (t: MusicTrack) => (t.source === 'audius' ? `${await host()}/v1/tracks/${t.ref}/stream?app_name=${APP}` : t.ref);

/** Your room's music, if the bot is playing there. */
export function roomMusic(): MusicState | undefined {
  const { channelId, roomId } = useVoice.getState();
  return channelId && roomId ? useChannels.getState().voice[channelId]?.music?.[roomId] : undefined;
}

export function addToQueue(track: MusicResult) {
  const { channelId } = useVoice.getState();
  if (channelId) getHub(channelId)?.send({ t: 'music.add', track });
}

export function control(msg: MusicAction) {
  const { channelId } = useVoice.getState();
  if (channelId) getHub(channelId)?.send({ t: 'music.control', ...msg });
}

// ─── Playing ─────────────────────────────────────────────────────────────────

let audio: HTMLAudioElement | null = null;
let current = '';
let startTimer: ReturnType<typeof setTimeout> | undefined;

function stopPlayer() {
  clearTimeout(startTimer);
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  current = '';
}

async function follow() {
  const state = roomMusic();
  const track = state?.queue[state.index];
  if (!state || !track) return stopPlayer();
  const v = useVoice.getState();
  const s = useSettings.getState();
  audio ??= new Audio();
  const el = audio;
  el.volume = Math.max(0, Math.min(1, s.musicVolume * Math.min(1, s.outputVolume)));
  el.muted = v.deafened;
  const sink = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  void sink.setSinkId?.(s.outputDeviceId === 'default' ? '' : s.outputDeviceId).catch(() => {});
  if (current !== track.id) {
    current = track.id;
    el.src = await streamOf(track);
    el.onended = () => control({ action: 'ended', trackId: track.id });
    el.onerror = () => {
      if (current !== track.id) return;
      toast({ kind: 'info', title: `Couldn’t play ${track.title}`, body: 'Skipping to the next one.' });
      control({ action: 'ended', trackId: track.id });
    };
  }
  clearTimeout(startTimer);
  if (!state.playing) return el.pause();
  const expected = state.position + (serverNow() - state.at) / 1000;
  if (expected < 0) {
    // Everyone starts together, a moment from now.
    el.pause();
    if (track.duration) el.currentTime = 0;
    startTimer = setTimeout(() => void follow(), -expected * 1000);
    return;
  }
  // A live station has no position; songs stay within a second of everyone else.
  if (track.duration && Math.abs(el.currentTime - expected) > 1.2) el.currentTime = expected;
  await el.play().catch(() => {});
}

let started = false;
/** Keeps this app's player in step with its voice room's music. */
export function startMusicPlayer() {
  if (started) return;
  started = true;
  let last: MusicState | undefined;
  useChannels.subscribe(() => {
    const now = roomMusic();
    if (now === last) return;
    if (now && !last) {
      const { channelId } = useVoice.getState();
      if (channelId) syncClock(getHub(channelId));
    }
    last = now;
    void follow();
  });
  useVoice.subscribe((s, prev) => {
    if (s.roomId !== prev.roomId || s.deafened !== prev.deafened) void follow();
  });
  useSettings.subscribe((s, prev) => {
    if (s.musicVolume !== prev.musicVolume || s.outputVolume !== prev.outputVolume || s.outputDeviceId !== prev.outputDeviceId) void follow();
  });
}
