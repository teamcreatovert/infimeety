/**
 * Rate limits, counted in this isolate's memory. Cloudflare runs many isolates, so these
 * aren't global totals, but a client hammering an endpoint keeps landing on the same few
 * (same data centre), so it gets cut off quickly, and checking costs nothing.
 */

const windows = new Map<string, { start: number; count: number }>();

/** True while `key` has made at most `limit` requests in the current `windowMs`. */
export function allow(key: string, limit: number, windowMs = 60_000) {
  const now = Date.now();
  const w = windows.get(key);
  if (w && now - w.start < windowMs) return ++w.count <= limit;
  if (windows.size > 20_000) {
    for (const [k, v] of windows) if (now - v.start >= 60_000) windows.delete(k);
  }
  windows.set(key, { start: now, count: 1 });
  return true;
}

/** The caller's address, as Cloudflare saw it. */
export const clientIp = (req: Request) => req.headers.get('CF-Connecting-IP') ?? 'local';

/**
 * Per-connection allowances for realtime messages: a burst, then a steady rate per second.
 * Generous enough for real use (a call's signaling, a fast typist), tight enough that one
 * socket can't flood a channel or its database.
 */
export const SOCKET_RATES = {
  chat: [8, 1],
  react: [20, 3],
  typing: [10, 2],
  rtc: [600, 100],
  media: [60, 5],
  party: [30, 6],
  voice: [40, 8],
  other: [60, 10],
} as const satisfies Record<string, readonly [number, number]>;

export type SocketRate = keyof typeof SOCKET_RATES;

export class Buckets {
  private buckets = new Map<string, { tokens: number; at: number }>();

  /** Takes one token from `owner`'s `kind` bucket; false if it's empty. */
  take(owner: string, kind: SocketRate) {
    const [burst, perSecond] = SOCKET_RATES[kind];
    const key = `${owner}|${kind}`;
    const now = Date.now();
    const b = this.buckets.get(key) ?? { tokens: burst, at: now };
    b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * perSecond);
    b.at = now;
    this.buckets.set(key, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  forget(owner: string) {
    for (const key of this.buckets.keys()) if (key.startsWith(`${owner}|`)) this.buckets.delete(key);
  }
}
