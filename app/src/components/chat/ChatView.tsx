import { AnimatePresence, motion } from 'motion/react';
import { Hash, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { Channel, PublicUser, Room } from '../../../../shared/protocol';
import { IconButton } from '../ui/primitives';
import { Composer, TypingIndicator } from './Composer';
import { MemberList } from './MemberList';
import { MessageList } from './MessageList';
import { useChannels } from '@/stores/channels';
import { useMessages, type LocalMessage } from '@/stores/messages';
import { useUI } from '@/stores/ui';

export function ChatView({ channel, room, compact, dmPeer }: { channel: Channel; room: Room; compact?: boolean; dmPeer?: PublicUser }) {
  const [replyTo, setReplyTo] = useState<LocalMessage | null>(null);
  const unread = useMessages((s) => s.unread[room.id] ?? 0);
  const memberList = useUI((s) => s.memberList);
  const onlineCount = useChannels((s) => s.online[channel.id]?.length ?? 0);
  const memberCount = useChannels((s) => s.members[channel.id]?.length ?? 0);

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
          <header data-tauri-drag-region className="hairline-b flex h-[52px] shrink-0 items-center gap-2 px-5">
            <Hash size={18} className="text-fg-3" />
            <h1 data-tauri-drag-region className="font-display text-[15px] font-semibold tracking-[-0.015em]">
              {room.name}
            </h1>
            <span data-tauri-drag-region className="ml-1 flex items-center gap-1.5 text-[12px] text-fg-3">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              {onlineCount} online · {memberCount} members
            </span>
            <div data-tauri-drag-region className="flex-1 self-stretch" />
            <IconButton label={memberList ? 'Hide members' : 'Show members'} active={memberList} onClick={() => useUI.getState().set({ memberList: !memberList })} tooltipSide="bottom">
              <Users size={17} />
            </IconButton>
          </header>
        )}
        <MessageList channel={channel} room={room} onReply={setReplyTo} compact={compact} dmPeer={dmPeer} />
        <TypingIndicator roomId={room.id} />
        <Composer channel={channel} room={room} replyTo={replyTo} onCancelReply={cancelReply} />
      </div>
      <AnimatePresence initial={false}>
        {!compact && memberList && (
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
