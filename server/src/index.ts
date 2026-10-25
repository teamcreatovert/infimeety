import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import type { Provider, Role, ServerMsg } from '../../shared/protocol';
import {
  authorizeUrl,
  callbackPage,
  createSession,
  exchangeCode,
  isProvider,
  providerEnabled,
  upsertUser,
  userFromToken,
} from './auth';
import {
  type Env,
  type UserRow,
  hub,
  inviteCode,
  isAdmin,
  memberRole,
  newId,
  randomToken,
  sha256,
  toChannel,
  toMe,
  toMember,
  toMessage,
  toPublicUser,
  toRoom,
} from './util';

export { ChannelHub } from './hub';

type App = { Bindings: Env; Variables: { user: UserRow } };
const app = new Hono<App>();

const corsMw = cors({
  origin: '*',
  allowHeaders: ['Authorization', 'Content-Type'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  maxAge: 86400,
});
// WebSocket upgrade responses have immutable headers, so CORS only wraps plain HTTP routes.
app.use('*', (c, next) => (c.req.path.endsWith('/ws') ? next() : corsMw(c, next)));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal_error' }, 500);
});

const auth = createMiddleware<App>(async (c, next) => {
  const header = c.req.header('Authorization');
  const user = await userFromToken(c.env, header?.startsWith('Bearer ') ? header.slice(7) : null);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  c.set('user', user);
  await next();
});

async function notifyChannels(env: Env, userId: string, msg: ServerMsg) {
  const { results } = await env.DB.prepare('SELECT channel_id FROM channel_members WHERE user_id = ?')
    .bind(userId)
    .all<{ channel_id: string }>();
  await Promise.all(results.map((r) => hub(env, r.channel_id).notify(msg)));
}

async function providersOf(env: Env, userId: string): Promise<Provider[]> {
  const { results } = await env.DB.prepare('SELECT provider FROM identities WHERE user_id = ?')
    .bind(userId)
    .all<{ provider: Provider }>();
  return results.map((r) => r.provider);
}

app.get('/', (c) => c.json({ name: 'infimeety', ok: true }));

// ─── Auth ──────────────────────────────────────────────────────────────────────

app.get('/auth/providers', (c) =>
  c.json({
    google: providerEnabled(c.env, 'google'),
    discord: providerEnabled(c.env, 'discord'),
    dev: c.env.DEV_LOGIN === 'true',
  }),
);

