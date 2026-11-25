import { emitTo, listen } from '@tauri-apps/api/event';
import type { Stroke } from '../../../shared/protocol';
import { paint } from '../lib/drawPaint';

// The sharer's see-through window over the screen they share: it paints everyone's marks, sent
// by the main window, exactly where they land on the shared picture.
type Laser = { by: string; pts: number[]; at: number };
const canvas = document.getElementById('marks') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
let strokes: Stroke[] = [];
let lasers: Laser[] = [];
let raf = 0;

function frame() {
  raf = 0;
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  paint(ctx, strokes, lasers, 0, 0, w, h);
  // Keep going while a laser trail fades.
  if (lasers.some((l) => Date.now() - l.at < 1200)) raf = requestAnimationFrame(frame);
}
const redraw = () => {
  if (!raf) raf = requestAnimationFrame(frame);
};

void listen<{ strokes: Stroke[]; lasers: Laser[] }>('annotate:state', (e) => {
  strokes = e.payload.strokes;
  // Lasers carry their age, so a trail fades the same here as in the app.
  lasers = e.payload.lasers;
  redraw();
});
window.addEventListener('resize', redraw);

// Drawing on your own screen: while a tool is on, this window takes the mouse (otherwise clicks
// go straight through to your apps). Points go to the app, which draws and shares them. Messages
// go one after another (never overtaking each other), numbered, so the app can drop repeats.
let chain: Promise<unknown> = Promise.resolve();
let n = 0;
let stroke = 0;
const tell = (k: 'down' | 'move' | 'up', pts: number[]) => {
  const msg = { k, pts, s: stroke, n: ++n };
  chain = chain.then(() => emitTo('main', 'annotate:input', msg)).catch(() => {});
};
let queued: number[] = [];
let flushing = false;
const flush = () => {
  flushing = false;
  if (!queued.length) return;
  tell('move', queued);
  queued = [];
};
const at = (e: PointerEvent) => [e.clientX / window.innerWidth, e.clientY / window.innerHeight];
let down = false;
const onDown = (e: PointerEvent) => {
  // Right-click: stop drawing and get your mouse back (the quick way out).
  if (e.button === 2) {
    e.preventDefault();
    void emitTo('main', 'drawtools:do', { a: 'tool', v: 'pointer' }).catch(() => {});
    return;
  }
  if (e.button !== 0) return;
  down = true;
  stroke++;
  tell('down', at(e));
};
const onMove = (e: PointerEvent) => {
  if (!down) return;
  const merged = e.getCoalescedEvents?.() ?? [];
  for (const ev of merged.length ? merged : [e]) queued.push(...at(ev));
  if (!flushing) {
    flushing = true;
    requestAnimationFrame(flush);
  }
};
const onUp = (e: PointerEvent) => {
  if (!down) return;
  down = false;
  queued.push(...at(e));
  flush();
  tell('up', []);
};
// Once per page, even if this code is loaded again.
const w = window as unknown as { __drawInput?: boolean };
if (!w.__drawInput) {
  w.__drawInput = true;
  document.addEventListener('pointerdown', onDown);
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}
// A crosshair while drawing (the window only gets the mouse then).
document.documentElement.style.cursor = 'crosshair';
