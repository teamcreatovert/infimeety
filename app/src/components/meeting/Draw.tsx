import clsx from 'clsx';
import { motion } from 'motion/react';
import {
  ArrowUpRight,
  Circle,
  Eraser,
  Highlighter,
  Minus,
  MousePointer2,
  Pencil,
  Presentation,
  Redo2,
  Square,
  Trash2,
  Undo2,
  WandSparkles,
  X,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_MEETING, DRAW_COLORS, type Stroke } from '../../../../shared/protocol';
import { MenuItem, Popover, Tooltip, type Anchor } from '../ui/overlay';
import { SIZES, clearSurface, eraseAt, paint, redo, startLaser, startStroke, syncSurface, undo, useDraw, type Tool } from '@/lib/draw';
import { getHub } from '@/lib/realtime';
import { snappy } from '@/lib/motion';
import { isTauri, isWindows } from '@/lib/platform';
import { voice } from '@/lib/voice/engine';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { useMeetings } from '@/stores/meetings';
import { toast } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

/** Whether you may draw on a surface: the whiteboard while it's open, a shared screen when the host turned drawing on. */
export function useCanDraw(channelId: string, surface: string | null | undefined) {
  const saved = useMeetings((s) => s.settings[channelId]);
  const role = useChannels((s) => s.channels.find((c) => c.id === channelId)?.role);
  const meeting = useChannels((s) => s.channels.find((c) => c.id === channelId)?.kind === 'meeting');
  if (!surface || !meeting) return false;
  const rules = { ...DEFAULT_MEETING, ...saved };
  const presenter = role !== 'member' || rules.share;
  return surface === 'board' ? rules.board && presenter : rules.annotate && presenter;
}

/** Can you open the whiteboard (anyone allowed to share their screen). */
export function useCanPresent(channelId: string) {
  const share = useMeetings((s) => s.settings[channelId]?.share ?? true);
  const role = useChannels((s) => s.channels.find((c) => c.id === channelId)?.role);
  return role !== 'member' || share;
}

/** Whose marks you may erase or clear here. */
function useMayErase(channelId: string, surface: string) {
  const me = useAuth((s) => s.me?.id);
  const role = useChannels((s) => s.channels.find((c) => c.id === channelId)?.role);
  const ownScreen = surface === `screen:${voice.peerId}`;
  return (s: Stroke) => s.by === me || surface === 'board' || role !== 'member' || ownScreen;
}

/**
 * The marks on a surface, over whatever shows it (a screen share's video or the whiteboard).
 * `aspect` is the picture's width / height: marks sit on the picture, not the letterbox around it.
 */
