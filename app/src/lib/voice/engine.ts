import type { RtcPayload, VoiceLocalState, VoiceParticipant, VoiceSnapshot } from '../../../../shared/protocol';
import { api } from '@/lib/api';
import type { HubClient } from '@/lib/hub';
import { isTauri } from '@/lib/platform';
import { getHub } from '@/lib/realtime';
import { sounds } from '@/lib/sounds';
import { SCREEN_PRESETS, useSettings } from '@/stores/settings';
import { toast, useUI } from '@/stores/ui';
import { useVoice } from '@/stores/voice';
import { Peer, VOICE_BITRATE, type Signal } from './peer';
import { startSystemAudio, type SystemAudioCapture } from './systemAudio';

const DEFAULT_ICE: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
let ice: { servers: RTCIceServer[]; at: number } | null = null;

/** Cached ICE servers (STUN, plus Cloudflare TURN when the backend has it configured). */
export function iceNow() {
  if (!ice || Date.now() - ice.at > 6 * 3600_000) void refreshIce();
  return ice?.servers ?? DEFAULT_ICE;
}

export async function refreshIce() {
  try {
    const { iceServers } = await api<{ iceServers: RTCIceServer[] }>('/ice');
    ice = { servers: iceServers, at: Date.now() };
  } catch {
    /* keep defaults */
  }
  return ice?.servers ?? DEFAULT_ICE;
}

interface AudioChain {
  peerId: string;
  userId: string;
  kind: 'mic' | 'screen';
  stream: MediaStream;
  trackId: string;
  el: HTMLAudioElement;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  analyser: AnalyserNode;
  data: Float32Array<ArrayBuffer>;
}

function rms(analyser: AnalyserNode, data: Float32Array<ArrayBuffer>) {
  analyser.getFloatTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / data.length);
}

/**
 * Mesh voice engine: one RTCPeerConnection per other participant in the room.
 * Remote audio is routed through Web Audio so each person gets their own volume
 * (0–200%), local mute and speaking detection.
 */
class VoiceEngine {
  private hub: HubClient | null = null;
  private peers = new Map<string, Peer>();
  private participants = new Map<string, VoiceParticipant>();
  private remoteStreams = new Map<string, Map<string, MediaStream>>();
  private chains = new Map<string, AudioChain>();

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private mic: MediaStream | null = null;
  private micMeter: { source: MediaStreamAudioSourceNode; analyser: AnalyserNode; data: Float32Array<ArrayBuffer> } | null = null;
  private cam: MediaStream | null = null;
  private screen: MediaStream | null = null;
  private systemAudio: SystemAudioCapture | null = null;

  // Stable container streams: their ids are announced once, tracks come and go.
  private micOut = new MediaStream();
  private camOut = new MediaStream();
  private screenOut = new MediaStream();

  private meter: ReturnType<typeof setInterval> | undefined;
  private lastLoud: Record<string, number> = {};
  private unsubSettings: (() => void) | null = null;
  private myJoinedAt = 0;

  get inCall() {
    return !!useVoice.getState().roomId;
  }

  // ─── Session ─────────────────────────────────────────────────────────────────

  async join(channelId: string, roomId: string) {
    const current = useVoice.getState();
    if (current.roomId === roomId) return;
    if (current.roomId) this.leave({ silent: true });

    const hub = getHub(channelId);
    if (!hub) return toast({ kind: 'error', title: 'Not connected yet', body: 'Give it a second and try again.' });
    this.hub = hub;
    this.micOut = new MediaStream();
    this.camOut = new MediaStream();
    this.screenOut = new MediaStream();
    useVoice.setState({ channelId, roomId, status: 'connecting', speaking: {}, remote: {}, connection: {}, serverMuted: false });

    this.ensureAudio();
    await Promise.all([this.openMic(), refreshIce()]);
    if (useVoice.getState().roomId !== roomId) return; // left while we were waiting on permissions

    this.myJoinedAt = Date.now();
    hub.send({ t: 'voice.join', roomId, state: this.localState() });
    useVoice.setState({ status: 'connected' });
    sounds.join();
    this.startMeter();

    this.unsubSettings = useSettings.subscribe((s, prev) => {
      if (s.userVolumes !== prev.userVolumes || s.localMutes !== prev.localMutes || s.streamVolumes !== prev.streamVolumes) this.applyGains();
      if (s.outputDeviceId !== prev.outputDeviceId) this.applyOutput();
      if (
        s.inputDeviceId !== prev.inputDeviceId ||
        s.echoCancellation !== prev.echoCancellation ||
        s.noiseSuppression !== prev.noiseSuppression ||
        s.autoGainControl !== prev.autoGainControl
      ) void this.restartMic();
    });
  }

