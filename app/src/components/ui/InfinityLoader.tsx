import { useId } from 'react';

/**
 * Infimeety's start animation: an infinity loop with a bright stroke endlessly tracing it, in the
 * icon's blue-to-violet. Pure SVG and CSS, so it runs smoothly while the app is still loading.
 */
export function InfinityLoader({ size = 96 }: { size?: number }) {
  const gradient = useId();
  // One smooth figure eight; pathLength makes the dash maths independent of the drawn size.
  const path = 'M50 30 C 62 14, 86 14, 86 30 C 86 46, 62 46, 50 30 C 38 14, 14 14, 14 30 C 14 46, 38 46, 50 30 Z';
  return (
    <svg width={size} height={size * 0.6} viewBox="0 0 100 60" fill="none" aria-hidden>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="100" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4f6bff" />
          <stop offset="1" stopColor="#9652ff" />
        </linearGradient>
      </defs>
      <path d={path} pathLength={100} stroke={`url(#${gradient})`} strokeOpacity={0.18} strokeWidth={7} strokeLinecap="round" />
      <path d={path} pathLength={100} stroke={`url(#${gradient})`} strokeWidth={7} strokeLinecap="round" strokeDasharray="28 72" className="infinity-trace" />
    </svg>
  );
}
