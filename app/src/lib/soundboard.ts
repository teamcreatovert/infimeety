import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SOUND_CLIP_MAX, type SoundRef } from '../../../shared/protocol';
import { getHub } from './realtime';
import { voice } from './voice/engine';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { useSettings } from '@/stores/settings';
import { toast } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

/**
 * The call's soundboard. Pressing a sound plays it for everyone in your voice room: the hub
 * relays a small message and each device plays it through the call's output (so Deafen
 * silences it too). The built-in sounds are made on the device with Web Audio; your own clips
 * (a laugh, a meme sound) live on your device and travel with the message. Nothing is stored
 * on the server.
 */

type Synth = (ctx: AudioContext, out: AudioNode, t: number) => void;

const noise = (ctx: AudioContext, seconds: number) => {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  return src;
};

/** A gain that swells to `peak` in `attack` seconds and dies away over `decay`. */
const envelope = (ctx: AudioContext, out: AudioNode, t: number, attack: number, peak: number, decay: number) => {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(out);
  return g;
};

const filter = (ctx: AudioContext, type: BiquadFilterType, frequency: number, q = 0.8) => {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = q;
  return f;
};

function tone(ctx: AudioContext, out: AudioNode, type: OscillatorType, freq: number, t: number, dur: number, peak: number, glideTo?: number) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
  o.connect(envelope(ctx, out, t, 0.006, peak, dur));
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
}

function clap(ctx: AudioContext, out: AudioNode, t: number, peak: number) {
  const n = noise(ctx, 0.18);
  n.connect(filter(ctx, 'bandpass', 1100 + Math.random() * 900, 0.9)).connect(envelope(ctx, out, t, 0.002, peak, 0.1));
  n.start(t);
  n.stop(t + 0.18);
}

/** A held brass-like note: detuned saws through a filter that opens ("wah") then settles. */
function brass(ctx: AudioContext, out: AudioNode, freq: number, t: number, dur: number, peak: number, vibrato = 0) {
  const lp = filter(ctx, 'lowpass', 500, 2);
  lp.frequency.setValueAtTime(450, t);
  lp.frequency.exponentialRampToValueAtTime(2200, t + 0.08);
  lp.frequency.exponentialRampToValueAtTime(900, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.04);
  g.gain.setValueAtTime(peak, t + dur - 0.08);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  lp.connect(g).connect(out);
  for (const detune of [-6, 6]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    o.detune.value = detune;
    if (vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 5.5;
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(vibrato, t + dur * 0.5);
      lfo.connect(depth).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur);
    }
    o.connect(lp);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
}

export interface BuiltinSound {
  id: string;
  label: string;
  emoji: string;
  play: Synth;
}

