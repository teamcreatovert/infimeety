import { invoke } from '@tauri-apps/api/core';
import clsx from 'clsx';
import { ArrowLeft, Clapperboard, FolderOpen, Link2, MonitorPlay, Play, Popcorn } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { Channel, Room, VoiceParticipant } from '../../../../shared/protocol';
import { Avatar } from '../ui/Avatar';
import { usePopoverRects } from '../ui/overlay';
import { Button } from '../ui/primitives';
import { DOWNLOAD_PAGE } from '@/config';
import { closeLobby, joinLobby, startLobby, useLobby } from '@/lib/activityLobby';
import { LOBBY_TAB } from '@/lib/browser';
import { spring } from '@/lib/motion';
import { useReactions } from '@/lib/reactions';
import { useParty } from '@/lib/party';
import { canWatchWeb, startWeb, useWeb } from '@/lib/watchWeb';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { useUI } from '@/stores/ui';

const SERVICES = [
  { name: 'Netflix', url: 'https://www.netflix.com/browse', color: '#e50914' },
  { name: 'Prime Video', url: 'https://www.primevideo.com/', color: '#1a98ff' },
  { name: 'Disney+', url: 'https://www.disneyplus.com/', color: '#113ccf' },
  { name: 'Crunchyroll', url: 'https://www.crunchyroll.com/', color: '#f47521' },
  { name: 'Max', url: 'https://www.max.com/', color: '#002be7' },
];

