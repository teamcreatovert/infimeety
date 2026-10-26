import clsx from 'clsx';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import {
  AudioLines,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Ellipsis,
  HeadphoneOff,
  Headphones,
  MessageSquareText,
  Mic,
  MicOff,
  MonitorPlay,
  Phone,
  PhoneOff,
  Popcorn,
  ScreenShare,
  ScreenShareOff,
  Users,
  Video,
  VideoOff,
  Volume2,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Channel, PublicUser, Room, VoiceParticipant } from '../../../../shared/protocol';
import { MobileBack } from '../shell/MobileBack';
import { ParticipantIcons } from '../shell/Sidebar';
import { Avatar } from '../ui/Avatar';
import { MenuItem, MenuSeparator, Popover, Tooltip, type Anchor } from '../ui/overlay';
import { Button, Segmented, Slider, Spinner, Switch } from '../ui/primitives';
import { PartyBadge, PartyControls, PartyHeaderInfo, PartyMedia, PartyPersonExtra, PartyRequests, useWatchingAlong } from './Party';
import { StreamVideo } from './StreamVideo';
import { CallPanel, WatchStage, type WatchLayout, type WatchPeople } from './Watch';
import { channelGradient, gradientFor } from '@/lib/format';
import { spring, snappy } from '@/lib/motion';
import { appWindow, canShareScreen, isMac, isTauri } from '@/lib/platform';
import { useParty } from '@/lib/party';
import { getHub } from '@/lib/realtime';
import { isCompactNow, useCompact } from '@/lib/responsive';
import { voice } from '@/lib/voice/engine';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { SCREEN_PRESETS, useSettings, type ScreenQuality } from '@/stores/settings';
import { openUserMenu, useUI } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

type Tile = { key: string; kind: 'user' | 'screen'; p: VoiceParticipant };

const EMPTY: VoiceParticipant[] = [];

function useRoomParticipants(channelId: string, roomId: string) {
  const all = useChannels((s) => s.voice[channelId]?.participants ?? EMPTY);
  return useMemo(() => all.filter((p) => p.roomId === roomId).sort((a, b) => a.joinedAt - b.joinedAt), [all, roomId]);
}

function openMenu(e: React.MouseEvent, channelId: string, p: VoiceParticipant) {
  openUserMenu(e, p.userId, { kind: 'voice', channelId, peerId: p.peerId });
}

type FullscreenVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

async function setImmersive(on: boolean) {
  // iPhones can't make a page full screen, only a video: hand the stage to the system player.
  const video = document.querySelector<FullscreenVideo>('video[data-stage]');
  if (on && !isTauri && !document.documentElement.requestFullscreen && video?.webkitEnterFullscreen) return video.webkitEnterFullscreen();
  useUI.getState().set({ immersive: on });
  await appWindow.setFullscreen(on).catch(() => {});
  // Phones: a shared screen is landscape, so turn with it while full screen.
  const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  if (on) void orientation?.lock?.('landscape').catch(() => {});
  else orientation?.unlock?.();
}

/** `chatRoom` overrides the side chat (DM calls show the DM conversation); `extras` sit in the stage header. */
export function VoiceRoomView({ channel, room, chatRoom, extras }: { channel: Channel; room: Room; chatRoom?: Room; extras?: ReactNode }) {
  const here = useVoice((s) => s.roomId === room.id);
  return here ? <Stage channel={channel} room={room} chatRoom={chatRoom ?? room} extras={extras} /> : <Lobby channel={channel} room={room} />;
}

const stageTitle = (channel: Channel, room: Room) =>
  channel.kind === 'dm' ? `Call with ${channel.peer?.name ?? 'friend'}` : channel.kind === 'meeting' ? channel.name : room.name;

// ─── Lobby ───────────────────────────────────────────────────────────────────

