import { create } from 'zustand';
import type { Me } from '../../../shared/protocol';
import { currentAccountId, forgetAccount, rememberAccount, savedAccounts, switchAccount } from '@/lib/accounts';
import { api, ApiError, getToken, handleUnauthorized, randomId, setToken, sha256 } from '@/lib/api';
import { isApp, isTauri, openExternal } from '@/lib/platform';
import { pendingLink } from '@/lib/weblinks';
import { API_URL } from '@/config';
import { useMeetings } from './meetings';
import { useUI } from './ui';

type Status = 'loading' | 'signedOut' | 'onboarding' | 'ready';
type OAuthProvider = 'google' | 'discord';

interface AuthState {
  status: Status;
  me: Me | null;
  providers: { google: boolean; discord: boolean; dev: boolean } | null;
  pending: OAuthProvider | null;
  error: string | null;
  init: () => Promise<void>;
  loadProviders: () => Promise<void>;
  signIn: (provider: OAuthProvider) => Promise<void>;
  cancelSignIn: () => void;
  devSignIn: (name: string) => Promise<void>;
  /** Connect another sign-in method to the current account (opens the browser). */
  link: (provider: OAuthProvider) => Promise<'linked' | 'cancelled' | string>;
  unlink: (provider: OAuthProvider) => Promise<void>;
  linking: OAuthProvider | null;
  signOut: () => Promise<void>;
  setMe: (me: Me) => void;
}

let pollAbort: AbortController | null = null;

/**
 * The web app on Infimeety's own site signs in like any website: it leaves for Google or
 * Discord and comes back. The verifier waits in this tab meanwhile; the sign-in page sends
 * the browser back here when it sees `WEB_RETURN` (same site, so it can).
 */
const WEB_SIGNIN = 'infimeety.webSignIn';
const WEB_RETURN = 'infimeety.webSignInReturn';
const redirectSignIn = !isTauri && typeof location !== 'undefined' && new URL(API_URL, location.href).origin === location.origin;

interface WebSignIn {
  verifier: string;
  provider: OAuthProvider;
  at: number;
  link: typeof pendingLink;
}

const session = {
  take(): WebSignIn | null {
    try {
      const raw = sessionStorage.getItem(WEB_SIGNIN);
      sessionStorage.removeItem(WEB_SIGNIN);
      const s = raw ? (JSON.parse(raw) as WebSignIn) : null;
      return s && Date.now() - s.at < 15 * 60_000 ? s : null;
    } catch {
      return null;
    }
  },
  put(s: WebSignIn) {
    try {
      sessionStorage.setItem(WEB_SIGNIN, JSON.stringify(s));
      localStorage.setItem(WEB_RETURN, String(s.at));
      return true;
    } catch {
      return false;
    }
  },
};

/** Opened in the click itself, so popup blockers allow it; pointed at the provider once it's known. */
const blankTab = () => (isApp ? null : window.open('', '_blank'));

async function openIn(tab: Window | null, url: string) {
  if (tab && !tab.closed) tab.location.href = url;
  else await openExternal(url);
}

