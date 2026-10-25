import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import {
  AudioLines,
  ChevronDown,
  Hash,
  Headphones,
  HeadphoneOff,
  LogOut,
  Mic,
  MicOff,
  PhoneOff,
  Plus,
  ScreenShare,
  ScreenShareOff,
  Settings,
  ShieldAlert,
  UserPlus,
  Video,
  VideoOff,
  Volume2,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { Channel, Room, VoiceParticipant } from '../../../../shared/protocol';
import { Avatar } from '../ui/Avatar';
import { MenuItem, MenuSeparator, Popover, type Anchor } from '../ui/overlay';
import { IconButton } from '../ui/primitives';
import { api } from '@/lib/api';
import { spring } from '@/lib/motion';
import { voice } from '@/lib/voice/engine';
import { useAuth } from '@/stores/auth';
import { useActiveRoom, useChannels } from '@/stores/channels';
import { useMessages } from '@/stores/messages';
import { toast, useUI } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

export function Sidebar({ channel }: { channel: Channel }) {
  const [menu, setMenu] = useState<Anchor | null>(null);
  const [adding, setAdding] = useState<Room['kind'] | null>(null);
  const isAdmin = channel.role !== 'member';
  const text = channel.rooms.filter((r) => r.kind === 'text');
  const voiceRooms = channel.rooms.filter((r) => r.kind === 'voice');
  const ui = useUI((s) => s.set);

  const copyInvite = () => {
    setMenu(null);
    ui({ inviteTo: channel.id });
  };

  const leave = async () => {
    setMenu(null);
    if (!confirm(`Leave ${channel.name}?`)) return;
    await api(`/channels/${channel.id}/leave`, { method: 'POST' });
    if (useVoice.getState().channelId === channel.id) voice.leave();
    useChannels.getState().removeLocal(channel.id);
  };

  return (
    <aside className="glass-side hairline-r relative z-[5] flex w-[252px] shrink-0 flex-col">
      <header data-tauri-drag-region className="hairline-b flex h-[52px] shrink-0 items-center px-2.5">
        <button
          onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-[9px] px-2 py-1.5 text-left transition-colors hover:bg-fill-2"
        >
          <span className="emoji text-[17px] leading-none">{channel.emoji}</span>
          <span className="truncate font-display text-[14.5px] font-semibold tracking-[-0.015em]">{channel.name}</span>
          <ChevronDown size={14} className="ml-auto shrink-0 text-fg-3" />
        </button>
      </header>

      <Popover open={!!menu} anchor={menu} onClose={() => setMenu(null)} className="w-[230px] p-1.5">
        <MenuItem icon={<UserPlus size={15} />} onClick={copyInvite}>
          Invite friends
        </MenuItem>
        {isAdmin && (
          <>
            <MenuItem icon={<Settings size={15} />} onClick={() => (setMenu(null), ui({ channelSettings: channel.id }))}>
              Channel settings
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Hash size={15} />} onClick={() => (setMenu(null), setAdding('text'))}>
              New chat room
            </MenuItem>
            <MenuItem icon={<Volume2 size={15} />} onClick={() => (setMenu(null), setAdding('voice'))}>
              New voice room
            </MenuItem>
          </>
        )}
        {channel.role !== 'owner' && (
          <>
            <MenuSeparator />
            <MenuItem danger icon={<LogOut size={15} />} onClick={leave}>
              Leave channel
            </MenuItem>
          </>
        )}
      </Popover>

      <div className="scroll flex-1 px-2 pb-3 pt-2" style={{ scrollbarGutter: 'auto' }}>
        <Section title="Chat rooms" onAdd={isAdmin ? () => setAdding('text') : undefined}>
          {text.map((r) => (
            <TextRoomRow key={r.id} channel={channel} room={r} />
          ))}
          {adding === 'text' && <AddRoom channelId={channel.id} kind="text" onDone={() => setAdding(null)} />}
        </Section>
        <Section title="Voice rooms" onAdd={isAdmin ? () => setAdding('voice') : undefined}>
          {voiceRooms.map((r) => (
            <VoiceRoomRow key={r.id} channel={channel} room={r} />
          ))}
          {adding === 'voice' && <AddRoom channelId={channel.id} kind="voice" onDone={() => setAdding(null)} />}
        </Section>
      </div>

      <VoicePanel />
      <UserBar />
    </aside>
  );
}

function Section({ title, onAdd, children }: { title: string; onAdd?: () => void; children: ReactNode }) {
  return (
    <div className="mb-3">
      <div className="group flex h-7 items-center px-2">
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-fg-3">{title}</span>
        {onAdd && (
          <button aria-label={`Add ${title}`} onClick={onAdd} className="grid h-5 w-5 place-items-center rounded-md text-fg-3 opacity-0 transition hover:bg-fill-2 hover:text-fg group-hover:opacity-100">
            <Plus size={14} />
          </button>
        )}
      </div>
      <div className="flex flex-col gap-px">{children}</div>
    </div>
  );
}

