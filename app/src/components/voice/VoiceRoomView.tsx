import clsx from 'clsx';
import { listen } from '@tauri-apps/api/event';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import {
  AudioLines,
  AudioWaveform,
  Check,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Ellipsis,
  EyeOff,
  HeadphoneOff,
  Headphones,
  MessageSquareText,
  Mic,
  MicOff,
  SmilePlus,
  Hand,
  MonitorPlay,
  Phone,
  PhoneOff,
  Popcorn,
  ScreenShare,
  ScreenShareOff,
  ShieldCheck,
  PenLine,
  Presentation,
  LayoutGrid,
  RectangleHorizontal,
  Sparkles,
  Pin,
  PinOff,
  Users,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Channel, PublicUser, Room, VoiceParticipant } from '../../../../shared/protocol';
import { MobileBack } from '../shell/MobileBack';
import { ParticipantIcons } from '../shell/Sidebar';
import { Avatar } from '../ui/Avatar';
import { MenuItem, MenuSeparator, Popover, Tooltip, type Anchor } from '../ui/overlay';
import { Button, Segmented, Slider, Spinner, Switch } from '../ui/primitives';
import { SoundBursts } from './Soundboard';
import { PartyBadge, PartyControls, PartyHeaderInfo, PartyMedia, PartyPersonExtra, PartyRequests, PartyVotes, preloadParty } from './PartyLazy';
import { StreamVideo } from './StreamVideo';
import { CallStatus } from './CallStatus';
import { FloatingReactions, FunPanel } from './Fun';
import { HostControls } from '../meeting/HostControls';
import { BoardTile, DrawLayer, DrawToolbar, toggleBoard, useCanDraw, useCanPresent, useSharerOverlay } from '../meeting/Draw';
import { useDraw } from '@/lib/draw';
import { CinemaSeats, LobbyChooser, WebFillToggle, WebStage } from './Lobby';
import { MusicTile, canShareMusic } from './Music';
import { CallPanel, WatchStage, type WatchLayout, type WatchPeople } from './Watch';
import { channelGradient, gradientFor } from '@/lib/format';
import { spring, snappy } from '@/lib/motion';
import { canShareScreen, isMac, isTauri } from '@/lib/platform';
import { useParty, useWatchingAlong } from '@/lib/party';
import { joinWeb, useWeb } from '@/lib/watchWeb';
import { setImmersive, toggleImmersive } from '@/lib/immersive';
import { joinLobby, leaveLobby, startLobby, useHasLobby } from '@/lib/activityLobby';
import { useFeatureOn } from '@/lib/remote';
import { clock, usePenalties, useSecondsLeft } from '@/lib/penalties';
import { getHub } from '@/lib/realtime';
import { isCompactNow, useCompact } from '@/lib/responsive';
import { voice } from '@/lib/voice/engine';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { HELD_BACK_NOTE, useHeldBack, useMeetings } from '@/stores/meetings';
import { SCREEN_PRESETS, useSettings, type ScreenQuality } from '@/stores/settings';
import { openUserMenu, toast, useUI } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

type Tile = { key: string; kind: 'user' | 'screen' | 'music' | 'board'; p: VoiceParticipant };

const EMPTY: VoiceParticipant[] = [];

function useRoomParticipants(channelId: string, roomId: string) {
  const all = useChannels((s) => s.voice[channelId]?.participants ?? EMPTY);
  return useMemo(() => all.filter((p) => p.roomId === roomId).sort((a, b) => a.joinedAt - b.joinedAt), [all, roomId]);
}

