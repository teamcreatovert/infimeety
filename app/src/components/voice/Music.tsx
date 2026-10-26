import clsx from 'clsx';
import { Music2, Pause, Play, Plus, SkipBack, SkipForward, Square, Volume2, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { MusicState } from '../../../../shared/protocol';
import { Slider } from '../ui/primitives';
import { addMusic, controlMusic, musicPosition, useRoomMusic, youtubeId } from '@/lib/music';
import { spring } from '@/lib/motion';
import { syncClock } from '@/lib/party';
import { useChannels } from '@/stores/channels';
import { useSettings } from '@/stores/settings';
import { toast, useUI } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

const NOCOOKIE = 'https://www.youtube-nocookie.com';

/**
 * The room's music, playing in YouTube's own player (it must stay visible, at least 200×200).
 * Everyone's player follows the hub's queue and clock; a drifting player is nudged back.
 */
export function MusicPlayer() {
  const state = useRoomMusic();
  const hidden = useUI((s) => s.musicHidden);
  const track = state?.queue[state.index];
  useEffect(() => {
    if (track) syncClock();
  }, [track?.id]);
  if (!state || !track || hidden) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring}
      className="absolute bottom-[calc(var(--dock-space,88px)+12px)] left-4 z-30 w-[244px] overflow-hidden rounded-[18px] glass-pop compact:bottom-auto compact:left-2 compact:top-[56px]"
    >
      <Player key={track.id} state={state} />
    </motion.div>
  );
}

