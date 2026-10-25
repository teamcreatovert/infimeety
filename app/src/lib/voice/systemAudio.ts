import { Channel, invoke } from '@tauri-apps/api/core';
// `no-inline`: the production CSP only allows scripts from the app itself, not data: URLs.
import workletUrl from './loopback-worklet.js?url&no-inline';

export interface SystemAudioCapture {
  track: MediaStreamTrack;
  stop: () => void;
}

const loaded = new WeakSet<BaseAudioContext>();

/**
 * Desktop only: turns the native system-sound capture (every app except Infimeety)
 * into a stereo MediaStreamTrack for screen sharing. Nothing is played locally.
 */
export async function startSystemAudio(ctx: AudioContext): Promise<SystemAudioCapture> {
  if (!loaded.has(ctx)) {
    await ctx.audioWorklet.addModule(workletUrl);
    loaded.add(ctx);
  }
  const node = new AudioWorkletNode(ctx, 'loopback-player', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
  const dest = ctx.createMediaStreamDestination();
  dest.channelCount = 2;
  node.connect(dest);

  const channel = new Channel<ArrayBuffer | number[]>();
  channel.onmessage = (chunk) => {
    const buf = chunk instanceof ArrayBuffer ? chunk : new Uint8Array(chunk).buffer;
    node.port.postMessage(buf, [buf]);
  };
  try {
    await invoke('system_audio_start', { onData: channel });
  } catch (err) {
    node.disconnect();
    throw new Error(String(err));
  }

  const track = dest.stream.getAudioTracks()[0];
  track.contentHint = 'music';
  return {
    track,
    stop() {
      void invoke('system_audio_stop');
      channel.onmessage = () => {};
      node.port.close();
      node.disconnect();
      track.stop();
    },
  };
}