/** Step 1: the app opens this in the system browser with a challenge = sha256(verifier). */
app.get('/auth/:provider/start', async (c) => {
  const provider = c.req.param('provider');
  const challenge = c.req.query('challenge') ?? '';
  if (!isProvider(provider) || !providerEnabled(c.env, provider)) return c.html(callbackPage(false, 'This sign-in method is not configured.'), 400);
  if (!/^[\w-]{43}$/.test(challenge)) return c.html(callbackPage(false, 'Invalid sign-in request.'), 400);

  await c.env.DB.prepare('DELETE FROM login_requests WHERE created_at < ?').bind(Date.now() - 15 * 60_000).run();
  const state = randomToken(24);
  await c.env.DB.prepare(
    'INSERT OR REPLACE INTO login_requests (state, challenge, provider, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(state, challenge, provider, Date.now())
    .run();
  return c.redirect(authorizeUrl(c.env, provider, state));
});

/** Step 2: provider redirects back here; we park a session token for the app to redeem. */
app.get('/auth/:provider/callback', async (c) => {
  const provider = c.req.param('provider');
  const state = c.req.query('state') ?? '';
  const code = c.req.query('code');
  const row = await c.env.DB.prepare('SELECT * FROM login_requests WHERE state = ?').bind(state).first<any>();
  if (!row || row.provider !== provider || !isProvider(provider)) {
    return c.html(callbackPage(false, 'This sign-in link expired. Please try again from the app.'), 400);
  }
  if (!code) {
    await c.env.DB.prepare('UPDATE login_requests SET error = ? WHERE state = ?').bind('cancelled', state).run();
    return c.html(callbackPage(false, 'Sign-in was cancelled.'), 400);
  }
  try {
    const profile = await exchangeCode(c.env, provider, code);
    const userId = await upsertUser(c.env, provider, profile);
    const token = await createSession(c.env, userId);
    await c.env.DB.prepare('UPDATE login_requests SET session_token = ? WHERE state = ?').bind(token, state).run();
    return c.html(callbackPage(true, ''));
  } catch (err) {
    console.error(err);
    await c.env.DB.prepare('UPDATE login_requests SET error = ? WHERE state = ?').bind('failed', state).run();
    return c.html(callbackPage(false, 'Something went wrong while signing in. Please try again.'), 500);
  }
});

/** Step 3: the app polls with its verifier until the session token is ready. */
app.post('/auth/redeem', async (c) => {
  const { verifier } = await c.req.json<{ verifier?: string }>();
  if (!verifier || verifier.length < 32) return c.json({ error: 'bad_request' }, 400);
  const challenge = await sha256(verifier);
  const row = await c.env.DB.prepare('SELECT * FROM login_requests WHERE challenge = ?').bind(challenge).first<any>();
  if (!row) return c.json({ status: 'pending' }, 202);
  if (row.error) {
    await c.env.DB.prepare('DELETE FROM login_requests WHERE state = ?').bind(row.state).run();
    return c.json({ error: row.error }, 400);
  }
  if (!row.session_token) return c.json({ status: 'pending' }, 202);
  await c.env.DB.prepare('DELETE FROM login_requests WHERE state = ?').bind(row.state).run();
  return c.json({ token: row.session_token });
});

/** Local testing only — enabled with DEV_LOGIN=true in .dev.vars. */
app.post('/auth/dev', async (c) => {
  if (c.env.DEV_LOGIN !== 'true') return c.json({ error: 'disabled' }, 404);
  const { name } = await c.req.json<{ name?: string }>();
  const clean = (name ?? '').trim().slice(0, 32) || 'Tester';
  const userId = await upsertUser(c.env, 'dev', {
    providerId: clean.toLowerCase(),
    email: `${clean.toLowerCase().replace(/\W/g, '')}@test.local`,
    emailVerified: false,
    name: clean,
    handle: clean,
    avatar: null,
  });
  return c.json({ token: await createSession(c.env, userId) });
});

app.post('/auth/logout', auth, async (c) => {
  const token = c.req.header('Authorization')!.slice(7);
  await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return c.json({ ok: true });
});

// ─── Profile ───────────────────────────────────────────────────────────────────

app.get('/me', auth, async (c) => {
  const user = c.get('user');
  return c.json(toMe(user, await providersOf(c.env, user.id)));
});

const USERNAME = /^[a-z0-9_.]{3,24}$/;

app.get('/me/username-available', auth, async (c) => {
  const u = (c.req.query('u') ?? '').toLowerCase();
  if (!USERNAME.test(u)) return c.json({ available: false, reason: 'invalid' });
  const row = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(u).first<{ id: string }>();
  return c.json({ available: !row || row.id === c.get('user').id });
});

app.patch('/me', auth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ name?: string; username?: string; onboarded?: boolean; useProviderAvatar?: boolean }>();
  const name = body.name !== undefined ? body.name.trim().slice(0, 48) : user.name;
  const username = body.username !== undefined ? body.username.trim().toLowerCase() : user.username;
  if (!name) return c.json({ error: 'name_required' }, 400);
  if (username && !USERNAME.test(username)) return c.json({ error: 'username_invalid' }, 400);
  if (username && username !== user.username) {
    const taken = await c.env.DB.prepare('SELECT 1 FROM users WHERE username = ? AND id != ?').bind(username, user.id).first();
    if (taken) return c.json({ error: 'username_taken' }, 409);
  }

  let avatarUrl = user.avatar_url;
  let avatarKey = user.avatar_key;
  if (body.useProviderAvatar) {
    if (avatarKey) await c.env.AVATARS.delete(avatarKey);
    avatarKey = null;
    avatarUrl = user.provider_avatar_url;
  }
  const onboarded = body.onboarded ? 1 : user.onboarded;
  await c.env.DB.prepare('UPDATE users SET name = ?, username = ?, avatar_url = ?, avatar_key = ?, onboarded = ? WHERE id = ?')
    .bind(name, username, avatarUrl, avatarKey, onboarded, user.id)
    .run();

  const updated: UserRow = { ...user, name, username, avatar_url: avatarUrl, avatar_key: avatarKey, onboarded };
  c.executionCtx.waitUntil(notifyChannels(c.env, user.id, { t: 'member.updated', user: toPublicUser(updated) }));
  return c.json(toMe(updated, await providersOf(c.env, user.id)));
});

const AVATAR_TYPES = /^image\/(png|jpeg|gif|webp)$/;

