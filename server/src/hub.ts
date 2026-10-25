import { DurableObject } from 'cloudflare:workers';
import type { ClientMsg, Message, Role, ServerMsg, VoiceParticipant, VoiceSnapshot } from '../../shared/protocol';
import { type Env, isAdmin, newId, sanitizeAttachments, toMessage } from './util';

/** Per-socket state. Survives hibernation via serializeAttachment. */
interface Peer {
  peerId: string;
  userId: string;
  role: Role;
  channelId: string;
  /** Voice state while in a voice room; `forceMuted` is the admin's per-person mute. */
  voice: (Omit<VoiceParticipant, 'serverMuted'> & { forceMuted: boolean }) | null;
}

const MAX_FRAME = 64 * 1024;

/**
 * One hub per channel: realtime chat fan-out, presence, voice-room state and
 * WebRTC signaling relay. Uses WebSocket hibernation so idle channels cost nothing.
 */
export class ChannelHub extends DurableObject<Env> {
  private mutedRooms = new Set<string>();
  private roomKinds = new Map<string, string>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    ctx.blockConcurrencyWhile(async () => {
      this.mutedRooms = new Set((await ctx.storage.get<string[]>('mutedRooms')) ?? []);
    });
  }

  async fetch(req: Request): Promise<Response> {
    const info = JSON.parse(req.headers.get('X-Infimeety-Peer') ?? 'null') as Pick<Peer, 'userId' | 'role' | 'channelId'> | null;
    if (!info) return new Response('Bad request', { status: 400 });

    const [client, server] = Object.values(new WebSocketPair());
    const peer: Peer = { ...info, peerId: newId().slice(-12), voice: null };
    const wasOnline = this.sockets().some((s) => this.peer(s).userId === peer.userId);
    this.ctx.acceptWebSocket(server, [peer.userId]);
    server.serializeAttachment(peer);

    this.send(server, { t: 'welcome', peerId: peer.peerId, online: this.online(), voice: this.voiceSnapshot() });
    if (!wasOnline) this.broadcast({ t: 'presence', online: this.online() }, server);

    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': 'infimeety' } });
  }

  // ─── RPC from the Worker ─────────────────────────────────────────────────────

  async notify(msg: ServerMsg) {
    if (msg.t === 'channel.changed') this.roomKinds.clear();
    this.broadcast(msg);
    if (msg.t === 'channel.removed') for (const s of this.sockets()) s.close(4004, 'Channel deleted');
  }

  async removeUser(userId: string) {
    for (const s of this.ctx.getWebSockets(userId)) {
      this.send(s, { t: 'channel.removed' });
      s.close(4003, 'Removed from channel');
    }
    const rest = this.sockets().filter((s) => this.peer(s).userId !== userId);
    for (const s of rest) {
      this.send(s, { t: 'channel.changed' });
      this.send(s, { t: 'presence', online: this.online(userId) });
      this.send(s, { t: 'voice', voice: this.voiceSnapshot(userId) });
    }
  }

  async setRole(userId: string, role: Role) {
    for (const s of this.ctx.getWebSockets(userId)) this.save(s, { ...this.peer(s), role });
    this.broadcast({ t: 'channel.changed' });
    this.broadcastVoice();
  }

  // ─── WebSocket events ────────────────────────────────────────────────────────

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > MAX_FRAME) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const me = this.peer(ws);

    switch (msg.t) {
      case 'chat.send':
        return this.chatSend(ws, me, msg);
      case 'chat.edit':
        return this.chatEdit(me, msg.id, msg.content);
      case 'chat.delete':
        return this.chatDelete(me, msg.id);
      case 'chat.react':
        return this.chatReact(me, msg.id, msg.emoji);
      case 'typing':
        return this.broadcast({ t: 'typing', roomId: String(msg.roomId), userId: me.userId }, ws);

      case 'voice.join': {
        if ((await this.roomKind(msg.roomId, me.channelId)) !== 'voice') return;
        const s = msg.state ?? {};
        this.save(ws, {
          ...me,
          voice: {
            peerId: me.peerId,
            userId: me.userId,
            roomId: msg.roomId,
            muted: !!s.muted,
            deafened: !!s.deafened,
            camera: !!s.camera,
            screen: !!s.screen,
            streams: s.streams ?? {},
            forceMuted: false,
            joinedAt: Date.now(),
          },
        });
        return this.broadcastVoice();
      }
      case 'voice.leave':
        if (!me.voice) return;
        this.save(ws, { ...me, voice: null });
        return this.broadcastVoice();
      case 'voice.update': {
        if (!me.voice) return;
        const s = msg.state ?? {};
        const v = { ...me.voice };
        if (typeof s.muted === 'boolean') v.muted = s.muted;
        if (typeof s.deafened === 'boolean') v.deafened = s.deafened;
        if (typeof s.camera === 'boolean') v.camera = s.camera;
        if (typeof s.screen === 'boolean') v.screen = s.screen;
        if (s.streams && typeof s.streams === 'object') v.streams = s.streams;
        this.save(ws, { ...me, voice: v });
        return this.broadcastVoice();
      }
      case 'voice.serverMute': {
        const target = this.byPeer(msg.peerId);
        if (!target || !this.canModerate(me, this.peer(target))) return;
        const t = this.peer(target);
        if (!t.voice) return;
        this.save(target, { ...t, voice: { ...t.voice, forceMuted: !!msg.muted } });
        return this.broadcastVoice();
      }
      case 'voice.roomMute': {
        if (!isAdmin(me.role) || (await this.roomKind(msg.roomId, me.channelId)) !== 'voice') return;
        if (msg.muted) this.mutedRooms.add(msg.roomId);
        else this.mutedRooms.delete(msg.roomId);
        await this.ctx.storage.put('mutedRooms', [...this.mutedRooms]);
        return this.broadcastVoice();
      }
      case 'voice.disconnect': {
        const target = this.byPeer(msg.peerId);
        if (!target || !this.canModerate(me, this.peer(target))) return;
        this.save(target, { ...this.peer(target), voice: null });
        this.send(target, { t: 'voice.kicked' });
        return this.broadcastVoice();
      }

      case 'rtc': {
        const target = this.byPeer(msg.to);
        if (target) this.send(target, { t: 'rtc', from: me.peerId, fromUser: me.userId, data: msg.data });
        return;
      }
      case 'media.request': {
        const owners = this.ctx.getWebSockets(String(msg.ownerId)).filter((s) => s.readyState === 1);
        if (!owners.length) return this.send(ws, { t: 'media.offline', reqId: msg.reqId });
        for (const s of owners) {
          this.send(s, { t: 'media.request', from: me.peerId, fromUser: me.userId, attachmentId: msg.attachmentId, reqId: msg.reqId });
        }
        return;
      }
      case 'media.revoked':
        return this.mediaRevoked(me, msg.attachmentIds);
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    this.dropped(ws);
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket) {
    this.dropped(ws);
  }

  // ─── Chat ────────────────────────────────────────────────────────────────────

  private async chatSend(ws: WebSocket, me: Peer, msg: Extract<ClientMsg, { t: 'chat.send' }>) {
    const content = String(msg.content ?? '').slice(0, 4000).trim();
    const attachments = sanitizeAttachments(msg.attachments, me.userId);
    if (!content && !attachments.length) return;
    if (!(await this.roomKind(msg.roomId, me.channelId))) return this.send(ws, { t: 'error', message: 'Room not found' });

    const message: Message = {
      id: newId(),
      roomId: msg.roomId,
      userId: me.userId,
      content,
      attachments,
      replyTo: typeof msg.replyTo === 'string' ? msg.replyTo.slice(0, 32) : null,
      reactions: {},
      createdAt: Date.now(),
      editedAt: null,
    };
    await this.env.DB.prepare(
      'INSERT INTO messages (id, room_id, user_id, content, attachments, reply_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(message.id, message.roomId, message.userId, content, attachments.length ? JSON.stringify(attachments) : null, message.replyTo, message.createdAt)
      .run();
    this.broadcast({ t: 'chat.new', message, nonce: String(msg.nonce ?? '').slice(0, 64) });
  }

  private async findMessage(id: string, channelId: string) {
    const row = await this.env.DB.prepare(
      'SELECT m.* FROM messages m JOIN rooms r ON r.id = m.room_id WHERE m.id = ? AND r.channel_id = ?',
    )
      .bind(String(id), channelId)
      .first<any>();
    return row ? toMessage(row) : null;
  }

  private async chatEdit(me: Peer, id: string, content: string) {
    const msg = await this.findMessage(id, me.channelId);
    const clean = String(content ?? '').slice(0, 4000).trim();
    if (!msg || msg.userId !== me.userId || !clean) return;
    const editedAt = Date.now();
    await this.env.DB.prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?').bind(clean, editedAt, msg.id).run();
    this.broadcast({ t: 'chat.edited', id: msg.id, roomId: msg.roomId, content: clean, editedAt });
  }

  private async chatDelete(me: Peer, id: string) {
    const msg = await this.findMessage(id, me.channelId);
    if (!msg || (msg.userId !== me.userId && !isAdmin(me.role))) return;
    await this.env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(msg.id).run();
    this.broadcast({ t: 'chat.deleted', id: msg.id, roomId: msg.roomId });
  }

  /** One reaction per person (like iMessage): a new emoji replaces yours, the same one removes it. */
  private async chatReact(me: Peer, id: string, emoji: string) {
    const e = String(emoji ?? '');
    if (!e || e.length > 16) return;
    const msg = await this.findMessage(id, me.channelId);
    if (!msg) return;
    const hadThis = msg.reactions[e]?.includes(me.userId) ?? false;
    const reactions: Record<string, string[]> = {};
    for (const [emojiKey, users] of Object.entries(msg.reactions)) {
      const rest = users.filter((u) => u !== me.userId);
      if (rest.length) reactions[emojiKey] = rest;
    }
    if (!hadThis && (Object.keys(reactions).length < 20 || reactions[e])) reactions[e] = [...(reactions[e] ?? []), me.userId];
    await this.env.DB.prepare('UPDATE messages SET reactions = ? WHERE id = ?').bind(JSON.stringify(reactions), msg.id).run();
    this.broadcast({ t: 'chat.reactions', id: msg.id, roomId: msg.roomId, reactions });
  }

  /** The owner deleted local files: mark them removed for good and tell everyone. */
  private async mediaRevoked(me: Peer, ids: unknown) {
    if (!Array.isArray(ids) || !ids.length) return;
    const revoked = new Set(ids.slice(0, 100).map(String));
    const { results } = await this.env.DB.prepare(
      `SELECT m.* FROM messages m JOIN rooms r ON r.id = m.room_id
       WHERE m.user_id = ? AND r.channel_id = ? AND m.attachments IS NOT NULL`,
    )
      .bind(me.userId, me.channelId)
      .all<any>();
    for (const row of results) {
      const msg = toMessage(row);
      if (!msg.attachments.some((a) => revoked.has(a.id) && !a.removed)) continue;
      const attachments = msg.attachments.map((a) => (revoked.has(a.id) ? { ...a, removed: true } : a));
      await this.env.DB.prepare('UPDATE messages SET attachments = ? WHERE id = ?').bind(JSON.stringify(attachments), msg.id).run();
      this.broadcast({ t: 'chat.attachments', id: msg.id, roomId: msg.roomId, attachments });
    }
    this.broadcast({ t: 'media.revoked', ownerId: me.userId, attachmentIds: [...revoked] });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async roomKind(roomId: string, channelId: string): Promise<string | null> {
    if (typeof roomId !== 'string') return null;
    const cached = this.roomKinds.get(roomId);
    if (cached) return cached;
    const row = await this.env.DB.prepare('SELECT kind FROM rooms WHERE id = ? AND channel_id = ?').bind(roomId, channelId).first<{ kind: string }>();
    if (row) this.roomKinds.set(roomId, row.kind);
    return row?.kind ?? null;
  }

  private canModerate(me: Peer, target: Peer) {
    if (!isAdmin(me.role) || target.role === 'owner') return false;
    return me.role === 'owner' || target.role !== 'admin';
  }

  private peer(ws: WebSocket): Peer {
    return ws.deserializeAttachment() as Peer;
  }

  private save(ws: WebSocket, peer: Peer) {
    ws.serializeAttachment(peer);
  }

  private sockets(except?: WebSocket) {
    return this.ctx.getWebSockets().filter((s) => s !== except && s.readyState === 1);
  }

  private byPeer(peerId: string) {
    return this.sockets().find((s) => this.peer(s).peerId === peerId);
  }

  private online(exceptUser?: string) {
    return [...new Set(this.sockets().map((s) => this.peer(s).userId))].filter((u) => u !== exceptUser);
  }

  private voiceSnapshot(exceptUser?: string, exceptSocket?: WebSocket): VoiceSnapshot {
    const participants: VoiceParticipant[] = [];
    for (const s of this.sockets(exceptSocket)) {
      const p = this.peer(s);
      if (!p.voice || p.userId === exceptUser) continue;
      const { forceMuted, ...v } = p.voice;
      const roomMuted = this.mutedRooms.has(v.roomId) && !isAdmin(p.role);
      participants.push({ ...v, serverMuted: forceMuted || roomMuted });
    }
    return { participants, mutedRooms: [...this.mutedRooms] };
  }

  private broadcastVoice(exceptSocket?: WebSocket) {
    this.broadcast({ t: 'voice', voice: this.voiceSnapshot(undefined, exceptSocket) }, exceptSocket);
  }

  private dropped(ws: WebSocket) {
    const me = this.peer(ws);
    const stillOnline = this.sockets(ws).some((s) => this.peer(s).userId === me.userId);
    if (!stillOnline) this.broadcast({ t: 'presence', online: this.online().filter((u) => u !== me.userId) }, ws);
    if (me.voice) this.broadcastVoice(ws);
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket went away */
    }
  }

  private broadcast(msg: ServerMsg, except?: WebSocket) {
    const data = JSON.stringify(msg);
    for (const s of this.sockets(except)) {
      try {
        s.send(data);
      } catch {
        /* socket went away */
      }
    }
  }
}
