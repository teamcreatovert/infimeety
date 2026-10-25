import { API_URL } from '@/config';

const TOKEN_KEY = 'infimeety.session';

let token: string | null = localStorage.getItem(TOKEN_KEY);
let onUnauthorized: (() => void) | null = null;

export const getToken = () => token;

export function setToken(next: string | null) {
  token = next;
  if (next) localStorage.setItem(TOKEN_KEY, next);
  else localStorage.removeItem(TOKEN_KEY);
}

export function handleUnauthorized(fn: () => void) {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

type Init = Omit<RequestInit, 'body'> & { json?: unknown; body?: BodyInit };

export async function api<T = unknown>(path: string, init: Init = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(API_URL + path, { ...init, headers, body });
  } catch {
    throw new ApiError(0, 'offline');
  }
  if (res.status === 401 && token) onUnauthorized?.();
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'request_failed');
  return data as T;
}

export function b64url(bytes: ArrayBuffer | Uint8Array) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const randomId = (bytes = 16) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

export async function sha256(input: string) {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)));
}
