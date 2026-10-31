import type { Me } from '../../../shared/protocol';
import { getToken, setToken } from './api';

/**
 * Several accounts on one device, like Discord: each signed-in account is remembered with its
 * session, so switching is one click and adding one doesn't sign the others out. The sessions
 * stay on this device, next to the one the app already keeps.
 */

export interface SavedAccount {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  token: string;
}

const KEY = 'infimeety.accounts';
const ADDING = 'infimeety.addingAccount';
/** Discord's limit too: plenty, and the menu stays short. */
const MAX = 5;

export function savedAccounts(): SavedAccount[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((a) => a && typeof a.id === 'string' && typeof a.token === 'string') : [];
  } catch {
    return [];
  }
}

function save(list: SavedAccount[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* private mode: switching just won't remember */
  }
}

/** Signed in: remember this account (or refresh its name and picture) with its session. */
export function rememberAccount(me: Me) {
  const token = getToken();
  if (!token) return;
  const entry: SavedAccount = { id: me.id, name: me.name, username: me.username ?? '', avatarUrl: me.avatarUrl ?? null, token };
  save([entry, ...savedAccounts().filter((a) => a.id !== me.id)]);
  try {
    sessionStorage.removeItem(ADDING);
  } catch {
    /* fine */
  }
}

/** Forgets an account here (its session was signed out or no longer works). */
export function forgetAccount(id: string) {
  save(savedAccounts().filter((a) => a.id !== id));
}

/** The remembered account whose session the app is using, if any. */
export function currentAccountId() {
  const token = getToken();
  return savedAccounts().find((a) => a.token === token)?.id ?? null;
}

/** Starts the app again on another remembered account. */
export function switchAccount(id: string) {
  const account = savedAccounts().find((a) => a.id === id);
  if (!account) return;
  setToken(account.token);
  location.reload();
}

/** Opens the sign-in screen for one more account; the ones already here stay signed in. */
export function addAccount() {
  try {
    sessionStorage.setItem(ADDING, '1');
  } catch {
    /* fine */
  }
  setToken(null);
  location.reload();
}

export const addingAccount = () => {
  try {
    return sessionStorage.getItem(ADDING) === '1';
  } catch {
    return false;
  }
};

/** Changed your mind on the sign-in screen: back to the account you were on. */
export function cancelAddAccount() {
  try {
    sessionStorage.removeItem(ADDING);
  } catch {
    /* fine */
  }
  const first = savedAccounts()[0];
  if (first) switchAccount(first.id);
}