function Player({ state }: { state: MusicState }) {
  const track = state.queue[state.index];
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const player = useRef({ time: 0, state: -1, endedSent: false });
  const volume = useSettings((s) => s.musicVolume);
  const deafened = useVoice((s) => s.deafened);
  const adder = useChannels((s) => s.users[track.by]?.name);
  const latest = useRef(state);
  latest.current = state;

  const post = (message: object) => frame.current?.contentWindow?.postMessage(JSON.stringify({ ...message, id: 1, channel: 'widget' }), NOCOOKIE);
  const command = (func: string, args: unknown[] = []) => post({ event: 'command', func, args });

  // The player talks back over postMessage: ready, where it is, and when the song ends.
  useEffect(() => {
    const ended = () => {
      if (player.current.endedSent) return;
      player.current.endedSent = true;
      controlMusic({ action: 'ended', trackId: track.id });
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      let data: { event?: string; info?: unknown };
      try {
        data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      if (data.event === 'onReady' || data.event === 'initialDelivery') setReady(true);
      if (data.event === 'onError') {
        toast({ kind: 'error', title: 'YouTube won’t play that one here', body: 'Skipping to the next song.' });
        ended();
      }
      const info = data.info as { currentTime?: number; playerState?: number } | number | undefined;
      // Play/pause/end arrive as their own event; position as periodic info.
      if (data.event === 'onStateChange' && typeof info === 'number') {
        player.current.state = info;
        if (info === 0) ended();
      }
      if (data.event === 'infoDelivery' && info && typeof info === 'object') {
        if (typeof info.currentTime === 'number') player.current.time = info.currentTime;
        if (typeof info.playerState === 'number') {
          player.current.state = info.playerState;
          if (info.playerState === 0) ended();
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [track.id]);

  // Follow the hub: play or pause where everyone is. A seek right after a pause lands while the
  // player still counts as playing and starts it again, so a pause seeks only once it has
  // settled, and only if it's noticeably off.
  useEffect(() => {
    if (!ready) return;
    const at = musicPosition(state);
    if (state.playing) {
      command('seekTo', [at, true]);
      command('playVideo');
      return;
    }
    command('pauseVideo');
    const settle = setTimeout(() => {
      if (Math.abs(player.current.time - at) > 1.5) command('seekTo', [at, true]);
    }, 600);
    return () => clearTimeout(settle);
  }, [ready, state.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every few seconds, nudge a player that drifted (buffering, a slow start) back in step.
  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => {
      const s = latest.current;
      const want = musicPosition(s);
      // Playing for everyone but stopped here (a click in YouTube's player, a stall): catch up.
      if (s.playing && player.current.state === 2) {
        command('seekTo', [want, true]);
        command('playVideo');
      } else if (!s.playing && player.current.state === 1) command('pauseVideo');
      else if (s.playing && player.current.state === 1 && Math.abs(player.current.time - want) > 2.5) command('seekTo', [want, true]);
    }, 3000);
    return () => clearInterval(t);
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready) return;
    command('setVolume', [Math.round(volume * 100)]);
    command(deafened ? 'mute' : 'unMute');
  }, [ready, volume, deafened]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = Math.floor(musicPosition(state));
  const src = `${NOCOOKIE}/embed/${track.videoId}?enablejsapi=1&autoplay=1&controls=0&disablekb=1&modestbranding=1&playsinline=1&rel=0&start=${start}&origin=${encodeURIComponent(location.origin)}`;

  return (
    <>
      <div className="bg-black">
        <iframe
          ref={frame}
          title={track.title}
          src={src}
          width={244}
          height={200}
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => post({ event: 'listening' })}
          className="block border-0"
        />
      </div>
      <div className="px-3 pb-2.5 pt-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-semibold" title={track.title}>
              {track.title}
            </div>
            <div className="truncate text-[11px] text-fg-3">
              {adder ? `Added by ${adder}` : 'From YouTube'} · {state.index + 1} of {state.queue.length}
            </div>
          </div>
          <button aria-label="Close the player (for you)" title="Close the player (for you)" onClick={() => useUI.getState().set({ musicHidden: true })} className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-fg-3 hover:bg-fill-2 hover:text-fg">
            <X size={13} />
          </button>
        </div>
        <div className="mt-1.5 flex items-center gap-1">
          <ControlButton label="Previous" onClick={() => controlMusic({ action: 'previous' })}>
            <SkipBack size={15} fill="currentColor" />
          </ControlButton>
          <ControlButton label={state.playing ? 'Pause for everyone' : 'Play for everyone'} big onClick={() => controlMusic({ action: state.playing ? 'pause' : 'play' })}>
            {state.playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          </ControlButton>
          <ControlButton label="Next" onClick={() => controlMusic({ action: 'next' })}>
            <SkipForward size={15} fill="currentColor" />
          </ControlButton>
          <Volume2 size={13} className="ml-1.5 shrink-0 text-fg-3" />
          <Slider value={volume} onChange={(v) => useSettings.getState().set({ musicVolume: v })} className="min-w-0 flex-1" />
        </div>
      </div>
    </>
  );
}

function ControlButton({ label, big, onClick, children }: { label: string; big?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} className={clsx('grid shrink-0 place-items-center rounded-full transition-colors', big ? 'h-8 w-8 bg-fg text-[var(--bg)] hover:opacity-90' : 'h-7 w-7 text-fg-2 hover:bg-fill-2 hover:text-fg')}>
      {children}
    </button>
  );
}

/** The music sheet from the call's controls: add a link, see and change the queue. */
export function MusicPanel({ onClose }: { onClose: () => void }) {
  const state = useRoomMusic();
  const hidden = useUI((s) => s.musicHidden);
  const users = useChannels((s) => s.users);
  const [link, setLink] = useState('');
  const upcoming = state ? state.queue.map((t, i) => ({ t, i })).filter(({ i }) => i >= state.index) : [];

  const add = () => {
    const id = youtubeId(link);
    if (!id) return toast({ kind: 'error', title: 'That isn’t a YouTube link', body: 'Paste a link from YouTube or YouTube Music.' });
    addMusic(id);
    setLink('');
    useUI.getState().set({ musicHidden: false });
  };

  return (
    <div className="w-[320px] p-3">
      <div className="flex items-baseline justify-between px-0.5">
        <span className="text-[13.5px] font-semibold">Music</span>
        <span className="text-[11px] text-fg-3">Everyone in the call hears it</span>
      </div>
      <form
        className="mt-2.5 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="Paste a YouTube or YouTube Music link"
          className="field h-9 min-w-0 flex-1 px-3 text-[13px]"
          autoFocus
        />
        <button type="submit" aria-label="Add to the queue" className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-accent text-white disabled:opacity-40" disabled={!link.trim()}>
          <Plus size={16} />
        </button>
      </form>

      {upcoming.length > 0 ? (
        <div className="mt-3">
          <div className="mb-1 px-0.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-fg-3">Queue</div>
          <div className="scroll max-h-[220px] space-y-0.5" style={{ scrollbarGutter: 'auto' }}>
            {upcoming.map(({ t, i }) => (
              <div key={t.id} className={clsx('group/song flex items-center gap-2 rounded-[10px] px-2 py-1.5', i === state!.index ? 'bg-fill-2' : 'hover:bg-fill-1')}>
                <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => i !== state!.index && controlMusic({ action: 'skipTo', trackId: t.id })}>
                  <img src={`https://i.ytimg.com/vi/${t.videoId}/default.jpg`} alt="" className="h-8 w-11 shrink-0 rounded-[5px] object-cover" />
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium">
                      {i === state!.index && <Music2 size={11} className="mr-1 inline text-accent" />}
                      {t.title}
                    </span>
                    <span className="block truncate text-[11px] text-fg-3">{users[t.by]?.name ?? 'Someone'}</span>
                  </span>
                </button>
                <button aria-label={`Remove ${t.title}`} onClick={() => controlMusic({ action: 'remove', trackId: t.id })} className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-fg-3 opacity-0 hover:bg-fill-3 hover:text-fg group-hover/song:opacity-100 touch:opacity-100">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between">
            {hidden ? (
              <button onClick={() => useUI.getState().set({ musicHidden: false })} className="text-[12px] font-medium text-accent hover:underline">
                Show the player
              </button>
            ) : (
              <span />
            )}
            <button
              onClick={() => {
                onClose();
                controlMusic({ action: 'stop' });
              }}
              className="flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium text-danger hover:bg-fill-2"
            >
              <Square size={11} fill="currentColor" /> Stop for everyone
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-3 px-0.5 text-[12px] leading-snug text-fg-3">Songs play in YouTube’s own player, in sync for everyone in the call. Anyone can pause, skip or add to the queue.</p>
      )}
    </div>
  );
}
