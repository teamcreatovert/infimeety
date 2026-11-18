import clsx from 'clsx';
import { Globe, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { appWindow, isMac, isTauri } from '@/lib/platform';
import { closeTab, isStartPage, newTab, selectTab, useBrowser } from '@/lib/browser';
import { useUI } from '@/stores/ui';

// Segoe Fluent Icons (Windows 11) / Segoe MDL2 Assets (Windows 10) caption glyphs.
const GLYPHS = { minimize: '', maximize: '', restore: '', close: '' };

/** Title bar for the frameless window (Windows-style; a plain strip on Mac). `?titlebar` previews it in a dev browser. */
export function TitleBar() {
  const immersive = useUI((s) => s.immersive);
  // Watch mode: dark, like the picture under it, so the app doesn't look like a page in a browser.
  const browserOpen = useUI((s) => s.browserOpen);
  const onBrowser = useUI((s) => s.tab === 'browser' && s.browserOpen);
  const dark = useUI((s) => s.darkChrome) || onBrowser;
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(() => document.hasFocus());
  const show = isTauri || (import.meta.env.DEV && location.search.includes('titlebar'));

  useEffect(() => {
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    window.addEventListener('focus', on);
    window.addEventListener('blur', off);
    let unlisten: (() => void) | undefined;
    if (isTauri) {
      void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
        const w = getCurrentWindow();
        const sync = () => void w.isMaximized().then(setMaximized);
        sync();
        void w.onResized(sync).then((fn) => (unlisten = fn));
      });
    }
    return () => {
      window.removeEventListener('focus', on);
      window.removeEventListener('blur', off);
      unlisten?.();
    };
  }, []);

  if (!show || immersive) return null;

  // Mac: the window keeps its own traffic lights (top left); this is just the strip to drag it by.
  if (isMac)
    return (
      <div data-tauri-drag-region className={clsx('relative z-[60] flex h-[28px] shrink-0 items-center justify-center transition-colors duration-300', dark ? 'bg-[var(--stage)]' : 'glass-rail hairline-b')}>
        {browserOpen ? (
          <Tabs dark={dark} />
        ) : (
          <span className={clsx('pointer-events-none text-[12px] font-medium', dark ? 'text-white/60' : 'text-fg-2')} style={{ opacity: focused ? 1 : 0.55 }}>
            Infimeety
          </span>
        )}
      </div>
    );

  return (
    <div data-tauri-drag-region className={clsx('relative z-[60] flex h-[34px] shrink-0 items-center transition-colors duration-300', dark ? 'caption-dark bg-[var(--stage)]' : 'glass-rail hairline-b')}>
      {browserOpen ? (
        <div className="flex h-full items-end pl-2" style={{ opacity: focused ? 1 : 0.7 }}>
          <Tabs dark={dark} />
        </div>
      ) : (
        <div className="pointer-events-none flex items-center gap-2 pl-3.5" style={{ opacity: focused ? 1 : 0.55 }}>
          <img src="/icon.png" alt="" className="h-4 w-4" draggable={false} />
          <span className={clsx('text-[12px] font-medium', dark ? 'text-white/60' : 'text-fg-2')}>Infimeety</span>
        </div>
      )}
      <div className="ml-auto flex h-full" style={{ color: dark ? (focused ? '#fff' : 'rgba(255,255,255,0.45)') : focused ? 'var(--fg)' : 'var(--fg-3)' }}>
        <CaptionButton label="Minimize" glyph={GLYPHS.minimize} onClick={appWindow.minimize} />
        <CaptionButton label={maximized ? 'Restore Down' : 'Maximize'} glyph={maximized ? GLYPHS.restore : GLYPHS.maximize} onClick={appWindow.toggleMaximize} />
        <CaptionButton label="Close" glyph={GLYPHS.close} onClick={appWindow.close} close />
      </div>
    </div>
  );
}

function CaptionButton({ label, glyph, onClick, close }: { label: string; glyph: string; onClick: () => unknown; close?: boolean }) {
  return (
    <button aria-label={label} title={label} onClick={() => void onClick()} className={clsx('caption-btn', close && 'caption-close')}>
      {glyph}
    </button>
  );
}

/** The window's tabs: Home (the app), then the Infimeety browser's tabs and a +, like a browser's own. */
function Tabs({ dark }: { dark: boolean }) {
  const view = useUI((s) => s.tab);
  const tabs = useBrowser((s) => s.tabs);
  const active = useBrowser((s) => s.active);
  const item = (on: boolean) =>
    clsx(
      'group flex h-[28px] min-w-0 items-center gap-1.5 rounded-t-[9px] px-2.5 text-[12px] font-medium transition-colors',
      on ? (dark ? 'bg-[var(--stage)] text-white' : 'bg-[var(--bg)] text-fg') : dark ? 'text-white/55 hover:bg-white/[0.06] hover:text-white' : 'text-fg-2 hover:bg-fill-2 hover:text-fg',
    );
  return (
    <div className="flex h-full min-w-0 items-end gap-0.5">
      <button onClick={() => useUI.getState().set({ tab: 'home' })} className={clsx(item(view === 'home'), 'shrink-0')}>
        <img src="/icon.png" alt="" className="h-3.5 w-3.5" draggable={false} />
        <span>Infimeety</span>
      </button>
      <span className={clsx('mx-1 mb-[7px] h-3.5 w-px shrink-0', dark ? 'bg-white/15' : 'bg-[var(--hairline-strong)]')} />
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={view === 'browser' && active === tab.id}
          onClick={() => selectTab(tab.id)}
          onAuxClick={(e) => e.button === 1 && closeTab(tab.id)}
          className={clsx(item(view === 'browser' && active === tab.id), 'w-[180px] max-w-[180px] cursor-default')}
        >
          {tab.loading ? <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent opacity-70" /> : <Globe size={13} className="shrink-0 opacity-70" />}
          <span className="min-w-0 flex-1 truncate">{tab.title || (isStartPage(tab.url) ? 'New tab' : safeHost(tab.url))}</span>
          <button
            aria-label="Close tab"
            onClick={(e) => (e.stopPropagation(), closeTab(tab.id))}
            className={clsx('grid h-4 w-4 shrink-0 place-items-center rounded-[4px] opacity-60 hover:opacity-100', dark ? 'hover:bg-white/15' : 'hover:bg-fill-3')}
          >
            <X size={11} />
          </button>
        </div>
      ))}
      <button
        aria-label="New tab"
        title="New tab (Ctrl+T)"
        onClick={() => void newTab(null).catch(() => {})}
        className={clsx('mb-[2px] ml-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-[7px] transition-colors', dark ? 'text-white/60 hover:bg-white/10 hover:text-white' : 'text-fg-2 hover:bg-fill-2 hover:text-fg')}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Browser';
  }
}
