import { create } from 'zustand';
import type { DrawOp, DrawTool, Stroke } from '../../../shared/protocol';
import { getHub } from './realtime';

/**
 * Drawing together in meetings: the whiteboard ('board') and marks on someone's shared screen
 * ('screen:<peerId>'). Marks are lines and shapes in 0 to 1 coordinates across the surface, so
 * they land in the same place on every screen size. The hub keeps them while the meeting lasts.
 */

export type Tool = DrawTool | 'eraser' | 'laser' | 'pointer';
type Undo = { k: 'drew'; stroke: Stroke } | { k: 'erased'; strokes: Stroke[] };

interface Laser {
  by: string;
  pts: number[];
  at: number;
}

interface DrawState {
  /** Marks on each surface, oldest first. */
  strokes: Record<string, Stroke[]>;
  /** Laser pointer trails (fade within a second or so). */
  lasers: Record<string, Laser[]>;
  /** Surfaces this connection has the full picture of. */
  synced: Record<string, boolean>;
  /** The tools are open (the "Draw" button). */
  open: boolean;
  tool: Tool;
  color: string;
  /** Line width, thousandths of the surface width. */
  size: number;
  undo: Record<string, Undo[]>;
  redo: Record<string, Undo[]>;
  set: (patch: Partial<DrawState>) => void;
}

export const useDraw = create<DrawState>()((set) => ({
  strokes: {},
  lasers: {},
  synced: {},
  open: false,
  tool: 'pen',
  color: '#ff3b30',
  size: 4,
  undo: {},
  redo: {},
  set: (patch) => set(patch),
}));

export const SIZES = [
  { value: 3, label: 'Thin' },
  { value: 6, label: 'Medium' },
  { value: 12, label: 'Thick' },
];

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');

function setStrokes(surface: string, update: (list: Stroke[]) => Stroke[]) {
  useDraw.setState((s) => ({ strokes: { ...s.strokes, [surface]: update(s.strokes[surface] ?? []) } }));
}

function push(stack: 'undo' | 'redo', surface: string, entry: Undo) {
  useDraw.setState((s) => ({ [stack]: { ...s[stack], [surface]: [...(s[stack][surface] ?? []), entry].slice(-100) } }) as Partial<DrawState>);
}

function pop(stack: 'undo' | 'redo', surface: string): Undo | undefined {
  const list = useDraw.getState()[stack][surface] ?? [];
  const last = list[list.length - 1];
  if (last) useDraw.setState((s) => ({ [stack]: { ...s[stack], [surface]: list.slice(0, -1) } }) as Partial<DrawState>);
  return last;
}

const send = (channelId: string, surface: string, op: DrawOp) => getHub(channelId)?.send({ t: 'draw', surface, op });

/** Ask for everything drawn on a surface (once per connection). */
export function syncSurface(channelId: string, surface: string) {
  if (useDraw.getState().synced[surface]) return;
  const hub = getHub(channelId);
  if (!hub) return;
  useDraw.setState((s) => ({ synced: { ...s.synced, [surface]: true } }));
  hub.send({ t: 'draw.sync', surface });
}

/** A reconnect: the hub's picture is the truth again. */
export function resetDrawSync() {
  useDraw.setState({ synced: {} });
}

// ─── From the hub ─────────────────────────────────────────────────────────────

export function onDrawState(surface: string, strokes: Stroke[]) {
  setStrokes(surface, () => strokes);
}

export function onDrawOp(surface: string, op: DrawOp, by: string) {
  switch (op.k) {
    case 'begin':
      return setStrokes(surface, (list) => [...list.filter((s) => s.id !== op.stroke.id), op.stroke]);
    case 'pts':
      return setStrokes(surface, (list) => list.map((s) => (s.id === op.id ? { ...s, pts: [...s.pts, ...op.pts] } : s)));
    case 'shape':
      return setStrokes(surface, (list) => list.map((s) => (s.id === op.id ? { ...s, pts: op.pts } : s)));
    case 'end':
      return;
    case 'add': {
      const ids = new Set(op.strokes.map((s) => s.id));
      return setStrokes(surface, (list) => [...list.filter((s) => !ids.has(s.id)), ...op.strokes]);
    }
    case 'remove': {
      const ids = new Set(op.ids);
      return setStrokes(surface, (list) => list.filter((s) => !ids.has(s.id)));
    }
    case 'clear':
      useDraw.setState((s) => ({ undo: { ...s.undo, [surface]: [] }, redo: { ...s.redo, [surface]: [] } }));
      return setStrokes(surface, () => []);
    case 'laser':
      return addLaser(surface, by, op.pts);
  }
}

