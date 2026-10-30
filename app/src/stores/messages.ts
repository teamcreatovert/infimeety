import { create } from 'zustand';
import type { Attachment, Message } from '../../../shared/protocol';
import { api, randomId } from '@/lib/api';
import { cleanMessages } from '@/lib/sanitize';

export interface LocalMessage extends Message {
  /** Optimistic message waiting for the server echo. */
  pending?: boolean;
  nonce?: string;
}

interface RoomState {
  items: LocalMessage[];
  loading: boolean;
  loaded: boolean;
  hasMore: boolean;
}

interface MessagesState {
  rooms: Record<string, RoomState>;
  unread: Record<string, number>;
  load: (channelId: string, roomId: string) => Promise<void>;
  loadOlder: (channelId: string, roomId: string) => Promise<void>;
  addPending: (roomId: string, userId: string, content: string, attachments: Attachment[], replyTo: string | null) => string;
  receive: (msg: Message, nonce?: string) => void;
  patch: (roomId: string, id: string, patch: Partial<Message>) => void;
  remove: (roomId: string, id: string) => void;
  markRead: (roomId: string) => void;
  bumpUnread: (roomId: string) => void;
}

const empty: RoomState = { items: [], loading: false, loaded: false, hasMore: true };

export const useMessages = create<MessagesState>()((set, get) => {
  const update = (roomId: string, fn: (r: RoomState) => Partial<RoomState>) =>
    set((s) => {
      const room = s.rooms[roomId] ?? empty;
      return { rooms: { ...s.rooms, [roomId]: { ...room, ...fn(room) } } };
    });

  return {
    rooms: {},
    unread: {},

    async load(channelId, roomId) {
      const room = get().rooms[roomId];
      if (room?.loaded || room?.loading) return;
      update(roomId, () => ({ loading: true }));
      try {
        const items = cleanMessages(await api<unknown>(`/channels/${channelId}/rooms/${roomId}/messages?limit=50`));
        update(roomId, (r) => {
          // Keep anything that arrived over the socket while we were loading.
          const known = new Set(items.map((m) => m.id));
          const live = r.items.filter((m) => !known.has(m.id));
          return { items: [...items, ...live], loaded: true, loading: false, hasMore: items.length === 50 };
        });
      } catch {
        update(roomId, () => ({ loading: false }));
      }
    },

    async loadOlder(channelId, roomId) {
      const room = get().rooms[roomId];
      if (!room || room.loading || !room.hasMore) return;
      const oldest = room.items.find((m) => !m.pending);
      if (!oldest) return;
      update(roomId, () => ({ loading: true }));
      try {
        const older = cleanMessages(await api<unknown>(`/channels/${channelId}/rooms/${roomId}/messages?limit=50&before=${oldest.id}`));
        update(roomId, (r) => ({ items: [...older, ...r.items], loading: false, hasMore: older.length === 50 }));
      } catch {
        update(roomId, () => ({ loading: false }));
      }
    },

    addPending(roomId, userId, content, attachments, replyTo) {
      const nonce = randomId(9);
      const msg: LocalMessage = {
        id: `~${nonce}`,
        nonce,
        pending: true,
        roomId,
        userId,
        content,
        attachments,
        replyTo,
        reactions: {},
        createdAt: Date.now(),
        editedAt: null,
      };
      update(roomId, (r) => ({ items: [...r.items, msg] }));
      return nonce;
    },

    receive(msg, nonce) {
      update(msg.roomId, (r) => {
        if (r.items.some((m) => m.id === msg.id)) return {};
        const idx = nonce ? r.items.findIndex((m) => m.nonce === nonce) : -1;
        if (idx >= 0) {
          const items = r.items.slice();
          items[idx] = msg;
          return { items };
        }
        return { items: [...r.items, msg] };
      });
    },

    patch(roomId, id, patch) {
      update(roomId, (r) => ({ items: r.items.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
    },

    remove(roomId, id) {
      update(roomId, (r) => ({ items: r.items.filter((m) => m.id !== id) }));
    },

    markRead(roomId) {
      if (get().unread[roomId]) set((s) => ({ unread: { ...s.unread, [roomId]: 0 } }));
    },

    bumpUnread(roomId) {
      set((s) => ({ unread: { ...s.unread, [roomId]: (s.unread[roomId] ?? 0) + 1 } }));
    },
  };
});
