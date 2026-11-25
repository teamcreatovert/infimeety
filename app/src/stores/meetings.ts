import { create } from 'zustand';
import { DEFAULT_MEETING, type Channel, type GuestStatus, type MeetingAct, type MeetingRepeat, type MeetingSettings, type PublicUser } from '../../../shared/protocol';
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
  /** The "Schedule a meeting" sheet is open. */
  scheduling: boolean;
  /** How long you said each meeting you scheduled lasts (minutes), for its calendar invite. */
  durations: Record<string, number>;
  /** Guests knocking, per meeting. Only the host and co-hosts receive these. */
  waiting: Record<string, PublicUser[]>;
  /** Meetings that went away while open here, and why. */
  closed: Record<string, 'ended' | 'removed'>;
  /** Each meeting's host controls, as its hub last said. */
  settings: Record<string, MeetingSettings>;
  /** The person you pinned big in each meeting (a user id), just for you. */
  pinned: Record<string, string | null>;

  /** Now (default), `later` (a link that waits for its first call), or at `startsAt`, maybe repeating. */
  create: (opts?: { name?: string; startsAt?: number; repeat?: MeetingRepeat | null; later?: boolean }) => Promise<Channel>;
  /** In you go, or 'waiting' when the meeting is restricted and the host has to let you in. */
  join: (code: string) => Promise<Channel | 'waiting'>;
  /** While waiting to be let in: the meeting once you're in, or why not. */
  checkAdmission: (code: string) => Promise<Channel | GuestStatus>;
  /** Host and co-hosts: change the host controls for everyone. */
  configure: (channelId: string, patch: Partial<MeetingSettings>) => void;
  /** Host and co-hosts: mute someone, turn off their camera, stop their share, lower hands... */
  act: (channelId: string, act: MeetingAct, peerId?: string) => void;
  pin: (channelId: string, userId: string | null) => void;
  /** Join (or rejoin) a meeting's call. */
  enterCall: (channel: Channel, opts?: { camera?: boolean; confirmed?: boolean }) => Promise<void>;
  end: (channelId: string) => Promise<void>;
  /** Take a meeting off your list (you can come back with the link while it lasts). */
  leave: (channelId: string) => Promise<void>;
  answer: (channelId: string, userId: string, admit: boolean) => Promise<void>;
  setCohost: (channelId: string, userId: string, on: boolean) => Promise<void>;
  /** The host hands the meeting to someone else (you become a co-host). */
  makeHost: (channelId: string, userId: string) => Promise<void>;
  onHost: (channelId: string, userId: string, from: string) => void;
  remove: (channelId: string, userId: string) => Promise<void>;
  loadWaiting: (channelId: string) => Promise<void>;

  // Realtime events (lib/realtime.ts)
  setWaiting: (channelId: string, users: PublicUser[]) => void;
  onSettings: (channelId: string, settings: MeetingSettings) => void;
  /** The host or a co-host did something to you (or the meeting's rules did). */
  onAct: (channelId: string, act: 'mute' | 'camOff' | 'shareOff' | 'lowerHand', by?: string) => void;
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
  scheduling: false,
  durations: {},
  waiting: {},
  closed: {},
  settings: {},
  pinned: {},

  async create(opts = {}) {
    const channel = await api<Channel>('/meetings', { method: 'POST', json: { ...opts, tz: new Date().getTimezoneOffset() } });
    addAndSelect(channel);
    // Scheduled ones show their own "scheduled" sheet; the rest get the share card.
    if (!opts.startsAt) set({ sharing: channel.id });
    return channel;
  },

  async join(code) {
    const res = await api<Channel | { status: 'waiting' }>(`/meetings/${code}/join`, { method: 'POST' });
    if ('status' in res) return 'waiting';
    addAndSelect(res);
    return res;
  },

  async checkAdmission(code) {
    const res = await api<{ status: GuestStatus; channel?: Channel }>(`/meetings/${code}/guest`);
    if (res.status === 'admitted' && res.channel) {
      addAndSelect(res.channel);
      return res.channel;
    }
    return res.status === 'admitted' ? 'waiting' : res.status;
  },

  configure(channelId, patch) {
    // Shown at once; the hub's answer (to everyone) follows.
    set((s) => ({ settings: { ...s.settings, [channelId]: { ...DEFAULT_MEETING, ...s.settings[channelId], ...patch } } }));
    getHub(channelId)?.send({ t: 'meeting.settings', settings: patch });
  },

  act(channelId, act, peerId) {
    getHub(channelId)?.send({ t: 'meeting.act', act, ...(peerId ? { peerId } : {}) });
  },

  pin(channelId, userId) {
    set((s) => ({ pinned: { ...s.pinned, [channelId]: userId } }));
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

  async makeHost(channelId, userId) {
    await api(`/channels/${channelId}/host`, { method: 'POST', json: { userId } });
  },

  onHost(channelId, userId, from) {
    const me = useAuth.getState().me?.id;
    const name = (id: string) => useChannels.getState().users[id]?.name ?? 'Someone';
    // Roles show at once; the channel list catches up from the server.
    useChannels.setState((s) => ({
      channels: s.channels.map((c) => (c.id === channelId ? { ...c, ownerId: userId, role: c.role === 'owner' || me === userId ? (me === userId ? 'owner' : 'admin') : c.role } : c)),
    }));
    void useChannels.getState().loadMembers(channelId);
    if (me === userId) toast({ kind: 'info', title: 'You’re the host now', body: `${name(from)} handed you the meeting. You can change the host controls and end it for everyone.` });
    else if (me === from) toast({ kind: 'success', title: `${name(userId)} is the host now`, body: 'You’re a co-host, so you can still let people in and manage them.' });
    else toast({ kind: 'info', title: `${name(userId)} is the host now` });
    if (me === userId) void get().loadWaiting(channelId);
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

  onSettings(channelId, settings) {
    set((s) => ({ settings: { ...s.settings, [channelId]: { ...DEFAULT_MEETING, ...settings } } }));
  },

  onAct(channelId, act, by) {
    const v = useVoice.getState();
    if (v.channelId !== channelId) return;
    const who = by ? (useChannels.getState().users[by]?.name ?? 'The host') : null;
    if (act === 'mute') {
      if (!v.muted) void voice.toggleMute();
      toast({ kind: 'info', title: `${who ?? 'The host'} muted you`, body: v.serverMuted ? undefined : 'You can unmute yourself when you’re ready to talk.' });
    } else if (act === 'camOff') {
      if (v.camera) voice.stopCamera();
      toast({ kind: 'info', title: who ? `${who} turned off your camera` : 'The host has turned off cameras' });
    } else if (act === 'shareOff') {
      if (v.screen) voice.stopScreen();
      toast({ kind: 'info', title: who ? `${who} stopped your screen share` : 'Only the host and co-hosts can share their screen right now' });
    } else if (act === 'lowerHand') {
      if (v.hand) voice.toggleHand();
      if (who) toast({ kind: 'info', title: `${who} lowered your hand` });
    }
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

/**
 * Whether the host turned `what` off for everyone in this meeting and you're not the host or a
 * co-host (false outside meetings).
 */
export function heldBack(channelId: string | null | undefined, what: 'share' | 'chat' | 'mic' | 'camera' | 'reactions'): boolean {
  if (!channelId) return false;
  const channel = useChannels.getState().channels.find((c) => c.id === channelId);
  if (channel?.kind !== 'meeting' || channel.role !== 'member') return false;
  const rules = useMeetings.getState().settings[channelId];
  return !!rules && !rules[what];
}

/** heldBack as a hook, so buttons update when the host changes the rules. */
export function useHeldBack(channelId: string | null | undefined, what: 'share' | 'chat' | 'mic' | 'camera' | 'reactions'): boolean {
  const rules = useMeetings((s) => (channelId ? s.settings[channelId] : undefined));
  const member = useChannels((s) => {
    const c = channelId ? s.channels.find((x) => x.id === channelId) : undefined;
    return c?.kind === 'meeting' && c.role === 'member';
  });
  return member && !!rules && !rules[what];
}

/** What each held-back thing says when you try it anyway. */
export const HELD_BACK_NOTE: Record<'share' | 'chat' | 'mic' | 'camera' | 'reactions', string> = {
  share: 'Only the host and co-hosts can share their screen right now',
  chat: 'Only the host and co-hosts can send messages right now',
  mic: 'The host has turned off mics for now',
  camera: 'The host has turned off cameras for now',
  reactions: 'The host has turned off reactions for now',
};
