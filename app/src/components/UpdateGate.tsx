import { motion } from 'motion/react';
import { useUpdater } from '@/lib/updater';

/**
 * The screen Infimeety opens on while it makes sure it's the latest version, like Discord's:
 * "Checking for updates…", and when there is one, the download and install with progress,
 * then the app restarts on the new version. Gone in a moment when there's nothing new.
 */
export function UpdateGate() {
  const { launch, status, progress } = useUpdater();
  if (launch === 'done') return null;
  const label =
    status === 'downloading' ? `Updating Infimeety… ${Math.round(progress * 100)}%` : status === 'installing' || status === 'available' ? 'Installing the update…' : 'Checking for updates…';
  const busy = status === 'downloading' || status === 'installing' || status === 'available';
  return (
    <div className="absolute inset-0 z-[100] grid place-items-center bg-[var(--bg)]">
      <div className="flex flex-col items-center">
        <motion.img
          src="/icon.png"
          alt=""
          draggable={false}
          className="h-[84px] w-[84px] drop-shadow-[0_18px_30px_rgba(90,80,255,0.45)]"
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div className="mt-6 text-[14px] font-medium text-fg-2">{label}</div>
        <div className="mt-3 h-1 w-[180px] overflow-hidden rounded-full bg-fill-2">
          {busy ? (
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }} />
          ) : (
            <motion.div className="h-full w-1/3 rounded-full bg-accent" animate={{ x: ['-100%', '300%'] }} transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }} />
          )}
        </div>
      </div>
    </div>
  );
}
