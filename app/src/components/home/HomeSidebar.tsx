import clsx from 'clsx';
import { motion } from 'motion/react';
import { AudioLines, BellOff, Download, Link2, Pin, Users, Video } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Channel } from '../../../../shared/protocol';
import { UserBar, VoicePanel } from '../shell/Sidebar';
import { Avatar } from '../ui/Avatar';
import { Spinner } from '../ui/primitives';
import { DOWNLOAD_PAGE } from '@/config';
import { channelGradient } from '@/lib/format';
import { timeLeft } from '@/lib/meeting';
import { spring } from '@/lib/motion';
import { isTauri } from '@/lib/platform';
import { useChannels } from '@/stores/channels';
import { useFriends } from '@/stores/friends';
import { useMeetings } from '@/stores/meetings';
import { useMessages } from '@/stores/messages';
import { useSettings } from '@/stores/settings';
import { openUserMenu, showMain, toast } from '@/stores/ui';

/** Home: Friends, quick meetings, and the list of direct messages. */
export function HomeSidebar() {
  const active = useChannels((s) => s.activeChannelId);
  const channels = useChannels((s) => s.channels);
  const incoming = useFriends((s) => s.friends.filter((f) => f.status === 'incoming').length);
  const pinned = useSettings((s) => s.pinnedDms);
  const closed = useSettings((s) => s.closedDms);
  // Pinned first; closed conversations stay hidden until they're opened or written to again.
  const dms = useMemo(() => {
    const list = channels.filter((c) => c.kind === 'dm' && (!closed[c.id] || c.id === active));
    return [...list.filter((c) => pinned.includes(c.id)), ...list.filter((c) => !pinned.includes(c.id))];
  }, [channels, pinned, closed, active]);

  // Opening a closed conversation (e.g. from Friends) brings it back for good.
  useEffect(() => {
    if (active && closed[active]) useSettings.getState().setDmClosed(active, false);
  }, [active, closed]);

  const meetings = useMemo(() => channels.filter((c) => c.kind === 'meeting'), [channels]);
  const [starting, setStarting] = useState(false);

  const startMeeting = async () => {
    setStarting(true);
    try {
      const meeting = await useMeetings.getState().create();
      await useMeetings.getState().enterCall(meeting);
    } catch {
      toast({ kind: 'error', title: 'Couldn’t start a meeting', body: 'Check your connection.' });
    } finally {
      setStarting(false);
    }
  };

  return (
    <aside className="glass-side hairline-r relative z-[5] flex w-[252px] shrink-0 flex-col compact:w-auto compact:min-w-0 compact:flex-1">
      <header data-tauri-drag-region className="hairline-b flex h-[52px] shrink-0 items-center px-4">
        <span data-tauri-drag-region className="font-display text-[14.5px] font-semibold tracking-[-0.015em]">
          Home
        </span>
      </header>

      <div className="scroll flex-1 px-2 pb-3 pt-2" style={{ scrollbarGutter: 'auto' }}>
        <NavButton active={active === null} onClick={() => (useChannels.getState().select(null), showMain())}>
          <Users size={16} className="relative shrink-0 text-fg-2" />
          <span className="relative flex-1 text-left">Friends</span>
          {incoming > 0 && <Badge>{incoming}</Badge>}
        </NavButton>
        <NavButton active={false} onClick={() => !starting && void startMeeting()}>
          {starting ? <Spinner size={16} className="relative shrink-0 text-accent" /> : <Video size={16} className="relative shrink-0 text-accent" />}
          <span className="relative flex-1 text-left">New meeting</span>
        </NavButton>
        <NavButton active={false} onClick={() => useMeetings.getState().set({ joining: '' })}>
          <Link2 size={16} className="relative shrink-0 text-fg-2" />
          <span className="relative flex-1 text-left">Join a meeting</span>
        </NavButton>
        {/* In a browser: the desktop app is a tap away (opens in a new tab, so a call keeps going). */}
        {!isTauri && (
          <NavButton active={false} onClick={() => window.open(DOWNLOAD_PAGE, '_blank', 'noopener')}>
            <Download size={16} className="relative shrink-0 text-fg-2" />
            <span className="relative flex-1 text-left">Download the app</span>
          </NavButton>
        )}

        {meetings.length > 0 && (
          <>
            <div className="mt-4 flex h-7 items-center px-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-fg-3">Meetings</div>
            {meetings.map((m) => (
              <MeetingRow key={m.id} meeting={m} active={active === m.id} />
            ))}
          </>
        )}

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

function NavButton({ active, onClick, onContextMenu, children }: { active: boolean; onClick: () => void; onContextMenu?: (e: React.MouseEvent) => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={clsx('relative flex h-[38px] w-full items-center gap-2.5 rounded-[9px] px-2.5 text-[13.5px] transition-colors compact:h-12 compact:text-[15px]', active ? 'text-fg' : 'text-fg-2 hover:bg-fill-1 hover:text-fg')}
    >
      {active && <motion.span layoutId="home-selection" transition={spring} className="absolute inset-0 rounded-[9px] bg-fill-3 shadow-[inset_0_0.5px_0_var(--highlight)]" />}
      {children}
    </button>
  );
}

const Badge = ({ children, quiet }: { children: ReactNode; quiet?: boolean }) => (
  <span className={clsx('relative grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[10.5px] font-bold', quiet ? 'bg-fill-3 text-fg-2' : 'bg-danger text-white')}>
    {children}
  </span>
);

function MeetingRow({ meeting, active }: { meeting: Channel; active: boolean }) {
  const callRoom = meeting.rooms.find((r) => r.kind === 'voice');
  const inCall = useChannels((s) => s.voice[meeting.id]?.participants.filter((p) => p.roomId === callRoom?.id).length ?? 0);
  const waiting = useMeetings((s) => (meeting.role !== 'member' ? (s.waiting[meeting.id]?.length ?? 0) : 0));

  return (
    <NavButton active={active} onClick={() => (useChannels.getState().select(meeting.id), showMain())}>
      <span className="relative grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[10px] text-white" style={{ background: channelGradient(meeting.color) }}>
        <Video size={15} strokeWidth={2} />
      </span>
      <span className="relative min-w-0 flex-1 text-left">
        <span className="block truncate text-[13px] leading-tight">{meeting.name}</span>
        {inCall > 0 ? (
          <span className="flex items-center gap-1 text-[11px] leading-tight text-success">
            <AudioLines size={11} /> {inCall} in the call
          </span>
        ) : (
          <span className="block truncate text-[11px] leading-tight text-fg-3">{meeting.expiresAt ? `Ends in ${timeLeft(meeting.expiresAt)}` : meeting.inviteCode}</span>
        )}
      </span>
      {waiting > 0 && <Badge>{waiting}</Badge>}
    </NavButton>
  );
}

function DmRow({ dm, active }: { dm: Channel; active: boolean }) {
  const peer = dm.peer;
  const online = useFriends((s) => (peer ? !!s.online[peer.id] : false));
  const textRoom = dm.rooms.find((r) => r.kind === 'text');
  const callRoom = dm.rooms.find((r) => r.kind === 'voice');
  const unread = useMessages((s) => (textRoom ? (s.unread[textRoom.id] ?? 0) : 0));
  const inCall = useChannels((s) => !!s.voice[dm.id]?.participants.some((p) => p.roomId === callRoom?.id));
  const pinned = useSettings((s) => s.pinnedDms.includes(dm.id));
  const muted = useSettings((s) => !!s.mutedChats[dm.id]);

  return (
    <NavButton active={active} onClick={() => (useChannels.getState().select(dm.id), showMain())} onContextMenu={(e) => openUserMenu(e, peer?.id, { kind: 'dm', channelId: dm.id })}>
      <Avatar user={peer} size={30} presence={online ? 'online' : 'offline'} className="relative" />
      <span className="relative min-w-0 flex-1 text-left">
        <span className={clsx('flex items-center gap-1 text-[13px] leading-tight', unread > 0 && !active && !muted && 'font-semibold text-fg')}>
          <span className="truncate">{peer?.name ?? 'Direct message'}</span>
          {pinned && <Pin size={10} className="shrink-0 rotate-45 text-fg-3" />}
          {muted && <BellOff size={10} className="shrink-0 text-fg-3" />}
        </span>
        {inCall ? (
          <span className="flex items-center gap-1 text-[11px] leading-tight text-success">
            <AudioLines size={11} /> In a call
          </span>
        ) : (
          <span className="block truncate text-[11px] leading-tight text-fg-3">@{peer?.username}</span>
        )}
      </span>
      {unread > 0 && !active && <Badge quiet={muted}>{unread}</Badge>}
    </NavButton>
  );
}
