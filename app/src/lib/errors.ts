import { API_URL, APP_VERSION } from '@/config';

/**
 * Crash reports: what broke, where, on which version and system, so problems show up before
 * friends have to report them. No messages, names or files: just the error and its stack.
 * Sent to our own server (Cloudflare's logs keep them); a handful per session at most.
 */

const sent = new Set<string>();
let budget = 8;

export function reportError(error: unknown, where: string) {
  const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error ?? null));
  const key = `${where}:${err.message}`;
  if (sent.has(key) || budget <= 0) return;
  sent.add(key);
  budget--;
  const body = JSON.stringify({
    where,
    message: err.message.slice(0, 500),
    stack: (err.stack ?? '').slice(0, 3000),
    version: APP_VERSION,
    app: '__TAURI_INTERNALS__' in window ? 'app' : 'web',
    agent: navigator.userAgent.slice(0, 200),
  });
  try {
    void fetch(`${API_URL}/errors`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch {
    /* offline: nothing to do */
  }
}

/** Errors nothing caught: logged and reported, never shown as a broken screen. */
export function startErrorReports() {
  window.addEventListener('error', (e) => {
    // Resource load failures (a missing avatar) aren't crashes.
    if (e.error) reportError(e.error, 'uncaught');
  });
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'promise'));
}
