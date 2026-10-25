import { create } from 'zustand';
import type { Friend } from '../../../shared/protocol';
import { api } from '@/lib/api';

interface FriendsState {
  friends: Friend[];
  /** userId → online */
  online: Record<string, boolean>;
  loaded: boolean;
  load: () => Promise<void>;
  add: (username: string) => Promise<Friend>;
  accept: (userId: string) => Promise<void>;
  remove: (userId: string) => Promise<void>;
  upsert: (friend: Friend) => void;
  removeLocal: (userId: string) => void;
  setOnline: (ids: string[]) => void;
  setPresence: (userId: string, online: boolean) => void;
  reset: () => void;
}

export const useFriends = create<FriendsState>()((set, get) => ({
  friends: [],
  online: {},
  loaded: false,

  async load() {
    const { friends, online } = await api<{ friends: Friend[]; online: string[] }>('/friends');
    set({ friends, online: Object.fromEntries(online.map((id) => [id, true])), loaded: true });
  },

  async add(username) {
    const { friend } = await api<{ friend: Friend }>('/friends', { method: 'POST', json: { username } });
    get().upsert(friend);
    return friend;
  },

  async accept(userId) {
    const { friend } = await api<{ friend: Friend }>(`/friends/${userId}/accept`, { method: 'POST' });
    get().upsert(friend);
  },

  async remove(userId) {
    await api(`/friends/${userId}`, { method: 'DELETE' });
    get().removeLocal(userId);
  },

  upsert(friend) {
    set((s) => ({ friends: [...s.friends.filter((f) => f.user.id !== friend.user.id), friend] }));
  },

  removeLocal(userId) {
    set((s) => ({ friends: s.friends.filter((f) => f.user.id !== userId) }));
  },

  setOnline(ids) {
    set({ online: Object.fromEntries(ids.map((id) => [id, true])) });
  },

  setPresence(userId, online) {
    set((s) => ({ online: { ...s.online, [userId]: online } }));
  },

  reset() {
    set({ friends: [], online: {}, loaded: false });
  },
}));
