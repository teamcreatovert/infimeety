import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import {
  AudioLines,
  Captions,
  CaptionsOff,
  Check,
  ChevronDown,
  List as ListIcon,
  Lock,
  Search,
  SunMedium,
  Crown,
  Ellipsis,
  Film,
  FolderOpen,
  Pause,
  Phone,
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
import { partyRules, type Channel, type PartyAction, type PartyState, type Room, type VoiceParticipant } from '../../../../shared/protocol';
import { pace } from '../chat/AttachmentView';
import { Avatar } from '../ui/Avatar';
import { LobbyCard } from './Lobby';
import { WebCard } from './WebWatch';
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
  answerVote,
  describeProposal,
  proposeForEveryone,
  proposeSubtitle,
  useVotes,
  setBuffering,
  inspectCopy,
  repackForMac,
  useLocalTracks,
  useConverting,
  useEmbedded,
  chooseEmbeddedSubtitle,
  useParty,
  type PartyRequest,
} from '@/lib/party';
import { isApp, isPhoneApp, isTauri } from '@/lib/platform';
import { toggleImmersive } from '@/lib/immersive';
import { useCompact } from '@/lib/responsive';
import { useWeb } from '@/lib/watchWeb';
import { cancelCopy } from '@/lib/transfer';
import { voice } from '@/lib/voice/engine';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { useMedia } from '@/stores/media';
import { useSettings } from '@/stores/settings';
import { toast, useUI } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

/**
 * The watch party's screen: getting a copy of the movie, the synced player, its controls,
 * and the requests people send the host when they don't control playback themselves.
 */

const VOLUME_KEY = 'infimeety.partyVolume';
const NO_EMBEDDED: { label: string; file: { id: string } }[] = [];
const NO_TRACKS: { label: string; url: string }[] = [];

type AudioTracks = { length: number; [i: number]: { label: string; language: string; enabled: boolean } };
let stage: HTMLVideoElement | null = null;
const audioTracksOf = (v: HTMLVideoElement | null) => (v as (HTMLVideoElement & { audioTracks?: AudioTracks }) | null)?.audioTracks;

/** Plays sound track `i` on this device (the movie's other tracks go quiet). */
function pickAudio(i: number) {
  const tracks = audioTracksOf(stage);
  if (!tracks) return;
  for (let n = 0; n < tracks.length; n++) tracks[n].enabled = n === i;
  usePlayer.setState({ audio: i });
}

function nudgeSubtitles(by: number) {
  const subDelay = Math.round((usePlayer.getState().subDelay + by) * 100) / 100;
  usePlayer.setState({ subDelay });
  toast({ kind: 'info', title: subDelay === 0 ? 'Subtitles on time' : `Subtitles ${subDelay > 0 ? 'later' : 'earlier'} by ${Math.abs(subDelay).toFixed(2)} s` });
}

/** Your own brightness; `null`: back to the room's. */
function setBrightness(brightness: number | null) {
  usePlayer.setState({ brightness: brightness ?? 1, brightnessMine: brightness !== null });
  try {
    if (brightness === null) localStorage.removeItem('infimeety.partyBrightness');
    else localStorage.setItem('infimeety.partyBrightness', String(brightness));
  } catch {
    /* private mode */
  }
}

/** Your own color; `null`: back to the room's. */
function setSaturation(saturation: number | null) {
  usePlayer.setState({ saturation: saturation ?? 1, saturationMine: saturation !== null });
  try {
    if (saturation === null) localStorage.removeItem('infimeety.partySaturation');
    else localStorage.setItem('infimeety.partySaturation', String(saturation));
  } catch {
    /* private mode */
  }
}

