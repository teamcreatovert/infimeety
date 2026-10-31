import { MAX_FILE_SIZE } from '../../shared/protocol';
import type { Attachment, Channel, InvitePreview, Me, Member, Message, Provider, PublicUser, RemoteConfig, Role, Room, Category } from '../../shared/protocol';
import type { ChannelHub } from './hub';
import type { Lobby } from './lobby';

export interface Env {
  DB: D1Database;
  AVATARS: KVNamespace;
  HUB: DurableObjectNamespace<ChannelHub>;
  LOBBY: DurableObjectNamespace<Lobby>;
  PUBLIC_URL: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  TURN_SERVER?: string;
  TURN_USERNAME?: string;
  TURN_PASSWORD?: string;
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
  DEV_LOGIN?: string;
  /** Apps older than this ask to update (RemoteConfig.minVersion). Empty: no minimum. */
  MIN_APP_VERSION?: string;
  /** Comma-separated RemoteFeature names to switch off everywhere. */
  FEATURES_OFF?: string;
}

export interface UserRow {
  id: string;
  email: string | null;
  name: string;
  username: string | null;
  avatar_url: string | null;
  avatar_key: string | null;
  provider_avatar_url: string | null;
  onboarded: number;
  created_at: number;
  /** Set for browser guests: the meeting (channel id) they belong to. */
  guest_of: string | null;
}

export function b64url(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(input: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)));
}

/** Time-sortable id: 9 chars of base36 milliseconds + 8 random base36 chars. */
export function newId(): string {
  const time = Date.now().toString(36).padStart(9, '0');
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join('');
  return time + rand;
}

export function inviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => alphabet[b % alphabet.length]).join('');
}

export const toPublicUser = (r: Pick<UserRow, 'id' | 'name' | 'username' | 'avatar_url'> & { guest_of?: string | null }): PublicUser => ({
  id: r.id,
  name: r.name,
  username: r.username,
  avatarUrl: r.avatar_url,
  ...(r.guest_of ? { guest: true } : {}),
});

export const toMe = (r: UserRow, providers: Provider[]): Me => ({
  ...toPublicUser(r),
  email: r.email,
  providerAvatarUrl: r.provider_avatar_url,
  hasCustomAvatar: !!r.avatar_key,
  onboarded: !!r.onboarded,
  providers,
});

export const toRoom = (r: any): Room => ({
  id: r.id,
  channelId: r.channel_id,
  kind: r.kind,
  name: r.name,
  position: r.position,
  allowParty: r.allow_party !== 0,
  categoryId: r.category_id ?? null,
  slowMode: r.slow_mode ?? 0,
  viewRole: asRole(r.view_role),
  postRole: asRole(r.post_role),
});

const ROLES: Role[] = ['owner', 'admin', 'moderator', 'member'];
export const asRole = (v: unknown): Role => (ROLES.includes(v as Role) ? (v as Role) : 'member');

export const toCategory = (r: any): Category => ({ id: r.id, channelId: r.channel_id, name: r.name, position: r.position });

export const toChannel = (r: any, rooms: Room[], peer?: PublicUser, categories: Category[] = []): Channel => ({
  id: r.id,
  kind: r.kind === 'dm' || r.kind === 'meeting' ? r.kind : 'space',
  peer,
  name: r.name,
  emoji: r.emoji,
  color: r.color,
  ownerId: r.owner_id,
  // Like Discord's default, every member can invite; DMs have no invite.
  inviteCode: r.kind === 'dm' ? null : r.invite_code,
  role: r.role,
  rooms,
  categories,
  iconUrl: r.icon_url ?? null,
  ...(r.kind === 'meeting' ? { expiresAt: r.expires_at } : {}),
});

export const toMember = (r: any): Member => ({ ...toPublicUser(r), role: r.role, joinedAt: r.joined_at });

export const toMessage = (r: any): Message => ({
  id: r.id,
  roomId: r.room_id,
  userId: r.user_id,
  content: r.content,
  attachments: r.attachments ? JSON.parse(r.attachments) : [],
  replyTo: r.reply_to,
  reactions: r.reactions ? JSON.parse(r.reactions) : {},
  createdAt: r.created_at,
  editedAt: r.edited_at,
});

export const isAdmin = (role: Role | null | undefined) => role === 'owner' || role === 'admin';

/** Attachments are metadata the sender vouches for; keep them small and well-formed. */
export function sanitizeAttachments(input: unknown, ownerId: string): Attachment[] {
  if (!Array.isArray(input)) return [];
  const out: Attachment[] = [];
  for (const a of input.slice(0, 10)) {
    if (!a || typeof a !== 'object') continue;
    const { id, name, mime, size, width, height } = a as Record<string, unknown>;
    if (typeof id !== 'string' || id.length > 64 || !/^[\w-]+$/.test(id)) continue;
    // Any kind of file; the type only decides how the chat shows it.
    if (typeof mime !== 'string' || !/^[\w.+-]{1,40}\/[\w.+-]{1,100}$/.test(mime)) continue;
    if (typeof size !== 'number' || size < 0 || size > MAX_FILE_SIZE) continue;
    out.push({
      id,
      ownerId,
      name: String(name ?? 'file').slice(0, 200),
      mime,
      size: Math.floor(size),
      width: typeof width === 'number' ? Math.floor(width) : undefined,
      height: typeof height === 'number' ? Math.floor(height) : undefined,
    });
  }
  return out;
}

export async function memberRole(env: Env, channelId: string, userId: string): Promise<Role | null> {
  const row = await env.DB.prepare('SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ?')
    .bind(channelId, userId)
    .first<{ role: Role }>();
  return row?.role ?? null;
}

export function hub(env: Env, channelId: string) {
  return env.HUB.get(env.HUB.idFromName(channelId));
}

export async function invitePreview(env: Env, rawCode: string): Promise<InvitePreview | null> {
  const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 8) return null;
  const row = await env.DB.prepare(
    `SELECT c.name, c.emoji, c.color, (SELECT COUNT(*) FROM channel_members m WHERE m.channel_id = c.id) AS members
     FROM channels c WHERE c.invite_code = ? AND c.kind = 'space'`,
  )
    .bind(code)
    .first<{ name: string; emoji: string; color: string; members: number }>();
  return row ? { code, ...row } : null;
}

/** The single presence/notification hub every signed-in client connects to. */
export function lobby(env: Env) {
  return env.LOBBY.get(env.LOBBY.idFromName('lobby'));
}

/** Friendship rows are keyed by the ordered pair (user_a < user_b). */
export const orderedPair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

/** What every app is told on connect (RemoteConfig): set with the Worker's vars, no app release needed. */
export function remoteConfig(env: Env): RemoteConfig {
  const min = env.MIN_APP_VERSION?.trim();
  const off = (env.FEATURES_OFF ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);
  return { ...(min ? { minVersion: min } : {}), ...(off.length ? { off } : {}) };
}