function addLaser(surface: string, by: string, pts: number[]) {
  const now = Date.now();
  useDraw.setState((s) => ({ lasers: { ...s.lasers, [surface]: [...(s.lasers[surface] ?? []).filter((l) => now - l.at < 1400), { by, pts, at: now }] } }));
}

// ─── Your own drawing ─────────────────────────────────────────────────────────

/**
 * One mark being drawn: sent as it grows (a few times a second), so others watch it appear.
 * Shapes (line, arrow, box, circle) are two points that change until you let go.
 */
export function startStroke(channelId: string, surface: string, me: string, x: number, y: number) {
  const { tool, color, size } = useDraw.getState();
  if (tool === 'eraser' || tool === 'laser' || tool === 'pointer') return null;
  const shape = tool !== 'pen' && tool !== 'marker';
  const stroke: Stroke = { id: randomId(), by: me, tool, color, size: tool === 'marker' ? Math.min(24, Math.max(10, size * 3)) : size, pts: shape ? [x, y, x, y] : [x, y] };
  setStrokes(surface, (list) => [...list, stroke]);
  send(channelId, surface, { k: 'begin', stroke });
  let pending: number[] = [];
  let last = [x, y];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    if (shape) send(channelId, surface, { k: 'shape', id: stroke.id, pts: stroke.pts });
    else if (pending.length) {
      // The hub takes up to 200 points a message.
      for (let i = 0; i < pending.length; i += 400) send(channelId, surface, { k: 'pts', id: stroke.id, pts: pending.slice(i, i + 400) });
      pending = [];
    }
  };
  const schedule = () => {
    if (!timer) timer = setTimeout(flush, 50);
  };
  return {
    move(nx: number, ny: number) {
      if (shape) {
        stroke.pts = [stroke.pts[0], stroke.pts[1], nx, ny];
      } else {
        // Points closer than this add nothing you could see.
        if (Math.hypot(nx - last[0], ny - last[1]) < 0.0015 || stroke.pts.length >= 1990) return;
        last = [nx, ny];
        stroke.pts = [...stroke.pts, nx, ny];
        pending.push(nx, ny);
      }
      setStrokes(surface, (list) => list.map((s) => (s.id === stroke.id ? { ...stroke } : s)));
      schedule();
    },
    end() {
      if (timer) clearTimeout(timer);
      flush();
      // A tap with a pen leaves a dot; a shape you didn't drag isn't kept.
      if (shape && Math.hypot(stroke.pts[2] - stroke.pts[0], stroke.pts[3] - stroke.pts[1]) < 0.004) {
        setStrokes(surface, (list) => list.filter((s) => s.id !== stroke.id));
        send(channelId, surface, { k: 'remove', ids: [stroke.id] });
        return;
      }
      if (!shape && stroke.pts.length === 2) {
        stroke.pts = [x, y, x + 0.0005, y + 0.0005];
        send(channelId, surface, { k: 'pts', id: stroke.id, pts: [x + 0.0005, y + 0.0005] });
      }
      send(channelId, surface, { k: 'end', id: stroke.id });
      push('undo', surface, { k: 'drew', stroke: { ...stroke } });
      useDraw.setState((s) => ({ redo: { ...s.redo, [surface]: [] } }));
    },
  };
}

