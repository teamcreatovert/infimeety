import { AnimatePresence, motion } from 'motion/react';
import { PartyBanner } from '../voice/PartyBanner';
import { Hash, Megaphone, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { atLeast, type Channel, type PublicUser, type Room } from '../../../../shared/protocol';
import { MobileBack } from '../shell/MobileBack';
import { IconButton } from '../ui/primitives';
import { Composer, TypingIndicator } from './Composer';
import { MemberList } from './MemberList';
import { MessageList } from './MessageList';
import { useCompact } from '@/lib/responsive';
import { useChannels } from '@/stores/channels';
import { useMessages, type LocalMessage } from '@/stores/messages';
import { useUI } from '@/stores/ui';

export function ChatView({ channel, room, compact, dmPeer }: { channel: Channel; room: Room; compact?: boolean; dmPeer?: PublicUser }) {
  const [replyTo, setReplyTo] = useState<LocalMessage | null>(null);
  const unread = useMessages((s) => s.unread[room.id] ?? 0);
  const memberList = useUI((s) => s.memberList);
  const onlineCount = useChannels((s) => s.online[channel.id]?.length ?? 0);
  const memberCount = useChannels((s) => s.members[channel.id]?.length ?? 0);
  const phone = useCompact();

  useEffect(() => {
    void useMessages.getState().load(channel.id, room.id);
    useMessages.getState().markRead(room.id);
    const onFocus = () => useMessages.getState().markRead(room.id);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [channel.id, room.id]);

  useEffect(() => {
    if (unread && document.hasFocus()) useMessages.getState().markRead(room.id);
  }, [unread, room.id]);

  const cancelReply = useCallback(() => setReplyTo(null), []);

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {!compact && (
          <header data-tauri-drag-region className="hairline-b flex h-[52px] shrink-0 items-center gap-2 px-5 compact:px-3">
            <MobileBack />
            <Hash size={18} className="shrink-0 text-fg-3" />
            <h1 data-tauri-drag-region className="truncate font-display text-[15px] font-semibold tracking-[-0.015em]">
              {room.name}
            </h1>
            <span data-tauri-drag-region className="ml-1 flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px] text-fg-3 compact:hidden">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              {onlineCount} online · {memberCount} members
            </span>
            <div data-tauri-drag-region className="flex-1 self-stretch" />
            <IconButton label={memberList ? 'Hide members' : 'Show members'} active={memberList} onClick={() => useUI.getState().set({ memberList: !memberList })} tooltipSide="bottom">
              <Users size={17} />
            </IconButton>
          </header>
        )}
        {!compact && <PartyBanner channel={channel} />}
        <MessageList channel={channel} room={room} onReply={setReplyTo} compact={compact} dmPeer={dmPeer} />
        <TypingIndicator roomId={room.id} />
        {atLeast(channel.role, room.postRole) ? (
          <Composer channel={channel} room={room} replyTo={replyTo} onCancelReply={cancelReply} />
        ) : (
          // Only moderators or admins post here (an announcements room): members read.
          <div className="mx-4 mb-4 mt-1 flex items-center justify-center gap-2 rounded-[14px] bg-fill-1 px-4 py-3 text-[13px] text-fg-2 shadow-[inset_0_0_0_0.5px_var(--hairline-strong)] compact:mx-2.5 compact:mb-2.5">
            <Megaphone size={15} className="shrink-0 text-fg-3" />
            Only {room.postRole === 'admin' ? 'admins' : 'moderators and admins'} can post in #{room.name}
          </div>
        )}
      </div>
      {/* Phones: the member list slides over the chat instead of squeezing it. */}
      <AnimatePresence initial={false}>
        {!compact && memberList && phone && (
          <motion.div key="scrim" className="fixed inset-0 z-[60] bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => useUI.getState().set({ memberList: false })} />
        )}
        {!compact && memberList && phone && (
          <motion.div
            key="members-sheet"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 42 }}
            className="safe-area hairline-l fixed bottom-0 right-0 top-0 z-[61] w-[min(300px,85vw)] bg-[var(--bg)] shadow-2xl"
          >
            <MemberList channel={channel} />
          </motion.div>
        )}
        {!compact && memberList && !phone && (
          <motion.div
            key="members"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 248, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 40 }}
            className="hairline-l shrink-0 overflow-hidden"
          >
            <MemberList channel={channel} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
