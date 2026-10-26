import { create } from 'zustand';
import { api } from './api';
import { getHub } from './realtime';
import { voice } from './voice/engine';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { useSettings } from '@/stores/settings';
import { toast } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

/**
 * Live captions. Anyone in a voice room turns them on for the room; then each person's own app
 * listens to their own mic, cuts it into stretches of speech, has each one turned into text
 * (Workers AI Whisper, Bangla or English) and shares the line with the room. Nothing is stored;
 * the transcript lives in each app until you leave the call.
 */

export interface CaptionLine {
  id: string;
  roomId: string;
  userId: string;
  text: string;
  at: number;
}

export const useCaptions = create<{ lines: CaptionLine[] }>()(() => ({ lines: [] }));

let lineId = 0;
function addLine(roomId: string, userId: string, text: string, at = Date.now()) {
  const line = { id: String(++lineId), roomId, userId, text, at };
  useCaptions.setState((s) => ({ lines: [...s.lines.slice(-400), line] }));
}

/** Are captions on in the voice room you're in? */
export function useCaptionsOn() {
  const channelId = useVoice((s) => s.channelId);
  const roomId = useVoice((s) => s.roomId);
  return useChannels((s) => !!channelId && !!roomId && !!s.voice[channelId]?.captionRooms?.includes(roomId));
}

export function setCaptions(on: boolean) {
  const { channelId, roomId } = useVoice.getState();
  if (channelId && roomId) getHub(channelId)?.send({ t: 'captions.set', roomId, on });
}

// ─── Incoming ─────────────────────────────────────────────────────────────────

export function onCaption(msg: { roomId: string; userId: string; text: string; at: number }) {
  if (useVoice.getState().roomId === msg.roomId) addLine(msg.roomId, msg.userId, msg.text, msg.at);
}

export function onCaptionsChanged(msg: { roomId: string; on: boolean; by: string }) {
  if (useVoice.getState().roomId !== msg.roomId || msg.by === useAuth.getState().me?.id) return;
  const who = useChannels.getState().users[msg.by]?.name ?? 'Someone';
  toast({ kind: 'info', title: msg.on ? `${who} turned on live captions` : `${who} turned off live captions`, body: msg.on ? 'What everyone says shows as text. Nothing is recorded.' : undefined });
}

// ─── Your speech ──────────────────────────────────────────────────────────────

const TARGET_RATE = 16_000;
const LOUD = 0.012;
/** Speech is cut at a pause this long, or after MAX_SEGMENT seconds. */
const PAUSE = 0.8;
const MAX_SEGMENT = 12;
const MIN_SPEECH = 0.5;
const PRE_ROLL = 0.35;

/** Listens to one microphone and hands over each stretch of speech. */
class SpeechCapture {
  private ctx = new AudioContext();
  private source: MediaStreamAudioSourceNode;
  private proc: ScriptProcessorNode;
  private sink: GainNode;
  private pre: Float32Array[] = [];
  private segment: Float32Array[] = [];
  private speaking = false;
  private quiet = 0;
  private loud = 0;

  constructor(
    readonly stream: MediaStream,
    private onSpeech: (pcm: Float32Array, rate: number) => void,
  ) {
    this.source = this.ctx.createMediaStreamSource(stream);
    this.proc = this.ctx.createScriptProcessor(4096, 1, 1);
    // A processor only runs when connected to the output; this keeps it silent.
    this.sink = this.ctx.createGain();
    this.sink.gain.value = 0;
    this.source.connect(this.proc);
    this.proc.connect(this.sink);
    this.sink.connect(this.ctx.destination);
    this.proc.onaudioprocess = (e) => this.feed(new Float32Array(e.inputBuffer.getChannelData(0)));
    void this.ctx.resume().catch(() => {});
  }

  private seconds = (blocks: Float32Array[]) => blocks.reduce((n, b) => n + b.length, 0) / this.ctx.sampleRate;

  private feed(block: Float32Array) {
    let sum = 0;
    for (const x of block) sum += x * x;
    const rms = Math.sqrt(sum / block.length);
    const length = block.length / this.ctx.sampleRate;
    if (!this.speaking) {
      this.pre.push(block);
      while (this.seconds(this.pre) > PRE_ROLL) this.pre.shift();
      if (rms > LOUD) {
        this.speaking = true;
        this.segment = this.pre;
        this.pre = [];
        this.quiet = 0;
        this.loud = length;
      }
      return;
    }
    this.segment.push(block);
    if (rms > LOUD * 0.6) {
      this.quiet = 0;
      this.loud += length;
    } else this.quiet += length;
    if (this.quiet > PAUSE || this.seconds(this.segment) > MAX_SEGMENT) this.flush();
  }