export const BUILTIN_SOUNDS: BuiltinSound[] = [
  {
    id: 'applause',
    label: 'Applause',
    emoji: '👏',
    play: (ctx, out, t) => {
      for (let i = 0; i < 30; i++) clap(ctx, out, t + Math.random() * 1.5, 0.12 + Math.random() * 0.22);
      const bed = noise(ctx, 1.9);
      bed.connect(filter(ctx, 'bandpass', 1600, 0.4)).connect(envelope(ctx, out, t, 0.2, 0.08, 1.6));
      bed.start(t);
      bed.stop(t + 1.9);
    },
  },
  {
    id: 'airhorn',
    label: 'Air horn',
    emoji: '📯',
    play: (ctx, out, t) => {
      const blast = (at: number, dur: number) => {
        const lp = filter(ctx, 'lowpass', 2600, 1.2);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.16, at + 0.025);
        g.gain.setValueAtTime(0.16, at + dur - 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
        lp.connect(g).connect(out);
        for (const f of [466, 470, 934]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(f, at);
          o.frequency.linearRampToValueAtTime(f * 0.96, at + dur);
          o.connect(lp);
          o.start(at);
          o.stop(at + dur + 0.02);
        }
      };
      blast(t, 0.16);
      blast(t + 0.21, 0.16);
      blast(t + 0.42, 0.9);
    },
  },
  {
    id: 'rimshot',
    label: 'Ba-dum-tss',
    emoji: '🥁',
    play: (ctx, out, t) => {
      tone(ctx, out, 'sine', 190, t, 0.25, 0.7, 85);
      tone(ctx, out, 'sine', 145, t + 0.17, 0.3, 0.7, 70);
      const cymbal = noise(ctx, 1.2);
      cymbal.connect(filter(ctx, 'highpass', 6500, 0.7)).connect(envelope(ctx, out, t + 0.36, 0.004, 0.35, 1));
      cymbal.start(t + 0.36);
      cymbal.stop(t + 1.5);
    },
  },
  {
    id: 'trombone',
    label: 'Sad trombone',
    emoji: '🎺',
    play: (ctx, out, t) => {
      const notes: [number, number][] = [
        [293.66, 0.42],
        [277.18, 0.42],
        [261.63, 0.42],
        [246.94, 1.35],
      ];
      let at = t;
      notes.forEach(([f, d], i) => {
        brass(ctx, out, f, at, d, 0.11, i === notes.length - 1 ? 7 : 0);
        at += d + 0.04;
      });
    },
  },
  {
    id: 'boom',
    label: 'Boom',
    emoji: '💥',
    play: (ctx, out, t) => {
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) curve[i] = Math.tanh(((i / 128 - 1) * 3));
      shaper.curve = curve;
      shaper.connect(envelope(ctx, out, t, 0.004, 0.6, 1.4));
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(72, t);
      o.frequency.exponentialRampToValueAtTime(30, t + 1.3);
      o.connect(shaper);
      o.start(t);
      o.stop(t + 1.5);
      const thump = noise(ctx, 0.3);
      thump.connect(filter(ctx, 'lowpass', 380)).connect(envelope(ctx, out, t, 0.003, 0.5, 0.25));
      thump.start(t);
      thump.stop(t + 0.3);
    },
  },
  {
    id: 'boing',
    label: 'Boing',
    emoji: '🪀',
    play: (ctx, out, t) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(260, t);
      o.frequency.exponentialRampToValueAtTime(420, t + 0.6);
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 17;
      depth.gain.setValueAtTime(130, t);
      depth.gain.exponentialRampToValueAtTime(1, t + 0.7);
      lfo.connect(depth).connect(o.frequency);
      o.connect(envelope(ctx, out, t, 0.005, 0.45, 0.7));
      o.start(t);
      lfo.start(t);
      o.stop(t + 0.75);
      lfo.stop(t + 0.75);
    },
  },
  {
    id: 'fart',
    label: 'Fart',
    emoji: '💨',
    play: (ctx, out, t) => {
      const dur = 0.85;
      const lp = filter(ctx, 'lowpass', 650, 5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.04);
      g.gain.setValueAtTime(0.45, t + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      // A fast wobble on the loudness gives it the flutter.
      const flutter = ctx.createOscillator();
      const flutterDepth = ctx.createGain();
      flutter.frequency.value = 28;
      flutterDepth.gain.value = 0.22;
      flutter.connect(flutterDepth).connect(g.gain);
      lp.connect(g).connect(out);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(105, t);
      o.frequency.linearRampToValueAtTime(78, t + dur);
      const wobble = ctx.createOscillator();
      const wobbleDepth = ctx.createGain();
      wobble.frequency.value = 7;
      wobbleDepth.gain.value = 18;
      wobble.connect(wobbleDepth).connect(o.frequency);
      o.connect(lp);
      const air = noise(ctx, dur);
      air.connect(filter(ctx, 'bandpass', 300, 1.2)).connect(envelope(ctx, out, t, 0.03, 0.12, dur));
      for (const node of [o, wobble, flutter, air]) {
        node.start(t);
        node.stop(t + dur + 0.05);
      }
    },
  },
  {
    id: 'crickets',
    label: 'Crickets',
    emoji: '🦗',
    play: (ctx, out, t) => {
      for (let chirp = 0; chirp < 3; chirp++)
        for (let pulse = 0; pulse < 4; pulse++) tone(ctx, out, 'sine', 4650, t + chirp * 0.55 + pulse * 0.045, 0.03, 0.18);
    },
  },
  {
    id: 'tada',
    label: 'Ta-da',
    emoji: '🎉',
    play: (ctx, out, t) => {
      for (const f of [523.25, 659.25, 783.99]) brass(ctx, out, f, t, 0.13, 0.06);
      for (const f of [523.25, 659.25, 783.99, 1046.5]) brass(ctx, out, f, t + 0.17, 1.1, 0.055, 5);
    },
  },
  {
    id: 'pop',
    label: 'Pop',
    emoji: '🫧',
    play: (ctx, out, t) => {
      tone(ctx, out, 'sine', 1300, t, 0.07, 0.6, 170);
      const click = noise(ctx, 0.02);
      click.connect(filter(ctx, 'highpass', 3000)).connect(envelope(ctx, out, t, 0.001, 0.25, 0.015));
      click.start(t);
      click.stop(t + 0.02);
    },
  },
  {
    id: 'ding',
    label: 'Ding',
    emoji: '🔔',
    play: (ctx, out, t) => {
      tone(ctx, out, 'sine', 880, t, 1.6, 0.35);
      tone(ctx, out, 'sine', 2440, t, 0.7, 0.12);
      tone(ctx, out, 'sine', 4770, t, 0.35, 0.06);
    },
  },
  {
    id: 'wrong',
    label: 'Wrong',
    emoji: '❌',
    play: (ctx, out, t) => {
      for (const at of [t, t + 0.4]) {
        const lp = filter(ctx, 'lowpass', 1800);
        lp.connect(envelope(ctx, out, at, 0.01, 0.16, 0.32));
        for (const f of [150, 155]) {
          const o = ctx.createOscillator();
          o.type = 'square';
          o.frequency.value = f;
          o.connect(lp);
          o.start(at);
          o.stop(at + 0.35);
        }
      }
    },
  },
];

