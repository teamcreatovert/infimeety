import { create } from 'zustand';
import type { Channel, Member, PublicUser, Role, Room, VoiceSnapshot } from '../../../shared/protocol';

/** An AI bot, as GET /channels/:id/bots lists it. */
export type Bot = PublicUser & { bot: true; instructions: string; builtIn: boolean };
import { api } from '@/lib/api';
import type { HubStatus } from '@/lib/hub';

const SELECTION_KEY = 'infimeety.selection';
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(SELECTION_KEY) ?? '{}') as { channel?: string; rooms?: Record<string, string> };
  } catch {
    return {};
  }
})();

interface ChannelsState {
  channels: Channel[];
  loaded: boolean;
  activeChannelId: string | null;
  activeRoom: Record<string, string>;
  members: Record<string, Member[]>;
  /** Each channel's AI bots (Nova and the admins' own), for names in chat and settings. */
  bots: Record<string, Bot[]>;
  /** Every user we've seen, for resolving names/avatars in messages. */
  users: Record<string, PublicUser>;
  online: Record<string, string[]>;
  voice: Record<string, VoiceSnapshot>;
  hubStatus: Record<string, HubStatus>;
  /** roomId → userId → expiry timestamp */
  typing: Record<string, Record<string, number>>;

  load: () => Promise<void>;
  refresh: (channelId: string) => Promise<void>;
  select: (channelId: string | null) => void;
  selectRoom: (channelId: string, roomId: string) => void;
  create: (input: { name: string; emoji: string; color: string }) => Promise<Channel>;
  join: (code: string) => Promise<Channel>;
  /** Open (creating if needed) the DM with a friend and switch to it. */
  openDm: (userId: string) => Promise<Channel>;
  /** Same, without switching to it. */
  ensureDm: (userId: string) => Promise<Channel>;
  update: (channelId: string, patch: Partial<Pick<Channel, 'name' | 'emoji' | 'color'>>) => Promise<void>;
  removeLocal: (channelId: string) => void;
  loadMembers: (channelId: string) => Promise<void>;
  addRoom: (channelId: string, kind: Room['kind'], name: string) => Promise<Room>;
  renameRoom: (channelId: string, roomId: string, name: string) => Promise<void>;
  deleteRoom: (channelId: string, roomId: string) => Promise<void>;
  /** Admins: watch parties on or off in a voice room (ending one that's running). */
  setRoomParty: (channelId: string, roomId: string, allowParty: boolean) => Promise<void>;
  /** Admins: move a room into a category (null: out of it), or set a chat room's slow mode (seconds). */
  setRoom: (channelId: string, roomId: string, patch: { categoryId?: string | null; slowMode?: number; viewRole?: Role; postRole?: Role }) => Promise<void>;
  addCategory: (channelId: string, name: string) => Promise<void>;
  renameCategory: (channelId: string, categoryId: string, name: string) => Promise<void>;
  /** Moves a category one place up (-1) or down (1). */
  moveCategory: (channelId: string, categoryId: string, by: -1 | 1) => Promise<void>;
  /** Its rooms stay, back in the plain lists. */
  deleteCategory: (channelId: string, categoryId: string) => Promise<void>;
  /** Uploads a channel picture (a prepared image), or removes it with null. */
  setIcon: (channelId: string, image: { body: Blob; type: string } | null) => Promise<void>;
  upsertUser: (user: PublicUser) => void;
  setTyping: (roomId: string, userId: string) => void;
  set: (patch: Partial<ChannelsState>) => void;
}

function persistSelection(s: Pick<ChannelsState, 'activeChannelId' | 'activeRoom'>) {
  localStorage.setItem(SELECTION_KEY, JSON.stringify({ channel: s.activeChannelId, rooms: s.activeRoom }));
}

