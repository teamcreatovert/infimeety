import type { LobbyMsg } from '../../../shared/protocol';
import { getToken } from './api';
import { sounds } from './sounds';
import { WS_URL } from '@/config';
import { useChannels } from '@/stores/channels';
import { useFriends } from '@/stores/friends';
import { toast } from '@/stores/ui';

/**
 * The per-user socket: friends' presence, friend requests and new DMs arrive here.
 * One per signed-in client; reconnects with backoff like the channel hubs.
 */
let ws: WebSocket | null = null;
let closed = true;
let retry = 0;
let ping: ReturnType<typeof setInterval> | undefined;
let reconnect: ReturnType<typeof setTimeout> | undefined;

export function connectLobby() {
  closed = false;
  open();
}

export function disconnectLobby() {
  closed = true;
  clearTimeout(reconnect);
  clearInterval(ping);
  ws?.close(1000);
  ws = null;
}

function open() {
  const token = getToken();
  if (!token || closed) return;
  const socket = new WebSocket(`${WS_URL}/me/ws`, ['infimeety', token]);
  ws = socket;
  socket.onopen = () => {
    retry = 0;
    ping = setInterval(() => socket.readyState === WebSocket.OPEN && socket.send('{"t":"ping"}'), 25_000);
    // Anything missed while disconnected (requests, accepted invites) comes with a fresh load.
    void useFriends.getState().load().catch(() => {});
  };
  socket.onmessage = (e) => {
    try {
      handle(JSON.parse(e.data) as LobbyMsg);
    } catch {
      /* ignore malformed frames */
    }
  };
  socket.onclose = () => {
    clearInterval(ping);
    if (closed) return;
    const delay = Math.min(800 * 2 ** retry++, 15_000) + Math.random() * 400;
    reconnect = setTimeout(open, delay);
  };
}

function handle(msg: LobbyMsg) {
  const friends = useFriends.getState();
  switch (msg.t) {
    case 'lobby.welcome':
      return friends.setOnline(msg.online);
    case 'friend.presence':
      return friends.setPresence(msg.userId, msg.online);
    case 'friend.upsert': {
      const before = friends.friends.find((f) => f.user.id === msg.friend.user.id);
      friends.upsert(msg.friend);
      if (msg.friend.status === 'incoming' && !before) {
        sounds.message();
        toast({ kind: 'info', title: `${msg.friend.user.name} sent you a friend request`, body: 'Open Friends to accept it.' });
      } else if (msg.friend.status === 'accepted' && before?.status === 'outgoing') {
        sounds.pop();
        toast({ kind: 'success', title: `You and ${msg.friend.user.name} are now friends` });
      }
      return;
    }
    case 'friend.removed':
      return friends.removeLocal(msg.userId);
    case 'channel.added':
      return void useChannels.getState().refresh(msg.channelId).catch(() => {});
  }
}

window.addEventListener('online', () => {
  if (!closed && ws?.readyState !== WebSocket.OPEN) {
    clearTimeout(reconnect);
    retry = 0;
    open();
  }
});

// Sockets can't be hot-swapped; reload the page in dev instead of duplicating them.
import.meta.hot?.accept(() => location.reload());
