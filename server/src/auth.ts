import type { Provider } from '../../shared/protocol';
import { type Env, type UserRow, newId, randomToken, sha256 } from './util';

interface Profile {
  providerId: string;
  email: string | null;
  emailVerified: boolean;
  name: string;
  handle: string | null;
  avatar: string | null;
}

interface OAuthProvider {
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  extra?: Record<string, string>;
  creds(env: Env): { id?: string; secret?: string };
  profile(accessToken: string): Promise<Profile>;
}

export const providers: Record<'google' | 'discord', OAuthProvider> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    extra: { prompt: 'select_account' },
    creds: (env) => ({ id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET }),
    async profile(token) {
      const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Google profile request failed');
      const p = await res.json<any>();
      return {
        providerId: String(p.sub),
        email: p.email ?? null,
        emailVerified: !!p.email_verified,
        name: p.name || p.given_name || 'New friend',
        handle: p.email ? String(p.email).split('@')[0] : null,
        // Google serves a 96px image by default; ask for a sharper one.
        avatar: p.picture ? String(p.picture).replace(/=s\d+-c$/, '=s256-c') : null,
      };
    },
  },
  discord: {
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    scope: 'identify email',
    creds: (env) => ({ id: env.DISCORD_CLIENT_ID, secret: env.DISCORD_CLIENT_SECRET }),
    async profile(token) {
      const res = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Discord profile request failed');
      const p = await res.json<any>();
      const avatar = p.avatar
        ? `https://cdn.discordapp.com/avatars/${p.id}/${p.avatar}.${String(p.avatar).startsWith('a_') ? 'gif' : 'png'}?size=256`
        : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(p.id) >> 22n) % 6n)}.png`;
      return {
        providerId: String(p.id),
        email: p.email ?? null,
        emailVerified: !!p.verified,
        name: p.global_name || p.username || 'New friend',
        handle: p.username ?? null,
        avatar,
      };
    },
  },
};

export const isProvider = (p: string): p is keyof typeof providers => p === 'google' || p === 'discord';

export function providerEnabled(env: Env, p: keyof typeof providers) {
  const { id, secret } = providers[p].creds(env);
  return !!(id && secret);
}

const redirectUri = (env: Env, provider: string) => `${env.PUBLIC_URL}/auth/${provider}/callback`;

export function authorizeUrl(env: Env, provider: keyof typeof providers, state: string) {
  const p = providers[provider];
  const url = new URL(p.authorizeUrl);
  url.searchParams.set('client_id', p.creds(env).id!);
  url.searchParams.set('redirect_uri', redirectUri(env, provider));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', p.scope);
  url.searchParams.set('state', state);
  for (const [k, v] of Object.entries(p.extra ?? {})) url.searchParams.set(k, v);
  return url.toString();
}

export async function exchangeCode(env: Env, provider: keyof typeof providers, code: string): Promise<Profile> {
  const p = providers[provider];
  const { id, secret } = p.creds(env);
  const res = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(env, provider),
      client_id: id!,
      client_secret: secret!,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status})`);
  const { access_token } = await res.json<{ access_token: string }>();
  return p.profile(access_token);
}

async function uniqueUsername(env: Env, base: string | null): Promise<string> {
  let stem = (base ?? 'friend').toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 18);
  if (stem.length < 3) stem = `friend${stem}`;
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? stem : `${stem}${Math.floor(Math.random() * 9000 + 100)}`;
    const taken = await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(candidate).first();
    if (!taken) return candidate;
  }
  return `${stem}${Date.now().toString(36).slice(-5)}`;
}

/** Finds or creates the user for an identity. Verified emails link Google + Discord into one account. */
export async function upsertUser(env: Env, provider: Provider, profile: Profile): Promise<string> {
  const existing = await env.DB.prepare('SELECT user_id FROM identities WHERE provider = ? AND provider_id = ?')
    .bind(provider, profile.providerId)
    .first<{ user_id: string }>();
  if (existing) {
    // Keep the provider photo fresh; it stays the default unless the user uploaded their own.
    await env.DB.prepare(
      'UPDATE users SET provider_avatar_url = ?, avatar_url = CASE WHEN avatar_key IS NULL THEN ? ELSE avatar_url END WHERE id = ?',
    )
      .bind(profile.avatar, profile.avatar, existing.user_id)
      .run();
    return existing.user_id;
  }

  if (profile.email && profile.emailVerified) {
    const byEmail = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(profile.email).first<{ id: string }>();
    if (byEmail) {
      await env.DB.prepare('INSERT INTO identities (provider, provider_id, user_id) VALUES (?, ?, ?)')
        .bind(provider, profile.providerId, byEmail.id)
        .run();
      return byEmail.id;
    }
  }

  const id = newId();
  const username = await uniqueUsername(env, profile.handle);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, name, username, avatar_url, provider_avatar_url, onboarded, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    ).bind(id, profile.email, profile.name.slice(0, 48), username, profile.avatar, profile.avatar, Date.now()),
    env.DB.prepare('INSERT INTO identities (provider, provider_id, user_id) VALUES (?, ?, ?)').bind(
      provider,
      profile.providerId,
      id,
    ),
  ]);
  return id;
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const token = randomToken(32);
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), userId, Date.now())
    .run();
  return token;
}

