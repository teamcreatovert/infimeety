import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';
import { isTauri } from './platform';
import { useUI } from '@/stores/ui';

/**
 * The Infimeety browser's tabs. Each tab's website is its own view in the main window (Rust:
 * watch_browser.rs); only the selected one shows, and only while the browser is in front. The
 * tabs share one sign-in store, apart from the app's.
 */
export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  loading: boolean;
}

export const useBrowser = create<{ tabs: BrowserTab[]; active: string | null }>()(() => ({ tabs: [], active: null }));

// Letters and digits only (the Rust side checks).
const newId = () => Math.random().toString(36).slice(2, 10);

export const activeTab = () => {
  const { tabs, active } = useBrowser.getState();
  return tabs.find((t) => t.id === active) ?? null;
};

export const isStartPage = (url: string) => !url || url.includes('browser-start.html');

/** Opens a new tab (at `url`, or the start page), selects it, and brings the browser to the front. */
export async function newTab(url: string | null = null) {
  const id = newId();
  useBrowser.setState((s) => ({ tabs: [...s.tabs, { id, url: url ?? '', title: '', loading: true }], active: id }));
  useUI.getState().set({ browserOpen: true, tab: 'browser' });
  try {
    await invoke('browser_open', { tab: id, url });
  } catch (err) {
    closeTab(id);
    throw err;
  }
  return id;
}

/** Takes tab `id` to `url`. */
export const navigateTab = (id: string, url: string) => invoke('browser_open', { tab: id, url });

export function selectTab(id: string) {
  useBrowser.setState({ active: id });
  useUI.getState().set({ tab: 'browser' });
  void invoke('browser_select', { tab: id }).catch(() => {});
}

const closers = new Set<(id: string) => void>();
/** Something that cares when a tab closes (watching together stops with its tab). */
export const onTabClosed = (fn: (id: string) => void) => closers.add(fn);

export function closeTab(id: string) {
  const { tabs, active } = useBrowser.getState();
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  const rest = tabs.filter((t) => t.id !== id);
  void invoke('browser_close', { tab: id }).catch(() => {});
  for (const fn of closers) fn(id);
  if (!rest.length) {
    useBrowser.setState({ tabs: [], active: null });
    useUI.getState().set({ browserOpen: false, tab: 'home' });
    return;
  }
  useBrowser.setState({ tabs: rest });
  // Closing the selected tab selects its neighbour, like any browser.
  if (active === id) selectTab(rest[Math.min(i, rest.length - 1)].id);
}

/** The globe in the rail: back to the browser (or a first tab). */
export function openBrowser() {
  if (useBrowser.getState().tabs.length) {
    useUI.getState().set({ browserOpen: true, tab: 'browser' });
    return;
  }
  void newTab(null).catch(() => {});
}

if (isTauri) {
  // A fresh start of the app (or a reload) begins with no tabs: clear any views left from before.
  void invoke('browser_visible', { visible: false }).catch(() => {});
  void invoke('browser_close', { tab: null }).catch(() => {});
  void listen<{ tab: string; url: string; title: string; loading: boolean }>('browser:page', (e) =>
    useBrowser.setState((s) => ({
      tabs: s.tabs.map((t) =>
        t.id !== e.payload.tab ? t : { ...t, url: e.payload.url || t.url, loading: e.payload.loading, title: e.payload.title || (e.payload.url === t.url ? t.title : '') },
      ),
    })),
  );
  // A link that wants a new window: a new tab.
  void listen<string>('browser:newtab', (e) => void newTab(e.payload).catch(() => {}));
}
