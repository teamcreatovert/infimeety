import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { PartyPlanner } from '../components/voice/PartyPlanner';
import { Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Channel, GuestStatus, Me, MeetingPreview } from '../../../shared/protocol';
import { useAppearance } from '../App';
import { Lightbox } from '../components/Lightbox';
import { MeetingView } from '../components/meeting/MeetingView';
import { Background } from '../components/shell/Background';
import { Avatar } from '../components/ui/Avatar';
import { Toasts } from '../components/ui/Toasts';
import { Button, Spinner, TextField } from '../components/ui/primitives';
import { UserMenu } from '../components/people/UserMenu';
import { api, ApiError, handleUnauthorized, setToken } from '@/lib/api';
import { channelGradient } from '@/lib/format';
import { loadMeetingPreview } from '@/lib/meeting';
import { spring } from '@/lib/motion';
import { isMobile } from '@/lib/platform';
import { syncHubs } from '@/lib/realtime';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { useMeetings } from '@/stores/meetings';
import { useVoice } from '@/stores/voice';

type Phase = { k: 'loading' } | { k: 'ended' } | { k: 'prejoin' } | { k: 'waiting' } | { k: 'denied' } | { k: 'removed' } | { k: 'in'; channel: Channel };

const NAME_KEY = 'infimeety.guestName';
/** A guest identity belongs to one meeting, so this browser remembers it per meeting. */
const tokenKey = (code: string) => `infimeety.guest.${code}`;

const store = {
  get: (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string | null) => {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* private mode: remembered for this tab only */
    }
  },
};

/**
 * A meeting in a browser tab, for people without the app: enter a name, wait for the host
 * (or a co-host) to let you in, then the same call stage as the desktop app. Once let in,
 * this browser goes straight back in to that meeting after a refresh.
 */
