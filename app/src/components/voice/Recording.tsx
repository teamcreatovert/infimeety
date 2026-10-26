import { useEffect, useState } from 'react';
import { useRecording, useRoomRecorders } from '@/lib/recording';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';

/** "● Recording · Bob" on the stage while anyone records the room, so everyone knows. */
export function RecordingBadge() {
  const recorders = useRoomRecorders();
  const users = useChannels((s) => s.users);
  const meId = useAuth((s) => s.me?.id);
  const mine = useRecording((s) => s.recording);
  const startedAt = useRecording((s) => s.startedAt);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!mine) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [mine]);
  if (!recorders?.length) return null;
  const names = recorders.map((id) => (id === meId ? 'you' : (users[id]?.name ?? 'someone')));
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <div className="pointer-events-none absolute left-1/2 top-[60px] z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/70 px-3 py-1 text-[12px] font-medium text-white backdrop-blur-md compact:top-[52px]">
      <span className="h-2 w-2 animate-pulse rounded-full bg-[#ff453a]" />
      Recording · {names.join(', ')}
      {mine && <span className="tabular-nums text-white/60">{clock}</span>}
    </div>
  );
}
