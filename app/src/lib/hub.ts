import type { ClientMsg, ServerMsg } from '../../../shared/protocol';
import { getToken } from './api';
import { APP_VERSION, WS_URL } from '@/config';

export type HubStatus = 'connecting' | 'open' | 'closed';

/**
 * This window, for the server: a reconnect replaces only its own old connection, never your
 * other windows or devices. Per tab in a browser (it survives a reload), per window in the app.
 */
const clientId = (() => {
  const key = 'infimeety.client';
  try {
    const saved = sessionStorage.getItem(key);
    if (saved) return saved;
    const id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
})();

/** One realtime connection per channel, with auto-reconnect and keepalive. */
export class HubClient {
  peerId: string | null = null;
  status: HubStatus = 'connecting';
  private ws: WebSocket | null = null;
  private queue: string[] = [];
  private retry = 0;
  private closed = false;
  private ping: ReturnType<typeof setInterval> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    readonly channelId: string,
    private onMessage: (hub: HubClient, msg: ServerMsg) => void,
    private onStatus: (hub: HubClient, status: HubStatus) => void,
  ) {
    this.connect();
  }

  private setStatus(status: HubStatus) {
    this.status = status;
    this.onStatus(this, status);
  }

  private connect() {
    const token = getToken();
    if (!token || this.closed) return;
    const ws = new WebSocket(`${WS_URL}/channels/${this.channelId}/ws?v=${APP_VERSION}&client=${clientId}`, ['infimeety', token]);
    this.ws = ws;
    this.setStatus('connecting');

    ws.onopen = () => {
      this.retry = 0;
      for (const raw of this.queue) ws.send(raw);
      this.queue = [];
      this.ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('{"t":"ping"}'), 25_000);
    };
    ws.onmessage = (event) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      // Not something this version knows how to read (no type): skip it.
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
      if (msg.t === 'pong') return;
      if (msg.t === 'welcome') {
        this.peerId = msg.peerId;
        this.setStatus('open');
      }
      this.onMessage(this, msg);
    };
    ws.onclose = (event) => {
      // An older socket of ours closing after a newer one took over (4005, replaced): not news.
      if (ws !== this.ws) return;
      clearInterval(this.ping);
      this.peerId = null;
      this.setStatus('closed');
      // 4003 = removed from channel, 4004 = channel deleted: don't come back.
      if (this.closed || event.code === 4003 || event.code === 4004) return;
      const delay = Math.min(800 * 2 ** this.retry++, 15_000) + Math.random() * 400;
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
  }

  /** Chat messages queue while reconnecting; realtime signaling is dropped (it would be stale). */
  send(msg: ClientMsg) {
    const raw = JSON.stringify(msg);
    if (this.ws?.readyState === WebSocket.OPEN && this.status === 'open') this.ws.send(raw);
    else if (msg.t.startsWith('chat.')) this.queue.push(raw);
  }

  /** Reconnect immediately (e.g. when the network comes back). */
  nudge() {
    if (this.status !== 'closed' || this.closed) return;
    clearTimeout(this.reconnectTimer);
    this.retry = 0;
    this.connect();
  }

  close() {
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.ping);
    this.ws?.close(1000);
  }
}
