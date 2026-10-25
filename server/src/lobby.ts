import { DurableObject } from 'cloudflare:workers';
import type { LobbyMsg } from '../../shared/protocol';
import type { Env } from './util';

/**
 * One global hub that every signed-in client keeps a socket to. It tracks who is online,
 * tells friends when that changes, and delivers per-user notifications (friend requests,
 * new DMs). Uses WebSocket hibernation, so it costs nothing while idle.
 */
export class Lobby extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  async fetch(req: Request): Promise<Response> {
    const userId = req.headers.get('X-Infimeety-User');
    if (!userId) return new Response('Bad request', { status: 400 });
    const [client, server] = Object.values(new WebSocketPair());
    const wasOnline = this.isOnline(userId);
    this.ctx.acceptWebSocket(server, [userId]);

    const friends = await this.friendIds(userId);
    this.send(server, { t: 'lobby.welcome', online: friends.filter((f) => this.isOnline(f)) });
    if (!wasOnline) this.tellAll(friends, { t: 'friend.presence', userId, online: true });

    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': 'infimeety' } });
  }

  // ─── RPC from the Worker ─────────────────────────────────────────────────────

  async notify(userId: string, msg: LobbyMsg) {
    this.tellAll([userId], msg);
  }

  async onlineAmong(userIds: string[]) {
    return userIds.filter((id) => this.isOnline(id));
  }

  // ─── WebSocket events ────────────────────────────────────────────────────────

  async webSocketMessage() {
    // Clients only send pings, which the auto-response answers without waking us.
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    await this.dropped(ws);
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket) {
    await this.dropped(ws);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async dropped(ws: WebSocket) {
    const [userId] = this.ctx.getTags(ws);
    if (!userId || this.isOnline(userId, ws)) return;
    this.tellAll(await this.friendIds(userId), { t: 'friend.presence', userId, online: false });
  }

  private isOnline(userId: string, except?: WebSocket) {
    return this.ctx.getWebSockets(userId).some((s) => s !== except && s.readyState === 1);
  }

  private async friendIds(userId: string) {
    const { results } = await this.env.DB.prepare(
      `SELECT CASE WHEN user_a = ?1 THEN user_b ELSE user_a END AS id
       FROM friendships WHERE (user_a = ?1 OR user_b = ?1) AND status = 'accepted'`,
    )
      .bind(userId)
      .all<{ id: string }>();
    return results.map((r) => r.id);
  }

  private tellAll(userIds: string[], msg: LobbyMsg) {
    const data = JSON.stringify(msg);
    for (const id of userIds) {
      for (const s of this.ctx.getWebSockets(id)) {
        if (s.readyState !== 1) continue;
        try {
          s.send(data);
        } catch {
          /* socket went away */
        }
      }
    }
  }

  private send(ws: WebSocket, msg: LobbyMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket went away */
    }
  }
}
