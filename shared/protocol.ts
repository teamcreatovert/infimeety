// Types shared by the desktop/web app and the Cloudflare backend, plus a few small rules
// both sides apply (roles, watch party defaults).

export type Role = 'owner' | 'admin' | 'moderator' | 'member';

/**
 * Higher is more. Owners run the channel; admins manage it (settings, rooms, invites);
 * moderators keep the peace (voice mute/move/disconnect, deleting messages, removing members).
 */
export const ROLE_RANK: Record<Role, number> = { owner: 3, admin: 2, moderator: 1, member: 0 };
/** Moderators and up. */
export const canModerateRole = (role: Role | null | undefined) => !!role && ROLE_RANK[role] >= ROLE_RANK.moderator;
/** Whether `role` is `min` or higher (a room's view/post permission). */
export const atLeast = (role: Role | null | undefined, min: Role | null | undefined) => ROLE_RANK[role ?? 'member'] >= ROLE_RANK[min ?? 'member'];
/** Whether `me` can act on someone with `target`'s role: only on lower roles. */
export const outranks = (me: Role | null | undefined, target: Role | null | undefined) => !!me && ROLE_RANK[me] > ROLE_RANK[target ?? 'member'];

/** The biggest file (or folder) a chat message can carry. Files go device to device, so this
 * isn't storage; it keeps copies within what every browser's storage and FAT32 drives handle. */
export const MAX_FILE_SIZE = 4 * 1024 ** 3;

export type RoomKind = 'text' | 'voice';
export type Provider = 'google' | 'discord' | 'dev';

export interface PublicUser {
  id: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  /** A browser guest: no account, exists only inside one meeting. */
  guest?: boolean;
  /** An AI bot (Nova, or one a server's admins made): its messages are AI answers. */
  bot?: boolean;
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
  /** Voice rooms: whether watch parties can be held here. Admins switch it; on by default. */
  allowParty: boolean;
  /** The category it's listed under; none puts it in the channel's plain room lists. */
  categoryId?: string | null;
  /** Chat rooms: seconds each person waits between messages (0 = off). Moderators are exempt. */
  slowMode?: number;
  /** The lowest role that sees this room ('member' = everyone). Others don't get it at all. */
  viewRole?: Role;
  /** The lowest role that can post here (chat rooms) or join (voice rooms). */
  postRole?: Role;
}

/** One line of a channel's audit log. */
export interface AuditEntry {
  id: string;
  actorId: string | null;
  /** e.g. 'room.create', 'room.update', 'member.role', 'message.delete', 'automod.block'. */
  action: string;
  /** A room, category or user id, depending on the action. */
  target: string | null;
  detail: Record<string, unknown>;
  createdAt: number;
}

/** AutoMod: what a channel blocks before a message is posted. Moderators and up are exempt. */
export interface AutoModRules {
  /** Blocked words and phrases (whole words; "word*" also blocks words starting with it). */
  words: string[];
  /** Block links, except to these sites (and their subdomains). */
  links: boolean;
  allowedSites: string[];
  /** Most @mentions one message may have (0 = no limit). */
  mentions: number;
  /** Block the same message sent 3 times within 30 s. */
  spam: boolean;
}

export const DEFAULT_AUTOMOD: AutoModRules = { words: [], links: false, allowedSites: [], mentions: 0, spam: false };

