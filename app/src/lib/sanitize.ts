import type { Attachment, Message, StreamIds, VoiceParticipant, VoiceSnapshot } from '../../../shared/protocol';

/**
 * Data from the server and from other people's apps, made safe to draw. Friends run different
 * versions, so a field can be missing, renamed or of another type: anything odd becomes a
 * sensible default here instead of breaking a screen later.
 */

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const bool = (v: unknown) => v === true;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function cleanAttachment(v: unknown): Attachment | null {
  const a = obj(v);
  if (typeof a.id !== 'string') return null;
  return {
    id: a.id,
    ownerId: str(a.ownerId),
    name: str(a.name, 'file'),
    mime: str(a.mime, 'application/octet-stream'),
    size: num(a.size),
    ...(typeof a.width === 'number' ? { width: a.width } : {}),
    ...(typeof a.height === 'number' ? { height: a.height } : {}),
    ...(a.removed === true ? { removed: true } : {}),
  };
}

export const cleanAttachments = (v: unknown): Attachment[] => (Array.isArray(v) ? v.map(cleanAttachment).filter((a): a is Attachment => !!a) : []);

export function cleanReactions(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [emoji, users] of Object.entries(obj(v))) if (Array.isArray(users)) out[emoji] = users.filter((u): u is string => typeof u === 'string');
  return out;
}

/** A chat message, or null when it isn't one (no id or room). */
export function cleanMessage(v: unknown): Message | null {
  const m = obj(v);
  if (typeof m.id !== 'string' || typeof m.roomId !== 'string') return null;
  return {
    id: m.id,
    roomId: m.roomId,
    userId: str(m.userId),
    content: str(m.content),
    attachments: cleanAttachments(m.attachments),
    replyTo: typeof m.replyTo === 'string' ? m.replyTo : null,
    reactions: cleanReactions(m.reactions),
    createdAt: num(m.createdAt, Date.now()),
    editedAt: typeof m.editedAt === 'number' ? m.editedAt : null,
  };
}

function cleanStreams(v: unknown): StreamIds {
  const s = obj(v);
  const out: StreamIds = {};
  for (const k of ['mic', 'cam', 'screen'] as const) if (typeof s[k] === 'string') out[k] = s[k];
  return out;
}

export function cleanParticipant(v: unknown): VoiceParticipant | null {
  const p = obj(v);
  if (typeof p.peerId !== 'string' || typeof p.userId !== 'string' || typeof p.roomId !== 'string') return null;
  return {
    peerId: p.peerId,
    userId: p.userId,
    roomId: p.roomId,
    muted: bool(p.muted),
    deafened: bool(p.deafened),
    camera: bool(p.camera),
    screen: bool(p.screen),
    streams: cleanStreams(p.streams),
    serverMuted: bool(p.serverMuted),
    joinedAt: num(p.joinedAt),
  };
}

export function cleanVoiceSnapshot(v: unknown): VoiceSnapshot {
  const s = obj(v);
  return {
    // Fields a newer server adds (captionRooms in its day) pass through untouched.
    ...s,
    participants: Array.isArray(s.participants) ? s.participants.map(cleanParticipant).filter((p): p is VoiceParticipant => !!p) : [],
    mutedRooms: Array.isArray(s.mutedRooms) ? s.mutedRooms.filter((r): r is string => typeof r === 'string') : [],
  };
}

export const cleanIds = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** A page of chat history; anything that isn't a message is left out. */
export const cleanMessages = (v: unknown): Message[] => (Array.isArray(v) ? v.map(cleanMessage).filter((m): m is Message => !!m) : []);
