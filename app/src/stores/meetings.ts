import { create } from 'zustand';
import type { Channel, PublicUser } from '../../../shared/protocol';
import { api } from '@/lib/api';
import { getHub } from '@/lib/realtime';
import { sounds } from '@/lib/sounds';
import { voice } from '@/lib/voice/engine';
import { useAuth } from './auth';
import { useChannels } from './channels';
import { toast } from './ui';
import { useVoice } from './voice';

interface MeetingsState {
  /** The "Join this meeting?" sheet: a code from a link, or '' to type one in. */
  joining: string | null;
  /** Meeting whose "share the link" card is showing (right after you start it). */
  sharing: string | null;
  /** Guests knocking, per meeting. Only the host and co-hosts receive these. */
  waiting: Record<string, PublicUser[]>;
  /** Meetings that went away while open here, and why. */
  closed: Record<string, 'ended' | 'removed'>;

  create: () => Promise<Channel>;
  join: (code: string) => Promise<Channel>;
  /** Join (or rejoin) a meeting's call. */
  enterCall: (channel: Channel, opts?: { camera?: boolean; confirmed?: boolean }) => Promise<void>;
  end: (channelId: string) => Promise<void>;
  /** Take a meeting off your list (you can come back with the link while it lasts). */
  leave: (channelId: string) => Promise<void>;
  answer: (channelId: string, userId: string, admit: boolean) => Promise<void>;
  setCohost: (channelId: string, userId: string, on: boolean) => Promise<void>;
  remove: (channelId: string, userId: string) => Promise<void>;
  loadWaiting: (channelId: string) => Promise<void>;

  // Realtime events (lib/realtime.ts)
  setWaiting: (channelId: string, users: PublicUser[]) => void;
  onCohost: (channelId: string, userId: string) => void;
  onEnded: (channelId: string) => void;
  /** The meeting's channel was removed: say why. */
  onRemoved: (channelId: string) => void;

  set: (patch: Partial<MeetingsState>) => void;
}

/** A new channel's realtime hub connects right after it lands in the channel list. */
async function hubFor(channelId: string) {
  for (let i = 0; i < 50 && !getHub(channelId); i++) await new Promise((r) => setTimeout(r, 100));
  return getHub(channelId);
}

function addAndSelect(channel: Channel) {
  useChannels.setState((s) => ({
    channels: s.channels.some((c) => c.id === channel.id) ? s.channels.map((c) => (c.id === channel.id ? channel : c)) : [...s.channels, channel],
  }));
  useChannels.getState().select(channel.id);
  void useChannels.getState().loadMembers(channel.id);
}

export const useMeetings = create<MeetingsState>()((set, get) => ({
  joining: null,
  sharing: null,
  waiting: {},
  closed: {},

  async create() {
    const channel = await api<Channel>('/meetings', { method: 'POST' });
    addAndSelect(channel);
    set({ sharing: channel.id });
    return channel;
  },

  async join(code) {
    const channel = await api<Channel>(`/meetings/${code}/join`, { method: 'POST' });
    addAndSelect(channel);
    return channel;
  },

  async enterCall(channel, { camera = false, confirmed = false } = {}) {
    const room = channel.rooms.find((r) => r.kind === 'voice');
    if (!room) return;
    await hubFor(channel.id);
    await voice.join(channel.id, room.id, { confirmed });
    if (camera && useVoice.getState().roomId === room.id && !useVoice.getState().camera) await voice.toggleCamera();
  },

  async end(channelId) {
    if (useVoice.getState().channelId === channelId) voice.leave();
    await api(`/channels/${channelId}/end`, { method: 'POST' });
  },

  async leave(channelId) {
    if (useVoice.getState().channelId === channelId) voice.leave();
    await api(`/channels/${channelId}/leave`, { method: 'POST' });
    useChannels.getState().removeLocal(channelId);
  },

  async answer(channelId, userId, admit) {
    // Optimistic: the card goes away at once; the hub sends the real list right after.
    set((s) => ({ waiting: { ...s.waiting, [channelId]: (s.waiting[channelId] ?? []).filter((u) => u.id !== userId) } }));
    try {
      await api(`/channels/${channelId}/guests/${userId}`, { method: 'POST', json: { admit } });
    } catch {
      toast({ kind: 'error', title: admit ? 'Couldn’t let them in' : 'Couldn’t turn them away', body: 'They may have left already.' });
      void get().loadWaiting(channelId);
    }
  },

  async setCohost(channelId, userId, on) {
    await api(`/channels/${channelId}/members/${userId}`, { method: 'PATCH', json: { role: on ? 'admin' : 'member' } });
  },

  async remove(channelId, userId) {
    await api(`/channels/${channelId}/members/${userId}`, { method: 'DELETE' });
  },

  async loadWaiting(channelId) {
    try {
      get().setWaiting(channelId, await api<PublicUser[]>(`/channels/${channelId}/guests`));
    } catch {
      /* not a host any more */
    }
  },

  setWaiting(channelId, users) {
    const before = new Set((get().waiting[channelId] ?? []).map((u) => u.id));
    if (users.some((u) => !before.has(u.id))) sounds.message();
    set((s) => ({ waiting: { ...s.waiting, [channelId]: users } }));
  },

  onCohost(channelId, userId) {
    if (userId !== useAuth.getState().me?.id) return;
    toast({ kind: 'info', title: 'You’re now a co-host', body: 'Nobody else was here to run the meeting, so you can let guests in and manage people.' });
    void get().loadWaiting(channelId);
  },

  onEnded(channelId) {
    set((s) => ({ closed: { ...s.closed, [channelId]: 'ended' } }));
  },

  onRemoved(channelId) {
    const why = get().closed[channelId] ?? 'removed';
    set((s) => ({ closed: { ...s.closed, [channelId]: why }, waiting: { ...s.waiting, [channelId]: [] }, sharing: s.sharing === channelId ? null : s.sharing }));
    toast({ kind: 'info', title: why === 'ended' ? 'The meeting has ended' : 'You were removed from the meeting' });
  },

  set: (patch) => set(patch),
}));