function AddRoom({ channelId, kind, onDone }: { channelId: string; kind: Room['kind']; onDone: () => void }) {
  const [name, setName] = useState('');
  const submit = async () => {
    if (!name.trim()) return onDone();
    try {
      const room = await useChannels.getState().addRoom(channelId, kind, name);
      if (kind === 'text') useChannels.getState().selectRoom(channelId, room.id);
    } catch {
      toast({ kind: 'error', title: "Couldn't create the room" });
    }
    onDone();
  };
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 32 }} transition={spring} className="field mx-0.5 mt-1 flex items-center gap-2 px-2">
      {kind === 'text' ? <Hash size={15} className="text-fg-3" /> : <Volume2 size={15} className="text-fg-3" />}
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={submit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
          if (e.key === 'Escape') onDone();
        }}
        placeholder={kind === 'text' ? 'new-room' : 'New voice room'}
        className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-3"
      />
    </motion.div>
  );
}

function RoomButton({ active, onClick, children, onContextMenu }: { active: boolean; onClick: () => void; children: ReactNode; onContextMenu?: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={clsx('relative flex h-[31px] w-full items-center gap-2 rounded-[8px] px-2 text-[13px] transition-colors', active ? 'text-fg' : 'text-fg-2 hover:bg-fill-1 hover:text-fg')}
    >
      {active && <motion.span layoutId="room-selection" transition={spring} className="absolute inset-0 rounded-[8px] bg-fill-3 shadow-[inset_0_0.5px_0_var(--highlight)]" />}
      {children}
    </button>
  );
}

function TextRoomRow({ channel, room }: { channel: Channel; room: Room }) {
  const active = useActiveRoom()?.id === room.id;
  const unread = useMessages((s) => s.unread[room.id] ?? 0);
  return (
    <RoomButton active={active} onClick={() => useChannels.getState().selectRoom(channel.id, room.id)}>
      <Hash size={15} className="relative shrink-0 text-fg-3" />
      <span className={clsx('relative flex-1 truncate text-left', unread > 0 && !active && 'font-semibold text-fg')}>{room.name}</span>
      {unread > 0 && !active && (
        <span className="relative grid h-[17px] min-w-[17px] place-items-center rounded-full bg-accent px-1 text-[10.5px] font-bold text-white">{unread}</span>
      )}
    </RoomButton>
  );
}

