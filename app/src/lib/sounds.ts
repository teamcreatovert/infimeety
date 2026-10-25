import { useSettings } from '@/stores/settings';

/**
 * Synthesized UI sounds: soft sine/triangle tones with gentle envelopes,
 * so there are no audio assets to license or load.
 */

let ctx: AudioContext | null = null;
const audio = () => (ctx ??= new AudioContext({ latencyHint: 'interactive' }));

interface Tone {
  freq: number;
  at?: number;
  dur?: number;
  type?: OscillatorType;
  gain?: number;
  glide?: number;
}

function play(tones: Tone[]) {
  const { soundsEnabled, soundVolume } = useSettings.getState();
  if (!soundsEnabled || soundVolume <= 0) return;
  const ac = audio();
  if (ac.state === 'suspended') void ac.resume();
  const t0 = ac.currentTime + 0.01;
  const master = ac.createGain();
  master.gain.value = 0.22 * soundVolume;
  master.connect(ac.destination);

  for (const { freq, at = 0, dur = 0.16, type = 'sine', gain = 1, glide } of tones) {
    const osc = ac.createOscillator();
    const env = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0 + at);
    if (glide) osc.frequency.exponentialRampToValueAtTime(glide, t0 + at + dur);
    env.gain.setValueAtTime(0, t0 + at);
    env.gain.linearRampToValueAtTime(gain, t0 + at + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
    osc.connect(env).connect(master);
    osc.start(t0 + at);
    osc.stop(t0 + at + dur + 0.05);
  }
  setTimeout(() => master.disconnect(), 1500);
}

// Notes (Hz)
const C5 = 523.25, E5 = 659.25, G5 = 783.99, A5 = 880, B5 = 987.77, C6 = 1046.5, D6 = 1174.66, E6 = 1318.51, G4 = 392, E4 = 329.63;

export const sounds = {
  join: () => play([{ freq: E5, dur: 0.14 }, { freq: B5, at: 0.09, dur: 0.22, gain: 0.85 }]),
  leave: () => play([{ freq: B5, dur: 0.14, gain: 0.8 }, { freq: E5, at: 0.09, dur: 0.24, gain: 0.75 }]),
  peerJoin: () => play([{ freq: G5, dur: 0.1, gain: 0.55 }, { freq: D6, at: 0.07, dur: 0.18, gain: 0.5 }]),
  peerLeave: () => play([{ freq: D6, dur: 0.1, gain: 0.45 }, { freq: G5, at: 0.07, dur: 0.18, gain: 0.45 }]),
  mute: () => play([{ freq: A5, dur: 0.09, glide: E5, gain: 0.6 }]),
  unmute: () => play([{ freq: E5, dur: 0.09, glide: A5, gain: 0.6 }]),
  deafen: () => play([{ freq: E5, dur: 0.1, gain: 0.6 }, { freq: C5, at: 0.07, dur: 0.16, gain: 0.55 }]),
  undeafen: () => play([{ freq: C5, dur: 0.1, gain: 0.55 }, { freq: E5, at: 0.07, dur: 0.16, gain: 0.6 }]),
  message: () => play([{ freq: C6, dur: 0.08, type: 'triangle', gain: 0.35 }, { freq: E6, at: 0.06, dur: 0.14, gain: 0.3 }]),
  send: () => play([{ freq: G5, dur: 0.07, glide: C6, gain: 0.25 }]),
  shareStart: () => play([{ freq: C5, dur: 0.12, gain: 0.5 }, { freq: E5, at: 0.06, dur: 0.14, gain: 0.5 }, { freq: G5, at: 0.12, dur: 0.24, gain: 0.5 }]),
  shareStop: () => play([{ freq: G5, dur: 0.1, gain: 0.45 }, { freq: E5, at: 0.06, dur: 0.12, gain: 0.45 }, { freq: C5, at: 0.12, dur: 0.22, gain: 0.45 }]),
  error: () => play([{ freq: E4, dur: 0.14, type: 'triangle', gain: 0.5 }, { freq: G4 * 0.75, at: 0.1, dur: 0.2, type: 'triangle', gain: 0.45 }]),
  pop: () => play([{ freq: 880, dur: 0.06, glide: 1320, gain: 0.25 }]),
};
