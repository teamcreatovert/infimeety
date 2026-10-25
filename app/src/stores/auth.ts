import { create } from 'zustand';
import type { Me } from '../../../shared/protocol';
import { api, ApiError, getToken, handleUnauthorized, randomId, setToken, sha256 } from '@/lib/api';
import { openExternal } from '@/lib/platform';
import { API_URL } from '@/config';

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

export const useAuth = create<AuthState>()((set, get) => {
  async function loadMe() {
    const me = await api<Me>('/me');
    set({ me, status: me.onboarded ? 'ready' : 'onboarding', error: null });
  }

  handleUnauthorized(() => {
    setToken(null);
    set({ me: null, status: 'signedOut' });
  });

  return {
    status: 'loading',
    me: null,
    providers: null,
    pending: null,
    error: null,

    async init() {
      void get().loadProviders();
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
      const challenge = await sha256(verifier);
      set({ pending: provider, error: null });
      await openExternal(`${API_URL}/auth/${provider}/start?challenge=${challenge}`);

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
      const verifier = randomId(32);
      const challenge = await sha256(verifier);
      const { url } = await api<{ url: string }>(`/auth/${provider}/link`, { method: 'POST', json: { challenge } });
      set({ linking: provider });
      await openExternal(url);
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
      setToken(null);
      set({ me: null, status: 'signedOut' });
    },

    setMe(me) {
      set({ me, status: me.onboarded ? 'ready' : 'onboarding' });
    },
  };
});