export function DrawLayer({ channelId, surface, aspect, interactive }: { channelId: string; surface: string; aspect: number; interactive?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const strokes = useDraw((s) => s.strokes[surface]);
  const lasers = useDraw((s) => s.lasers[surface]);
  const open = useDraw((s) => s.open);
  const tool = useDraw((s) => s.tool);
  const me = useAuth((s) => s.me?.id);
  const canDraw = useCanDraw(channelId, surface);
  const mayErase = useMayErase(channelId, surface);
  const live = interactive && open && canDraw && tool !== 'pointer';

  // The whole picture when it first shows, and again after a reconnect.
  const synced = useDraw((s) => !!s.synced[surface]);
  useEffect(() => {
    if (!synced) syncSurface(channelId, surface);
  }, [channelId, surface, synced]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The picture inside the box (contained, centred).
  const rect = (() => {
    const { w, h } = size;
    if (!w || !h) return { x: 0, y: 0, w: 0, h: 0 };
    const pw = Math.min(w, h * aspect);
    const ph = pw / aspect;
    return { x: (w - pw) / 2, y: (h - ph) / 2, w: pw, h: ph };
  })();

  // Paint (and keep painting while a laser trail fades).
  useEffect(() => {
    const c = canvas.current;
    if (!c || !size.w) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const frame = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);
      const trails = useDraw.getState().lasers[surface] ?? [];
      paint(ctx, useDraw.getState().strokes[surface] ?? [], trails, rect.x, rect.y, rect.w, rect.h);
      if (trails.some((l) => Date.now() - l.at < 1200)) raf = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [strokes, lasers, size.w, size.h, aspect, surface]); // eslint-disable-line react-hooks/exhaustive-deps

  const at = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return [(e.clientX - r.left - rect.x) / rect.w, (e.clientY - r.top - rect.y) / rect.h] as const;
  };
  const drawing = useRef<{ move: (x: number, y: number) => void; end: () => void } | null>(null);
  const down = (e: React.PointerEvent) => {
    if (!live || !me || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const [x, y] = at(e);
    const t = useDraw.getState().tool;
    if (t === 'eraser') {
      eraseAt(channelId, surface, x, y, aspect, mayErase);
      drawing.current = { move: (mx, my) => eraseAt(channelId, surface, mx, my, aspect, mayErase), end: () => {} };
    } else if (t === 'laser') {
      drawing.current = startLaser(channelId, surface, me);
      drawing.current.move(x, y);
    } else drawing.current = startStroke(channelId, surface, me, x, y);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    // Every point the pointer passed (smooth lines on fast strokes).
    const events = 'getCoalescedEvents' in e.nativeEvent ? (e.nativeEvent as PointerEvent).getCoalescedEvents() : [];
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const r = box.current!.getBoundingClientRect();
      drawing.current.move((ev.clientX - r.left - rect.x) / rect.w, (ev.clientY - r.top - rect.y) / rect.h);
    }
  };
  const up = () => {
    drawing.current?.end();
    drawing.current = null;
  };

  return (
    <div
      ref={box}
      className={clsx('absolute inset-0 z-[5]', live ? (tool === 'eraser' ? 'cursor-cell' : 'cursor-crosshair') : 'pointer-events-none')}
      style={{ touchAction: live ? 'none' : undefined }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onClick={(e) => live && e.stopPropagation()}
      onDoubleClick={(e) => live && e.stopPropagation()}
    >
      <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" />
    </div>
  );
}

const TOOLS: { tool: Tool; label: string; icon: ReactNode }[] = [
  { tool: 'pointer', label: 'Pointer (stop drawing)', icon: <MousePointer2 size={16} /> },
  { tool: 'pen', label: 'Pen', icon: <Pencil size={16} /> },
  { tool: 'marker', label: 'Highlighter', icon: <Highlighter size={16} /> },
  { tool: 'line', label: 'Line', icon: <Minus size={16} className="-rotate-45" /> },
  { tool: 'arrow', label: 'Arrow', icon: <ArrowUpRight size={16} /> },
  { tool: 'rect', label: 'Box', icon: <Square size={15} /> },
  { tool: 'ellipse', label: 'Circle', icon: <Circle size={15} /> },
  { tool: 'laser', label: 'Laser pointer', icon: <WandSparkles size={16} /> },
  { tool: 'eraser', label: 'Eraser', icon: <Eraser size={16} /> },
];

/** The drawing tools, like Zoom's: pick a tool, colour and size; undo, redo, clear. */
export function DrawToolbar({ channelId, surface }: { channelId: string; surface: string }) {
  const tool = useDraw((s) => s.tool);
  const color = useDraw((s) => s.color);
  const size = useDraw((s) => s.size);
  const canUndo = useDraw((s) => (s.undo[surface]?.length ?? 0) > 0);
  const canRedo = useDraw((s) => (s.redo[surface]?.length ?? 0) > 0);
  const me = useAuth((s) => s.me?.id ?? '');
  const role = useChannels((s) => s.channels.find((c) => c.id === channelId)?.role);
  const [palette, setPalette] = useState<Anchor | null>(null);
  const [clear, setClear] = useState<Anchor | null>(null);
  const clearAll = role !== 'member' || surface === `screen:${voice.peerId}`;
  const set = useDraw.getState().set;

  // Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) and Escape, while the tools are open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) undo(channelId, surface, me);
      else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) redo(channelId, surface, me);
      else if (e.key === 'Escape') set({ open: false });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [channelId, surface, me, set]);

  return (
    <motion.div
      data-keep-awake
      data-avoid-web
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.97 }}
      transition={snappy}
      className="absolute bottom-[92px] left-1/2 z-40 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-[18px] p-1.5 glass-float [scrollbar-width:none] compact:bottom-[78px]"
    >
      {TOOLS.map((t) => (
        <ToolButton key={t.tool} label={t.label} active={tool === t.tool} onClick={() => set({ tool: t.tool })}>
          {t.icon}
        </ToolButton>
      ))}
      <Divider />
      <Tooltip label="Colour and size">
        <button
          aria-label="Colour and size"
          onClick={(e) => setPalette(e.currentTarget.getBoundingClientRect())}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] transition-colors hover:bg-fill-2"
        >
          <span className="rounded-full shadow-[0_0_0_2px_var(--glass-pop),0_0_0_3px_var(--hairline-strong)]" style={{ background: color, width: 8 + size, height: 8 + size }} />
        </button>
      </Tooltip>
      <Divider />
      <ToolButton label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => undo(channelId, surface, me)}>
        <Undo2 size={16} />
      </ToolButton>
      <ToolButton label="Redo (Ctrl+Y)" disabled={!canRedo} onClick={() => redo(channelId, surface, me)}>
        <Redo2 size={16} />
      </ToolButton>
      <ToolButton label="Clear" onClick={(el) => setClear(el.getBoundingClientRect())}>
        <Trash2 size={16} />
      </ToolButton>
      <Divider />
      <ToolButton label="Close the tools (Esc)" onClick={() => set({ open: false })}>
        <X size={16} />
      </ToolButton>

      <Popover open={!!palette} anchor={palette} onClose={() => setPalette(null)} side="top" align="center" offset={10} className="w-[212px] p-2.5">
        <div className="grid grid-cols-4 gap-2">
          {DRAW_COLORS.map((c) => (
            <button
              key={c}
              aria-label={`Colour ${c}`}
              onClick={() => set({ color: c, tool: tool === 'eraser' || tool === 'pointer' || tool === 'laser' ? 'pen' : tool })}
              className={clsx('h-9 rounded-[10px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)] transition-transform hover:scale-105', color === c && 'ring-2 ring-accent ring-offset-2 ring-offset-[var(--glass-pop)]')}
              style={{ background: c }}
            />
          ))}
        </div>
        <div className="mt-2.5 flex gap-1.5">
          {SIZES.map((s) => (
            <button
              key={s.value}
              aria-label={s.label}
              onClick={() => set({ size: s.value })}
              className={clsx('flex h-9 flex-1 items-center justify-center rounded-[10px] transition-colors', size === s.value ? 'bg-accent/15 shadow-[inset_0_0_0_1px_var(--accent)]' : 'bg-fill-2 hover:bg-fill-3')}
            >
              <span className="rounded-full bg-fg" style={{ width: s.value + 4, height: s.value + 4 }} />
            </button>
          ))}
        </div>
      </Popover>
      <Popover open={!!clear} anchor={clear} onClose={() => setClear(null)} side="top" align="end" offset={10} className="w-[220px] p-1.5">
        <MenuItem icon={<Eraser size={14} />} onClick={() => (clearSurface(channelId, surface, me, true), setClear(null))}>
          Clear my drawings
        </MenuItem>
        {clearAll && (
          <MenuItem danger icon={<Trash2 size={14} />} onClick={() => (clearSurface(channelId, surface, me, false), setClear(null))}>
            Clear everyone’s drawings
          </MenuItem>
        )}
      </Popover>
    </motion.div>
  );
}

function ToolButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: (el: HTMLElement) => void; children: ReactNode }) {
  return (
    <Tooltip label={label}>
      <button
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={(e) => onClick(e.currentTarget)}
        className={clsx('grid h-9 w-9 shrink-0 place-items-center rounded-[11px] transition-colors disabled:opacity-35', active ? 'bg-accent text-white shadow-[0_2px_8px_-2px_var(--accent)]' : 'text-fg-2 hover:bg-fill-2 hover:text-fg')}
      >
        {children}
      </button>
    </Tooltip>
  );
}

const Divider = () => <div className="mx-1 h-6 w-px shrink-0 bg-[var(--hairline-strong)]" />;

/** The whiteboard as a call tile: a white page everyone allowed to share can draw on. */
export function BoardTile({ channelId, width, height, big }: { channelId: string; width: number; height: number; big?: boolean }) {
  const canPresent = useCanPresent(channelId);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={snappy}
      className="group relative overflow-hidden rounded-[22px] bg-[#f7f7f5] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]"
      style={{ width, height }}
    >
      <DrawLayer channelId={channelId} surface="board" aspect={width / height} interactive={big} />
      <span className="pointer-events-none absolute bottom-2.5 left-2.5 z-10 flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-[12px] font-medium text-white">
        <Presentation size={12} /> Whiteboard
      </span>
      {canPresent && (
        <Tooltip label="Close the whiteboard for everyone">
          <button
            aria-label="Close the whiteboard"
            onClick={() => getHub(channelId)?.send({ t: 'board', open: false })}
            className="absolute right-2.5 top-2.5 z-10 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/75 group-hover:opacity-100 touch:opacity-100"
          >
            <X size={15} />
          </button>
        </Tooltip>
      )}
    </motion.div>
  );
}

/** Open (or close) the whiteboard for everyone. */
export function toggleBoard(channelId: string, open: boolean) {
  getHub(channelId)?.send({ t: 'board', open });
  if (open) {
    useDraw.getState().set({ open: true, tool: 'pen' });
    toast({ kind: 'info', title: 'Whiteboard is open', body: 'Everyone sees it. Anyone who can share their screen can draw on it.' });
  }
}

/**
 * Windows app, sharing a whole screen in a meeting with drawing on: a see-through window over
 * that screen shows everyone's marks to you (screen capture leaves it out, so friends don't get
 * the marks twice).
 */