export async function userFromToken(env: Env, token: string | null | undefined): Promise<UserRow | null> {
  if (!token || token.length > 128) return null;
  return env.DB.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?')
    .bind(await sha256(token))
    .first<UserRow>();
}

/**
 * Attaches a provider identity to an existing user ("Connect Discord" in Settings).
 * One identity per provider per user; an identity can't move between accounts.
 */
export async function linkIdentity(env: Env, provider: Provider, profile: Profile, userId: string): Promise<'linked' | 'in_use' | 'provider_taken'> {
  const existing = await env.DB.prepare('SELECT user_id FROM identities WHERE provider = ? AND provider_id = ?')
    .bind(provider, profile.providerId)
    .first<{ user_id: string }>();
  if (existing) return existing.user_id === userId ? 'linked' : 'in_use';
  const sameProvider = await env.DB.prepare('SELECT 1 FROM identities WHERE user_id = ? AND provider = ?').bind(userId, provider).first();
  if (sameProvider) return 'provider_taken';
  await env.DB.batch([
    env.DB.prepare('INSERT INTO identities (provider, provider_id, user_id) VALUES (?, ?, ?)').bind(provider, profile.providerId, userId),
    // Fill gaps (e.g. a Discord-only account gains an email), never overwrite.
    env.DB.prepare('UPDATE users SET email = COALESCE(email, ?), provider_avatar_url = COALESCE(provider_avatar_url, ?) WHERE id = ?').bind(
      profile.email,
      profile.avatar,
      userId,
    ),
  ]);
  return 'linked';
}

export function callbackPage(ok: boolean, detail: string, heading?: string) {
  const title = heading ?? (ok ? "You're signed in" : 'Sign-in failed');
  const body = ok ? detail || 'You can close this tab and return to Infimeety.' : detail;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Infimeety</title><style>
  :root{color-scheme:dark}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(1200px 600px at 20% 10%,#2b3a8f55,transparent),radial-gradient(900px 500px at 90% 90%,#7a2b8f44,transparent),#0b0b10;
       font-family:"SF Pro Display",-apple-system,"Inter","Segoe UI",system-ui,sans-serif;color:#f5f5f7}
  .card{padding:40px 48px;border-radius:28px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
        backdrop-filter:blur(40px) saturate(180%);text-align:center;box-shadow:0 30px 80px rgba(0,0,0,.45);max-width:360px}
  .icon{width:56px;height:56px;border-radius:50%;margin:0 auto 18px;display:grid;place-items:center;font-size:28px;
        background:${ok ? 'linear-gradient(135deg,#34c759,#30d158)' : 'linear-gradient(135deg,#ff453a,#ff375f)'}}
  h1{font-size:22px;font-weight:600;letter-spacing:-.02em;margin:0 0 8px}
  p{margin:0;color:rgba(245,245,247,.6);font-size:15px;line-height:1.45}
</style></head><body><div class="card"><div class="icon">${ok ? '✓' : '!'}</div><h1>${title}</h1><p>${escapeHtml(body)}</p></div>
<script>${WEB_RETURN_SCRIPT}</script></body></html>`;
}

/**
 * The web app (same site, /web/) marks a sign-in it started in localStorage, then leaves for
 * the provider in the same tab. Back here, send that tab home; it collects the session itself.
 * Sign-ins from the desktop app never set the mark, so they see this page as before.
 */
const WEB_RETURN_SCRIPT = `try{var t=+localStorage.getItem('infimeety.webSignInReturn');if(t){localStorage.removeItem('infimeety.webSignInReturn');if(Date.now()-t<9e5)location.replace('/web/')}}catch(e){}`;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
