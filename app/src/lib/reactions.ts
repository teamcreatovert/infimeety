import { create } from 'zustand';
import { ALL_REACTIONS } from '../../../shared/protocol';
import { getHub } from './realtime';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { useVoice } from '@/stores/voice';

/** Reactions floating up over the call right now. */
export const useReactions = create<{ list: { id: number; emoji: string; name: string; x: number }[] }>()(() => ({ list: [] }));
let next = 0;

function float(emoji: string, name: string) {
  const id = ++next;
  // A little to the left or right each time, so a burst spreads out.
  const x = 6 + Math.random() * 22;
  useReactions.setState((s) => ({ list: [...s.list.slice(-24), { id, emoji, name, x }] }));
  setTimeout(() => useReactions.setState((s) => ({ list: s.list.filter((r) => r.id !== id) })), 3200);
}

/** Sends a reaction to everyone in your voice room (and shows it here). */
export function sendReaction(emoji: string) {
  const vs = useVoice.getState();
  if (!vs.channelId || !ALL_REACTIONS.includes(emoji)) return;
  getHub(vs.channelId)?.send({ t: 'reaction', emoji });
  float(emoji, 'You');
}

export function onReaction(userId: string, emoji: string) {
  if (userId === useAuth.getState().me?.id || !ALL_REACTIONS.includes(emoji)) return;
  float(emoji, useChannels.getState().users[userId]?.name ?? 'Someone');
}
