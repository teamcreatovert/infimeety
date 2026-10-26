import type { MeetingPreview, PublicUser } from '../../shared/protocol';
import { type Env, hub, toPublicUser } from './util';

/** A meeting's link works for a day at most... */
export const MEETING_TTL = 24 * 3600_000;
/** ...and the meeting ends sooner once its call has been empty this long. */
export const MEETING_IDLE = 3600_000;
/** Stop accepting knocks when this many guests are already waiting. */
export const MAX_WAITING = 20;

export const MEETING_CODE = /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{3}$/;

// 32 symbols (no 0/o or 1/l), so every byte maps evenly.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/** Google Meet-style code like "gyus-768g-hsf": 11 random symbols (55 bits), far too many to guess. */
export function meetingCode(): string {
  const c = Array.from(crypto.getRandomValues(new Uint8Array(11)), (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
}

/** "gyus-768g-hsf", "GYUS768GHSF" → "gyus-768g-hsf"; anything else → null. */
export function cleanMeetingCode(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return s.length === 11 ? `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}` : null;
}

export interface MeetingRow {
  id: string;
  name: string;
  owner_id: string;
  invite_code: string;
  expires_at: number;
}

/** The live meeting behind a code, or null once it has ended. */
export async function findMeeting(env: Env, rawCode: string): Promise<MeetingRow | null> {
  const code = cleanMeetingCode(rawCode);
  if (!code) return null;
  const row = await env.DB.prepare("SELECT id, name, owner_id, invite_code, expires_at FROM channels WHERE invite_code = ? AND kind = 'meeting'")
    .bind(code)
    .first<MeetingRow>();
  if (row && row.expires_at <= Date.now()) {
    // The hub's alarm normally gets there first; this covers a missed one.
    await endMeeting(env, row.id);
    return null;
  }
  return row;
}

export async function meetingPreview(env: Env, code: string): Promise<MeetingPreview | null> {
  const row = await findMeeting(env, code);
  if (!row) return null;
  const host = await env.DB.prepare('SELECT id, name, username, avatar_url FROM users WHERE id = ?').bind(row.owner_id).first<any>();
  return {
    code: row.invite_code,
    name: row.name,
    host: toPublicUser(host ?? { id: row.owner_id, name: 'Someone', username: null, avatar_url: null }),
    inCall: await hub(env, row.id).callSize(),
    expiresAt: row.expires_at,
  };
}

/** Guests knocking on a meeting, oldest first. */
export async function waitingGuests(env: Env, channelId: string): Promise<PublicUser[]> {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.name, u.username, u.avatar_url, u.guest_of FROM meeting_access a JOIN users u ON u.id = a.user_id
     WHERE a.channel_id = ? AND a.status = 'waiting' ORDER BY a.created_at`,
  )
    .bind(channelId)
    .all<any>();
  return results.map(toPublicUser);
}

/** Tell the host and co-hosts who's waiting. */
export async function announceWaiting(env: Env, channelId: string) {
  await hub(env, channelId).notifyAdmins({ t: 'meeting.waiting', users: await waitingGuests(env, channelId) });
}

/** Deletes a meeting from D1: its chat, memberships and guest accounts. Only text/metadata ever lived there. */
export async function deleteMeetingData(env: Env, channelId: string) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM messages WHERE room_id IN (SELECT id FROM rooms WHERE channel_id = ?)').bind(channelId),
    env.DB.prepare('DELETE FROM rooms WHERE channel_id = ?').bind(channelId),
    env.DB.prepare('DELETE FROM channel_members WHERE channel_id = ?').bind(channelId),
    env.DB.prepare('DELETE FROM meeting_access WHERE channel_id = ?').bind(channelId),
    env.DB.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE guest_of = ?)').bind(channelId),
    env.DB.prepare('DELETE FROM users WHERE guest_of = ?').bind(channelId),
    env.DB.prepare("DELETE FROM channels WHERE id = ? AND kind = 'meeting'").bind(channelId),
  ]);
}

/** Ends a meeting for everyone: deletes it and disconnects whoever is still there. */
export async function endMeeting(env: Env, channelId: string) {
  await deleteMeetingData(env, channelId);
  await hub(env, channelId).meetingEnded();
}

/** Safety net for meetings whose hub alarm never ran. */
export async function sweepMeetings(env: Env) {
  const { results } = await env.DB.prepare("SELECT id FROM channels WHERE kind = 'meeting' AND expires_at <= ? LIMIT 20")
    .bind(Date.now())
    .all<{ id: string }>();
  for (const r of results) await endMeeting(env, r.id);
}