/** Custom avatars are the one media exception: they must be visible while the owner is offline. */
app.put('/me/avatar', auth, async (c) => {
  const user = c.get('user');
  const type = c.req.header('Content-Type') ?? '';
  if (!AVATAR_TYPES.test(type)) return c.json({ error: 'unsupported_type' }, 415);
  const data = await c.req.arrayBuffer();
  if (data.byteLength > 4 * 1024 * 1024) return c.json({ error: 'too_large' }, 413);

  const key = `${user.id}.${randomToken(6)}`;
  await c.env.AVATARS.put(key, data, { metadata: { type } });
  if (user.avatar_key) await c.env.AVATARS.delete(user.avatar_key);
  const avatarUrl = `${c.env.PUBLIC_URL}/avatars/${key}`;
  await c.env.DB.prepare('UPDATE users SET avatar_url = ?, avatar_key = ? WHERE id = ?').bind(avatarUrl, key, user.id).run();

  const updated = { ...user, avatar_url: avatarUrl, avatar_key: key };
  c.executionCtx.waitUntil(notifyChannels(c.env, user.id, { t: 'member.updated', user: toPublicUser(updated) }));
  return c.json(toMe(updated, await providersOf(c.env, user.id)));
});

app.get('/avatars/:key', async (c) => {
  const { value, metadata } = await c.env.AVATARS.getWithMetadata<{ type: string }>(c.req.param('key'), 'arrayBuffer');
  if (!value) return c.notFound();
  return new Response(value, {
    headers: {
      'Content-Type': metadata?.type ?? 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
    },
  });
});

/** ICE servers for WebRTC. Uses Cloudflare TURN when configured, otherwise public STUN. */
app.get('/ice', auth, async (c) => {
  const stun = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
  if (!c.env.TURN_KEY_ID || !c.env.TURN_KEY_API_TOKEN) return c.json({ iceServers: stun });
  const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${c.env.TURN_KEY_ID}/credentials/generate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: 86400 }),
  });
  if (!res.ok) return c.json({ iceServers: stun });
  const { iceServers } = await res.json<{ iceServers: unknown }>();
  return c.json({ iceServers: Array.isArray(iceServers) ? iceServers : [iceServers] });
});

// ─── Channels & rooms ──────────────────────────────────────────────────────────

async function loadChannels(env: Env, userId: string, onlyId?: string) {
  const filter = onlyId ? 'AND c.id = ?' : '';
  const binds = onlyId ? [userId, onlyId] : [userId];
  const { results: chans } = await env.DB.prepare(
    `SELECT c.*, m.role FROM channels c JOIN channel_members m ON m.channel_id = c.id
     WHERE m.user_id = ? ${filter} ORDER BY m.joined_at`,
  )
    .bind(...binds)
    .all<any>();
  const { results: rooms } = await env.DB.prepare(
    `SELECT r.* FROM rooms r JOIN channel_members m ON m.channel_id = r.channel_id
     WHERE m.user_id = ? ${onlyId ? 'AND r.channel_id = ?' : ''} ORDER BY r.position, r.created_at`,
  )
    .bind(...binds)
    .all<any>();
  return chans.map((ch) =>
    toChannel(
      ch,
      rooms.filter((r) => r.channel_id === ch.id).map(toRoom),
    ),
  );
}

const requireRole = (min: 'member' | 'admin' | 'owner') =>
  createMiddleware<App & { Variables: { role: Role } }>(async (c, next) => {
    const role = await memberRole(c.env, c.req.param('id')!, c.get('user').id);
    if (!role) return c.json({ error: 'not_found' }, 404);
    if (min === 'admin' && !isAdmin(role)) return c.json({ error: 'forbidden' }, 403);
    if (min === 'owner' && role !== 'owner') return c.json({ error: 'forbidden' }, 403);
    c.set('role', role);
    await next();
  });

app.get('/channels', auth, async (c) => c.json(await loadChannels(c.env, c.get('user').id)));

