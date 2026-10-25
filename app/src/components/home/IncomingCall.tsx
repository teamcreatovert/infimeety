import { AnimatePresence, motion } from 'motion/react';
import { Phone, PhoneOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '../ui/Avatar';
import { spring } from '@/lib/motion';
import { appWindow } from '@/lib/platform';
import { sounds } from '@/lib/sounds';
import { voice } from '@/lib/voice/engine';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { useVoice } from '@/stores/voice';

const RING_FOR = 45_000;

/**
 * Rings when a friend starts a call in your DM and you're not in it.
 * Calls are just DM call rooms, so this watches the voice state the hubs already send.
 */
export function IncomingCall() {
  const channels = useChannels((s) => s.channels);
  const voiceState = useChannels((s) => s.voice);
  const myRoom = useVoice((s) => s.roomId);
  const meId = useAuth((s) => s.me?.id);
  const [dismissed, setDismissed] = useState<Record<string, true>>({});
  const [, tick] = useState(0);

  const call = useMemo(() => {
    for (const dm of channels) {
      if (dm.kind !== 'dm' || !dm.peer) continue;
      const room = dm.rooms.find((r) => r.kind === 'voice');
      const caller = voiceState[dm.id]?.participants.find((p) => p.roomId === room?.id && p.userId !== meId);
      if (!room || !caller || myRoom === room.id) continue;
      const key = `${caller.peerId}:${caller.joinedAt}`;
      if (dismissed[key] || Date.now() - caller.joinedAt > RING_FOR) continue;
      return { dm, room, key, joinedAt: caller.joinedAt };
    }
    return null;
  }, [channels, voiceState, myRoom, meId, dismissed]);

  // Ring until answered, declined, or it times out.
  useEffect(() => {
    if (!call) return;
    sounds.ring();
    void appWindow.attention();
    const ring = setInterval(() => sounds.ring(), 2600);
    const timeout = setTimeout(() => tick((n) => n + 1), Math.max(0, call.joinedAt + RING_FOR - Date.now()));
    return () => {
      clearInterval(ring);
      clearTimeout(timeout);
    };
  }, [call?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const decline = () => call && setDismissed((d) => ({ ...d, [call.key]: true }));
  const accept = async () => {
    if (!call) return;
    decline();
    useChannels.getState().select(call.dm.id);
    await voice.join(call.dm.id, call.room.id);
  };

  return (
    <AnimatePresence>
      {call && (
        <motion.div
          key={call.key}
          initial={{ opacity: 0, y: -20, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12, scale: 0.96 }}
          transition={spring}
          className="fixed right-5 top-[46px] z-[115] flex w-[320px] items-center gap-3 rounded-[22px] p-3.5 glass-pop"
        >
          <motion.div animate={{ scale: [1, 1.06, 1] }} transition={{ duration: 1.3, repeat: Infinity }} className="rounded-full shadow-[0_0_0_3px_color-mix(in_srgb,var(--success)_45%,transparent)]">
            <Avatar user={call.dm.peer} size={46} />
          </motion.div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold">{call.dm.peer?.name}</div>
            <div className="text-[12px] text-fg-2">is calling you…</div>
          </div>
          <motion.button aria-label="Decline" whileTap={{ scale: 0.9 }} onClick={decline} className="grid h-10 w-10 place-items-center rounded-full bg-danger text-white">
            <PhoneOff size={17} />
          </motion.button>
          <motion.button aria-label="Accept" whileTap={{ scale: 0.9 }} onClick={() => void accept()} className="grid h-10 w-10 place-items-center rounded-full bg-success text-white">
            <Phone size={17} />
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
