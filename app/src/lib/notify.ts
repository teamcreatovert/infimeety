import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { appWindow, isTauri, isWindows } from './platform';
import { useChannels } from '@/stores/channels';
import { useMessages } from '@/stores/messages';
import { useSettings } from '@/stores/settings';

/**
 * The desktop app, like Discord: a red badge with your unread count on the taskbar (Windows)
 * or Dock (Mac) icon, the taskbar button flashing for a new message, and a pop-up for
 * messages and calls while Infimeety isn't the window in front. Muted chats stay quiet.
 * Nothing moves the window on its own (a game keeps the screen); clicking a pop-up brings
 * Infimeety up on that chat.
 */

const mutedRooms = () => {
  const muted = useSettings.getState().mutedChats;
  return new Set(useChannels.getState().channels.flatMap((c) => (muted[c.id] ? c.rooms.map((r) => r.id) : [])));
};

let shown = -1;
async function badge() {
  const muted = mutedRooms();
  const count = Object.entries(useMessages.getState().unread).reduce((n, [room, k]) => (muted.has(room) ? n : n + k), 0);
  if (count === shown) return;
  shown = count;
  const win = getCurrentWindow();
  if (!isWindows) return void win.setBadgeCount(count || undefined).catch(() => {});
  if (!count) return void win.setOverlayIcon(undefined).catch(() => {});
  // Windows draws a small picture over the taskbar icon: a red dot with the count.
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f23f43';
  g.beginPath();
  g.arc(16, 16, 16, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = `bold ${count > 9 ? 16 : 20}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(count > 9 ? '9+' : String(count), 16, 17);
  const png = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  if (png) await win.setOverlayIcon(new Uint8Array(await png.arrayBuffer())).catch(() => {});
}

export function startNotifications() {
  if (!isTauri) return;
  useMessages.subscribe((s, prev) => s.unread !== prev.unread && void badge());
  useSettings.subscribe((s, prev) => s.mutedChats !== prev.mutedChats && void badge());
  // A pop-up was clicked: open its chat ("channelId" or "channelId:roomId").
  void listen<string>('notification-click', ({ payload }) => {
    const [channelId, roomId] = payload.split(':');
    const channels = useChannels.getState();
    if (!channels.channels.some((c) => c.id === channelId)) return;
    channels.select(channelId);
    if (roomId) channels.selectRoom(channelId, roomId);
  });
}

/** A pop-up, only while Infimeety isn't the window in front. `target` is the chat a click opens. */
export async function notify(title: string, body: string, target = '') {
  if (!isTauri || (await getCurrentWindow().isFocused().catch(() => false))) return;
  // Windows: Infimeety's own pop-up, which can open the chat when clicked.
  if (isWindows && (await invoke<boolean>('notify', { title, body, target }).catch(() => false))) return;
  try {
    const n = await import('@tauri-apps/plugin-notification');
    const ok = (await n.isPermissionGranted()) || (await n.requestPermission()) === 'granted';
    if (ok) n.sendNotification({ title, body });
  } catch {
    /* notifications switched off in Windows */
  }
}

export function notifyMessage(channelId: string, m: { userId: string; roomId: string; content: string; attachments?: unknown[] }) {
  if (!isTauri || useSettings.getState().mutedChats[channelId]) return;
  const { channels, members } = useChannels.getState();
  const ch = channels.find((c) => c.id === channelId);
  const author = members[channelId]?.find((u) => u.id === m.userId)?.name ?? (ch?.kind === 'dm' ? ch.peer?.name : undefined) ?? 'Someone';
  // Where it was sent: "Abdul" for a direct message, "Abdul in Movie Club › #general" otherwise.
  const room = ch?.rooms.find((r) => r.id === m.roomId);
  const title = ch?.kind === 'dm' || !ch ? author : `${author} in ${ch.name}${room ? ` › #${room.name}` : ''}`;
  const body = m.content.trim() || (m.attachments?.length ? 'Sent a file' : 'Sent a message');
  void appWindow.attention();
  void notify(title, body.length > 180 ? `${body.slice(0, 180)}…` : body, `${channelId}:${m.roomId}`);
}
