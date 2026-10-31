export interface Signal {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

/** Mono Opus voice at 40 kbps is effectively transparent for speech. */
export const VOICE_BITRATE = 40_000;

const splitSdp = (sdp: string) => {
  const [head, ...media] = sdp.split(/\r\nm=/);
  return { head, media: media.map((s) => `m=${s}`) };
};
const midOf = (section: string) => /a=mid:(\S+)/.exec(section)?.[1];
const streamsOf = (section: string) => [...section.matchAll(/a=msid:(\S+)/g)].map((m) => m[1]);

function setFmtp(params: string, set: Record<string, string>, drop: string[]) {
  const map = new Map(
    params
      .split(';')
      .filter(Boolean)
      .map((p) => p.split('=') as [string, string]),
  );
  for (const k of drop) map.delete(k);
  for (const [k, v] of Object.entries(set)) map.set(k, v);
  return [...map].map(([k, v]) => `${k}=${v}`).join(';');
}

/**
 * Per-line Opus tuning. Screen-share sound gets stereo at 192 kbps so movies sound right;
 * voices stay mono at 40 kbps with DTX (near-silent while quiet), which keeps big calls light.
 * A line counts as screen audio if its msid — in our SDP or the remote's, matched by mid —
 * is a screen stream. Receivers' fmtp is what tells senders to encode stereo.
 */
export function tuneSdp(sdp: string, remoteSdp: string | undefined, isStereoStream: (streamId: string) => boolean) {
  const remoteStreams = new Map<string, string[]>();
  for (const section of remoteSdp ? splitSdp(remoteSdp).media : []) {
    const mid = midOf(section);
    if (mid) remoteStreams.set(mid, streamsOf(section));
  }

  const { head, media } = splitSdp(sdp);
  const tuned = media.map((section) => {
    if (section.startsWith('m=video')) return tuneScreenVideo(section, remoteStreams, isStereoStream);
    if (!section.startsWith('m=audio')) return section;
    const mid = midOf(section);
    const streams = [...streamsOf(section), ...((mid && remoteStreams.get(mid)) || [])];
    const stereo = streams.some(isStereoStream);
    let out = section;
    for (const [, pt] of section.matchAll(/a=rtpmap:(\d+) opus\/48000\/2/gi)) {
      out = out.replace(new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`), (_line, params: string) =>
        `a=fmtp:${pt} ${
          stereo
            ? setFmtp(params, { stereo: '1', 'sprop-stereo': '1', maxaveragebitrate: '192000' }, ['usedtx'])
            : setFmtp(params, { usedtx: '1', maxaveragebitrate: String(VOICE_BITRATE) }, ['stereo', 'sprop-stereo'])
        }`,
      );
    }
    return out;
  });
  return [head, ...tuned].join('\r\n');
}

/** Screen shares start sharp: kbps the encoder starts at, and never drops below. */
const SCREEN_START_KBPS = 2500;
const SCREEN_MIN_KBPS = 600;

/**
 * WebRTC starts every video at a few hundred kbps and ramps up over many seconds, which is
 * why shares used to begin blurry. For the screen share's video only, both ends ask Chrome's
 * encoder to start high (x-google-start-bitrate) and keep a floor. The camera is left alone.
 */
function tuneScreenVideo(section: string, remoteStreams: Map<string, string[]>, isScreenStream: (streamId: string) => boolean) {
  const mid = midOf(section);
  const streams = [...streamsOf(section), ...((mid && remoteStreams.get(mid)) || [])];
  if (!streams.some(isScreenStream)) return section;
  const set = { 'x-google-start-bitrate': String(SCREEN_START_KBPS), 'x-google-min-bitrate': String(SCREEN_MIN_KBPS) };
  let out = section;
  for (const [line, pt] of section.matchAll(/a=rtpmap:(\d+) (?:VP8|VP9|H264|AV1)\/90000/gi)) {
    const fmtp = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
    out = fmtp.test(out) ? out.replace(fmtp, (_l, params: string) => `a=fmtp:${pt} ${setFmtp(params, set, [])}`) : out.replace(line, `${line}\r\na=fmtp:${pt} ${setFmtp('', set, [])}`);
  }
  return out;
}

/**
 * RTCPeerConnection wrapper implementing the "perfect negotiation" pattern, so either
 * side can add/remove tracks (mic, camera, screen) at any time without glare.
 */
export class Peer {
  readonly pc: RTCPeerConnection;
  private makingOffer = false;
  private ignoreOffer = false;
  private settingRemoteAnswer = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private closed = false;

  constructor(
    readonly id: string,
    private polite: boolean,
    iceServers: RTCIceServer[],
    private signal: (s: Signal) => void,
    private onStable?: () => void,
    private isStereoStream: (streamId: string) => boolean = () => false,
  ) {
    this.pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' });
    this.pc.onnegotiationneeded = () => void this.negotiate();
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.signal({ candidate: candidate.toJSON() });
    };
    this.pc.onsignalingstatechange = () => {
      if (this.pc.signalingState === 'stable') this.onStable?.();
    };
    // A path that drops gets a fresh start: at once when it fails, after 4 s if it stays
    // disconnected (Chrome takes ~30 s to call that failed), so nobody stays silent to one person.
    let stuck: ReturnType<typeof setTimeout> | undefined;
    this.pc.oniceconnectionstatechange = () => {
      clearTimeout(stuck);
      const state = this.pc.iceConnectionState;
      if (state === 'failed') this.pc.restartIce();
      else if (state === 'disconnected') stuck = setTimeout(() => !this.closed && this.pc.iceConnectionState === 'disconnected' && this.pc.restartIce(), 4000);
    };
  }

  private async negotiate() {
    try {
      this.makingOffer = true;
      const offer = await this.pc.createOffer();
      if (this.pc.signalingState !== 'stable' || this.closed) return;
      await this.pc.setLocalDescription({ type: 'offer', sdp: tuneSdp(offer.sdp ?? '', this.pc.remoteDescription?.sdp, this.isStereoStream) });
      this.signal({ description: this.pc.localDescription!.toJSON() });
    } catch (err) {
      console.warn('[rtc] negotiation failed', err);
    } finally {
      this.makingOffer = false;
    }
  }

  async handle({ description, candidate }: Signal) {
    if (this.closed) return;
    try {
      if (description) {
        const readyForOffer = !this.makingOffer && (this.pc.signalingState === 'stable' || this.settingRemoteAnswer);
        const collision = description.type === 'offer' && !readyForOffer;
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return;

        this.settingRemoteAnswer = description.type === 'answer';
        await this.pc.setRemoteDescription(description); // polite side rolls back implicitly
        this.settingRemoteAnswer = false;

        if (description.type === 'offer') {
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription({ type: 'answer', sdp: tuneSdp(answer.sdp ?? '', this.pc.remoteDescription?.sdp, this.isStereoStream) });
          this.signal({ description: this.pc.localDescription!.toJSON() });
        }
        for (const c of this.pendingCandidates.splice(0)) await this.pc.addIceCandidate(c).catch(() => {});
      } else if (candidate) {
        if (!this.pc.remoteDescription) {
          this.pendingCandidates.push(candidate);
          return;
        }
        try {
          await this.pc.addIceCandidate(candidate);
        } catch (err) {
          if (!this.ignoreOffer) console.warn('[rtc] bad candidate', err);
        }
      }
    } catch (err) {
      console.warn('[rtc] signal failed', err);
    }
  }

  close() {
    this.closed = true;
    this.pc.close();
  }
}
