import { DurableObject } from 'cloudflare:workers';
import { DEFAULT_PARTY_SETTINGS, SOUND_CLIP_MAX, canModerateRole, outranks } from '../../shared/protocol';
import type { ClientMsg, Message, PartyFile, PartySettings, PartyState, Role, ServerMsg, SoundRef, StreamIds, VoiceParticipant, VoiceSnapshot } from '../../shared/protocol';
import { Buckets, type SocketRate } from './limits';
import { MEETING_IDLE, deleteMeetingData } from './meetings';
import { type Env, isAdmin, newId, sanitizeAttachments, toMessage } from './util';

/** Per-socket state. Survives hibernation via serializeAttachment. */
interface Peer {
  peerId: string;
  userId: string;
  role: Role;
  channelId: string;
  /** A meeting's browser guest (never auto-promoted to co-host). */
  guest?: boolean;
  /** Voice state while in a voice room; `forceMuted` is the admin's per-person mute. */
  voice: (Omit<VoiceParticipant, 'serverMuted'> & { forceMuted: boolean }) | null;
}

/** Only for meeting hubs. `emptySince` is when the call last became empty (null while people are in it). */
interface MeetingState {
  channelId: string;
  expiresAt: number;
  emptySince: number | null;
}

const MAX_FRAME = 64 * 1024;
/** With 'auto' control: above this many people in the room, only the host and co-hosts control a watch party. */
const PARTY_OPEN_LIMIT = 3;
/** A watch party starts this long after "Start", so everyone sees the countdown and starts together. */
const PARTY_COUNTDOWN = 3000;
/** A live meeting's hub re-checks its expiry at least this often (in case a disconnect went unnoticed). */
const MEETING_CHECK = 15 * 60_000;

/**
 * One hub per channel: realtime chat fan-out, presence, voice-room state and
 * WebRTC signaling relay. Uses WebSocket hibernation so idle channels cost nothing.
 */
