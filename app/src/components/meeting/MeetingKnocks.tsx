import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo } from 'react';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/primitives';
import { spring } from '@/lib/motion';
import { useChannels } from '@/stores/channels';
import { useMeetings } from '@/stores/meetings';

const SHOWN = 3;

/** "⟨Guest⟩ wants to join": the waiting room, for the host and co-hosts of any meeting, wherever they are in the app. */
export function MeetingKnocks() {
  const channels = useChannels((s) => s.channels);
  const waiting = useMeetings((s) => s.waiting);
  const hosting = useMemo(() => channels.filter((c) => c.kind === 'meeting' && c.role !== 'member'), [channels]);
  const hostingKey = hosting.map((c) => c.id).join(',');

  // Just became host or co-host (or the app started): fetch who's already waiting.
  useEffect(() => {
    for (const c of hosting) void useMeetings.getState().loadWaiting(c.id);
  }, [hostingKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const knocks = hosting.flatMap((channel) => (waiting[channel.id] ?? []).map((user) => ({ channel, user })));
  const answer = (channelId: string, userId: string, admit: boolean) => void useMeetings.getState().answer(channelId, userId, admit);

  return (
    <div className="pointer-events-none fixed right-5 top-[64px] z-[110] flex w-[348px] max-w-[calc(100%-40px)] flex-col items-stretch gap-2">
      <AnimatePresence initial={false}>
        {knocks.slice(0, SHOWN).map(({ channel, user }) => (
          <motion.div
            key={`${channel.id}:${user.id}`}
            layout
            initial={{ opacity: 0, x: 28, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 28, scale: 0.96, transition: { duration: 0.16 } }}
            transition={spring}
            className="pointer-events-auto flex items-center gap-3 rounded-[20px] p-3 glass-pop"
          >
            <Avatar user={user} size={40} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-semibold">{user.name}</div>
              <div className="truncate text-[11.5px] text-fg-2">{hosting.length > 1 ? `Wants to join ${channel.name}` : 'Guest · wants to join'}</div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => answer(channel.id, user.id, false)}>
              Deny
            </Button>
            <Button size="sm" variant="primary" onClick={() => answer(channel.id, user.id, true)}>
              Admit
            </Button>
          </motion.div>
        ))}
        {knocks.length > 1 && (
          <motion.div key="all" layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-auto flex items-center justify-end gap-2 px-1">
            {knocks.length > SHOWN && <span className="text-[12px] text-fg-2">+{knocks.length - SHOWN} more waiting</span>}
            <Button size="sm" className="glass-pop" onClick={() => knocks.forEach((k) => answer(k.channel.id, k.user.id, true))}>
              Admit all {knocks.length}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
