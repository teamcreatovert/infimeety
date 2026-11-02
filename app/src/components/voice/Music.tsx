import { invoke } from '@tauri-apps/api/core';
import { AnimatePresence, motion } from 'motion/react';
import { Music2, RefreshCw, Square } from 'lucide-react';
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
  const load = () => {
    setApps(null);
    void invoke<AudioApp[]>('audio_apps')
      .then(setApps)
      .catch(() => setApps([]));
  };
  useEffect(load, []);

  return (
    <div className="flex w-[340px] max-w-[calc(100vw-24px)] flex-col">
      <div className="flex items-center gap-2 px-3.5 pb-1 pt-3">
        <Music2 size={15} className="text-accent" />
        <span className="flex-1 text-[13.5px] font-semibold">Share music</span>
        <button aria-label="Refresh" onClick={load} className="grid h-7 w-7 place-items-center rounded-full text-fg-3 hover:bg-fill-2 hover:text-fg">
          <RefreshCw size={13} />
        </button>
      </div>
      <p className="px-3.5 pb-2 text-[12px] leading-snug text-fg-3">Only that app’s sound goes to the call, never your screen. Play music in it like you normally do.</p>

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
          <p className="px-2 py-5 text-center text-[12.5px] text-fg-3">Open Spotify or YouTube Music in your browser, then refresh.</p>
        ) : (
          apps.map((app) => (
            <button
              key={app.pid}
              onClick={() => void voice.startMusic(app).then(onDone)}
              className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left transition-colors hover:bg-fill-2"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] glass-key text-[12px] font-bold uppercase text-fg-2">{app.name.slice(0, 1)}</span>
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

/** What's playing in the room: one card per person sharing music, with how loud it plays for you. */
export function NowPlaying({ participants, myPeer }: { participants: VoiceParticipant[]; myPeer: string | null }) {
  const users = useChannels((s) => s.users);
  const volume = useSettings((s) => s.musicVolume);
  const sharers = participants.filter((p) => p.music);
  return (
    <div className="pointer-events-none absolute left-4 top-4 z-20 flex flex-col gap-2 compact:left-2.5 compact:top-2.5">
      <AnimatePresence>
        {sharers.map((p) => {
          const mine = p.peerId === myPeer;
          return (
            <motion.div
              key={p.peerId}
              initial={{ opacity: 0, y: -8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              transition={spring}
              className="pointer-events-auto relative flex w-[280px] max-w-[calc(100vw-40px)] items-center gap-3 rounded-[18px] p-2.5 glass-float"
            >
              <div className="relative shrink-0">
                <div className="grid h-11 w-11 place-items-center rounded-[12px] bg-gradient-to-br from-accent to-[color-mix(in_srgb,var(--accent)_55%,#ff3d7f)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]">
                  <Music2 size={20} />
                </div>
                <Avatar user={users[p.userId]} size={18} className="absolute -bottom-1 -right-1 ring-2 ring-[var(--bg)]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">{p.music!.title}</div>
                <div className="truncate text-[11.5px] text-fg-3">
                  {mine ? 'You’re sharing' : users[p.userId]?.name ?? 'Someone'} · {p.music!.app}
                </div>
                {!mine && <Slider value={volume} onChange={(v) => useSettings.getState().set({ musicVolume: v })} className="mt-1.5 w-full" />}
              </div>
              {mine && (
                <button aria-label="Stop sharing music" onClick={() => voice.stopMusic()} className="grid h-8 w-8 shrink-0 place-items-center rounded-full glass-key">
                  <Square size={11} className="fill-current" />
                </button>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
