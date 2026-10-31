import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { Drum, Play, Search, Square, Star, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Segmented, Slider, Spinner, Switch } from '../ui/primitives';
import { spring } from '@/lib/motion';
import {
  playSound,
  previewSound,
  stopAllSounds,
  stopMySound,
  stopPreview,
  toggleFavorite,
  useMySound,
  usePreview,
  useSoundBursts,
  useSoundboardBlocked,
} from '@/lib/soundboard';
import { useSoundPack, type PackSound } from '@/lib/soundPack';
import { useSettings } from '@/stores/settings';

/**
 * The soundboard, like Discord's: compact chips in two tabs (your favorites, every sound).
 * Click a chip to play it for everyone; hover it and press ▶ to hear it first (only you); the
 * star keeps it in Favorites. While your sound plays, a big Stop button stops it for everyone.
 */
export function SoundboardPanel() {
  const sounds = useSoundPack((s) => s.sounds);
  const ready = useSoundPack((s) => s.ready);
  const favorites = useSettings((s) => s.soundFavorites);
  const hearing = useSettings((s) => s.hearSounds);
  const volume = useSettings((s) => s.soundboardVolume);
  const blocked = useSoundboardBlocked();
  const playing = useMySound();
  const [tab, setTab] = useState<'favorites' | 'all'>(() => (useSettings.getState().soundFavorites.length ? 'favorites' : 'all'));
  const [query, setQuery] = useState('');
  // Closing the sheet ends a preview.
  useEffect(() => stopPreview, []);

  const q = query.trim().toLowerCase();
  const favs = favorites.map((id) => sounds.find((s) => s.id === id)).filter((s): s is PackSound => !!s);
  const list = tab === 'favorites' ? favs : q ? sounds.filter((s) => s.name.toLowerCase().includes(q)) : sounds;

  return (
    <div className="flex w-[400px] max-w-[calc(100vw-24px)] flex-col">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <Drum size={15} className="text-accent" />
        <span className="flex-1 text-[13.5px] font-semibold">Soundboard</span>
        <Segmented
          id="soundboard-tab"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'favorites', label: 'Favorites' },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>

      {/* The sound you're playing, with a big Stop for everyone. */}
      <AnimatePresence initial={false}>
        {playing.id && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring} className="overflow-hidden px-3">
            <div className="mb-2 flex items-center gap-2.5 rounded-[12px] bg-accent/12 px-2.5 py-2">
              <button
                aria-label="Stop the sound for everyone"
                onClick={stopMySound}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent text-white shadow-md transition-transform hover:scale-105 active:scale-95"
              >
                <Square size={13} className="fill-current" />
              </button>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-fg-3">Playing for everyone</div>
                <div className="truncate text-[13px] font-medium">
                  {playing.emoji && <span className="emoji mr-1">{playing.emoji}</span>}
                  {playing.name}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {tab === 'all' && sounds.length > 9 && (
        <div className="px-3 pb-2">
          <label className="field flex h-8 items-center gap-2 px-2.5">
            <Search size={14} className="text-fg-3" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sounds" className="h-full w-full bg-transparent text-[13px] outline-none placeholder:text-fg-3" />
          </label>
        </div>
      )}
      {blocked && <p className="mx-3 mb-2 rounded-[10px] bg-fill-1 px-2.5 py-2 text-[12px] text-fg-2">{blocked}</p>}

      <div className="max-h-[min(264px,42vh)] overflow-y-auto px-3 pb-3">
        {!ready ? (
          <div className="grid h-20 place-items-center text-fg-3">
            <Spinner />
          </div>
        ) : !list.length ? (
          <p className="px-1 py-6 text-center text-[12.5px] leading-relaxed text-fg-3">
            {tab === 'favorites' ? 'No favorites yet. In All, hover a sound and press the star to keep it here.' : q ? `No sound called “${query.trim()}”.` : 'No sounds yet.'}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {list.map((s) => (
              <SoundChip key={s.id} sound={s} favorite={favorites.includes(s.id)} disabled={!!blocked} playing={playing.id === s.id} />
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2.5 border-t border-[var(--hairline)] px-3.5 py-2.5">
        <Switch
          checked={hearing}
          onChange={(on) => {
            useSettings.getState().set({ hearSounds: on });
            if (!on) stopAllSounds();
          }}
        />
        <span className="shrink-0 text-[12px] text-fg-2">Hear others’ sounds</span>
        <Volume2 size={14} className="ml-auto shrink-0 text-fg-3" />
        <Slider value={volume} onChange={(v) => useSettings.getState().set({ soundboardVolume: v })} className="w-[92px]" />
      </div>
    </div>
  );
}

function SoundChip({ sound, favorite, disabled, playing }: { sound: PackSound; favorite: boolean; disabled: boolean; playing: boolean }) {
  const previewing = usePreview((s) => s.id === sound.id);
  return (
    <div className="group/chip relative">
      <motion.button
        whileTap={disabled ? undefined : { scale: 0.95 }}
        transition={spring}
        disabled={disabled}
        onClick={() => playSound(sound.id)}
        title={`Play “${sound.name}” for everyone`}
        className={clsx(
          // The name gets the room the star takes only while hovered.
          'flex h-10 w-full items-center gap-2 rounded-[10px] bg-fill-1 pl-[34px] pr-2 text-left transition-[background-color,padding] hover:bg-fill-2 group-hover/chip:pr-6 disabled:opacity-40 disabled:hover:bg-fill-1',
          (previewing || playing) && 'ring-2 ring-inset ring-accent',
        )}
      >
        <span className="truncate text-[12.5px] font-medium">{sound.name}</span>
      </motion.button>
      {/* The icon; on hover it becomes ▶, to hear the sound first (only you). */}
      <button
        aria-label={previewing ? 'Stop the preview' : `Hear “${sound.name}” first (only you)`}
        title={previewing ? 'Stop' : 'Hear it first (only you)'}
        onClick={() => void previewSound(sound.id)}
        className="absolute left-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-[8px] text-fg-2 transition-colors hover:bg-fill-3 hover:text-accent"
      >
        {previewing ? (
          <Square size={10} className="fill-current text-accent" />
        ) : (
          <>
            <span className="group-hover/chip:hidden touch:hidden">{sound.emoji ? <span className="emoji text-[16px] leading-none">{sound.emoji}</span> : <Volume2 size={15} />}</span>
            <Play size={12} className="ml-px hidden fill-current group-hover/chip:block touch:block" />
          </>
        )}
      </button>
      <button
        aria-label={favorite ? `Remove “${sound.name}” from favorites` : `Add “${sound.name}” to favorites`}
        title={favorite ? 'Remove from favorites' : 'Add to favorites'}
        onClick={() => toggleFavorite(sound.id)}
        className={clsx(
          'absolute right-1 top-1/2 grid h-6 w-5 -translate-y-1/2 place-items-center transition-opacity hover:text-warning touch:opacity-100',
          favorite ? 'text-warning opacity-100' : 'text-fg-3 opacity-0 group-hover/chip:opacity-100',
        )}
      >
        <Star size={11} className={favorite ? 'fill-current' : undefined} />
      </button>
    </div>
  );
}

/** Little bubbles that rise above the call's controls when someone plays a sound. */
export function SoundBursts() {
  const bursts = useSoundBursts((s) => s.bursts);
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 mb-3 flex -translate-x-1/2 flex-col-reverse items-center gap-1.5">
      <AnimatePresence>
        {bursts.map((b) => (
          <motion.div
            key={b.id}
            initial={{ opacity: 0, y: 12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, transition: { duration: 0.25 } }}
            transition={spring}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[12.5px] glass-pop"
          >
            <Drum size={13} className="text-accent" />
            <span className="font-semibold">{b.who}</span>
            <span className="max-w-[180px] truncate text-fg-2">{b.name}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
