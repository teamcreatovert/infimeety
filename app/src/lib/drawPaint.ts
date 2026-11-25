import type { Stroke } from '../../../shared/protocol';

/** A laser pointer trail: points, and when they were made (they fade). */
export interface Laser {
  by: string;
  pts: number[];
  at: number;
}

/** Paints marks (and laser trails) into a box at (ox, oy), w × h pixels. */
export function paint(ctx: CanvasRenderingContext2D, strokes: Stroke[], lasers: Laser[], ox: number, oy: number, w: number, h: number) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const X = (v: number) => ox + v * w;
  const Y = (v: number) => oy + v * h;
  for (const s of strokes) {
    const p = s.pts;
    if (p.length < 2) continue;
    ctx.strokeStyle = s.color;
    ctx.globalAlpha = s.tool === 'marker' ? 0.38 : 1;
    ctx.lineWidth = Math.max(1, (s.size / 1000) * w);
    ctx.beginPath();
    if (s.tool === 'pen' || s.tool === 'marker') {
      ctx.moveTo(X(p[0]), Y(p[1]));
      if (p.length === 2) ctx.lineTo(X(p[0]) + 0.1, Y(p[1]));
      // Smooth: curves through the midpoints between points.
      for (let i = 2; i + 3 < p.length; i += 2) ctx.quadraticCurveTo(X(p[i]), Y(p[i + 1]), (X(p[i]) + X(p[i + 2])) / 2, (Y(p[i + 1]) + Y(p[i + 3])) / 2);
      if (p.length >= 4) ctx.lineTo(X(p[p.length - 2]), Y(p[p.length - 1]));
      ctx.stroke();
    } else if (s.tool === 'rect') {
      ctx.strokeRect(Math.min(X(p[0]), X(p[2])), Math.min(Y(p[1]), Y(p[3])), Math.abs(X(p[2]) - X(p[0])), Math.abs(Y(p[3]) - Y(p[1])));
    } else if (s.tool === 'ellipse') {
      ctx.ellipse((X(p[0]) + X(p[2])) / 2, (Y(p[1]) + Y(p[3])) / 2, Math.abs(X(p[2]) - X(p[0])) / 2, Math.abs(Y(p[3]) - Y(p[1])) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.moveTo(X(p[0]), Y(p[1]));
      ctx.lineTo(X(p[2]), Y(p[3]));
      ctx.stroke();
      if (s.tool === 'arrow') {
        const a = Math.atan2(Y(p[3]) - Y(p[1]), X(p[2]) - X(p[0]));
        const head = Math.max(10, ctx.lineWidth * 3.5);
        ctx.beginPath();
        ctx.moveTo(X(p[2]), Y(p[3]));
        ctx.lineTo(X(p[2]) - head * Math.cos(a - 0.45), Y(p[3]) - head * Math.sin(a - 0.45));
        ctx.moveTo(X(p[2]), Y(p[3]));
        ctx.lineTo(X(p[2]) - head * Math.cos(a + 0.45), Y(p[3]) - head * Math.sin(a + 0.45));
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
  // Laser: a glowing red trail that fades.
  const now = Date.now();
  for (const l of lasers) {
    const age = (now - l.at) / 1200;
    if (age >= 1) continue;
    ctx.globalAlpha = 1 - age;
    ctx.fillStyle = '#ff2d2d';
    ctx.shadowColor = '#ff2d2d';
    ctx.shadowBlur = 12;
    for (let i = 0; i + 1 < l.pts.length; i += 2) {
      ctx.beginPath();
      ctx.arc(X(l.pts[i]), Y(l.pts[i + 1]), Math.max(3, w * 0.0045), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
}
