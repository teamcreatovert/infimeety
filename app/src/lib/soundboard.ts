import { create } from 'zustand';
import type { SoundRef } from '../../../shared/protocol';
import { usePenalties, useSecondsLeft } from './penalties';
import { getHub } from './realtime';
import { featureOn } from './remote';
import { packBuffer, syncSoundPack, useSoundPack, type PackSound } from './soundPack';
import { voice } from './voice/engine';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { useSettings } from '@/stores/settings';
import { toast } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

/**
 * The soundboard: sounds from the shared pack (lib/soundPack), played for everyone in your voice
 * room. Only the sound's id goes over the wire; every app plays it from its own copy, through the
 * call's output, so your output device, volume and Deafen all apply.
 */

/** A sound plays at most this long, then fades: a soundboard is for short moments. */
const MAX_SECONDS = 15;

const findSound = (id: string) => useSoundPack.getState().sounds.find((s) => s.id === id);

/** Recent sounds, for the little bubbles that rise above the call's controls. */
export const useSoundBursts = create<{ bursts: { id: number; name: string; who: string }[] }>()(() => ({ bursts: [] }));
let burstId = 0;
function burst(name: string, who: string) {
  const id = ++burstId;
  useSoundBursts.setState((s) => ({ bursts: [...s.bursts.slice(-3), { id, name, who }] }));
  setTimeout(() => useSoundBursts.setState((s) => ({ bursts: s.bursts.filter((b) => b.id !== id) })), 2200);
}

/** Same allowance as the server (4 at once, then one every 2 s), so you never hear a sound nobody else did. */
let tokens = 4;
let refilled = Date.now();
function takeToken() {
  const now = Date.now();
  tokens = Math.min(4, tokens + ((now - refilled) / 1000) * 0.5);
  refilled = now;
  if (tokens < 1) return false;
  tokens -= 1;
  return true;
}

/** Sounds playing right now, by who played them: a new one replaces that person's last one. */
const active = new Map<string, Set<AudioBufferSourceNode>>();
const PREVIEW = '__preview';

/** The sound you're playing for everyone, for the big Stop button. */
export const useMySound = create<{ id: string | null; name: string; emoji?: string }>()(() => ({ id: null, name: '' }));

function stopOf(userId: string) {
  for (const src of active.get(userId) ?? []) {
    try {
      src.stop();
    } catch {
      // Already over.
    }
  }
  active.delete(userId);
}

async function start(ctx: AudioContext, out: AudioNode, sound: PackSound, volume: number, owner: string) {
  const buffer = await packBuffer(ctx, sound);
  const gain = ctx.createGain();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(gain).connect(out);
  const t = ctx.currentTime + 0.02;
  gain.gain.setValueAtTime(volume, t);
  src.start(t);
  if (buffer.duration > MAX_SECONDS) {
    gain.gain.setValueAtTime(volume, t + MAX_SECONDS - 0.6);
    gain.gain.linearRampToValueAtTime(0, t + MAX_SECONDS);
    src.stop(t + MAX_SECONDS);
  }
  const mine = active.get(owner) ?? new Set();
  mine.add(src);
  active.set(owner, mine);
  src.onended = () => {
    active.get(owner)?.delete(src);
    gain.disconnect();
  };
  return src;
}

export function stopAllSounds() {
  for (const owner of [...active.keys()]) if (owner !== PREVIEW) stopOf(owner);
}

async function render(id: string, userId: string, mine: boolean) {
  let sound = findSound(id);
  // A sound added since this app last synced: fetch the new list once.
  if (!sound) {
    await syncSoundPack();
    sound = findSound(id);
  }
  if (!sound) return;
  const s = useSettings.getState();
  burst(sound.name, mine ? 'You' : (useChannels.getState().users[userId]?.name ?? 'Someone'));
  if (!mine && (!s.hearSounds || s.localMutes[userId])) return;
  const output = voice.soundOutput();
  if (!output) return;
  // Like Discord: someone's new sound cuts off their previous one.
  stopOf(userId);
  const src = await start(output.ctx, output.out, sound, s.soundboardVolume * (mine ? 1 : Math.min(1.5, s.userVolumes[userId] ?? 1)), userId).catch(() => null);
  if (mine && src) {
    useMySound.setState({ id: sound.id, name: sound.name, emoji: sound.emoji });
    src.addEventListener('ended', () => {
      if (!active.get(userId)?.size) useMySound.setState({ id: null, name: '', emoji: undefined });
    });
  }
}

