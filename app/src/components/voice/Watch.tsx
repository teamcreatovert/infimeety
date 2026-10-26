import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { Expand, Minimize2, MessageSquareText, PanelLeft, PanelRight, PictureInPicture2, RectangleHorizontal, Shrink, Users, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { Channel, PublicUser, Room, VoiceParticipant } from '../../../../shared/protocol';
import { ChatView } from '../chat/ChatView';
import { ParticipantIcons } from '../shell/Sidebar';
import { Avatar } from '../ui/Avatar';
import { Tooltip } from '../ui/overlay';
import { StreamVideo } from './StreamVideo';
import { spring } from '@/lib/motion';
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

export type WatchLayout = 'theater' | 'mini' | 'full';

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
  const dockSpace = !floatingDock || (full && dockHidden) ? '0px' : compact ? '72px' : '88px';

  const stage = (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--stage)]"
      style={{ cursor: idle && !nearBottom ? 'none' : undefined, ['--dock-space' as string]: dockSpace }}
      onPointerMove={(e) => {
        setTouched(e.pointerType === 'touch');
        const r = e.currentTarget.getBoundingClientRect();
        setNearBottom(e.pointerType !== 'touch' && r.bottom - e.clientY < 110);
      }}
      onPointerDown={(e) => setTouched(e.pointerType === 'touch')}
      onPointerLeave={() => setNearBottom(false)}
    >
      {media}
      <Header {...props} effective={effective} />
      {overlay}
      {controls && <Chrome idle={idle}>{controls}</Chrome>}
      {effective === 'full' && <Talking {...props} />}
      {effective === 'full' && <ChatBubble channel={props.channel} room={props.chatRoom} idle={idle} lifted={!!controls && dockHidden} />}
      {floatingDock && dock(dockHidden)}
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
        {!phone && effective === 'theater' && panel && (
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
    <motion.div animate={{ opacity: idle ? 0 : 1 }} transition={{ duration: 0.25 }} style={{ pointerEvents: idle ? 'none' : 'auto' }}>
      {children}
    </motion.div>
  );
}

function Header({ badge, title, headerExtras, layout, effective, onLayout, idle, exitLabel, onExit }: Props & { effective: WatchLayout }) {
  const compact = useCompact();
  const panel = useUI((s) => s.voiceChat);
  const navCollapsed = useUI((s) => s.navCollapsed);
  return (
    <motion.header
      data-tauri-drag-region
      animate={{ opacity: idle ? 0 : 1, y: idle ? -8 : 0 }}
      transition={spring}
      className="absolute inset-x-0 top-0 z-30 flex h-[56px] items-center gap-2.5 bg-gradient-to-b from-black/75 to-transparent px-4 text-white compact:h-[48px] compact:gap-2 compact:px-2.5"
      style={{ pointerEvents: idle ? 'none' : 'auto' }}
    >
      {!compact && effective !== 'full' && (
        <HeadButton label={navCollapsed ? 'Show channels' : 'Hide channels'} active={!navCollapsed} onClick={() => useUI.getState().set({ navCollapsed: !navCollapsed })}>
          <PanelLeft size={16} />
        </HeadButton>
      )}
      {badge}
      <span data-tauri-drag-region className="min-w-0 truncate text-[13.5px] font-semibold">
        {title}
      </span>
      {headerExtras}
      <div data-tauri-drag-region className="flex-1 self-stretch" />
      {!compact && (
        <div className="flex items-center gap-0.5 rounded-full bg-white/10 p-0.5 backdrop-blur-md">
          <LayoutButton label="Theater: picture and side panel" active={layout === 'theater'} onClick={() => onLayout('theater')}>
            <RectangleHorizontal size={15} />
          </LayoutButton>
          <LayoutButton label="Mini: picture, faces and chat" active={layout === 'mini'} onClick={() => onLayout('mini')}>
            <PictureInPicture2 size={15} />
          </LayoutButton>
          <LayoutButton label={layout === 'full' ? 'Exit full screen' : 'Full screen'} active={layout === 'full'} onClick={() => onLayout(layout === 'full' ? 'theater' : 'full')}>
            {layout === 'full' ? <Shrink size={15} /> : <Expand size={15} />}
          </LayoutButton>
        </div>
      )}
      {compact && (
        <HeadButton label={layout === 'full' ? 'Exit full screen' : 'Full screen'} onClick={() => onLayout(layout === 'full' ? 'theater' : 'full')}>
          {layout === 'full' ? <Shrink size={16} /> : <Expand size={16} />}
        </HeadButton>
      )}
      {effective === 'theater' && !compact && (
        <HeadButton label={panel ? 'Hide side panel' : 'Show chat and people'} active={panel} onClick={() => useUI.getState().set({ voiceChat: !panel })}>
          <PanelRight size={16} />
        </HeadButton>
      )}
      <HeadButton label={exitLabel} onClick={onExit}>
        <Minimize2 size={16} />
      </HeadButton>
    </motion.header>
  );
}

function LayoutButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip label={label} side="bottom">
      <button aria-label={label} onClick={onClick} className={clsx('grid h-8 w-8 place-items-center rounded-full transition-colors', active ? 'bg-white text-black' : 'hover:bg-white/15')}>
        {children}
      </button>
    </Tooltip>
  );
}

export function HeadButton({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: ReactNode }) {
  return (
    <Tooltip label={label} side="bottom">
      <button
        aria-label={label}
        onClick={onClick}
        className={clsx('grid h-9 w-9 shrink-0 place-items-center rounded-full backdrop-blur-md transition-colors', active ? 'bg-white/25' : 'bg-white/10 hover:bg-white/20')}
      >
        {children}
      </button>
    </Tooltip>
  );
}

// ─── Side panel: Chat | People ───────────────────────────────────────────────

function Panel(props: Props & { tabs: boolean; className?: string }) {
  const { channel, chatRoom, people, tabs, className } = props;
  const [tab, setTab] = useState<'chat' | 'people'>('chat');
  const unread = useMessages((s) => s.unread[chatRoom.id] ?? 0);
  return (
    <div className={clsx('flex flex-col bg-[var(--bg)]/40 glass-side', className)}>
      {tabs ? (
        <div className="flex h-[52px] shrink-0 items-center gap-1 px-2 hairline-b">
          <PanelTab active={tab === 'chat'} onClick={() => setTab('chat')}>
            <MessageSquareText size={15} /> Chat
            {tab !== 'chat' && unread > 0 && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{unread}</span>}
          </PanelTab>
          <PanelTab active={tab === 'people'} onClick={() => setTab('people')}>
            <Users size={15} /> People <span className="text-fg-3">{people.length}</span>
          </PanelTab>
        </div>
      ) : (
        <div className="flex h-[52px] shrink-0 items-center gap-2 px-4 text-[13.5px] font-semibold hairline-b">
          <MessageSquareText size={15} className="text-fg-3" /> Chat
        </div>
      )}
      <div className="min-h-0 flex-1">{tabs && tab === 'people' ? <PeopleList {...props} /> : <ChatView channel={channel} room={chatRoom} compact />}</div>
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

function PeopleList({ people, users, camOf, speakingOf, myPeer, channel, extra }: Props) {
  return (
    <div className="scroll h-full p-2" style={{ scrollbarGutter: 'auto' }}>
      {people.map((p) => {
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
            <span className="absolute bottom-1.5 left-1.5 flex max-w-[calc(100%-12px)] items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">
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
            className="flex items-center gap-2 rounded-full bg-black/55 py-1 pl-1 pr-3 text-[12.5px] font-medium text-white backdrop-blur-md"
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
          'absolute right-5 z-30 grid h-12 w-12 place-items-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur-md transition-[bottom] duration-200 hover:bg-black/75 compact:right-3',
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
