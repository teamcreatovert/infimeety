import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import {
  Captions,
  CaptionsOff,
  Check,
  Crown,
  Ellipsis,
  Film,
  FolderOpen,
  Pause,
  Play,
  Popcorn,
  RotateCcw,
  RotateCw,
  Settings2,
  Shield,
  SkipBack,
  Subtitles,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import type { PartyAction, PartyState, VoiceParticipant } from '../../../../shared/protocol';
import { pace } from '../chat/AttachmentView';
import { Avatar } from '../ui/Avatar';
import { MenuItem, MenuSeparator, Popover, Tooltip, type Anchor } from '../ui/overlay';
import { Button, Slider, Spinner } from '../ui/primitives';
import { DOWNLOAD_PAGE } from '@/config';
import { formatBytes } from '@/lib/format';
import { spring } from '@/lib/motion';
import {
  accept,
  act,
  addSubtitles,
  attachPlayer,
  canControl,
  copyMovie,
  describe,
  dismiss,
  endParty,
  expectedPosition,
  formatTime,
  isHost,
  joinIn,
  OPEN_LIMIT,
  prepare,
  removeSubtitles,
  roomPeople,
  serverNow,
  setCohost,
  setReady,
  startNow,
  pickOwnCopy,
  useParty,
  type PartyRequest,
} from '@/lib/party';
import { isTauri } from '@/lib/platform';
import { cancelCopy } from '@/lib/transfer';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { useMedia } from '@/stores/media';
import { useSettings } from '@/stores/settings';
import { useUI } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

/**
 * The watch party's screen: getting a copy of the movie, the synced player, its controls,
 * and the requests people send the host when they don't control playback themselves.
 */

const VOLUME_KEY = 'infimeety.partyVolume';

/** What the player is doing right now, for the controls (which live elsewhere on screen). */
const usePlayer = create<{
  time: number;
  duration: number;
  buffering: boolean;
  blocked: boolean;
  error: string | null;
  volume: number;
  muted: boolean;
  captions: boolean;
  cue: string;
}>()(() => ({
  time: 0,
  duration: 0,
  buffering: false,
  blocked: false,
  error: null,
  volume: Number(localStorage.getItem(VOLUME_KEY) ?? 1) || 1,
  muted: false,
  captions: true,
  cue: '',
}));

const nameOf = (userId: string) => useChannels.getState().users[userId]?.name ?? 'Someone';
const useMe = () => useAuth((s) => s.me?.id);

/** Whether this person controls playback (and so can answer requests). */
function useControls(roomId: string) {
  const me = useMe();
  const party = useParty((s) => s.parties[roomId]);
  // Re-evaluated as people come and go: the room size decides who's in control.
  useChannels((s) => s.voice);
  return !!party && canControl(roomId, me);
}

// ─── Media: the lobby, joining in, or the movie ────────────────────────────────

/** The party's picture: the movie once it's on and you're watching along, the lobby otherwise. */
export function PartyMedia({ roomId, party, chromeHidden }: { roomId: string; party: PartyState; chromeHidden: boolean }) {
  const copy = useParty((s) => s.copies[party.file.id]);
  const joined = useParty((s) => !!s.joined[party.id]);
  useEffect(() => {
    void prepare(roomId);
  }, [roomId, party.file.id]);
  if (party.phase === 'live' && joined && copy?.state === 'ready' && copy.url)
    return (
      <>
        <PartyPlayer key={copy.url} roomId={roomId} url={copy.url} subtitleId={party.subtitle?.id} chromeHidden={chromeHidden} />
        <Countdown party={party} />
      </>
    );
  return <PartyLobby roomId={roomId} party={party} checking={!copy || copy.state === 'checking'} />;
}

/** Is this device watching the movie along (so it shows the player and its controls)? */
export const useWatchingAlong = (party: PartyState | undefined) =>
  useParty((s) => !!party && party.phase === 'live' && !!s.joined[party.id] && s.copies[party.file.id]?.state === 'ready');

/** 3, 2, 1… while a start is scheduled (the start and every play are a moment ahead). */
function Countdown({ party }: { party: PartyState }) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!party.playing) return setLeft(0);
    const tick = () => setLeft(Math.max(0, party.at - serverNow()));
    tick();
    const t = setInterval(tick, 100);
    return () => clearInterval(t);
  }, [party.playing, party.at]);
  // Ordinary plays are scheduled ~0.4 s ahead; only a real start counts down.
  if (left < 700) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-black/35">
      <AnimatePresence mode="popLayout">
        <motion.span
          key={Math.ceil(left / 1000)}
          initial={{ opacity: 0, scale: 1.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={spring}
          className="font-display text-[clamp(64px,14vw,160px)] font-bold text-white [text-shadow:0_6px_30px_rgba(0,0,0,0.6)]"
        >
          {Math.ceil(left / 1000)}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

function PartyPlayer({ roomId, url, subtitleId, chromeHidden }: { roomId: string; url: string; subtitleId?: string; chromeHidden: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLTrackElement>(null);
  const subtitleUrl = useParty((s) => (subtitleId ? s.subtitles[subtitleId] : undefined));
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const blocked = usePlayer((s) => s.blocked);
  const buffering = usePlayer((s) => s.buffering);
  const error = usePlayer((s) => s.error);
  const captions = usePlayer((s) => s.captions);
  const cue = usePlayer((s) => s.cue);

  useEffect(() => {
    const video = ref.current;
    if (video) (video.volume = Math.min(1, volume), (video.muted = muted));
  }, [volume, muted]);

  // Keep this copy on the shared timeline.
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    attachPlayer(video);
    usePlayer.setState({ time: 0, duration: 0, buffering: false, blocked: false, error: null, cue: '' });
    let startTimer: ReturnType<typeof setTimeout> | undefined;
    let pausedOn = NaN;

    const play = () =>
      video.play().then(
        () => usePlayer.setState({ blocked: false }),
        (err: DOMException) => err?.name === 'NotAllowedError' && usePlayer.setState({ blocked: true }),
      );

    const tick = () => {
      const party = useParty.getState().parties[roomId];
      clearTimeout(startTimer);
      if (!party || video.readyState < 1) return;
      const end = video.duration || Infinity;
      const now = serverNow();
      if (!party.playing) {
        if (!video.paused) video.pause();
        video.playbackRate = 1;
        // Paused, everyone shows the exact same frame (one seek per pause).
        const at = Math.min(party.position, end);
        if (!video.seeking && pausedOn !== at) {
          if (Math.abs(video.currentTime - at) > 0.001) video.currentTime = at;
          pausedOn = at;
        }
        return;
      }
      pausedOn = NaN;
      const wait = party.at - now;
      if (wait > 0) {
        // A play scheduled a moment ahead: wait on its first frame, then start with everyone.
        if (!video.paused) video.pause();
        if (!video.seeking && Math.abs(video.currentTime - party.position) > 0.04) video.currentTime = party.position;
        startTimer = setTimeout(tick, wait);
        return;
      }
      const target = party.position + (now - party.at) / 1000;
      if (target >= end - 0.25) return; // the end: let it finish (playing again would restart it)
      if (video.paused) {
        if (!video.seeking && Math.abs(video.currentTime - target) > 0.08) video.currentTime = target;
        void play();
        return;
      }
      if (video.seeking || video.readyState < 3) return;
      const drift = video.currentTime - target; // positive: ahead of everyone
      if (Math.abs(drift) > 1.5) {
        video.playbackRate = 1;
        video.currentTime = target + 0.2; // a jump takes a moment
      } else if (Math.abs(drift) > 0.03) {
        video.playbackRate = Math.min(1.1, Math.max(0.9, 1 - drift * 0.6));
      } else video.playbackRate = 1;
    };

    const timer = setInterval(tick, 200);
    const off = useParty.subscribe((s, prev) => s.parties[roomId] !== prev.parties[roomId] && tick());
    const onTime = () => usePlayer.setState({ time: video.currentTime, duration: video.duration || 0 });
    const onWaiting = () => usePlayer.setState({ buffering: true });
    const onPlaying = () => usePlayer.setState({ buffering: false });
    const onError = () =>
      usePlayer.setState({
        error: isTauri
          ? 'This movie’s format can’t play here. MP4 (H.264) and WebM play everywhere; some MKV files don’t.'
          : 'This browser can’t play this movie’s format. The Infimeety app plays more formats, or try an MP4 copy.',
      });
    video.addEventListener('loadedmetadata', tick);
    video.addEventListener('canplay', tick);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('durationchange', onTime);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('canplaythrough', onPlaying);
    video.addEventListener('error', onError);
    return () => {
      clearInterval(timer);
      clearTimeout(startTimer);
      off();
      attachPlayer(null);
      video.removeEventListener('loadedmetadata', tick);
      video.removeEventListener('canplay', tick);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('durationchange', onTime);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('canplaythrough', onPlaying);
      video.removeEventListener('error', onError);
    };
  }, [roomId, url]);

  // Subtitles are drawn by us (above the controls, at a readable size), not by the browser.
  useEffect(() => {
    const track = trackRef.current?.track;
    if (!track) return usePlayer.setState({ cue: '' });
    track.mode = 'hidden';
    const onCue = () => {
      const lines = [...(track.activeCues ?? [])].map((c) =>
        (c as VTTCue).text
          .replace(/<[^>]+>/g, '')
          .replace(/\{[^}]*\}/g, '')
          .trim(),
      );
      usePlayer.setState({ cue: lines.filter(Boolean).join('\n') });
    };
    track.addEventListener('cuechange', onCue);
    return () => track.removeEventListener('cuechange', onCue);
  }, [subtitleUrl]);

  return (
    <div className="absolute inset-0 bg-black">
      <video ref={ref} data-stage src={url} playsInline preload="auto" className="h-full w-full object-contain" onDoubleClick={(e) => e.preventDefault()}>
        {subtitleUrl && <track key={subtitleUrl} ref={trackRef} kind="subtitles" src={subtitleUrl} default />}
      </video>
      {captions && cue && (
        <div
          className={clsx(
            'pointer-events-none absolute inset-x-0 flex justify-center px-6 transition-[bottom] duration-300',
            chromeHidden ? 'bottom-[6%]' : 'bottom-[calc(var(--dock-space)+92px)] compact:bottom-[calc(var(--dock-space)+80px)]',
          )}
        >
          <span className="max-w-[min(900px,90%)] whitespace-pre-line rounded-[8px] bg-black/60 px-3 py-1 text-center text-[clamp(16px,2.4vw,32px)] font-medium leading-snug text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">
            {cue}
          </span>
        </div>
      )}
      {buffering && !error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <Spinner size={30} />
        </div>
      )}
      {blocked && (
        <button
          onClick={() => {
            const v = ref.current;
            if (v) void v.play().then(() => usePlayer.setState({ blocked: false }), () => {});
          }}
          className="absolute left-1/2 top-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full bg-accent px-5 py-3 text-[14px] font-semibold text-white shadow-xl"
        >
          <Play size={17} fill="currentColor" /> Tap to join the movie
        </button>
      )}
      {error && (
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="max-w-[420px] rounded-[18px] bg-black/70 p-5 text-center text-white backdrop-blur-md">
            <Film size={26} className="mx-auto opacity-70" />
            <p className="mt-2 text-[13.5px] leading-snug">{error}</p>
            {!isTauri && (
              <a href={DOWNLOAD_PAGE} target="_blank" rel="noopener" className="mt-3 inline-block text-[12.5px] font-semibold text-accent hover:underline">
                Get the Infimeety app →
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Before the movie: get your copy, then say you're ready. The host starts it (ready or not)
 * and whoever wasn't ready, or arrives later, joins in where everyone is.
 */
function PartyLobby({ roomId, party, checking }: { roomId: string; party: PartyState; checking: boolean }) {
  const me = useMe();
  const control = useControls(roomId);
  const host = useChannels((s) => s.users[party.hostId]);
  const owner = useChannels((s) => s.users[party.file.ownerId]);
  const hasCopy = useParty((s) => s.copies[party.file.id]?.state === 'ready');
  const people = useRoomPeople(roomId);
  const ready = party.ready.includes(me ?? '');
  const live = party.phase === 'live';
  const notReady = people.filter((u) => !party.ready.includes(u));
  const [confirming, setConfirming] = useState(false);
  const hosting = isHost(party, me);
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => rerender((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [live]);

  const start = () => {
    if (notReady.length && !confirming) return setConfirming(true);
    setConfirming(false);
    startNow(roomId);
  };

  return (
    <div className="absolute inset-0 overflow-y-auto bg-[radial-gradient(ellipse_at_top,rgba(120,90,255,0.2),transparent_60%)] px-6 pb-[calc(var(--dock-space)+24px)] pt-[72px] text-white compact:px-4 compact:pt-[56px]">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="mx-auto flex w-full max-w-[460px] flex-col items-center text-center">
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-white/70">
          {live ? 'The movie is on' : 'Watch party lobby'}
        </span>
        <h2 className="mt-3 max-w-full truncate font-display text-[20px] font-bold tracking-[-0.02em] compact:text-[17px]">{party.file.name}</h2>
        <p className="mt-0.5 text-[12.5px] text-white/60">
          {formatBytes(party.file.size)} · hosted by {party.hostId === me ? 'you' : (host?.name ?? 'someone')}
          {party.subtitle ? ' · with subtitles' : ''}
        </p>

        {/* Your copy of the movie */}
        <div className="mt-5 w-full rounded-[18px] bg-white/[0.07] p-4 text-left">
          {checking ? (
            <div className="flex items-center gap-2 text-[13px] text-white/70">
              <Spinner size={15} /> Looking for the movie on this device…
            </div>
          ) : hasCopy ? (
            <div className="flex items-center gap-2.5 text-[13px]">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-success">
                <Check size={14} strokeWidth={3} />
              </span>
              <span className="flex-1">You have the movie</span>
              <button onClick={() => void pickOwnCopy(roomId)} className="text-[12px] text-white/55 hover:text-white">
                Use another copy…
              </button>
            </div>
          ) : (
            <CopyMovie roomId={roomId} party={party} owner={owner?.name} mine={party.file.ownerId === me} />
          )}
        </div>

        {live ? (
          // Arrived late, or wasn't ready when it started: join in where everyone is.
          <div className="mt-5 flex flex-col items-center">
            <p className="text-[13px] text-white/75">
              Everyone is at <b className="tabular-nums text-white">{formatTime(expectedPosition(party))}</b>
              {party.playing ? '' : ' (paused)'}
            </p>
            <Button variant="primary" size="lg" className="mt-3" icon={<Play size={16} fill="currentColor" />} disabled={!hasCopy} onClick={() => joinIn(party)}>
              {hasCopy ? `Join them at ${formatTime(expectedPosition(party))}` : 'Get the movie to join in'}
            </Button>
          </div>
        ) : (
          <>
            <Button
              variant={ready ? 'secondary' : 'primary'}
              size="lg"
              className={clsx('mt-5 min-w-[220px]', ready && '!bg-success !text-white')}
              icon={ready ? <Check size={17} strokeWidth={3} /> : undefined}
              disabled={!hasCopy && !ready}
              onClick={() => setReady(roomId, !ready)}
            >
              {ready ? 'Ready (tap to undo)' : hasCopy ? 'I’m ready' : 'Get the movie first'}
            </Button>

            <div className="mt-5 w-full">
              <div className="mb-2 text-left text-[11.5px] font-semibold uppercase tracking-[0.05em] text-white/50">
                {party.ready.filter((u) => people.includes(u)).length} of {people.length} ready
              </div>
              <div className="flex flex-col gap-1">
                {people.map((u) => (
                  <PersonStatus key={u} roomId={roomId} party={party} userId={u} />
                ))}
              </div>
            </div>

            {control ? (
              <div className="mt-5 flex w-full flex-col items-center gap-2">
                {confirming && (
                  <p className="text-[12.5px] text-white/75">
                    {notReady.length === 1 ? `${nameOf(notReady[0])} isn’t` : `${notReady.length} people aren’t`} ready yet. They can join in later, where everyone is.
                  </p>
                )}
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="primary" size="lg" icon={<Play size={16} fill="currentColor" />} onClick={start}>
                    {notReady.length === 0 ? 'Start the movie' : confirming ? 'Start anyway' : `Start (${people.length - notReady.length}/${people.length} ready)`}
                  </Button>
                  {confirming && (
                    <Button variant="secondary" size="lg" className="!bg-white/10 !text-white" onClick={() => setConfirming(false)}>
                      Wait for them
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-5 text-[12.5px] text-white/60">
                {party.settings.autoStart ? 'It starts by itself once everyone’s ready.' : `Waiting for ${host?.name ?? 'the host'} to start it.`}
              </p>
            )}
            {control && party.settings.autoStart && <p className="mt-2 text-[11.5px] text-white/45">Or it starts by itself once everyone’s ready.</p>}
          </>
        )}

        {hosting && (
          <div className="mt-5 flex gap-4 text-[12px]">
            <button onClick={() => openSettings(roomId)} className="flex items-center gap-1.5 text-white/60 hover:text-white">
              <Settings2 size={13} /> Settings
            </button>
            <button onClick={() => endParty(roomId)} className="flex items-center gap-1.5 text-white/60 hover:text-[#ff9b9b]">
              <X size={13} /> End the party
            </button>
          </div>
        )}
        {!isTauri && !checking && !hasCopy && (
          <a href={DOWNLOAD_PAGE} target="_blank" rel="noopener" className="mt-4 text-[11.5px] text-white/50 hover:text-accent">
            Watch parties copy faster and play more formats in the Infimeety app →
          </a>
        )}
      </motion.div>
    </div>
  );
}

/** Copying the movie from the host (or pointing at a copy you already have). */
function CopyMovie({ roomId, party, owner, mine }: { roomId: string; party: PartyState; owner?: string; mine: boolean }) {
  const entry = useMedia((s) => s.items[party.file.id]);
  const saveFolder = useSettings((s) => s.saveFolder ?? s.saveFolderName);
  const status = entry?.status ?? 'idle';
  const busy = status === 'requesting' || status === 'loading' || status === 'waiting' || status === 'saving';
  const failed = status === 'error' || status === 'offline' || status === 'gone';
  const progress = entry?.progress ?? 0;
  const from = owner ?? 'the host';

  if (mine)
    return (
      <div className="flex flex-col gap-2.5 text-[13px] text-white/75">
        <span>Your movie file isn’t on this device anymore. Find it so everyone can copy it.</span>
        <Button variant="primary" className="self-start" icon={<FolderOpen size={15} />} onClick={() => void pickOwnCopy(roomId)}>
          Find the movie file…
        </Button>
      </div>
    );
  if (busy)
    return (
      <div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
          <motion.div className="h-full rounded-full bg-accent" animate={{ width: `${Math.max(2, progress * 100)}%` }} transition={{ duration: 0.3 }} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-white/65">
          <span className="truncate">
            {status === 'requesting'
              ? `Connecting to ${from}…`
              : status === 'waiting'
                ? `${from} is sending to others; you’re next…`
                : status === 'saving'
                  ? 'Finishing…'
                  : `Copying · ${Math.round(progress * 100)}%${pace(entry?.speed, party.file.size * (1 - progress))}`}
          </span>
          <button onClick={() => cancelCopy(party.file.id)} className="shrink-0 font-medium text-white/80 hover:text-white">
            Cancel
          </button>
        </div>
        {entry?.where && <p className="mt-1 truncate text-[11.5px] text-white/45">Saving to {entry.where}</p>}
      </div>
    );
  return (
    <div className="flex flex-col gap-2.5">
      {failed && <p className="text-[12.5px] text-[#ff9b9b]">{status === 'offline' ? `${from} isn’t reachable right now.` : (entry?.problem ?? 'The copy didn’t finish.')}</p>}
      <p className="text-[13px] leading-snug text-white/75">Everyone plays their own copy, so it looks perfect and stays in sync. Copy it straight from {from}’s computer.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={<Film size={15} />} onClick={() => void copyMovie(roomId)}>
          {failed ? 'Try again' : 'Copy the movie'}
        </Button>
        <Button variant="secondary" className="!bg-white/10 !text-white" icon={<FolderOpen size={15} />} onClick={() => void pickOwnCopy(roomId)}>
          I already have it
        </Button>
      </div>
      {saveFolder && <p className="text-[11.5px] text-white/45">Saves to {saveFolder}</p>}
    </div>
  );
}

/** The people in the room, by user, longest-present first. */
function useRoomPeople(roomId: string) {
  const channelId = useVoice((s) => s.channelId);
  const participants = useChannels((s) => (channelId ? s.voice[channelId]?.participants : undefined));
  return [...new Set((participants ?? []).filter((p) => p.roomId === roomId).sort((a, b) => a.joinedAt - b.joinedAt).map((p) => p.userId))];
}

/** One person in the lobby list. */
function PersonStatus({ roomId, party, userId }: { roomId: string; party: PartyState; userId: string }) {
  const user = useChannels((s) => s.users[userId]);
  const me = useMe();
  const copy = useParty((s) => Object.values(s.statuses[roomId] ?? {}).find((x) => x.userId === userId));
  const ready = party.ready.includes(userId);
  return (
    <div className="flex items-center gap-2.5 rounded-[12px] bg-white/[0.05] px-2.5 py-2 text-left">
      <Avatar user={user} size={28} />
      <span className="min-w-0 flex-1 truncate text-[13px]">
        {user?.name ?? 'Someone'}
        {userId === me && <span className="text-white/45"> (you)</span>}
        {party.hostId === userId && <Crown size={12} className="ml-1.5 inline text-[#f5b83d]" />}
      </span>
      {ready ? (
        <span className="flex items-center gap-1 rounded-full bg-success/90 px-2 py-0.5 text-[11.5px] font-semibold">
          <Check size={11} strokeWidth={3} /> Ready
        </span>
      ) : copy?.state === 'ready' ? (
        <span className="text-[11.5px] text-white/60">Has the movie</span>
      ) : copy?.state === 'copying' ? (
        <span className="text-[11.5px] tabular-nums text-white/60">Copying {Math.round((copy.progress ?? 0) * 100)}%</span>
      ) : copy?.state === 'failed' ? (
        <span className="text-[11.5px] text-[#ff9b9b]">Copy failed</span>
      ) : (
        <span className="text-[11.5px] text-white/40">No copy yet</span>
      )}
    </div>
  );
}

/** The host's settings for this party (the planner, for this room). */
function openSettings(roomId: string) {
  const channelId = useVoice.getState().channelId;
  if (channelId) useUI.getState().set({ partyPlanner: { channelId, roomId, edit: true } });
}

// ─── Controls ────────────────────────────────────────────────────────────────

const typing = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
};

export function PartyControls({ roomId, party }: { roomId: string; party: PartyState }) {
  const control = useControls(roomId);
  const me = useMe();
  const time = usePlayer((s) => s.time);
  const duration = usePlayer((s) => s.duration);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const captions = usePlayer((s) => s.captions);
  const ready = useParty((s) => s.copies[party.file.id]?.state === 'ready');
  const [menu, setMenu] = useState<Anchor | null>(null);
  const [, rerender] = useState(0);

  // Without a copy of our own, the time still follows the shared timeline.
  useEffect(() => {
    if (ready) return;
    const t = setInterval(() => rerender((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [ready]);
  const position = ready ? time : party.playing ? party.position + Math.max(0, serverNow() - party.at) / 1000 : party.position;
  const length = duration || 0;

  const seek = (to: number) => {
    const position = Math.max(0, length ? Math.min(length - 0.5, to) : to);
    // Someone who doesn't control playback, asking while paused, is asking to watch from there.
    const action: PartyAction = !control && !party.playing ? { kind: 'play', position } : { kind: 'seek', position };
    act(roomId, action);
  };
  const toggle = () => act(roomId, party.playing ? { kind: 'pause' } : { kind: 'play' });
  const skip = (by: number) => seek(position + by);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      // Space on a focused button presses that button.
      if (e.key === ' ' && (e.target as HTMLElement | null)?.closest('button')) return;
      if (e.key === ' ' || e.key === 'k') (e.preventDefault(), toggle());
      else if (e.key === 'ArrowLeft' || e.key === 'j') (e.preventDefault(), skip(-10));
      else if (e.key === 'ArrowRight' || e.key === 'l') (e.preventDefault(), skip(10));
      else if (e.key === 'c') usePlayer.setState((s) => ({ captions: !s.captions }));
      else if (e.key === 'm') usePlayer.setState((s) => ({ muted: !s.muted }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const setVolume = (v: number) => {
    usePlayer.setState({ volume: v, muted: v === 0 });
    try {
      localStorage.setItem(VOLUME_KEY, String(v));
    } catch {
      /* private mode */
    }
  };
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const asks = control ? '' : ' (asks the host)';

  return (
    <div className="absolute inset-x-0 bottom-[var(--dock-space)] z-20 bg-gradient-to-t transition-[bottom] duration-200 from-black/80 via-black/45 to-transparent px-5 pb-3 pt-10 text-white compact:px-3 compact:pb-2 compact:pt-8">
      <SeekBar position={position} duration={length} onSeek={seek} />
      <div className="mt-1.5 flex items-center gap-1 compact:gap-0.5">
        <Control label={`Start over${asks}`} onClick={() => seek(0)} className="compact:hidden">
          <SkipBack size={17} />
        </Control>
        <Control label={`Back 10 seconds${asks}`} onClick={() => skip(-10)}>
          <RotateCcw size={18} />
        </Control>
        <Control label={party.playing ? `Pause${asks}` : `Play${asks}`} onClick={toggle} big>
          {party.playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="translate-x-px" />}
        </Control>
        <Control label={`Forward 10 seconds${asks}`} onClick={() => skip(10)}>
          <RotateCw size={18} />
        </Control>
        <span className="ml-2 whitespace-nowrap text-[12.5px] tabular-nums text-white/85 compact:ml-1 compact:text-[11.5px]">
          {formatTime(position)}
          {length > 0 && <span className="text-white/50"> / {formatTime(length)}</span>}
        </span>
        {!control && (
          <span className="ml-2 flex min-w-0 items-center gap-1 truncate text-[11.5px] text-white/55 compact:hidden">
            <Shield size={12} className="shrink-0" /> The host and co-hosts control playback; your taps ask them
          </span>
        )}
        <div className="flex-1" />
        <div className="group flex items-center compact:hidden">
          <div className="w-0 overflow-hidden opacity-0 transition-all duration-200 group-hover:w-[96px] group-hover:opacity-100">
            <Slider value={muted ? 0 : volume} onChange={setVolume} className="w-[88px]" />
          </div>
          <Control label={muted ? 'Unmute the movie' : 'Mute the movie'} onClick={() => usePlayer.setState({ muted: !muted })}>
            <VolumeIcon size={18} />
          </Control>
        </div>
        {party.subtitle && (
          <Control label={captions ? 'Hide subtitles' : 'Show subtitles'} onClick={() => usePlayer.setState({ captions: !captions })}>
            {captions ? <Captions size={18} /> : <CaptionsOff size={18} />}
          </Control>
        )}
        <Control label="More" onClick={(el) => setMenu(el.getBoundingClientRect())}>
          <Ellipsis size={18} />
        </Control>
      </div>

      <Popover open={!!menu} anchor={menu} onClose={() => setMenu(null)} side="top" align="end" offset={10} className="w-[250px] p-1.5">
        {control && (
          <MenuItem icon={<Subtitles size={15} />} onClick={() => (setMenu(null), void addSubtitles(roomId))}>
            {party.subtitle ? 'Change subtitles…' : 'Add subtitles…'}
          </MenuItem>
        )}
        {control && party.subtitle && (
          <MenuItem icon={<CaptionsOff size={15} />} onClick={() => (setMenu(null), removeSubtitles(roomId))}>
            Remove subtitles for everyone
          </MenuItem>
        )}
        <MenuItem icon={<FolderOpen size={15} />} onClick={() => (setMenu(null), void pickOwnCopy(roomId))}>
          Play a different copy of this movie…
        </MenuItem>
        {isHost(party, me) && (
          <MenuItem icon={<Settings2 size={15} />} onClick={() => (setMenu(null), openSettings(roomId))}>
            Watch party settings…
          </MenuItem>
        )}
        {control && (
          <>
            <MenuSeparator />
            <MenuItem danger icon={<X size={15} />} onClick={() => (setMenu(null), endParty(roomId))}>
              End the watch party
            </MenuItem>
          </>
        )}
      </Popover>
    </div>
  );
}

function SeekBar({ position, duration, onSeek }: { position: number; duration: number; onSeek: (t: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<{ t: number; x: number } | null>(null);
  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return { t: f * duration, x: f * r.width };
  };
  const shown = drag ?? position;
  const pct = duration ? Math.min(100, (shown / duration) * 100) : 0;

  return (
    <div
      ref={ref}
      role="slider"
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={formatTime(shown)}
      className={clsx('group relative flex h-5 items-center', duration ? 'cursor-pointer' : 'pointer-events-none opacity-60')}
      onPointerDown={(e) => {
        if (!duration) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(at(e.clientX).t);
      }}
      onPointerMove={(e) => {
        if (!duration) return;
        const p = at(e.clientX);
        setHover(p);
        if (drag !== null) setDrag(p.t);
      }}
      onPointerUp={() => {
        if (drag !== null) onSeek(drag);
        setDrag(null);
      }}
      onPointerCancel={() => setDrag(null)}
      onPointerLeave={() => setHover(null)}
    >
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/25 transition-[height] group-hover:h-1.5">
        <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <div
        className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow opacity-0 transition-opacity group-hover:opacity-100"
        style={{ left: `${pct}%`, opacity: drag !== null ? 1 : undefined }}
      />
      {(hover || drag !== null) && duration > 0 && (
        <span
          className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded-[6px] bg-black/80 px-1.5 py-0.5 text-[11.5px] tabular-nums text-white"
          style={{ left: drag !== null ? `${pct}%` : hover!.x }}
        >
          {formatTime(drag ?? hover!.t)}
        </span>
      )}
    </div>
  );
}

function Control({ label, onClick, big, className, children }: { label: string; onClick: (el: HTMLButtonElement) => void; big?: boolean; className?: string; children: ReactNode }) {
  return (
    <Tooltip label={label}>
      <motion.button
        aria-label={label}
        whileTap={{ scale: 0.88 }}
        onClick={(e) => onClick(e.currentTarget)}
        className={clsx('grid shrink-0 place-items-center rounded-full transition-colors hover:bg-white/15', big ? 'h-11 w-11 bg-white/10' : 'h-9 w-9', className)}
      >
        {children}
      </motion.button>
    </Tooltip>
  );
}

// ─── Requests (to the host and co-hosts) ─────────────────────────────────────

export function PartyRequests({ roomId }: { roomId: string }) {
  const requests = useParty((s) => s.requests);
  const control = useControls(roomId);
  const mine = requests.filter((r) => r.roomId === roomId);
  // Unanswered requests fade away after a while.
  useEffect(() => {
    if (!mine.length) return;
    const t = setInterval(() => {
      for (const r of useParty.getState().requests) if (Date.now() - r.at > 30_000) dismiss(r.id);
    }, 2000);
    return () => clearInterval(t);
  }, [mine.length]);
  if (!control) return null;
  return (
    <div className="absolute left-4 top-[64px] z-40 flex w-[320px] max-w-[calc(100%-32px)] flex-col gap-2 compact:left-2.5 compact:top-[54px]">
      <AnimatePresence initial={false}>
        {mine.map((r) => (
          <RequestCard key={r.id} r={r} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function RequestCard({ r }: { r: PartyRequest }) {
  const user = useChannels((s) => s.users[r.from]);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16, transition: { duration: 0.18 } }}
      transition={spring}
      className="flex items-center gap-2.5 rounded-[16px] bg-black/75 p-2.5 text-white shadow-xl backdrop-blur-md"
    >
      <Avatar user={user} size={32} />
      <div className="min-w-0 flex-1 text-[12.5px] leading-snug">
        <span className="font-semibold">{user?.name ?? 'Someone'}</span> <span className="text-white/75">asks to</span> <span className="font-semibold">{describe(r.action).toLowerCase()}</span>
      </div>
      <button onClick={() => accept(r)} className="h-8 shrink-0 rounded-full bg-accent px-3 text-[12px] font-semibold hover:brightness-110">
        Accept
      </button>
      <Tooltip label="Dismiss">
        <button aria-label="Dismiss" onClick={() => dismiss(r.id)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20">
          <X size={14} />
        </button>
      </Tooltip>
    </motion.div>
  );
}

// ─── People: status and roles ────────────────────────────────────────────────

/** Next to each person in the People tab: host / co-host, and how far along their copy is. */
export function PartyPersonExtra({ roomId, party, p }: { roomId: string; party: PartyState; p: VoiceParticipant }) {
  const status = useParty((s) => s.statuses[roomId]?.[p.peerId]);
  const me = useMe();
  // Roles only matter once the room is bigger than OPEN_LIMIT, but they're shown either way.
  const host = party.hostId === p.userId;
  const cohost = party.cohosts.includes(p.userId);
  const big = roomPeople(roomId).length > OPEN_LIMIT;
  const control = party.settings?.control ?? 'auto';
  const cohostHint =
    control === 'everyone' ? 'Everyone controls playback in this party.' : control === 'auto' && !big ? `Co-hosts matter once more than ${OPEN_LIMIT} people are here.` : undefined;
  const isReady = party.ready.includes(p.userId);
  return (
    <>
      {host && (
        <span className="flex items-center gap-0.5 font-medium text-[#f5b83d]">
          <Crown size={11} /> Host
        </span>
      )}
      {cohost && (
        <span className="flex items-center gap-0.5 font-medium text-accent">
          <Shield size={11} /> Co-host
        </span>
      )}
      {party.phase === 'lobby' && isReady ? (
        <span className="font-medium text-success">Ready</span>
      ) : (
        status?.state === 'ready' && <span className={party.phase === 'live' ? 'text-success' : undefined}>Has the movie</span>
      )}
      {status?.state === 'copying' && <span>Copying {Math.round((status.progress ?? 0) * 100)}%</span>}
      {status?.state === 'choosing' && <span>No copy yet</span>}
      {status?.state === 'failed' && <span className="text-danger">Copy failed</span>}
      {party.hostId === me && p.userId !== me && (
        <button
          onClick={() => setCohost(roomId, p.userId, !cohost)}
          title={cohostHint}
          className="ml-auto shrink-0 rounded-full bg-fill-2 px-2 py-0.5 text-[11px] font-medium text-fg-2 hover:bg-fill-3 hover:text-fg"
        >
          {cohost ? 'Remove co-host' : 'Make co-host'}
        </button>
      )}
    </>
  );
}

export function PartyBadge() {
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-[6px] bg-accent px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white">
      <Popcorn size={11} /> WATCH PARTY
    </span>
  );
}

/** Header: who's hosting, and how many have the movie. */
export function PartyHeaderInfo({ roomId, party }: { roomId: string; party: PartyState }) {
  const host = useChannels((s) => s.users[party.hostId]);
  const people = useRoomPeople(roomId);
  const ready = party.ready.filter((u) => people.includes(u)).length;
  return (
    <span className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px] text-white/65 sm:flex">
      <Crown size={12} className="text-[#f5b83d]" /> {host?.name ?? nameOf(party.hostId)}
      {party.phase === 'lobby' && (
        <>
          <span className="text-white/35">·</span> lobby, {ready}/{people.length} ready
        </>
      )}
    </span>
  );
}
