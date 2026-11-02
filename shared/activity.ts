import type { Activity, MusicShare } from './protocol';

/** An activity from the wire, or null if it isn't a sensible one (both server and app check). */
export function cleanActivity(v: unknown): Activity | null {
  if (!v || typeof v !== 'object') return null;
  const a = v as Record<string, unknown>;
  if (a.kind !== 'playing' || typeof a.id !== 'string' || !/^[a-z0-9]{1,32}$/.test(a.id)) return null;
  if (typeof a.name !== 'string' || !a.name.trim() || a.name.length > 64) return null;
  const since = typeof a.since === 'number' && Number.isFinite(a.since) ? a.since : Date.now();
  return { kind: 'playing', id: a.id, name: a.name.trim(), since };
}

/** A music share from the wire, or null. */
export function cleanMusic(v: unknown): MusicShare | null {
  if (!v || typeof v !== 'object') return null;
  const m = v as Record<string, unknown>;
  if (typeof m.app !== 'string' || typeof m.title !== 'string') return null;
  return { app: m.app.slice(0, 40), title: m.title.slice(0, 160) };
}
