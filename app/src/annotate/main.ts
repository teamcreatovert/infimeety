import { listen } from '@tauri-apps/api/event';
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