/** A collapsible group of rooms in a channel's sidebar. */
export interface Category {
  id: string;
  channelId: string;
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
  /** A picture the admins uploaded; shown instead of the emoji. */
  iconUrl?: string | null;
  ownerId: string;
  /** Any member can share it (null for DMs). For meetings: the meeting code, e.g. "gyus-768g-hsf". */
  inviteCode: string | null;
  role: Role;
  rooms: Room[];
  /** Spaces: room categories, in order. */
  categories?: Category[];
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

/**
 * Settings the server sends every app on connect, so a release can be steered without a new
 * one: apps older than `minVersion` ask to update, and features named in `off` are hidden.
 */
export interface RemoteConfig {
  minVersion?: string;
  off?: string[];
}

/** Features `RemoteConfig.off` can switch off while something is wrong with them. */
export type RemoteFeature = 'screenShare' | 'watchParty' | 'fileShare' | 'noiseFilter' | 'soundboard';

/** A soundboard sound: one from the shared sound pack (the repo's sounds/ folder), by its id. */
export type SoundRef = { kind: 'pack'; id: string };

export interface VoiceSnapshot {
  participants: VoiceParticipant[];
  mutedRooms: string[];
}

/** A file in a watch party: like an attachment, streamed from its owner when someone copies it. */
export interface PartyFile {
  id: string;
  ownerId: string;
  name: string;
  mime: string;
  size: number;
}

/** How a watch party runs, chosen by its host. */
export interface PartySettings {
  /**
   * Who plays, pauses and seeks: everyone; only the host and co-hosts; or 'auto', everyone
   * until more than three people are watching, then only the host and co-hosts.
   */
  control: 'everyone' | 'auto' | 'hosts';
  /** Can the others ask the host to play, pause or jump to a time? */
  requests: boolean;
  /** Start by itself once everyone in the room is ready. */
  autoStart: boolean;
}

export const DEFAULT_PARTY_SETTINGS: PartySettings = { control: 'auto', requests: true, autoStart: false };

/**
 * A watch party in a voice room: everyone plays their own copy of one file, in sync.
 * It opens as a lobby (people get the movie and say they're ready), then goes live.
 * Playback is "at server time `at`, the movie was at `position` seconds, and was (not)
 * playing"; a play is scheduled a moment ahead so everyone starts on the same frame.
 */
export interface PartyState {
  id: string;
  hostId: string;
  cohosts: string[];
  file: PartyFile;
  subtitle: PartyFile | null;
  phase: 'lobby' | 'live';
  settings: PartySettings;
  /** People who said they're ready to start. */
  ready: string[];
  playing: boolean;
  position: number;
  at: number;
  /** Who made the last change. */
  by: string;
  seq: number;
}

/** What a viewer can ask the host for. */
export type PartyAction = { kind: 'play'; position?: number } | { kind: 'pause' } | { kind: 'seek'; position: number };

/** Where each person stands with the movie. */
export interface PartyMemberStatus {
  state: 'choosing' | 'copying' | 'ready' | 'failed';
  progress?: number;
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
  /** Soundboard: everyone in your voice room hears it. */
  | { t: 'sound.play'; sound: SoundRef }
  /** `lanes`: how many connections to send over (copies of big files); 1 if absent. */
  | { t: 'media.request'; ownerId: string; attachmentId: string; reqId: string; lanes?: number }
  | { t: 'media.revoked'; attachmentIds: string[] }
  /** Create (as a lobby), update or (null) end the room's watch party. `resolves`: the request this answers. */
  | {
      t: 'party.set';
      roomId: string;
      party: (Pick<PartyState, 'file' | 'subtitle' | 'playing' | 'position' | 'at'> & { settings?: PartySettings }) | null;
      resolves?: string;
    }
  /** The lobby goes live: everyone starts together after a short countdown. */
  | { t: 'party.start'; roomId: string }
  /** "I'm ready" (or not anymore). */
  | { t: 'party.ready'; roomId: string; ready: boolean }
  /** The host changes how the party runs. */
  | { t: 'party.settings'; roomId: string; settings: PartySettings }
  | { t: 'party.request'; roomId: string; action: PartyAction }
  /** The host makes someone a co-host (or not). */
  | { t: 'party.cohost'; roomId: string; userId: string; on: boolean }
  | { t: 'party.status'; roomId: string; status: PartyMemberStatus }
  /** Clock sync: the hub answers with its own time. */
  | { t: 'clock'; c: number }
  | { t: 'ping' };

export type ServerMsg =
  | { t: 'welcome'; peerId: string; online: string[]; voice: VoiceSnapshot; parties?: Record<string, PartyState>; config?: RemoteConfig }
  | { t: 'presence'; online: string[] }
  | { t: 'voice'; voice: VoiceSnapshot }
  /** Out of voice: an admin's disconnect, or you joined voice from another device ('elsewhere'). */
  | { t: 'voice.kicked'; reason?: 'admin' | 'elsewhere' }
  /** An admin moved you; your client rejoins voice in `roomId`. */
  | { t: 'voice.moved'; roomId: string }
  | { t: 'chat.new'; message: Message; nonce?: string }
  | { t: 'chat.edited'; id: string; roomId: string; content: string; editedAt: number }
  | { t: 'chat.deleted'; id: string; roomId: string }
  | { t: 'chat.reactions'; id: string; roomId: string; reactions: Record<string, string[]> }
  | { t: 'chat.attachments'; id: string; roomId: string; attachments: Attachment[] }
  | { t: 'typing'; roomId: string; userId: string }
  | { t: 'rtc'; from: string; fromUser: string; data: RtcPayload }
  | { t: 'sound'; peerId: string; userId: string; sound: SoundRef }
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
  | { t: 'party'; roomId: string; party: PartyState | null; resolved?: string }
  | { t: 'party.request'; roomId: string; id: string; from: string; action: PartyAction }
  | { t: 'party.status'; roomId: string; peerId: string; userId: string; status: PartyMemberStatus }
  | { t: 'clock'; c: number; s: number }
  | { t: 'error'; message: string }
  /** Your message wasn't posted: slow mode (wait `retryIn` seconds). */
  | { t: 'chat.rejected'; nonce: string; roomId: string; reason: 'slow'; retryIn: number }
  /** AutoMod blocked it: `detail` says which rule ("a blocked word", "links", …). */
  | { t: 'chat.rejected'; nonce: string; roomId: string; reason: 'automod'; detail: string }
  | { t: 'pong' };