/** Why you can't play sounds right now, or null if you can. */
export function useSoundboardBlocked() {
  const channelId = useVoice((s) => s.channelId);
  const roomId = useVoice((s) => s.roomId);
  const serverMuted = useVoice((s) => s.serverMuted);
  const roomMuted = useChannels((s) => (channelId && roomId ? (s.voice[channelId]?.mutedRooms.includes(roomId) ?? false) : false));
  const isMod = useChannels((s) => (s.channels.find((c) => c.id === channelId)?.role ?? 'member') !== 'member');
  const ruleMuted = useSecondsLeft(usePenalties((s) => (channelId ? s[channelId]?.voiceUntil : undefined))) > 0;
  if (serverMuted) return 'An admin muted you, so your sounds don’t play.';
  if (ruleMuted) return 'A fun rule muted you, so your sounds don’t play.';
  if (roomMuted && !isMod) return 'Everyone’s muted in this room, so sounds don’t play.';
  return null;
}

/** Plays a sound for everyone in your voice room (and you). */
export function playSound(id: string) {
  const vs = useVoice.getState();
  if (!vs.channelId || !vs.roomId || !findSound(id)) return;
  if (!featureOn('soundboard')) return toast({ kind: 'info', title: 'The soundboard is paused', body: 'It’s back soon.' });
  if (vs.serverMuted) return toast({ kind: 'info', title: 'An admin muted you', body: 'Your sounds don’t play while you’re muted.' });
  if ((usePenalties.getState()[vs.channelId]?.voiceUntil ?? 0) > Date.now()) return toast({ kind: 'info', title: 'A fun rule muted you', body: 'Your sounds play again once it’s over.' });
  if (!takeToken()) return toast({ kind: 'info', title: 'Easy there', body: 'A few sounds at a time, then one every couple of seconds.' });
  const sound: SoundRef = { kind: 'pack', id };
  getHub(vs.channelId)?.send({ t: 'sound.play', sound });
  void render(id, useAuth.getState().me?.id ?? '', true);
}

/** Stops the sound you're playing, for everyone in the call. */
export function stopMySound() {
  const vs = useVoice.getState();
  stopOf(useAuth.getState().me?.id ?? '');
  useMySound.setState({ id: null, name: '', emoji: undefined });
  if (vs.channelId) getHub(vs.channelId)?.send({ t: 'sound.stop' });
}

/** The server didn't play your sound for anyone: don't let you think it did. */
export function onSoundBlocked() {
  stopOf(useAuth.getState().me?.id ?? '');
  useMySound.setState({ id: null, name: '', emoji: undefined });
  toast({ kind: 'info', title: 'Your sound didn’t play', body: 'You’re muted right now, so nobody hears your sounds.' });
}

/** Someone stopped their sound. */
export function onSoundStop(userId: string) {
  if (typeof userId === 'string') stopOf(userId);
}

/** Someone else in your voice room played a sound. */
export function onSound(msg: { userId: string; sound: SoundRef }) {
  if (!useVoice.getState().roomId || !featureOn('soundboard')) return;
  const { sound } = msg;
  if (sound?.kind !== 'pack' || typeof sound.id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(sound.id)) return;
  void render(sound.id, msg.userId, false);
}

// ─── Preview ─────────────────────────────────────────────────────────────────

/** The sound you're trying out (only you hear it). */
export const usePreview = create<{ id: string | null }>()(() => ({ id: null }));
let previewing: AudioBufferSourceNode | null = null;
let previewCtx: AudioContext | null = null;

/** Plays a sound just for you; again on the same sound stops it. */
export async function previewSound(id: string) {
  const current = usePreview.getState().id;
  previewing?.stop();
  previewing = null;
  usePreview.setState({ id: null });
  if (current === id) return;
  const sound = findSound(id);
  if (!sound) return;
  const output = voice.soundOutput();
  const ctx = output?.ctx ?? (previewCtx ??= new AudioContext({ latencyHint: 'interactive' }));
  if (ctx.state !== 'running') await ctx.resume().catch(() => {});
  usePreview.setState({ id });
  try {
    const src = await start(ctx, output?.preview ?? ctx.destination, sound, useSettings.getState().soundboardVolume, PREVIEW);
    if (usePreview.getState().id !== id) return src.stop();
    previewing = src;
    src.addEventListener('ended', () => {
      if (previewing === src) {
        previewing = null;
        usePreview.setState({ id: null });
      }
    });
  } catch {
    usePreview.setState({ id: null });
  }
}

export function stopPreview() {
  previewing?.stop();
  previewing = null;
  usePreview.setState({ id: null });
}

export function toggleFavorite(id: string) {
  const { soundFavorites, set } = useSettings.getState();
  set({ soundFavorites: soundFavorites.includes(id) ? soundFavorites.filter((f) => f !== id) : [...soundFavorites, id] });
}