  private flush() {
    const blocks = this.segment;
    const loud = this.loud;
    this.segment = [];
    this.speaking = false;
    this.loud = 0;
    if (loud < MIN_SPEECH) return;
    const pcm = new Float32Array(blocks.reduce((n, b) => n + b.length, 0));
    let at = 0;
    for (const b of blocks) {
      pcm.set(b, at);
      at += b.length;
    }
    this.onSpeech(pcm, this.ctx.sampleRate);
  }

  stop() {
    this.proc.onaudioprocess = null;
    this.source.disconnect();
    this.proc.disconnect();
    this.sink.disconnect();
    void this.ctx.close().catch(() => {});
  }
}

/** 16 kHz mono 16-bit WAV, base64: small, and what Whisper hears best. */
function toWavBase64(pcm: Float32Array, rate: number) {
  const ratio = rate / TARGET_RATE;
  const n = Math.floor(pcm.length / ratio);
  const buffer = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buffer);
  const text = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_RATE, true);
  view.setUint32(28, TARGET_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    // Average the input samples that fall in this output sample.
    const from = Math.floor(i * ratio);
    const to = Math.max(from + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = from; j < to && j < pcm.length; j++) sum += pcm[j];
    const v = Math.max(-1, Math.min(1, sum / (to - from)));
    view.setInt16(44 + i * 2, v * 0x7fff, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Whisper's usual inventions on near-silence. */
const NOISE = /^(?:thank you\.?|thanks for watching!?|thank you for watching\.?|you|bye\.?|\.+|\[.*\]|\(.*\))$/i;

let capture: SpeechCapture | null = null;
let pending = 0;
let failedNotice = 0;

async function transcribe(pcm: Float32Array, rate: number) {
  const { channelId, roomId } = useVoice.getState();
  if (!channelId || !roomId || pending >= 3) return;
  pending++;
  try {
    const lang = useSettings.getState().captionLanguage;
    const { text } = await api<{ text: string }>(`/channels/${channelId}/captions`, {
      method: 'POST',
      json: { audio: toWavBase64(pcm, rate), language: lang === 'auto' ? undefined : lang },
    });
    const clean = text.trim();
    if (!clean || clean.length < 2 || NOISE.test(clean)) return;
    if (useVoice.getState().roomId !== roomId) return;
    addLine(roomId, useAuth.getState().me?.id ?? '', clean);
    getHub(channelId)?.send({ t: 'caption.line', text: clean });
  } catch {
    if (Date.now() - failedNotice > 60_000) {
      failedNotice = Date.now();
      toast({ kind: 'error', title: 'Captions couldn’t keep up', body: 'Your last few words weren’t captioned. Check your connection.' });
    }
  } finally {
    pending--;
  }
}

/** Starts and stops listening as captions, your call and your mic change. Call once. */
export function startCaptions() {
  let lastRoom: string | null = null;
  const sync = () => {
    const v = useVoice.getState();
    // A new call starts a new transcript.
    if (v.roomId !== lastRoom) {
      lastRoom = v.roomId;
      useCaptions.setState({ lines: [] });
    }
    const on = !!v.channelId && !!v.roomId && !!useChannels.getState().voice[v.channelId]?.captionRooms?.includes(v.roomId);
    const mic = on && !v.muted && !v.serverMuted ? voice.micStream : null;
    if (capture && capture.stream !== mic) {
      capture.stop();
      capture = null;
    }
    if (mic && !capture) {
      try {
        capture = new SpeechCapture(mic, (pcm, rate) => void transcribe(pcm, rate));
      } catch (err) {
        console.warn('[captions] could not listen', err);
      }
    }
  };
  useVoice.subscribe(sync);
  useChannels.subscribe(sync);
}

/** The transcript as text: "[12:03] Bob: hello". */
export function transcriptText() {
  const users = useChannels.getState().users;
  const meId = useAuth.getState().me?.id;
  return useCaptions
    .getState()
    .lines.map((l) => {
      const time = new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const who = l.userId === meId ? (useAuth.getState().me?.name ?? 'You') : (users[l.userId]?.name ?? 'Someone');
      return `[${time}] ${who}: ${l.text}`;
    })
    .join('\n');
}