function setSubSize(subSize: 'small' | 'medium' | 'large') {
  usePlayer.setState({ subSize });
  try {
    localStorage.setItem('infimeety.subSize', subSize);
  } catch {
    /* private mode */
  }
}

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
  /** Subtitle timing, seconds (positive: later), and size. This device only. */
  subDelay: number;
  subSize: 'small' | 'medium' | 'large';
  /** The movie's sound tracks (dual audio), and which one plays here. */
  audios: string[];
  audio: number;
  /** This device's own subtitle choice: a built-in track's URL, 'off', or null for the party's. */
  mySub: string | null;
  /** How bright the picture looks here (0.5 to 1.5). This device only, like the volume. */
  brightness: number;
  /** Picked here (not the room's agreed one): the sound track and brightness. */
  audioMine: boolean;
  brightnessMine: boolean;
  /** Color (0 grey to 2 vivid), just for you when the rules allow. */
  saturation: number;
  saturationMine: boolean;
  /** The last skip, for the "+10s" bubble. */
  skip: { by: number; at: number } | null;
  /** The menu changes things just for you, or for everyone (the host directly, anyone else by vote). */
  scope: 'me' | 'all';
}>()(() => ({
  time: 0,
  duration: 0,
  buffering: false,
  blocked: false,
  error: null,
  volume: Math.min(2, Number(localStorage.getItem(VOLUME_KEY) ?? 1) || 1),
  muted: false,
  captions: true,
  cue: '',
  subDelay: 0,
  audios: [],
  audio: 0,
  mySub: null,
  audioMine: false,
  brightnessMine: localStorage.getItem('infimeety.partyBrightness') !== null,
  saturation: Math.min(2, Math.max(0, Number(localStorage.getItem('infimeety.partySaturation') ?? 1))),
  saturationMine: localStorage.getItem('infimeety.partySaturation') !== null,
  skip: null,
  scope: 'me',
  brightness: Math.min(1.5, Math.max(0.5, Number(localStorage.getItem('infimeety.partyBrightness') ?? 1) || 1)),
  subSize: (localStorage.getItem('infimeety.subSize') as 'small' | 'medium' | 'large' | null) ?? 'medium',
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
        <PartyPlayer key={copy.url} roomId={roomId} fileId={party.file.id} url={copy.url} subtitleId={party.subtitle?.id} chromeHidden={chromeHidden} />
        <Countdown party={party} />
        <SkipBubble />
      </>
    );
  return <PartyLobby roomId={roomId} party={party} checking={!copy || copy.state === 'checking'} />;
}

/** Is this device watching the movie along (so it shows the player and its controls)? */
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
  // A start, and every play after a pause, is 3 s ahead: count it down. Seeks while playing (0.4 s) don't.
  if (left < 700 || !partyRules(party.settings).countdown) return null;
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

function PartyPlayer({ roomId, fileId, url, subtitleId, chromeHidden }: { roomId: string; fileId: string; url: string; subtitleId?: string; chromeHidden: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLTrackElement>(null);
  const settings = useParty((s) => s.parties[roomId]?.settings);
  const rules = partyRules(settings).personal;
  const partySubtitle = useParty((s) => (subtitleId ? s.subtitles[subtitleId] : undefined));
  const mySub = usePlayer((s) => s.mySub);
  const subtitleUrl = !rules.subtitles ? partySubtitle : mySub === 'off' ? undefined : (mySub ?? partySubtitle);
  const partyBrightness = useParty((s) => s.parties[roomId]?.brightness);
  const partySaturation = useParty((s) => s.parties[roomId]?.saturation);
  const partyAudio = useParty((s) => s.parties[roomId]?.audio);
  const brightnessMine = usePlayer((s) => s.brightnessMine);
  const myBrightness = usePlayer((s) => s.brightness);
  const saturationMine = usePlayer((s) => s.saturationMine);
  const mySaturation = usePlayer((s) => s.saturation);
  const shownBrightness = rules.brightness && brightnessMine ? myBrightness : (partyBrightness ?? 1);
  const shownSaturation = rules.saturation && saturationMine ? mySaturation : (partySaturation ?? 1);
  const look = [shownBrightness !== 1 && `brightness(${shownBrightness})`, shownSaturation !== 1 && `saturate(${shownSaturation})`].filter(Boolean).join(' ');
  const audioMine = usePlayer((s) => s.audioMine);
  const trackCount = usePlayer((s) => s.audios.length);
  useEffect(() => {
    // The host locked the sound: back to the room's track.
    if (!rules.audio && audioMine) usePlayer.setState({ audioMine: false });
    const mine = rules.audio && audioMine;
    if (!mine && trackCount > 0) pickAudio(partyAudio !== undefined && partyAudio < trackCount ? partyAudio : 0);
  }, [partyAudio, trackCount, rules.audio, audioMine]);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const blocked = usePlayer((s) => s.blocked);
  const buffering = usePlayer((s) => s.buffering);
  const error = usePlayer((s) => s.error);
  const captionsPref = usePlayer((s) => s.captions);
  // Locked subtitles show for everyone.
  const captions = rules.subtitles ? captionsPref : true;
  const cue = usePlayer((s) => s.cue);
  const subSize = usePlayer((s) => s.subSize);

  // Past 100% (up to 200%, like VLC) the sound goes through Web Audio to be boosted; once routed
  // there it stays (an element can't be unrouted), with the gain doing all the volume.
  const boost = useRef<{ ctx: AudioContext; gain: GainNode } | null>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = muted;
    if (volume > 1 && !boost.current) {
      try {
        const ctx = new AudioContext();
        const gain = ctx.createGain();
        ctx.createMediaElementSource(video).connect(gain).connect(ctx.destination);
        boost.current = { ctx, gain };
      } catch {
        /* stays at 100% */
      }
    }
    if (boost.current) {
      video.volume = 1;
      boost.current.gain.gain.value = volume;
      void boost.current.ctx.resume().catch(() => {});
    } else video.volume = Math.min(1, volume);
  }, [volume, muted]);
  useEffect(() => () => void boost.current?.ctx.close().catch(() => {}), []);

  // Keep this copy on the shared timeline.
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    attachPlayer(video);
    usePlayer.setState({ time: 0, duration: 0, buffering: false, blocked: false, error: null, cue: '' });
    let startTimer: ReturnType<typeof setTimeout> | undefined;
    let pausedOn = NaN;
    // A big MKV can take seconds to seek: jumping to "now" lands behind again, forever (the endless
    // spinner). Jumps aim ahead by how long the last one took, and at most one per few seconds;
    // in between, a slightly faster or slower speed closes the gap.
    let lead = 0.2;
    let lastJump = 0;
    let seekFrom = 0;
    const onSeeking = () => (seekFrom = performance.now());
    const onSeeked = () => (lead = Math.min(4, Math.max(0.2, ((performance.now() - seekFrom) / 1000) * 1.3)));
    stage = video;

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
      if (Math.abs(drift) > 1.5 && performance.now() - lastJump > 4000) {
        lastJump = performance.now();
        video.playbackRate = 1;
        video.currentTime = target + lead; // a jump takes a moment
      } else if (Math.abs(drift) > 0.03) {
        video.playbackRate = Math.min(1.25, Math.max(0.8, 1 - drift * 0.6));
      } else video.playbackRate = 1;
    };

    const timer = setInterval(tick, 200);
    const off = useParty.subscribe((s, prev) => s.parties[roomId] !== prev.parties[roomId] && tick());
    const onTime = () => usePlayer.setState({ time: video.currentTime, duration: video.duration || 0 });
    // Loading for more than a moment while the movie plays: tell the room, so it waits for us.
    let loadTimer: ReturnType<typeof setTimeout> | undefined;
    const onWaiting = () => {
      usePlayer.setState({ buffering: true });
      clearTimeout(loadTimer);
      loadTimer = setTimeout(() => useParty.getState().parties[roomId]?.playing && setBuffering(roomId, true), 700);
    };
    const onPlaying = () => {
      usePlayer.setState({ buffering: false });
      clearTimeout(loadTimer);
      setBuffering(roomId, false);
    };
    // Sound tracks (dual audio): the ones the engine reports, named by language.
    const onTracks = () => {
      const tracks = audioTracksOf(video);
      if (!tracks) return;
      const audios = Array.from({ length: tracks.length }, (_, i) => tracks[i].label || tracks[i].language || `Track ${i + 1}`);
      const on = Math.max(0, audios.findIndex((_, i) => tracks[i].enabled));
      usePlayer.setState({ audios, audio: on });
    };
    const onError = () =>
      // A Mac can't open MKV: make this device a copy it plays (repackForMac), then play that.
      void repackForMac(fileId).then((ok) => !ok && usePlayer.setState({
        error: isTauri
          ? 'This movie’s format can’t play here. MP4 (H.264) and WebM play everywhere; some MKV files don’t.'
          : isPhoneApp
            ? 'This movie’s format can’t play on this phone. Try an MP4 (H.264) copy.'
            : 'This browser can’t play this movie’s format. The Infimeety app plays more formats, or try an MP4 copy.',
      }));
    video.addEventListener('loadedmetadata', tick);
    video.addEventListener('loadedmetadata', onTracks);
    video.addEventListener('seeking', onSeeking);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('canplay', tick);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('durationchange', onTime);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('canplaythrough', onPlaying);
    video.addEventListener('canplay', onPlaying);
    video.addEventListener('error', onError);
    return () => {
      clearInterval(timer);
      clearTimeout(startTimer);
      clearTimeout(loadTimer);
      setBuffering(roomId, false);
      off();
      attachPlayer(null);
      if (stage === video) stage = null;
      usePlayer.setState({ audios: [], audio: 0 });
      video.removeEventListener('loadedmetadata', tick);
      video.removeEventListener('loadedmetadata', onTracks);
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('canplay', tick);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('durationchange', onTime);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('canplaythrough', onPlaying);
      video.removeEventListener('canplay', onPlaying);
      video.removeEventListener('error', onError);
    };
  }, [roomId, url]);

  // Subtitles are drawn by us (above the controls, at a readable size), not by the browser.
  useEffect(() => {
    const track = trackRef.current?.track;
    const video = ref.current;
    if (!track || !video) return usePlayer.setState({ cue: '' });
    track.mode = 'hidden';
    const onCue = () => {
      // The lines on screen at this moment, moved by the subtitle timing.
      const own = partyRules(useParty.getState().parties[roomId]?.settings).personal.subtitles;
      const t = video.currentTime - (own ? usePlayer.getState().subDelay : 0);
      const active = [...(track.cues ?? [])].filter((c) => c.startTime <= t && c.endTime > t);
      const lines = active.map((c) =>
        (c as VTTCue).text
          .replace(/<[^>]+>/g, '')
          .replace(/\{[^}]*\}/g, '')
          .trim(),
      );
      usePlayer.setState({ cue: lines.filter(Boolean).join('\n') });
    };
    const timer = setInterval(onCue, 100);
    return () => clearInterval(timer);
  }, [subtitleUrl, roomId]);

  return (
    <div className="absolute inset-0 bg-black">
      {/* crossOrigin: the 200% boost reads the sound through Web Audio, which gets silence from a file it may not read. */}
      <video ref={ref} data-stage src={url} crossOrigin="anonymous" playsInline preload="auto" className="h-full w-full object-contain" style={look ? { filter: look } : undefined} onDoubleClick={(e) => (e.preventDefault(), toggleImmersive())}>
        {subtitleUrl && <track key={subtitleUrl} ref={trackRef} kind="subtitles" src={subtitleUrl} default />}
      </video>
      {captions && cue && (
        <div
          className={clsx(
            'pointer-events-none absolute inset-x-0 flex justify-center px-6 transition-[bottom] duration-300',
            chromeHidden ? 'bottom-[6%]' : 'bottom-[calc(var(--dock-space)+92px)] compact:bottom-[calc(var(--dock-space)+80px)]',
          )}
        >
          <span
            className={clsx(
              'max-w-[min(900px,90%)] whitespace-pre-line rounded-[8px] bg-black/60 px-3 py-1 text-center font-medium leading-snug text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]',
              subSize === 'small' ? 'text-[clamp(13px,1.8vw,24px)]' : subSize === 'large' ? 'text-[clamp(20px,3.2vw,44px)]' : 'text-[clamp(16px,2.4vw,32px)]',
            )}
          >
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
            {!isApp && (
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

/** Re-renders twice a second while the movie is on, so "everyone is at 12:34" keeps time. */
function useTick(on: boolean) {
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => rerender((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [on]);
}

/** Opens the side panel on its Watch party tab. */
const openPartyTab = () => useUI.getState().set({ voiceChat: true, sideTab: 'party' });

/**
 * The stage before the movie (or before you join in): a calm poster with the one thing to do
 * next. Getting ready in detail (your copy, who's ready, settings) lives in the side panel's
 * Watch party tab.
 */
function PartyLobby({ roomId, party, checking }: { roomId: string; party: PartyState; checking: boolean }) {
  const me = useMe();
  const control = useControls(roomId);
  const host = useChannels((s) => s.users[party.hostId]);
  const users = useChannels((s) => s.users);
  const hasCopy = useParty((s) => s.copies[party.file.id]?.state === 'ready');
  // Is the Watch party tab on screen next to (or, on phones, under) the stage? Then the buttons
  // live there and the poster only says where things stand.
  const compact = useCompact();
  const panelOnParty = useUI((s) => s.sideTab === 'party' && (compact || (s.voiceChat && !s.immersive && s.watchLayout === 'theater')));
  const converting = useConverting((s) => s[party.file.id] as number | undefined);
  const people = useRoomPeople(roomId);
  const live = party.phase === 'live';
  const ready = party.ready.includes(me ?? '');
  const readyCount = party.ready.filter((u) => people.includes(u)).length;
  useTick(live);

  return (
    <div className="absolute inset-0 grid place-items-center overflow-y-auto bg-[radial-gradient(ellipse_at_top,rgba(120,90,255,0.2),transparent_60%)] px-6 pb-[calc(var(--dock-space)+24px)] pt-[72px] text-white compact:px-4 compact:pt-[56px]">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="flex w-full max-w-[440px] flex-col items-center text-center">
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-white/70">
          {live ? 'The movie is on' : 'Watch party lobby'}
        </span>
        <span className="mt-5 grid h-16 w-16 place-items-center rounded-[20px] bg-white/10 shadow-[inset_0_0.5px_0_rgba(255,255,255,0.25)] compact:mt-3 compact:h-12 compact:w-12">
          <Popcorn size={30} className="compact:hidden" />
          <Popcorn size={22} className="hidden compact:block" />
        </span>
        <h2 className="mt-3 max-w-full truncate font-display text-[22px] font-bold tracking-[-0.02em] compact:text-[17px]">{party.file.name}</h2>
        <p className="mt-0.5 text-[12.5px] text-white/60">
          {formatBytes(party.file.size)} · hosted by {party.hostId === me ? 'you' : (host?.name ?? 'someone')}
          {party.subtitle ? ' · with subtitles' : ''}
        </p>

        <div className="mt-4 flex items-center gap-2.5">
          <div className="flex -space-x-2">
            {people.slice(0, 5).map((u) => (
              <span key={u} className="rounded-full shadow-[0_0_0_2px_rgba(0,0,0,0.6)]">
                <Avatar user={users[u]} size={26} />
              </span>
            ))}
          </div>
          <span className="text-[12.5px] text-white/70">
            {live ? (
              <>
                Everyone is at <b className="tabular-nums text-white">{formatTime(expectedPosition(party))}</b>
                {party.playing ? '' : ' (paused)'}
              </>
            ) : (
              `${readyCount} of ${people.length} ready`
            )}
          </span>
        </div>

        {converting !== undefined && (
          <div className="mt-4 w-[min(280px,80%)]">
            <div className="mb-1.5 text-[12.5px] text-white/75">Making the sound playable… {Math.round(converting * 100)}%</div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
              <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(3, converting * 100)}%` }} />
            </div>
          </div>
        )}
        {panelOnParty ? (
          <p className="mt-5 text-[12.5px] text-white/55">{compact ? 'Get ready in the Watch party tab below' : 'Get ready in the Watch party panel →'}</p>
        ) : (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {checking ? (
            <span className="flex items-center gap-2 text-[13px] text-white/70">
              <Spinner size={15} /> Looking for the movie on this device…
            </span>
          ) : !hasCopy ? (
            <Button variant="primary" size="lg" icon={<Film size={16} />} onClick={openPartyTab}>
              Get the movie
            </Button>
          ) : live ? (
            <Button variant="primary" size="lg" icon={<Play size={16} fill="currentColor" />} onClick={() => joinIn(party)}>
              Join them at {formatTime(expectedPosition(party))}
            </Button>
          ) : (
            <>
              <ReadyButton roomId={roomId} ready={ready} size="lg" />
              {control && <StartButton roomId={roomId} party={party} people={people} size="lg" onStage />}
            </>
          )}
        </div>
        )}
        {!panelOnParty && !live && !control && hasCopy && (
          <p className="mt-3 text-[12px] text-white/55">{party.settings.autoStart ? 'It starts by itself once everyone’s ready.' : `${host?.name ?? 'The host'} starts it.`}</p>
        )}
        {!panelOnParty && (
          <button onClick={openPartyTab} className="mt-4 text-[12px] text-white/55 hover:text-white">
            {checking || hasCopy ? 'Who’s ready, settings and more →' : 'Copy it or pick your own copy →'}
          </button>
        )}
      </motion.div>
    </div>
  );
}

function ReadyButton({ roomId, ready, size, className }: { roomId: string; ready: boolean; size?: 'md' | 'lg'; className?: string }) {
  return (
    <Button
      variant={ready ? 'secondary' : 'primary'}
      size={size}
      className={clsx('min-w-[160px]', ready && '!bg-success !text-white', className)}
      icon={ready ? <Check size={16} strokeWidth={3} /> : undefined}
      onClick={() => setReady(roomId, !ready)}
    >
      {ready ? 'Ready (tap to undo)' : 'I’m ready'}
    </Button>
  );
}

/** Start the movie; with people not ready yet, it asks once ("Start anyway"). */
function StartButton({ roomId, party, people, size, onStage, className }: { roomId: string; party: PartyState; people: string[]; size?: 'md' | 'lg'; onStage?: boolean; className?: string }) {
  const [confirming, setConfirming] = useState(false);
  const notReady = people.filter((u) => !party.ready.includes(u));
  const start = () => {
    if (notReady.length && !confirming) return setConfirming(true);
    setConfirming(false);
    startNow(roomId);
  };
  return (
    <>
      <Button variant={confirming || notReady.length === 0 ? 'primary' : 'secondary'} size={size} className={clsx(onStage && notReady.length > 0 && !confirming && '!bg-white/10 !text-white', className)} icon={<Play size={15} fill="currentColor" />} onClick={start}>
        {notReady.length === 0 ? 'Start the movie' : confirming ? 'Start anyway' : `Start (${people.length - notReady.length}/${people.length} ready)`}
      </Button>
      {confirming && (
        <p className={clsx('w-full text-[12px]', onStage ? 'text-white/70' : 'text-fg-2')}>
          {notReady.length === 1 ? `${nameOf(notReady[0])} isn’t` : `${notReady.length} people aren’t`} ready yet. They can join in later, where everyone is.{' '}
          <button onClick={() => setConfirming(false)} className={clsx('font-medium', onStage ? 'text-white hover:underline' : 'text-accent hover:underline')}>
            Wait for them
          </button>
        </p>
      )}
    </>
  );
}

// ─── The side panel's Watch party tab ───────────────────────────────────────────

/** The Watch party tab: plan one, or everything about getting ready for the one that's on. */
export function PartyPanel({ channel, room }: { channel: Channel; room: Room }) {
  const party = useParty((s) => s.parties[room.id]);
  const web = useWeb((s) => !!s.webs[room.id]);
  const inLobby = useUI((s) => s.lobby === room.id);
  // Outside the lobby: start or join it. Inside: what's playing, and who's along.
  if (!inLobby) return <LobbyCard channel={channel} room={room} />;
  if (web) return <WebCard channel={channel} roomId={room.id} />;
  return party ? <PartyDetails channel={channel} room={room} party={party} /> : <LobbyCard channel={channel} room={room} />;
}


function PartyDetails({ channel, room, party }: { channel: Channel; room: Room; party: PartyState }) {
  const roomId = room.id;
  const me = useMe();
  const inRoom = useVoice((s) => s.roomId === roomId);
  const control = useControls(roomId);
  const host = useChannels((s) => s.users[party.hostId]);
  const owner = useChannels((s) => s.users[party.file.ownerId]);
  const copy = useParty((s) => s.copies[party.file.id]);
  const joined = useParty((s) => !!s.joined[party.id]);
  const people = useRoomPeople(roomId);
  const live = party.phase === 'live';
  const ready = party.ready.includes(me ?? '');
  const hasCopy = copy?.state === 'ready';
  const checking = !copy || copy.state === 'checking';
  const hosting = isHost(party, me);
  useTick(live);
  // The stage looks for your copy too; this covers the panel open over the call view.
  useEffect(() => {
    if (inRoom) void prepare(roomId);
  }, [inRoom, roomId, party.file.id]);

  const status = live ? (party.playing ? `Playing · ${formatTime(expectedPosition(party))}` : `Paused at ${formatTime(expectedPosition(party))}`) : 'In the lobby';

  return (
    <div className="scroll h-full px-3 pb-5 pt-3" style={{ scrollbarGutter: 'auto' }}>
      <div className="flex items-center gap-3 rounded-[14px] bg-fill-1 p-3 shadow-[inset_0_0_0_0.5px_var(--hairline)]">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-accent text-white">
          <Popcorn size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold">{party.file.name}</div>
          <div className="truncate text-[11.5px] tabular-nums text-fg-3">
            {status} · {formatBytes(party.file.size)}
            {party.subtitle ? ' · subtitles' : ''}
          </div>
          <div className="mt-0.5 flex items-center gap-1 truncate text-[11.5px] text-fg-3">
            <Crown size={11} className="shrink-0 text-[#f5b83d]" /> {party.hostId === me ? 'You’re hosting' : `${host?.name ?? 'Someone'} is hosting`}
          </div>
        </div>
      </div>

      {!inRoom ? (
        <div className="mt-4 rounded-[14px] bg-fill-1 p-3.5 text-[12.5px] leading-snug text-fg-2">
          Join the call to get the movie and watch along.
          <Button variant="primary" size="sm" className="mt-3 w-full" icon={<Phone size={14} />} onClick={() => void voice.join(channel.id, roomId)}>
            Join the call
          </Button>
        </div>
      ) : (
        <>
          <PanelSection title="Your copy">
            {checking ? (
              <div className="flex items-center gap-2 text-[12.5px] text-fg-2">
                <Spinner size={14} /> Looking for the movie on this device…
              </div>
            ) : hasCopy ? (
              <div className="flex items-center gap-2.5 text-[13px]">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-success text-white">
                  <Check size={12} strokeWidth={3} />
                </span>
                <span className="flex-1">You have the movie</span>
                <button onClick={() => void pickOwnCopy(roomId)} className="text-[12px] text-fg-3 hover:text-accent">
                  Use another copy…
                </button>
              </div>
            ) : (
              <CopyMovie roomId={roomId} party={party} owner={owner?.name} mine={party.file.ownerId === me} />
            )}
          </PanelSection>

          {live ? (
            !joined && (
              <Button variant="primary" className="mt-3 w-full" icon={<Play size={15} fill="currentColor" />} disabled={!hasCopy} onClick={() => joinIn(party)}>
                {hasCopy ? `Join them at ${formatTime(expectedPosition(party))}` : 'Get the movie to join in'}
              </Button>
            )
          ) : (
            hasCopy && <ReadyButton roomId={roomId} ready={ready} className="mt-3 w-full" />
          )}
        </>
      )}

      <PanelSection title={live ? `${people.length} in the room` : `${party.ready.filter((u) => people.includes(u)).length} of ${people.length} ready`}>
        <div className="-mx-1 flex flex-col gap-0.5">
          {people.map((u) => (
            <PersonStatus key={u} roomId={roomId} party={party} userId={u} />
          ))}
          {people.length === 0 && <p className="px-1 text-[12px] text-fg-3">Nobody’s in the call yet.</p>}
        </div>
      </PanelSection>

      {!live && inRoom && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {control ? (
            <StartButton roomId={roomId} party={party} people={people} className="w-full" />
          ) : (
            <p className="text-[12px] text-fg-3">{party.settings.autoStart ? 'It starts by itself once everyone’s ready.' : `Waiting for ${host?.name ?? 'the host'} to start it.`}</p>
          )}
          {control && party.settings.autoStart && <p className="text-[11.5px] text-fg-3">Or it starts by itself once everyone’s ready.</p>}
        </div>
      )}

      {hosting && (
        <div className="mt-4 flex gap-2">
          <Button size="sm" className="flex-1" icon={<Settings2 size={13} />} onClick={() => openSettings(roomId)}>
            Settings
          </Button>
          <Button size="sm" variant="soft-danger" className="flex-1" icon={<X size={13} />} onClick={() => endParty(roomId)}>
            End the party
          </Button>
        </div>
      )}
      {!isApp && inRoom && !checking && !hasCopy && (
        <a href={DOWNLOAD_PAGE} target="_blank" rel="noopener" className="mt-4 block text-[11.5px] text-fg-3 hover:text-accent">
          Watch parties copy faster and play more formats in the Infimeety app →
        </a>
      )}
    </div>
  );
}

function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h4 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-fg-3">{title}</h4>
      <div className="rounded-[14px] bg-fill-1 p-3 shadow-[inset_0_0_0_0.5px_var(--hairline)]">{children}</div>
    </section>
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
      <div className="flex flex-col gap-2.5 text-[12.5px] leading-snug text-fg-2">
        <span>Your movie file isn’t on this device anymore. Find it so everyone can copy it.</span>
        <Button variant="primary" size="sm" className="self-start" icon={<FolderOpen size={14} />} onClick={() => void pickOwnCopy(roomId)}>
          Find the movie file…
        </Button>
      </div>
    );
  if (busy)
    return (
      <div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-fill-3">
          <motion.div className="h-full rounded-full bg-accent" animate={{ width: `${Math.max(2, progress * 100)}%` }} transition={{ duration: 0.3 }} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-fg-2">
          <span className="truncate">
            {status === 'requesting'
              ? `Connecting to ${from}…`
              : status === 'waiting'
                ? `${from} is sending to others; you’re next…`
                : status === 'saving'
                  ? 'Finishing…'
                  : `Copying · ${Math.round(progress * 100)}%${pace(entry?.speed, party.file.size * (1 - progress))}`}
          </span>
          <button onClick={() => cancelCopy(party.file.id)} className="shrink-0 font-medium text-fg hover:text-accent">
            Cancel
          </button>
        </div>
        {entry?.where && <p className="mt-1 truncate text-[11.5px] text-fg-3">Saving to {entry.where}</p>}
      </div>
    );
  return (
    <div className="flex flex-col gap-2.5">
      {failed && <p className="text-[12px] text-danger">{status === 'offline' ? `${from} isn’t reachable right now.` : (entry?.problem ?? 'The copy didn’t finish.')}</p>}
      <p className="text-[12.5px] leading-snug text-fg-2">Everyone plays their own copy, so it looks perfect and stays in sync. Copy it straight from {from}’s computer.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" icon={<Film size={14} />} onClick={() => void copyMovie(roomId)}>
          {failed ? 'Try again' : 'Copy the movie'}
        </Button>
        <Button size="sm" icon={<FolderOpen size={14} />} onClick={() => void pickOwnCopy(roomId)}>
          I already have it
        </Button>
      </div>
      {saveFolder && <p className="text-[11.5px] text-fg-3">Saves to {saveFolder}</p>}
    </div>
  );
}

/** The people in the room, by user, longest-present first. */
function useRoomPeople(roomId: string) {
  const channelId = useVoice((s) => s.channelId);
  const participants = useChannels((s) => (channelId ? s.voice[channelId]?.participants : undefined));
  return [...new Set((participants ?? []).filter((p) => p.roomId === roomId).sort((a, b) => a.joinedAt - b.joinedAt).map((p) => p.userId))];
}

/** One person in the Watch party tab's list. */
function PersonStatus({ roomId, party, userId }: { roomId: string; party: PartyState; userId: string }) {
  const user = useChannels((s) => s.users[userId]);
  const me = useMe();
  const copy = useParty((s) => Object.values(s.statuses[roomId] ?? {}).find((x) => x.userId === userId));
  const ready = party.ready.includes(userId);
  return (
    <div className="flex items-center gap-2.5 rounded-[10px] px-1 py-1.5 text-left">
      <Avatar user={user} size={26} />
      <span className="min-w-0 flex-1 truncate text-[13px]">
        {user?.name ?? 'Someone'}
        {userId === me && <span className="text-fg-3"> (you)</span>}
        {party.hostId === userId && <Crown size={12} className="ml-1.5 inline text-[#f5b83d]" />}
      </span>
      {ready && party.phase === 'lobby' ? (
        <span className="flex items-center gap-1 rounded-full bg-success px-2 py-0.5 text-[11px] font-semibold text-white">
          <Check size={11} strokeWidth={3} /> Ready
        </span>
      ) : copy?.state === 'ready' ? (
        <span className="text-[11.5px] text-fg-3">Has the movie</span>
      ) : copy?.state === 'copying' ? (
        <span className="text-[11.5px] tabular-nums text-fg-3">Copying {Math.round((copy.progress ?? 0) * 100)}%</span>
      ) : copy?.state === 'failed' ? (
        <span className="text-[11.5px] text-danger">Copy failed</span>
      ) : (
        <span className="text-[11.5px] text-fg-3">No copy yet</span>
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
  const subDelay = usePlayer((s) => s.subDelay);
  const subSize = usePlayer((s) => s.subSize);
  const brightness = usePlayer((s) => s.brightness);
  const embedded = useEmbedded((s) => s[party.file.id] ?? NO_EMBEDDED);
  const audios = usePlayer((s) => s.audios);
  const audio = usePlayer((s) => s.audio);
  const mySub = usePlayer((s) => s.mySub);
  const myTracks = useLocalTracks((s) => s[party.file.id] ?? NO_TRACKS);
  const scope = usePlayer((s) => s.scope);
  const saturation = usePlayer((s) => s.saturation);
  const rules = partyRules(party.settings);
  const ready = useParty((s) => s.copies[party.file.id]?.state === 'ready');
  // This device's own MKV copy: its subtitle tracks, for the "just for you" menu.
  useEffect(() => {
    if (ready) void inspectCopy(party.file.id, party.file.name);
  }, [ready, party.file.id, party.file.name]);
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
  const skip = (by: number) => {
    showSkip(by);
    seek(position + by);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.altKey) return;
      // Ctrl only goes with the arrows (a minute, like VLC).
      if (e.ctrlKey && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      // Space on a focused button presses that button.
      if (e.key === ' ' && (e.target as HTMLElement | null)?.closest('button')) return;
      const by = e.ctrlKey ? 60 : e.shiftKey ? 3 : 10;
      if (e.key === ' ' || e.key === 'k') (e.preventDefault(), toggle());
      else if (e.key === 'ArrowLeft' || e.key === 'j') (e.preventDefault(), skip(-by));
      else if (e.key === 'ArrowRight' || e.key === 'l') (e.preventDefault(), skip(by));
      else if (e.key === 'f') (e.preventDefault(), toggleImmersive());
      else if (e.key === 'Home') (e.preventDefault(), seek(0));
      // VLC: B the next sound track, V the next subtitles (just for you, when the rules allow).
      else if (e.key === 'b' && audios.length > 1 && rules.personal.audio) {
        usePlayer.setState({ audioMine: true });
        pickAudio((audio + 1) % audios.length);
      } else if (e.key === 'v' && rules.personal.subtitles) {
        const order: (string | null)[] = [null, ...myTracks.map((t) => t.url), 'off'];
        const next = order[(order.indexOf(mySub) + 1) % order.length];
        usePlayer.setState({ mySub: next, captions: next !== 'off' });
      }
      else if (e.key === 'c' && rules.personal.subtitles) usePlayer.setState((s) => ({ captions: !s.captions }));
      else if (e.key === 'm') usePlayer.setState((s) => ({ muted: !s.muted }));
      else if (e.key === 'ArrowUp') (e.preventDefault(), setVolume(Math.min(2, Math.round((volume + 0.05) * 100) / 100)));
      else if (e.key === 'ArrowDown') (e.preventDefault(), setVolume(Math.max(0, Math.round((volume - 0.05) * 100) / 100)));
      // VLC: G earlier, H later. Shown for a moment.
      else if ((e.key === 'g' || e.key === 'h') && rules.personal.subtitles) nudgeSubtitles(e.key === 'g' ? -0.05 : 0.05);
      // 0 to 9 jump to that tenth of the movie.
      else if (/^[0-9]$/.test(e.key) && length) seek((Number(e.key) / 10) * length);
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
  const admin = useIsPartyAdmin(party);
  const [subsMenu, setSubsMenu] = useState<Anchor | null>(null);
  const [sub, setSub] = useState<{ kind: SubMenu; anchor: Anchor } | null>(null);
  const closeAll = () => (setMenu(null), setSubsMenu(null), setSub(null));
  const openSub = (kind: SubMenu) => (el: HTMLElement) => setSub((s) => (s?.kind === kind ? null : { kind, anchor: el.getBoundingClientRect() }));

  // "Everyone" is offered to whoever may change things for everyone (directly or by vote).
  const canEveryone = control || rules.changes !== 'hosts';
  const forAll = canEveryone && scope === 'all';
  const everyoneLabel = control || rules.changes === 'anyone' ? 'Everyone' : 'Everyone (vote)';
  const scopeSwitch = canEveryone && (
    <div className="mb-1 flex gap-1 rounded-[9px] bg-fill-1 p-0.5">
      {(['me', 'all'] as const).map((s) => (
        <button
          key={s}
          onClick={() => (usePlayer.setState({ scope: s }), setSub(null))}
          className={clsx('flex-1 rounded-[7px] py-1 text-[12px] font-medium', scope === s ? 'bg-accent text-white' : 'text-fg-2 hover:bg-fill-2')}
        >
          {s === 'me' ? 'Just me' : everyoneLabel}
        </button>
      ))}
    </div>
  );

  // Subtitles: yours, or everyone's.
  const subItems: Choice[] = forAll
    ? [
        ...(party.subtitle ? [{ key: 'off', label: 'Off for everyone' }] : []),
        ...(embedded.length === 0 ? myTracks.map((t) => ({ key: `url:${t.url}`, label: t.label })) : []),
        ...embedded.map((s) => ({ key: `file:${s.file.id}`, label: s.label })),
      ]
    : [
        { key: 'party', label: party.subtitle ? 'Same as everyone' : 'None' },
        ...myTracks.map((t) => ({ key: `url:${t.url}`, label: t.label })),
        ...(party.subtitle || myTracks.length ? [{ key: 'off', label: 'Off' }] : []),
      ];
  const subNow = forAll ? (party.subtitle ? `file:${party.subtitle.id}` : 'off') : mySub === null ? 'party' : mySub === 'off' ? 'off' : `url:${mySub}`;
  const subLocked = !forAll && !rules.personal.subtitles;
  const pickSub = (key: string) => {
    closeAll();
    const label = subItems.find((i) => i.key === key)?.label ?? 'Subtitles';
    if (forAll) {
      if (key === 'off') return void proposeSubtitle(roomId, 'Off', null);
      if (key.startsWith('url:')) return void proposeSubtitle(roomId, label, key.slice(4));
      const file = embedded.find((s) => `file:${s.file.id}` === key)?.file;
      if (file) chooseEmbeddedSubtitle(roomId, file);
      return;
    }
    if (key === 'party') usePlayer.setState({ mySub: null, captions: true });
    else if (key === 'off') usePlayer.setState({ mySub: 'off' });
    else usePlayer.setState({ mySub: key.slice(4), captions: true });
  };
  const subLabel = subItems.find((i) => i.key === subNow)?.label ?? 'None';

  // Sound tracks (dual audio and more).
  const audioItems: Choice[] = audios.map((label, i) => ({ key: String(i), label }));
  const audioLocked = !forAll && !rules.personal.audio;
  const pickAudioTrack = (key: string) => {
    closeAll();
    const i = Number(key);
    if (forAll) return proposeForEveryone(roomId, { kind: 'audio', index: i, label: audios[i] ?? `Track ${i + 1}` });
    usePlayer.setState({ audioMine: true });
    pickAudio(i);
  };
  const hasSubtitles = !!party.subtitle || myTracks.length > 0 || embedded.length > 0;

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-5 pb-[calc(var(--dock-space)+12px)] pt-10 text-white compact:px-3 compact:pb-[calc(var(--dock-space)+8px)] compact:pt-8">
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
            <Slider value={muted ? 0 : volume / 2} onChange={(v) => setVolume(Math.round(v * 200) / 100)} className="w-[88px]" />
          </div>
          <Control label={muted ? 'Unmute the movie' : `Mute the movie (volume ${Math.round(volume * 100)}%)`} onClick={() => usePlayer.setState({ muted: !muted })}>
            <VolumeIcon size={18} />
          </Control>
        </div>
        {hasSubtitles && (
          <Control label={`Subtitles: ${subLabel}`} onClick={(el) => setSubsMenu(el.getBoundingClientRect())}>
            {captions && subNow !== 'off' ? <Captions size={18} /> : <CaptionsOff size={18} />}
          </Control>
        )}
        <Control label="More" onClick={(el) => setMenu(el.getBoundingClientRect())}>
          <Ellipsis size={18} />
        </Control>
      </div>

      {/* Subtitles: the current one and a few others; the full list opens beside it. */}
      <Popover open={!!subsMenu} anchor={subsMenu} onClose={closeAll} side="top" align="end" offset={10} className="w-[250px] p-1.5">
        {scopeSwitch}
        <div className="px-2 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-fg-3">{forAll ? 'Subtitles for everyone' : 'Subtitles'}</div>
        {subLocked ? (
          <Locked>The host picked the subtitles for everyone: {subLabel}</Locked>
        ) : (
          <QuickChoices items={subItems} current={subNow} onPick={pickSub} limit={4} more={`All subtitles (${subItems.length})`} onMore={openSub('subsAll')} moreOpen={sub?.kind === 'subsAll'} />
        )}
        {!subLocked && !forAll && subNow !== 'off' && (
          <>
            <MenuSeparator />
            <MenuItem icon={captions ? <CaptionsOff size={15} /> : <Captions size={15} />} onClick={() => usePlayer.setState({ captions: !captions })}>
              {captions ? 'Hide subtitles for now' : 'Show subtitles'}
            </MenuItem>
          </>
        )}
      </Popover>

      {/* More: one short row per thing, each opening its own little window. */}
      <Popover open={!!menu} anchor={menu} onClose={closeAll} side="top" align="end" offset={10} className="w-[250px] p-1.5">
        {scopeSwitch}
        {forAll && rules.changes === 'vote' && !control && <p className="px-2 pb-1.5 text-[11.5px] leading-snug text-fg-3">Changes for everyone need everyone in the room to say yes.</p>}
        {audios.length > 1 && <MenuRow icon={<AudioLines size={15} />} label="Audio" value={audios[audio] ?? ''} onClick={openSub('audio')} open={sub?.kind === 'audio'} />}
        <MenuRow icon={<SunMedium size={15} />} label="Picture" value={forAll ? 'For everyone' : `${Math.round(brightness * 100)}%`} onClick={openSub('picture')} open={sub?.kind === 'picture'} />
        {(party.subtitle || mySub) && (
          <MenuRow icon={<Subtitles size={15} />} label="Subtitle timing and size" value={subDelay === 0 ? '' : `${subDelay > 0 ? '+' : ''}${subDelay.toFixed(2)} s`} onClick={openSub('subtitleLook')} open={sub?.kind === 'subtitleLook'} />
        )}
        <MenuRow icon={<Popcorn size={15} />} label="Watch party" onClick={openSub('party')} open={sub?.kind === 'party'} />
      </Popover>

      <Popover open={!!sub} anchor={sub?.anchor ?? null} onClose={() => setSub(null)} side="left" align="end" offset={8} layer className="w-[260px] p-1.5">
        {sub?.kind === 'subsAll' && <AllChoices items={subItems} current={subNow} onPick={pickSub} noun="subtitles" />}
        {sub?.kind === 'audio' &&
          (audioLocked ? (
            <Locked>The host picked the sound for everyone: {audios[audio] ?? 'track 1'}</Locked>
          ) : (
            <>
              <div className="px-2 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-fg-3">{forAll ? 'Sound for everyone' : 'Sound (just for you)'}</div>
              <AllChoices items={audioItems} current={String(audio)} onPick={pickAudioTrack} noun="sound tracks" />
            </>
          ))}
        {sub?.kind === 'picture' &&
          (forAll ? (
            <div className="px-2 py-1.5">
              <Presets
                title="Brightness for everyone"
                options={[
                  ['Darker', 0.8],
                  ['Normal', 1],
                  ['Brighter', 1.2],
                ]}
                onPick={(value) => (closeAll(), proposeForEveryone(roomId, { kind: 'brightness', value }))}
              />
              <div className="h-2.5" />
              <Presets
                title="Color for everyone"
                options={[
                  ['Less', 0.6],
                  ['Normal', 1],
                  ['More', 1.4],
                ]}
                onPick={(value) => (closeAll(), proposeForEveryone(roomId, { kind: 'saturation', value }))}
              />
            </div>
          ) : (
            <div className="px-2 py-1.5">
              {rules.personal.brightness ? (
                <SliderRow label="Brightness" value={brightness} min={0.5} max={1.5} onChange={setBrightness} onReset={() => setBrightness(null)} />
              ) : (
                <Locked>Brightness is the same for everyone</Locked>
              )}
              <div className="h-2.5" />
              {rules.personal.saturation ? (
                <SliderRow label="Color" value={saturation} min={0} max={2} onChange={setSaturation} onReset={() => setSaturation(null)} />
              ) : (
                <Locked>Color is the same for everyone</Locked>
              )}
            </div>
          ))}
        {sub?.kind === 'subtitleLook' && (
          <div className="px-2 py-1.5">
            {rules.personal.subtitles ? (
              <>
                <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
                  <span>Timing</span>
                  <span className="tabular-nums text-fg-3">{subDelay === 0 ? 'on time' : `${subDelay > 0 ? '+' : ''}${subDelay.toFixed(2)} s`}</span>
                </div>
                <div className="flex gap-1">
                  {(
                    [
                      ['Earlier', -0.25],
                      ['Reset', 0],
                      ['Later', 0.25],
                    ] as const
                  ).map(([label, by]) => (
                    <button key={label} onClick={() => (by === 0 ? usePlayer.setState({ subDelay: 0 }) : nudgeSubtitles(by))} className="flex-1 rounded-[7px] bg-fill-2 py-1 text-[12px] hover:bg-fill-3">
                      {label}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <Locked>Subtitle timing is the same for everyone</Locked>
            )}
            <div className="mb-1.5 mt-2.5 text-[12.5px]">Size</div>
            <div className="flex gap-1">
              {(['small', 'medium', 'large'] as const).map((size) => (
                <button key={size} onClick={() => setSubSize(size)} className={clsx('flex-1 rounded-[7px] py-1 text-[12px] capitalize', subSize === size ? 'bg-accent text-white' : 'bg-fill-2 hover:bg-fill-3')}>
                  {size}
                </button>
              ))}
            </div>
          </div>
        )}
        {sub?.kind === 'party' && (
          <>
            {control && (
              <MenuItem icon={<Subtitles size={15} />} onClick={() => (closeAll(), void addSubtitles(roomId))}>
                {party.subtitle ? 'Change subtitles…' : 'Add subtitles…'}
              </MenuItem>
            )}
            {control && party.subtitle && (
              <MenuItem icon={<CaptionsOff size={15} />} onClick={() => (closeAll(), removeSubtitles(roomId))}>
                Remove subtitles for everyone
              </MenuItem>
            )}
            <MenuItem icon={<FolderOpen size={15} />} onClick={() => (closeAll(), void pickOwnCopy(roomId))}>
              Play a different copy of this movie…
            </MenuItem>
            {(isHost(party, me) || admin) && (
              <MenuItem icon={<Settings2 size={15} />} onClick={() => (closeAll(), openSettings(roomId))}>
                Watch party settings and rules…
              </MenuItem>
            )}
            {control && (
              <>
                <MenuSeparator />
                <MenuItem danger icon={<X size={15} />} onClick={() => (closeAll(), endParty(roomId))}>
                  End the watch party
                </MenuItem>
              </>
            )}
          </>
        )}
      </Popover>
    </div>
  );
}

type SubMenu = 'subsAll' | 'audio' | 'picture' | 'subtitleLook' | 'party';
type Choice = { key: string; label: string };

/** A row in the ⋯ menu: what it is, what it's set to, and a little window of its own. */
function MenuRow({ icon, label, value, onClick, open }: { icon: ReactNode; label: string; value?: string; onClick: (el: HTMLElement) => void; open?: boolean }) {
  return (
    <button onClick={(e) => onClick(e.currentTarget)} className={clsx('flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-fill-2', open && 'bg-fill-2')}>
      <span className="shrink-0 text-fg-2">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {value && <span className="max-w-[96px] shrink-0 truncate text-[12px] text-fg-3">{value}</span>}
      <ChevronDown size={14} className={clsx('shrink-0 text-fg-3 transition-transform', open && 'rotate-180')} />
    </button>
  );
}

const Locked = ({ children }: { children: ReactNode }) => (
  <p className="flex items-start gap-1.5 px-2 py-1.5 text-[12px] leading-snug text-fg-3">
    <Lock size={12} className="mt-0.5 shrink-0" /> <span>{children}</span>
  </p>
);

const ChoiceItem = ({ c, current, onPick }: { c: Choice; current: string; onPick: (key: string) => void }) => (
  <MenuItem icon={c.key === current ? <Check size={15} /> : <span className="inline-block w-[15px]" />} onClick={() => onPick(c.key)}>
    {c.label}
  </MenuItem>
);

/** The current choice and a few others; "All …" opens the whole list beside it. */
function QuickChoices({ items, current, onPick, limit, more, onMore, moreOpen }: { items: Choice[]; current: string; onPick: (key: string) => void; limit: number; more: string; onMore: (el: HTMLElement) => void; moreOpen: boolean }) {
  let shown = items.slice(0, limit);
  const now = items.find((c) => c.key === current);
  if (now && !shown.includes(now)) shown = [...shown.slice(0, limit - 1), now];
  return (
    <>
      {shown.map((c) => (
        <ChoiceItem key={c.key} c={c} current={current} onPick={onPick} />
      ))}
      {items.length > limit && <MenuRow icon={<ListIcon size={15} />} label={more} onClick={onMore} open={moreOpen} />}
    </>
  );
}

/** Every choice: scrolls, and gets a search box once the list is long (some movies have dozens). */
function AllChoices({ items, current, onPick, noun }: { items: Choice[]; current: string; onPick: (key: string) => void; noun: string }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((c) => c.label.toLowerCase().includes(q)) : items;
  return (
    <div className="flex flex-col">
      {items.length > 8 && (
        <label className="field mb-1 flex h-8 shrink-0 items-center gap-2 px-2.5">
          <Search size={13} className="text-fg-3" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${noun}`} className="h-full w-full bg-transparent text-[12.5px] outline-none placeholder:text-fg-3" />
        </label>
      )}
      <div className="max-h-[min(320px,50vh)] overflow-y-auto">
        {shown.map((c) => (
          <ChoiceItem key={c.key} c={c} current={current} onPick={onPick} />
        ))}
        {shown.length === 0 && <p className="px-2 py-3 text-center text-[12px] text-fg-3">No {noun} match “{query}”</p>}
      </div>
    </div>
  );
}

function Presets({ title, options, onPick }: { title: string; options: [string, number][]; onPick: (value: number) => void }) {
  return (
    <>
      <div className="mb-1.5 text-[12.5px]">{title}</div>
      <div className="flex gap-1">
        {options.map(([label, value]) => (
          <button key={label} onClick={() => onPick(value)} className="flex-1 rounded-[7px] bg-fill-2 py-1 text-[12px] hover:bg-fill-3">
            {label}
          </button>
        ))}
      </div>
    </>
  );
}

function SliderRow({ label, value, min, max, onChange, onReset }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; onReset: () => void }) {
  return (
    <>
      <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
        <span>{label}</span>
        <button onClick={onReset} title="Back to the room’s" className="tabular-nums text-fg-3 hover:text-fg">
          {Math.round(value * 100)}%
        </button>
      </div>
      <Slider value={(value - min) / (max - min)} onChange={(v) => onChange(Math.round((min + v * (max - min)) * 100) / 100)} className="w-full" />
    </>
  );
}

/** Whether you may open the party's settings and rules: the host, co-hosts, and channel admins and moderators. */
function useIsPartyAdmin(party: PartyState) {
  const me = useMe();
  const channelId = useVoice((s) => s.channelId);
  const role = useChannels((s) => s.channels.find((c) => c.id === channelId)?.role);
  return isHost(party, me) || (!!role && role !== 'member');
}

/** "+10s", "−20s": how far a skip went, adding up while you keep pressing. */
function showSkip(by: number) {
  const prev = usePlayer.getState().skip;
  const keep = !!prev && Date.now() - prev.at < 1000 && Math.sign(prev.by) === Math.sign(by);
  usePlayer.setState({ skip: { by: keep ? prev!.by + by : by, at: Date.now() } });
}

function SkipBubble() {
  const skip = usePlayer((s) => s.skip);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!skip) return;
    setShown(true);
    const t = setTimeout(() => setShown(false), 850);
    return () => clearTimeout(t);
  }, [skip]);
  const forward = (skip?.by ?? 0) > 0;
  return (
    <AnimatePresence>
      {shown && skip && (
        <motion.div
          key={forward ? 'forward' : 'back'}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={spring}
          className={clsx('pointer-events-none absolute top-1/2 z-10 -translate-y-1/2', forward ? 'right-[12%]' : 'left-[12%]')}
        >
          <div className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-full bg-black/50 text-white">
            {forward ? <RotateCw size={24} /> : <RotateCcw size={24} />}
            <span className="text-[15px] font-semibold tabular-nums">
              {forward ? '+' : '−'}
              {Math.abs(skip.by)}s
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
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

/** Someone wants a change for everyone: Yes or No. It happens only if everyone says yes. */
export function PartyVotes({ roomId }: { roomId: string }) {
  const votes = useVotes();
  const me = useMe();
  const users = useChannels((s) => s.users);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const open = Object.entries(votes).filter(([, v]) => v.roomId === roomId);
  if (!open.length) return null;
  return (
    <div className="pointer-events-auto absolute left-1/2 top-[64px] z-40 flex w-[min(360px,90%)] -translate-x-1/2 flex-col gap-2">
      {open.map(([id, v]) => {
        const mine = v.from === me;
        const answered = !!me && v.yes.includes(me);
        const left = Math.max(0, Math.ceil((v.until - Date.now()) / 1000));
        return (
          <div key={id} className="relative rounded-[16px] p-3 text-fg glass-float">
            <div className="text-[13px] leading-snug">
              <b>{mine ? 'You' : (users[v.from]?.name ?? 'Someone')}</b> {mine ? 'asked for' : 'wants'} <b>{describeProposal(v.proposal)}</b> for everyone
            </div>
            <div className="mt-0.5 text-[11.5px] text-fg-3">
              {v.yes.length} said yes · {left}s left
            </div>
            {!answered && (
              <div className="mt-2 flex gap-2">
                <button onClick={() => answerVote(id, true)} className="flex-1 rounded-[9px] bg-success py-1.5 text-[12.5px] font-semibold text-white">
                  Yes
                </button>
                <button onClick={() => answerVote(id, false)} className="flex-1 rounded-[9px] glass-key py-1.5 text-[12.5px] font-semibold">
                  No
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

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
    <span className="flex shrink-0 items-center gap-1 rounded-[6px] bg-white/[0.12] px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white/85">
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