app.post('/channels', auth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ name?: string; emoji?: string; color?: string }>();
  const name = (body.name ?? '').trim().slice(0, 40);
  if (!name) return c.json({ error: 'name_required' }, 400);
  const id = newId();
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO channels (id, name, emoji, color, owner_id, invite_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
      id,
      name,
      (body.emoji ?? '✨').slice(0, 16),
      (body.color ?? 'blue').slice(0, 16),
      user.id,
      inviteCode(),
      now,
    ),
    c.env.DB.prepare("INSERT INTO channel_members (channel_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").bind(id, user.id, now),
    c.env.DB.prepare("INSERT INTO rooms (id, channel_id, kind, name, position, created_at) VALUES (?, ?, 'text', 'general', 0, ?)").bind(newId(), id, now),
    c.env.DB.prepare("INSERT INTO rooms (id, channel_id, kind, name, position, created_at) VALUES (?, ?, 'voice', 'Lounge', 1, ?)").bind(newId(), id, now),
    c.env.DB.prepare("INSERT INTO rooms (id, channel_id, kind, name, position, created_at) VALUES (?, ?, 'voice', 'Movie Night', 2, ?)").bind(newId(), id, now),
  ]);
  const [channel] = await loadChannels(c.env, user.id, id);
  return c.json(channel, 201);
});

app.post('/channels/join', auth, async (c) => {
  const user = c.get('user');
  const { code } = await c.req.json<{ code?: string }>();
  const clean = (code ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const ch = await c.env.DB.prepare('SELECT id FROM channels WHERE invite_code = ?').bind(clean).first<{ id: string }>();
  if (!ch) return c.json({ error: 'invalid_code' }, 404);
  const res = await c.env.DB.prepare("INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)")
    .bind(ch.id, user.id, Date.now())
    .run();
  if (res.meta.changes) c.executionCtx.waitUntil(hub(c.env, ch.id).notify({ t: 'channel.changed' }));
  const [channel] = await loadChannels(c.env, user.id, ch.id);
  return c.json(channel);
});

app.patch('/channels/:id', auth, requireRole('admin'), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ name?: string; emoji?: string; color?: string }>();
  const name = body.name?.trim().slice(0, 40);
  await c.env.DB.prepare('UPDATE channels SET name = COALESCE(?, name), emoji = COALESCE(?, emoji), color = COALESCE(?, color) WHERE id = ?')
    .bind(name || null, body.emoji?.slice(0, 16) ?? null, body.color?.slice(0, 16) ?? null, id)
    .run();
  c.executionCtx.waitUntil(hub(c.env, id).notify({ t: 'channel.changed' }));
  const [channel] = await loadChannels(c.env, c.get('user').id, id);
  return c.json(channel);
});

app.delete('/channels/:id', auth, requireRole('owner'), async (c) => {
  const id = c.req.param('id');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM messages WHERE room_id IN (SELECT id FROM rooms WHERE channel_id = ?)').bind(id),
    c.env.DB.prepare('DELETE FROM rooms WHERE channel_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM channel_members WHERE channel_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM channels WHERE id = ?').bind(id),
  ]);
  c.executionCtx.waitUntil(hub(c.env, id).notify({ t: 'channel.removed' }));
  return c.json({ ok: true });
});

app.post('/channels/:id/invite/reset', auth, requireRole('admin'), async (c) => {
  const code = inviteCode();
  await c.env.DB.prepare('UPDATE channels SET invite_code = ? WHERE id = ?').bind(code, c.req.param('id')).run();
  return c.json({ inviteCode: code });
});

app.post('/channels/:id/leave', auth, requireRole('member'), async (c) => {
  const id = c.req.param('id');
  if (c.get('role') === 'owner') return c.json({ error: 'owner_cannot_leave' }, 400);
  const userId = c.get('user').id;
  await c.env.DB.prepare('DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?').bind(id, userId).run();
  c.executionCtx.waitUntil(hub(c.env, id).removeUser(userId));
  return c.json({ ok: true });
});

