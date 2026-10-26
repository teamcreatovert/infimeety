import { create } from 'zustand';
import { isCompactNow } from '@/lib/responsive';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  title: string;
  body?: string;
}

export type SettingsTab = 'account' | 'voice' | 'screen' | 'files' | 'appearance' | 'sounds' | 'desktop' | 'updates';

/** Where someone was right-clicked; decides which actions their menu offers. */
export type UserMenuContext = { kind: 'voice'; channelId: string; peerId: string } | { kind: 'dm'; channelId: string } | { kind: 'member'; channelId?: string };

interface UIState {
  settingsTab: SettingsTab | null;
  createChannel: 'create' | 'join' | null;
  channelSettings: string | null;
  /** Channel id whose "Invite friends" sheet is open. */
  inviteTo: string | null;
  /** Invite code opened from a link, waiting for the user to confirm joining. */
  pendingInvite: string | null;
  lightbox: { src: string; kind: 'image' | 'video'; name: string } | null;
  memberList: boolean;
  /** Side chat inside a voice room. */
  voiceChat: boolean;
  /** Screen share shown full-stage ("theater"), by peer id. */
  focusedPeer: string | null;
  /** Full screen watching: hides the sidebars entirely. */
  immersive: boolean;
  /** Watch mode's layout when not full screen. */
  watchLayout: 'theater' | 'mini';
  /** Showing the room's watch party (rather than the call grid) while one runs. */
  partyView: boolean;
  /** Watch mode folds the channel list away (desktop); a button brings it back. */
  navCollapsed: boolean;
  /** The call's side panel tab. */
  sideTab: 'chat' | 'people' | 'party';
  /** You closed the music player for yourself (the music goes on for the others). */
  musicHidden: boolean;
  /** The watch party planner: for a new party in a channel (optionally a given voice room), or `edit` the room's party. */
  partyPlanner: { channelId: string; roomId?: string; edit?: boolean } | null;
  userMenu: { userId: string; x: number; y: number; context: UserMenuContext } | null;
  profileCard: { userId: string; x: number; y: number; focusNote?: boolean } | null;
  /** Text for the visible message box to insert, e.g. an @mention picked from a menu. */
  composerInsert: { text: string; at: number } | null;
  /** Phones show one pane at a time: the channel list (true) or what's open in it (false). */
  mobileNav: boolean;
  /** Touch screens: the message whose actions (react, reply…) are showing after a tap. */
  touchedMessage: string | null;
  toasts: Toast[];

  set: (patch: Partial<UIState>) => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

let nextToast = 1;

export const useUI = create<UIState>()((set) => ({
  settingsTab: null,
  createChannel: null,
  channelSettings: null,
  inviteTo: null,
  pendingInvite: null,
  lightbox: null,
  memberList: !isCompactNow(),
  voiceChat: false,
  focusedPeer: null,
  immersive: false,
  watchLayout: 'theater',
  partyView: true,
  navCollapsed: false,
  sideTab: 'chat',
  musicHidden: false,
  partyPlanner: null,
  userMenu: null,
  profileCard: null,
  composerInsert: null,
  mobileNav: true,
  touchedMessage: null,
  toasts: [],

  set: (patch) => set(patch),
  toast: (t) => {
    const id = nextToast++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.kind === 'error' ? 5200 : 3400);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = (t: Omit<Toast, 'id'>) => useUI.getState().toast(t);

/** Phones: switch from the channel list to what was just opened. */
export const showMain = () => useUI.getState().set({ mobileNav: false });

/** Right-click on a person anywhere: avatar rows, voice tiles, DMs, chat. */
export function openUserMenu(e: React.MouseEvent, userId: string | undefined, context: UserMenuContext) {
  e.preventDefault();
  e.stopPropagation();
  if (userId) useUI.getState().set({ userMenu: { userId, x: e.clientX, y: e.clientY, context }, profileCard: null });
}

export function openProfile(e: React.MouseEvent, userId: string | undefined) {
  e.stopPropagation();
  if (userId) useUI.getState().set({ profileCard: { userId, x: e.clientX, y: e.clientY }, userMenu: null });
}
