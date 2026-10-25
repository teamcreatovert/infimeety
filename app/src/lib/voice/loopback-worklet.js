// Audio worklet: plays 48 kHz interleaved stereo f32 chunks posted from the main thread
// (native system-sound capture) as a continuous stereo signal.
// A small jitter buffer absorbs IPC timing; latency is capped so it never drifts behind video.

const CAPACITY = 48000; // frames (1 s)
const PREBUFFER = 2880; // 60 ms before (re)starting playback
const MAX_LAG = 9600; // 200 ms: beyond this, skip ahead to PREBUFFER

class LoopbackPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(CAPACITY * 2);
    this.read = 0;
    this.write = 0;
    this.count = 0;
    this.playing = false;
    this.port.onmessage = (e) => this.push(new Float32Array(e.data));
  }

  push(data) {
    const frames = data.length >> 1;
    for (let i = 0; i < frames; i++) {
      this.buf[this.write * 2] = data[i * 2];
      this.buf[this.write * 2 + 1] = data[i * 2 + 1];
      this.write = (this.write + 1) % CAPACITY;
      if (this.count < CAPACITY) this.count++;
      else this.read = (this.read + 1) % CAPACITY;
    }
    if (this.count > MAX_LAG) {
      const skip = this.count - PREBUFFER;
      this.read = (this.read + skip) % CAPACITY;
      this.count -= skip;
    }
  }

  process(_inputs, outputs) {
    const left = outputs[0][0];
    const right = outputs[0][1] ?? left;
    if (!this.playing && this.count >= PREBUFFER) this.playing = true;
    for (let i = 0; i < left.length; i++) {
      if (this.playing && this.count > 0) {
        left[i] = this.buf[this.read * 2];
        right[i] = this.buf[this.read * 2 + 1];
        this.read = (this.read + 1) % CAPACITY;
        this.count--;
      } else {
        // Underrun (or nothing playing on the PC): output silence and rebuffer.
        left[i] = 0;
        right[i] = 0;
        this.playing = false;
      }
    }
    return true;
  }
}

registerProcessor('loopback-player', LoopbackPlayer);
