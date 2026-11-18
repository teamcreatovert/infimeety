import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { Armchair, ArrowLeft, Columns3, Rows3, AudioLines, Expand, Minimize2, MessageSquareText, PanelLeft, PanelRight, PictureInPicture2, Popcorn, RectangleHorizontal, Shrink, Users, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Channel, PublicUser, Room, VoiceParticipant } from '../../../../shared/protocol';
import { ChatView } from '../chat/ChatView';
import { PartyPanel } from './PartyLazy';
import { ParticipantIcons } from '../shell/Sidebar';
import { Avatar } from '../ui/Avatar';
import { Tooltip } from '../ui/overlay';
import { StreamVideo } from './StreamVideo';
import { spring } from '@/lib/motion';
import { useSettings } from '@/stores/settings';
import { useParty } from '@/lib/party';
import { useCompact } from '@/lib/responsive';
import { useMessages } from '@/stores/messages';
import { openUserMenu, useUI } from '@/stores/ui';

/**
 * Watch mode, for a shared screen or a watch party. Friends live in a side panel (Chat |
 * People) instead of bubbles floating over the movie. Three layouts:
 * - Theater: the picture, with the panel beside it.
 * - Mini: the picture, everyone's faces in a row under it, and the chat beside.
 * - Full screen: just the picture; who's talking shows top right, chat opens from a
 *   button bottom right.
 * Phones stack the picture over the panel (or go full screen when held sideways).
 */

export type WatchLayout = 'cinema' | 'theater' | 'mini' | 'full';

export interface WatchPeople {
  people: VoiceParticipant[];
  users: Record<string, PublicUser>;
  camOf: (p: VoiceParticipant) => MediaStream | undefined;
  speakingOf: (p: VoiceParticipant) => boolean;
  myPeer: string | null;
  /** Per person: a watch party's status and role controls. */
  extra?: (p: VoiceParticipant) => ReactNode;
}

interface Props extends WatchPeople {
  channel: Channel;
  chatRoom: Room;
  /** The call's voice room (for the side panel's Watch party tab). */
  room?: Room;
  layout: WatchLayout;
  onLayout: (layout: WatchLayout) => void;
  /** Chrome hidden while nobody moves (cinema behaviour). */
  idle: boolean;
  badge: ReactNode;
  title: string;
  headerExtras?: ReactNode;
  media: ReactNode;
  controls?: ReactNode;
  overlay?: ReactNode;
  /** The call's controls, hidden or not (they sit over the picture except on upright phones). */
  dock: (hidden: boolean) => ReactNode;
  exitLabel: string;
  onExit: () => void;
  /** Phones: the stage holds more than a picture (a watch party's lobby), so give it more room. */
  tallStage?: boolean;
  /** A lobby: its Leave button sits at the top left, and Cinema is offered with its seats. */
  leave?: { label: string; onClick: () => void };
  /** Cinema's seats, for where they go: along the bottom, or a column on each side. */
  seats?: (where: 'bottom' | 'left' | 'right') => ReactNode;
}

