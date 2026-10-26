import clsx from 'clsx';
import { useEffect, useRef } from 'react';

/** Video-only element; audio is played through the Web Audio graph so volumes work. `stage` marks watch mode's big video. */
export function StreamVideo({ stream, mirror, contain, stage, className }: { stream: MediaStream; mirror?: boolean; contain?: boolean; stage?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v || v.srcObject === stream) return;
    v.srcObject = stream;
    void v.play().catch(() => {});
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      data-stage={stage || undefined}
      disablePictureInPicture={!stage}
      className={clsx('h-full w-full', contain ? 'object-contain' : 'object-cover', className)}
      style={mirror ? { transform: 'scaleX(-1)' } : undefined}
    />
  );
}
