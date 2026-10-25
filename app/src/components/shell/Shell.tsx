import { motion } from 'motion/react';
import { Plus, Ticket } from 'lucide-react';
import { ChatView } from '../chat/ChatView';
import { Spinner } from '../ui/primitives';
import { VoiceRoomView } from '../voice/VoiceRoomView';
import { ChannelRail } from './ChannelRail';
import { Sidebar } from './Sidebar';
import { softSpring } from '@/lib/motion';
import { useAuth } from '@/stores/auth';
import { useActiveChannel, useActiveRoom, useChannels } from '@/stores/channels';
import { useUI } from '@/stores/ui';

export function Shell() {
  const immersive = useUI((s) => s.immersive);
  const loaded = useChannels((s) => s.loaded);
  const channel = useActiveChannel();
  const room = useActiveRoom();

  return (
    <div className="relative flex h-full">
      {!immersive && <ChannelRail />}
      {!immersive && channel && <Sidebar key={channel.id} channel={channel} />}
      <main className="glass-main relative flex min-w-0 flex-1 flex-col">
        {!loaded ? (
          <div className="grid h-full place-items-center text-fg-3">
            <Spinner size={22} />
          </div>
        ) : channel && room ? (
          room.kind === 'text' ? (
            <ChatView key={room.id} channel={channel} room={room} />
          ) : (
            <VoiceRoomView key={room.id} channel={channel} room={room} />
          )
        ) : (
          <Welcome />
        )}
      </main>
    </div>
  );
}

function Welcome() {
  const me = useAuth((s) => s.me);
  const open = (mode: 'create' | 'join') => useUI.getState().set({ createChannel: mode });
  return (
    <div className="relative grid h-full place-items-center">
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-[52px]" />
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={softSpring} className="flex max-w-[460px] flex-col items-center text-center">
        <div className="emoji text-[56px]">👋</div>
        <h1 className="mt-3 font-display text-[30px] font-bold tracking-[-0.035em]">Hey {me?.name.split(' ')[0]}, welcome in</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-fg-2">
          Channels are your hangout spaces. Each one has chat rooms and voice rooms. Talk, share your screen or watch a movie together, as long as you like.
        </p>
        <div className="mt-8 grid w-full grid-cols-2 gap-3">
          <WelcomeCard icon={<Plus size={22} />} title="Create a channel" body="Start a space for your friends" onClick={() => open('create')} />
          <WelcomeCard icon={<Ticket size={22} />} title="Join with a code" body="Got an invite? Hop in" onClick={() => open('join')} />
        </div>
      </motion.div>
    </div>
  );
}

function WelcomeCard({ icon, title, body, onClick }: { icon: React.ReactNode; title: string; body: string; onClick: () => void }) {
  return (
    <motion.button whileHover={{ y: -3 }} whileTap={{ scale: 0.98 }} onClick={onClick} className="rounded-[20px] p-5 text-left glass-tile transition-colors hover:bg-fill-2">
      <div className="grid h-11 w-11 place-items-center rounded-[14px] bg-accent text-white shadow-[inset_0_0.5px_0_rgba(255,255,255,0.35)]">{icon}</div>
      <div className="mt-3.5 text-[14px] font-semibold">{title}</div>
      <div className="mt-0.5 text-[12.5px] text-fg-2">{body}</div>
    </motion.button>
  );
}