/** The lobby before anything is picked: the host chooses what to watch; everyone else waits with them. */
export function LobbyChooser({ channel, room }: { channel: Channel; room: Room }) {
  const lobby = useLobby((s) => s.lobbies[room.id]);
  const me = useAuth((s) => s.me?.id);
  const hostName = useChannels((s) => (lobby ? (s.users[lobby.hostId]?.name ?? 'The host') : 'The host'));
  const [step, setStep] = useState<'pick' | 'streaming' | 'youtube'>('pick');
  const [link, setLink] = useState('');
  const host = !lobby || lobby.hostId === me;

  const local = () => useUI.getState().set({ partyPlanner: { channelId: channel.id, roomId: room.id } });
  const web = (url: string) => void startWeb(room.id, url, LOBBY_TAB);
  const typed = link.trim();
  const url = !typed ? '' : /^https:\/\//i.test(typed) ? typed : `https://${typed.replace(/^http:\/\//i, '')}`;

  if (!host)
    return (
      <Center>
        <Popcorn size={34} className="text-white/80" />
        <h2 className="mt-4 font-display text-[22px] font-bold tracking-[-0.02em] text-white">Waiting for {hostName}</h2>
        <p className="mt-1.5 max-w-[360px] text-[13.5px] leading-snug text-white/60">They’re picking something to watch. Get comfortable: it starts here for everyone.</p>
      </Center>
    );

  return (
    <Center>
      <AnimatePresence mode="wait" initial={false}>
        {step === 'pick' && (
          <motion.div key="pick" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={spring} className="flex w-full flex-col items-center">
            <h2 className="font-display text-[24px] font-bold tracking-[-0.02em] text-white">What are we watching?</h2>
            <p className="mt-1.5 text-[13.5px] text-white/60">Everyone in {room.name} can join. It plays here for all of you, in sync.</p>
            <div className="mt-7 grid w-full max-w-[680px] grid-cols-3 gap-3 compact:grid-cols-1">
              <Choice icon={<FolderOpen size={22} />} title="From your computer" detail="A movie file: everyone gets a copy and plays it in sync." onClick={local} />
              <Choice icon={<Clapperboard size={22} />} title="Streaming service" detail="Netflix, Prime Video, Disney+ and more, each on their own account." onClick={() => setStep('streaming')} disabled={!canWatchWeb} />
              <Choice icon={<Play size={22} fill="currentColor" />} title="YouTube" detail="Any video or live stream, paused and played together." onClick={() => setStep('youtube')} disabled={!canWatchWeb} />
            </div>
            {!canWatchWeb && (
              <a href={DOWNLOAD_PAGE} target="_blank" rel="noopener" className="mt-4 text-[12.5px] text-white/55 hover:text-white">
                Streaming services and YouTube work in the Infimeety app →
              </a>
            )}
          </motion.div>
        )}
        {step === 'streaming' && (
          <motion.div key="streaming" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={spring} className="flex w-full flex-col items-center">
            <Back onClick={() => setStep('pick')} />
            <h2 className="font-display text-[22px] font-bold tracking-[-0.02em] text-white">Pick a streaming service</h2>
            <p className="mt-1.5 text-[13px] text-white/60">Everyone signs in to their own account; logins stay on each computer.</p>
            <div className="mt-6 flex max-w-[640px] flex-wrap justify-center gap-3">
              {SERVICES.map((s) => (
                <button key={s.name} onClick={() => web(s.url)} className="flex w-[108px] flex-col items-center gap-2 rounded-[16px] p-3 text-[12.5px] font-medium text-white/85 transition-colors hover:bg-white/[0.07]">
                  <span className="grid h-14 w-14 place-items-center rounded-[16px] text-[24px] font-extrabold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]" style={{ background: s.color }}>
                    {s.name[0]}
                  </span>
                  {s.name}
                </button>
              ))}
            </div>
            <LinkBox placeholder="Another service: paste its link" value={link} onChange={setLink} onGo={() => url && web(url)} />
          </motion.div>
        )}
        {step === 'youtube' && (
          <motion.div key="youtube" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={spring} className="flex w-full flex-col items-center">
            <Back onClick={() => setStep('pick')} />
            <span className="grid h-14 w-14 place-items-center rounded-[16px] bg-[#ff0033] text-white">
              <Play size={24} fill="currentColor" />
            </span>
            <h2 className="mt-3 font-display text-[22px] font-bold tracking-[-0.02em] text-white">YouTube</h2>
            <p className="mt-1.5 text-[13px] text-white/60">Paste a video link, or open YouTube and pick one there: everyone follows.</p>
            <LinkBox placeholder="youtube.com/watch?v=…" value={link} onChange={setLink} onGo={() => url && web(url)} />
            <Button className="mt-3" icon={<MonitorPlay size={14} />} onClick={() => web('https://www.youtube.com/')}>
              Open YouTube
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </Center>
  );
}

const Center = ({ children }: { children: React.ReactNode }) => <div className="absolute inset-0 flex flex-col items-center justify-center overflow-y-auto px-6 pb-[calc(var(--dock-space)+24px)] pt-6 text-center">{children}</div>;

function Choice({ icon, title, detail, onClick, disabled }: { icon: React.ReactNode; title: string; detail: string; onClick: () => void; disabled?: boolean }) {
  return (
    <motion.button
      whileHover={disabled ? undefined : { y: -2 }}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      onClick={disabled ? undefined : onClick}
      className={clsx(
        'flex flex-col items-start gap-2 rounded-[18px] bg-white/[0.06] p-4 text-left shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] transition-colors',
        disabled ? 'cursor-not-allowed opacity-45' : 'hover:bg-white/[0.1]',
      )}
    >
      <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-[var(--accent)] text-white">{icon}</span>
      <span className="text-[14.5px] font-semibold text-white">{title}</span>
      <span className="text-[12px] leading-snug text-white/55">{detail}</span>
    </motion.button>
  );
}

const Back = ({ onClick }: { onClick: () => void }) => (
  <button onClick={onClick} className="mb-4 flex items-center gap-1 self-center rounded-full px-3 py-1 text-[12.5px] text-white/60 hover:bg-white/10 hover:text-white">
    <ArrowLeft size={13} /> All choices
  </button>
);

function LinkBox({ placeholder, value, onChange, onGo }: { placeholder: string; value: string; onChange: (v: string) => void; onGo: () => void }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onGo();
      }}
      className="mt-5 flex h-10 w-full max-w-[460px] items-center gap-2 rounded-[12px] bg-white/[0.08] px-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] focus-within:shadow-[inset_0_0_0_1.5px_var(--accent)]"
    >
      <Link2 size={15} className="shrink-0 text-white/50" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] text-white outline-none placeholder:text-white/40" />
      <button type="submit" disabled={!value.trim()} className="rounded-[8px] bg-[var(--accent)] px-3 py-1 text-[12.5px] font-semibold text-white disabled:opacity-40">
        Watch
      </button>
    </form>
  );
}

