import { create } from 'zustand';
import { getHub } from './realtime';
import { startReceive } from './saveFolder';
import { voice } from './voice/engine';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { toast } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

/**
 * Recording a call, on your own device: the call as you hear it plus your own mic, as Opus
 * audio (about 43 MB an hour). Everyone in the room is told and sees who's recording. Leaving
 * the call stops it; the file goes into your save folder (or downloads in a browser).
 */

export const useRecording = create<{ recording: boolean; startedAt: number }>()(() => ({ recording: false, startedAt: 0 }));

let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let tap: { stop: () => void } | null = null;
let room: { channelId: string; roomId: string } | null = null;

/** Who's recording the voice room you're in. */
export function useRoomRecorders() {
  const channelId = useVoice((s) => s.channelId);
  const roomId = useVoice((s) => s.roomId);
  return useChannels((s) => (channelId && roomId ? s.voice[channelId]?.recording?.[roomId] : undefined));
}

export function startRecording() {
  if (recorder) return;
  const { channelId, roomId } = useVoice.getState();
  if (!channelId || !roomId) return;
  const out = voice.recordingStream();
  if (!out || typeof MediaRecorder === 'undefined') return toast({ kind: 'error', title: 'Recording isn’t available here' });
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
  try {
    recorder = new MediaRecorder(out.stream, mimeType ? { mimeType, audioBitsPerSecond: 96_000 } : undefined);
  } catch {
    out.stop();
    return toast({ kind: 'error', title: 'Couldn’t start recording' });
  }
  chunks = [];
  tap = out;
  room = { channelId, roomId };
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => void save();
  recorder.start(1000);
  useRecording.setState({ recording: true, startedAt: Date.now() });
  getHub(channelId)?.send({ t: 'recording.set', roomId, on: true });
  toast({ kind: 'info', title: 'Recording', body: 'Everyone in the call can see you’re recording. It saves when you stop or leave.' });
}

export function stopRecording() {
  if (!recorder) return;
  const r = recorder;
  recorder = null;
  if (r.state !== 'inactive') r.stop();
  tap?.stop();
  tap = null;
  if (room) getHub(room.channelId)?.send({ t: 'recording.set', roomId: room.roomId, on: false });
  room = null;
  useRecording.setState({ recording: false });
}

async function save() {
  const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
  chunks = [];
  if (!blob.size) return;
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
  const name = `Infimeety call ${stamp}.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`;
  try {
    const target = await startReceive({ name, mime: blob.type, size: blob.size }, { folder: false, handOver: true });
    if (!target) return download(blob, name);
    const piece = 4 * 1024 * 1024;
    for (let offset = 0; offset < blob.size; offset += piece) await target.write(offset, new Uint8Array(await blob.slice(offset, offset + piece).arrayBuffer()));
    await target.close(true);
    toast({ kind: 'success', title: 'Recording saved', body: target.where });
  } catch (err) {
    console.warn('[recording] save failed', err);
    download(blob, name);
  }
}

/** The fallback: hand the file to the browser's downloads. */
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  toast({ kind: 'success', title: 'Recording downloaded', body: name });
}

/** Leaving (or switching) calls ends your recording. Call once. */
export function startRecordingWatch() {
  useVoice.subscribe((s, prev) => {
    if (recorder && room && (s.roomId !== room.roomId || s.channelId !== room.channelId)) stopRecording();
    void prev;
  });
}

/** Someone else started or stopped recording your room. */
export function onRecordingChanged(msg: { roomId: string; userId: string; on: boolean }) {
  if (useVoice.getState().roomId !== msg.roomId || msg.userId === useAuth.getState().me?.id) return;
  const who = useChannels.getState().users[msg.userId]?.name ?? 'Someone';
  toast({ kind: 'info', title: msg.on ? `${who} is recording this call` : `${who} stopped recording` });
}