function Lobby({ channel, room }: { channel: Channel; room: Room }) {
  const participants = useRoomParticipants(channel.id, room.id);
  const users = useChannels((s) => s.users);
  const voiceChat = useUI((s) => s.voiceChat);
  const party = useParty((s) => s.parties[room.id]);
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
        <header data-tauri-drag-region className="hairline-b flex h-[52px] shrink-0 items-center gap-2 px-5 compact:px-3">
          <MobileBack />
          <Volume2 size={18} className="shrink-0 text-fg-3" />
          <h1 data-tauri-drag-region className="truncate font-display text-[15px] font-semibold tracking-[-0.015em]">
            {room.name}
          </h1>
          <div data-tauri-drag-region className="flex-1 self-stretch" />
          <ChatToggle />
        </header>
        <div className="grid flex-1 place-items-center overflow-y-auto p-8 compact:p-5">
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
            {party && (
              <p className="mt-3 flex max-w-full items-center gap-1.5 rounded-full bg-fill-2 px-3 py-1 text-[12.5px] text-fg-2">
                <Popcorn size={14} className="shrink-0 text-accent" />
                <span className="truncate">
                  Watch party: <span className="font-medium text-fg">{party.file.name}</span>
                </span>
              </p>
            )}
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
      <VoiceChatPanel
        open={voiceChat}
        channel={channel}
        room={room}
        voiceRoom={room}
        people={{ people: participants, users, camOf: () => undefined, speakingOf: () => false, myPeer: null }}
      />
    </div>
  );
}

export function ChatToggle() {
  const open = useUI((s) => s.voiceChat);
  return (
    <Tooltip label={open ? 'Hide chat' : 'Show chat'} side="bottom">
      <button
        aria-label={open ? 'Hide chat' : 'Show chat'}
        onClick={() => useUI.getState().set({ voiceChat: !open })}
        className={clsx(
          'grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] transition-colors compact:h-9 compact:w-9',
          open ? 'bg-fill-3 text-fg' : 'text-fg-2 hover:bg-fill-2 hover:text-fg',
        )}
      >
        <MessageSquareText size={17} />
      </button>
    </Tooltip>
  );
}

/**
 * The call's side panel: Chat, plus People and Watch party when the call's `people` and voice
 * room are given. `room` is the chat's room (a DM call chats in the DM).
 */
export function VoiceChatPanel({ open, channel, room, voiceRoom, people }: { open: boolean; channel: Channel; room: Room; voiceRoom?: Room; people?: WatchPeople }) {
  const compact = useCompact();
  const close = () => useUI.getState().set({ voiceChat: false });
  // Phones: the chat covers the call as a sheet; the call keeps running underneath.
  if (compact)
    return createPortal(
      <AnimatePresence>
        {open && (
          <motion.aside
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 42 }}
            className="safe-area fixed inset-0 z-[70] flex flex-col bg-[var(--bg)]"
          >
            <div className="hairline-b flex h-[52px] shrink-0 items-center gap-2 px-3">
              <button aria-label="Back to the call" onClick={close} className="grid h-10 w-9 place-items-center rounded-[10px] text-fg-2 active:bg-fill-2">
                <ChevronDown size={24} />
              </button>
              <span className="flex-1 truncate text-[15px] font-semibold">Back to the call</span>
            </div>
            <CallPanel channel={channel} chatRoom={room} room={voiceRoom} people={people} className="min-h-0 flex-1" />
          </motion.aside>
        )}
      </AnimatePresence>,
      document.body,
    );
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 360, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 40 }}
          className="shrink-0 overflow-hidden hairline-l"
        >
          <CallPanel channel={channel} chatRoom={room} room={voiceRoom} people={people} onClose={close} className="h-full w-[360px]" />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

// ─── Stage ───────────────────────────────────────────────────────────────────