  leave({ silent = false, kicked = false } = {}) {
    if (!this.inCall) return;
    this.hub?.send({ t: 'voice.leave' });
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.participants.clear();
    this.stopTracks(this.mic);
    this.stopTracks(this.cam);
    this.stopTracks(this.screen);
    this.mic = this.cam = this.screen = null;
    this.systemAudio?.stop();
    this.systemAudio = null;
    this.micMeter?.source.disconnect();
    this.micMeter = null;
    clearInterval(this.meter);
    this.unsubSettings?.();
    this.unsubSettings = null;
    this.hub = null;

    useVoice.setState({
      channelId: null,
      roomId: null,
      status: 'idle',
      serverMuted: false,
      camera: false,
      screen: false,
      speaking: {},
      remote: {},
      connection: {},
      localCam: null,
      localScreen: null,
    });
    useUI.getState().set({ focusedPeer: null, immersive: false });
    if (!silent) sounds.leave();
    if (kicked) toast({ kind: 'info', title: 'An admin disconnected you from voice' });
  }

  /** The hub reconnected (new peer id): rebuild every connection from scratch. */
  onWelcome(hub: HubClient) {
    const vs = useVoice.getState();
    if (!vs.roomId || vs.channelId !== hub.channelId) return;
    this.hub = hub;
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.participants.clear();
    hub.send({ t: 'voice.join', roomId: vs.roomId, state: this.localState() });
  }

  onSnapshot(channelId: string, snap: VoiceSnapshot) {
    const vs = useVoice.getState();
    const myPeer = this.hub?.peerId;
    if (!vs.roomId || channelId !== vs.channelId || !myPeer) return;

    const me = snap.participants.find((p) => p.peerId === myPeer);
    if (me && me.serverMuted !== vs.serverMuted) {
      useVoice.setState({ serverMuted: me.serverMuted });
      this.applyMicEnabled();
      if (me.serverMuted) {
        sounds.mute();
        toast({ kind: 'info', title: 'An admin muted you' });
      } else {
        sounds.unmute();
        toast({ kind: 'info', title: 'You can talk again' });
      }
    }

    const others = snap.participants.filter((p) => p.roomId === vs.roomId && p.peerId !== myPeer);
    const present = new Set(others.map((p) => p.peerId));
    for (const p of others) {
      const isNew = !this.participants.has(p.peerId);
      this.participants.set(p.peerId, p);
      if (!this.peers.has(p.peerId)) this.createPeer(p.peerId);
      if (isNew && p.joinedAt > this.myJoinedAt) sounds.peerJoin();
      this.reconcile(p.peerId);
    }
    for (const id of [...this.participants.keys()]) {
      if (present.has(id)) continue;
      this.participants.delete(id);
      this.closePeer(id);
      sounds.peerLeave();
    }
    this.applyGains();
  }

  onSignal(channelId: string, from: string, data: Extract<RtcPayload, { kind: 'voice' }>) {
    const vs = useVoice.getState();
    if (!vs.roomId || channelId !== vs.channelId) return;
    if (!this.peers.has(from)) {
      // An offer can beat the snapshot that announces its sender.
      if (data.description?.type !== 'offer') return;
      this.createPeer(from);
    }
    void this.peers.get(from)!.handle(data as Signal);
  }