function VoiceRoomRow({ channel, room }: { channel: Channel; room: Room }) {
  const active = useActiveRoom()?.id === room.id;
  const snapshot = useChannels((s) => s.voice[channel.id]);
  const users = useChannels((s) => s.users);
  const myRoom = useVoice((s) => s.roomId);
  const speaking = useVoice((s) => s.speaking);
  const me = useAuth((s) => s.me);
  const participants = (snapshot?.participants ?? []).filter((p) => p.roomId === room.id).sort((a, b) => a.joinedAt - b.joinedAt);
  const roomMuted = snapshot?.mutedRooms.includes(room.id);
  const connected = myRoom === room.id;

  const open = () => {
    useChannels.getState().selectRoom(channel.id, room.id);
    if (!connected) void voice.join(channel.id, room.id);
  };

  return (
    <div>
      <RoomButton active={active} onClick={open}>
        {connected ? <AudioLines size={15} className="relative shrink-0 text-success" /> : <Volume2 size={15} className="relative shrink-0 text-fg-3" />}
        <span className="relative flex-1 truncate text-left">{room.name}</span>
        {roomMuted && <MicOff size={12} className="relative text-danger" />}
        {participants.length > 0 && <span className="relative text-[11px] tabular-nums text-fg-3">{participants.length}</span>}
      </RoomButton>
      <AnimatePresence initial={false}>
        {participants.map((p) => (
          <motion.div
            key={p.peerId}
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 28 }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring}
            onContextMenu={(e) => {
              e.preventDefault();
              if (p.userId !== me?.id)
                useUI.getState().set({ participantMenu: { channelId: channel.id, peerId: p.peerId, userId: p.userId, x: e.clientX, y: e.clientY } });
            }}
            className="ml-6 flex items-center gap-2 overflow-hidden rounded-[7px] px-1.5 hover:bg-fill-1"
          >
            <Avatar user={users[p.userId]} size={20} speaking={p.peerId === voice.peerId ? speaking.self : speaking[p.peerId]} />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-2">{users[p.userId]?.name ?? 'Someone'}</span>
            <ParticipantIcons p={p} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function ParticipantIcons({ p, size = 13 }: { p: VoiceParticipant; size?: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1 text-fg-3">
      {p.screen && <span className="rounded-[4px] bg-danger px-1 text-[9px] font-bold leading-[14px] text-white">LIVE</span>}
      {p.camera && <Video size={size} />}
      {p.serverMuted ? <ShieldAlert size={size} className="text-danger" /> : p.muted && <MicOff size={size} className="text-danger" />}
      {p.deafened && <HeadphoneOff size={size} className="text-danger" />}
    </span>
  );
}

export function VoicePanel() {
  const status = useVoice((s) => s.status);
  const channelId = useVoice((s) => s.channelId);
  const roomId = useVoice((s) => s.roomId);
  const camera = useVoice((s) => s.camera);
  const screen = useVoice((s) => s.screen);
  const connection = useVoice((s) => s.connection);
  const channel = useChannels((s) => s.channels.find((c) => c.id === channelId));
  const room = channel?.rooms.find((r) => r.id === roomId);

  const states = Object.values(connection);
  const trouble = states.some((s) => s === 'failed' || s === 'disconnected');
  const connecting = status === 'connecting' || states.some((s) => s === 'new' || s === 'connecting');

  return (
    <AnimatePresence>
      {status !== 'idle' && channel && room && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring} className="hairline-t overflow-hidden">
          <div className="px-3 pb-2.5 pt-2.5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-4 items-end gap-[2px]">
                {[0.45, 0.7, 1].map((h, i) => (
                  <span
                    key={i}
                    className="w-[3px] rounded-full"
                    style={{ height: `${h * 100}%`, background: trouble ? 'var(--danger)' : connecting ? 'var(--warning)' : 'var(--success)' }}
                  />
                ))}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold" style={{ color: trouble ? 'var(--danger)' : connecting ? 'var(--warning)' : 'var(--success)' }}>
                  {trouble ? 'Connection trouble' : connecting ? 'Connecting…' : 'Voice connected'}
                </div>
                <button onClick={() => useChannels.getState().selectRoom(channel.id, room.id)} className="block max-w-full truncate text-[11.5px] text-fg-2 hover:text-fg hover:underline">
                  {channel.kind === 'dm' ? `Call with ${channel.peer?.name ?? 'friend'}` : `${room.name} · ${channel.name}`}
                </button>
              </div>
              <IconButton label="Disconnect" tone="danger" onClick={() => voice.leave()}>
                <PhoneOff size={15} />
              </IconButton>
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-1.5">
              <PanelButton active={camera} onClick={() => void voice.toggleCamera()} icon={camera ? <VideoOff size={15} /> : <Video size={15} />}>
                {camera ? 'Stop video' : 'Video'}
              </PanelButton>
              <PanelButton active={screen} onClick={() => (screen ? voice.stopScreen() : void voice.startScreen())} icon={screen ? <ScreenShareOff size={15} /> : <ScreenShare size={15} />}>
                {screen ? 'Stop share' : 'Share'}
              </PanelButton>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PanelButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      className={clsx(
        'flex h-8 items-center justify-center gap-1.5 rounded-[9px] text-[12px] font-medium transition-colors',
        active ? 'bg-accent text-white' : 'bg-fill-2 text-fg hover:bg-fill-3',
      )}
    >
      {icon}
      {children}
    </motion.button>
  );
}

export function UserBar() {
  const me = useAuth((s) => s.me);
  const muted = useVoice((s) => s.muted);
  const deafened = useVoice((s) => s.deafened);
  const speaking = useVoice((s) => !!s.speaking.self);
  const ui = useUI((s) => s.set);
  if (!me) return null;
  return (
    <div className="hairline-t flex h-[58px] shrink-0 items-center gap-1 px-2">
      <button onClick={() => ui({ settingsTab: 'account' })} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] p-1.5 text-left transition-colors hover:bg-fill-2">
        <Avatar user={me} size={32} speaking={speaking} presence="online" />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold leading-tight">{me.name}</span>
          <span className="block truncate text-[11.5px] leading-tight text-fg-3">@{me.username}</span>
        </span>
      </button>
      <IconButton label={muted || deafened ? 'Unmute' : 'Mute'} tone={muted || deafened ? 'danger' : undefined} onClick={() => void voice.toggleMute()}>
        {muted || deafened ? <MicOff size={16} /> : <Mic size={16} />}
      </IconButton>
      <IconButton label={deafened ? 'Undeafen' : 'Deafen'} tone={deafened ? 'danger' : undefined} onClick={() => voice.toggleDeafen()}>
        {deafened ? <HeadphoneOff size={16} /> : <Headphones size={16} />}
      </IconButton>
    </div>
  );
}
