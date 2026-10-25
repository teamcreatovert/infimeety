// Types shared by the desktop/web app and the Cloudflare backend.
// Type-only module: nothing here ships at runtime.

export type Role = 'owner' | 'admin' | 'member';
export type RoomKind = 'text' | 'voice';
export type Provider = 'google' | 'discord' | 'dev';

export interface PublicUser {
  id: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
}

export interface Me extends PublicUser {
  email: string | null;
  providerAvatarUrl: string | null;
  hasCustomAvatar: boolean;
  onboarded: boolean;
  providers: Provider[];
}

export interface Room {
  id: string;
  channelId: string;
  kind: RoomKind;
  name: string;
  position: number;
}

export interface Channel {
  id: string;
  name: string;
  emoji: string;
  color: string;
  ownerId: string;
  /** Only sent to owners/admins. */
  inviteCode: string | null;
  role: Role;
  rooms: Room[];
}

export interface Member extends PublicUser {
  role: Role;
  joinedAt: number;
}

/**
 * Metadata only. The file itself never leaves the sender's PC: viewers stream it
 * peer-to-peer from the owner while they are online.
 */
export interface Attachment {
  id: string;
  ownerId: string;
  name: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  /** Set once the owner deletes the file from their PC. */
  removed?: boolean;
}

export interface Message {
  id: string;
  roomId: string;
  userId: string;
  content: string;
  attachments: Attachment[];
  replyTo: string | null;
  reactions: Record<string, string[]>;
  createdAt: number;
  editedAt: number | null;
}

export interface StreamIds {
  mic?: string;
  cam?: string;
  screen?: string;
}

export interface VoiceLocalState {
  muted: boolean;
  deafened: boolean;
  camera: boolean;
  screen: boolean;
  streams: StreamIds;
}

export interface VoiceParticipant extends VoiceLocalState {
  peerId: string;
  userId: string;
  roomId: string;
  /** Effective server mute: set by an admin directly or through a room-wide mute. */
  serverMuted: boolean;
  joinedAt: number;
}

export interface VoiceSnapshot {
  participants: VoiceParticipant[];
  mutedRooms: string[];
}

/** Structural copies of the DOM WebRTC types so the Worker compiles without DOM libs. */
export interface SdpInit {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp?: string;
}
export interface IceInit {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

/** Payloads relayed peer-to-peer through the hub (`rtc` messages). */
export type RtcPayload =
  | { kind: 'voice'; description?: SdpInit; candidate?: IceInit }
  | { kind: 'xfer'; reqId: string; description?: SdpInit; candidate?: IceInit }
  | { kind: 'media.reply'; reqId: string; status: 'gone' | 'busy' | 'unknown' };

export type ClientMsg =
  | { t: 'chat.send'; roomId: string; content: string; attachments?: Attachment[]; replyTo?: string | null; nonce: string }
  | { t: 'chat.edit'; id: string; content: string }
  | { t: 'chat.delete'; id: string }
  | { t: 'chat.react'; id: string; emoji: string }
  | { t: 'typing'; roomId: string }
  | { t: 'voice.join'; roomId: string; state: VoiceLocalState }
  | { t: 'voice.leave' }
  | { t: 'voice.update'; state: Partial<VoiceLocalState> }
  | { t: 'voice.serverMute'; peerId: string; muted: boolean }
  | { t: 'voice.roomMute'; roomId: string; muted: boolean }
  | { t: 'voice.disconnect'; peerId: string }
  | { t: 'rtc'; to: string; data: RtcPayload }
  | { t: 'media.request'; ownerId: string; attachmentId: string; reqId: string }
  | { t: 'media.revoked'; attachmentIds: string[] }
  | { t: 'ping' };

export type ServerMsg =
  | { t: 'welcome'; peerId: string; online: string[]; voice: VoiceSnapshot }
  | { t: 'presence'; online: string[] }
  | { t: 'voice'; voice: VoiceSnapshot }
  | { t: 'voice.kicked' }
  | { t: 'chat.new'; message: Message; nonce?: string }
  | { t: 'chat.edited'; id: string; roomId: string; content: string; editedAt: number }
  | { t: 'chat.deleted'; id: string; roomId: string }
  | { t: 'chat.reactions'; id: string; roomId: string; reactions: Record<string, string[]> }
  | { t: 'chat.attachments'; id: string; roomId: string; attachments: Attachment[] }
  | { t: 'typing'; roomId: string; userId: string }
  | { t: 'rtc'; from: string; fromUser: string; data: RtcPayload }
  | { t: 'media.request'; from: string; fromUser: string; attachmentId: string; reqId: string }
  | { t: 'media.offline'; reqId: string }
  | { t: 'media.revoked'; ownerId: string; attachmentIds: string[] }
  | { t: 'channel.changed' }
  | { t: 'channel.removed' }
  | { t: 'member.updated'; user: PublicUser }
  | { t: 'error'; message: string }
  | { t: 'pong' };
