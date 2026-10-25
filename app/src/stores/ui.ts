import { create } from 'zustand';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  title: string;
  body?: string;
}

export type SettingsTab = 'account' | 'voice' | 'screen' | 'appearance' | 'sounds' | 'updates';

export interface Bubble {
  x: number;
  y: number;
  mini: boolean;
  /** Set once the user has placed the bubble themselves. */
  dragged?: boolean;
}

interface UIState {
  settingsTab: SettingsTab | null;
  createChannel: 'create' | 'join' | null;
  channelSettings: string | null;
  lightbox: { src: string; kind: 'image' | 'video'; name: string } | null;
  memberList: boolean;
  /** Side chat inside a voice room. */
  voiceChat: boolean;
  /** Screen share shown full-stage ("theater"), by peer id. */
  focusedPeer: string | null;
  /** Theater + fullscreen: hides the sidebars entirely. */
  immersive: boolean;
  bubbles: Record<string, Bubble>;
  bubblesHidden: boolean;
  participantMenu: { channelId: string; peerId: string; userId: string; x: number; y: number } | null;
  toasts: Toast[];

  set: (patch: Partial<UIState>) => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
  setBubble: (peerId: string, b: Partial<Bubble>) => void;
}

let nextToast = 1;

export const useUI = create<UIState>()((set) => ({
  settingsTab: null,
  createChannel: null,
  channelSettings: null,
  lightbox: null,
  memberList: true,
  voiceChat: false,
  focusedPeer: null,
  immersive: false,
  bubbles: {},
  bubblesHidden: false,
  participantMenu: null,
  toasts: [],

  set: (patch) => set(patch),
  toast: (t) => {
    const id = nextToast++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.kind === 'error' ? 5200 : 3400);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  setBubble: (peerId, b) =>
    set((s) => ({ bubbles: { ...s.bubbles, [peerId]: { ...(s.bubbles[peerId] ?? { x: 0, y: 0, mini: false }), ...b } } })),
}));

export const toast = (t: Omit<Toast, 'id'>) => useUI.getState().toast(t);
