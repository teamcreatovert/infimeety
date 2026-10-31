import clsx from 'clsx';
import { Music, Pause, Play, Plus, Radio, Search, SkipBack, SkipForward, Square, Volume1, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { MusicState } from '../../../../shared/protocol';
import { Slider, Spinner } from '../ui/primitives';
import { addToQueue, control, searchSongs, searchStations, type MusicResult } from '@/lib/music';
import { useChannels } from '@/stores/channels';
import { useSettings } from '@/stores/settings';
import { useVoice } from '@/stores/voice';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Your room's music, live. */
export function useRoomMusic(): MusicState | undefined {
  const channelId = useVoice((s) => s.channelId);
  const roomId = useVoice((s) => s.roomId);
  return useChannels((s) => (channelId && roomId ? s.voice[channelId]?.music?.[roomId] : undefined));
}

/**
 * The music bot's sheet, like a Discord music bot without commands: search songs and radio
 * stations by name, add them to the room's queue, and play, pause or skip for everyone.
 */
export function MusicPanel() {
  const music = useRoomMusic();
  const users = useChannels((s) => s.users);
  const volume = useSettings((s) => s.musicVolume);
  const [query, setQuery] = useState('');
  const [songs, setSongs] = useState<MusicResult[] | null>(null);
  const [stations, setStations] = useState<MusicResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Searches a moment after you stop typing.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return void (setSongs(null), setStations(null));
    let live = true;
    setSearching(true);
    const timer = setTimeout(() => {
      void Promise.allSettled([searchSongs(q), searchStations(q)]).then(([a, b]) => {
        if (!live) return;
        setSongs(a.status === 'fulfilled' ? a.value : []);
        setStations(b.status === 'fulfilled' ? b.value : []);
        setSearching(false);
      });
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const now = music?.queue[music.index];
  const upNext = music ? music.queue.slice(music.index + 1) : [];

  return (
    <div className="flex w-[400px] max-w-[calc(100vw-24px)] flex-col">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <Music size={15} className="text-accent" />
        <span className="flex-1 text-[13.5px] font-semibold">Music</span>
        {music && (
          <button onClick={() => control({ action: 'stop' })} className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium text-fg-3 hover:bg-fill-2 hover:text-danger">
            <Square size={10} className="fill-current" /> Stop music
          </button>
        )}
      </div>

      {now && music && (
        <div className="mx-3 mb-2 flex items-center gap-3 rounded-[14px] bg-accent/10 p-2.5">
          {now.thumb ? <img src={now.thumb} alt="" className="h-12 w-12 shrink-0 rounded-[10px] object-cover" /> : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[10px] bg-fill-2 text-fg-3">{now.source === 'radio' ? <Radio size={20} /> : <Music size={20} />}</span>}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold">{now.title}</div>
            <div className="truncate text-[11.5px] text-fg-3">
              {now.source === 'radio' ? 'Live radio' : now.artist}
              {now.duration > 0 && ` · ${clock(now.duration)}`} · added by {users[now.by]?.name ?? 'someone'}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button aria-label="Previous" onClick={() => control({ action: 'previous' })} className="grid h-8 w-8 place-items-center rounded-full text-fg-2 hover:bg-fill-2">
              <SkipBack size={15} className="fill-current" />
            </button>
            <button
              aria-label={music.playing ? 'Pause for everyone' : 'Play for everyone'}
              onClick={() => control({ action: music.playing ? 'pause' : 'play' })}
              className="grid h-10 w-10 place-items-center rounded-full bg-accent text-white shadow-md transition-transform hover:scale-105 active:scale-95"
            >
              {music.playing ? <Pause size={16} className="fill-current" /> : <Play size={16} className="ml-0.5 fill-current" />}
            </button>
            <button aria-label="Next" onClick={() => control({ action: 'next' })} className="grid h-8 w-8 place-items-center rounded-full text-fg-2 hover:bg-fill-2">
              <SkipForward size={15} className="fill-current" />
            </button>
          </div>
        </div>
      )}

      <div className="px-3 pb-2">
        <label className="field flex h-8 items-center gap-2 px-2.5">
          <Search size={14} className="text-fg-3" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a song, artist or radio station" className="h-full w-full bg-transparent text-[13px] outline-none placeholder:text-fg-3" />
          {searching && <Spinner size={13} className="text-fg-3" />}
        </label>
      </div>

      <div className="max-h-[min(300px,45vh)] overflow-y-auto px-3 pb-3">
        {songs || stations ? (
          <>
            <Results title="Songs" list={songs} />
            <Results title="Radio" list={stations} />
            {!songs?.length && !stations?.length && !searching && <p className="py-5 text-center text-[12.5px] text-fg-3">Nothing found for “{query.trim()}”.</p>}
          </>
        ) : upNext.length ? (
          <>
            <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-fg-3">Up next</div>
            {upNext.map((t) => (
              <div key={t.id} className="group/q flex items-center gap-2.5 rounded-[10px] px-1.5 py-1.5 hover:bg-fill-1">
                <button onClick={() => control({ action: 'skipTo', trackId: t.id })} className="min-w-0 flex-1 text-left" title="Play now">
                  <div className="truncate text-[13px] font-medium">{t.title}</div>
                  <div className="truncate text-[11px] text-fg-3">{t.source === 'radio' ? 'Live radio' : t.artist}</div>
                </button>
                <button aria-label="Remove from the queue" onClick={() => control({ action: 'remove', trackId: t.id })} className="grid h-6 w-6 place-items-center rounded-full text-fg-3 opacity-0 hover:bg-fill-2 group-hover/q:opacity-100 touch:opacity-100">
                  <X size={13} />
                </button>
              </div>
            ))}
          </>
        ) : (
          <p className="px-1 py-4 text-center text-[12.5px] leading-relaxed text-fg-3">{music ? 'Nothing queued after this. Search to add more.' : 'Search for a song or a radio station. Everyone in the call hears it, in sync.'}</p>
        )}
      </div>

      <div className="flex items-center gap-2.5 border-t border-[var(--hairline)] px-3.5 py-2.5">
        <span className="shrink-0 text-[12px] text-fg-2">Music volume (just you)</span>
        <Volume1 size={14} className="ml-auto shrink-0 text-fg-3" />
        <Slider value={volume} onChange={(v) => useSettings.getState().set({ musicVolume: v })} className="w-[110px]" />
      </div>
    </div>
  );
}

function Results({ title, list }: { title: string; list: MusicResult[] | null }) {
  if (!list?.length) return null;
  return (
    <div className="mb-2">
      <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-fg-3">{title}</div>
      {list.map((r) => (
        <div key={r.ref} className="flex items-center gap-2.5 rounded-[10px] px-1.5 py-1.5 hover:bg-fill-1">
          {r.thumb ? (
            <img src={r.thumb} alt="" className="h-9 w-9 shrink-0 rounded-[8px] object-cover" />
          ) : (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] bg-fill-2 text-fg-3">{r.source === 'radio' ? <Radio size={16} /> : <Music size={16} />}</span>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{r.title}</div>
            <div className="truncate text-[11px] text-fg-3">
              {r.artist}
              {r.duration > 0 && ` · ${clock(r.duration)}`}
            </div>
          </div>
          <button aria-label={`Add ${r.title}`} title="Add to the queue" onClick={() => addToQueue(r)} className={clsx('grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-white transition-transform hover:scale-105 active:scale-95')}>
            <Plus size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
