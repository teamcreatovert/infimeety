import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { cleanActivity } from '../../../shared/activity';
import type { Activity } from '../../../shared/protocol';
import { isTauri } from './platform';
import { useAuth } from '@/stores/auth';
import { useSettings } from '@/stores/settings';

/**
 * "Playing VALORANT": the desktop app looks for well-known games running on this PC
 * (src-tauri/src/games.rs) and tells friends and the people in your servers. Only the game's
 * name is shared, and nothing at all with "Share what you're playing" off.
 */

/** What people are doing, by user id. */
export const useActivities = create<Record<string, Activity>>()(() => ({}));

export function setActivity(userId: string, activity: unknown) {
  const clean = cleanActivity(activity);
  const current = useActivities.getState()[userId];
  if (clean?.id === current?.id) return;
  useActivities.setState((s) => {
    const next = { ...s };
    if (clean) next[userId] = clean;
    else delete next[userId];
    return next;
  }, true);
}

export function setActivities(map: unknown) {
  if (!map || typeof map !== 'object') return;
  for (const [userId, activity] of Object.entries(map)) setActivity(userId, activity);
}

/** The text under someone's name, or null when they aren't doing anything. */
export const activityText = (a: Activity | undefined) => (a ? `Playing ${a.name}` : null);

// ─── Yours ───────────────────────────────────────────────────────────────────

let mine: Activity | null = null;
const senders = new Set<(activity: Activity | null) => void>();

/** What you're playing, for a connection that just opened. */
export const myActivity = () => mine;

/** A connection that wants to hear when your game changes (the lobby, each channel hub). */
export function onMyActivity(send: (activity: Activity | null) => void) {
  senders.add(send);
  return () => void senders.delete(send);
}

function announce(next: Activity | null) {
  if (next?.id === mine?.id) return;
  mine = next;
  // You see it on your own profile too.
  const me = useAuth.getState().me?.id;
  if (me) setActivity(me, mine);
  for (const send of senders) send(mine);
}

let timer: ReturnType<typeof setInterval> | undefined;

/** Checks every 15 seconds while you're signed in. */
export function startActivityWatch() {
  if (!isTauri || timer) return;
  const check = async () => {
    if (!useSettings.getState().shareActivity) return announce(null);
    const game = await invoke<{ id: string; name: string } | null>('running_game').catch(() => null);
    announce(game ? { kind: 'playing', id: game.id, name: game.name, since: mine?.id === game.id ? mine.since : Date.now() } : null);
  };
  void check();
  timer = setInterval(() => void check(), 15_000);
  // Turning sharing off clears it right away.
  useSettings.subscribe((s, prev) => s.shareActivity !== prev.shareActivity && void check());
}

export function stopActivityWatch() {
  clearInterval(timer);
  timer = undefined;
  mine = null;
  useActivities.setState({}, true);
}
