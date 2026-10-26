import { create } from 'zustand';

/** `waiting`: the sender is busy sending to others; `saving`: received, being put in place (a folder unpacks). */
export type MediaStatus = 'idle' | 'requesting' | 'waiting' | 'loading' | 'saving' | 'ready' | 'offline' | 'gone' | 'error';

export interface MediaEntry {
  status: MediaStatus;
  progress: number;
  url?: string;
  /** A file received into memory. */
  blob?: Blob;
  /** Copies: bytes per second, where it's being saved, and its id here once saved (to show it). */
  speed?: number;
  where?: string;
  savedId?: string;
  /** Why it failed, when there's more to say than "couldn't". */
  problem?: string;
  /** Owner's own file, served straight from disk. */
  local?: boolean;
}

interface MediaState {
  items: Record<string, MediaEntry>;
  setEntry: (id: string, entry: Partial<MediaEntry>) => void;
  revoke: (ids: string[]) => void;
}

/** In-memory only: viewers never write anyone's media to disk. */
export const useMedia = create<MediaState>()((set) => ({
  items: {},
  setEntry: (id, entry) =>
    set((s) => ({ items: { ...s.items, [id]: { ...(s.items[id] ?? { status: 'idle', progress: 0 }), ...entry } } })),
  revoke: (ids) =>
    set((s) => {
      const items = { ...s.items };
      for (const id of ids) {
        const url = items[id]?.url;
        if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
        items[id] = { status: 'gone', progress: 0 };
      }
      return { items };
    }),
}));
