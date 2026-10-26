import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import type { Friend, Provider, PublicUser, Role, ServerMsg } from '../../shared/protocol';
import {
  authorizeUrl,
  callbackCsp,
  callbackPage,
  createSession,
  exchangeCode,
  isProvider,
  linkIdentity,
  providerEnabled,
  upsertUser,
  userFromToken,
} from './auth';
import {
  MAX_WAITING,
  MEETING_TTL,
  announceWaiting,
  endMeeting,
  findMeeting,
  meetingCode,
  meetingPreview,
  sweepMeetings,
  waitingGuests,
} from './meetings';
import { allow, clientIp } from './limits';
import { iceServers, turnStatus } from './turn';
import {
  type Env,
  type UserRow,
  hub,
  inviteCode,
  invitePreview,
  isAdmin,
  lobby,
  memberRole,
  newId,
  orderedPair,
  randomToken,
  sha256,
  toChannel,
  toMe,
  toMember,
  toMessage,
  toPublicUser,
  toRoom,
} from './util';

/**
 * The HTTP + WebSocket API. Served by the Worker (src/index.ts, which also hosts the
 * ChannelHub Durable Object) and by the Pages project at infimeety.pages.dev/api.
 */

type App = { Bindings: Env; Variables: { user: UserRow } };

/** Marks a finished "connect account" request in login_requests.session_token. */
const LINKED = '__linked__';
const app = new Hono<App>();

