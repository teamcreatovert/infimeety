import clsx from 'clsx';
import { useEffect } from 'react';
import { ChatView } from '../chat/ChatView';
import { DmView } from '../home/DmView';
import { FriendsPage } from '../home/FriendsPage';
import { HomeSidebar } from '../home/HomeSidebar';
import { MeetingView } from '../meeting/MeetingView';
import { Spinner } from '../ui/primitives';
import { VoiceRoomView } from '../voice/VoiceRoomView';
import { ChannelRail } from './ChannelRail';
import { Sidebar } from './Sidebar';
import { useCompact } from '@/lib/responsive';
import { useActiveChannel, useActiveRoom, useChannels } from '@/stores/channels';
import { showMain, useUI } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

export function Shell() {
  const immersive = useUI((s) => s.immersive);
  const mobileNav = useUI((s) => s.mobileNav);
  const compact = useCompact();
  const loaded = useChannels((s) => s.loaded);
  const channel = useActiveChannel();
  const room = useActiveRoom();
  const space = channel?.kind === 'space' ? channel : null;
  // Phones show the channel list or what's open, never both. Both stay mounted so scroll and drafts survive.
  const navHidden = immersive || (compact && !mobileNav);
  const mainHidden = compact && mobileNav && !immersive;

  // Phones: opening a conversation or joining a call from anywhere (Friends, a link, a ringing call) shows it.
  useEffect(() => {
    const offChannels = useChannels.subscribe((s, prev) => {
      if (s.activeChannelId === prev.activeChannelId) return;
      const opened = s.channels.find((c) => c.id === s.activeChannelId);
      if (opened && opened.kind !== 'space') showMain();
    });
    const offVoice = useVoice.subscribe((s, prev) => {
      if (s.roomId && s.roomId !== prev.roomId) showMain();
    });
    return () => {
      offChannels();
      offVoice();
    };
  }, []);

  return (
    <div className="relative flex h-full">
      <div className={clsx('flex min-w-0 shrink-0 compact:flex-1', navHidden && 'hidden')}>
        <ChannelRail />
        {space ? <Sidebar key={space.id} channel={space} /> : <HomeSidebar />}
      </div>
      <main className={clsx('glass-main relative flex min-w-0 flex-1 flex-col', mainHidden && 'hidden')}>
        {!loaded ? (
          <div className="grid h-full place-items-center text-fg-3">
            <Spinner size={22} />
          </div>
        ) : channel?.kind === 'dm' ? (
          <DmView key={channel.id} channel={channel} />
        ) : channel?.kind === 'meeting' ? (
          <MeetingView key={channel.id} channel={channel} />
        ) : space && room ? (
          room.kind === 'text' ? (
            <ChatView key={room.id} channel={space} room={room} />
          ) : (
            <VoiceRoomView key={room.id} channel={space} room={room} />
          )
        ) : (
          <FriendsPage />
        )}
      </main>
    </div>
  );
}
