import { create } from 'zustand';

export interface RemoteStreams {
  mic?: MediaStream;
  cam?: MediaStream;
  screen?: MediaStream;
}

/** UI-facing state of the local voice session. The VoiceEngine is the only writer. */
interface VoiceState {
  channelId: string | null;
  roomId: string | null;
  status: 'idle' | 'connecting' | 'connected';
  muted: boolean;
  deafened: boolean;
  serverMuted: boolean;
  camera: boolean;
  screen: boolean;
  /** peerId (or 'self') → speaking */
  speaking: Record<string, boolean>;
  remote: Record<string, RemoteStreams>;
  connection: Record<string, RTCPeerConnectionState>;
  localCam: MediaStream | null;
  localScreen: MediaStream | null;
  micAvailable: boolean;
}

export const useVoice = create<VoiceState>()(() => ({
  channelId: null,
  roomId: null,
  status: 'idle',
  muted: false,
  deafened: false,
  serverMuted: false,
  camera: false,
  screen: false,
  speaking: {},
  remote: {},
  connection: {},
  localCam: null,
  localScreen: null,
  micAvailable: true,
}));