export const useAuth = create<AuthState>()((set, get) => {
  async function loadMe() {
    const me = await api<Me>('/me');
    rememberAccount(me);
    set({ me, status: me.onboarded ? 'ready' : 'onboarding', error: null });
  }

  /** This account's session is over: forget it here, and carry on with the next one if there is one. */
  function leaveAccount() {
    const current = currentAccountId();
    if (current) forgetAccount(current);
    setToken(null);
    const next = savedAccounts()[0];
    if (next) return switchAccount(next.id);
    set({ me: null, status: 'signedOut' });
  }

  handleUnauthorized(leaveAccount);

  return {
    status: 'loading',
    me: null,
    providers: null,
    pending: null,
    error: null,

    async init() {
      void get().loadProviders();
      const back = redirectSignIn ? session.take() : null;
      if (back) await finishWebSignIn(back);
      if (!getToken()) return set({ status: 'signedOut' });
      try {
        await loadMe();
      } catch (err) {
        // Offline at launch: keep the session and retry instead of signing the user out.
        if (err instanceof ApiError && err.status === 0) {
          set({ error: 'offline' });
          setTimeout(() => void get().init(), 4000);
        } else {
          set({ status: 'signedOut' });
        }
      }
    },

    async loadProviders() {
      try {
        set({ providers: await api('/auth/providers') });
      } catch {
        set({ providers: null });
      }
    },

    /**
     * Opens the provider in the system browser, then polls until the backend hands over
     * a session. Only this app knows the verifier, so the browser URL alone can't redeem it.
     */
    async signIn(provider) {
      pollAbort?.abort();
      const abort = (pollAbort = new AbortController());
      const verifier = randomId(32);
      if (redirectSignIn && session.put({ verifier, provider, at: Date.now(), link: pendingLink })) {
        set({ pending: provider, error: null });
        location.assign(`${API_URL}/auth/${provider}/start?challenge=${await sha256(verifier)}`);
        return;
      }
      const tab = blankTab();
      const challenge = await sha256(verifier);
      set({ pending: provider, error: null });
      await openIn(tab, `${API_URL}/auth/${provider}/start?challenge=${challenge}`);

      const deadline = Date.now() + 5 * 60_000;
      while (!abort.signal.aborted && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1200));
        if (abort.signal.aborted) return;
        try {
          const res = await api<{ token?: string }>('/auth/redeem', { method: 'POST', json: { verifier } });
          if (res.token) {
            setToken(res.token);
            set({ pending: null });
            await loadMe();
            return;
          }
        } catch (err) {
          if (err instanceof ApiError && err.status === 400) {
            set({ pending: null, error: err.code === 'cancelled' ? null : 'Sign-in failed. Please try again.' });
            return;
          }
        }
      }
      if (!abort.signal.aborted) set({ pending: null, error: 'Sign-in timed out. Please try again.' });
    },

    cancelSignIn() {
      pollAbort?.abort();
      set({ pending: null });
    },

    linking: null,

    async link(provider) {
      const tab = blankTab();
      const verifier = randomId(32);
      const challenge = await sha256(verifier);
      const { url } = await api<{ url: string }>(`/auth/${provider}/link`, { method: 'POST', json: { challenge } }).catch((err) => {
        tab?.close();
        throw err;
      });
      set({ linking: provider });
      await openIn(tab, url);
      try {
        const deadline = Date.now() + 5 * 60_000;
        while (Date.now() < deadline && get().linking === provider) {
          await new Promise((r) => setTimeout(r, 1200));
          try {
            const res = await api<{ linked?: boolean }>('/auth/redeem', { method: 'POST', json: { verifier } });
            if (res.linked) {
              await loadMe();
              return 'linked';
            }
          } catch (err) {
            if (err instanceof ApiError && err.status === 400) return err.code;
          }
        }
        return 'cancelled';
      } finally {
        set({ linking: null });
      }
    },

    async unlink(provider) {
      const me = await api<Me>(`/me/identities/${provider}`, { method: 'DELETE' });
      set({ me });
    },

    async devSignIn(name) {
      const { token } = await api<{ token: string }>('/auth/dev', { method: 'POST', json: { name } });
      setToken(token);
      await loadMe();
    },

    async signOut() {
      try {
        await api('/auth/logout', { method: 'POST' });
      } catch {
        /* already invalid */
      }
      leaveAccount();
    },

    setMe(me) {
      rememberAccount(me);
      set({ me, status: me.onboarded ? 'ready' : 'onboarding' });
    },
  };
});

/** Back from Google or Discord in the web app: collect the session the sign-in page parked for us. */
async function finishWebSignIn(back: WebSignIn) {
  useAuth.setState({ pending: back.provider });
  // Bring back the meeting or invite link the page was opened with.
  if (back.link?.kind === 'meet') useMeetings.getState().set({ joining: back.link.code });
  if (back.link?.kind === 'invite') useUI.getState().set({ pendingInvite: back.link.code });
  try {
    for (let i = 0; i < 5; i++) {
      try {
        const res = await api<{ token?: string }>('/auth/redeem', { method: 'POST', json: { verifier: back.verifier } });
        if (res.token) return setToken(res.token);
      } catch (err) {
        if (err instanceof ApiError && err.status === 400) {
          if (err.code !== 'cancelled') useAuth.setState({ error: 'Sign-in failed. Please try again.' });
          return;
        }
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    useAuth.setState({ error: 'Sign-in timed out. Please try again.' });
  } finally {
    useAuth.setState({ pending: null });
  }
}
