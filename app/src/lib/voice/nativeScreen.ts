import { invoke } from '@tauri-apps/api/core';
import { isTauri, isWindows } from '../platform';

/**
 * The Windows app's own screen sharing (src-tauri/src/screen_share.rs): Infimeety captures the
 * screen or window itself, so WebView2's picker and its "sharing your screen" bar never appear.
 * Frames arrive in memory shared with this page; each one becomes a VideoFrame on a normal
 * video track, which the call sends like any other.
 */

export interface ScreenSource {
  id: string;
  kind: 'screen' | 'window';
  name: string;
  /** The app's name for a window; the size for a screen. */
  app: string;
  /** A small picture of it (data URL). */
  thumb: string;
}

// Chromium's "breakout box": a video track fed frame by frame (not in TypeScript's DOM types yet).
declare global {
  class MediaStreamTrackGenerator extends MediaStreamTrack {
    constructor(init: { kind: 'video' | 'audio' });
    readonly writable: WritableStream<VideoFrame>;
  }
}

interface WebviewBridge {
  addEventListener(type: string, listener: (e: never) => void): void;
  removeEventListener(type: string, listener: (e: never) => void): void;
  releaseBuffer(buffer: ArrayBuffer): void;
}

const bridge = () => (window as unknown as { chrome?: { webview?: WebviewBridge } }).chrome?.webview;

export const canShareNatively = isTauri && isWindows && typeof MediaStreamTrackGenerator !== 'undefined' && !!bridge();

export const screenSources = () => invoke<ScreenSource[]>('screen_sources');

interface FrameMessage {
  infimeety?: string;
  t?: 'frame' | 'ended';
  slot: number;
  w: number;
  h: number;
  seq: number;
  time: number;
}

/** Starts capturing `id`; `onEnded` runs if what's shared goes away (a window closes). */
export async function startNativeScreen(id: string, fps: number, onEnded: () => void) {
  const webview = bridge();
  if (!webview) throw new Error('Screen sharing needs the Windows app.');
  const generator = new MediaStreamTrackGenerator({ kind: 'video' });
  const writer = generator.writable.getWriter();
  let buffer: ArrayBuffer | null = null;
  let slotSize = 0;
  let latest = 0;
  let stopped = false;
  // Windows only sends a frame when something on screen changes. On a still screen the last
  // picture is sent again a few times a second, so someone who starts watching sees it at once.
  let last: VideoFrame | null = null;
  let lastAt = 0;
  const send = (frame: VideoFrame) => {
    last?.close();
    last = frame.clone();
    lastAt = performance.now();
    writer.write(frame).catch(() => frame.close());
  };
  const repeat = setInterval(() => {
    if (!last || stopped || performance.now() - lastAt < 240) return;
    if (writer.desiredSize !== null && writer.desiredSize <= 0) return;
    send(new VideoFrame(last, { timestamp: Math.round(performance.now() * 1000) }));
  }, 250);

  const onBuffer = (e: { additionalData?: { infimeety?: string; slot?: number }; getBuffer(): ArrayBuffer }) => {
    if (e.additionalData?.infimeety !== 'screen') return;
    if (buffer) webview.releaseBuffer(buffer);
    buffer = e.getBuffer();
    slotSize = e.additionalData.slot ?? 0;
  };
  const onMessage = (e: { data?: FrameMessage }) => {
    const m = e.data;
    if (m?.infimeety !== 'screen' || stopped) return;
    if (m.t === 'ended') return stop(true);
    // Only the newest frame: an older slot may already hold a newer picture.
    if (!buffer || m.seq <= latest || m.w * m.h * 4 > slotSize) return;
    latest = m.seq;
    // The encoder is behind: skip a frame rather than pile them up.
    if (writer.desiredSize !== null && writer.desiredSize <= 0) return;
    send(
      new VideoFrame(new Uint8Array(buffer, m.slot * slotSize, m.w * m.h * 4), {
        format: 'BGRX',
        codedWidth: m.w,
        codedHeight: m.h,
        timestamp: Math.round(performance.now() * 1000),
      }),
    );
  };

  function stop(ended = false) {
    if (stopped) return;
    stopped = true;
    clearInterval(repeat);
    last?.close();
    last = null;
    void invoke('screen_share_stop');
    webview!.removeEventListener('sharedbufferreceived', onBuffer as never);
    webview!.removeEventListener('message', onMessage as never);
    if (buffer) webview!.releaseBuffer(buffer);
    buffer = null;
    void writer.close().catch(() => {});
    generator.stop();
    if (ended) onEnded();
  }

  webview.addEventListener('sharedbufferreceived', onBuffer as never);
  webview.addEventListener('message', onMessage as never);
  try {
    await invoke<{ width: number; height: number }>('screen_share_start', { id, fps });
  } catch (err) {
    stop();
    throw new Error(String(err));
  }
  return { track: generator as MediaStreamTrack, stop: () => stop() };
}
