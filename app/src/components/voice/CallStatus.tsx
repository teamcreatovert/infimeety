import { AnimatePresence, motion } from 'motion/react';
import { Phone } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Channel, Room, VoiceParticipant } from '../../../../shared/protocol';
import { Avatar } from '../ui/Avatar';
import { useDeclined } from '@/lib/calls';
import { spring } from '@/lib/motion';
import { sounds } from '@/lib/sounds';
import { voice } from '@/lib/voice/engine';
import { useChannels } from '@/stores/channels';
import { useFriends } from '@/stores/friends';

/** As long as the other side rings (IncomingCall.tsx). */
const RING_FOR = 45_000;

type Status = 'ringing' | 'offline' | 'declined' | 'missed';

/** Each call you made (your seat in it): when it started ringing, and whether anyone picked up. */
const calls = new Map<string, { since: number; answered: boolean }>();
function callOf(key: string) {
  let call = calls.get(key);
  if (!call) calls.set(key, (call = { since: Date.now(), answered: false }));
  return call;
}

/**
 * What the caller sees while alone in a DM call: ringing, declined, no answer, or offline.
 * Gone once the friend picks up.
 */
export function CallStatus({ channel, room, connected, me, alone }: { channel: Channel; room: Room; connected: boolean; me?: VoiceParticipant; alone: boolean }) {
  const peer = channel.peer;
  const online = useChannels((s) => !!peer && (s.online[channel.id]?.includes(peer.id) ?? false));
  const friendOnline = useFriends((s) => !!peer && !!s.online[peer.id]);
  const declinedAt = useDeclined((s) => s[room.id] ?? 0);
  const [, tick] = useState(0);

  // It rings from when you join alone until someone picks up. A friend who hangs up later
  // isn't called again; joining again (Call again) is a new call.
  const call = me && connected ? callOf(`${me.peerId}:${me.joinedAt}`) : undefined;
  if (call && !alone) call.answered = true;
  const since = call && alone && !call.answered ? call.since : 0;
  useEffect(() => {
    if (!since) return;
    const timer = setTimeout(() => tick((n) => n + 1), Math.max(0, since + RING_FOR - Date.now()));
    return () => clearTimeout(timer);
  }, [since]);

  const status: Status | null = !since
    ? null
    : declinedAt > since
      ? 'declined'
      : Date.now() - since >= RING_FOR
        ? 'missed'
        : online || friendOnline
          ? 'ringing'
          : 'offline';

  // Ringback while it rings, and a tone when it doesn't go through.
  const prev = useRef<Status | null>(null);
  useEffect(() => {
    if ((status === 'declined' || status === 'missed') && prev.current === 'ringing') sounds.callEnded();
    prev.current = status;
    if (status !== 'ringing') return;
    sounds.ringback();
    const ring = setInterval(() => sounds.ringback(), 3000);
    return () => clearInterval(ring);
  }, [status]);

  const callAgain = async () => {
    voice.leave({ silent: true });
    await voice.join(channel.id, room.id);
  };

  const name = peer?.name ?? 'Your friend';
  const text = {
    ringing: 'Ringing…',
    offline: `${name} is offline`,
    declined: `${name} declined`,
    missed: 'No answer',
  };

  return (
    <AnimatePresence>
      {status && (
        <motion.div
          initial={{ opacity: 0, y: -10, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.97 }}
          transition={spring}
          className="absolute left-1/2 top-4 z-30 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-full py-1.5 pl-1.5 pr-2 glass-pop"
        >
          <motion.div
            animate={status === 'ringing' ? { scale: [1, 1.07, 1] } : { scale: 1 }}
            transition={status === 'ringing' ? { duration: 1.3, repeat: Infinity } : spring}
            className="rounded-full"
          >
            <Avatar user={peer} size={30} />
          </motion.div>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={status}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={spring}
              className={`text-[13px] font-medium ${status === 'declined' || status === 'missed' ? 'text-fg-2' : ''}`}
            >
              {text[status]}
            </motion.span>
          </AnimatePresence>
          {status === 'declined' || status === 'missed' ? (
            <motion.button
              whileTap={{ scale: 0.94 }}
              onClick={() => void callAgain()}
              className="flex items-center gap-1.5 rounded-full bg-success px-3 py-1.5 text-[12px] font-semibold text-white"
            >
              <Phone size={13} /> Call again
            </motion.button>
          ) : (
            <span className="w-1.5" />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
