import { motion } from 'motion/react';
import { Download, Plus, Settings } from 'lucide-react';
import { useMemo } from 'react';
import type { Channel } from '../../../../shared/protocol';
import { ChannelIcon } from '../ui/ChannelIcon';
import { Tooltip } from '../ui/overlay';
import { DOWNLOAD_PAGE } from '@/config';
import { spring, snappy } from '@/lib/motion';
import { isApp } from '@/lib/platform';
import { useChannels } from '@/stores/channels';
import { useFriends } from '@/stores/friends';
import { useMessages } from '@/stores/messages';
import { useUI } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

export function ChannelRail() {
  const channels = useChannels((s) => s.channels);
  const activeId = useChannels((s) => s.activeChannelId);
  const select = useChannels((s) => s.select);
  const openUI = useUI((s) => s.set);
  const spaces = useMemo(() => channels.filter((c) => c.kind === 'space'), [channels]);
  const homeActive = !spaces.some((c) => c.id === activeId);

  return (
    <nav className="glass-rail hairline-r relative z-10 flex w-[76px] shrink-0 flex-col items-center compact:w-[68px]">
      <div className="flex w-full flex-1 flex-col items-center gap-2.5 overflow-y-auto overflow-x-hidden pb-3 pt-[9px] [scrollbar-width:none]">
        <HomeItem active={homeActive} />
        <div className="my-0.5 h-px w-7 shrink-0 bg-[var(--hairline-strong)]" />
        {spaces.map((c) => (
          <RailItem key={c.id} channel={c} active={c.id === activeId} onSelect={() => select(c.id)} />
        ))}
        <Tooltip label="Create or join a channel" side="right">
          <motion.button
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.92 }}
            transition={snappy}
            onClick={() => openUI({ createChannel: 'create' })}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-fill-2 text-success shadow-[inset_0_0_0_0.5px_var(--hairline-strong)] transition-colors hover:bg-success hover:text-white"
          >
            <Plus size={20} strokeWidth={2.2} />
          </motion.button>
        </Tooltip>
      </div>

      <div className="flex shrink-0 flex-col items-center gap-1 pb-3.5">
        {!isApp && (
          <Tooltip label="Download the app for Windows or Mac" side="right">
            <motion.a
              aria-label="Download the app"
              href={DOWNLOAD_PAGE}
              target="_blank"
              rel="noopener"
              whileTap={{ scale: 0.9 }}
              className="grid h-9 w-9 place-items-center rounded-[11px] text-fg-2 transition-colors hover:bg-fill-2 hover:text-fg"
            >
              <Download size={18} />
            </motion.a>
          </Tooltip>
        )}
        <Tooltip label="Settings" side="right">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => openUI({ settingsTab: 'account' })}
            className="grid h-9 w-9 place-items-center rounded-[11px] text-fg-2 transition-colors hover:bg-fill-2 hover:text-fg"
          >
            <Settings size={18} />
          </motion.button>
        </Tooltip>
      </div>
    </nav>
  );
}

