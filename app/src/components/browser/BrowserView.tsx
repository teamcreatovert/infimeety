import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import clsx from 'clsx';
import { ArrowLeft, ArrowRight, Globe, Home, Lock, MonitorPlay, RotateCw, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { closeTab, isStartPage, newTab, useBrowser } from '@/lib/browser';
import { joinWeb, startWeb, useBarWatch, type BarWatch } from '@/lib/watchWeb';
import { useUI } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

const isStart = isStartPage;

/** The address, the way a browser shows it: the site in full, the rest quieter. */
function parts(url: string) {
  try {
    const u = new URL(url);
    return { secure: u.protocol === 'https:', host: u.hostname.replace(/^www\./, ''), rest: (u.pathname === '/' ? '' : u.pathname) + u.search };
  } catch {
    return { secure: false, host: url, rest: '' };
  }
}

/**
 * The Browser tab: a toolbar (back, forward, reload, the address, who you're watching with) and,
 * under it, the website, a view of its own that the app places over this area.
 */
export function BrowserView({ visible }: { visible: boolean }) {
  const active = useBrowser((s) => s.active);
  const page = useBrowser((s) => s.tabs.find((t) => t.id === s.active)) ?? { id: '', url: '', title: '', loading: false };
  const watch = useBarWatch();
  const area = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);

  // The website sits exactly over the area, and only while this tab is open.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const send = () => {
      const r = el.getBoundingClientRect();
      void invoke('browser_bounds', { x: r.left, y: r.top, width: r.width, height: r.height }).catch(() => {});
    };
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    window.addEventListener('resize', send);
    const offFull = listen<boolean>('browser:full', () => requestAnimationFrame(send));
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', send);
      void offFull.then((f) => f());
    };
  }, []);
  useEffect(() => {
    void invoke('browser_visible', { visible }).catch(() => {});
  }, [visible]);
  useEffect(() => () => void invoke('browser_visible', { visible: false }).catch(() => {}), []);
  // Ctrl+T, Ctrl+W and Ctrl+L while the toolbar has the keys.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 't') (e.preventDefault(), void newTab(null).catch(() => {}));
      else if (k === 'w' && active) (e.preventDefault(), closeTab(active));
      else if (k === 'l') (e.preventDefault(), beginEdit());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const start = isStart(page.url);
  const { secure, host, rest } = parts(page.url);
  const nav = (action: string) => active && void invoke('browser_nav', { tab: active, action }).catch(() => {});
  const beginEdit = () => {
    setText(start ? '' : page.url);
    setEditing(true);
    requestAnimationFrame(() => input.current?.select());
  };

  return (
    <div className={clsx('absolute inset-0 z-40 flex flex-col bg-[var(--stage)]', !visible && 'invisible')}>
      <div className="relative flex h-[46px] shrink-0 items-center gap-1 px-2 text-white">
        <NavButton label="Back" onClick={() => nav('back')}>
          <ArrowLeft size={16} />
        </NavButton>
        <NavButton label="Forward" onClick={() => nav('forward')}>
          <ArrowRight size={16} />
        </NavButton>
        <NavButton label={page.loading ? 'Stop' : 'Reload'} onClick={() => nav(page.loading ? 'stop' : 'reload')}>
          {page.loading ? <X size={16} /> : <RotateCw size={15} />}
        </NavButton>
        <NavButton label="Start page" onClick={() => nav('home')}>
          <Home size={15} />
        </NavButton>

        {/* The address: centred, a pill; typing turns it into a search box. */}
        <div className="flex min-w-0 flex-1 justify-center px-2">
          {editing ? (
            <form
              className="flex h-[30px] w-full max-w-[640px] items-center gap-2 rounded-[10px] bg-white/[0.1] px-3 shadow-[inset_0_0_0_1.5px_var(--accent)]"
              onSubmit={(e) => {
                e.preventDefault();
                setEditing(false);
                if (active) void invoke('browser_go', { tab: active, text }).catch(() => {});
              }}
            >
              <Globe size={13} className="shrink-0 text-white/50" />
              <input
                ref={input}
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onBlur={() => setEditing(false)}
                onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
                placeholder="Search or type a link"
                spellCheck={false}
                className="h-full w-full bg-transparent text-[13px] text-white outline-none placeholder:text-white/40"
              />
            </form>
          ) : (
            <button
              onClick={beginEdit}
              title={page.title || page.url}
              className="flex h-[30px] w-full max-w-[640px] items-center justify-center gap-1.5 rounded-[10px] bg-white/[0.06] px-3 text-[13px] transition-colors hover:bg-white/[0.1]"
            >
              {start ? (
                <>
                  <Globe size={13} className="shrink-0 text-white/45" />
                  <span className="text-white/50">Search or type a link</span>
                </>
              ) : (
                <>
                  {secure ? <Lock size={11} className="shrink-0 text-white/55" /> : <Globe size={12} className="shrink-0 text-white/45" />}
                  <span className="shrink-0 font-medium text-white">{host}</span>
                  <span className="min-w-0 truncate text-white/45">{rest}</span>
                </>
              )}
            </button>
          )}
        </div>

        <WatchPill watch={watch} url={page.url} tab={active} />

        {/* Loading: a thin line under the toolbar. */}
        <AnimatePresence>
          {page.loading && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.3 } }} className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] overflow-hidden">
              <motion.div className="h-full w-1/3 rounded-full bg-[var(--accent)]" animate={{ x: ['-100%', '300%'] }} transition={{ duration: 1.1, ease: 'easeInOut', repeat: Infinity }} />
            </motion.div>
          )}
        </AnimatePresence>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-white/[0.07]" />
      </div>
      {/* The website goes here. */}
      <div ref={area} className="min-h-0 flex-1" />
    </div>
  );
}