app.get('/channels/:id/members', auth, requireRole('member'), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.username, u.avatar_url, m.role, m.joined_at
     FROM channel_members m JOIN users u ON u.id = m.user_id WHERE m.channel_id = ? ORDER BY m.joined_at`,
  )
    .bind(c.req.param('id'))
    .all<any>();
  return c.json(results.map(toMember));
});

app.patch('/channels/:id/members/:userId', auth, requireRole('owner'), async (c) => {
  const { role } = await c.req.json<{ role?: Role }>();
  if (role !== 'admin' && role !== 'member') return c.json({ error: 'bad_role' }, 400);
  const id = c.req.param('id');
  const target = c.req.param('userId');
  if (target === c.get('user').id) return c.json({ error: 'cannot_change_self' }, 400);
  await c.env.DB.prepare('UPDATE channel_members SET role = ? WHERE channel_id = ? AND user_id = ?').bind(role, id, target).run();
  c.executionCtx.waitUntil(hub(c.env, id).setRole(target, role));
  return c.json({ ok: true });
});

app.delete('/channels/:id/members/:userId', auth, requireRole('admin'), async (c) => {
  const id = c.req.param('id');
  const target = c.req.param('userId');
  const targetRole = await memberRole(c.env, id, target);
  if (!targetRole) return c.json({ error: 'not_found' }, 404);
  if (targetRole === 'owner' || (targetRole === 'admin' && c.get('role') !== 'owner')) return c.json({ error: 'forbidden' }, 403);
  await c.env.DB.prepare('DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?').bind(id, target).run();
  c.executionCtx.waitUntil(hub(c.env, id).removeUser(target));
  return c.json({ ok: true });
});

app.post('/channels/:id/rooms', auth, requireRole('admin'), async (c) => {
  const id = c.req.param('id');
  const { kind, name } = await c.req.json<{ kind?: string; name?: string }>();
  if (kind !== 'text' && kind !== 'voice') return c.json({ error: 'bad_kind' }, 400);
  const clean = (name ?? '').trim().slice(0, 40);
  if (!clean) return c.json({ error: 'name_required' }, 400);
  const pos = await c.env.DB.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM rooms WHERE channel_id = ?').bind(id).first<{ p: number }>();
  const room = { id: newId(), channel_id: id, kind, name: kind === 'text' ? clean.toLowerCase().replace(/\s+/g, '-') : clean, position: pos?.p ?? 0 };
  await c.env.DB.prepare('INSERT INTO rooms (id, channel_id, kind, name, position, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(room.id, id, room.kind, room.name, room.position, Date.now())
    .run();
  c.executionCtx.waitUntil(hub(c.env, id).notify({ t: 'channel.changed' }));
  return c.json(toRoom(room), 201);
});

app.patch('/channels/:id/rooms/:roomId', auth, requireRole('admin'), async (c) => {
  const id = c.req.param('id');
  const { name } = await c.req.json<{ name?: string }>();
  const clean = (name ?? '').trim().slice(0, 40);
  if (!clean) return c.json({ error: 'name_required' }, 400);
  await c.env.DB.prepare('UPDATE rooms SET name = ? WHERE id = ? AND channel_id = ?').bind(clean, c.req.param('roomId'), id).run();
  c.executionCtx.waitUntil(hub(c.env, id).notify({ t: 'channel.changed' }));
  return c.json({ ok: true });
});

app.delete('/channels/:id/rooms/:roomId', auth, requireRole('admin'), async (c) => {
  const id = c.req.param('id');
  const roomId = c.req.param('roomId');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM messages WHERE room_id = (SELECT id FROM rooms WHERE id = ? AND channel_id = ?)').bind(roomId, id),
    c.env.DB.prepare('DELETE FROM rooms WHERE id = ? AND channel_id = ?').bind(roomId, id),
  ]);
  c.executionCtx.waitUntil(hub(c.env, id).notify({ t: 'channel.changed' }));
  return c.json({ ok: true });
});

app.get('/channels/:id/rooms/:roomId/messages', auth, requireRole('member'), async (c) => {
  const before = c.req.query('before') ?? null;
  const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 100);
  const { results } = await c.env.DB.prepare(
    `SELECT m.* FROM messages m JOIN rooms r ON r.id = m.room_id
     WHERE m.room_id = ? AND r.channel_id = ? AND (?3 IS NULL OR m.id < ?3)
     ORDER BY m.id DESC LIMIT ?4`,
  )
    .bind(c.req.param('roomId'), c.req.param('id'), before, limit)
    .all<any>();
  return c.json(results.reverse().map(toMessage));
});

// ─── Realtime ──────────────────────────────────────────────────────────────────

/** Browsers can't set headers on WebSockets, so the session token rides in the subprotocol list. */
app.get('/channels/:id/ws', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') return c.text('Expected a WebSocket upgrade', 426);
  const protocols = (c.req.header('Sec-WebSocket-Protocol') ?? '').split(',').map((p) => p.trim());
  const user = await userFromToken(c.env, protocols.find((p) => p && p !== 'infimeety'));
  if (!user) return c.text('Unauthorized', 401);
  const channelId = c.req.param('id');
  const role = await memberRole(c.env, channelId, user.id);
  if (!role) return c.text('Forbidden', 403);

  const req = new Request(c.req.raw);
  req.headers.set('X-Infimeety-Peer', JSON.stringify({ userId: user.id, role, channelId }));
  return hub(c.env, channelId).fetch(req);
});

export default app;