export const useChannels = create<ChannelsState>()((set, get) => ({
  channels: [],
  loaded: false,
  activeChannelId: saved.channel ?? null,
  activeRoom: saved.rooms ?? {},
  members: {},
  bots: {},
  users: {},
  online: {},
  voice: {},
  hubStatus: {},
  typing: {},

  async load() {
    const channels = await api<Channel[]>('/channels');
    // `null` means Home (friends + DMs).
    const active = channels.find((c) => c.id === get().activeChannelId)?.id ?? null;
    set({ channels, loaded: true, activeChannelId: active });
    await Promise.all(channels.map((c) => get().loadMembers(c.id)));
  },

  async refresh(channelId) {
    const channels = await api<Channel[]>('/channels');
    const stillMember = channels.some((c) => c.id === channelId);
    set({ channels });
    if (!stillMember) return get().removeLocal(channelId);
    await get().loadMembers(channelId);
  },

  select(channelId) {
    set({ activeChannelId: channelId });
    persistSelection(get());
  },

  selectRoom(channelId, roomId) {
    set((s) => ({ activeChannelId: channelId, activeRoom: { ...s.activeRoom, [channelId]: roomId } }));
    persistSelection(get());
  },

  async create(input) {
    const channel = await api<Channel>('/channels', { method: 'POST', json: input });
    set((s) => ({ channels: [...s.channels, channel], activeChannelId: channel.id }));
    persistSelection(get());
    await get().loadMembers(channel.id);
    return channel;
  },

  async join(code) {
    const channel = await api<Channel>('/channels/join', { method: 'POST', json: { code } });
    set((s) => ({
      channels: s.channels.some((c) => c.id === channel.id) ? s.channels : [...s.channels, channel],
      activeChannelId: channel.id,
    }));
    persistSelection(get());
    await get().loadMembers(channel.id);
    return channel;
  },

  async ensureDm(userId) {
    const dm = await api<Channel>('/dms', { method: 'POST', json: { userId } });
    set((s) => ({ channels: s.channels.some((c) => c.id === dm.id) ? s.channels.map((c) => (c.id === dm.id ? dm : c)) : [...s.channels, dm] }));
    await get().loadMembers(dm.id);
    return dm;
  },

  async openDm(userId) {
    const dm = await get().ensureDm(userId);
    get().select(dm.id);
    return dm;
  },

  async update(channelId, patch) {
    const channel = await api<Channel>(`/channels/${channelId}`, { method: 'PATCH', json: patch });
    set((s) => ({ channels: s.channels.map((c) => (c.id === channelId ? channel : c)) }));
  },

  removeLocal(channelId) {
    set((s) => {
      const channels = s.channels.filter((c) => c.id !== channelId);
      return {
        channels,
        activeChannelId: s.activeChannelId === channelId ? null : s.activeChannelId,
      };
    });
    persistSelection(get());
  },

  async loadMembers(channelId) {
    // Bots are loaded alongside; an older server without them just has none.
    const [members, bots] = await Promise.all([api<Member[]>(`/channels/${channelId}/members`), api<Bot[]>(`/channels/${channelId}/bots`).catch(() => [] as Bot[])]);
    set((s) => {
      const users = { ...s.users };
      for (const m of members) users[m.id] = { id: m.id, name: m.name, username: m.username, avatarUrl: m.avatarUrl, ...(m.guest ? { guest: true } : {}) };
      for (const b of bots) users[b.id] = { id: b.id, name: b.name, username: null, avatarUrl: null, bot: true };
      return { members: { ...s.members, [channelId]: members }, bots: { ...s.bots, [channelId]: bots }, users };
    });
  },

  async renameRoom(channelId, roomId, name) {
    await api(`/channels/${channelId}/rooms/${roomId}`, { method: 'PATCH', json: { name } });
    // Text rooms come back lower-cased with dashes; reload to show exactly what was saved.
    const [channel] = (await api<Channel[]>('/channels')).filter((c) => c.id === channelId);
    if (channel) set((s) => ({ channels: s.channels.map((c) => (c.id === channelId ? channel : c)) }));
  },

  async setRoom(channelId, roomId, patch) {
    set((s) => ({
      channels: s.channels.map((c) => (c.id === channelId ? { ...c, rooms: c.rooms.map((r) => (r.id === roomId ? { ...r, ...patch } : r)) } : c)),
    }));
    try {
      await api(`/channels/${channelId}/rooms/${roomId}`, { method: 'PATCH', json: patch });
    } finally {
      await reloadChannel(channelId);
    }
  },

  async addCategory(channelId, name) {
    await api(`/channels/${channelId}/categories`, { method: 'POST', json: { name } });
    await reloadChannel(channelId);
  },

  async renameCategory(channelId, categoryId, name) {
    await api(`/channels/${channelId}/categories/${categoryId}`, { method: 'PATCH', json: { name } });
    await reloadChannel(channelId);
  },

  async moveCategory(channelId, categoryId, by) {
    const list = [...(get().channels.find((c) => c.id === channelId)?.categories ?? [])];
    const at = list.findIndex((k) => k.id === categoryId);
    const to = at + by;
    if (at < 0 || to < 0 || to >= list.length) return;
    [list[at], list[to]] = [list[to], list[at]];
    // Number them 0, 1, 2… in the new order (older categories may share a position).
    await Promise.all(
      list.map((k, i) => (k.position === i ? null : api(`/channels/${channelId}/categories/${k.id}`, { method: 'PATCH', json: { position: i } }))),
    );
    await reloadChannel(channelId);
  },

  async deleteCategory(channelId, categoryId) {
    await api(`/channels/${channelId}/categories/${categoryId}`, { method: 'DELETE' });
    await reloadChannel(channelId);
  },

  async setRoomParty(channelId, roomId, allowParty) {
    const patch = (allow: boolean) =>
      set((s) => ({
        channels: s.channels.map((c) => (c.id === channelId ? { ...c, rooms: c.rooms.map((r) => (r.id === roomId ? { ...r, allowParty: allow } : r)) } : c)),
      }));
    patch(allowParty);
    try {
      await api(`/channels/${channelId}/rooms/${roomId}`, { method: 'PATCH', json: { allowParty } });
    } catch (err) {
      patch(!allowParty);
      throw err;
    }
  },

  async deleteRoom(channelId, roomId) {
    await api(`/channels/${channelId}/rooms/${roomId}`, { method: 'DELETE' });
    set((s) => {
      const channels = s.channels.map((c) => (c.id === channelId ? { ...c, rooms: c.rooms.filter((r) => r.id !== roomId) } : c));
      const activeRoom = { ...s.activeRoom };
      if (activeRoom[channelId] === roomId) delete activeRoom[channelId];
      return { channels, activeRoom };
    });
    persistSelection(get());
  },

  async setIcon(channelId, image) {
    const channel = image
      ? await api<Channel>(`/channels/${channelId}/icon`, { method: 'PUT', body: image.body, headers: { 'Content-Type': image.type } })
      : await api<Channel>(`/channels/${channelId}/icon`, { method: 'DELETE' });
    set((s) => ({ channels: s.channels.map((c) => (c.id === channelId ? channel : c)) }));
  },

  async addRoom(channelId, kind, name) {
    const room = await api<Room>(`/channels/${channelId}/rooms`, { method: 'POST', json: { kind, name } });
    set((s) => ({
      channels: s.channels.map((c) => (c.id === channelId && !c.rooms.some((r) => r.id === room.id) ? { ...c, rooms: [...c.rooms, room] } : c)),
    }));
    return room;
  },

  upsertUser(user) {
    set((s) => ({
      users: { ...s.users, [user.id]: user },
      members: Object.fromEntries(
        Object.entries(s.members).map(([cid, list]) => [cid, list.map((m) => (m.id === user.id ? { ...m, ...user } : m))]),
      ),
    }));
  },

  setTyping(roomId, userId) {
    set((s) => ({ typing: { ...s.typing, [roomId]: { ...s.typing[roomId], [userId]: Date.now() + 4000 } } }));
  },

  set: (patch) => set(patch),
}));

export function useActiveChannel() {
  return useChannels((s) => s.channels.find((c) => c.id === s.activeChannelId) ?? null);
}

export function useActiveRoom() {
  return useChannels((s) => {
    const channel = s.channels.find((c) => c.id === s.activeChannelId);
    if (!channel) return null;
    const chosen = s.activeRoom[channel.id];
    return channel.rooms.find((r) => r.id === chosen) ?? channel.rooms.find((r) => r.kind === 'text') ?? channel.rooms[0] ?? null;
  });
}

/** Shows exactly what the server saved for one channel. */
async function reloadChannel(channelId: string) {
  const channel = (await api<Channel[]>('/channels')).find((c) => c.id === channelId);
  if (channel) useChannels.setState((s) => ({ channels: s.channels.map((c) => (c.id === channelId ? channel : c)) }));
}
