import clsx from 'clsx';
import { animate, AnimatePresence, LayoutGroup, motion, useMotionValue } from 'motion/react';
import {
  AudioLines,
  ChevronUp,
  Clapperboard,
  Ellipsis,
  Expand,
  HeadphoneOff,
  Headphones,
  MessageSquareText,
  Mic,
  MicOff,
  Minimize2,
  MonitorPlay,
  Phone,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
  Shrink,
  Users,
  Video,
  VideoOff,
  Volume2,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Channel, PublicUser, Room, VoiceParticipant } from '../../../../shared/protocol';
import { ChatView } from '../chat/ChatView';
import { ParticipantIcons } from '../shell/Sidebar';
import { Avatar } from '../ui/Avatar';
import { Popover, Tooltip, type Anchor } from '../ui/overlay';
import { Button, Segmented, Slider, Spinner, Switch } from '../ui/primitives';
import { StreamVideo } from './StreamVideo';
import { channelGradient, gradientFor } from '@/lib/format';
import { spring, snappy } from '@/lib/motion';
import { appWindow } from '@/lib/platform';
import { getHub } from '@/lib/realtime';
import { voice } from '@/lib/voice/engine';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { SCREEN_PRESETS, useSettings, type ScreenQuality } from '@/stores/settings';
import { useUI } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

type Tile = { key: string; kind: 'user' | 'screen'; p: VoiceParticipant };

const EMPTY: VoiceParticipant[] = [];

function useRoomParticipants(channelId: string, roomId: string) {
  const all = useChannels((s) => s.voice[channelId]?.participants ?? EMPTY);
  return useMemo(() => all.filter((p) => p.roomId === roomId).sort((a, b) => a.joinedAt - b.joinedAt), [all, roomId]);
}

function openMenu(e: React.MouseEvent, channelId: string, p: VoiceParticipant) {
  e.preventDefault();
  if (p.peerId === voice.peerId) return;
  useUI.getState().set({ participantMenu: { channelId, peerId: p.peerId, userId: p.userId, x: e.clientX, y: e.clientY } });
}

async function setImmersive(on: boolean) {
  useUI.getState().set({ immersive: on });
  await appWindow.setFullscreen(on);
}

export function VoiceRoomView({ channel, room }: { channel: Channel; room: Room }) {
  const here = useVoice((s) => s.roomId === room.id);
  return here ? <Stage channel={channel} room={room} /> : <Lobby channel={channel} room={room} />;
}

// ─── Lobby ───────────────────────────────────────────────────────────────────

