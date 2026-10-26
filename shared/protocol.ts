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
  /** A browser guest: no account, exists only inside one meeting. */
  guest?: boolean;
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
  /**
   * 'space' = a server-like channel; 'dm' = a private two-person conversation;
   * 'meeting' = a short-lived call people join from a link (owner = host, admins = co-hosts).
   */
  kind: 'space' | 'dm' | 'meeting';
  name: string;
  emoji: string;
  color: string;
  ownerId: string;
  /** Any member can share it (null for DMs). For meetings: the meeting code, e.g. "gyus-768g-hsf". */
  inviteCode: string | null;
  role: Role;
  rooms: Room[];
  /** For DMs: the other person. */
  peer?: PublicUser;
  /** For meetings: when the link stops working at the latest. */
  expiresAt?: number;
}

/** Public preview of a meeting link (no sign-in needed). */
export interface MeetingPreview {
  code: string;
  name: string;
  host: PublicUser;
  /** People in the call right now. */
  inCall: number;
  expiresAt: number;
}

/** Where a browser guest stands: waiting in the lobby, let in, turned away, or removed by the host. */
export type GuestStatus = 'waiting' | 'admitted' | 'denied' | 'removed';

/** Public preview of an invite link (no sign-in needed). */
export interface InvitePreview {
  code: string;
  name: string;
  emoji: string;
  color: string;
  members: number;
}

export type FriendStatus = 'accepted' | 'incoming' | 'outgoing';

export interface Friend {
  user: PublicUser;
  status: FriendStatus;
  since: number;
}

/** Messages on the per-user lobby socket (friends, presence, new DMs). */
export type LobbyMsg =
  | { t: 'lobby.welcome'; online: string[] }
  | { t: 'friend.presence'; userId: string; online: boolean }
  | { t: 'friend.upsert'; friend: Friend }
  | { t: 'friend.removed'; userId: string }
  | { t: 'channel.added'; channelId: string }
  | { t: 'pong' };

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
  /** A file transfer's connection; big copies use several at once (`lane`, absent = 0). */
  | { kind: 'xfer'; reqId: string; lane?: number; description?: SdpInit; candidate?: IceInit }
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
  /** Admin: move someone to another voice room in this channel. */
  | { t: 'voice.move'; peerId: string; roomId: string }
  | { t: 'rtc'; to: string; data: RtcPayload }
  /** `lanes`: how many connections to send over (copies of big files); 1 if absent. */
  | { t: 'media.request'; ownerId: string; attachmentId: string; reqId: string; lanes?: number }
  | { t: 'media.revoked'; attachmentIds: string[] }
  | { t: 'ping' };

export type ServerMsg =
  | { t: 'welcome'; peerId: string; online: string[]; voice: VoiceSnapshot }
  | { t: 'presence'; online: string[] }
  | { t: 'voice'; voice: VoiceSnapshot }
  | { t: 'voice.kicked' }
  /** An admin moved you; your client rejoins voice in `roomId`. */
  | { t: 'voice.moved'; roomId: string }
  | { t: 'chat.new'; message: Message; nonce?: string }
  | { t: 'chat.edited'; id: string; roomId: string; content: string; editedAt: number }
  | { t: 'chat.deleted'; id: string; roomId: string }
  | { t: 'chat.reactions'; id: string; roomId: string; reactions: Record<string, string[]> }
  | { t: 'chat.attachments'; id: string; roomId: string; attachments: Attachment[] }
  | { t: 'typing'; roomId: string; userId: string }
  | { t: 'rtc'; from: string; fromUser: string; data: RtcPayload }
  | { t: 'media.request'; from: string; fromUser: string; attachmentId: string; reqId: string; lanes?: number }
  | { t: 'media.offline'; reqId: string }
  | { t: 'media.revoked'; ownerId: string; attachmentIds: string[] }
  | { t: 'channel.changed' }
  | { t: 'channel.removed' }
  | { t: 'member.updated'; user: PublicUser }
  /** Meetings: the guests waiting to be let in (sent to the host and co-hosts). */
  | { t: 'meeting.waiting'; users: PublicUser[] }
  /** Meetings: nobody was left to run the meeting, so this person became a co-host. */
  | { t: 'meeting.cohost'; userId: string }
  /** Meetings: the host ended it or it expired; `channel.removed` follows. */
  | { t: 'meeting.ended' }
  | { t: 'error'; message: string }
  | { t: 'pong' };
