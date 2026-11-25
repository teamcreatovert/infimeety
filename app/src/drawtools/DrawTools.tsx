import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import clsx from 'clsx';
import { ArrowUpRight, Circle, Eraser, GripVertical, Highlighter, Minus, MousePointer2, Pencil, Redo2, Square, Trash2, Undo2, WandSparkles, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { DRAW_COLORS } from '../../../shared/protocol';

/**
 * The draw button while you share your whole screen (Windows app): a small round button floating
 * over everything, which you can drag anywhere. Click it and it grows into the drawing tools, so
 * you can mark up any app you're sharing without going back to Infimeety. Screen capture leaves
 * it out, so the people watching never see it.
 */

type Tool = 'pointer' | 'pen' | 'marker' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'laser' | 'eraser';
interface ToolsState {
  tool: Tool;
  color: string;
  size: number;
  canUndo: boolean;
  canRedo: boolean;
}
type Action =
  | { a: 'open' | 'close' | 'undo' | 'redo' | 'clear' }
  | { a: 'tool'; v: Tool }
  | { a: 'color'; v: string }
  | { a: 'size'; v: number }
  | { a: 'layout'; w: number; h: number };

const send = (action: Action) => void emitTo('main', 'drawtools:do', action).catch(() => {});

const TOOLS: { tool: Tool; label: string; icon: ReactNode }[] = [
  { tool: 'pointer', label: 'Pointer: use your apps', icon: <MousePointer2 size={17} /> },
  { tool: 'pen', label: 'Pen', icon: <Pencil size={17} /> },
  { tool: 'marker', label: 'Highlighter', icon: <Highlighter size={17} /> },
  { tool: 'line', label: 'Line', icon: <Minus size={17} className="-rotate-45" /> },
  { tool: 'arrow', label: 'Arrow', icon: <ArrowUpRight size={17} /> },
  { tool: 'rect', label: 'Box', icon: <Square size={16} /> },
  { tool: 'ellipse', label: 'Circle', icon: <Circle size={16} /> },
  { tool: 'laser', label: 'Laser pointer', icon: <WandSparkles size={17} /> },
  { tool: 'eraser', label: 'Eraser', icon: <Eraser size={17} /> },
];
const SIZES = [3, 6, 12];

export function DrawTools() {
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [state, setState] = useState<ToolsState>({ tool: 'pen', color: '#ff3b30', size: 4, canUndo: false, canRedo: false });
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const off = listen<ToolsState>('drawtools:state', (e) => setState(e.payload));
    return () => void off.then((f) => f());
  }, []);

  // The window takes the size of what it shows (the button, or the toolbar and its colours).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const report = () => send({ a: 'layout', w: Math.ceil(el.offsetWidth), h: Math.ceil(el.offsetHeight) });
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, palette]);

  // Drag it anywhere; a click (no drag) opens it.
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragFrom.current = { x: e.screenX, y: e.screenY };
  };
  const move = (e: React.PointerEvent) => {
    const from = dragFrom.current;
    if (from && Math.hypot(e.screenX - from.x, e.screenY - from.y) > 4) {
      dragFrom.current = null;
      void getCurrentWindow().startDragging();
    }
  };
  const tap = (run: () => void) => () => {
    if (dragFrom.current) run();
    dragFrom.current = null;
  };

  const openTools = () => {
    setOpen(true);
    send({ a: 'open' });
  };
  const closeTools = () => {
    setOpen(false);
    setPalette(false);
    send({ a: 'close' });
  };

  if (!open)
    return (
      <div ref={box} className="inline-block p-1">
        <button
          aria-label="Draw on your screen"
          title="Draw on your screen (drag to move)"
          onPointerDown={down}
          onPointerMove={move}
          onClick={tap(openTools)}
          className="grid h-12 w-12 cursor-grab place-items-center rounded-full text-white shadow-[0_6px_20px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.35)] transition-transform hover:scale-105 active:scale-95 active:cursor-grabbing"
          style={{ background: 'linear-gradient(145deg, #4F8CFF, #7A5CFF 55%, #C64DFF)' }}
        >
          <Pencil size={21} />
        </button>
      </div>
    );

  return (
    <div ref={box} className="inline-flex flex-col p-1">
      <div className="flex items-center gap-0.5 rounded-[18px] bg-[#1c1c22]/95 p-1.5 text-white shadow-[0_8px_28px_rgba(0,0,0,0.5),inset_0_0_0_1px_rgba(255,255,255,0.1)]">
        <span onPointerDown={down} onPointerMove={move} onPointerUp={() => (dragFrom.current = null)} title="Drag to move" className="grid h-9 w-5 cursor-grab place-items-center text-white/40 active:cursor-grabbing">
          <GripVertical size={15} />
        </span>
        {TOOLS.map((t) => (
          <Btn key={t.tool} label={t.label} active={state.tool === t.tool} onClick={() => send({ a: 'tool', v: t.tool })}>
            {t.icon}
          </Btn>
        ))}
        <Sep />
        <Btn label="Colour and size" active={palette} onClick={() => setPalette(!palette)}>
          <span className="rounded-full shadow-[0_0_0_2px_#1c1c22,0_0_0_3px_rgba(255,255,255,0.35)]" style={{ background: state.color, width: 8 + state.size, height: 8 + state.size }} />
        </Btn>
        <Sep />
        <Btn label="Undo" disabled={!state.canUndo} onClick={() => send({ a: 'undo' })}>
          <Undo2 size={17} />
        </Btn>
        <Btn label="Redo" disabled={!state.canRedo} onClick={() => send({ a: 'redo' })}>
          <Redo2 size={17} />
        </Btn>
        <Btn label="Clear all drawings" onClick={() => send({ a: 'clear' })}>
          <Trash2 size={17} />
        </Btn>
        <Sep />
        <Btn label="Close the tools" onClick={closeTools}>
          <X size={17} />
        </Btn>
      </div>
      {palette && (
        <div className="mt-1.5 flex items-center gap-1.5 self-center rounded-[16px] bg-[#1c1c22]/95 p-1.5 shadow-[0_8px_28px_rgba(0,0,0,0.5),inset_0_0_0_1px_rgba(255,255,255,0.1)]">
          {DRAW_COLORS.map((c) => (
            <button
              key={c}
              aria-label={`Colour ${c}`}
              onClick={() => send({ a: 'color', v: c })}
              className={clsx('h-7 w-7 rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)] transition-transform hover:scale-110', state.color === c && 'ring-2 ring-white ring-offset-2 ring-offset-[#1c1c22]')}
              style={{ background: c }}
            />
          ))}
          <Sep />
          {SIZES.map((v) => (
            <button
              key={v}
              aria-label={`Size ${v}`}
              onClick={() => send({ a: 'size', v })}
              className={clsx('grid h-8 w-8 place-items-center rounded-[10px]', state.size === v ? 'bg-white/20' : 'hover:bg-white/10')}
            >
              <span className="rounded-full bg-white" style={{ width: v + 3, height: v + 3 }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Btn({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={clsx('grid h-9 w-9 place-items-center rounded-[11px] transition-colors disabled:opacity-30', active ? 'bg-[#0a84ff] text-white' : 'text-white/80 hover:bg-white/10 hover:text-white')}
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="mx-1 h-6 w-px bg-white/15" />;
