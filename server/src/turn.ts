import { connect } from 'cloudflare:sockets';
import type { Env } from './util';

// ICE servers for WebRTC. Most calls connect directly via STUN; a TURN relay carries the
// rest (strict corporate or mobile NATs). Two relay setups are supported:
//   • any TURN server with a fixed login (ExpressTURN's free plan, Metered, your own coturn):
//     TURN_SERVER ("host:port"), TURN_USERNAME, TURN_PASSWORD
//   • Cloudflare Realtime TURN with short-lived logins: TURN_KEY_ID, TURN_KEY_API_TOKEN

export type IceServer = { urls: string[]; username?: string; credential?: string };
const STUN: IceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];

type StaticRelay = { host: string; username: string; password: string };

function staticRelay(env: Env): StaticRelay | null {
  const host = env.TURN_SERVER?.trim().replace(/^turns?:/, '');
  const username = env.TURN_USERNAME?.trim();
  const password = env.TURN_PASSWORD?.trim();
  return host && username && password ? { host, username, password } : null;
}

/**
 * Short-lived Cloudflare TURN credentials.
 * Returns null when it isn't configured or Cloudflare refuses.
 */
async function cloudflareTurn(env: Env): Promise<IceServer[] | null> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return null;
  // Current endpoint first; the older one is kept as a fallback.
  for (const path of ['generate-ice-servers', 'generate']) {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 86400 }),
    });
    if (res.status === 404) continue;
    if (!res.ok) return null;
    const { iceServers } = await res.json<{ iceServers: unknown }>();
    const list = (Array.isArray(iceServers) ? iceServers : [iceServers]) as { urls: string | string[]; username?: string; credential?: string }[];
    // Browsers block port 53; those URLs would only slow down connecting.
    return list.map((s) => ({ ...s, urls: [s.urls].flat().filter((u) => !/:53(\?|$)/.test(u)) })).filter((s) => s.urls.length);
  }
  return null;
}

/** What /ice hands to signed-in clients. */
export async function iceServers(env: Env): Promise<IceServer[]> {
  const relay = staticRelay(env);
  if (relay) {
    const urls = [`turn:${relay.host}?transport=udp`, `turn:${relay.host}?transport=tcp`];
    return [...STUN, { urls, username: relay.username, credential: relay.password }];
  }
  return (await cloudflareTurn(env)) ?? STUN;
}

/** Public health check. Never includes credentials. */
export async function turnStatus(env: Env) {
  const relay = staticRelay(env);
  if (relay) return { ...(await probeTurn(relay)), relay: relay.host };
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return { turn: 'not_configured' };
  const relays = (await cloudflareTurn(env))?.flatMap((s) => s.urls).filter((u) => u.startsWith('turn')) ?? [];
  return { turn: relays.length ? 'ok' : 'error', relays: relays.map((u) => u.split('?')[0]) };
}

// ─── Relay probe ───────────────────────────────────────────────────────────────
// Asks the relay for a real allocation over TCP (RFC 8656), so a wrong password, a refreshed
// login or a dead server shows up here instead of as a silent call failure. Closing the
// connection releases the allocation.

const ALLOCATE = 0x0003;
const ALLOCATE_OK = 0x0103;
const A_USERNAME = 0x0006;
const A_INTEGRITY = 0x0008;
const A_ERROR = 0x0009;
const A_REALM = 0x0014;
const A_NONCE = 0x0015;
const A_TRANSPORT = 0x0019;

const pad4 = (n: number) => (n + 3) & ~3;
const u16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) out.set(p, (at += p.length) - p.length);
  return out;
}

function stunAttr(type: number, value: Uint8Array) {
  const out = new Uint8Array(4 + pad4(value.length));
  const view = new DataView(out.buffer);
  view.setUint16(0, type);
  view.setUint16(2, value.length);
  out.set(value, 4);
  return out;
}

async function stunMessage(type: number, attrs: Uint8Array[], key?: ArrayBuffer) {
  const body = concat(...attrs);
  const header = new Uint8Array(20);
  const view = new DataView(header.buffer);
  view.setUint16(0, type);
  view.setUint16(2, body.length + (key ? 24 : 0)); // the length covers MESSAGE-INTEGRITY
  view.setUint32(4, 0x2112a442);
  crypto.getRandomValues(header.subarray(8));
  const msg = concat(header, body);
  if (!key) return msg;
  const hmac = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  return concat(msg, stunAttr(A_INTEGRITY, new Uint8Array(await crypto.subtle.sign('HMAC', hmac, msg))));
}

function stunAttrs(msg: Uint8Array) {
  const attrs = new Map<number, Uint8Array>();
  for (let i = 20; i + 4 <= msg.length; i += 4 + pad4(u16(msg, i + 2))) {
    attrs.set(u16(msg, i), msg.subarray(i + 4, i + 4 + u16(msg, i + 2)));
  }
  return attrs;
}

type Probe = { turn: 'ok' | 'unauthorized' | 'unreachable'; code?: number };

/** `code` is the relay's STUN error: 401 wrong password, 441 unknown username, 486 quota used up. */
async function probeTurn({ host, username, password }: StaticRelay): Promise<Probe> {
  const [hostname, port = '3478'] = host.split(':');
  const socket = connect({ hostname, port: Number(port) });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  let buffered = new Uint8Array(0);

  const readMessage = async () => {
    for (;;) {
      const size = buffered.length >= 20 ? 20 + u16(buffered, 2) : Infinity;
      if (buffered.length >= size) {
        const msg = buffered.slice(0, size);
        buffered = buffered.slice(size);
        return msg;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('closed');
      buffered = concat(buffered, value);
    }
  };

  const errorCode = (msg: Uint8Array) => {
    const error = stunAttrs(msg).get(A_ERROR);
    return error ? (error[2] & 7) * 100 + error[3] : undefined;
  };

  const probe = async (): Promise<Probe> => {
    const transport = stunAttr(A_TRANSPORT, new Uint8Array([17, 0, 0, 0])); // UDP relay
    await writer.write(await stunMessage(ALLOCATE, [transport]));
    let res = await readMessage();
    if (u16(res, 0) === ALLOCATE_OK) return { turn: 'ok' };

    // Expected: 401 with the realm and nonce to sign the real request with.
    const challenge = stunAttrs(res);
    const realm = challenge.get(A_REALM);
    const nonce = challenge.get(A_NONCE);
    if (!realm || !nonce) return { turn: 'unreachable', code: errorCode(res) };
    const realmText = new TextDecoder().decode(realm);
    const key = await crypto.subtle.digest('MD5', new TextEncoder().encode(`${username}:${realmText}:${password}`));
    const auth = [stunAttr(A_USERNAME, new TextEncoder().encode(username)), stunAttr(A_REALM, realm), stunAttr(A_NONCE, nonce)];
    await writer.write(await stunMessage(ALLOCATE, [transport, ...auth], key));
    res = await readMessage();
    if (u16(res, 0) === ALLOCATE_OK) return { turn: 'ok' };
    const code = errorCode(res);
    return { turn: code === 401 || code === 441 ? 'unauthorized' : 'unreachable', code };
  };

  const timeout = new Promise<Probe>((resolve) => setTimeout(() => resolve({ turn: 'unreachable' }), 6000));
  try {
    return await Promise.race([probe(), timeout]);
  } catch {
    return { turn: 'unreachable' };
  } finally {
    socket.close().catch(() => {});
  }
}
