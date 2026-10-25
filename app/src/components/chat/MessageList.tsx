import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, Hash, Volume2 } from 'lucide-react';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Channel, Room } from '../../../../shared/protocol';
import { Spinner } from '../ui/primitives';
import { MessageItem } from './MessageItem';
import { formatDay } from '@/lib/format';
import { spring } from '@/lib/motion';
import { useAuth } from '@/stores/auth';
import { useMessages, type LocalMessage } from '@/stores/messages';

const GROUP_WINDOW = 7 * 60_000;
const EMPTY: LocalMessage[] = [];

export function MessageList({ channel, room, onReply, compact }: { channel: Channel; room: Room; onReply: (m: LocalMessage) => void; compact?: boolean }) {
  const state = useMessages((s) => s.rooms[room.id]);
  const items = state?.items ?? EMPTY;
  const meId = useAuth((s) => s.me?.id);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const mountedAt = useRef(Date.now());
  const prevFirst = useRef<string | null>(null);
  const prevHeight = useRef(0);

  const byId = useMemo(() => new Map(items.map((m) => [m.id, m])), [items]);

  // Keep the viewport anchored when older messages are prepended; follow new ones at the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const first = items[0]?.id ?? null;
    if (prevFirst.current && first !== prevFirst.current && prevHeight.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    } else if (atBottom.current || items[items.length - 1]?.userId === meId) {
      el.scrollTop = el.scrollHeight;
    } else if (items.length) {
      setShowJump(true);
    }
    prevFirst.current = first;
    prevHeight.current = el.scrollHeight;
  }, [items, meId]);

  // Images load after layout; keep pinned to the bottom while they do.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
      prevHeight.current = el.scrollHeight;
    });
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [items.length]);

  const onScroll = () => {
    const el = scroller.current!;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom.current) setShowJump(false);
    if (el.scrollTop < 200 && state?.hasMore && !state.loading) {
      prevHeight.current = el.scrollHeight;
      void useMessages.getState().loadOlder(channel.id, room.id);
    }
  };

  const jumpTo = useCallback((id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.animate([{ background: 'color-mix(in srgb, var(--accent) 22%, transparent)' }, { background: 'transparent' }], { duration: 1400, easing: 'ease-out' });
  }, []);

  const scrollToBottom = () => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
    setShowJump(false);
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} onScroll={onScroll} className="scroll h-full pb-3" style={{ scrollbarGutter: 'auto' }}>
        <div>
          {state?.loading && (
            <div className="grid place-items-center py-4 text-fg-3">
              <Spinner />
            </div>
          )}
          {state?.loaded && !state.hasMore && <RoomIntro room={room} compact={compact} />}
          {items.map((m, i) => {
            const prev = items[i - 1];
            const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
            const grouped = !!prev && !newDay && prev.userId === m.userId && !m.replyTo && m.createdAt - prev.createdAt < GROUP_WINDOW;
            return (
              <Fragment key={m.nonce ?? m.id}>
                {newDay && <DayDivider ms={m.createdAt} />}
                <MessageItem
                  msg={m}
                  grouped={grouped}
                  channel={channel}
                  replyTarget={m.replyTo ? byId.get(m.replyTo) : undefined}
                  animate={m.createdAt > mountedAt.current}
                  onReply={onReply}
                  onJump={jumpTo}
                />
              </Fragment>
            );
          })}
        </div>
      </div>
      <AnimatePresence>
        {showJump && (
          <motion.button
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.9 }}
            transition={spring}
            onClick={scrollToBottom}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold glass-pop"
          >
            <ArrowDown size={13} /> New messages
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

function DayDivider({ ms }: { ms: number }) {
  return (
    <div className="my-3 flex items-center gap-3 px-5">
      <div className="h-px flex-1 bg-[var(--hairline-strong)]" />
      <span className="text-[11px] font-semibold text-fg-3">{formatDay(ms)}</span>
      <div className="h-px flex-1 bg-[var(--hairline-strong)]" />
    </div>
  );
}

function RoomIntro({ room, compact }: { room: Room; compact?: boolean }) {
  return (
    <div className={compact ? 'px-5 pb-2 pt-6' : 'px-5 pb-4 pt-14'}>
      <div className="grid h-14 w-14 place-items-center rounded-[18px] bg-fill-2 shadow-[inset_0_0_0_0.5px_var(--hairline-strong)]">
        {room.kind === 'text' ? <Hash size={26} className="text-fg-2" /> : <Volume2 size={26} className="text-fg-2" />}
      </div>
      <h2 className="mt-3 font-display text-[24px] font-bold tracking-[-0.025em]">{room.kind === 'text' ? `Welcome to #${room.name}` : `${room.name} chat`}</h2>
      <p className="mt-1 text-[13.5px] text-fg-2">
        {room.kind === 'text' ? 'This is the very beginning of the room. Say hi 👋' : 'Chat alongside the call. Messages stay here after everyone leaves.'}
      </p>
    </div>
  );
}