export class ChannelHub extends DurableObject<Env> {
  private mutedRooms = new Set<string>();
  private roomKinds = new Map<string, string>();
  private meeting: MeetingState | null = null;
  private promoting = false;
  /** Watch parties by voice room. */
  private parties = new Map<string, PartyState>();
  private lastRequest = new Map<string, number>();
  private rates = new Buckets();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    ctx.blockConcurrencyWhile(async () => {
      this.mutedRooms = new Set((await ctx.storage.get<string[]>('mutedRooms')) ?? []);
      this.meeting = (await ctx.storage.get<MeetingState>('meeting')) ?? null;
      // Parties saved before lobbies and settings existed are already live, with the defaults.
      const saved = (await ctx.storage.get<Record<string, PartyState>>('parties')) ?? {};
      this.parties = new Map(
        Object.entries(saved).map(([roomId, p]) => [roomId, { ...p, phase: p.phase ?? 'live', settings: p.settings ?? DEFAULT_PARTY_SETTINGS, ready: p.ready ?? [] }]),
      );
    });
  }

  async fetch(req: Request): Promise<Response> {
    const info = JSON.parse(req.headers.get('X-Infimeety-Peer') ?? 'null') as Pick<Peer, 'userId' | 'role' | 'channelId' | 'guest'> | null;
    if (!info) return new Response('Bad request', { status: 400 });

    const [client, server] = Object.values(new WebSocketPair());
    const peer: Peer = { ...info, peerId: newId().slice(-12), voice: null };
    const wasOnline = this.sockets().some((s) => this.peer(s).userId === peer.userId);
    this.ctx.acceptWebSocket(server, [peer.userId]);
    server.serializeAttachment(peer);

    this.send(server, { t: 'welcome', peerId: peer.peerId, online: this.online(), voice: this.voiceSnapshot(), parties: Object.fromEntries(this.parties) });
    if (!wasOnline) this.broadcast({ t: 'presence', online: this.online() }, server);

    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': 'infimeety' } });
  }

  // ─── RPC from the Worker ─────────────────────────────────────────────────────

  async notify(msg: ServerMsg) {
    if (msg.t === 'channel.changed') this.roomKinds.clear();
    this.broadcast(msg);
    if (msg.t === 'channel.removed') for (const s of this.sockets()) s.close(4004, 'Channel deleted');
  }

  /** An admin turned watch parties off in a room: end the one running there, if any. */
  async endPartyIn(roomId: string) {
    if (this.parties.has(roomId)) await this.savePartyState(roomId, null);
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

  /** Send only to the host and co-hosts (a meeting's waiting room). */
  async notifyAdmins(msg: ServerMsg) {
    for (const s of this.sockets()) if (isAdmin(this.peer(s).role)) this.send(s, msg);
  }

  // ─── Meetings ────────────────────────────────────────────────────────────────

  /** Makes this a meeting hub: it ends the meeting at `expiresAt`, or after an hour with nobody in the call. */
  async startMeeting(channelId: string, expiresAt: number) {
    // Counts as empty until the host's call connects, so an unused meeting ends too.
    this.meeting = { channelId, expiresAt, emptySince: Date.now() };
    await this.ctx.storage.put('meeting', this.meeting);
    await this.scheduleCheck();
  }

  /** People in the call right now. */
  async callSize() {
    return this.voiceSnapshot().participants.length;
  }

  /** The meeting is over (already deleted from D1): tell everyone and close their sockets. */
  async meetingEnded() {
    this.broadcast({ t: 'meeting.ended' });
    await this.notify({ t: 'channel.removed' });
    this.meeting = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async alarm() {
    const m = this.meeting;
    if (!m) return;
    const now = Date.now();
    await this.trackEmpty(this.voiceSnapshot().participants.length === 0);
    if (now >= m.expiresAt || (m.emptySince !== null && now - m.emptySince >= MEETING_IDLE)) {
      await deleteMeetingData(this.env, m.channelId);
      return this.meetingEnded();
    }
    await this.scheduleCheck();
  }

  private async scheduleCheck() {
    const m = this.meeting;
    if (!m) return;
    const now = Date.now();
    let at = Math.min(m.expiresAt, now + MEETING_CHECK);
    if (m.emptySince !== null) at = Math.min(at, m.emptySince + MEETING_IDLE);
    await this.ctx.storage.setAlarm(Math.max(at, now + 1000));
  }

  private async trackEmpty(empty: boolean) {
    const m = this.meeting;
    if (!m || empty === (m.emptySince !== null)) return;
    m.emptySince = empty ? Date.now() : null;
    await this.ctx.storage.put('meeting', m);
    await this.scheduleCheck();
  }

  /**
   * After anyone joins or leaves the call: track emptiness, and if nobody left in the call
   * can run the meeting, the signed-in person who has been in it longest becomes a co-host.
   */
  private async meetingCallChanged(except?: WebSocket) {
    const inCall = this.sockets(except)
      .map((s) => this.peer(s))
      .filter((p) => p.voice);
    await this.trackEmpty(inCall.length === 0);
    if (this.promoting || !inCall.length || inCall.some((p) => isAdmin(p.role))) return;
    const next = inCall.filter((p) => !p.guest).sort((a, b) => a.voice!.joinedAt - b.voice!.joinedAt)[0];
    if (!next) return;
    this.promoting = true;
    try {
      await this.env.DB.prepare("UPDATE channel_members SET role = 'admin' WHERE channel_id = ? AND user_id = ? AND role = 'member'")
        .bind(next.channelId, next.userId)
        .run();
      await this.setRole(next.userId, 'admin');
      this.broadcast({ t: 'meeting.cohost', userId: next.userId });
    } finally {
      this.promoting = false;
    }
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
    if (!msg || typeof msg !== 'object') return;
    if (!this.rates.take(me.peerId, rateOf(msg.t))) {
      if (msg.t === 'chat.send') this.send(ws, { t: 'error', message: 'You’re sending messages too fast. Wait a moment.' });
      return;
    }

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
        return this.broadcast({ t: 'typing', roomId: String(msg.roomId).slice(0, 32), userId: me.userId }, ws);

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
            streams: streamIds(s.streams),
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
        if (s.streams && typeof s.streams === 'object') v.streams = streamIds(s.streams);
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
        if (!canModerateRole(me.role) || (await this.roomKind(msg.roomId, me.channelId)) !== 'voice') return;
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
      case 'voice.move': {
        const target = this.byPeer(msg.peerId);
        if (!target || !this.canModerate(me, this.peer(target)) || !this.peer(target).voice) return;
        if ((await this.roomKind(msg.roomId, me.channelId)) !== 'voice') return;
        return this.send(target, { t: 'voice.moved', roomId: msg.roomId });
      }
      case 'sound.play': {
        // Soundboard: relayed live to the others in your voice room, never stored. Muted people stay quiet.
        const v = me.voice;
        if (!v || v.forceMuted || (this.mutedRooms.has(v.roomId) && !canModerateRole(me.role))) return;
        const sound = cleanSound(msg.sound);
        if (!sound) return;
        for (const s of this.sockets(ws)) if (this.peer(s).voice?.roomId === v.roomId) this.send(s, { t: 'sound', peerId: me.peerId, userId: me.userId, sound });
        return;
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
          this.send(s, { t: 'media.request', from: me.peerId, fromUser: me.userId, attachmentId: msg.attachmentId, reqId: msg.reqId, lanes: Math.max(1, Math.min(6, Math.floor(Number(msg.lanes) || 1))) });
        }
        return;
      }
      case 'media.revoked':
        return this.mediaRevoked(me, msg.attachmentIds);

      case 'party.set':
        return this.partySet(ws, me, msg);
      case 'party.start': {
        const party = this.parties.get(String(msg.roomId));
        if (!party || me.voice?.roomId !== msg.roomId || party.phase !== 'lobby') return;
        if (!this.canControl(party, me.userId)) return this.send(ws, { t: 'error', message: 'Only the host and co-hosts can start the watch party' });
        return this.startParty(msg.roomId, party, me.userId);
      }
      case 'party.ready': {
        const party = this.parties.get(String(msg.roomId));
        if (!party || me.voice?.roomId !== msg.roomId) return;
        const ready = party.ready.filter((u) => u !== me.userId);
        if (msg.ready) ready.push(me.userId);
        await this.savePartyState(msg.roomId, { ...party, ready, seq: party.seq + 1 });
        return this.maybeAutoStart(msg.roomId);
      }
      case 'party.settings': {
        const party = this.parties.get(String(msg.roomId));
        if (!party || !this.isHost(party, me.userId)) return;
        await this.savePartyState(msg.roomId, { ...party, settings: cleanSettings(msg.settings), by: me.userId, seq: party.seq + 1 });
        return this.maybeAutoStart(msg.roomId);
      }
      case 'party.request': {
        const party = this.parties.get(String(msg.roomId));
        if (!party || me.voice?.roomId !== msg.roomId) return;
        if (!party.settings.requests) return this.send(ws, { t: 'error', message: 'The host has turned off requests' });
        // One request every two seconds per person is plenty.
        const last = this.lastRequest.get(me.userId) ?? 0;
        if (Date.now() - last < 2000) return;
        this.lastRequest.set(me.userId, Date.now());
        const a = msg.action ?? ({} as never);
        const raw = Number((a as { position?: number }).position);
        const position = Number.isFinite(raw) ? Math.max(0, raw) : undefined;
        // A play without a time plays from wherever the movie is.
        const action =
          a.kind === 'pause'
            ? { kind: 'pause' as const }
            : a.kind === 'seek'
              ? { kind: 'seek' as const, position: position ?? 0 }
              : position === undefined
                ? { kind: 'play' as const }
                : { kind: 'play' as const, position };
        return this.broadcast({ t: 'party.request', roomId: msg.roomId, id: newId(), from: me.userId, action });
      }
      case 'party.cohost': {
        const party = this.parties.get(String(msg.roomId));
        if (!party || party.hostId !== me.userId || msg.userId === me.userId) return;
        const cohosts = party.cohosts.filter((u) => u !== msg.userId);
        if (msg.on) cohosts.push(String(msg.userId));
        return this.savePartyState(msg.roomId, { ...party, cohosts, seq: party.seq + 1 });
      }
      case 'party.status':
        if (me.voice?.roomId !== msg.roomId || !msg.status) return;
        return this.broadcast({
          t: 'party.status',
          roomId: msg.roomId,
          peerId: me.peerId,
          userId: me.userId,
          status: { state: ['choosing', 'copying', 'ready', 'failed'].includes(msg.status.state) ? msg.status.state : 'choosing', progress: Number(msg.status.progress) || 0 },
        });
      case 'clock':
        return this.send(ws, { t: 'clock', c: Number(msg.c) || 0, s: Date.now() });
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
    if (!msg || (msg.userId !== me.userId && !canModerateRole(me.role))) return;
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

  // ─── Watch parties ───────────────────────────────────────────────────────────

  /** People (by user) in a voice room, longest-present first. */
  private inRoom(roomId: string, except?: WebSocket) {
    return this.voiceSnapshot(undefined, except)
      .participants.filter((p) => p.roomId === roomId)
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => p.userId)
      .filter((u, i, all) => all.indexOf(u) === i);
  }

  private isHost(party: PartyState, userId: string) {
    return party.hostId === userId || party.cohosts.includes(userId);
  }

  private canControl(party: PartyState, userId: string) {
    if (this.isHost(party, userId)) return true;
    const { control } = party.settings;
    return control === 'everyone' || (control === 'auto' && this.inRoom(this.roomOf(party)).length <= PARTY_OPEN_LIMIT);
  }

  /** The lobby goes live: playing from where it is, after the countdown. */
  private async startParty(roomId: string, party: PartyState, by: string) {
    const at = Date.now() + PARTY_COUNTDOWN;
    await this.savePartyState(roomId, { ...party, phase: 'live', playing: true, at, by, seq: party.seq + 1 });
  }

  /** With auto-start on, a lobby starts once everyone in the room is ready. */
  private async maybeAutoStart(roomId: string, except?: WebSocket) {
    const party = this.parties.get(roomId);
    if (!party || party.phase !== 'lobby' || !party.settings.autoStart) return;
    const present = this.inRoom(roomId, except);
    if (present.length && present.every((u) => party.ready.includes(u))) await this.startParty(roomId, party, party.hostId);
  }

  private roomOf(party: PartyState) {
    for (const [roomId, p] of this.parties) if (p.id === party.id) return roomId;
    return '';
  }

  private async savePartyState(roomId: string, party: PartyState | null, resolved?: string) {
    if (party) this.parties.set(roomId, party);
    else this.parties.delete(roomId);
    await this.ctx.storage.put('parties', Object.fromEntries(this.parties));
    this.broadcast({ t: 'party', roomId, party, resolved });
  }

  private async partySet(ws: WebSocket, me: Peer, msg: Extract<ClientMsg, { t: 'party.set' }>) {
    const roomId = String(msg.roomId);
    if (me.voice?.roomId !== roomId) return;
    const current = this.parties.get(roomId);
    const now = Date.now();
    if (!msg.party) {
      if (current && !this.canControl(current, me.userId)) return this.send(ws, { t: 'error', message: 'Only the host and co-hosts can end the watch party' });
      return this.savePartyState(roomId, null);
    }
    const p = msg.party;
    const file = cleanFile(p.file);
    if (!file) return;
    if (current && !this.canControl(current, me.userId)) return this.send(ws, { t: 'error', message: 'Only the host and co-hosts can control the watch party' });
    if (!current) {
      const room = await this.env.DB.prepare('SELECT allow_party FROM rooms WHERE id = ? AND channel_id = ?').bind(roomId, me.channelId).first<{ allow_party: number }>();
      if (room?.allow_party === 0) return this.send(ws, { t: 'error', message: 'Watch parties are turned off in this room' });
    }
    // A new movie is the host's call (or a co-host's).
    if (current && current.file.id !== file.id && !this.isHost(current, me.userId)) return;
    const resolves = typeof msg.resolves === 'string' ? msg.resolves.slice(0, 32) : undefined;
    // A new party, or a new movie, opens as a lobby: everyone gets the movie and says they're ready.
    if (!current || current.file.id !== file.id) {
      const next: PartyState = {
        id: newId(),
        hostId: current?.hostId ?? me.userId,
        cohosts: current?.cohosts ?? [],
        file,
        subtitle: p.subtitle ? cleanFile(p.subtitle) : null,
        phase: 'lobby',
        settings: current?.settings ?? cleanSettings(p.settings),
        ready: [],
        playing: false,
        position: 0,
        at: now,
        by: me.userId,
        seq: (current?.seq ?? 0) + 1,
      };
      return this.savePartyState(roomId, next, resolves);
    }
    const next: PartyState = {
      ...current,
      subtitle: p.subtitle ? cleanFile(p.subtitle) : null,
      playing: !!p.playing,
      position: Math.max(0, Number(p.position) || 0),
      // A play is scheduled a little ahead; never trust a time far from ours.
      at: Math.min(now + 5000, Math.max(now - 60_000, Number(p.at) || now)),
      by: me.userId,
      seq: current.seq + 1,
    };
    // Pressing play in the lobby (older apps have no Start button) starts the party.
    if (current.phase === 'lobby' && next.playing) next.phase = 'live';
    await this.savePartyState(roomId, next, resolves);
  }

  /** After the room changes: an empty room ends its party; a host who left hands it on. */
  private async tendParties(except?: WebSocket) {
    for (const [roomId, party] of [...this.parties]) {
      const present = this.inRoom(roomId, except);
      if (!present.length) {
        await this.savePartyState(roomId, null);
        continue;
      }
      // People who left aren't ready anymore.
      const ready = party.ready.filter((u) => present.includes(u));
      const hostId = present.includes(party.hostId) ? party.hostId : (party.cohosts.find((u) => present.includes(u)) ?? present[0]);
      if (hostId === party.hostId && ready.length === party.ready.length) continue;
      await this.savePartyState(roomId, { ...party, hostId, cohosts: party.cohosts.filter((u) => u !== hostId), ready, seq: party.seq + 1 });
      await this.maybeAutoStart(roomId, except);
    }
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

  /** Moderators and up act on lower roles only: owners on anyone, admins on moderators and members, moderators on members. */
  private canModerate(me: Peer, target: Peer) {
    return canModerateRole(me.role) && outranks(me.role, target.role);
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
      const roomMuted = this.mutedRooms.has(v.roomId) && !canModerateRole(p.role);
      participants.push({ ...v, serverMuted: forceMuted || roomMuted });
    }
    return { participants, mutedRooms: [...this.mutedRooms] };
  }

  private broadcastVoice(exceptSocket?: WebSocket) {
    this.broadcast({ t: 'voice', voice: this.voiceSnapshot(undefined, exceptSocket) }, exceptSocket);
    this.tendParties(exceptSocket).catch((err) => console.error('party upkeep failed', err));
    if (this.meeting) this.meetingCallChanged(exceptSocket).catch((err) => console.error('meeting check failed', err));
  }

  private dropped(ws: WebSocket) {
    const me = this.peer(ws);
    this.rates.forget(me.peerId);
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

/** Which allowance a realtime message draws on. */
function rateOf(t: unknown): SocketRate {
  switch (t) {
    case 'chat.send':
    case 'chat.edit':
    case 'chat.delete':
      return 'chat';
    case 'chat.react':
      return 'react';
    case 'typing':
      return 'typing';
    case 'rtc':
      return 'rtc';
    case 'media.request':
    case 'media.revoked':
      return 'media';
    case 'party.set':
    case 'party.start':
    case 'party.ready':
    case 'party.settings':
    case 'party.request':
    case 'party.cohost':
    case 'party.status':
    case 'clock':
      return 'party';
    case 'sound.play':
      return 'sound';
    default:
      return typeof t === 'string' && t.startsWith('voice.') ? 'voice' : 'other';
  }
}

/** A watch party's settings, as the host sent them. */
function cleanSettings(input: unknown): PartySettings {
  const s = (input && typeof input === 'object' ? input : {}) as Partial<PartySettings>;
  return {
    control: s.control === 'everyone' || s.control === 'hosts' ? s.control : 'auto',
    requests: s.requests === undefined ? DEFAULT_PARTY_SETTINGS.requests : !!s.requests,
    autoStart: !!s.autoStart,
  };
}

/** A participant's announced stream ids: short strings only. */
function streamIds(input: unknown): StreamIds {
  const out: StreamIds = {};
  if (!input || typeof input !== 'object') return out;
  for (const k of ['mic', 'cam', 'screen'] as const) {
    const v = (input as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.length <= 64) out[k] = v;
  }
  return out;
}

/** A party's file, as the sender describes it (metadata only). */
function cleanFile(f: unknown): PartyFile | null {
  if (!f || typeof f !== 'object') return null;
  const { id, ownerId, name, mime, size } = f as Record<string, unknown>;
  if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id) || typeof ownerId !== 'string' || typeof size !== 'number' || size < 0) return null;
  return {
    id,
    ownerId: ownerId.slice(0, 64),
    name: String(name ?? 'file').slice(0, 200),
    mime: typeof mime === 'string' && /^[\w.+-]{1,40}\/[\w.+-]{1,100}$/.test(mime) ? mime : 'application/octet-stream',
    size: Math.floor(size),
  };
}

/** A soundboard sound as sent: one of the app's own, or a small audio clip. */
function cleanSound(s: unknown): SoundRef | null {
  const x = s as Record<string, unknown> | null;
  if (!x || typeof x !== 'object') return null;
  if (x.kind === 'builtin' && typeof x.id === 'string' && /^[a-z-]{1,24}$/.test(x.id)) return { kind: 'builtin', id: x.id };
  if (
    x.kind === 'clip' &&
    typeof x.data === 'string' &&
    x.data.length <= SOUND_CLIP_MAX &&
    /^[A-Za-z0-9+/]+=*$/.test(x.data) &&
    typeof x.mime === 'string' &&
    /^audio\/[\w.+-]{1,40}$/.test(x.mime)
  )
    return { kind: 'clip', name: String(x.name ?? 'Sound').slice(0, 32), emoji: String(x.emoji ?? '🔊').slice(0, 8), mime: x.mime, data: x.data };
  return null;
}