const corsMw = cors({
  origin: '*',
  allowHeaders: ['Authorization', 'Content-Type'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  maxAge: 86400,
});
// WebSocket upgrade responses have immutable headers, so CORS only wraps plain HTTP routes.
app.use('*', (c, next) => (c.req.path.endsWith('/ws') ? next() : corsMw(c, next)));

/** Security headers on every plain HTTP response (the API's JSON and its few HTML pages). */
app.use('*', async (c, next) => {
  await next();
  if (c.req.path.endsWith('/ws')) return;
  const h = c.res.headers;
  const html = h.get('Content-Type')?.startsWith('text/html');
  const csp = h.has('Content-Security-Policy') ? null : html ? await callbackCsp() : "default-src 'none'; frame-ancestors 'none'";
  try {
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('Referrer-Policy', 'no-referrer');
    h.set('X-Frame-Options', 'DENY');
    h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (csp) h.set('Content-Security-Policy', csp);
  } catch {
    /* a response with fixed headers (none today) keeps its own */
  }
});

/** Too many requests from one address for this kind of request (see limits.ts). */
const limit = (bucket: string, max: number, windowMs = 60_000) =>
  createMiddleware<App>(async (c, next) => {
    if (allow(`${bucket}|${clientIp(c.req.raw)}`, max, windowMs)) return next();
    c.header('Retry-After', String(Math.ceil(windowMs / 1000)));
    return c.json({ error: 'rate_limited' }, 429);
  });

// A ceiling for everything, far above what the app itself ever sends.
app.use('*', limit('all', 3000));

app.onError((err, c) => {
  // A body that isn't JSON is the caller's mistake, not ours.
  if (err instanceof SyntaxError) return c.json({ error: 'bad_request' }, 400);
  console.error(err);
  return c.json({ error: 'internal_error' }, 500);
});

const signedIn = (allowGuests: boolean) =>
  createMiddleware<App>(async (c, next) => {
    const header = c.req.header('Authorization');
    const user = await userFromToken(c.env, header?.startsWith('Bearer ') ? header.slice(7) : null);
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    if (user.guest_of && !allowGuests) return c.json({ error: 'guest' }, 403);
    c.set('user', user);
    await next();
  });

/** An Infimeety account. */
const auth = signedIn(false);
/** An account or a meeting's browser guest (who can only ever see that one meeting). */
const guestOk = signedIn(true);

async function notifyChannels(env: Env, userId: string, msg: ServerMsg) {
  const { results } = await env.DB.prepare('SELECT channel_id FROM channel_members WHERE user_id = ?')
    .bind(userId)
    .all<{ channel_id: string }>();
  await Promise.all(results.map((r) => hub(env, r.channel_id).notify(msg)));
  // Friends without a shared channel still see the new name/photo in their friends list.
  if (msg.t === 'member.updated') {
    for (const f of await friendsOf(env, userId)) {
      if (f.status === 'accepted') await lobby(env).notify(f.user.id, { t: 'friend.upsert', friend: { ...f, user: msg.user } });
    }
  }
}

// ─── Friends ───────────────────────────────────────────────────────────────────

interface FriendRow {
  user_a: string;
  user_b: string;
  status: 'pending' | 'accepted';
  requested_by: string;
  created_at: number;
  accepted_at: number | null;
}

/** A friendship as seen by `viewerId`. */
const friendView = (row: FriendRow, viewerId: string, other: PublicUser): Friend => ({
  user: other,
  status: row.status === 'accepted' ? 'accepted' : row.requested_by === viewerId ? 'outgoing' : 'incoming',
  since: row.accepted_at ?? row.created_at,
});

async function friendsOf(env: Env, userId: string): Promise<Friend[]> {
  const { results } = await env.DB.prepare(
    `SELECT f.*, u.id, u.name, u.username, u.avatar_url FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.user_a = ?1 THEN f.user_b ELSE f.user_a END
     WHERE f.user_a = ?1 OR f.user_b = ?1`,
  )
    .bind(userId)
    .all<FriendRow & UserRow>();
  return results.map((r) => friendView(r, userId, toPublicUser(r)));
}

async function friendRow(env: Env, a: string, b: string) {
  const [x, y] = orderedPair(a, b);
  return env.DB.prepare('SELECT * FROM friendships WHERE user_a = ? AND user_b = ?').bind(x, y).first<FriendRow>();
}

/** Tell both people about the current state of their friendship. */
async function announceFriendship(env: Env, row: FriendRow, a: UserRow | PublicUser, b: UserRow | PublicUser) {
  const pa = 'avatar_url' in a ? toPublicUser(a) : a;
  const pb = 'avatar_url' in b ? toPublicUser(b) : b;
  await lobby(env).notify(pa.id, { t: 'friend.upsert', friend: friendView(row, pa.id, pb) });
  await lobby(env).notify(pb.id, { t: 'friend.upsert', friend: friendView(row, pb.id, pa) });
  // New friends who are already online wouldn't otherwise see each other until a reconnect.
  if (row.status === 'accepted') {
    const online = await lobby(env).onlineAmong([pa.id, pb.id]);
    await lobby(env).notify(pa.id, { t: 'friend.presence', userId: pb.id, online: online.includes(pb.id) });
    await lobby(env).notify(pb.id, { t: 'friend.presence', userId: pa.id, online: online.includes(pa.id) });
  }
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
  if (!allow(`start|${clientIp(c.req.raw)}`, 60)) return c.html(callbackPage(false, 'Too many sign-in attempts. Wait a minute and try again.'), 429);
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
    const name = provider === 'google' ? 'Google' : 'Discord';

    // "Connect" from Settings: attach this identity to the signed-in user.
    if (row.link_user_id) {
      const result = await linkIdentity(c.env, provider, profile, row.link_user_id);
      if (result !== 'linked') {
        await c.env.DB.prepare('UPDATE login_requests SET error = ? WHERE state = ?').bind(result, state).run();
        const why =
          result === 'in_use'
            ? `This ${name} account already belongs to a different Infimeety account.`
            : `Your Infimeety account already has a ${name} account connected.`;
        return c.html(callbackPage(false, why, `Couldn't connect ${name}`), 409);
      }
      await c.env.DB.prepare('UPDATE login_requests SET session_token = ? WHERE state = ?').bind(LINKED, state).run();
      return c.html(callbackPage(true, `${name} is now connected. You can sign in with either one. Return to Infimeety.`, `${name} connected`));
    }

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
app.post('/auth/redeem', limit('redeem', 600), async (c) => {
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
  if (row.session_token === LINKED) return c.json({ linked: true });
  return c.json({ token: row.session_token });
});

/** Start connecting another sign-in method to the current account. Returns the provider URL to open. */
app.post('/auth/:provider/link', limit('link', 20), auth, async (c) => {
  const provider = c.req.param('provider');
  const { challenge } = await c.req.json<{ challenge?: string }>();
  if (!isProvider(provider) || !providerEnabled(c.env, provider)) return c.json({ error: 'not_configured' }, 400);
  if (!challenge || !/^[\w-]{43}$/.test(challenge)) return c.json({ error: 'bad_request' }, 400);
  const state = randomToken(24);
  await c.env.DB.prepare(
    'INSERT OR REPLACE INTO login_requests (state, challenge, provider, created_at, link_user_id) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(state, challenge, provider, Date.now(), c.get('user').id)
    .run();
  return c.json({ url: authorizeUrl(c.env, provider, state) });
});

/** Disconnect a sign-in method (at least one must remain). */
app.delete('/me/identities/:provider', auth, async (c) => {
  const user = c.get('user');
  const providers = await providersOf(c.env, user.id);
  if (providers.length <= 1) return c.json({ error: 'last_identity' }, 400);
  await c.env.DB.prepare('DELETE FROM identities WHERE user_id = ? AND provider = ?').bind(user.id, c.req.param('provider')).run();
  return c.json(toMe(user, await providersOf(c.env, user.id)));
});

/** Local testing only — enabled with DEV_LOGIN=true in .dev.vars. */
app.post('/auth/dev', limit('dev', 60), async (c) => {
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

app.post('/auth/logout', guestOk, async (c) => {
  const token = c.req.header('Authorization')!.slice(7);
  await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return c.json({ ok: true });
});

// ─── Profile ───────────────────────────────────────────────────────────────────

app.get('/me', guestOk, async (c) => {
  const user = c.get('user');
  return c.json(toMe(user, await providersOf(c.env, user.id)));
});

const USERNAME = /^[a-z0-9_.]{3,24}$/;

app.get('/me/username-available', limit('username', 120), auth, async (c) => {
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
app.put('/me/avatar', limit('avatar', 10), auth, async (c) => {
  const user = c.get('user');
  const type = c.req.header('Content-Type') ?? '';
  if (!AVATAR_TYPES.test(type)) return c.json({ error: 'unsupported_type' }, 415);
  if (Number(c.req.header('Content-Length') ?? 0) > 4 * 1024 * 1024) return c.json({ error: 'too_large' }, 413);
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
      // Only ever an image: never run as a page, whatever the bytes are.
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
});

/** ICE servers for WebRTC: public STUN, plus the TURN relay when one is configured. */
app.get('/ice', guestOk, async (c) => c.json({ iceServers: await iceServers(c.env) }));

/** Public health check: is the TURN relay configured and accepting our login? */
app.get('/ice/status', async (c) => c.json(await turnStatus(c.env)));

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
  // For DMs, include the other person so the app can show their name and photo.
  const { results: peers } = await env.DB.prepare(
    `SELECT m.channel_id, u.id, u.name, u.username, u.avatar_url
     FROM channel_members m JOIN users u ON u.id = m.user_id JOIN channels c ON c.id = m.channel_id
     WHERE c.kind = 'dm' AND m.user_id != ?1
       AND m.channel_id IN (SELECT channel_id FROM channel_members WHERE user_id = ?1)`,
  )
    .bind(userId)
    .all<any>();
  const now = Date.now();
  return chans.filter((ch) => !ch.expires_at || ch.expires_at > now).map((ch) => {
    const peer = peers.find((p) => p.channel_id === ch.id);
    return toChannel(
      ch,
      rooms.filter((r) => r.channel_id === ch.id).map(toRoom),
      peer ? toPublicUser(peer) : undefined,
    );
  });
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

app.get('/channels', guestOk, async (c) => c.json(await loadChannels(c.env, c.get('user').id)));

app.post('/channels', limit('create', 20), auth, async (c) => {
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

/** Public invite preview for invite links and in-chat invite cards. */
app.get('/invites/:code', limit('preview', 200), async (c) => {
  const preview = await invitePreview(c.env, c.req.param('code'));
  return preview ? c.json(preview) : c.json({ error: 'invalid_code' }, 404);
});

app.post('/channels/join', limit('join', 60), auth, async (c) => {
  const user = c.get('user');
  const { code } = await c.req.json<{ code?: string }>();
  const clean = (code ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  // Only spaces have shareable invites; DMs and meetings have their own ways in.
  const ch = await c.env.DB.prepare("SELECT id FROM channels WHERE invite_code = ? AND kind = 'space'").bind(clean).first<{ id: string }>();
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

app.get('/channels/:id/members', guestOk, requireRole('member'), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.username, u.avatar_url, u.guest_of, m.role, m.joined_at
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
  // Meeting co-hosts must have an account; browser guests can't run a meeting.
  const guest = await c.env.DB.prepare('SELECT 1 FROM users WHERE id = ? AND guest_of IS NOT NULL').bind(target).first();
  if (guest && role === 'admin') return c.json({ error: 'guest' }, 400);
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
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?').bind(id, target),
    // Someone removed from a meeting can't come back to it.
    c.env.DB.prepare(
      "INSERT OR REPLACE INTO meeting_access (channel_id, user_id, status, created_at) SELECT ?1, ?2, 'removed', ?3 FROM channels WHERE id = ?1 AND kind = 'meeting'",
    ).bind(id, target, Date.now()),
  ]);
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

app.get('/channels/:id/rooms/:roomId/messages', guestOk, requireRole('member'), async (c) => {
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

// ─── Friends & direct messages ─────────────────────────────────────────────────

app.get('/friends', auth, async (c) => {
  const friends = await friendsOf(c.env, c.get('user').id);
  const accepted = friends.filter((f) => f.status === 'accepted').map((f) => f.user.id);
  return c.json({ friends, online: await lobby(c.env).onlineAmong(accepted) });
});

/** Send a friend request by @username. If they already asked you, this accepts it. */
app.post('/friends', limit('friend', 30), auth, async (c) => {
  const me = c.get('user');
  const { username } = await c.req.json<{ username?: string }>();
  const handle = (username ?? '').trim().replace(/^@/, '').toLowerCase();
  const target = await c.env.DB.prepare('SELECT * FROM users WHERE username = ? AND onboarded = 1').bind(handle).first<UserRow>();
  if (!target) return c.json({ error: 'user_not_found' }, 404);
  if (target.id === me.id) return c.json({ error: 'self' }, 400);

  const existing = await friendRow(c.env, me.id, target.id);
  if (existing?.status === 'accepted') return c.json({ error: 'already_friends' }, 409);
  if (existing?.requested_by === me.id) return c.json({ error: 'already_requested' }, 409);

  const [a, b] = orderedPair(me.id, target.id);
  const now = Date.now();
  if (existing) {
    await c.env.DB.prepare("UPDATE friendships SET status = 'accepted', accepted_at = ? WHERE user_a = ? AND user_b = ?").bind(now, a, b).run();
  } else {
    await c.env.DB.prepare("INSERT INTO friendships (user_a, user_b, status, requested_by, created_at) VALUES (?, ?, 'pending', ?, ?)")
      .bind(a, b, me.id, now)
      .run();
  }
  const row = (await friendRow(c.env, me.id, target.id))!;
  c.executionCtx.waitUntil(announceFriendship(c.env, row, me, target));
  return c.json({ friend: friendView(row, me.id, toPublicUser(target)) });
});

app.post('/friends/:userId/accept', auth, async (c) => {
  const me = c.get('user');
  const otherId = c.req.param('userId');
  const row = await friendRow(c.env, me.id, otherId);
  if (!row || row.status !== 'pending' || row.requested_by === me.id) return c.json({ error: 'no_request' }, 404);
  const [a, b] = orderedPair(me.id, otherId);
  await c.env.DB.prepare("UPDATE friendships SET status = 'accepted', accepted_at = ? WHERE user_a = ? AND user_b = ?").bind(Date.now(), a, b).run();
  const other = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(otherId).first<UserRow>();
  const updated = (await friendRow(c.env, me.id, otherId))!;
  if (other) c.executionCtx.waitUntil(announceFriendship(c.env, updated, me, other));
  return c.json({ friend: friendView(updated, me.id, toPublicUser(other!)) });
});

/** Decline, cancel or unfriend. DM history stays, like Discord. */
app.delete('/friends/:userId', auth, async (c) => {
  const me = c.get('user');
  const otherId = c.req.param('userId');
  const [a, b] = orderedPair(me.id, otherId);
  await c.env.DB.prepare('DELETE FROM friendships WHERE user_a = ? AND user_b = ?').bind(a, b).run();
  c.executionCtx.waitUntil(
    Promise.all([
      lobby(c.env).notify(otherId, { t: 'friend.removed', userId: me.id }),
      lobby(c.env).notify(me.id, { t: 'friend.removed', userId: otherId }),
    ]),
  );
  return c.json({ ok: true });
});

/** Open (or create) the DM with a friend: a private channel with a chat room and a call room. */
app.post('/dms', auth, async (c) => {
  const me = c.get('user');
  const { userId } = await c.req.json<{ userId?: string }>();
  if (!userId || userId === me.id) return c.json({ error: 'bad_request' }, 400);
  const row = await friendRow(c.env, me.id, userId);
  if (row?.status !== 'accepted') return c.json({ error: 'not_friends' }, 403);

  const key = orderedPair(me.id, userId).join(':');
  let channel = await c.env.DB.prepare('SELECT id FROM channels WHERE dm_key = ?').bind(key).first<{ id: string }>();
  const now = Date.now();
  if (!channel) {
    const id = newId();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO channels (id, name, emoji, color, owner_id, invite_code, created_at, kind, dm_key) VALUES (?, 'Direct message', '💬', 'blue', ?, ?, ?, 'dm', ?)",
      ).bind(id, me.id, inviteCode() + inviteCode(), now, key),
      c.env.DB.prepare("INSERT INTO rooms (id, channel_id, kind, name, position, created_at) VALUES (?, ?, 'text', 'chat', 0, ?)").bind(newId(), id, now),
      c.env.DB.prepare("INSERT INTO rooms (id, channel_id, kind, name, position, created_at) VALUES (?, ?, 'voice', 'Call', 1, ?)").bind(newId(), id, now),
    ]);
    channel = { id };
  }
  // (Re)add both people, e.g. if one of them closed the DM earlier.
  for (const uid of [me.id, userId]) {
    await c.env.DB.prepare("INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)")
      .bind(channel.id, uid, now)
      .run();
  }
  c.executionCtx.waitUntil(lobby(c.env).notify(userId, { t: 'channel.added', channelId: channel.id }));
  const [dm] = await loadChannels(c.env, me.id, channel.id);
  return c.json(dm);
});

// ─── Meetings ──────────────────────────────────────────────────────────────────

/** Start a quick meeting: a short-lived channel with one call and one chat, shared by link. */
app.post('/meetings', limit('create', 20), auth, async (c) => {
  const user = c.get('user');
  const id = newId();
  const now = Date.now();
  const expiresAt = now + MEETING_TTL;
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO channels (id, name, emoji, color, owner_id, invite_code, created_at, kind, expires_at) VALUES (?, ?, '📹', 'teal', ?, ?, ?, 'meeting', ?)",
    ).bind(id, `${user.name}’s meeting`.slice(0, 60), user.id, meetingCode(), now, expiresAt),
    c.env.DB.prepare("INSERT INTO channel_members (channel_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").bind(id, user.id, now),
    c.env.DB.prepare("INSERT INTO rooms (id, channel_id, kind, name, position, created_at) VALUES (?, ?, 'text', 'chat', 0, ?)").bind(newId(), id, now),
    c.env.DB.prepare("INSERT INTO rooms (id, channel_id, kind, name, position, created_at) VALUES (?, ?, 'voice', 'Meeting', 1, ?)").bind(newId(), id, now),
  ]);
  await hub(c.env, id).startMeeting(id, expiresAt);
  c.executionCtx.waitUntil(sweepMeetings(c.env));
  const [channel] = await loadChannels(c.env, user.id, id);
  return c.json(channel, 201);
});

/** Public preview for the meeting link page and the app's "Join?" sheet. */
app.get('/meetings/:code', limit('preview', 200), async (c) => {
  const preview = await meetingPreview(c.env, c.req.param('code'));
  return preview ? c.json(preview) : c.json({ error: 'meeting_ended' }, 404);
});

/** Infimeety users walk straight in, unless the host removed them earlier. */
app.post('/meetings/:code/join', limit('join', 60), auth, async (c) => {
  const user = c.get('user');
  const meeting = await findMeeting(c.env, c.req.param('code'));
  if (!meeting) return c.json({ error: 'meeting_ended' }, 404);
  const access = await c.env.DB.prepare('SELECT status FROM meeting_access WHERE channel_id = ? AND user_id = ?')
    .bind(meeting.id, user.id)
    .first<{ status: string }>();
  if (access?.status === 'removed') return c.json({ error: 'removed' }, 403);
  const res = await c.env.DB.prepare("INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)")
    .bind(meeting.id, user.id, Date.now())
    .run();
  if (res.meta.changes) c.executionCtx.waitUntil(hub(c.env, meeting.id).notify({ t: 'channel.changed' }));
  const [channel] = await loadChannels(c.env, user.id, meeting.id);
  return c.json(channel);
});

/**
 * A browser guest asks to join. They get a guest account that only exists inside this
 * meeting and wait in the lobby until the host or a co-host lets them in.
 */
app.post('/meetings/:code/guests', limit('guest', 60), async (c) => {
  const meeting = await findMeeting(c.env, c.req.param('code'));
  if (!meeting) return c.json({ error: 'meeting_ended' }, 404);
  const { name } = await c.req.json<{ name?: string }>();
  const clean = (name ?? '').trim().replace(/\s+/g, ' ').slice(0, 32);
  if (!clean) return c.json({ error: 'name_required' }, 400);
  const waiting = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM meeting_access WHERE channel_id = ? AND status = 'waiting'")
    .bind(meeting.id)
    .first<{ n: number }>();
  if ((waiting?.n ?? 0) >= MAX_WAITING) return c.json({ error: 'lobby_full' }, 429);

  const id = newId();
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO users (id, name, onboarded, created_at, guest_of) VALUES (?, ?, 1, ?, ?)').bind(id, clean, now, meeting.id),
    c.env.DB.prepare("INSERT INTO meeting_access (channel_id, user_id, status, created_at) VALUES (?, ?, 'waiting', ?)").bind(meeting.id, id, now),
  ]);
  const token = await createSession(c.env, id);
  c.executionCtx.waitUntil(announceWaiting(c.env, meeting.id));
  return c.json({ token, status: 'waiting' }, 201);
});

/** The guest's waiting screen polls this until they're let in (then it carries the meeting). */
app.get('/meetings/:code/guest', guestOk, async (c) => {
  const user = c.get('user');
  const meeting = await findMeeting(c.env, c.req.param('code'));
  if (!meeting || user.guest_of !== meeting.id) return c.json({ error: 'meeting_ended' }, 404);
  if (await memberRole(c.env, meeting.id, user.id)) {
    const [channel] = await loadChannels(c.env, user.id, meeting.id);
    return c.json({ status: 'admitted', channel });
  }
  const access = await c.env.DB.prepare('SELECT status FROM meeting_access WHERE channel_id = ? AND user_id = ?')
    .bind(meeting.id, user.id)
    .first<{ status: string }>();
  return c.json({ status: access?.status ?? 'denied' });
});

const requireMeeting = createMiddleware<App>(async (c, next) => {
  const row = await c.env.DB.prepare("SELECT 1 FROM channels WHERE id = ? AND kind = 'meeting'").bind(c.req.param('id')).first();
  if (!row) return c.json({ error: 'not_found' }, 404);
  await next();
});

app.get('/channels/:id/guests', auth, requireRole('admin'), requireMeeting, async (c) => c.json(await waitingGuests(c.env, c.req.param('id'))));

/** Let a waiting guest in, or turn them away. */
app.post('/channels/:id/guests/:userId', auth, requireRole('admin'), requireMeeting, async (c) => {
  const id = c.req.param('id');
  const target = c.req.param('userId');
  const { admit } = await c.req.json<{ admit?: boolean }>();
  const access = await c.env.DB.prepare('SELECT status FROM meeting_access WHERE channel_id = ? AND user_id = ?').bind(id, target).first<{ status: string }>();
  if (access?.status !== 'waiting') return c.json({ error: 'not_waiting' }, 404);
  if (admit) {
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM meeting_access WHERE channel_id = ? AND user_id = ?').bind(id, target),
      c.env.DB.prepare("INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").bind(id, target, Date.now()),
    ]);
    c.executionCtx.waitUntil(hub(c.env, id).notify({ t: 'channel.changed' }));
  } else {
    await c.env.DB.prepare("UPDATE meeting_access SET status = 'denied' WHERE channel_id = ? AND user_id = ?").bind(id, target).run();
  }
  c.executionCtx.waitUntil(announceWaiting(c.env, id));
  return c.json({ ok: true });
});

/** The host ends the meeting for everyone; its chat and guests are deleted. */
app.post('/channels/:id/end', auth, requireRole('owner'), requireMeeting, async (c) => {
  await endMeeting(c.env, c.req.param('id'));
  return c.json({ ok: true });
});

// ─── Realtime ──────────────────────────────────────────────────────────────────

/** Browsers can't set headers on WebSockets, so the session token rides in the subprotocol list. */
const socketUser = (c: { env: Env; req: { header: (n: string) => string | undefined } }) => {
  const protocols = (c.req.header('Sec-WebSocket-Protocol') ?? '').split(',').map((p) => p.trim());
  return userFromToken(c.env, protocols.find((p) => p && p !== 'infimeety'));
};

/** Per-user socket for presence and notifications (friends, new DMs). */
app.get('/me/ws', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') return c.text('Expected a WebSocket upgrade', 426);
  const user = await socketUser(c);
  if (!user || user.guest_of) return c.text('Unauthorized', 401);
  const req = new Request(c.req.raw);
  req.headers.set('X-Infimeety-User', user.id);
  return lobby(c.env).fetch(req);
});

app.get('/channels/:id/ws', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') return c.text('Expected a WebSocket upgrade', 426);
  const user = await socketUser(c);
  if (!user) return c.text('Unauthorized', 401);
  const channelId = c.req.param('id');
  const role = await memberRole(c.env, channelId, user.id);
  if (!role) return c.text('Forbidden', 403);

  const req = new Request(c.req.raw);
  req.headers.set('X-Infimeety-Peer', JSON.stringify({ userId: user.id, role, channelId, guest: !!user.guest_of }));
  return hub(c.env, channelId).fetch(req);
});

export default app;