/** Home: friends and direct messages. Badge = friend requests + unread DMs. */
function HomeItem({ active }: { active: boolean }) {
  const requests = useFriends((s) => s.friends.filter((f) => f.status === 'incoming').length);
  const dmRooms = useChannels((s) =>
    s.channels
      .filter((c) => c.kind === 'dm')
      .flatMap((c) => c.rooms.filter((r) => r.kind === 'text').map((r) => r.id))
      .join(','),
  );
  const unread = useMessages((s) => (dmRooms ? dmRooms.split(',').reduce((n, id) => n + (s.unread[id] ?? 0), 0) : 0));
  const badge = requests + (active ? 0 : unread);

  return (
    <div className="relative flex w-full shrink-0 justify-center">
      {active && <motion.span layoutId="rail-pill" transition={spring} className="absolute left-0 top-1/2 h-8 w-[3.5px] -translate-y-1/2 rounded-r-full bg-fg" />}
      <Tooltip label="Friends & messages" side="right">
        <motion.button
          onClick={() => useChannels.getState().select(null)}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.93 }}
          transition={snappy}
          className="relative grid h-11 w-11 place-items-center rounded-[14px]"
          style={{
            background: active ? 'linear-gradient(145deg, #4F8CFF, #7A5CFF 55%, #C64DFF)' : 'var(--fill-2)',
            color: active ? '#fff' : 'var(--fg-2)',
            boxShadow: active ? '0 0 0 2px var(--ring-bg), 0 0 0 3.5px var(--fg), 0 4px 14px rgba(0,0,0,0.3)' : 'inset 0 0 0 0.5px var(--hairline-strong)',
          }}
        >
          {/* The app's ∞ mark, drawn in currentColor. */}
          <svg width="27" height="13" viewBox="216 362 592 300" fill="none" aria-hidden>
            <path
              d="M512 512 C 438 398, 252 398, 252 512 C 252 626, 438 626, 512 512 C 586 398, 772 398, 772 512 C 772 626, 586 626, 512 512 Z"
              stroke="currentColor"
              strokeWidth="76"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {badge > 0 && (
            <span className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10.5px] font-bold text-white shadow-[0_0_0_2.5px_var(--ring-bg)]">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </motion.button>
      </Tooltip>
    </div>
  );
}

function RailItem({ channel, active, onSelect }: { channel: Channel; active: boolean; onSelect: () => void }) {
  const unread = useMessages((s) => channel.rooms.reduce((n, r) => n + (s.unread[r.id] ?? 0), 0));
  const inVoiceHere = useVoice((s) => s.channelId === channel.id);
  const liveHere = useChannels((s) => (s.voice[channel.id]?.participants.length ?? 0) > 0);

  return (
    <div className="relative flex w-full shrink-0 justify-center">
      {active && (
        <motion.span layoutId="rail-pill" transition={spring} className="absolute left-0 top-1/2 h-8 w-[3.5px] -translate-y-1/2 rounded-r-full bg-fg" />
      )}
      {!active && unread > 0 && <span className="absolute left-0 top-1/2 h-2 w-[3.5px] -translate-y-1/2 rounded-r-full bg-fg" />}
      <Tooltip label={channel.name} side="right">
        <motion.button
          onClick={onSelect}
          whileHover={{ scale: 1.06, borderRadius: 16 }}
          whileTap={{ scale: 0.93 }}
          transition={snappy}
          className="relative grid h-11 w-11 place-items-center rounded-[14px] text-[21px]"
          style={{
            boxShadow: active
              ? '0 0 0 2px var(--ring-bg), 0 0 0 3.5px var(--fg), 0 4px 14px rgba(0,0,0,0.3)'
              : 'inset 0 0.5px 0 rgba(255,255,255,0.4), 0 2px 8px rgba(0,0,0,0.22)',
          }}
        >
          <span className="absolute inset-0 overflow-hidden rounded-[inherit]">
            <ChannelIcon channel={channel} />
          </span>
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 font-sans text-[10.5px] font-bold text-white shadow-[0_0_0_2.5px_var(--ring-bg)]">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
          {(inVoiceHere || liveHere) && (
            <span
              className="absolute -bottom-1 -right-1 grid h-[18px] w-[18px] place-items-center rounded-full shadow-[0_0_0_2.5px_var(--ring-bg)]"
              style={{ background: inVoiceHere ? 'var(--success)' : 'var(--fill-3)' }}
            >
              <span className="flex h-2 items-end gap-[1.5px]">
                {[0.5, 1, 0.7].map((h, i) => (
                  <span key={i} className="w-[2px] rounded-full bg-white" style={{ height: `${h * 100}%` }} />
                ))}
              </span>
            </span>
          )}
        </motion.button>
      </Tooltip>
    </div>
  );
}