/** The laser pointer: a trail everyone sees fade, never kept. */
export function startLaser(channelId: string, surface: string, me: string) {
  let pending: number[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    move(x: number, y: number) {
      pending.push(x, y);
      addLaser(surface, me, [x, y]);
      if (!timer)
        timer = setTimeout(() => {
          timer = null;
          send(channelId, surface, { k: 'laser', pts: pending.slice(-64) });
          pending = [];
        }, 60);
    },
    end() {},
  };
}

/** The eraser takes away the marks it touches (yours, or anyone's where you're allowed). */
export function eraseAt(channelId: string, surface: string, x: number, y: number, aspect: number, mayErase: (s: Stroke) => boolean) {
  const hit = (useDraw.getState().strokes[surface] ?? []).filter((s) => mayErase(s) && touches(s, x, y, aspect));
  if (!hit.length) return;
  const ids = new Set(hit.map((s) => s.id));
  setStrokes(surface, (list) => list.filter((s) => !ids.has(s.id)));
  send(channelId, surface, { k: 'remove', ids: [...ids] });
  push('undo', surface, { k: 'erased', strokes: hit });
  useDraw.setState((s) => ({ redo: { ...s.redo, [surface]: [] } }));
}

export function undo(channelId: string, surface: string, me: string) {
  const last = pop('undo', surface);
  if (!last) return;
  if (last.k === 'drew') {
    setStrokes(surface, (list) => list.filter((s) => s.id !== last.stroke.id));
    send(channelId, surface, { k: 'remove', ids: [last.stroke.id] });
  } else {
    // Only your own marks come back (someone else's you erased stay theirs to redraw).
    const mine = last.strokes.filter((s) => s.by === me);
    if (mine.length) {
      setStrokes(surface, (list) => [...list, ...mine]);
      send(channelId, surface, { k: 'add', strokes: mine });
    }
  }
  push('redo', surface, last);
}

export function redo(channelId: string, surface: string, _me?: string) {
  const last = pop('redo', surface);
  if (!last) return;
  if (last.k === 'drew') {
    setStrokes(surface, (list) => [...list, last.stroke]);
    send(channelId, surface, { k: 'add', strokes: [last.stroke] });
  } else {
    const ids = new Set(last.strokes.map((s) => s.id));
    setStrokes(surface, (list) => list.filter((s) => !ids.has(s.id)));
    send(channelId, surface, { k: 'remove', ids: [...ids] });
  }
  push('undo', surface, last);
}

export function clearSurface(channelId: string, surface: string, me: string, mine: boolean) {
  setStrokes(surface, (list) => (mine ? list.filter((s) => s.by !== me) : []));
  useDraw.setState((s) => ({ undo: { ...s.undo, [surface]: [] }, redo: { ...s.redo, [surface]: [] } }));
  send(channelId, surface, { k: 'clear', mine });
}

// ─── Geometry and painting (also used by the sharer's on-screen overlay) ──────

/** Does a mark pass within the eraser's reach of (x, y)? `aspect`: the surface's width / height. */
function touches(s: Stroke, x: number, y: number, aspect: number) {
  const reach = 0.012 + (s.size / 1000) * 0.6;
  const d = (ax: number, ay: number, bx: number, by: number) => segDist(x * aspect, y, ax * aspect, ay, bx * aspect, by);
  const p = s.pts;
  if (s.tool === 'rect') {
    const [x1, y1, x2, y2] = p;
    return d(x1, y1, x2, y1) < reach || d(x2, y1, x2, y2) < reach || d(x2, y2, x1, y2) < reach || d(x1, y2, x1, y1) < reach;
  }
  if (s.tool === 'ellipse') {
    const cx = (p[0] + p[2]) / 2;
    const cy = (p[1] + p[3]) / 2;
    const rx = Math.abs(p[2] - p[0]) / 2 || 1e-6;
    const ry = Math.abs(p[3] - p[1]) / 2 || 1e-6;
    const k = Math.hypot((x - cx) / rx, (y - cy) / ry);
    return Math.abs(k - 1) * Math.min(rx, ry) < reach;
  }
  for (let i = 0; i + 3 < p.length; i += 2) if (d(p[i], p[i + 1], p[i + 2], p[i + 3]) < reach) return true;
  return false;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export { paint } from './drawPaint';
