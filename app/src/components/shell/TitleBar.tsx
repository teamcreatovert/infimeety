import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { appWindow, isMac, isTauri } from '@/lib/platform';
import { useUI } from '@/stores/ui';

// Segoe Fluent Icons (Windows 11) / Segoe MDL2 Assets (Windows 10) caption glyphs.
const GLYPHS = { minimize: '', maximize: '', restore: '', close: '' };

/** Title bar for the frameless window (Windows-style; a plain strip on Mac). `?titlebar` previews it in a dev browser. */
export function TitleBar() {
  const immersive = useUI((s) => s.immersive);
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
      <div data-tauri-drag-region className="glass-rail hairline-b relative z-[60] flex h-[28px] shrink-0 items-center justify-center">
        <span className="pointer-events-none text-[12px] font-medium text-fg-2" style={{ opacity: focused ? 1 : 0.55 }}>
          Infimeety
        </span>
      </div>
    );

  return (
    <div data-tauri-drag-region className="glass-rail hairline-b relative z-[60] flex h-[34px] shrink-0 items-center">
      <div className="pointer-events-none flex items-center gap-2 pl-3.5" style={{ opacity: focused ? 1 : 0.55 }}>
        <img src="/icon.png" alt="" className="h-4 w-4" draggable={false} />
        <span className="text-[12px] font-medium text-fg-2">Infimeety</span>
      </div>
      <div className="ml-auto flex h-full" style={{ color: focused ? 'var(--fg)' : 'var(--fg-3)' }}>
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