/** A website watched together, inside the lobby's screen (its own view, placed over this area). */
export function WebStage({ roomId, visible }: { roomId: string; visible: boolean }) {
  const area = useRef<HTMLDivElement>(null);
  const web = useWeb((s) => s.webs[roomId]);
  const joined = useWeb((s) => s.joined === roomId);
  useEffect(() => {
    const el = area.current;
    if (!el || !visible) return;
    const send = () => {
      const r = el.getBoundingClientRect();
      let top = r.top;
      let bottom = r.bottom;
      // The app's bars (the call bar, the header in full screen) and open panels: the movie makes
      // room for them, since nothing of the app can draw over a website.
      const bars = [...document.querySelectorAll('[data-avoid-web]')].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0 && b.height > 0);
      for (const p of [...Object.values(usePopoverRects.getState().rects), ...bars]) {
        if (p.right <= r.left || p.left >= r.right || p.bottom <= top || p.top >= bottom) continue;
        if (p.top > (r.top + r.bottom) / 2) bottom = Math.min(bottom, p.top - 6);
        else top = Math.max(top, p.bottom + 6);
      }
      void invoke('browser_bounds', { x: r.left, y: top, width: r.width, height: Math.max(1, bottom - top) }).catch(() => {});
    };
    const offRects = usePopoverRects.subscribe(send);
    // The bars slide in and out: look again now and then.
    const timer = setInterval(send, 500);
    void invoke('browser_select', { tab: LOBBY_TAB }).catch(() => {});
    void invoke('browser_visible', { visible: true }).catch(() => {});
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    window.addEventListener('resize', send);
    return () => {
      clearInterval(timer);
      offRects();
      ro.disconnect();
      window.removeEventListener('resize', send);
      void invoke('browser_visible', { visible: false }).catch(() => {});
    };
  }, [visible, joined]);
  return (
    <div ref={area} className="absolute inset-0 grid place-items-center bg-black text-[13px] text-white/50">
      {web && !joined && 'Joining…'}
    </div>
  );
}

/**
 * Cinema seats: everyone in the room as a seat facing the screen, in two staggered rows. A
 * speaker's seat glows; their reactions rise from it.
 */
