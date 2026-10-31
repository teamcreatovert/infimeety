import { type Env, newId } from './util';

/**
 * Writes one line to a channel's audit log (Channel settings → Audit log). Never fails the
 * action it records: a log that can't be written is skipped.
 */
export async function audit(env: Env, channelId: string, actorId: string | null, action: string, target: string | null = null, detail: Record<string, unknown> = {}) {
  try {
    const now = Date.now();
    await env.DB.prepare('INSERT INTO audit_log (id, channel_id, actor_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(newId(), channelId, actorId, action, target, JSON.stringify(detail).slice(0, 2000), now)
      .run();
    // Keep 90 days (checked now and then, not on every write).
    if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM audit_log WHERE channel_id = ? AND created_at < ?').bind(channelId, now - 90 * 86400_000).run();
  } catch {
    /* before the audit migration */
  }
}
