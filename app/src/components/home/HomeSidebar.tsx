import clsx from 'clsx';
import { motion } from 'motion/react';
import { AudioLines, Users } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import type { Channel } from '../../../../shared/protocol';
import { UserBar, VoicePanel } from '../shell/Sidebar';
import { Avatar } from '../ui/Avatar';
import { spring } from '@/lib/motion';
import { useChannels } from '@/stores/channels';
import { useFriends } from '@/stores/friends';
import { useMessages } from '@/stores/messages';

/** Home: Friends plus the list of direct messages. */
export function HomeSidebar() {
  const active = useChannels((s) => s.activeChannelId);
  const channels = useChannels((s) => s.channels);
  const incoming = useFriends((s) => s.friends.filter((f) => f.status === 'incoming').length);
  const dms = useMemo(() => channels.filter((c) => c.kind === 'dm'), [channels]);

  return (
    <aside className="glass-side hairline-r relative z-[5] flex w-[252px] shrink-0 flex-col">
      <header data-tauri-drag-region className="hairline-b flex h-[52px] shrink-0 items-center px-4">
        <span data-tauri-drag-region className="font-display text-[14.5px] font-semibold tracking-[-0.015em]">
          Home
        </span>
      </header>

      <div className="scroll flex-1 px-2 pb-3 pt-2" style={{ scrollbarGutter: 'auto' }}>
        <NavButton active={active === null} onClick={() => useChannels.getState().select(null)}>
          <Users size={16} className="relative shrink-0 text-fg-2" />
          <span className="relative flex-1 text-left">Friends</span>
          {incoming > 0 && <Badge>{incoming}</Badge>}
        </NavButton>

        <div className="mt-4 flex h-7 items-center px-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-fg-3">Direct messages</div>
        {dms.length === 0 ? (
          <p className="px-2 pt-1 text-[12px] leading-snug text-fg-3">Message a friend and your conversations show up here.</p>
        ) : (
          dms.map((dm) => <DmRow key={dm.id} dm={dm} active={active === dm.id} />)
        )}
      </div>

      <VoicePanel />
      <UserBar />
    </aside>
  );
}

function NavButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx('relative flex h-[38px] w-full items-center gap-2.5 rounded-[9px] px-2.5 text-[13.5px] transition-colors', active ? 'text-fg' : 'text-fg-2 hover:bg-fill-1 hover:text-fg')}
    >
      {active && <motion.span layoutId="home-selection" transition={spring} className="absolute inset-0 rounded-[9px] bg-fill-3 shadow-[inset_0_0.5px_0_var(--highlight)]" />}
      {children}
    </button>
  );
}

const Badge = ({ children }: { children: ReactNode }) => (
  <span className="relative grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10.5px] font-bold text-white">{children}</span>
);

function DmRow({ dm, active }: { dm: Channel; active: boolean }) {
  const peer = dm.peer;
  const online = useFriends((s) => (peer ? !!s.online[peer.id] : false));
  const textRoom = dm.rooms.find((r) => r.kind === 'text');
  const callRoom = dm.rooms.find((r) => r.kind === 'voice');
  const unread = useMessages((s) => (textRoom ? (s.unread[textRoom.id] ?? 0) : 0));
  const inCall = useChannels((s) => !!s.voice[dm.id]?.participants.some((p) => p.roomId === callRoom?.id));

  return (
    <NavButton active={active} onClick={() => useChannels.getState().select(dm.id)}>
      <Avatar user={peer} size={30} presence={online ? 'online' : 'offline'} className="relative" />
      <span className="relative min-w-0 flex-1 text-left">
        <span className={clsx('block truncate text-[13px] leading-tight', unread > 0 && !active && 'font-semibold text-fg')}>{peer?.name ?? 'Direct message'}</span>
        {inCall ? (
          <span className="flex items-center gap-1 text-[11px] leading-tight text-success">
            <AudioLines size={11} /> In a call
          </span>
        ) : (
          <span className="block truncate text-[11px] leading-tight text-fg-3">@{peer?.username}</span>
        )}
      </span>
      {unread > 0 && !active && <Badge>{unread}</Badge>}
    </NavButton>
  );
}