/** Who you're watching with, and whether everyone's in step; or the button to start. */
function WatchPill({ watch, url, tab }: { watch: BarWatch; url: string; tab: string | null }) {
  const roomId = useVoice((s) => s.roomId);
  if (!watch.inCall || !roomId) return null;
  if (!watch.active)
    return isStart(url) ? null : (
      <button
        onClick={() => void startWeb(roomId, url, tab ?? undefined)}
        className="flex h-[30px] shrink-0 items-center gap-1.5 rounded-[10px] bg-[var(--accent)] px-3 text-[12.5px] font-semibold text-white transition-[filter] hover:brightness-110"
      >
        <MonitorPlay size={14} /> Watch together
      </button>
    );
  if (!watch.joined)
    return (
      <button onClick={() => void joinWeb(roomId)} className="flex h-[30px] shrink-0 items-center gap-1.5 rounded-[10px] bg-[var(--accent)] px-3 text-[12.5px] font-semibold text-white hover:brightness-110">
        <MonitorPlay size={14} /> Join {watch.roomName}
      </button>
    );
  return (
    <button
      onClick={() => useUI.getState().set({ tab: 'home' })}
      title="Back to the call"
      className="flex h-[30px] max-w-[300px] shrink-0 items-center gap-2 rounded-[10px] bg-white/[0.06] pl-2.5 pr-1.5 text-[12.5px] transition-colors hover:bg-white/[0.1]"
    >
      <span className={clsx('h-2 w-2 shrink-0 rounded-full', watch.status === 'sync' ? 'bg-success shadow-[0_0_0_3px_rgba(35,165,90,0.25)]' : 'bg-warning')} />
      <span className="min-w-0 truncate text-white/85">{watch.label}</span>
      <span className="flex shrink-0 -space-x-1.5">
        {watch.people.slice(0, 4).map((p) => (
          <span key={p.id} className="grid h-[22px] w-[22px] place-items-center overflow-hidden rounded-full bg-white/15 text-[10px] font-semibold ring-2 ring-[var(--stage)]">
            {p.avatarUrl ? <img src={p.avatarUrl} alt="" className="h-full w-full object-cover" /> : p.name.slice(0, 1).toUpperCase()}
          </span>
        ))}
      </span>
    </button>
  );
}

function NavButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-white/65 transition-colors hover:bg-white/10 hover:text-white active:bg-white/15">
      {children}
    </button>
  );
}
