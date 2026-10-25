import { WALLPAPERS, useSettings } from '@/stores/settings';
import { useVoice } from '@/stores/voice';

/** Soft, slowly drifting color fields behind the glass. Paused during calls to save GPU for video. */
export function Background() {
  const wallpaper = useSettings((s) => s.wallpaper);
  const living = useSettings((s) => s.livingWallpaper);
  const inCall = useVoice((s) => s.status !== 'idle');
  const [a, b, c] = WALLPAPERS[wallpaper] ?? WALLPAPERS.aurora;
  const play = living && !inCall ? 'running' : 'paused';

  const blob = (color: string, style: React.CSSProperties, anim: string) => (
    <div
      className="absolute rounded-full"
      style={{
        background: color,
        filter: 'blur(110px)',
        opacity: 'var(--wall-opacity)',
        animation: `${anim} ease-in-out infinite`,
        animationPlayState: play,
        willChange: 'transform',
        ...style,
      }}
    />
  );

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ background: 'var(--bg)' }}>
      {blob(a, { width: '62vw', height: '62vw', left: '-14vw', top: '-26vw' }, 'drift-a 42s')}
      {blob(b, { width: '54vw', height: '54vw', right: '-16vw', bottom: '-24vw' }, 'drift-b 48s')}
      {blob(c, { width: '38vw', height: '38vw', left: '34vw', top: '30vh' }, 'drift-c 56s')}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 90% at 50% 0%, transparent 40%, var(--vignette) 100%)' }} />
    </div>
  );
}
