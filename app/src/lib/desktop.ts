import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from './platform';
import { voice } from './voice/engine';
import { useChannels } from '@/stores/channels';
import { useSettings, type OverlayCorner } from '@/stores/settings';
import { useVoice } from '@/stores/voice';

export interface OverlayPerson {
  peerId: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  speaking: boolean;
  muted: boolean;
}

/** What the overlay window draws. Sent from here; the overlay keeps no state of its own. */
export interface OverlayState {
  /** False while Infimeety itself is in front: the overlay is for when you're elsewhere. */
  visible: boolean;
  corner: OverlayCorner;
  show: 'speaking' | 'everyone';
  people: OverlayPerson[];
}

function overlayState(focused: boolean): OverlayState {
  const v = useVoice.getState();
  const { voice: snapshots, users } = useChannels.getState();
  const s = useSettings.getState();
  const me = voice.peerId;
  const people = (v.channelId ? (snapshots[v.channelId]?.participants ?? []) : [])
    .filter((p) => p.roomId === v.roomId)
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((p) => ({
      peerId: p.peerId,
      userId: p.userId,
      name: users[p.userId]?.name ?? 'Someone',
      avatarUrl: users[p.userId]?.avatarUrl ?? null,
      speaking: !!(p.peerId === me ? v.speaking.self : v.speaking[p.peerId]),
      muted: p.muted || p.deafened || p.serverMuted,
    }));
  return { visible: !focused, corner: s.overlayCorner, show: s.overlayShow, people };
}

/**
 * Desktop-only behaviour: tells Rust whether closing hides to the tray, and runs the
 * who's-talking overlay window for as long as you're in a call.
 */
export function startDesktop() {
  if (!isTauri) return;

  const syncTray = () => void invoke('set_close_to_tray', { enabled: useSettings.getState().closeToTray }).catch(() => {});
  syncTray();

  let focused = document.hasFocus();
  let openCorner: OverlayCorner | null = null;
  let sent = '';

  const sync = () => {
    const s = useSettings.getState();
    const want = s.overlay && useVoice.getState().roomId !== null;
    if (!want) {
      if (openCorner) void invoke('overlay_close').catch(() => {});
      openCorner = null;
      sent = '';
      return;
    }
    if (openCorner !== s.overlayCorner) {
      openCorner = s.overlayCorner;
      void invoke('overlay_open', { corner: openCorner }).catch(() => (openCorner = null));
    }
    const state = overlayState(focused);
    const json = JSON.stringify(state);
    if (json === sent) return;
    sent = json;
    void emitTo('overlay', 'overlay:state', state).catch(() => {});
  };

  useSettings.subscribe((s, prev) => {
    if (s.closeToTray !== prev.closeToTray) syncTray();
    sync();
  });
  useVoice.subscribe(sync);
  useChannels.subscribe(sync);
  void getCurrentWindow().onFocusChanged(({ payload }) => {
    focused = payload;
    sync();
  });
  // A freshly opened overlay missed everything sent before its page loaded.
  void listen('overlay:ready', () => {
    sent = '';
    sync();
  });
}