function Stage({ channel, room, chatRoom, extras }: { channel: Channel; room: Room; chatRoom: Room; extras?: ReactNode }) {
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
  const watchLayout = useUI((s) => s.watchLayout);
  const partyView = useUI((s) => s.partyView);
  const party = useParty((s) => s.parties[room.id]);
  const myPeer = voice.peerId;

  const camOf = (p: VoiceParticipant) => (p.peerId === myPeer ? localCam : remote[p.peerId]?.cam) ?? undefined;
  const screenOf = (p: VoiceParticipant) => (p.peerId === myPeer ? localScreen : remote[p.peerId]?.screen) ?? undefined;
  const speakingOf = (p: VoiceParticipant) => !!(p.peerId === myPeer ? speaking.self : speaking[p.peerId]);

  const tiles: Tile[] = [
    ...participants.filter((p) => p.screen).map((p) => ({ key: `${p.peerId}:screen`, kind: 'screen' as const, p })),
    ...participants.map((p) => ({ key: p.peerId, kind: 'user' as const, p })),
  ];
  const focused = focusedPeer ? participants.find((p) => p.peerId === focusedPeer && p.screen) : undefined;
  const watchingParty = !!party && partyView && !focused;
  const watching = !!focused || watchingParty;
  // The movie (and its controls) once it's on and this device watches along; the lobby before.
  const watchingAlong = useWatchingAlong(party);

  // When a friend is sharing (e.g. a movie) — or starts to — jump straight into watch mode.
  const sharers = participants.filter((p) => p.screen && p.peerId !== myPeer).map((p) => p.peerId);
  const prevSharers = useRef<string[]>([]);
  useEffect(() => {
    const fresh = sharers.find((id) => !prevSharers.current.includes(id));
    if (fresh && !useUI.getState().focusedPeer) useUI.getState().set({ focusedPeer: fresh });
    prevSharers.current = sharers;
  }, [sharers.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  // A watch party starting (or running when we arrive) takes everyone to it.
  useEffect(() => {
    // The side panel opens on its Watch party tab, where everyone gets ready.
    if (party?.id) useUI.getState().set({ partyView: true, focusedPeer: null, sideTab: 'party' });
  }, [party?.id]);

  // Drop watch mode only when the focused sharer actually stopped (not on a stale render).
  useEffect(() => {
    const fp = useUI.getState().focusedPeer;
    if (fp && !participants.some((p) => p.peerId === fp && p.screen)) useUI.getState().set({ focusedPeer: null });
  }, [participants]);

  useEffect(() => {
    if (!watching && useUI.getState().immersive) void setImmersive(false);
    // Watching opens the side panel (chat and people) next to the picture and folds the
    // channel list away; a button in the header brings it back.
    if (watching && !isCompactNow()) useUI.getState().set({ voiceChat: true, navCollapsed: true });
    if (!watching) useUI.getState().set({ navCollapsed: false });
  }, [watching]);
  useEffect(() => () => useUI.getState().set({ navCollapsed: false }), []);

  // Cinema behaviour: controls fade out after a moment of stillness.
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wake = () => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    if (watching) idleTimer.current = setTimeout(() => setIdle(true), 2800);
  };
  useEffect(() => {
    wake();
    return () => clearTimeout(idleTimer.current);
  }, [watching, focused?.peerId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && useUI.getState().immersive) void setImmersive(false);
    };
    // The browser leaves full screen on its own (Esc): follow it.
    const onFullscreen = () => !document.fullscreenElement && useUI.getState().immersive && void setImmersive(false);
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, []);

  // A paused movie (or the lobby) keeps its controls up.
  const hideChrome = watching && idle && !(watchingParty && (!party.playing || !watchingAlong));
  const audioBlocked = useVoice((s) => s.audioBlocked);
  const soundPrompt = (
    <AnimatePresence>
      {audioBlocked && (
        <motion.button
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={spring}
          className="absolute left-1/2 top-[62px] z-40 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white shadow-lg"
        >
          <Volume2 size={15} /> Tap to turn on sound
        </motion.button>
      )}
    </AnimatePresence>
  );

  if (watching) {
    const sharerUser = focused ? users[focused.userId] : undefined;
    const setLayout = (layout: WatchLayout) => {
      if (layout === 'full') return void setImmersive(true);
      useUI.getState().set({ watchLayout: layout });
      if (useUI.getState().immersive) void setImmersive(false);
    };
    const exit = () => {
      useUI.getState().set(focused ? { focusedPeer: null } : { partyView: false });
      if (useUI.getState().immersive) void setImmersive(false);
    };
    return (
      // Touch has no hover: a tap brings the controls back.
      <div className="relative h-full min-h-0" onMouseMove={wake} onPointerDown={wake}>
        <WatchStage
          channel={channel}
          chatRoom={chatRoom}
          room={room}
          layout={immersive ? 'full' : watchLayout}
          onLayout={setLayout}
          idle={hideChrome}
          badge={
            focused ? (
              <>
                <span className="shrink-0 rounded-[6px] bg-danger px-1.5 py-0.5 text-[10px] font-bold tracking-wide">LIVE</span>
                <Avatar user={sharerUser} size={24} className="shrink-0 compact:hidden" />
              </>
            ) : (
              <PartyBadge />
            )
          }
          title={focused ? (focused.peerId === myPeer ? 'You’re sharing your screen' : `${sharerUser?.name ?? 'Someone'}’s screen`) : party!.file.name}
          headerExtras={focused ? focused.peerId !== myPeer && focused.streams && <SharerVolume userId={focused.userId} /> : <PartyHeaderInfo roomId={room.id} party={party!} />}
          media={
            focused ? (
              <ScreenMedia stream={screenOf(focused)} />
            ) : (
              <PartyMedia roomId={room.id} party={party!} chromeHidden={hideChrome} />
            )
          }
          controls={watchingParty && watchingAlong ? <PartyControls roomId={room.id} party={party} /> : undefined}
          overlay={
            <>
              {soundPrompt}
              {watchingParty && <PartyRequests roomId={room.id} />}
            </>
          }
          dock={(hidden) => <Dock channel={channel} room={room} participants={participants} hidden={hidden} myPeer={myPeer} watching />}
          tallStage={watchingParty && !watchingAlong}
          exitLabel="Exit watch mode"
          onExit={exit}
          people={participants}
          users={users}
          camOf={camOf}
          speakingOf={speakingOf}
          myPeer={myPeer}
          extra={watchingParty ? (p) => <PartyPersonExtra roomId={room.id} party={party} p={p} /> : undefined}
        />
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <header data-tauri-drag-region className="hairline-b flex h-[52px] shrink-0 items-center gap-2 px-5 compact:gap-1.5 compact:px-3">
          <MobileBack />
          <AudioLines size={18} className="shrink-0 text-success" />
          <h1 data-tauri-drag-region className="min-w-0 truncate font-display text-[15px] font-semibold tracking-[-0.015em]">
            {stageTitle(channel, room)}
          </h1>
          <span data-tauri-drag-region className="shrink-0 whitespace-nowrap text-[12px] text-fg-3 compact:hidden">
            {participants.length} {participants.length === 1 ? 'person' : 'people'}
          </span>
          <div data-tauri-drag-region className="flex-1 self-stretch" />
          {extras}
        </header>

        {soundPrompt}

        <div className="relative min-h-0 flex-1">
          {status === 'connecting' && participants.length === 0 ? (
            <div className="grid h-full place-items-center text-fg-2">
              <div className="flex flex-col items-center gap-3">
                <Spinner size={22} />
                <span className="text-[13px]">
                  {channel.kind === 'dm' ? `Calling ${channel.peer?.name ?? 'your friend'}…` : channel.kind === 'meeting' ? 'Joining the meeting…' : `Joining ${room.name}…`}
                </span>
              </div>
            </div>
          ) : (
            <Grid tiles={tiles} channelId={channel.id} users={users} camOf={camOf} screenOf={screenOf} speakingOf={speakingOf} myPeer={myPeer} />
          )}
        </div>

        <Dock channel={channel} room={room} participants={participants} hidden={false} myPeer={myPeer} watching={false} />
      </div>
      <VoiceChatPanel
        open={voiceChat}
        channel={channel}
        room={chatRoom}
        voiceRoom={room}
        people={{ people: participants, users, camOf, speakingOf, myPeer, extra: party ? (p) => <PartyPersonExtra roomId={room.id} party={party} p={p} /> : undefined }}
      />
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
  const compact = useCompact();
  const gap = compact ? 8 : 12;
  // A phone held upright fills its screen better with square tiles than with wide ones.
  const aspect = compact && h > w * 1.15 ? 1 : 16 / 9;
  const n = Math.max(1, tiles.length);
  let tileW = 0;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    tileW = Math.max(tileW, Math.min((w - gap * (cols - 1)) / cols, ((h - gap * (rows - 1)) / rows) * aspect));
  }
  tileW = Math.floor(Math.min(tileW, 960));

  return (
    <div className="absolute inset-0 px-6 pb-[100px] pt-4 compact:px-2.5 compact:pb-[84px] compact:pt-2.5">
      <div ref={ref} className="flex h-full w-full flex-wrap content-center items-center justify-center" style={{ gap }}>
        <LayoutGroup>
          <AnimatePresence>
            {w > 0 &&
              tiles.map((t) => (
                <TileView key={t.key} tile={t} width={tileW} height={Math.round(tileW / aspect)} stream={t.kind === 'screen' ? screenOf(t.p) : rest.camOf(t.p)} {...rest} />
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
  const avatarSize = Math.round(Math.min(104, height * 0.42, width * 0.42));

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

      <div className="absolute right-2.5 top-2.5 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 touch:opacity-100">
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

// ─── Watching a shared screen ────────────────────────────────────────────────

function ScreenMedia({ stream }: { stream?: MediaStream }) {
  return (
    <div className="absolute inset-0">
      {stream ? (
        <StreamVideo stream={stream} contain stage />
      ) : (
        <div className="grid h-full place-items-center text-white/70">
          <div className="flex flex-col items-center gap-3">
            <Spinner size={22} />
            <span className="text-[13px]">Waiting for the stream…</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Phones use their volume buttons. */
function SharerVolume({ userId }: { userId: string }) {
  const volume = useSettings((s) => s.streamVolumes[userId] ?? 1);
  return (
    <div className="ml-2 flex w-[150px] shrink-0 items-center gap-2 compact:hidden">
      <Volume2 size={14} className="shrink-0 opacity-80" />
      <Slider value={volume} min={0} max={2} onChange={(v) => useSettings.getState().setStreamVolume(userId, v)} />
    </div>
  );
}

// ─── Dock ────────────────────────────────────────────────────────────────────

function Dock({
  channel,
  room,
  participants,
  hidden,
  myPeer,
  watching,
}: {
  channel: Channel;
  room: Room;
  participants: VoiceParticipant[];
  hidden: boolean;
  myPeer: string | null;
  watching: boolean;
}) {
  const muted = useVoice((s) => s.muted);
  const deafened = useVoice((s) => s.deafened);
  const serverMuted = useVoice((s) => s.serverMuted);
  const camera = useVoice((s) => s.camera);
  const screen = useVoice((s) => s.screen);
  const roomMuted = useChannels((s) => s.voice[channel.id]?.mutedRooms.includes(room.id) ?? false);
  const focusedPeer = useUI((s) => s.focusedPeer);
  const voiceChat = useUI((s) => s.voiceChat);
  const partyView = useUI((s) => s.partyView);
  const party = useParty((s) => s.parties[room.id]);
  const me = useAuth((s) => s.me);
  const compact = useCompact();
  const [shareMenu, setShareMenu] = useState<Anchor | null>(null);
  const [moreMenu, setMoreMenu] = useState<Anchor | null>(null);
  const isAdmin = channel.role !== 'member';
  const sharer = participants.find((p) => p.screen && p.peerId !== myPeer) ?? participants.find((p) => p.screen);
  const micOff = muted || deafened || serverMuted;
  const toggleRoomMute = () => getHub(channel.id)?.send({ t: 'voice.roomMute', roomId: room.id, muted: !roomMuted });
  const toggleWatch = () => sharer && useUI.getState().set({ focusedPeer: focusedPeer ? null : sharer.peerId });
  // A watch party is planned from the chat; here you only go back to (or away from) one that's on.
  const onParty = !!party && partyView && !focusedPeer;
  const partyLabel = onParty ? 'Back to the call' : 'Back to the watch party';
  const togglePartyView = () => useUI.getState().set(onParty ? { partyView: false } : { partyView: true, focusedPeer: null });

  if (compact)
    return (
      <motion.div
        animate={{ opacity: hidden ? 0 : 1, y: hidden ? 18 : 0 }}
        transition={spring}
        style={{ pointerEvents: hidden ? 'none' : 'auto' }}
        className="absolute bottom-2.5 left-1/2 z-30 flex max-w-[calc(100%-20px)] -translate-x-1/2 items-center gap-1.5 rounded-[22px] p-1.5 glass-pop"
      >
        <DockButton label={serverMuted ? 'Muted by an admin' : micOff ? 'Unmute' : 'Mute'} state={micOff ? 'off' : 'normal'} onClick={() => void voice.toggleMute()}>
          {micOff ? <MicOff size={20} /> : <Mic size={20} />}
        </DockButton>
        <DockButton label={camera ? 'Turn camera off' : 'Turn camera on'} state={camera ? 'on' : 'normal'} onClick={() => void voice.toggleCamera()}>
          {camera ? <Video size={20} /> : <VideoOff size={20} />}
        </DockButton>
        {canShareScreen && (
          <DockButton label={screen ? 'Stop sharing' : 'Share your screen'} state={screen ? 'on' : 'normal'} onClick={() => (screen ? voice.stopScreen() : void voice.startScreen())}>
            {screen ? <ScreenShareOff size={20} /> : <ScreenShare size={20} />}
          </DockButton>
        )}
        {!watching && (
          <DockButton label={voiceChat ? 'Hide chat' : 'Show chat'} state={voiceChat ? 'on' : 'normal'} onClick={() => useUI.getState().set({ voiceChat: !voiceChat })}>
            <MessageSquareText size={20} />
          </DockButton>
        )}
        <DockButton label="More" state={deafened || roomMuted ? 'off' : 'normal'} onClick={(el) => setMoreMenu(el.getBoundingClientRect())}>
          <Ellipsis size={20} />
        </DockButton>
        <motion.button
          aria-label={channel.kind === 'meeting' ? 'Leave the call' : 'Leave voice'}
          whileTap={{ scale: 0.9 }}
          transition={snappy}
          onClick={() => voice.leave()}
          className="grid h-12 w-[76px] shrink-0 place-items-center rounded-[16px] bg-danger text-white shadow-[inset_0_0.5px_0_rgba(255,255,255,0.3)]"
        >
          <PhoneOff size={20} />
        </motion.button>

        <Popover open={!!moreMenu} anchor={moreMenu} onClose={() => setMoreMenu(null)} side="top" align="end" offset={12} className="w-[240px] p-1.5">
          <MenuItem icon={deafened ? <Headphones size={15} /> : <HeadphoneOff size={15} />} onClick={() => (setMoreMenu(null), voice.toggleDeafen())}>
            {deafened ? 'Undeafen' : 'Deafen (mute everyone for me)'}
          </MenuItem>
          {sharer && (
            <MenuItem icon={<Clapperboard size={15} />} onClick={() => (setMoreMenu(null), toggleWatch())}>
              {focusedPeer ? 'Exit watch mode' : 'Watch together'}
            </MenuItem>
          )}
          {party && (
            <MenuItem icon={<Popcorn size={15} />} onClick={() => (setMoreMenu(null), togglePartyView())}>
              {partyLabel}
            </MenuItem>
          )}
          {isAdmin && (
            <>
              <MenuSeparator />
              <MenuItem icon={<Users size={15} />} onClick={() => (setMoreMenu(null), toggleRoomMute())}>
                {roomMuted ? 'Unmute everyone' : 'Mute everyone'}
              </MenuItem>
            </>
          )}
        </Popover>
      </motion.div>
    );

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
        <DockButton label={focusedPeer ? 'Exit watch mode' : 'Watch together'} state={focusedPeer ? 'on' : 'normal'} onClick={toggleWatch}>
          <Clapperboard size={19} />
        </DockButton>
      )}
      {party && (
        <DockButton label={partyLabel} state={onParty ? 'on' : 'normal'} onClick={togglePartyView}>
          <span className="relative">
            <Popcorn size={19} />
            {!onParty && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent shadow-[0_0_0_2px_var(--bg)]" />}
          </span>
        </DockButton>
      )}
      {!watching && (
        <DockButton label={voiceChat ? 'Hide chat' : 'Show chat'} state={voiceChat ? 'on' : 'normal'} onClick={() => useUI.getState().set({ voiceChat: !voiceChat })}>
          <MessageSquareText size={19} />
        </DockButton>
      )}
      {isAdmin && (
        <DockButton
          label={roomMuted ? 'Unmute everyone' : 'Mute everyone (admins and moderators can still talk)'}
          state={roomMuted ? 'off' : 'normal'}
          onClick={toggleRoomMute}
        >
          <span className="relative">
            <Users size={19} />
            {roomMuted && <span className="absolute -bottom-1 -right-1.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-danger text-white"><MicOff size={8} /></span>}
          </span>
        </DockButton>
      )}
      <Divider />
      <Tooltip label={channel.kind === 'meeting' ? 'Leave the call' : 'Leave voice'}>
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
  onClick: (el: HTMLButtonElement) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tooltip label={label}>
      <motion.button
        aria-label={label}
        whileTap={{ scale: 0.9 }}
        transition={snappy}
        onClick={(e) => onClick(e.currentTarget)}
        className={clsx(
          'grid h-11 w-11 shrink-0 place-items-center rounded-[14px] transition-colors duration-150 compact:h-12 compact:w-12 compact:rounded-[16px]',
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

      {isTauri && isMac ? (
        <p className="mt-3 text-[12px] leading-snug text-fg-3">Sharing your Mac’s sound isn’t available yet, so friends see your screen without its sound.</p>
      ) : (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[13px]">Share sound</span>
          <Switch checked={audio} onChange={(v) => set({ shareAudio: v })} />
        </div>
      )}

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