export function CinemaSeats({ people, speakingOf, myPeer, vertical }: { people: VoiceParticipant[]; speakingOf: (p: VoiceParticipant) => boolean; myPeer: string | null; vertical?: boolean }) {
  const users = useChannels((s) => s.users);
  const reactions = useReactions((s) => s.list);
  const front = people.filter((_, i) => i % 2 === 0);
  const back = people.filter((_, i) => i % 2 === 1);
  const seat = (p: VoiceParticipant, far: boolean) => {
    const speaking = speakingOf(p);
    const mine = reactions.filter((r) => r.userId === p.userId);
    return (
      <div key={p.peerId} className={clsx('relative flex flex-col items-center', far ? 'w-[64px]' : 'w-[76px]')}>
        {/* Their reactions rise from the seat. */}
        <div className="pointer-events-none absolute bottom-full left-1/2 h-0 w-0">
          <AnimatePresence>
            {mine.map((r) => (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: 0, scale: 0.6 }}
                animate={{ opacity: [0, 1, 1, 0], y: -160, scale: [0.6, 1.1, 1, 1] }}
                transition={{ duration: 2.8, ease: 'easeOut', times: [0, 0.12, 0.75, 1] }}
                className="absolute -translate-x-1/2"
              >
                {r.gif ? <img src={`https://media.giphy.com/media/${r.gif}/200.webp`} alt="" className="h-[90px] max-w-[160px] rounded-[12px] object-cover shadow-lg" /> : <span className="emoji text-[34px]">{r.emoji}</span>}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <div className={clsx('relative rounded-full transition-shadow', speaking && 'shadow-[0_0_0_2.5px_var(--success),0_0_22px_4px_rgba(35,165,90,0.45)]')}>
          <Avatar user={users[p.userId]} size={far ? 34 : 42} />
        </div>
        {/* The seat back, seen from behind. */}
        <div
          className={clsx('-mt-2 rounded-t-[16px] rounded-b-[6px] bg-gradient-to-b from-[#5a1e2a] to-[#2a0d13] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_8px_18px_-8px_rgba(0,0,0,0.8)]', far ? 'h-[30px] w-[56px]' : 'h-[36px] w-[68px]')}
        />
        <span className={clsx('mt-1 max-w-full truncate text-[11px]', p.peerId === myPeer ? 'font-semibold text-white' : 'text-white/60')}>{users[p.userId]?.name ?? 'Someone'}</span>
      </div>
    );
  };
  // On a side: one column, every other seat nudged, like seats in a curve.
  if (vertical)
    return (
      <div className="pointer-events-auto flex flex-col items-center gap-3 py-2">
        {people.map((p, i) => (
          <div key={p.peerId} className={i % 2 ? 'translate-x-2' : '-translate-x-2'}>
            {seat(p, false)}
          </div>
        ))}
      </div>
    );
  return (
    <div className="pointer-events-auto flex flex-col items-center">
      {back.length > 0 && <div className="flex translate-x-[38px] gap-3 opacity-90">{back.map((p) => seat(p, true))}</div>}
      <div className="-mt-1 flex gap-3">{front.map((p) => seat(p, false))}</div>
    </div>
  );
}

/** The side panel's Watch party tab: start a watch party, join the one that's on, or end it. */
export function LobbyCard({ channel, room }: { channel: Channel; room: Room }) {
  const lobby = useLobby((s) => s.lobbies[room.id]);
  const party = useParty((s) => s.parties[room.id]);
  const web = useWeb((s) => s.webs[room.id]);
  const inLobby = useUI((s) => s.lobby === room.id);
  const me = useAuth((s) => s.me?.id);
  const open = !!(lobby || party || web);
  const hostId = lobby?.hostId ?? party?.hostId ?? web?.hostId;
  const hostName = useChannels((s) => (hostId ? (s.users[hostId]?.name ?? 'Someone') : 'Someone'));
  const canEnd = open && (hostId === me || channel.role !== 'member');
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-[18px] bg-accent text-white shadow-[inset_0_0.5px_0_rgba(255,255,255,0.35)]">
        <Popcorn size={26} />
      </span>
      <h3 className="mt-4 font-display text-[17px] font-bold tracking-[-0.02em]">{open ? 'Watch party' : 'Watch together'}</h3>
      <p className="mt-1.5 text-[12.5px] leading-snug text-fg-2">
        {!open
          ? 'A movie from your computer, Netflix and other services, or YouTube. Everyone joins the lobby and watches in sync.'
          : inLobby
            ? 'You’re in the lobby. Pick what to watch on the big screen.'
            : `${hostId === me ? 'You' : hostName} opened a watch party in ${room.name}.`}
      </p>
      {!inLobby && (
        <Button variant="primary" className="mt-5" icon={<Popcorn size={15} />} onClick={() => (open ? void joinLobby(channel.id, room.id) : startLobby(room.id))}>
          {open ? 'Join the lobby' : 'Start a watch party'}
        </Button>
      )}
      {canEnd && (
        <Button size="sm" variant="soft-danger" className="mt-3" onClick={() => closeLobby(room.id)}>
          End the watch party
        </Button>
      )}
    </div>
  );
}

/** The lobby's website: its video alone, or the whole page (to pick another video). */
export function WebFillToggle() {
  const fill = useUI((s) => s.webFill);
  return (
    <button
      onClick={() => useUI.getState().set({ webFill: !fill })}
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-[8px] bg-white/[0.08] px-2.5 text-[12px] font-medium text-white/85 transition-colors hover:bg-white/[0.14]"
    >
      <MonitorPlay size={13} /> {fill ? 'Show the page' : 'Video only'}
    </button>
  );
}
