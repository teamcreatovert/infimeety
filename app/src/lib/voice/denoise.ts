import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWasm from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasm from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import rnnoiseWorklet from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';

/**
 * Strong noise suppression, like Discord's Krisp: RNNoise (the open-source model Jitsi and OBS
 * use) cleans your mic on your own device before it's sent. Fans, typing, traffic and barking
 * fade out; voices stay. RNNoise works at 48 kHz, so it has an audio context of its own.
 */

let ctx: AudioContext | null = null;
let model: Promise<ArrayBuffer> | null = null;

function context() {
  if (!ctx || ctx.state === 'closed') {
    ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    model = null;
  }
  return ctx;
}

function load(c: AudioContext) {
  model ??= (async () => {
    const [wasm] = await Promise.all([loadRnnoise({ url: rnnoiseWasm, simdUrl: rnnoiseSimdWasm }), c.audioWorklet.addModule(rnnoiseWorklet)]);
    // The worklet compiles the model where an error can't reach us, and would then pass on
    // silence. Compiling it here first fails the same way (same page rules) but where we see it.
    await WebAssembly.compile(wasm);
    return wasm;
  })();
  const pending = model;
  pending.catch(() => model === pending && (model = null));
  return pending;
}

export interface Denoised {
  stream: MediaStream;
  stop: () => void;
}

/**
 * Your mic, cleaned. Null when this device can't (no AudioWorklet, a browser that can't bring
 * the mic to 48 kHz, audio that won't start): use the mic as it is.
 */
export async function denoise(mic: MediaStream): Promise<Denoised | null> {
  if (typeof AudioWorkletNode === 'undefined' || !mic.getAudioTracks().length) return null;
  try {
    const c = context();
    const wasmBinary = await load(c);
    if (c.state !== 'running') await Promise.race([c.resume(), new Promise((r) => setTimeout(r, 1500))]);
    if (c.state !== 'running') return null;
    const source = c.createMediaStreamSource(mic);
    const node = new RnnoiseWorkletNode(c, { maxChannels: 1, wasmBinary });
    const out = c.createMediaStreamDestination();
    source.connect(node).connect(out);
    return {
      stream: out.stream,
      stop: () => {
        source.disconnect();
        node.disconnect();
        node.destroy();
      },
    };
  } catch (err) {
    console.warn('[voice] noise suppression unavailable', err);
    return null;
  }
}

/** Mobile browsers suspend audio (a phone call, the screen locking); a tap brings it back. */
export function resumeDenoise() {
  if (ctx?.state === 'suspended') void ctx.resume().catch(() => {});
}