// ─── Your own clips ───────────────────────────────────────────────────────────

export interface SoundClip {
  id: string;
  name: string;
  emoji: string;
  mime: string;
  /** Base64 of the file. */
  data: string;
}

export const MAX_CLIPS = 12;
const MAX_CLIP_SECONDS = 8;

export const useMySounds = create<{ clips: SoundClip[] }>()(persist(() => ({ clips: [] as SoundClip[] }), { name: 'infimeety.sounds' }));

function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(data: string) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Adds a short audio file to your sounds (checked for type, size and length). */
export async function addClip(file: File) {
  if (useMySounds.getState().clips.length >= MAX_CLIPS) return toast({ kind: 'info', title: `You can keep ${MAX_CLIPS} sounds`, body: 'Remove one to add another.' });
  if (!file.type.startsWith('audio/')) return toast({ kind: 'error', title: 'That isn’t an audio file', body: 'Pick an MP3, WAV, OGG or M4A.' });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const data = toBase64(bytes);
  if (data.length > SOUND_CLIP_MAX) return toast({ kind: 'error', title: 'That clip is too big', body: 'Keep it under about 180 KB: a few seconds of MP3.' });
  try {
    const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes.slice().buffer);
    if (decoded.duration > MAX_CLIP_SECONDS + 0.5) return toast({ kind: 'error', title: `Keep it under ${MAX_CLIP_SECONDS} seconds` });
  } catch {
    return toast({ kind: 'error', title: 'Couldn’t play that file', body: 'Try an MP3 or WAV.' });
  }
  const name = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 24) || 'Sound';
  useMySounds.setState((s) => ({ clips: [...s.clips, { id: crypto.randomUUID(), name, emoji: '🔊', mime: file.type, data }] }));
  toast({ kind: 'success', title: `“${name}” added to your sounds` });
}

export const removeClip = (id: string) => useMySounds.setState((s) => ({ clips: s.clips.filter((c) => c.id !== id) }));

// ─── Playing ──────────────────────────────────────────────────────────────────

/** Recent sounds, for the little bubbles that rise above the call's controls. */
export const useSoundBursts = create<{ bursts: { id: number; emoji: string; who: string }[] }>()(() => ({ bursts: [] }));
let burstId = 0;
function burst(emoji: string, who: string) {
  const id = ++burstId;
  useSoundBursts.setState((s) => ({ bursts: [...s.bursts.slice(-4), { id, emoji, who }] }));
  setTimeout(() => useSoundBursts.setState((s) => ({ bursts: s.bursts.filter((b) => b.id !== id) })), 1800);
}

const decoded = new Map<string, Promise<AudioBuffer>>();
const clipKey = (data: string) => `${data.length}:${data.slice(0, 40)}:${data.slice(-40)}`;

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

function render(sound: SoundRef, userId: string, mine: boolean) {
  const s = useSettings.getState();
  const label = sound.kind === 'builtin' ? BUILTIN_SOUNDS.find((b) => b.id === sound.id) : sound;
  if (!label) return;
  const who = mine ? 'You' : (useChannels.getState().users[userId]?.name ?? 'Someone');
  burst(label.emoji, who);
  if (!s.soundboard || (!mine && s.localMutes[userId])) return;
  const output = voice.soundOutput();
  if (!output) return;
  const { ctx, out } = output;
  const gain = ctx.createGain();
  gain.gain.value = s.soundboardVolume * (mine ? 1 : (s.userVolumes[userId] ?? 1));
  gain.connect(out);
  setTimeout(() => gain.disconnect(), (MAX_CLIP_SECONDS + 3) * 1000);
  const t = ctx.currentTime + 0.02;
  if (sound.kind === 'builtin') return BUILTIN_SOUNDS.find((b) => b.id === sound.id)?.play(ctx, gain, t);
  const key = clipKey(sound.data);
  if (!decoded.has(key)) decoded.set(key, ctx.decodeAudioData(fromBase64(sound.data).buffer));
  decoded
    .get(key)!
    .then((buffer) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(gain);
      src.start(Math.max(t, ctx.currentTime));
    })
    .catch(() => decoded.delete(key));
}

/** Plays a sound for everyone in your voice room (and you). */
export function playSound(sound: SoundRef) {
  const vs = useVoice.getState();
  if (!vs.channelId || !vs.roomId) return;
  if (vs.serverMuted) return toast({ kind: 'info', title: 'You’re muted by an admin', body: 'Your sounds don’t play while you’re muted.' });
  if (!takeToken()) return toast({ kind: 'info', title: 'Easy there', body: 'A few sounds at a time, then one every couple of seconds.' });
  getHub(vs.channelId)?.send({ t: 'sound.play', sound });
  render(sound, useAuth.getState().me?.id ?? '', true);
}

/** Someone else in your voice room played a sound. */
export function onSound(msg: { userId: string; sound: SoundRef }) {
  if (!useVoice.getState().roomId) return;
  render(msg.sound, msg.userId, false);
}
