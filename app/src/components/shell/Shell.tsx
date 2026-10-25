import { ChatView } from '../chat/ChatView';
import { DmView } from '../home/DmView';
import { FriendsPage } from '../home/FriendsPage';
import { HomeSidebar } from '../home/HomeSidebar';
import { Spinner } from '../ui/primitives';
import { VoiceRoomView } from '../voice/VoiceRoomView';
import { ChannelRail } from './ChannelRail';
import { Sidebar } from './Sidebar';
import { useActiveChannel, useActiveRoom, useChannels } from '@/stores/channels';
import { useUI } from '@/stores/ui';

export function Shell() {
  const immersive = useUI((s) => s.immersive);
  const loaded = useChannels((s) => s.loaded);
  const channel = useActiveChannel();
  const room = useActiveRoom();
  const space = channel?.kind === 'space' ? channel : null;

  return (
    <div className="relative flex h-full">
      {!immersive && <ChannelRail />}
      {!immersive && (space ? <Sidebar key={space.id} channel={space} /> : <HomeSidebar />)}
      <main className="glass-main relative flex min-w-0 flex-1 flex-col">
        {!loaded ? (
          <div className="grid h-full place-items-center text-fg-3">
            <Spinner size={22} />
          </div>
        ) : channel?.kind === 'dm' ? (
          <DmView key={channel.id} channel={channel} />
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
