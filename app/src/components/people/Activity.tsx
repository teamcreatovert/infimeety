import clsx from 'clsx';
import { Gamepad2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useActivities } from '@/lib/activity';

/** What someone is playing, if anything. */
export const useActivity = (userId?: string | null) => useActivities((s) => (userId ? s[userId] : undefined));

/** "Playing VALORANT" under a name, in place of the usual line. */
export function ActivityLine({ userId, className }: { userId?: string | null; className?: string }) {
  const activity = useActivity(userId);
  if (!activity) return null;
  return (
    <span className={clsx('flex min-w-0 items-center gap-1 text-success', className)}>
      <Gamepad2 size={12} className="shrink-0" />
      <span className="truncate">
        Playing <span className="font-semibold">{activity.name}</span>
      </span>
    </span>
  );
}

/** The bigger version on a profile: the game and for how long. */
export function ActivityCard({ userId }: { userId?: string | null }) {
  const activity = useActivity(userId);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!activity) return;
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, [activity]);
  if (!activity) return null;
  const minutes = Math.max(0, Math.floor((Date.now() - activity.since) / 60_000));
  const length = minutes < 1 ? 'just started' : minutes < 60 ? `for ${minutes} min` : `for ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return (
    <div className="mt-3 flex items-center gap-3 rounded-[12px] bg-fill-1 p-2.5">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-success/15 text-success">
        <Gamepad2 size={20} />
      </div>
      <div className="min-w-0">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-fg-3">Playing a game</div>
        <div className="truncate text-[13.5px] font-semibold">{activity.name}</div>
        <div className="text-[11.5px] text-fg-3">{length}</div>
      </div>
    </div>
  );
}
