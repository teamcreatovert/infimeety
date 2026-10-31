import { useEffect, useState } from 'react';
import type { Room, Role } from '../../../shared/protocol';
import { canModerateRole } from '../../../shared/protocol';

/**
 * Slow mode on your side: after you post in a slow room, the composer counts down instead of
 * letting you send a message the server would turn away. Moderators and up are exempt.
 */
const lastSent = new Map<string, number>();

export function noteSent(roomId: string, at = Date.now()) {
  lastSent.set(roomId, at);
}

const remaining = (room: Room, role: Role | null | undefined) =>
  !room.slowMode || canModerateRole(role) ? 0 : Math.max(0, Math.ceil(((lastSent.get(room.id) ?? 0) + room.slowMode * 1000 - Date.now()) / 1000));

/** Seconds until you can post here again (0: now), ticking down. */
export function useSlowWait(room: Room, role: Role | null | undefined) {
  const [, tick] = useState(0);
  const wait = remaining(room, role);
  useEffect(() => {
    if (!wait) return;
    const t = setTimeout(() => tick((n) => n + 1), 1000);
    return () => clearTimeout(t);
  });
  return wait;
}

export const slowLabel = (s: number) => (s >= 3600 ? `${Math.round(s / 3600)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);
