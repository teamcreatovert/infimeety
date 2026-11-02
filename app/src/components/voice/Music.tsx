import { invoke } from '@tauri-apps/api/core';
import { motion } from 'motion/react';
import { AudioLines, Music2, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { VoiceParticipant } from '../../../../shared/protocol';
import { Avatar } from '../ui/Avatar';
import { Slider, Spinner } from '../ui/primitives';
import { spring } from '@/lib/motion';
import { isTauri, isWindows } from '@/lib/platform';
import { voice } from '@/lib/voice/engine';
import { useChannels } from '@/stores/channels';
import { useSettings } from '@/stores/settings';
import { useVoice } from '@/stores/voice';

/** Share music works where the app can record one program's sound: the Windows app. */
export const canShareMusic = isTauri && isWindows;

interface AudioApp {
  pid: number;
  name: string;
  title: string;
}

/** Pick the app whose sound the room hears (Spotify, a browser playing YouTube Music...). */
export function MusicPicker({ busy, onDone }: { busy?: string; onDone: () => void }) {
  const sharing = useVoice((s) => s.music);
  // One person shares music at a time (the server holds to it too).
  const busyName = useChannels((s) => (busy ? (s.users[busy]?.name ?? 'Someone') : null));
  const waiting = !!busyName && !sharing;
  const [apps, setApps] = useState<AudioApp[] | null>(null);
  // Only apps playing sound right now are listed, so the list follows along: start a song and
  // its app appears.
  useEffect(() => {
    const load = () =>
      void invoke<AudioApp[]>('audio_apps')
        .then(setApps)
        .catch(() => setApps([]));
    load();
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex w-[340px] max-w-[calc(100vw-24px)] flex-col">
      <div className="flex items-center gap-2 px-3.5 pb-1 pt-3">
        <Music2 size={15} className="text-accent" />
        <span className="flex-1 text-[13.5px] font-semibold">Share music</span>
      </div>
      <p className="px-3.5 pb-2 text-[12px] leading-snug text-fg-3">
        Play a song in Spotify, or YouTube Music in your browser, then pick it here. Everyone in the call hears only that app, never your screen or other sounds.
      </p>

      {sharing && (
        <div className="mx-3 mb-2 flex items-center gap-2.5 rounded-[12px] bg-accent/12 px-2.5 py-2">
          <button
            aria-label="Stop sharing music"
            onClick={() => (voice.stopMusic(), onDone())}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-white shadow-md transition-transform hover:scale-105 active:scale-95"
          >
            <Square size={13} className="fill-current" />
          </button>
          <div className="min-w-0">
            <div className="text-[11px] text-fg-3">Sharing from {sharing.app}</div>
            <div className="truncate text-[13px] font-medium">{sharing.title}</div>
          </div>
        </div>
      )}

      {waiting && <p className="mx-3 mb-3 rounded-[10px] bg-fill-1 px-2.5 py-2 text-[12px] text-fg-2">{busyName} is sharing music. One person at a time: you can share once they stop.</p>}
      {/* A fixed height: the list arrives after the popover has placed itself, and must not grow past it. */}
      <div className={waiting ? 'hidden' : 'h-[min(280px,42vh)] overflow-y-auto px-2 pb-2'}>
        {waiting ? null : !apps ? (
          <div className="grid h-20 place-items-center text-fg-3">
            <Spinner size={18} />
          </div>
        ) : apps.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <AudioLines size={22} className="text-fg-3" />
            <p className="text-[13px] font-medium">Nothing is playing yet</p>
            <p className="text-[12px] leading-snug text-fg-3">Start a song and its app shows up here.</p>
          </div>
        ) : (
          apps.map((app) => (
            <button
              key={app.pid}
              onClick={() => void voice.startMusic(app).then(onDone)}
              className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left transition-colors hover:bg-fill-2"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-accent/12 text-accent">
                <AudioLines size={16} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">{app.name}</span>
                <span className="block truncate text-[11.5px] text-fg-3">{app.title}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Shared music joins the call as its own tile, like a player in the room: the song, who shares
 * it and from which app, and how loud it plays for you (or Stop, for the person sharing).
 */
export function MusicTile({ p, mine, width, height }: { p: VoiceParticipant; mine: boolean; width: number; height: number }) {
  const user = useChannels((s) => s.users[p.userId]);
  const volume = useSettings((s) => s.musicVolume);
  const art = Math.round(Math.min(112, height * 0.4, width * 0.3));
  const small = height < 190;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={spring}
      className="relative overflow-hidden rounded-[22px] glass-tile"
      style={{ width, height }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-accent/25 via-transparent to-[#ff3d7f]/20" />
      <div className="relative flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
        <div
          className="relative grid shrink-0 place-items-center rounded-[22%] bg-gradient-to-br from-accent to-[color-mix(in_srgb,var(--accent)_45%,#ff3d7f)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_18px_40px_-14px_var(--accent)]"
          style={{ width: art, height: art }}
        >
          <span className="flex h-[42%] items-end gap-[8%]" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="eq-bar w-[7%] min-w-[4px] rounded-full bg-white" style={{ animationDelay: `${i * -0.27}s` }} />
            ))}
          </span>
        </div>
        <div className="min-w-0 max-w-full">
          <div className="truncate text-[15px] font-semibold">{p.music!.title}</div>
          {!small && (
            <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[12px] text-fg-3">
              <Avatar user={user} size={16} className="shrink-0" />
              <span className="truncate">
                {mine ? 'You’re sharing' : `Shared by ${user?.name ?? 'someone'}`} · {p.music!.app}
              </span>
            </div>
          )}
        </div>
        {mine ? (
          <button onClick={() => voice.stopMusic()} className="flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold glass-key">
            <Square size={10} className="fill-current" /> Stop music
          </button>
        ) : (
          <div className="flex w-[min(220px,80%)] items-center gap-2 text-fg-3">
            <Music2 size={13} className="shrink-0" />
            <Slider value={volume} onChange={(v) => useSettings.getState().set({ musicVolume: v })} className="w-full" />
          </div>
        )}
      </div>
    </motion.div>
  );
}