  // ─── Controls ────────────────────────────────────────────────────────────────

  async toggleMute() {
    const s = useVoice.getState();
    if (s.serverMuted) {
      sounds.error();
      return toast({ kind: 'info', title: 'An admin muted you', body: 'You can talk once they unmute you.' });
    }
    if (s.deafened) useVoice.setState({ deafened: false, muted: false });
    else useVoice.setState({ muted: !s.muted });
    if (!useVoice.getState().muted && !this.mic && this.inCall) await this.restartMic();
    useVoice.getState().muted ? sounds.mute() : sounds.unmute();
    this.applyMicEnabled();
    this.applyGains();
    this.pushState();
  }

  toggleDeafen() {
    const deafened = !useVoice.getState().deafened;
    useVoice.setState({ deafened });
    deafened ? sounds.deafen() : sounds.undeafen();
    this.applyMicEnabled();
    this.applyGains();
    this.pushState();
  }

  async toggleCamera() {
    if (!this.inCall) return;
    if (this.cam) return this.stopCamera();
    const { cameraDeviceId } = useSettings.getState();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: cameraDeviceId !== 'default' ? { ideal: cameraDeviceId } : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      });
      const track = stream.getVideoTracks()[0];
      track.contentHint = 'motion';
      track.onended = () => this.stopCamera();
      this.cam = stream;
      for (const peer of this.peers.values()) peer.pc.addTrack(track, this.camOut);
      useVoice.setState({ camera: true, localCam: stream });
      this.pushState();
    } catch {
      toast({ kind: 'error', title: 'Camera unavailable', body: 'Check that no other app is using it.' });
    }
  }

  stopCamera() {
    if (!this.cam) return;
    this.removeSenders(this.cam);
    this.stopTracks(this.cam);
    this.cam = null;
    useVoice.setState({ camera: false, localCam: null });
    this.pushState();
  }

  async startScreen() {
    if (!this.inCall || this.screen) return;
    const s = useSettings.getState();
    const preset = SCREEN_PRESETS[s.screenQuality];
    // The desktop webview's picker has no system audio, so sound is captured natively instead.
    const nativeAudio = isTauri && s.shareAudio;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: preset.width }, height: { ideal: preset.height }, frameRate: { ideal: preset.fps, max: preset.fps } },
        audio:
          s.shareAudio && !nativeAudio
            ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, sampleRate: 48000 }
            : false,
        // Chromium hints: offer system audio, allow switching surfaces mid-share.
        systemAudio: 'include',
        surfaceSwitching: 'include',
        selfBrowserSurface: 'exclude',
        monitorTypeSurfaces: 'include',
      } as DisplayMediaStreamOptions);
    } catch (err) {
      if ((err as DOMException).name !== 'NotAllowedError') {
        toast({ kind: 'error', title: "Couldn't start screen share", body: String((err as Error).message ?? err) });
      }
      return;
    }
    const video = stream.getVideoTracks()[0];
    video.contentHint = s.screenMode === 'motion' ? 'motion' : 'detail';
    video.onended = () => this.stopScreen();
    if (nativeAudio && this.ctx) {
      try {
        this.systemAudio = await startSystemAudio(this.ctx);
        stream.addTrack(this.systemAudio.track);
      } catch (err) {
        toast({ kind: 'info', title: 'Sharing without sound', body: err instanceof Error ? err.message : String(err) });
      }
    }
    this.screen = stream;
    for (const peer of this.peers.values()) for (const t of stream.getTracks()) peer.pc.addTrack(t, this.screenOut);
    useVoice.setState({ screen: true, localScreen: stream });
    this.pushState();
    sounds.shareStart();
  }

  stopScreen() {
    if (!this.screen) return;
    this.removeSenders(this.screen);
    this.stopTracks(this.screen);
    this.screen = null;
    this.systemAudio?.stop();
    this.systemAudio = null;
    useVoice.setState({ screen: false, localScreen: null });
    if (useUI.getState().focusedPeer === this.hub?.peerId) useUI.getState().set({ focusedPeer: null, immersive: false });
    this.pushState();
    sounds.shareStop();
  }

  /** This client's peer id in the voice channel, used to find "me" in snapshots. */
  get peerId() {
    return this.hub?.peerId ?? null;
  }

  async restartMic() {
    if (!this.inCall) return;
    const old = this.mic;
    await this.openMic();
    const track = this.mic?.getAudioTracks()[0] ?? null;
    for (const peer of this.peers.values()) {
      const sender = peer.pc.getSenders().find((s) => s.track?.kind === 'audio' && old?.getTracks().includes(s.track));
      if (sender) await sender.replaceTrack(track).catch(() => {});
      else if (track) peer.pc.addTrack(track, this.micOut);
    }
    if (old !== this.mic) this.stopTracks(old);
    this.pushState();
  }

  // ─── Internals ───────────────────────────────────────────────────────────────

  private localState(): VoiceLocalState {
    const vs = useVoice.getState();
    return {
      muted: vs.muted || !this.mic,
      deafened: vs.deafened,
      camera: !!this.cam,
      screen: !!this.screen,
      streams: { mic: this.micOut.id, cam: this.camOut.id, screen: this.screenOut.id },
    };
  }

  private pushState() {
    if (this.inCall) this.hub?.send({ t: 'voice.update', state: this.localState() });
  }

  private ensureAudio() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.applyOutput();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private applyOutput() {
    const id = useSettings.getState().outputDeviceId;
    const ctx = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    ctx?.setSinkId?.(id === 'default' ? '' : id).catch(() => {});
  }

  private async openMic() {
    const s = useSettings.getState();
    const base: MediaTrackConstraints = {
      echoCancellation: s.echoCancellation,
      noiseSuppression: s.noiseSuppression,
      autoGainControl: s.autoGainControl,
      channelCount: 1,
    };
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { ...base, deviceId: s.inputDeviceId !== 'default' ? { exact: s.inputDeviceId } : undefined },
      });
    } catch {
      try {
        this.mic = await navigator.mediaDevices.getUserMedia({ audio: base });
      } catch {
        this.mic = null;
        useVoice.setState({ micAvailable: false, muted: true });
        toast({ kind: 'error', title: 'Microphone unavailable', body: 'You joined muted. Check Settings → Voice & Video.' });
        return;
      }
    }
    useVoice.setState({ micAvailable: true });
    this.micMeter?.source.disconnect();
    if (this.ctx) {
      const source = this.ctx.createMediaStreamSource(this.mic);
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      this.micMeter = { source, analyser, data: new Float32Array(analyser.fftSize) };
    }
    this.applyMicEnabled();
  }

  private applyMicEnabled() {
    const { muted, deafened, serverMuted } = useVoice.getState();
    const on = !muted && !deafened && !serverMuted;
    this.mic?.getAudioTracks().forEach((t) => (t.enabled = on));
  }

  private createPeer(peerId: string) {
    const myPeer = this.hub?.peerId;
    if (!myPeer) return;
    const peer: Peer = new Peer(
      peerId,
      myPeer > peerId,
      iceNow(),
      (sig) => this.hub?.send({ t: 'rtc', to: peerId, data: { kind: 'voice', ...sig } as RtcPayload }),
      () => this.tuneSenders(peer),
      (streamId) => this.isScreenStream(streamId),
    );
    peer.pc.ontrack = (e) => this.onTrack(peerId, e);
    peer.pc.onconnectionstatechange = () =>
      useVoice.setState((s) => ({ connection: { ...s.connection, [peerId]: peer.pc.connectionState } }));

    const micTrack = this.mic?.getAudioTracks()[0];
    if (micTrack) peer.pc.addTrack(micTrack, this.micOut);
    for (const t of this.cam?.getTracks() ?? []) peer.pc.addTrack(t, this.camOut);
    for (const t of this.screen?.getTracks() ?? []) peer.pc.addTrack(t, this.screenOut);
    this.peers.set(peerId, peer);
  }

  /** Screen-share audio is the only stereo stream; ids are announced when each person joins. */
  private isScreenStream(streamId: string) {
    if (streamId === this.screenOut.id) return true;
    for (const p of this.participants.values()) if (p.streams.screen === streamId) return true;
    return false;
  }

  private closePeer(peerId: string) {
    this.peers.get(peerId)?.close();
    this.peers.delete(peerId);
    this.dropChain(`${peerId}:mic`);
    this.dropChain(`${peerId}:screen`);
    this.remoteStreams.delete(peerId);
    delete this.lastLoud[peerId];
    useVoice.setState((s) => {
      const remote = { ...s.remote };
      const connection = { ...s.connection };
      delete remote[peerId];
      delete connection[peerId];
      return { remote, connection };
    });
    if (useUI.getState().focusedPeer === peerId) useUI.getState().set({ focusedPeer: null });
  }

  /** Per-track encoder limits; screen bitrate is shared across viewers in a mesh. */
  private tuneSenders(peer: Peer) {
    const s = useSettings.getState();
    const preset = SCREEN_PRESETS[s.screenQuality];
    const viewers = Math.max(1, this.peers.size);
    for (const sender of peer.pc.getSenders()) {
      const track = sender.track;
      if (!track) continue;
      const params = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: string };
      if (!params.encodings?.length) continue;
      const enc = params.encodings[0];
      if (this.screen?.getVideoTracks().includes(track)) {
        enc.maxBitrate = Math.min(preset.bitrate, Math.floor(36_000_000 / viewers));
        enc.maxFramerate = preset.fps;
        params.degradationPreference = s.screenMode === 'motion' ? 'maintain-framerate' : 'maintain-resolution';
      } else if (this.screen?.getAudioTracks().includes(track)) {
        enc.maxBitrate = 192_000;
      } else if (this.cam?.getVideoTracks().includes(track)) {
        enc.maxBitrate = 1_500_000;
      } else if (track.kind === 'audio') {
        enc.maxBitrate = VOICE_BITRATE;
      } else continue;
      sender.setParameters(params).catch(() => {});
    }
  }

  private onTrack(peerId: string, e: RTCTrackEvent) {
    const stream = e.streams[0];
    if (!stream) return;
    let map = this.remoteStreams.get(peerId);
    if (!map) this.remoteStreams.set(peerId, (map = new Map()));
    map.set(stream.id, stream);
    stream.onremovetrack = () => this.reconcile(peerId);
    stream.onaddtrack = () => this.reconcile(peerId);
    this.reconcile(peerId);
  }

  /** Match remote streams to mic/cam/screen using the ids each participant announced. */
  private reconcile(peerId: string) {
    const p = this.participants.get(peerId);
    const map = this.remoteStreams.get(peerId);
    if (!p || !map) return;
    const pick = (id?: string) => {
      const s = id ? map.get(id) : undefined;
      return s && s.getTracks().some((t) => t.readyState === 'live') ? s : undefined;
    };
    const mic = pick(p.streams.mic);
    const cam = p.camera ? pick(p.streams.cam) : undefined;
    const screen = p.screen ? pick(p.streams.screen) : undefined;
    this.ensureChain(peerId, p.userId, 'mic', mic);
    this.ensureChain(peerId, p.userId, 'screen', screen);
    useVoice.setState((s) => ({ remote: { ...s.remote, [peerId]: { mic, cam, screen } } }));
  }

  private ensureChain(peerId: string, userId: string, kind: 'mic' | 'screen', stream: MediaStream | undefined) {
    const key = `${peerId}:${kind}`;
    const track = stream?.getAudioTracks().find((t) => t.readyState === 'live');
    const existing = this.chains.get(key);
    if (existing && track && existing.trackId === track.id) return;
    this.dropChain(key);
    if (!stream || !track || !this.ctx || !this.master) return;

    // Chromium only feeds remote WebRTC audio into Web Audio while a media element plays it.
    const el = new Audio();
    el.srcObject = stream;
    el.muted = true;
    void el.play().catch(() => {});

    const source = this.ctx.createMediaStreamSource(new MediaStream([track]));
    const gain = this.ctx.createGain();
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    source.connect(gain).connect(this.master);
    this.chains.set(key, { peerId, userId, kind, stream, trackId: track.id, el, source, gain, analyser, data: new Float32Array(analyser.fftSize) });
    this.applyGains();
  }

  private dropChain(key: string) {
    const c = this.chains.get(key);
    if (!c) return;
    c.source.disconnect();
    c.gain.disconnect();
    c.el.srcObject = null;
    this.chains.delete(key);
  }

  private applyGains() {
    if (!this.ctx || !this.master) return;
    const { deafened } = useVoice.getState();
    const s = useSettings.getState();
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(deafened ? 0 : 1, now, 0.015);
    for (const c of this.chains.values()) {
      const p = this.participants.get(c.peerId);
      const v =
        c.kind === 'mic'
          ? s.localMutes[c.userId] || p?.serverMuted
            ? 0
            : (s.userVolumes[c.userId] ?? 1)
          : (s.streamVolumes[c.userId] ?? 1);
      c.gain.gain.setTargetAtTime(v, now, 0.015);
    }
  }

  private startMeter() {
    clearInterval(this.meter);
    this.meter = setInterval(() => {
      const now = performance.now();
      const vs = useVoice.getState();
      if (this.micMeter && !vs.muted && !vs.deafened && !vs.serverMuted && rms(this.micMeter.analyser, this.micMeter.data) > 0.02) {
        this.lastLoud.self = now;
      }
      for (const c of this.chains.values()) {
        if (c.kind === 'mic' && rms(c.analyser, c.data) > 0.012) this.lastLoud[c.peerId] = now;
      }
      const next: Record<string, boolean> = {};
      for (const [k, t] of Object.entries(this.lastLoud)) if (now - t < 300) next[k] = true;
      const prev = vs.speaking;
      const changed = Object.keys(next).length !== Object.keys(prev).length || Object.keys(next).some((k) => !prev[k]);
      if (changed) useVoice.setState({ speaking: next });
    }, 90);
  }

  private removeSenders(stream: MediaStream) {
    const tracks = stream.getTracks();
    for (const peer of this.peers.values()) {
      for (const sender of peer.pc.getSenders()) {
        if (sender.track && tracks.includes(sender.track)) {
          try {
            peer.pc.removeTrack(sender);
          } catch {
            /* connection already closed */
          }
        }
      }
    }
  }

  private stopTracks(stream: MediaStream | null) {
    stream?.getTracks().forEach((t) => t.stop());
  }
}

export const voice = new VoiceEngine();

if (import.meta.env.DEV) Object.assign(window, { __voice: voice, __voiceState: useVoice });
// A live call can't be hot-swapped; reload the page in dev instead of running two engines.
import.meta.hot?.accept(() => location.reload());

/** Grouped media devices for the settings screen. */
export async function listDevices() {
  try {
    // Labels are only exposed after a permission grant.
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
    probe?.getTracks().forEach((t) => t.stop());
  } catch {
    /* ignore */
  }
  const all = await navigator.mediaDevices.enumerateDevices();
  const named = (kind: MediaDeviceKind) =>
    all.filter((d) => d.kind === kind && d.deviceId !== 'communications').map((d, i) => ({ id: d.deviceId, label: d.label || `Device ${i + 1}` }));
  return { inputs: named('audioinput'), outputs: named('audiooutput'), cameras: named('videoinput') };
}
