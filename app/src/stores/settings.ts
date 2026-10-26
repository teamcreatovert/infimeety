import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const ACCENTS = {
  blue: '#0A84FF',
  purple: '#BF5AF2',
  pink: '#FF375F',
  orange: '#FF9F0A',
  green: '#30D158',
  teal: '#40C8E0',
  graphite: '#8E8E93',
} as const;
export type Accent = keyof typeof ACCENTS;

export const WALLPAPERS = {
  aurora: ['#3a5bff', '#8f3dff', '#00c2b8'],
  sunset: ['#ff5e62', '#ff9966', '#8f3dff'],
  ocean: ['#0077ff', '#00c6ff', '#2b2dff'],
  forest: ['#1fa774', '#0f7b6c', '#7bd389'],
  graphite: ['#3a3a44', '#55555f', '#26262e'],
} as const;
export type Wallpaper = keyof typeof WALLPAPERS;

/** Bitrates are ceilings: the connection's bandwidth estimate decides what's actually sent. */
export const SCREEN_PRESETS = {
  '720p30': { label: '720p · 30 fps', width: 1280, height: 720, fps: 30, bitrate: 4_000_000 },
  '1080p30': { label: '1080p · 30 fps', width: 1920, height: 1080, fps: 30, bitrate: 8_000_000 },
  '1080p60': { label: '1080p · 60 fps', width: 1920, height: 1080, fps: 60, bitrate: 12_000_000 },
  '1440p60': { label: '1440p · 60 fps', width: 2560, height: 1440, fps: 60, bitrate: 18_000_000 },
} as const;
export type ScreenQuality = keyof typeof SCREEN_PRESETS;

export type OverlayCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface SettingsState {
  theme: 'system' | 'dark' | 'light';
  accent: Accent;
  wallpaper: Wallpaper;
  livingWallpaper: boolean;
  reduceTransparency: boolean;

  inputDeviceId: string;
  outputDeviceId: string;
  cameraDeviceId: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;

  soundsEnabled: boolean;
  soundVolume: number;
  messageSounds: boolean;

  screenQuality: ScreenQuality;
  screenMode: 'motion' | 'detail';
  shareAudio: boolean;

  /** Per-person preferences, keyed by user id (0–2 = 0–200%). */
  userVolumes: Record<string, number>;
  localMutes: Record<string, boolean>;
  streamVolumes: Record<string, number>;

  autoUpdate: boolean;

  /** Desktop: the close button hides to the tray; a who's-talking overlay while in a call. */
  closeToTray: boolean;
  overlay: boolean;
  overlayShow: 'speaking' | 'everyone';
  overlayCorner: OverlayCorner;

  /** Only on this device, never sent anywhere: DM list order and visibility, muted chats, notes. */
  pinnedDms: string[];
  closedDms: Record<string, true>;
  mutedChats: Record<string, true>;
  notes: Record<string, string>;

  set: (patch: Partial<SettingsState>) => void;
  setUserVolume: (userId: string, volume: number) => void;
  setStreamVolume: (userId: string, volume: number) => void;
  toggleLocalMute: (userId: string) => void;
  toggleDmPin: (channelId: string) => void;
  setDmClosed: (channelId: string, closed: boolean) => void;
  toggleChatMute: (channelId: string) => void;
  setNote: (userId: string, note: string) => void;
}

const without = <T,>(record: Record<string, T>, key: string) => {
  const { [key]: _, ...rest } = record;
  return rest;
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      accent: 'blue',
      wallpaper: 'aurora',
      livingWallpaper: true,
      reduceTransparency: false,

      inputDeviceId: 'default',
      outputDeviceId: 'default',
      cameraDeviceId: 'default',
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,

      soundsEnabled: true,
      soundVolume: 0.7,
      messageSounds: true,

      screenQuality: '1080p30',
      screenMode: 'motion',
      shareAudio: true,

      userVolumes: {},
      localMutes: {},
      streamVolumes: {},

      autoUpdate: true,

      closeToTray: true,
      overlay: true,
      overlayShow: 'speaking',
      overlayCorner: 'top-left',

      pinnedDms: [],
      closedDms: {},
      mutedChats: {},
      notes: {},

      set: (patch) => set(patch),
      setUserVolume: (userId, volume) => set((s) => ({ userVolumes: { ...s.userVolumes, [userId]: volume } })),
      setStreamVolume: (userId, volume) => set((s) => ({ streamVolumes: { ...s.streamVolumes, [userId]: volume } })),
      toggleLocalMute: (userId) => set((s) => ({ localMutes: { ...s.localMutes, [userId]: !s.localMutes[userId] } })),
      toggleDmPin: (id) => set((s) => ({ pinnedDms: s.pinnedDms.includes(id) ? s.pinnedDms.filter((x) => x !== id) : [...s.pinnedDms, id] })),
      setDmClosed: (id, closed) => set((s) => (closed ? { closedDms: { ...s.closedDms, [id]: true } } : s.closedDms[id] ? { closedDms: without(s.closedDms, id) } : s)),
      toggleChatMute: (id) => set((s) => ({ mutedChats: s.mutedChats[id] ? without(s.mutedChats, id) : { ...s.mutedChats, [id]: true } })),
      setNote: (userId, note) => set((s) => ({ notes: note.trim() ? { ...s.notes, [userId]: note } : without(s.notes, userId) })),
    }),
    {
      name: 'infimeety.settings',
      // Functions don't survive JSON anyway; listing them keeps the stored shape obvious.
      partialize: ({ set: _s, setUserVolume: _a, setStreamVolume: _b, toggleLocalMute: _c, toggleDmPin: _d, setDmClosed: _e, toggleChatMute: _f, setNote: _g, ...rest }) => rest,
    },
  ),
);