function openMenu(e: React.MouseEvent, channelId: string, p: VoiceParticipant) {
  openUserMenu(e, p.userId, { kind: 'voice', channelId, peerId: p.peerId });
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

/** Discord-style icons at the top right of a call: each opens the side panel on its tab, or closes it. */
function PanelToggle({ tab, label, dot, children }: { tab: 'chat' | 'people' | 'party'; label: string; dot?: boolean; children: ReactNode }) {
  const open = useUI((s) => s.voiceChat && s.sideTab === tab);
  return (
    <Tooltip label={open ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} side="bottom">
      <button
        aria-label={open ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        onClick={() => useUI.getState().set(open ? { voiceChat: false } : { voiceChat: true, sideTab: tab })}
        className={clsx(
          'grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] transition-colors compact:h-9 compact:w-9',
          'relative',
          open ? 'bg-fill-3 text-fg' : 'text-fg-2 hover:bg-fill-2 hover:text-fg',
        )}
      >
        {children}
        {dot && !open && <span className="absolute right-[5px] top-[5px] h-2 w-2 rounded-full bg-accent shadow-[0_0_0_2px_var(--bg)]" />}
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
  const lobby = useUI((s) => s.lobby);
  const lobbyLayout = useUI((s) => s.lobbyLayout);
  const party = useParty((s) => s.parties[room.id]);
  const web = useWeb((s) => s.webs[room.id]);
  const webJoined = useWeb((s) => s.joined === room.id);
  const myPeer = voice.peerId;

  const camOf = (p: VoiceParticipant) => (p.peerId === myPeer ? localCam : remote[p.peerId]?.cam) ?? undefined;
  const screenOf = (p: VoiceParticipant) => (p.peerId === myPeer ? localScreen : remote[p.peerId]?.screen) ?? undefined;
  const speakingOf = (p: VoiceParticipant) => !!(p.peerId === myPeer ? speaking.self : speaking[p.peerId]);

  const tiles: Tile[] = [
    ...participants.filter((p) => p.screen).map((p) => ({ key: `${p.peerId}:screen`, kind: 'screen' as const, p })),
    // Shared music joins as its own tile, like a player in the room.
    ...participants.filter((p) => p.music).map((p) => ({ key: `${p.peerId}:music`, kind: 'music' as const, p })),
    ...participants.map((p) => ({ key: p.peerId, kind: 'user' as const, p })),
  ];
  // Meetings: the whiteboard, while it's open, is a tile of its own (shown big).
  const boardOpen = useMeetings((s) => channel.kind === 'meeting' && !!s.settings[channel.id]?.board);
  if (boardOpen && participants.length) tiles.unshift({ key: 'board', kind: 'board', p: participants[0] });
  const focused = focusedPeer ? participants.find((p) => p.peerId === focusedPeer && p.screen) : undefined;
  const drawOpen = useDraw((s) => s.open);
  // Meetings: the person you pinned, or else the one the host put in the spotlight, shows big.
  const pinnedUser = useMeetings((s) => (channel.kind === 'meeting' ? (s.pinned[channel.id] ?? null) : null));
  const spotlight = useMeetings((s) => (channel.kind === 'meeting' ? (s.settings[channel.id]?.spotlight ?? null) : null));
  const meetingPins = channel.kind === 'meeting' ? { pinned: pinnedUser, spotlight } : undefined;
  const meetingLayout = useSettings((s) => s.meetingLayout);
  const speakerPeer = useLastSpeaker(participants, speakingOf, myPeer);
  const featuredUser = [pinnedUser, spotlight].find((u) => u && participants.some((p) => p.userId === u));
  // Big, in order: someone pinned or spotlighted, the whiteboard, a screen being shared (not in
  // the grid layout), then in speaker view whoever spoke last.
  const presenting = participants.find((p) => p.screen);
  const featured =
    channel.kind !== 'meeting'
      ? undefined
      : featuredUser
        ? participants.find((p) => p.userId === featuredUser)?.peerId
        : boardOpen
          ? 'board'
          : presenting && meetingLayout !== 'grid'
            ? `${presenting.peerId}:screen`
            : meetingLayout === 'speaker'
              ? speakerPeer
              : undefined;
  // What you'd draw on: the screen you're watching, or what's big on the stage.
  const drawSurface =
    channel.kind !== 'meeting'
      ? null
      : focused
        ? `screen:${focused.peerId}`
        : featured === 'board'
          ? 'board'
          : featured?.endsWith(':screen')
            ? `screen:${featured.slice(0, -7)}`
            : null;
  const canDraw = useCanDraw(channel.id, drawSurface);
  useSharerOverlay(channel.id, channel.kind === 'meeting');
  const toolbar = drawOpen && drawSurface && canDraw ? <DrawToolbar channelId={channel.id} surface={drawSurface} /> : null;
  // The activity lobby fills the window (a watch party: the chooser, the movie, or a website).
  const lobbyOn = lobby === room.id && !focused;
  const watchingParty = !!party && lobbyOn;
  const watching = !!focused || lobbyOn;
  // The movie (and its controls) once it's on and this device watches along; the lobby before.
  const watchingAlong = useWatchingAlong(party);
  const webOn = !!web;
  // In the lobby, a website being watched together: watch along (it plays in the lobby's screen).
  useEffect(() => {
    if (lobbyOn && web && !webJoined) void joinWeb(room.id);
  }, [lobbyOn, web?.id, webJoined]); // eslint-disable-line react-hooks/exhaustive-deps
  // The player's code loads as soon as this room has a party, so it is ready before anyone opens it.
  useEffect(() => {
    if (party) void preloadParty();
  }, [party]);

  // When a friend starts sharing their screen, notify without hijacking everyone's view
  const sharers = participants.filter((p) => p.screen && p.peerId !== myPeer).map((p) => p.peerId);
  const prevSharers = useRef<string[]>([]);
  useEffect(() => {
    const fresh = sharers.find((id) => !prevSharers.current.includes(id));
    if (fresh) {
      const sharer = participants.find((p) => p.peerId === fresh);
      const name = sharer ? (users[sharer.userId]?.name ?? 'Someone') : 'Someone';
      toast({
        kind: 'info',
        title: `${name} is live`,
        body: 'Click their screen tile or LIVE badge to watch the stream.',
      });
    }
    prevSharers.current = sharers;
  }, [sharers.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drop watch mode only when the focused sharer actually stopped (not on a stale render).
  useEffect(() => {
    const fp = useUI.getState().focusedPeer;
    if (fp && !participants.some((p) => p.peerId === fp && p.screen)) useUI.getState().set({ focusedPeer: null });
  }, [participants]);

  useEffect(() => {
    if (!watching && useUI.getState().immersive) void setImmersive(false);
    // Watching opens the side panel (chat and people) next to the picture and folds the
    // channel list away; a button in the header brings it back.
    if (watching && !isCompactNow()) useUI.getState().set({ voiceChat: !lobbyOn || useUI.getState().lobbyLayout === 'theater', navCollapsed: true, sideTab: lobbyOn ? 'party' : useUI.getState().sideTab });
    if (!watching) useUI.getState().set({ navCollapsed: false });
  }, [watching]);
  useEffect(() => () => useUI.getState().set({ navCollapsed: false }), []);

  // Cinema behaviour: controls fade out after a moment of stillness. In the grid too while a
  // screen is shared, like Discord, so the buttons don't sit over the stream.
  const anyShare = participants.some((p) => p.screen);
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wake = () => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    // Never while the pointer rests on the controls or the call bar: they'd vanish under it, mid-click.
    const sleep = () => {
      if (document.querySelector('[data-keep-awake]:hover')) idleTimer.current = setTimeout(sleep, 1000);
      else setIdle(true);
    };
    if (watching || anyShare) idleTimer.current = setTimeout(sleep, 2800);
  };
  useEffect(() => {
    wake();
    return () => clearTimeout(idleTimer.current);
  }, [watching, anyShare, focused?.peerId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && useUI.getState().immersive) void setImmersive(false);
    };
    // The browser leaves full screen on its own (Esc): follow it.
    const onFullscreen = () => !document.fullscreenElement && useUI.getState().immersive && void setImmersive(false);
    // Escape or a double-click inside a website (it has the keys there).
    const offExit = isTauri
      ? listen<string>('browser:signal', (e) => (e.payload === 'exit' ? useUI.getState().immersive && void setImmersive(false) : toggleImmersive()))
      : null;
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreen);
      void offExit?.then((f) => f());
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
      if (lobbyOn) useUI.getState().set({ lobbyLayout: layout as 'cinema' | 'theater' | 'mini' });
      else useUI.getState().set({ watchLayout: layout === 'mini' ? 'mini' : 'theater' });
      if (useUI.getState().immersive) void setImmersive(false);
    };
    const exit = () => {
      if (focused) useUI.getState().set({ focusedPeer: null });
      else leaveLobby();
      if (useUI.getState().immersive) void setImmersive(false);
    };
    const layout: WatchLayout = immersive ? 'full' : lobbyOn ? lobbyLayout : watchLayout;
    return (
      // Touch has no hover: a tap brings the controls back.
      <div className="relative h-full min-h-0" onMouseMove={wake} onPointerDown={wake}>
        <WatchStage
          channel={channel}
          chatRoom={chatRoom}
          room={room}
          layout={layout}
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
          title={focused ? (focused.peerId === myPeer ? 'You’re sharing your screen' : `${sharerUser?.name ?? 'Someone'}’s screen`) : party ? party.file.name : web ? web.title : 'Watch party'}
          headerExtras={focused ? focused.peerId !== myPeer && focused.streams && <SharerVolume userId={focused.userId} /> : party ? <PartyHeaderInfo roomId={room.id} party={party} /> : web ? <WebFillToggle /> : undefined}
          media={
            focused ? (
              <ScreenMedia stream={screenOf(focused)} channelId={channel.kind === 'meeting' ? channel.id : undefined} surface={`screen:${focused.peerId}`} />
            ) : party ? (
              <PartyMedia roomId={room.id} party={party} chromeHidden={hideChrome} />
            ) : web ? (
              <WebStage roomId={room.id} visible />
            ) : (
              <LobbyChooser channel={channel} room={room} />
            )
          }
          controls={watchingParty && watchingAlong ? <PartyControls roomId={room.id} party={party} /> : undefined}
          overlay={
            <>
              {soundPrompt}
              {watchingParty && <PartyRequests roomId={room.id} />}
              {watchingParty && <PartyVotes roomId={room.id} />}
              {layout !== 'cinema' && <FloatingReactions />}
            </>
          }
          dock={(hidden) => (
            <>
              {toolbar}
              <Dock channel={channel} room={room} participants={participants} hidden={hidden && !toolbar} myPeer={myPeer} watching drawSurface={drawSurface} />
            </>
          )}
          leave={lobbyOn ? { label: 'Leave lobby', onClick: leaveLobby } : undefined}
          seats={
            lobbyOn
              ? (where) => (
                  <CinemaSeats
                    people={where === 'bottom' ? participants : participants.filter((_, i) => (where === 'left' ? i % 2 === 0 : i % 2 === 1))}
                    speakingOf={speakingOf}
                    myPeer={myPeer}
                    vertical={where !== 'bottom'}
                  />
                )
              : undefined
          }
          tallStage={watchingParty && !watchingAlong}
          exitLabel={lobbyOn ? 'Leave lobby' : 'Exit watch mode'}
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
      <div className="relative flex min-w-0 flex-1 flex-col" onMouseMove={wake} onPointerDown={wake}>
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
          {channel.kind === 'meeting' && <LayoutPicker />}
          <PanelToggle tab="people" label="People">
            <Users size={17} />
          </PanelToggle>
          <PanelToggle tab="chat" label="Chat">
            <MessageSquareText size={17} />
          </PanelToggle>
          {/* Server voice rooms that allow watch parties; the dot says one is on. */}
          {channel.kind === 'space' && (room.allowParty !== false || !!party) && (
            <PanelToggle tab="party" label="Watch party" dot={!!party || webOn}>
              <Popcorn size={17} />
            </PanelToggle>
          )}
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
            <Grid tiles={tiles} featured={featured} meeting={meetingPins} channelId={channel.id} users={users} camOf={camOf} screenOf={screenOf} speakingOf={speakingOf} myPeer={myPeer} />
          )}
          <FloatingReactions />
          {channel.kind === 'dm' && <CallStatus channel={channel} room={room} connected={status === 'connected'} me={participants.find((p) => p.peerId === myPeer)} alone={participants.length === 1} />}
        </div>

        {toolbar}
        <Dock channel={channel} room={room} participants={participants} hidden={anyShare && idle && !isCompactNow() && !toolbar} myPeer={myPeer} watching={false} drawSurface={drawSurface} />
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

/** Meetings: the person who spoke last (someone else when you're not alone), held a moment so the view doesn't flicker. */
function useLastSpeaker(participants: VoiceParticipant[], speakingOf: (p: VoiceParticipant) => boolean, myPeer: string | null) {
  const last = useRef<string | undefined>(undefined);
  const since = useRef(0);
  const others = participants.filter((p) => p.peerId !== myPeer);
  const talking = others.find(speakingOf);
  const now = Date.now();
  // Switch only after the current speaker has had the stage for a second and a half.
  if (talking && talking.peerId !== last.current && now - since.current > 1500) {
    last.current = talking.peerId;
    since.current = now;
  }
  if (last.current && !participants.some((p) => p.peerId === last.current)) last.current = undefined;
  return last.current ?? others[0]?.peerId;
}

const LAYOUTS: { value: 'auto' | 'grid' | 'speaker'; label: string; detail: string; icon: ReactNode }[] = [
  { value: 'auto', label: 'Auto', detail: 'A grid, with anyone pinned or spotlighted big', icon: <Sparkles size={15} /> },
  { value: 'grid', label: 'Grid', detail: 'Everyone the same size', icon: <LayoutGrid size={15} /> },
  { value: 'speaker', label: 'Speaker', detail: 'Whoever’s talking or presenting, big', icon: <RectangleHorizontal size={15} /> },
];

/** Meetings: how the call is laid out (remembered on this device). */
function LayoutPicker() {
  const layout = useSettings((s) => s.meetingLayout);
  const [menu, setMenu] = useState<Anchor | null>(null);
  const current = LAYOUTS.find((l) => l.value === layout) ?? LAYOUTS[0];
  return (
    <>
      <Tooltip label="Change layout" side="bottom">
        <button
          aria-label="Change layout"
          onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}
          className={clsx('grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full text-fg-2 transition-colors hover:bg-fill-2 hover:text-fg compact:h-9 compact:w-9', menu && 'bg-fill-2 text-fg')}
        >
          {current.value === 'speaker' ? <RectangleHorizontal size={17} /> : <LayoutGrid size={17} />}
        </button>
      </Tooltip>
      <Popover open={!!menu} anchor={menu} onClose={() => setMenu(null)} side="bottom" align="end" offset={8} className="w-[260px] p-1.5">
        <div className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-fg-3">Layout</div>
        {LAYOUTS.map((l) => (
          <button
            key={l.value}
            onClick={() => (useSettings.getState().set({ meetingLayout: l.value }), setMenu(null))}
            className={clsx('flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left transition-colors', layout === l.value ? 'bg-accent/12' : 'hover:bg-fill-2')}
          >
            <span className={clsx('grid h-7 w-7 shrink-0 place-items-center rounded-full', layout === l.value ? 'bg-accent text-white' : 'bg-fill-2 text-fg-2')}>{l.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium">{l.label}</span>
              <span className="block text-[11.5px] leading-snug text-fg-3">{l.detail}</span>
            </span>
            {layout === l.value && <Check size={14} className="shrink-0 text-accent" />}
          </button>
        ))}
      </Popover>
    </>
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
  /** Meetings: who you pinned and who the host spotlighted (user ids). */
  meeting?: { pinned: string | null; spotlight: string | null };
}

/** The biggest width a 16:9 (or `aspect`) tile can have in a w×h box. */
const fit = (w: number, h: number, aspect: number) => Math.max(0, Math.floor(Math.min(w, h * aspect)));

function Grid({ tiles, screenOf, featured, ...rest }: StreamProps & { tiles: Tile[]; featured?: string; screenOf: (p: VoiceParticipant) => MediaStream | undefined }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(ref);
  const compact = useCompact();
  const gap = compact ? 8 : 12;
  // A phone held upright fills its screen better with square tiles than with wide ones.
  const aspect = compact && h > w * 1.15 ? 1 : 16 / 9;
  const big = featured && tiles.length > 1 ? tiles.find((t) => t.key === featured) : undefined;
  const render = (t: Tile, width: number, height: number, isBig = false) =>
    t.kind === 'board' ? (
      <BoardTile key={t.key} channelId={rest.channelId} width={width} height={height} big={isBig} />
    ) : t.kind === 'music' ? (
      <MusicTile key={t.key} p={t.p} mine={t.p.peerId === rest.myPeer} width={width} height={height} />
    ) : (
      <TileView key={t.key} tile={t} width={width} height={height} big={isBig} stream={t.kind === 'screen' ? screenOf(t.p) : rest.camOf(t.p)} {...rest} />
    );

  // Pinned or spotlighted: that person fills the stage, everyone else in a strip beside it
  // (below it on a tall screen).
  if (big) {
    const others = tiles.filter((t) => t !== big);
    const side = w > h * 1.05;
    const stripW = side ? Math.round(Math.min(260, Math.max(150, w * 0.2))) : w;
    const stripH = side ? h : Math.round(Math.min(150, Math.max(84, h * 0.22)));
    const small = side ? stripW : Math.round(fit(Math.max(0, w), stripH, aspect));
    const mainW = fit(side ? w - stripW - gap : w, side ? h : h - stripH - gap, aspect);
    return (
      <div className="absolute inset-0 px-6 pb-[100px] pt-4 compact:px-2.5 compact:pb-[84px] compact:pt-2.5">
        <div ref={ref} className={clsx('flex h-full w-full', side ? 'flex-row' : 'flex-col')} style={{ gap }}>
          <LayoutGroup>
            <div className="grid min-h-0 min-w-0 flex-1 place-items-center">
              <AnimatePresence mode="popLayout" initial={false}>
                {w > 0 && render(big, mainW, Math.round(mainW / aspect), true)}
              </AnimatePresence>
            </div>
            <div
              className={clsx('flex shrink-0 items-center [scrollbar-width:none]', side ? 'flex-col justify-center-safe overflow-y-auto' : 'flex-row justify-center-safe overflow-x-auto')}
              style={{ gap, width: side ? stripW : undefined, height: side ? undefined : stripH }}
            >
              <AnimatePresence mode="popLayout" initial={false}>
                {w > 0 && others.map((t) => render(t, small, Math.round(small / aspect)))}
              </AnimatePresence>
            </div>
          </LayoutGroup>
        </div>
      </div>
    );
  }

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
          {/* popLayout: a card that leaves steps out of the layout at once, so the others glide into place
              while it fades (instead of holding its slot, then everyone snapping). */}
          <AnimatePresence mode="popLayout" initial={false}>
            {w > 0 && tiles.map((t) => render(t, tileW, Math.round(tileW / aspect)))}
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
  meeting,
  big,
  ref,
}: StreamProps & { tile: Tile; width: number; height: number; big?: boolean; stream?: MediaStream; ref?: React.Ref<HTMLDivElement> }) {
  const { p, kind } = tile;
  const pinned = !!meeting && meeting.pinned === p.userId;
  const spotlit = !!meeting && meeting.spotlight === p.userId;
  const user = users[p.userId];
  const isMe = p.peerId === myPeer;
  const speaking = kind === 'user' && speakingOf(p);
  const avatarSize = Math.round(Math.min(104, height * 0.42, width * 0.42));
  // Someone else's screen stays a dark card until you click Watch, like Discord; then you see and hear it.
  const watched = useUI((s) => s.watching.includes(p.peerId));
  const preview = kind === 'screen' && !isMe && !watched;
  const watch = () => useUI.getState().set({ watching: [...useUI.getState().watching.filter((w) => w !== p.peerId), p.peerId] });

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={spring}
      onClick={() => kind === 'screen' && (preview ? watch() : useUI.getState().set({ focusedPeer: p.peerId }))}
      onDoubleClick={() => kind === 'screen' && useUI.getState().set({ focusedPeer: p.peerId })}
      onContextMenu={(e) => openMenu(e, channelId, p)}
      className={clsx('group relative overflow-hidden rounded-[22px] glass-tile', kind === 'screen' && 'cursor-pointer')}
      style={{ width, height }}
    >
      {preview ? (
        <div className="relative grid h-full place-items-center bg-[#0e0f13]">
          <div className="absolute inset-0 opacity-[0.16]" style={{ background: gradientFor(p.userId) }} />
          <div className="relative flex flex-col items-center gap-3 px-4 text-center text-white">
            <Avatar user={user} size={Math.round(Math.min(64, height * 0.24))} />
            <div className="text-[13.5px] font-medium text-white/80">{user?.name ?? 'Someone'} is sharing their screen</div>
            <span className="flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-semibold text-black shadow-lg transition-transform group-hover:scale-105">
              <MonitorPlay size={15} /> Watch Stream
            </span>
          </div>
        </div>
      ) : kind === 'screen' ? (
        stream ? (
          <>
            <StreamVideo stream={stream} contain className="bg-black" />
            {meeting && <DrawLayer channelId={channelId} surface={`screen:${p.peerId}`} aspect={streamAspect(stream)} interactive={big} />}
          </>
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

      {kind === 'screen' && !preview && <span className="absolute left-3 top-3 rounded-[6px] bg-danger px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white">LIVE</span>}
      {kind === 'user' && (spotlit || pinned) && (
        <span className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-white glass-ink">
          <Pin size={11} className={clsx(spotlit && 'text-accent')} /> {spotlit ? 'Spotlight' : 'Pinned'}
        </span>
      )}

      <div className="absolute bottom-2.5 left-2.5 flex max-w-[calc(100%-20px)] items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium text-white glass-ink">
        {kind === 'screen' && <MonitorPlay size={12} />}
        <span className="truncate">
          {kind === 'user' && p.hand && <span className="emoji" aria-label="Hand raised">✋</span>}
          {kind === 'screen' ? `${isMe ? 'Your' : `${user?.name ?? 'Someone'}’s`} screen` : `${user?.name ?? 'Someone'}${isMe ? ' (you)' : ''}`}
        </span>
        {/* Sound comes from the sharer's side: say so when there is none, instead of leaving people guessing. */}
        {kind === 'screen' && stream && !stream.getAudioTracks().some((t) => t.readyState === 'live') && (
          <span title={isMe ? 'You’re sharing without sound' : 'Shared without sound'} className="flex items-center gap-1 text-white/80">
            <VolumeX size={12} /> No sound
          </span>
        )}
        {kind === 'user' && p.screen && !isMe && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              useUI.getState().set({ focusedPeer: p.peerId });
            }}
            className="flex items-center gap-1 rounded bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white transition-transform hover:scale-105 active:scale-95"
          >
            <MonitorPlay size={10} /> Watch
          </button>
        )}
        {kind === 'user' && <ParticipantIcons p={p} size={12} />}
      </div>

      <div className="absolute right-2.5 top-2.5 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 touch:opacity-100">
        {kind === 'screen' && !preview && !isMe && (
          <Tooltip label="Stop watching">
            <button
              aria-label="Stop watching"
              onClick={(e) => {
                e.stopPropagation();
                useUI.getState().set({ watching: useUI.getState().watching.filter((w) => w !== p.peerId) });
              }}
              className="grid h-8 w-8 place-items-center rounded-full text-white glass-ink hover:bg-black/60"
            >
              <EyeOff size={15} />
            </button>
          </Tooltip>
        )}
        {meeting && kind === 'user' && (
          <Tooltip label={pinned ? 'Unpin' : 'Pin for me'}>
            <button
              aria-label={pinned ? 'Unpin' : 'Pin for me'}
              onClick={(e) => {
                e.stopPropagation();
                useMeetings.getState().pin(channelId, pinned ? null : p.userId);
              }}
              className="grid h-8 w-8 place-items-center rounded-full text-white glass-ink hover:bg-black/60"
            >
              {pinned ? <PinOff size={15} /> : <Pin size={15} />}
            </button>
          </Tooltip>
        )}
        {!isMe && (
          <button aria-label="Options" onClick={(e) => openMenu(e, channelId, p)} className="grid h-8 w-8 place-items-center rounded-full text-white glass-ink hover:bg-black/60">
            <Ellipsis size={15} />
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─── Watching a shared screen ────────────────────────────────────────────────

/** A video's picture shape (width / height), from its track; 16:9 until it's known. */
function streamAspect(stream?: MediaStream) {
  const s = stream?.getVideoTracks()[0]?.getSettings();
  return s?.width && s?.height ? s.width / s.height : 16 / 9;
}

function ScreenMedia({ stream, channelId, surface }: { stream?: MediaStream; channelId?: string; surface?: string }) {
  // The picture's shape can change (a shared window resized): checked now and then.
  const [aspect, setAspect] = useState(() => streamAspect(stream));
  useEffect(() => {
    const t = setInterval(() => setAspect(streamAspect(stream)), 1000);
    return () => clearInterval(t);
  }, [stream]);
  return (
    <div className="absolute inset-0">
      {stream ? (
        <>
          <StreamVideo stream={stream} contain stage />
          {channelId && surface && <DrawLayer channelId={channelId} surface={surface} aspect={aspect} interactive />}
        </>
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
  drawSurface,
}: {
  channel: Channel;
  room: Room;
  participants: VoiceParticipant[];
  hidden: boolean;
  myPeer: string | null;
  watching: boolean;
  /** Meetings: what the drawing tools would draw on, if anything. */
  drawSurface?: string | null;
}) {
  const muted = useVoice((s) => s.muted);
  const deafened = useVoice((s) => s.deafened);
  const serverMuted = useVoice((s) => s.serverMuted);
  const muteLeft = useSecondsLeft(usePenalties((s) => s[channel.id]?.voiceUntil));
  const camera = useVoice((s) => s.camera);
  const screen = useVoice((s) => s.screen);
  const roomMuted = useChannels((s) => s.voice[channel.id]?.mutedRooms.includes(room.id) ?? false);
  const focusedPeer = useUI((s) => s.focusedPeer);
  const voiceChat = useUI((s) => s.voiceChat);
  const inLobby = useUI((s) => s.lobby === room.id);
  const lobbyHere = useHasLobby(room.id);
  const me = useAuth((s) => s.me);
  const compact = useCompact();
  const [shareMenu, setShareMenu] = useState<Anchor | null>(null);
  const [moreMenu, setMoreMenu] = useState<Anchor | null>(null);
  const [soundMenu, setSoundMenu] = useState<Anchor | null>(null);
  const hand = useVoice((s) => s.hand);
  const music = useVoice((s) => s.music);
  const soundboard = useFeatureOn('soundboard');
  const noiseOn = useSettings((s) => s.noiseFilter !== 'off');
  const toggleNoise = () => useSettings.getState().set({ noiseFilter: noiseOn ? 'off' : 'strong' });
  const isAdmin = channel.role !== 'member';
  // Personal calls stay clean; server rooms are the fun ones; meetings are polite, with a hand.
  const meeting = channel.kind === 'meeting';
  // Meetings: what the host turned off for everyone (the host and co-hosts are never held back).
  const camHeld = useHeldBack(channel.id, 'camera');
  const shareHeld = useHeldBack(channel.id, 'share');
  const micHeld = useHeldBack(channel.id, 'mic');
  const funHeld = useHeldBack(channel.id, 'reactions');
  const [hostMenu, setHostMenu] = useState<Anchor | null>(null);
  // Meetings: drawing (on the whiteboard or a shared screen) and the whiteboard itself.
  const canDraw = useCanDraw(channel.id, drawSurface);
  const canPresent = useCanPresent(channel.id) && meeting;
  const boardOpen = useMeetings((s) => !!s.settings[channel.id]?.board);
  const drawOpen = useDraw((s) => s.open);
  const toggleDraw = () => useDraw.getState().set({ open: !drawOpen, ...(drawOpen ? {} : { tool: useDraw.getState().tool === 'pointer' ? 'pen' : useDraw.getState().tool }) });
  const toggleCamera = () => (camHeld && !camera ? toast({ kind: 'info', title: HELD_BACK_NOTE.camera }) : void voice.toggleCamera());
  const toggleShare = () => (screen ? voice.stopScreen() : shareHeld ? toast({ kind: 'info', title: HELD_BACK_NOTE.share }) : void voice.startScreen());
  const micLabel = muteLeft ? `Muted by a rule for ${clock(muteLeft)}` : serverMuted ? (micHeld ? HELD_BACK_NOTE.mic : meeting ? 'The host muted you' : 'Muted by an admin') : muted || deafened ? 'Unmute' : 'Mute';
  const fun = channel.kind !== 'dm' && !funHeld;
  const funLabel = meeting ? 'Reactions and applause' : 'Reactions, sounds and music';
  const sharer = participants.find((p) => p.screen && p.peerId !== myPeer) ?? participants.find((p) => p.screen);
  const micOff = muted || deafened || serverMuted;
  const toggleRoomMute = () => getHub(channel.id)?.send({ t: 'voice.roomMute', roomId: room.id, muted: !roomMuted });
  const toggleWatch = () => sharer && useUI.getState().set({ focusedPeer: focusedPeer ? null : sharer.peerId });
  // A watch party is planned from the chat; here you only go back to (or away from) one that's on.
  const showPopcorn = channel.kind === 'space' && (room.allowParty !== false || lobbyHere);
  // In the lobby, the fun things open in the side panel, beside the screen (nothing may cover a website).
  const funTabOpen = useUI((s) => inLobby && s.voiceChat && s.sideTab === 'fun');
  const openFunTab = () => useUI.getState().set(funTabOpen ? { voiceChat: false } : { voiceChat: true, sideTab: 'fun' });
  const partyLabel = inLobby ? 'Leave the lobby' : lobbyHere ? 'Join the watch party lobby' : 'Start a watch party';
  const togglePartyView = () => (inLobby ? leaveLobby() : lobbyHere ? void joinLobby(channel.id, room.id) : startLobby(room.id));

  if (compact)
    return (
      <motion.div
        data-keep-awake
        data-avoid-web
        animate={{ opacity: hidden ? 0 : 1, y: hidden ? 18 : 0 }}
        transition={spring}
        style={{ pointerEvents: hidden ? 'none' : 'auto' }}
        className="absolute bottom-2.5 left-1/2 z-30 flex max-w-[calc(100%-20px)] -translate-x-1/2 items-center gap-1.5 rounded-[24px] p-1.5 glass-float"
      >
        <SoundBursts />
        <DockButton label={micLabel} state={micOff ? 'off' : 'normal'} onClick={() => void voice.toggleMute()}>
          {muteLeft ? <span className="text-[12px] font-semibold tabular-nums">{clock(muteLeft)}</span> : micOff ? <MicOff size={20} /> : <Mic size={20} />}
        </DockButton>
        <DockButton label={camera ? 'Turn camera off' : 'Turn camera on'} state={camera ? 'on' : 'normal'} onClick={toggleCamera}>
          {camera ? <Video size={20} /> : <VideoOff size={20} />}
        </DockButton>
        {canShareScreen && (
          <DockButton label={screen ? 'Stop sharing' : 'Share your screen'} state={screen ? 'on' : 'normal'} onClick={toggleShare}>
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
          <MenuItem icon={<AudioWaveform size={15} />} onClick={() => (setMoreMenu(null), toggleNoise())}>
            {noiseOn ? 'Turn off noise suppression' : 'Turn on noise suppression'}
          </MenuItem>
          {meeting && (
            <MenuItem icon={<Hand size={15} />} onClick={() => (setMoreMenu(null), voice.toggleHand())}>
              {hand ? 'Lower your hand' : 'Raise your hand'}
            </MenuItem>
          )}
          {canPresent && (
            <MenuItem icon={<Presentation size={15} />} onClick={() => (setMoreMenu(null), toggleBoard(channel.id, !boardOpen))}>
              {boardOpen ? 'Close the whiteboard' : 'Open a whiteboard'}
            </MenuItem>
          )}
          {canDraw && (
            <MenuItem icon={<PenLine size={15} />} onClick={() => (setMoreMenu(null), toggleDraw())}>
              {drawOpen ? 'Hide the drawing tools' : 'Draw and mark up'}
            </MenuItem>
          )}
          {fun && (
            <MenuItem icon={<SmilePlus size={15} />} onClick={() => (inLobby ? openFunTab() : setSoundMenu(moreMenu), setMoreMenu(null))}>
              {funLabel}
            </MenuItem>
          )}
          {sharer && (
            <MenuItem icon={<Clapperboard size={15} />} onClick={() => (setMoreMenu(null), toggleWatch())}>
              {focusedPeer ? 'Exit watch mode' : 'Watch together'}
            </MenuItem>
          )}
          {showPopcorn && (
            <MenuItem icon={<Popcorn size={15} />} onClick={() => (setMoreMenu(null), togglePartyView())}>
              {partyLabel}
            </MenuItem>
          )}
          {isAdmin && (
            <>
              <MenuSeparator />
              {meeting ? (
                <MenuItem icon={<ShieldCheck size={15} />} onClick={() => (setHostMenu(moreMenu), setMoreMenu(null))}>
                  Host controls
                </MenuItem>
              ) : (
                <MenuItem icon={<Users size={15} />} onClick={() => (setMoreMenu(null), toggleRoomMute())}>
                  {roomMuted ? 'Unmute everyone' : 'Mute everyone'}
                </MenuItem>
              )}
            </>
          )}
        </Popover>
        <Popover open={!!hostMenu} anchor={hostMenu} onClose={() => setHostMenu(null)} side="top" align="end" offset={12} className="rounded-[18px]!">
          <HostControls channelId={channel.id} participants={participants} myPeer={myPeer} onDone={() => setHostMenu(null)} />
        </Popover>
        <Popover open={!!soundMenu} anchor={soundMenu} onClose={() => setSoundMenu(null)} side="top" align="end" offset={12} material="float">
          <FunPanel meeting={meeting} sounds={soundboard} music={false} onDone={() => setSoundMenu(null)} />
        </Popover>
      </motion.div>
    );

  return (
    <motion.div
      data-keep-awake
      data-avoid-web
      animate={{ opacity: hidden ? 0 : 1, y: hidden ? 18 : 0 }}
      transition={spring}
      style={{ pointerEvents: hidden ? 'none' : 'auto' }}
      className="absolute bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-[26px] p-2 glass-float"
    >
      <SoundBursts />
      <DockButton label={micLabel} state={micOff ? 'off' : 'normal'} onClick={() => void voice.toggleMute()}>
        {muteLeft ? <span className="text-[12px] font-semibold tabular-nums">{clock(muteLeft)}</span> : micOff ? <MicOff size={19} /> : <Mic size={19} />}
      </DockButton>
      <DockButton label={deafened ? 'Undeafen' : 'Deafen'} state={deafened ? 'off' : 'normal'} onClick={() => voice.toggleDeafen()}>
        {deafened ? <HeadphoneOff size={19} /> : <Headphones size={19} />}
      </DockButton>
      <Divider />
      <DockButton label={camera ? 'Turn camera off' : 'Turn camera on'} state={camera ? 'on' : 'normal'} onClick={toggleCamera}>
        {camera ? <Video size={19} /> : <VideoOff size={19} />}
      </DockButton>
      <div className="flex items-center">
        <DockButton label={screen ? 'Stop sharing' : 'Share your screen'} state={screen ? 'on' : 'normal'} onClick={toggleShare} className="rounded-r-[6px]!">
          {screen ? <ScreenShareOff size={19} /> : <ScreenShare size={19} />}
        </DockButton>
        <Tooltip label="Screen share options">
          <button
            onClick={(e) => setShareMenu(e.currentTarget.getBoundingClientRect())}
            className="glass-key ml-px grid h-11 w-6 place-items-center rounded-l-[6px] rounded-r-[14px] text-fg-2 transition-colors hover:text-fg"
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
      {showPopcorn && (
        <DockButton label={partyLabel} state={inLobby ? 'on' : 'normal'} onClick={togglePartyView}>
          <span className="relative">
            <Popcorn size={19} />
            {lobbyHere && !inLobby && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent shadow-[0_0_0_2px_var(--bg)]" />}
          </span>
        </DockButton>
      )}
      {meeting && (
        <DockButton label={hand ? 'Lower your hand' : 'Raise your hand'} state={hand ? 'on' : 'normal'} onClick={() => voice.toggleHand()}>
          <Hand size={19} />
        </DockButton>
      )}
      {canPresent && (
        <DockButton label={boardOpen ? 'Close the whiteboard' : 'Open a whiteboard'} state={boardOpen ? 'on' : 'normal'} onClick={() => toggleBoard(channel.id, !boardOpen)}>
          <Presentation size={19} />
        </DockButton>
      )}
      {canDraw && (
        <DockButton label={drawOpen ? 'Hide the drawing tools' : 'Draw and mark up'} state={drawOpen ? 'on' : 'normal'} onClick={toggleDraw}>
          <PenLine size={19} />
        </DockButton>
      )}
      {fun && (
        <DockButton label={funLabel} state={soundMenu || music || funTabOpen ? 'on' : 'normal'} onClick={(el) => (inLobby ? openFunTab() : setSoundMenu(el.getBoundingClientRect()))}>
          <SmilePlus size={19} />
        </DockButton>
      )}
      {isAdmin && meeting && (
        <DockButton label="Host controls" state={hostMenu ? 'on' : 'normal'} onClick={(el) => setHostMenu(el.getBoundingClientRect())}>
          <ShieldCheck size={19} />
        </DockButton>
      )}
      {isAdmin && !meeting && (
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
          className="grid h-11 w-[54px] place-items-center rounded-[14px] bg-danger text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_14px_-4px_var(--danger)] hover:brightness-110"
        >
          <PhoneOff size={19} />
        </motion.button>
      </Tooltip>

      <Popover open={!!soundMenu} anchor={soundMenu} onClose={() => setSoundMenu(null)} side="top" align="center" offset={14} material="float">
        <FunPanel
          meeting={meeting}
          sounds={soundboard}
          music={canShareMusic && isAdmin}
          busy={participants.find((p) => p.music && p.peerId !== myPeer)?.userId}
          onDone={() => setSoundMenu(null)}
        />
      </Popover>
      <Popover open={!!hostMenu} anchor={hostMenu} onClose={() => setHostMenu(null)} side="top" align="center" offset={14} className="rounded-[18px]!">
        <HostControls channelId={channel.id} participants={participants} myPeer={myPeer} onDone={() => setHostMenu(null)} />
      </Popover>
      <Popover open={!!shareMenu} anchor={shareMenu} onClose={() => setShareMenu(null)} side="top" align="center" offset={14} material="float">
        <ShareOptions
          sharing={screen}
          onStart={() => {
            setShareMenu(null);
            toggleShare();
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
          state === 'normal' && 'glass-key text-fg',
          state === 'on' && 'bg-accent text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_4px_14px_-4px_var(--accent)]',
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