export function WatchStage(props: Props) {
  const { layout, idle, media, controls, overlay, dock } = props;
  const compact = useCompact();
  const panel = useUI((s) => s.voiceChat);
  const [landscape, setLandscape] = useState(() => window.innerWidth > window.innerHeight);
  useEffect(() => {
    const on = () => setLandscape(window.innerWidth > window.innerHeight);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  // A phone held sideways watches full screen.
  const effective: WatchLayout = compact && landscape ? 'full' : layout;
  // Phones held upright keep the call's controls under the picture, not over it.
  const floatingDock = !compact || effective === 'full';
  // Full screen keeps the call's controls tucked away until the pointer nears the bottom edge
  // (or, on touch, until a tap wakes the controls).
  const [nearBottom, setNearBottom] = useState(false);
  const [touched, setTouched] = useState(false);
  const full = effective === 'full';
  const dockHidden = full ? !(nearBottom || (touched && !idle)) : floatingDock && idle;
  // The room the movie's controls leave for the call's bar. It stays the same while the bar hides
  // and comes back (full screen shows it near the bottom): the controls never jump under the mouse.
  const dockSpace = !floatingDock ? '0px' : compact ? '72px' : '88px';

  // A flat bar above the picture, like a desktop app's; full screen and phones keep it over the picture.
  const solid = !compact && !full;
  useEffect(() => {
    useUI.getState().set({ darkChrome: true });
    return () => useUI.getState().set({ darkChrome: false });
  }, []);

  const stage = (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--stage)]"
      style={{ cursor: idle && !nearBottom ? 'none' : undefined, ['--dock-space' as string]: dockSpace }}
      onPointerMove={(e) => {
        setTouched(e.pointerType === 'touch');
        const r = e.currentTarget.getBoundingClientRect();
        setNearBottom(e.pointerType !== 'touch' && r.bottom - e.clientY < 110);
      }}
      onPointerDown={(e) => setTouched(e.pointerType === 'touch')}
      onPointerLeave={() => setNearBottom(false)}
    >
      {solid && <Header {...props} effective={effective} solid />}
      <div className="relative min-h-0 flex-1">
        {effective === 'cinema' ? <Cinema media={media} controls={controls} seats={props.seats} idle={idle} rows={props.people.length > 1 ? 2 : 1} /> : media}
        {!solid && <Header {...props} effective={effective} />}
        {overlay}
        {effective !== 'cinema' && controls && <Chrome idle={idle}>{controls}</Chrome>}
        {effective === 'full' && <Talking {...props} />}
        {effective === 'full' && <ChatBubble channel={props.channel} room={props.chatRoom} idle={idle} lifted={!!controls && dockHidden} />}
        {floatingDock && dock(dockHidden)}
      </div>
    </div>
  );

  // One tree for every layout, so switching layouts never reloads the picture.
  const phone = !floatingDock;
  return (
    <div className={clsx('flex h-full min-h-0', phone && 'flex-col bg-[var(--bg)]')}>
      <div className={clsx('relative flex min-w-0', phone ? (props.tallStage ? 'h-[62vh] w-full shrink-0' : 'aspect-video max-h-[46vh] w-full shrink-0') : 'min-h-0 flex-1 flex-col')}>
        {stage}
        {effective === 'mini' && <Strip {...props} />}
      </div>
      {phone && <div className="relative h-[72px] shrink-0">{dock(false)}</div>}
      {phone && <Panel {...props} tabs className="min-h-0 flex-1 hairline-t" />}
      {!phone && effective === 'mini' && <Panel {...props} tabs={false} className="w-[340px] shrink-0 hairline-l" />}
      <AnimatePresence initial={false}>
        {!phone && (effective === 'theater' || effective === 'cinema') && panel && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 340, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 40 }}
            className="shrink-0 overflow-hidden hairline-l"
          >
            <Panel {...props} tabs className="h-full w-[340px]" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Fades out with the rest of the chrome while nobody moves. */
function Chrome({ idle, children }: { idle: boolean; children: ReactNode }) {
  return (
    <motion.div data-keep-awake animate={{ opacity: idle ? 0 : 1 }} transition={{ duration: 0.25 }} style={{ pointerEvents: idle ? 'none' : 'auto' }}>
      {children}
    </motion.div>
  );
}

function Header({ badge, title, headerExtras, layout, effective, onLayout, idle, exitLabel, onExit, channel, room, solid, leave, seats }: Props & { effective: WatchLayout; solid?: boolean }) {
  const compact = useCompact();
  const panel = useUI((s) => s.voiceChat);
  const navCollapsed = useUI((s) => s.navCollapsed);
  const hidden = idle && !solid;
  return (
    <motion.header
      data-tauri-drag-region
      animate={{ opacity: hidden ? 0 : 1, y: hidden ? -8 : 0 }}
      transition={spring}
      className={clsx(
        'z-30 flex items-center text-white',
        solid
          ? 'relative h-[48px] shrink-0 gap-2 border-b border-white/[0.06] px-3'
          : 'absolute inset-x-0 top-0 h-[56px] gap-2.5 bg-gradient-to-b from-black/75 to-transparent px-4 compact:h-[48px] compact:gap-2 compact:px-2.5',
      )}
      style={{ pointerEvents: hidden ? 'none' : 'auto' }}
    >
      {leave && (
        <button
          onClick={leave.onClick}
          className={clsx('flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] pl-2 pr-3 text-[12.5px] font-semibold transition-colors', solid ? 'bg-white/[0.08] text-white hover:bg-white/[0.14]' : 'glass-ink hover:bg-white/15!')}
        >
          <ArrowLeft size={15} /> {leave.label}
        </button>
      )}
      {!leave && !compact && effective !== 'full' && (
        <HeadButton flat={solid} label={navCollapsed ? 'Show channels' : 'Hide channels'} active={!navCollapsed} onClick={() => useUI.getState().set({ navCollapsed: !navCollapsed })}>
          <PanelLeft size={16} />
        </HeadButton>
      )}
      {/* Where this is: the voice room, then what's on (like a desktop app's title). */}
      {channel.kind === 'space' && room && !compact && (
        <span data-tauri-drag-region className="flex shrink-0 items-center gap-1.5 text-[13.5px] font-semibold text-white/60">
          <AudioLines size={15} className="text-success" />
          {room.name}
          <span className="text-white/25">·</span>
        </span>
      )}
      {badge}
      <span data-tauri-drag-region className="min-w-0 truncate text-[13.5px] font-semibold">
        {title}
      </span>
      {headerExtras}
      <div data-tauri-drag-region className="flex-1 self-stretch" />
      {!compact && (
        <div className={clsx('flex items-center gap-0.5 p-0.5', solid ? 'rounded-[10px] bg-white/[0.06]' : 'rounded-full glass-ink')}>
          {seats !== undefined && (
            <LayoutButton flat={solid} label="Cinema: a big screen and everyone in their seats" active={layout === 'cinema'} onClick={() => onLayout('cinema')}>
              <Armchair size={15} />
            </LayoutButton>
          )}
          {seats !== undefined && layout === 'cinema' && <SeatsToggle flat={solid} />}
          <LayoutButton flat={solid} label="Theater: picture and side panel" active={layout === 'theater'} onClick={() => onLayout('theater')}>
            <RectangleHorizontal size={15} />
          </LayoutButton>
          <LayoutButton flat={solid} label="Mini: picture, faces and chat" active={layout === 'mini'} onClick={() => onLayout('mini')}>
            <PictureInPicture2 size={15} />
          </LayoutButton>
          <LayoutButton flat={solid} label={layout === 'full' ? 'Exit full screen' : 'Full screen'} active={layout === 'full'} onClick={() => onLayout(layout === 'full' ? 'theater' : 'full')}>
            {layout === 'full' ? <Shrink size={15} /> : <Expand size={15} />}
          </LayoutButton>
        </div>
      )}
      {compact && (
        <HeadButton label={layout === 'full' ? 'Exit full screen' : 'Full screen'} onClick={() => onLayout(layout === 'full' ? 'theater' : 'full')}>
          {layout === 'full' ? <Shrink size={16} /> : <Expand size={16} />}
        </HeadButton>
      )}
      {(effective === 'theater' || effective === 'cinema') && !compact && (
        <HeadButton flat={solid} label={panel ? 'Hide side panel' : 'Show chat and people'} active={panel} onClick={() => useUI.getState().set({ voiceChat: !panel })}>
          <PanelRight size={16} />
        </HeadButton>
      )}
      {!leave && (
      <HeadButton flat={solid} label={exitLabel} onClick={onExit}>
        <Minimize2 size={16} />
      </HeadButton>
      )}
    </motion.header>
  );
}

function LayoutButton({ label, active, onClick, flat, children }: { label: string; active: boolean; onClick: () => void; flat?: boolean; children: ReactNode }) {
  return (
    <Tooltip label={label} side="bottom">
      <button
        aria-label={label}
        onClick={onClick}
        className={clsx(
          'grid place-items-center transition-colors',
          flat ? 'h-7 w-8 rounded-[8px]' : 'h-8 w-8 rounded-full',
          active ? (flat ? 'bg-white/[0.16] text-white' : 'bg-white text-black') : flat ? 'text-white/60 hover:bg-white/10 hover:text-white' : 'hover:bg-white/15',
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function HeadButton({ label, onClick, active, flat, children }: { label: string; onClick: () => void; active?: boolean; flat?: boolean; children: ReactNode }) {
  return (
    <Tooltip label={label} side="bottom">
      <button
        aria-label={label}
        onClick={onClick}
        className={clsx(
          'grid shrink-0 place-items-center transition-colors',
          flat
            ? clsx('h-8 w-8 rounded-[8px]', active ? 'bg-white/[0.12] text-white' : 'text-white/60 hover:bg-white/10 hover:text-white')
            : clsx('h-9 w-9 rounded-full glass-ink', active ? 'bg-white/25!' : 'hover:bg-white/15!'),
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

// ─── Side panel: Chat | People | Watch party ─────────────────────────────────

function Panel(props: Props & { tabs: boolean; className?: string }) {
  const { channel, chatRoom, room, tabs, className } = props;
  return <CallPanel channel={channel} chatRoom={chatRoom} room={room} people={props} tabs={tabs} className={className} />;
}

/**
 * The call's side panel, the same in a call and in watch mode: Chat, People (when the call's
 * people are known) and Watch party (a voice room that allows parties, or one that has one).
 * With tabs it has no close button of its own: the chat button that opened it closes it.
 */
export function CallPanel({
  channel,
  chatRoom,
  room,
  people,
  tabs = true,
  onClose,
  className,
}: {
  channel: Channel;
  chatRoom: Room;
  /** The call's voice room: enables the Watch party tab. */
  room?: Room;
  people?: WatchPeople;
  tabs?: boolean;
  onClose?: () => void;
  className?: string;
}) {
  const stored = useUI((s) => s.sideTab);
  const party = useParty((s) => (room ? s.parties[room.id] : undefined));
  const unread = useMessages((s) => s.unread[chatRoom.id] ?? 0);
  const showPeople = tabs && !!people;
  const showParty = tabs && !!room && room.kind === 'voice' && (room.allowParty !== false || !!party);
  const tab = stored === 'people' && showPeople ? 'people' : stored === 'party' && showParty ? 'party' : 'chat';
  const setTab = (sideTab: typeof stored) => useUI.getState().set({ sideTab });
  const close = onClose && (
    <button aria-label="Close the side panel" onClick={onClose} className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-fg-2 hover:bg-fill-2 hover:text-fg">
      <X size={15} />
    </button>
  );
  return (
    <div className={clsx('flex flex-col bg-[var(--bg)]/40 glass-side', className)}>
      {showPeople || showParty ? (
        <div className="flex h-[52px] shrink-0 items-center gap-1 px-2 hairline-b">
          <PanelTab active={tab === 'chat'} onClick={() => setTab('chat')}>
            <MessageSquareText size={15} /> Chat
            {tab !== 'chat' && unread > 0 && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{unread}</span>}
          </PanelTab>
          {showPeople && (
            <PanelTab active={tab === 'people'} onClick={() => setTab('people')}>
              <Users size={15} /> People <span className="text-fg-3">{people.people.length}</span>
            </PanelTab>
          )}
          {showParty && (
            <PanelTab active={tab === 'party'} onClick={() => setTab('party')}>
              <Popcorn size={15} /> Watch party
              {tab !== 'party' && party && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
            </PanelTab>
          )}
        </div>
      ) : (
        <div className="flex h-[52px] shrink-0 items-center gap-2 px-4 text-[13.5px] font-semibold hairline-b">
          <MessageSquareText size={15} className="text-fg-3" /> <span className="flex-1">Chat</span>
          {close}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {tab === 'people' && people ? (
          <PeopleList {...people} channel={channel} />
        ) : tab === 'party' && room ? (
          <PartyPanel channel={channel} room={room} />
        ) : (
          <ChatView channel={channel} room={chatRoom} compact />
        )}
      </div>
    </div>
  );
}

function PanelTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx('relative flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] text-[13px] font-medium transition-colors', active ? 'text-fg' : 'text-fg-2 hover:bg-fill-2 hover:text-fg')}
    >
      {active && <motion.span layoutId="watch-tab" transition={spring} className="absolute inset-0 rounded-[10px] bg-fill-3" />}
      <span className="relative flex items-center gap-1.5">{children}</span>
    </button>
  );
}

function PeopleList({ people, users, camOf, speakingOf, myPeer, channel, extra }: WatchPeople & { channel: Channel }) {
  return (
    <div className="scroll h-full p-2" style={{ scrollbarGutter: 'auto' }}>
      {/* Raised hands first, so whoever wants to talk is easy to see. */}
      {[...people.filter((p) => p.hand), ...people.filter((p) => !p.hand)].map((p) => {
        const cam = camOf(p);
        const speaking = speakingOf(p);
        const user = users[p.userId];
        return (
          <div
            key={p.peerId}
            onContextMenu={(e) => openUserMenu(e, p.userId, { kind: 'voice', channelId: channel.id, peerId: p.peerId })}
            className="flex items-center gap-3 rounded-[12px] p-2 hover:bg-fill-1"
          >
            <span className="relative shrink-0">
              {cam ? (
                <span className="block h-[44px] w-[64px] overflow-hidden rounded-[10px] bg-black" style={{ boxShadow: speaking ? '0 0 0 2px var(--success)' : undefined }}>
                  <StreamVideo stream={cam} mirror={p.peerId === myPeer} />
                </span>
              ) : (
                <Avatar user={user} size={40} speaking={speaking} />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[13px] font-medium">{user?.name ?? 'Someone'}</span>
                {p.peerId === myPeer && <span className="text-[11.5px] text-fg-3">(you)</span>}
                {p.hand && (
                  <span className="emoji text-[13px]" aria-label="Hand raised" title="Hand raised">
                    ✋
                  </span>
                )}
              </span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-fg-3">
                <ParticipantIcons p={p} size={12} />
                {extra?.(p)}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Mini layout: everyone's faces in a row under the picture. */
function Strip({ people, users, camOf, speakingOf, myPeer, channel }: Props) {
  return (
    <div className="flex h-[124px] shrink-0 gap-2 overflow-x-auto bg-[var(--stage)] p-2 [scrollbar-width:thin]">
      {people.map((p) => {
        const cam = camOf(p);
        const speaking = speakingOf(p);
        const user = users[p.userId];
        return (
          <div
            key={p.peerId}
            onContextMenu={(e) => openUserMenu(e, p.userId, { kind: 'voice', channelId: channel.id, peerId: p.peerId })}
            className="relative h-full w-[192px] shrink-0 overflow-hidden rounded-[12px] bg-white/5 transition-shadow"
            style={{ boxShadow: speaking ? 'inset 0 0 0 2px var(--success)' : 'inset 0 0 0 0.5px rgba(255,255,255,0.12)' }}
          >
            {cam ? (
              <StreamVideo stream={cam} mirror={p.peerId === myPeer} />
            ) : (
              <div className="grid h-full place-items-center">
                <Avatar user={user} size={52} speaking={speaking} />
              </div>
            )}
            <span className="absolute bottom-1.5 left-1.5 flex max-w-[calc(100%-12px)] items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-white glass-ink">
              <span className="truncate">{user?.name ?? 'Someone'}</span>
              <ParticipantIcons p={p} size={11} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Full screen: who's talking, and chat on demand ──────────────────────────

/** Like the desktop overlay: whoever is talking, top right. */
function Talking({ people, users, speakingOf }: Props) {
  const talking = people.filter(speakingOf);
  return (
    <div className="pointer-events-none absolute right-4 top-[64px] z-20 flex flex-col items-end gap-1.5">
      <AnimatePresence>
        {talking.map((p) => (
          <motion.div
            key={p.peerId}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12, transition: { duration: 0.2 } }}
            transition={spring}
            className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-[12.5px] font-medium text-white glass-ink"
          >
            <Avatar user={users[p.userId]} size={26} speaking />
            {users[p.userId]?.name ?? 'Someone'}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** `lifted`: the movie's controls are along the bottom (call bar tucked away), so sit above them. */
function ChatBubble({ channel, room, idle, lifted }: { channel: Channel; room: Room; idle: boolean; lifted: boolean }) {
  const [open, setOpen] = useState(false);
  const unread = useMessages((s) => s.unread[room.id] ?? 0);
  return (
    <>
      <motion.button
        aria-label={open ? 'Close chat' : 'Open chat'}
        onClick={() => setOpen(!open)}
        animate={{ opacity: idle && !open && !unread ? 0 : 1 }}
        whileTap={{ scale: 0.92 }}
        className={clsx(
          'absolute right-5 z-30 grid h-12 w-12 place-items-center rounded-full text-white transition-[bottom] duration-200 glass-ink hover:bg-black/60! compact:right-3',
          lifted ? 'bottom-[96px] compact:bottom-[84px]' : 'bottom-[26px] compact:bottom-3',
        )}
      >
        {open ? <X size={19} /> : <MessageSquareText size={19} />}
        {!open && unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-[11px] font-bold text-white">{unread}</span>
        )}
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.14 } }}
            transition={spring}
            className="absolute bottom-[86px] right-5 z-40 flex h-[min(520px,calc(100%-160px))] w-[360px] max-w-[calc(100%-32px)] flex-col overflow-hidden rounded-[20px] bg-[var(--bg)] shadow-[0_24px_60px_rgba(0,0,0,0.5)] ring-1 ring-white/10 compact:bottom-[68px] compact:right-3 compact:h-[calc(100%-124px)]"
          >
            <div className="flex h-[46px] shrink-0 items-center px-4 text-[13.5px] font-semibold hairline-b">Chat</div>
            <div className="min-h-0 flex-1">
              <ChatView channel={channel} room={room} compact />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * Cinema: the picture on a big flat screen in a dark room, a soft glow spilling from it, and
 * everyone in their seats below.
 */
function Cinema({ media, controls, seats, idle, rows }: { media: ReactNode; controls?: ReactNode; seats?: (where: 'bottom' | 'left' | 'right') => ReactNode; idle: boolean; rows: number }) {
  const sides = useSettings((s) => s.cinemaSeats) === 'sides';
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const top = 20;
  // Room for the seats: one row, or two staggered (the website's own view can't sit under them).
  const seatsHeight = sides ? 0 : rows > 1 ? 178 : 112;
  const column = sides ? 112 : 0;
  const dock = 88;
  const room = Math.max(120, box.h - top - seatsHeight - dock - 8);
  let w = sides ? box.w - column * 2 - 40 : box.w * 0.88;
  let h = (w * 9) / 16;
  if (h > room) {
    h = room;
    w = (h * 16) / 9;
  }
  const left = (box.w - w) / 2;
  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden bg-[radial-gradient(ellipse_at_50%_0%,#12131a_0%,#060608_70%)]">
      {/* The light from the screen, falling on the room in front of it. */}
      <div
        className="pointer-events-none absolute"
        style={{ left: left - w * 0.2, top: top + h * 0.55, width: w * 1.4, height: h * 1.1, background: 'radial-gradient(ellipse at 50% 0%, rgba(175,195,255,0.16), transparent 68%)' }}
      />
      <div
        className="absolute overflow-hidden rounded-[6px] bg-black"
        style={{ left, top, width: w, height: h, boxShadow: '0 0 70px 8px rgba(190,205,255,0.16), 0 0 200px 50px rgba(120,140,255,0.08)', ['--dock-space' as string]: '0px' }}
      >
        {media}
        {controls && <Chrome idle={idle}>{controls}</Chrome>}
      </div>
      {sides ? (
        <>
          <div className="absolute flex justify-center overflow-y-auto [scrollbar-width:none]" style={{ left: 12, width: column, top, bottom: dock + 4 }}>
            {seats?.('left')}
          </div>
          <div className="absolute flex justify-center overflow-y-auto [scrollbar-width:none]" style={{ right: 12, width: column, top, bottom: dock + 4 }}>
            {seats?.('right')}
          </div>
        </>
      ) : (
        <div className="absolute inset-x-0 flex justify-center" style={{ bottom: dock + 4 }}>
          {seats?.('bottom')}
        </div>
      )}
    </div>
  );
}

/** Cinema: the seats along the bottom, or on the left and right of the screen (remembered). */
function SeatsToggle({ flat }: { flat?: boolean }) {
  const sides = useSettings((s) => s.cinemaSeats) === 'sides';
  return (
    <LayoutButton flat={flat} label={sides ? 'Seats: on the sides (click for along the bottom)' : 'Seats: along the bottom (click for the sides)'} active={false} onClick={() => useSettings.getState().set({ cinemaSeats: sides ? 'bottom' : 'sides' })}>
      {sides ? <Columns3 size={15} /> : <Rows3 size={15} />}
    </LayoutButton>
  );
}