export function useSharerOverlay(channelId: string, meeting: boolean) {
  const localScreen = useVoice((s) => s.localScreen);
  const annotate = useMeetings((s) => !!s.settings[channelId]?.annotate);
  const source = localScreen ? voice.screenSource : null;
  const surface = voice.peerId ? `screen:${voice.peerId}` : null;
  const on = meeting && isTauri && isWindows && annotate && !!source?.startsWith('screen:') && !!surface;

  useEffect(() => {
    if (!on) return;
    invoke('annotate_overlay', { open: true, source }).catch(() => {});
    return () => void invoke('annotate_overlay', { open: false, source: null }).catch(() => {});
  }, [on, source]);

  // Marks and tools to the on-screen windows.
  useEffect(() => {
    if (!on || !surface) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const push = () => {
      timer = null;
      const st = useDraw.getState();
      void emitTo('annotate', 'annotate:state', { strokes: st.strokes[surface] ?? [], lasers: st.lasers[surface] ?? [] }).catch(() => {});
      void emitTo('drawtools', 'drawtools:state', {
        tool: st.tool,
        color: st.color,
        size: st.size,
        canUndo: (st.undo[surface]?.length ?? 0) > 0,
        canRedo: (st.redo[surface]?.length ?? 0) > 0,
      }).catch(() => {});
    };
    push();
    const unsubscribe = useDraw.subscribe(() => {
      if (!timer) timer = setTimeout(push, 30);
    });
    // The windows may still be loading the first time: tell them again now and then.
    const again = setInterval(push, 2000);
    return () => {
      unsubscribe();
      clearInterval(again);
      if (timer) clearTimeout(timer);
    };
  }, [on, surface]);

  // The draw button's tools, and drawing straight on your screen.
  useEffect(() => {
    if (!on || !surface) return;
    const me = () => useAuth.getState().me?.id ?? '';
    let toolsOpen = false;
    // The marks window takes the mouse only while a drawing tool is on.
    const mode = () => void invoke('annotate_mode', { drawing: toolsOpen && useDraw.getState().tool !== 'pointer' }).catch(() => {});
    const aspect = () => {
      const s = useVoice.getState().localScreen?.getVideoTracks()[0]?.getSettings();
      return s?.width && s?.height ? s.width / s.height : 16 / 9;
    };
    type Action = { a: string; v?: string | number; w?: number; h?: number };
    const offTools = listen<Action>('drawtools:do', (e) => {
      const { a, v } = e.payload;
      const set = useDraw.getState().set;
      if (a === 'open') {
        toolsOpen = true;
        if (useDraw.getState().tool === 'pointer') set({ tool: 'pen' });
      } else if (a === 'close') toolsOpen = false;
      else if (a === 'tool') set({ tool: v as Tool });
      else if (a === 'color') set({ color: String(v), ...(['eraser', 'pointer', 'laser'].includes(useDraw.getState().tool) ? { tool: 'pen' as Tool } : {}) });
      else if (a === 'size') set({ size: Number(v) });
      else if (a === 'undo') undo(channelId, surface, me());
      else if (a === 'redo') redo(channelId, surface, me());
      else if (a === 'clear') clearSurface(channelId, surface, me(), false);
      else if (a === 'layout') void invoke('drawtools_size', { width: e.payload.w, height: e.payload.h }).catch(() => {});
      mode();
    });
    let session: { move: (x: number, y: number) => void; end: () => void } | null = null;
    // The marks window numbers its messages and strokes: repeats are dropped, and points only
    // ever go to the stroke they belong to.
    let lastN = 0;
    let current = -1;
    const offInput = listen<{ k: 'down' | 'move' | 'up'; pts: number[]; s: number; n: number }>('annotate:input', (e) => {
      const { k, pts, s, n } = e.payload;
      if (n <= lastN) return;
      lastN = n;
      const t = useDraw.getState().tool;
      if (k === 'down') {
        session?.end();
        current = s;
        const [x, y] = pts;
        if (t === 'eraser') {
          const erase = (ex: number, ey: number) => eraseAt(channelId, surface, ex, ey, aspect(), () => true);
          erase(x, y);
          session = { move: erase, end: () => {} };
        } else if (t === 'laser') {
          session = startLaser(channelId, surface, me());
          session.move(x, y);
        } else session = startStroke(channelId, surface, me(), x, y);
        return;
      }
      if (!session || s !== current) return;
      for (let i = 0; i + 1 < pts.length; i += 2) session.move(pts[i], pts[i + 1]);
      if (k === 'up') {
        session.end();
        session = null;
      }
    });
    return () => {
      session?.end();
      void offTools.then((f) => f());
      void offInput.then((f) => f());
    };
  }, [on, surface, channelId]);
}