function Lobby({ channel, room }: { channel: Channel; room: Room }) {
  const participants = useRoomParticipants(channel.id, room.id);
  const users = useChannels((s) => s.users);
  const voiceChat = useUI((s) => s.voiceChat);
  const names = participants.map((p) => users[p.userId]?.name ?? 'Someone');
  const who =
    names.length === 0
      ? 'Nobody’s here yet. Start the hangout.'
      : names.length <= 2
        ? `${names.join(' and ')} ${names.length === 1 ? 'is' : 'are'} hanging out`
        : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more are hanging out`;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header data-tauri-drag-region className="hairline-b flex h-[52px] shrink-0 items-center gap-2 px-5">
          <Volume2 size={18} className="text-fg-3" />
          <h1 data-tauri-drag-region className="font-display text-[15px] font-semibold tracking-[-0.015em]">
            {room.name}
          </h1>
          <div data-tauri-drag-region className="flex-1 self-stretch" />
          <ChatToggle />
        </header>
        <div className="grid flex-1 place-items-center p-8">
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="flex max-w-[420px] flex-col items-center text-center">
            <motion.div
              className="grid h-24 w-24 place-items-center rounded-[30px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_20px_50px_rgba(0,0,0,0.35)]"
              style={{ background: channelGradient(channel.color) }}
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Volume2 size={40} strokeWidth={1.8} />
            </motion.div>
            <h2 className="mt-6 font-display text-[28px] font-bold tracking-[-0.03em]">{room.name}</h2>
            <p className="mt-1.5 text-[14px] text-fg-2">{who}</p>
            {participants.length > 0 && (
              <div className="mt-4 flex -space-x-2">
                {participants.slice(0, 6).map((p) => (
                  <div key={p.peerId} className="rounded-full shadow-[0_0_0_2.5px_var(--ring-bg)]">
                    <Avatar user={users[p.userId]} size={34} />
                  </div>
                ))}
              </div>
            )}
            <Button variant="primary" size="lg" className="mt-7 min-w-[180px]" icon={<Phone size={17} />} onClick={() => void voice.join(channel.id, room.id)}>
              Join voice
            </Button>
            <p className="mt-3 text-[11.5px] text-fg-3">No time limits. Stay as long as you like.</p>
          </motion.div>
        </div>
      </div>
      <VoiceChatPanel open={voiceChat} channel={channel} room={room} />
    </div>
  );
}

function ChatToggle() {
  const open = useUI((s) => s.voiceChat);
  return (
    <Tooltip label={open ? 'Hide chat' : 'Show chat'} side="bottom">
      <button
        onClick={() => useUI.getState().set({ voiceChat: !open })}
        className={clsx('grid h-[30px] w-[30px] place-items-center rounded-[9px] transition-colors', open ? 'bg-fill-3 text-fg' : 'text-fg-2 hover:bg-fill-2 hover:text-fg')}
      >
        <MessageSquareText size={17} />
      </button>
    </Tooltip>
  );
}

function VoiceChatPanel({ open, channel, room, overlay }: { open: boolean; channel: Channel; room: Room; overlay?: boolean }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 360, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 40 }}
          className={clsx('shrink-0 overflow-hidden', overlay ? 'glass-side hairline-l' : 'hairline-l')}
        >
          <div className="flex h-full w-[360px] flex-col">
            <div data-tauri-drag-region className="hairline-b flex h-[52px] shrink-0 items-center px-4">
              <span data-tauri-drag-region className="flex-1 text-[13.5px] font-semibold">
                Chat
              </span>
              <button aria-label="Close chat" onClick={() => useUI.getState().set({ voiceChat: false })} className="grid h-7 w-7 place-items-center rounded-full text-fg-2 hover:bg-fill-2 hover:text-fg">
                <X size={15} />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <ChatView channel={channel} room={room} compact />
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

// ─── Stage ───────────────────────────────────────────────────────────────────

function Stage({ channel, room }: { channel: Channel; room: Room }) {
  const participants = useRoomParticipants(channel.id, room.id);
  const users = useChannels((s) => s.users);
  const remote = useVoice((s) => s.remote);
  const localCam = useVoice((s) => s.localCam);
  const localScreen = useVoice((s) => s.localScreen);
  const speaking = useVoice((s) => s.speaking);
  const status = useVoice((s) => s.status);
  const focusedPeer = useUI((s) => s.focusedPeer);
  const voiceChat = useUI((s) => s.voiceChat);
  const immersive = useUI((s) => s.immersive);
  const myPeer = voice.peerId;

  const camOf = (p: VoiceParticipant) => (p.peerId === myPeer ? localCam : remote[p.peerId]?.cam) ?? undefined;
  const screenOf = (p: VoiceParticipant) => (p.peerId === myPeer ? localScreen : remote[p.peerId]?.screen) ?? undefined;
  const speakingOf = (p: VoiceParticipant) => !!(p.peerId === myPeer ? speaking.self : speaking[p.peerId]);

  const tiles: Tile[] = [
    ...participants.filter((p) => p.screen).map((p) => ({ key: `${p.peerId}:screen`, kind: 'screen' as const, p })),
    ...participants.map((p) => ({ key: p.peerId, kind: 'user' as const, p })),
  ];
  const focused = focusedPeer ? participants.find((p) => p.peerId === focusedPeer && p.screen) : undefined;

  // When a friend is sharing (e.g. a movie) — or starts to — jump straight into watch mode.
  const sharers = participants.filter((p) => p.screen && p.peerId !== myPeer).map((p) => p.peerId);
  const prevSharers = useRef<string[]>([]);
  useEffect(() => {
    const fresh = sharers.find((id) => !prevSharers.current.includes(id));
    if (fresh && !useUI.getState().focusedPeer) useUI.getState().set({ focusedPeer: fresh });
    prevSharers.current = sharers;
  }, [sharers.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drop watch mode only when the focused sharer actually stopped (not on a stale render).
  useEffect(() => {
    const fp = useUI.getState().focusedPeer;
    const stillSharing = !!fp && participants.some((p) => p.peerId === fp && p.screen);
    if (fp && !stillSharing) useUI.getState().set({ focusedPeer: null });
    if (!stillSharing && immersive) void setImmersive(false);
  }, [participants, immersive]);

  // Cinema behaviour: controls fade out after a moment of stillness.
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wake = () => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    if (focused) idleTimer.current = setTimeout(() => setIdle(true), 2600);
  };
  useEffect(() => {
    wake();
    return () => clearTimeout(idleTimer.current);
  }, [focused?.peerId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && useUI.getState().immersive) void setImmersive(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const hideChrome = !!focused && idle;

  return (
    <div className="relative flex h-full min-h-0" onMouseMove={wake}>
      <div className={clsx('relative flex min-w-0 flex-1 flex-col', focused && 'bg-[var(--stage)]')} style={{ cursor: hideChrome ? 'none' : undefined }}>
        {focused ? (
          <TheaterHeader channel={channel} sharer={focused} user={users[focused.userId]} hidden={hideChrome} isMe={focused.peerId === myPeer} />
        ) : (
          <header data-tauri-drag-region className="hairline-b flex h-[52px] shrink-0 items-center gap-2 px-5">
            <AudioLines size={18} className="text-success" />
            <h1 data-tauri-drag-region className="font-display text-[15px] font-semibold tracking-[-0.015em]">
              {room.name}
            </h1>
            <span data-tauri-drag-region className="text-[12px] text-fg-3">
              {participants.length} {participants.length === 1 ? 'person' : 'people'}
            </span>
            <div data-tauri-drag-region className="flex-1 self-stretch" />
            <ChatToggle />
          </header>
        )}

        <div className="relative min-h-0 flex-1">
          {status === 'connecting' && participants.length === 0 ? (
            <div className="grid h-full place-items-center text-fg-2">
              <div className="flex flex-col items-center gap-3">
                <Spinner size={22} />
                <span className="text-[13px]">Joining {room.name}…</span>
              </div>
            </div>
          ) : focused ? (
            <Theater
              channelId={channel.id}
              focused={focused}
              stream={screenOf(focused)}
              participants={participants}
              users={users}
              camOf={camOf}
              speakingOf={speakingOf}
              myPeer={myPeer}
            />
          ) : (
            <Grid tiles={tiles} channelId={channel.id} users={users} camOf={camOf} screenOf={screenOf} speakingOf={speakingOf} myPeer={myPeer} />
          )}
        </div>

        <Dock channel={channel} room={room} participants={participants} hidden={hideChrome} myPeer={myPeer} />
      </div>
      <VoiceChatPanel open={voiceChat} channel={channel} room={room} overlay={!!focused} />
    </div>
  );
}

// ─── Grid ────────────────────────────────────────────────────────────────────

function useSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

interface StreamProps {
  users: Record<string, PublicUser>;
  camOf: (p: VoiceParticipant) => MediaStream | undefined;
  speakingOf: (p: VoiceParticipant) => boolean;
  myPeer: string | null;
  channelId: string;
}

function Grid({ tiles, screenOf, ...rest }: StreamProps & { tiles: Tile[]; screenOf: (p: VoiceParticipant) => MediaStream | undefined }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(ref);
  const gap = 12;
  const n = Math.max(1, tiles.length);
  let tileW = 0;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    tileW = Math.max(tileW, Math.min((w - gap * (cols - 1)) / cols, (((h - gap * (rows - 1)) / rows) * 16) / 9));
  }
  tileW = Math.floor(Math.min(tileW, 960));

  return (
    <div className="absolute inset-0 px-6 pb-[100px] pt-4">
      <div ref={ref} className="flex h-full w-full flex-wrap content-center items-center justify-center" style={{ gap }}>
        <LayoutGroup>
          <AnimatePresence>
            {w > 0 &&
              tiles.map((t) => (
                <TileView key={t.key} tile={t} width={tileW} height={Math.round((tileW * 9) / 16)} stream={t.kind === 'screen' ? screenOf(t.p) : rest.camOf(t.p)} {...rest} />
              ))}
          </AnimatePresence>
        </LayoutGroup>
      </div>
    </div>
  );
}

function TileView({
  tile,
  width,
  height,
  stream,
  users,
  speakingOf,
  myPeer,
  channelId,
}: StreamProps & { tile: Tile; width: number; height: number; stream?: MediaStream }) {
  const { p, kind } = tile;
  const user = users[p.userId];
  const isMe = p.peerId === myPeer;
  const speaking = kind === 'user' && speakingOf(p);
  const avatarSize = Math.round(Math.min(104, height * 0.42));

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={spring}
      onDoubleClick={() => kind === 'screen' && useUI.getState().set({ focusedPeer: p.peerId })}
      onContextMenu={(e) => openMenu(e, channelId, p)}
      className="group relative overflow-hidden rounded-[22px] glass-tile"
      style={{ width, height }}
    >
      {kind === 'screen' ? (
        stream ? (
          <StreamVideo stream={stream} contain className="bg-black" />
        ) : (
          <div className="grid h-full place-items-center bg-black/40 text-white/70">
            <Spinner />
          </div>
        )
      ) : stream ? (
        <StreamVideo stream={stream} mirror={isMe} />
      ) : (
        <>
          <div className="absolute inset-0 opacity-[0.22]" style={{ background: gradientFor(p.userId) }} />
          <div className="relative grid h-full place-items-center">
            <Avatar user={user} size={avatarSize} speaking={speaking} />
          </div>
        </>
      )}

      <motion.div
        className="pointer-events-none absolute inset-0 rounded-[22px]"
        animate={{ boxShadow: speaking ? 'inset 0 0 0 2.5px var(--success)' : 'inset 0 0 0 0px rgba(0,0,0,0)' }}
        transition={{ duration: 0.15 }}
      />

      {kind === 'screen' && <span className="absolute left-3 top-3 rounded-[6px] bg-danger px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white">LIVE</span>}

      <div className="absolute bottom-2.5 left-2.5 flex max-w-[calc(100%-20px)] items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-[12px] font-medium text-white backdrop-blur-md">
        {kind === 'screen' && <MonitorPlay size={12} />}
        <span className="truncate">
          {kind === 'screen' ? `${isMe ? 'Your' : `${user?.name ?? 'Someone'}’s`} screen` : `${user?.name ?? 'Someone'}${isMe ? ' (you)' : ''}`}
        </span>
        {kind === 'user' && <ParticipantIcons p={p} size={12} />}
      </div>

      <div className="absolute right-2.5 top-2.5 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
        {kind === 'screen' && (
          <button onClick={() => useUI.getState().set({ focusedPeer: p.peerId })} className="flex h-8 items-center gap-1.5 rounded-full bg-black/50 px-3 text-[12px] font-semibold text-white backdrop-blur-md hover:bg-black/70">
            <Clapperboard size={13} /> Watch
          </button>
        )}
        {!isMe && (
          <button aria-label="Options" onClick={(e) => openMenu(e, channelId, p)} className="grid h-8 w-8 place-items-center rounded-full bg-black/50 text-white backdrop-blur-md hover:bg-black/70">
            <Ellipsis size={15} />
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─── Theater (watch together) ────────────────────────────────────────────────

function TheaterHeader({ channel, sharer, user, hidden, isMe }: { channel: Channel; sharer: VoiceParticipant; user?: PublicUser; hidden: boolean; isMe: boolean }) {
  const streamVolume = useSettings((s) => s.streamVolumes[sharer.userId] ?? 1);
  const immersive = useUI((s) => s.immersive);
  const bubblesHidden = useUI((s) => s.bubblesHidden);
  return (
    <motion.header
      data-tauri-drag-region
      animate={{ opacity: hidden ? 0 : 1, y: hidden ? -8 : 0 }}
      transition={spring}
      className="absolute inset-x-0 top-0 z-30 flex h-[60px] items-center gap-3 bg-gradient-to-b from-black/70 to-transparent px-5 text-white"
      style={{ pointerEvents: hidden ? 'none' : 'auto' }}
    >
      <span className="rounded-[6px] bg-danger px-1.5 py-0.5 text-[10px] font-bold tracking-wide">LIVE</span>
      <Avatar user={user} size={24} />
      <span data-tauri-drag-region className="text-[13.5px] font-semibold">
        {isMe ? 'You’re sharing your screen' : `${user?.name ?? 'Someone'}’s screen`}
      </span>
      {!isMe && sharer.streams && (
        <div className="ml-2 flex w-[150px] items-center gap-2">
          <Volume2 size={14} className="shrink-0 opacity-80" />
          <Slider value={streamVolume} min={0} max={2} onChange={(v) => useSettings.getState().setStreamVolume(sharer.userId, v)} />
        </div>
      )}
      <div data-tauri-drag-region className="flex-1 self-stretch" />
      <HeaderButton label={bubblesHidden ? 'Show people' : 'Hide people'} onClick={() => useUI.getState().set({ bubblesHidden: !bubblesHidden })} active={!bubblesHidden}>
        <Users size={16} />
      </HeaderButton>
      <HeaderButton label={useUI.getState().voiceChat ? 'Hide chat' : 'Show chat'} onClick={() => useUI.getState().set({ voiceChat: !useUI.getState().voiceChat })}>
        <MessageSquareText size={16} />
      </HeaderButton>
      <HeaderButton label={immersive ? 'Exit full screen' : 'Full screen'} onClick={() => void setImmersive(!immersive)}>
        {immersive ? <Shrink size={16} /> : <Expand size={16} />}
      </HeaderButton>
      <HeaderButton label="Exit watch mode" onClick={() => (useUI.getState().set({ focusedPeer: null }), immersive && void setImmersive(false))}>
        <Minimize2 size={16} />
      </HeaderButton>
      <span className="sr-only">{channel.name}</span>
    </motion.header>
  );
}

function HeaderButton({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: ReactNode }) {
  return (
    <Tooltip label={label} side="bottom">
      <button onClick={onClick} className={clsx('grid h-9 w-9 place-items-center rounded-full backdrop-blur-md transition-colors', active ? 'bg-white/25' : 'bg-white/10 hover:bg-white/20')}>
        {children}
      </button>
    </Tooltip>
  );
}

function Theater({
  focused,
  stream,
  participants,
  ...rest
}: StreamProps & { focused: VoiceParticipant; stream?: MediaStream; participants: VoiceParticipant[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useSize(ref);
  const hidden = useUI((s) => s.bubblesHidden);

  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden">
      {stream ? (
        <StreamVideo stream={stream} contain />
      ) : (
        <div className="grid h-full place-items-center text-white/70">
          <div className="flex flex-col items-center gap-3">
            <Spinner size={22} />
            <span className="text-[13px]">Waiting for the stream…</span>
          </div>
        </div>
      )}
      <AnimatePresence>
        {!hidden &&
          size.w > 0 &&
          participants.map((p, i) => <Bubble key={p.peerId} p={p} index={i} bounds={size} focusedPeer={focused.peerId} {...rest} />)}
      </AnimatePresence>
    </div>
  );
}

/** Loom-style floating person: drag anywhere, edges are magnetic, double-click to minimize. */
function Bubble({
  p,
  index,
  bounds,
  users,
  camOf,
  speakingOf,
  myPeer,
  channelId,
}: StreamProps & { p: VoiceParticipant; index: number; bounds: { w: number; h: number }; focusedPeer: string }) {
  const stored = useUI((s) => s.bubbles[p.peerId]);
  const mini = stored?.mini ?? false;
  const S = mini ? 56 : 116;
  const margin = 18;
  const bounds2 = { left: 12, top: 12, right: Math.max(12, bounds.w - S - 12), bottom: Math.max(12, bounds.h - S - 12) };
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

  // Undragged bubbles stack bottom-right above the dock; dragged ones stay where they were dropped.
  const perCol = Math.max(1, Math.floor((bounds.h - 200) / (S + 12)));
  const target = stored?.dragged
    ? { x: clamp(stored.x, bounds2.left, bounds2.right), y: clamp(stored.y, bounds2.top, bounds2.bottom) }
    : {
        x: clamp(bounds.w - S - margin - Math.floor(index / perCol) * (S + 12), bounds2.left, bounds2.right),
        y: clamp(bounds.h - 104 - ((index % perCol) + 1) * (S + 12), bounds2.top, bounds2.bottom),
      };
  const x = useMotionValue(target.x);
  const y = useMotionValue(target.y);
  const cam = camOf(p);
  const user = users[p.userId];
  const isMe = p.peerId === myPeer;

  useEffect(() => {
    animate(x, target.x, spring);
    animate(y, target.y, spring);
  }, [target.x, target.y]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Magnetic edges: drops close to a side snap neatly onto it. */
  const onDragEnd = () => {
    let nx = clamp(x.get(), bounds2.left, bounds2.right);
    let ny = clamp(y.get(), bounds2.top, bounds2.bottom);
    if (nx - bounds2.left < 44) nx = margin;
    if (bounds2.right - nx < 44) nx = bounds.w - S - margin;
    if (ny - bounds2.top < 44) ny = margin + 52;
    if (bounds2.bottom - ny < 44) ny = bounds.h - S - margin;
    animate(x, nx, spring);
    animate(y, ny, spring);
    useUI.getState().setBubble(p.peerId, { x: nx, y: ny, dragged: true });
  };

  return (
    <motion.div
      drag
      dragMomentum={false}
      dragElastic={0.1}
      dragConstraints={bounds2}
      onDragEnd={onDragEnd}
      onDoubleClick={() => useUI.getState().setBubble(p.peerId, { mini: !mini })}
      onContextMenu={(e) => openMenu(e, channelId, p)}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1, width: S, height: S }}
      exit={{ opacity: 0, scale: 0.6 }}
      whileHover={{ scale: 1.04 }}
      whileDrag={{ scale: 1.08 }}
      transition={spring}
      style={{ x, y }}
      className="group absolute left-0 top-0 z-20 cursor-grab active:cursor-grabbing"
    >
      <motion.div
        className="h-full w-full overflow-hidden rounded-full bg-black"
        animate={{
          boxShadow: speakingOf(p)
            ? '0 0 0 3px var(--success), 0 0 24px color-mix(in srgb, var(--success) 50%, transparent), 0 14px 34px rgba(0,0,0,0.55)'
            : '0 0 0 1.5px rgba(255,255,255,0.28), 0 14px 34px rgba(0,0,0,0.55)',
        }}
        transition={{ duration: 0.15 }}
      >
        {cam ? <StreamVideo stream={cam} mirror={isMe} /> : <Avatar user={user} size={S} />}
      </motion.div>
      {(p.muted || p.serverMuted) && (
        <span className="absolute bottom-0.5 right-0.5 grid h-6 w-6 place-items-center rounded-full bg-danger text-white shadow-[0_0_0_2px_rgba(0,0,0,0.6)]" style={{ transform: mini ? 'scale(0.75)' : undefined }}>
          <MicOff size={12} />
        </span>
      )}
      <button
        aria-label={mini ? 'Expand' : 'Minimize'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => useUI.getState().setBubble(p.peerId, { mini: !mini })}
        className="absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full bg-black/70 text-white opacity-0 shadow backdrop-blur transition-opacity group-hover:opacity-100"
      >
        {mini ? <Expand size={11} /> : <Minimize2 size={11} />}
      </button>
      {!mini && (
        <span className="pointer-events-none absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
          {user?.name ?? 'Someone'}
          {isMe ? ' (you)' : ''}
        </span>
      )}
    </motion.div>
  );
}

// ─── Dock ────────────────────────────────────────────────────────────────────

function Dock({ channel, room, participants, hidden, myPeer }: { channel: Channel; room: Room; participants: VoiceParticipant[]; hidden: boolean; myPeer: string | null }) {
  const muted = useVoice((s) => s.muted);
  const deafened = useVoice((s) => s.deafened);
  const serverMuted = useVoice((s) => s.serverMuted);
  const camera = useVoice((s) => s.camera);
  const screen = useVoice((s) => s.screen);
  const roomMuted = useChannels((s) => s.voice[channel.id]?.mutedRooms.includes(room.id) ?? false);
  const focusedPeer = useUI((s) => s.focusedPeer);
  const voiceChat = useUI((s) => s.voiceChat);
  const me = useAuth((s) => s.me);
  const [shareMenu, setShareMenu] = useState<Anchor | null>(null);
  const isAdmin = channel.role !== 'member';
  const sharer = participants.find((p) => p.screen && p.peerId !== myPeer) ?? participants.find((p) => p.screen);
  const micOff = muted || deafened || serverMuted;

  return (
    <motion.div
      animate={{ opacity: hidden ? 0 : 1, y: hidden ? 18 : 0 }}
      transition={spring}
      style={{ pointerEvents: hidden ? 'none' : 'auto' }}
      className="absolute bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-[24px] p-2 glass-pop"
    >
      <DockButton label={serverMuted ? 'Muted by an admin' : micOff ? 'Unmute' : 'Mute'} state={micOff ? 'off' : 'normal'} onClick={() => void voice.toggleMute()}>
        {micOff ? <MicOff size={19} /> : <Mic size={19} />}
      </DockButton>
      <DockButton label={deafened ? 'Undeafen' : 'Deafen'} state={deafened ? 'off' : 'normal'} onClick={() => voice.toggleDeafen()}>
        {deafened ? <HeadphoneOff size={19} /> : <Headphones size={19} />}
      </DockButton>
      <Divider />
      <DockButton label={camera ? 'Turn camera off' : 'Turn camera on'} state={camera ? 'on' : 'normal'} onClick={() => void voice.toggleCamera()}>
        {camera ? <Video size={19} /> : <VideoOff size={19} />}
      </DockButton>
      <div className="flex items-center">
        <DockButton label={screen ? 'Stop sharing' : 'Share your screen'} state={screen ? 'on' : 'normal'} onClick={() => (screen ? voice.stopScreen() : void voice.startScreen())} className="rounded-r-[6px]!">
          {screen ? <ScreenShareOff size={19} /> : <ScreenShare size={19} />}
        </DockButton>
        <Tooltip label="Screen share options">
          <button
            onClick={(e) => setShareMenu(e.currentTarget.getBoundingClientRect())}
            className="ml-px grid h-11 w-6 place-items-center rounded-l-[6px] rounded-r-[14px] bg-fill-2 text-fg-2 transition-colors hover:bg-fill-3 hover:text-fg"
          >
            <ChevronUp size={14} />
          </button>
        </Tooltip>
      </div>
      {sharer && (
        <DockButton
          label={focusedPeer ? 'Exit watch mode' : 'Watch together'}
          state={focusedPeer ? 'on' : 'normal'}
          onClick={() => useUI.getState().set({ focusedPeer: focusedPeer ? null : sharer.peerId })}
        >
          <Clapperboard size={19} />
        </DockButton>
      )}
      <DockButton label={voiceChat ? 'Hide chat' : 'Show chat'} state={voiceChat ? 'on' : 'normal'} onClick={() => useUI.getState().set({ voiceChat: !voiceChat })}>
        <MessageSquareText size={19} />
      </DockButton>
      {isAdmin && (
        <DockButton
          label={roomMuted ? 'Unmute everyone' : 'Mute everyone (admins can still talk)'}
          state={roomMuted ? 'off' : 'normal'}
          onClick={() => getHub(channel.id)?.send({ t: 'voice.roomMute', roomId: room.id, muted: !roomMuted })}
        >
          <span className="relative">
            <Users size={19} />
            {roomMuted && <span className="absolute -bottom-1 -right-1.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-danger text-white"><MicOff size={8} /></span>}
          </span>
        </DockButton>
      )}
      <Divider />
      <Tooltip label="Leave voice">
        <motion.button
          whileTap={{ scale: 0.9 }}
          transition={snappy}
          onClick={() => voice.leave()}
          className="grid h-11 w-[54px] place-items-center rounded-[14px] bg-danger text-white shadow-[inset_0_0.5px_0_rgba(255,255,255,0.3)] hover:brightness-110"
        >
          <PhoneOff size={19} />
        </motion.button>
      </Tooltip>

      <Popover open={!!shareMenu} anchor={shareMenu} onClose={() => setShareMenu(null)} side="top" align="center" offset={14}>
        <ShareOptions
          sharing={screen}
          onStart={() => {
            setShareMenu(null);
            void voice.startScreen();
          }}
        />
      </Popover>
      <span className="sr-only">{me?.name}</span>
    </motion.div>
  );
}

const Divider = () => <div className="mx-0.5 h-7 w-px bg-[var(--hairline-strong)]" />;

function DockButton({
  label,
  state,
  onClick,
  children,
  className,
}: {
  label: string;
  state: 'normal' | 'on' | 'off';
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tooltip label={label}>
      <motion.button
        aria-label={label}
        whileTap={{ scale: 0.9 }}
        transition={snappy}
        onClick={onClick}
        className={clsx(
          'grid h-11 w-11 place-items-center rounded-[14px] transition-colors duration-150',
          state === 'normal' && 'bg-fill-2 text-fg hover:bg-fill-3',
          state === 'on' && 'bg-accent text-white',
          state === 'off' && 'text-danger',
          className,
        )}
        style={state === 'off' ? { background: 'color-mix(in srgb, var(--danger) 18%, transparent)' } : undefined}
      >
        {children}
      </motion.button>
    </Tooltip>
  );
}

function ShareOptions({ sharing, onStart }: { sharing: boolean; onStart: () => void }) {
  const quality = useSettings((s) => s.screenQuality);
  const mode = useSettings((s) => s.screenMode);
  const audio = useSettings((s) => s.shareAudio);
  const set = useSettings((s) => s.set);
  return (
    <div className="w-[312px] p-3.5">
      <div className="font-display text-[15px] font-semibold">Screen share</div>
      <p className="mt-0.5 text-[12px] text-fg-2">Share your whole screen or a single app window.</p>

      <div className="mt-3.5 text-[11.5px] font-semibold text-fg-3">Quality</div>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        {(Object.keys(SCREEN_PRESETS) as ScreenQuality[]).map((q) => (
          <button
            key={q}
            onClick={() => set({ screenQuality: q })}
            className={clsx('rounded-[10px] px-2.5 py-2 text-left text-[12px] font-medium transition-colors', quality === q ? 'bg-accent text-white' : 'bg-fill-2 hover:bg-fill-3')}
          >
            {SCREEN_PRESETS[q].label}
          </button>
        ))}
      </div>

      <div className="mt-3.5 text-[11.5px] font-semibold text-fg-3">Optimize for</div>
      <Segmented
        id="share-mode"
        className="mt-1.5"
        value={mode}
        onChange={(v) => set({ screenMode: v })}
        options={[
          { value: 'motion', label: '🎬 Movies & games' },
          { value: 'detail', label: '📝 Text & code' },
        ]}
      />

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[13px]">Share sound</span>
        <Switch checked={audio} onChange={(v) => set({ shareAudio: v })} />
      </div>

      <p className="mt-3 rounded-[10px] bg-fill-1 px-2.5 py-2 text-[11px] leading-snug text-fg-3">
        Tip: Netflix and other protected sites can appear black. Turn off hardware acceleration in your browser before sharing them.
      </p>

      {!sharing && (
        <Button variant="primary" className="mt-3 w-full" icon={<ScreenShare size={15} />} onClick={onStart}>
          Choose what to share…
        </Button>
      )}
    </div>
  );
}
