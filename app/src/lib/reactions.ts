import { create } from 'zustand';
import { validGifId, validReaction } from '../../../shared/protocol';
import { getHub } from './realtime';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { useVoice } from '@/stores/voice';

/** Reactions floating up over the call right now. */
export const useReactions = create<{ list: { id: number; emoji: string; gif?: string; name: string; x: number }[] }>()(() => ({ list: [] }));
let next = 0;

function float(emoji: string, name: string, gif?: string) {
  const id = ++next;
  // A little to the left or right each time, so a burst spreads out.
  const x = 6 + Math.random() * 22;
  useReactions.setState((s) => ({ list: [...s.list.slice(gif ? -6 : -24), { id, emoji, gif, name, x }] }));
  setTimeout(() => useReactions.setState((s) => ({ list: s.list.filter((r) => r.id !== id) })), gif ? 4200 : 3200);
}

/** Sends a reaction to everyone in your voice room (and shows it here). */
export function sendReaction(emoji: string) {
  const vs = useVoice.getState();
  if (!vs.channelId || !validReaction(emoji)) return;
  getHub(vs.channelId)?.send({ t: 'reaction', emoji });
  float(emoji, 'You');
}

/** Sends a GIF (by its GIPHY id) to everyone in your voice room. */
export function sendGif(id: string) {
  const vs = useVoice.getState();
  if (!vs.channelId || !validGifId(id)) return;
  getHub(vs.channelId)?.send({ t: 'reaction', emoji: '', gif: id });
  float('', 'You', id);
}

export function onReaction(userId: string, emoji: string, gif?: string) {
  if (userId === useAuth.getState().me?.id) return;
  const name = useChannels.getState().users[userId]?.name ?? 'Someone';
  if (validGifId(gif)) return float('', name, gif);
  if (validReaction(emoji)) float(emoji, name);
}
