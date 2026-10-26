import { motion } from 'motion/react';
import { Phone, Video } from 'lucide-react';
import type { Channel } from '../../../../shared/protocol';
import { ChatView } from '../chat/ChatView';
import { MobileBack } from '../shell/MobileBack';
import { Avatar } from '../ui/Avatar';
import { IconButton } from '../ui/primitives';
import { VoiceRoomView } from '../voice/VoiceRoomView';
import { voice } from '@/lib/voice/engine';
import { useChannels } from '@/stores/channels';
import { useFriends } from '@/stores/friends';
import { useVoice } from '@/stores/voice';

/** A direct message: chat with one friend; the call room turns it into a 1-on-1 call. */
export function DmView({ channel }: { channel: Channel }) {
  const textRoom = channel.rooms.find((r) => r.kind === 'text');
  const callRoom = channel.rooms.find((r) => r.kind === 'voice');
  const inCall = useVoice((s) => !!callRoom && s.roomId === callRoom.id);
  const peer = channel.peer;
  const online = useFriends((s) => (peer ? !!s.online[peer.id] : false));
  const peerInCall = useChannels((s) => !!s.voice[channel.id]?.participants.some((p) => p.roomId === callRoom?.id && p.userId === peer?.id));

  if (!textRoom || !callRoom) return null;
  if (inCall) return <VoiceRoomView channel={channel} room={callRoom} chatRoom={textRoom} />;

  const call = async (video: boolean) => {
    await voice.join(channel.id, callRoom.id);
    if (video) await voice.toggleCamera();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header data-tauri-drag-region className="hairline-b flex h-[52px] shrink-0 items-center gap-2.5 px-5 compact:gap-2 compact:px-3">
        <MobileBack />
        <Avatar user={peer} size={28} presence={online ? 'online' : 'offline'} className="shrink-0" />
        <div data-tauri-drag-region className="min-w-0">
          <div className="truncate font-display text-[15px] font-semibold leading-tight tracking-[-0.015em]">{peer?.name ?? 'Direct message'}</div>
          <div className="truncate text-[11.5px] leading-tight text-fg-3">{online ? 'Online' : `@${peer?.username}`}</div>
        </div>
        <div data-tauri-drag-region className="flex-1 self-stretch" />
        {peerInCall ? (
          <motion.button
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => void call(false)}
            className="flex h-8 items-center gap-1.5 rounded-full bg-success px-3.5 text-[12.5px] font-semibold text-white shadow-[0_0_0_4px_color-mix(in_srgb,var(--success)_25%,transparent)]"
          >
            <Phone size={14} /> Join call
          </motion.button>
        ) : (
          <>
            <IconButton label="Start voice call" tooltipSide="bottom" onClick={() => void call(false)}>
              <Phone size={17} />
            </IconButton>
            <IconButton label="Start video call" tooltipSide="bottom" onClick={() => void call(true)}>
              <Video size={18} />
            </IconButton>
          </>
        )}
      </header>
      <div className="min-h-0 flex-1">
        <ChatView channel={channel} room={textRoom} compact dmPeer={peer} />
      </div>
    </div>
  );
}