export function GuestApp({ code }: { code: string }) {
  useAppearance();
  const [phase, setPhase] = useState<Phase>({ k: 'loading' });
  const [preview, setPreview] = useState<MeetingPreview | null>(null);
  const [name, setName] = useState(() => store.get(NAME_KEY) ?? '');
  const [mic, setMic] = useState(true);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const closed = useMeetings((s) => (phase.k === 'in' ? s.closed[phase.channel.id] : undefined));
  const prefs = useRef({ mic, camera });
  prefs.current = { mic, camera };

  const forget = () => {
    store.set(tokenKey(code), null);
    setToken(null, { persist: false });
  };

  const enter = async (channel: Channel) => {
    const me = await api<Me>('/me');
    useAuth.setState({ me, status: 'ready' });
    // Set directly rather than through select(), which would overwrite a signed-in user's saved selection.
    useChannels.setState({ channels: [channel], loaded: true, activeChannelId: channel.id });
    void useChannels.getState().loadMembers(channel.id);
    syncHubs([channel.id]);
    setPhase({ k: 'in', channel });
    if (!prefs.current.mic) useVoice.setState({ muted: true });
    await useMeetings.getState().enterCall(channel, { camera: prefs.current.camera });
  };

  /** Where do we stand with the meeting? */
  const check = async () => {
    try {
      const res = await api<{ status: GuestStatus; channel?: Channel }>(`/meetings/${code}/guest`);
      if (res.status === 'admitted' && res.channel) return void (await enter(res.channel));
      setPhase({ k: res.status === 'admitted' ? 'waiting' : res.status });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return setPhase({ k: 'ended' });
      if (err instanceof ApiError && err.status === 401) {
        forget();
        return setPhase({ k: 'prejoin' });
      }
      // Offline: the waiting screen keeps polling.
    }
  };

  useEffect(() => {
    // Never act with a signed-in user's session from this browser; guests get their own.
    setToken(null, { persist: false });
    handleUnauthorized(() => {
      forget();
      setPhase({ k: 'prejoin' });
    });
    void (async () => {
      const p = await loadMeetingPreview(code);
      if (!p) return setPhase({ k: 'ended' });
      setPreview(p);
      const saved = store.get(tokenKey(code));
      if (!saved) return setPhase({ k: 'prejoin' });
      setToken(saved, { persist: false });
      await check();
    })();
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase.k !== 'waiting') return;
    const poll = setInterval(() => void check(), 2000);
    return () => clearInterval(poll);
  }, [phase.k]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!closed) return;
    // A removed guest keeps their identity, so a refresh still says they were removed.
    if (closed === 'ended') forget();
    setPhase({ k: closed });
  }, [closed]); // eslint-disable-line react-hooks/exhaustive-deps

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    setBusy(true);
    store.set(NAME_KEY, clean);
    try {
      const { token } = await api<{ token: string }>(`/meetings/${code}/guests`, { method: 'POST', json: { name: clean } });
      store.set(tokenKey(code), token);
      setToken(token, { persist: false });
      setPhase({ k: 'waiting' });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setPhase({ k: 'ended' });
      else setPhase({ k: 'prejoin' });
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    forget();
    setPhase({ k: 'prejoin' });
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="safe-area relative flex h-full w-full flex-col overflow-hidden">
        <Background />
        {phase.k === 'in' ? (
          <main className="glass-main relative flex min-h-0 min-w-0 flex-1 flex-col">
            <MeetingView channel={phase.channel} />
          </main>
        ) : (
          <div className="relative grid flex-1 place-items-center overflow-y-auto p-4">
            {/* Cards crossfade in one grid cell (no "wait" mode, which can stall in a throttled tab). */}
            <AnimatePresence initial={false}>
              <motion.div
                key={phase.k}
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, transition: { duration: 0.14 } }}
                transition={spring}
                style={{ gridArea: '1 / 1' }}
                className="w-full max-w-[400px] rounded-[30px] px-7 pb-7 pt-8 text-center glass-pop compact:rounded-[26px] compact:px-5 compact:pb-6 compact:pt-7"
              >
                {phase.k === 'loading' && (
                  <div className="grid h-[220px] place-items-center text-fg-3">
                    <Spinner size={22} />
                  </div>
                )}

                {phase.k === 'prejoin' && preview && (
                  <form onSubmit={(e) => void ask(e)}>
                    <Tile color="teal">
                      <Video size={38} strokeWidth={1.8} />
                    </Tile>
                    <p className="mt-5 text-[12.5px] text-fg-2">You’re invited to a meeting</p>
                    <h1 className="font-display text-[24px] font-bold tracking-[-0.03em]">{preview.name}</h1>
                    <p className="mt-1 text-[13px] text-fg-3">{preview.inCall > 0 ? `${preview.inCall} ${preview.inCall === 1 ? 'person is' : 'people are'} in the call` : 'Nobody’s in the call yet'}</p>

                    <div className="mt-6 flex items-center gap-3 rounded-[16px] bg-fill-1 p-2.5 pl-3 text-left">
                      <Avatar user={{ id: 'guest', name: name || '?', avatarUrl: null }} size={36} />
                      <TextField autoFocus className="h-10! flex-1" placeholder="Your name" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} />
                    </div>
                    <div className="mt-3 flex justify-center gap-2.5">
                      <Toggle on={mic} onClick={() => setMic(!mic)} label={mic ? 'Microphone on' : 'Microphone off'}>
                        {mic ? <Mic size={18} /> : <MicOff size={18} />}
                      </Toggle>
                      <Toggle on={camera} onClick={() => setCamera(!camera)} label={camera ? 'Camera on' : 'Camera off'}>
                        {camera ? <Video size={18} /> : <VideoOff size={18} />}
                      </Toggle>
                    </div>

                    <Button type="submit" variant="primary" size="lg" className="mt-6 w-full" loading={busy} disabled={!name.trim()}>
                      Ask to join
                    </Button>
                    <p className="mt-3 text-[11.5px] leading-snug text-fg-3">Someone in the meeting lets you in. You join as a guest, no account needed.</p>
                    {!isMobile && (
                      <a href={`infimeety://meet/${code}`} className="mt-4 inline-block text-[12.5px] font-medium text-accent hover:underline">
                        Have Infimeety? Open in the app
                      </a>
                    )}
                  </form>
                )}

                {phase.k === 'waiting' && (
                  <>
                    <motion.div animate={{ scale: [1, 1.05, 1] }} transition={{ duration: 1.6, repeat: Infinity }} className="mx-auto w-fit rounded-full shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_35%,transparent)]">
                      <Avatar user={{ id: 'guest', name: name || '?', avatarUrl: null }} size={76} />
                    </motion.div>
                    <h1 className="mt-6 font-display text-[22px] font-bold tracking-[-0.025em]">Asking to join…</h1>
                    <p className="mt-1.5 text-[13.5px] leading-snug text-fg-2">You’ll join {preview?.name ?? 'the meeting'} as soon as someone in it lets you in.</p>
                    <div className="mt-5 flex justify-center text-fg-3">
                      <Spinner size={18} />
                    </div>
                    <Button className="mt-6 w-full" onClick={cancel}>
                      Cancel
                    </Button>
                  </>
                )}

                {phase.k === 'denied' && (
                  <Notice title="Nobody let you in" body="Someone in the meeting declined your request to join.">
                    <Button variant="primary" className="mt-6 w-full" onClick={cancel}>
                      Ask again
                    </Button>
                  </Notice>
                )}

                {phase.k === 'removed' && <Notice title="You were removed from the meeting" body="The host or a co-host removed you, so you can’t rejoin this meeting." />}

                {phase.k === 'ended' && <Notice title="This meeting has ended" body="Meetings close a day after they start, or once nobody has been in them for an hour. Ask for a new link." />}
              </motion.div>
            </AnimatePresence>
          </div>
        )}
        <Toasts />
        <UserMenu />
        <Lightbox />
        <PartyPlanner />
      </div>
    </MotionConfig>
  );
}

function Tile({ color, children }: { color: string; children: ReactNode }) {
  return (
    <div className="mx-auto grid h-[84px] w-[84px] place-items-center rounded-[26px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_14px_34px_rgba(0,0,0,0.3)]" style={{ background: channelGradient(color) }}>
      {children}
    </div>
  );
}

function Toggle({ on, onClick, label, children }: { on: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      whileTap={{ scale: 0.92 }}
      onClick={onClick}
      className="grid h-11 w-11 place-items-center rounded-full transition-colors"
      style={on ? { background: 'var(--fill-2)', color: 'var(--fg)' } : { background: 'color-mix(in srgb, var(--danger) 18%, transparent)', color: 'var(--danger)' }}
    >
      {children}
    </motion.button>
  );
}

function Notice({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <>
      <Tile color="graphite">
        <Video size={38} strokeWidth={1.8} />
      </Tile>
      <h1 className="mt-5 font-display text-[21px] font-bold tracking-[-0.025em]">{title}</h1>
      <p className="mt-1.5 text-[13px] leading-snug text-fg-2">{body}</p>
      {children ?? (
        <a href="/download" className="mt-6 inline-block text-[12.5px] font-medium text-accent hover:underline">
          Get Infimeety
        </a>
      )}
    </>
  );
}
