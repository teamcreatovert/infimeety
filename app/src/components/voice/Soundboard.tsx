import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { Drum, Play, Search, Square, Star, Volume2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Slider, Spinner, Switch } from '../ui/primitives';
import { spring } from '@/lib/motion';
import { playSound, previewSound, stopAllSounds, stopPreview, toggleFavorite, usePreview, useSoundBursts, useSoundboardBlocked } from '@/lib/soundboard';
import { useSoundPack, type PackSound } from '@/lib/soundPack';
import { useSettings } from '@/stores/settings';

/**
 * The soundboard's sheet: tap a sound to play it for everyone in the call, ▶ to hear it first
 * (only you), ☆ to keep it at the top. Your volume and "hear others" switch sit at the bottom.
 */
export function SoundboardPanel() {
  const sounds = useSoundPack((s) => s.sounds);
  const ready = useSoundPack((s) => s.ready);
  const favorites = useSettings((s) => s.soundFavorites);
  const hearing = useSettings((s) => s.soundboard);
  const volume = useSettings((s) => s.soundboardVolume);
  const blocked = useSoundboardBlocked();
  const [query, setQuery] = useState('');
  // Closing the sheet ends a preview.
  useEffect(() => stopPreview, []);

  const q = query.trim().toLowerCase();
  const favs = q ? [] : favorites.map((id) => sounds.find((s) => s.id === id)).filter((s): s is PackSound => !!s);
  const rest = q ? sounds.filter((s) => s.name.toLowerCase().includes(q)) : sounds.filter((s) => !favorites.includes(s.id));

  const grid = (list: PackSound[]) => (
    <div className="grid grid-cols-3 gap-1.5">
      {list.map((s) => (
        <SoundTile key={s.id} sound={s} favorite={favorites.includes(s.id)} disabled={!!blocked} />
      ))}
    </div>
  );

  return (
    <div className="flex w-[352px] max-w-[calc(100vw-24px)] flex-col">
      <div className="px-3 pt-3">
        <div className="flex items-baseline justify-between px-0.5">
          <span className="text-[13.5px] font-semibold">Soundboard</span>
          <span className="text-[11px] text-fg-3">Tap to play for everyone</span>
        </div>
        {sounds.length > 9 && (
          <label className="field mt-2.5 flex h-8 items-center gap-2 px-2.5">
            <Search size={14} className="text-fg-3" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sounds" className="h-full w-full bg-transparent text-[13px] outline-none placeholder:text-fg-3" />
          </label>
        )}
        {blocked && <p className="mt-2 rounded-[10px] bg-fill-1 px-2.5 py-2 text-[12px] text-fg-2">{blocked}</p>}
      </div>

      <div className="max-h-[min(340px,50vh)] overflow-y-auto px-3 pb-3 pt-2.5">
        {!ready ? (
          <div className="grid h-24 place-items-center text-fg-3">
            <Spinner />
          </div>
        ) : !sounds.length ? (
          <p className="px-0.5 py-6 text-center text-[12.5px] text-fg-3">No sounds yet. They’ll show up here once they’re added.</p>
        ) : (
          <>
            {favs.length > 0 && (
              <Section title="Favorites" icon={<Star size={11} className="fill-current" />}>
                {grid(favs)}
              </Section>
            )}
            {rest.length > 0 && <Section title={q ? undefined : favs.length ? 'All sounds' : undefined}>{grid(rest)}</Section>}
            {q && !rest.length && <p className="px-0.5 py-6 text-center text-[12.5px] text-fg-3">No sound called “{query.trim()}”.</p>}
          </>
        )}
      </div>

      <div className="flex items-center gap-2.5 border-t border-[var(--hairline)] px-3.5 py-2.5">
        <Switch
          checked={hearing}
          onChange={(on) => {
            useSettings.getState().set({ soundboard: on });
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

function Section({ title, icon, children }: { title?: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      {title && (
        <div className="mb-1.5 flex items-center gap-1 px-0.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-fg-3">
          {icon}
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

function SoundTile({ sound, favorite, disabled }: { sound: PackSound; favorite: boolean; disabled: boolean }) {
  const previewing = usePreview((s) => s.id === sound.id);
  return (
    <div className="group/tile relative">
      <motion.button
        whileTap={disabled ? undefined : { scale: 0.94 }}
        transition={spring}
        disabled={disabled}
        onClick={() => playSound(sound.id)}
        title={`Play “${sound.name}” for everyone`}
        className={clsx(
          // The text sits a little low and wide, clear of the ▶ and ☆ in the top corners.
          'flex h-[64px] w-full items-center justify-center rounded-[12px] bg-fill-1 px-2 pt-4 text-center transition-colors hover:bg-fill-2 disabled:opacity-40 disabled:hover:bg-fill-1',
          previewing && 'ring-2 ring-accent ring-inset',
        )}
      >
        <span className="line-clamp-2 text-[12px] font-medium leading-tight">{sound.name}</span>
      </motion.button>
      <button
        aria-label={previewing ? 'Stop the preview' : `Hear “${sound.name}” (only you)`}
        title={previewing ? 'Stop' : 'Hear it first (only you)'}
        onClick={() => void previewSound(sound.id)}
        className={clsx(
          'absolute left-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-fill-3 transition-opacity hover:text-accent touch:opacity-100',
          previewing ? 'text-accent opacity-100' : 'text-fg-2 opacity-0 group-hover/tile:opacity-100',
        )}
      >
        {previewing ? <Square size={8} className="fill-current" /> : <Play size={9} className="ml-px fill-current" />}
      </button>
      <button
        aria-label={favorite ? `Remove “${sound.name}” from favorites` : `Add “${sound.name}” to favorites`}
        title={favorite ? 'Remove from favorites' : 'Add to favorites'}
        onClick={() => toggleFavorite(sound.id)}
        className={clsx(
          'absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full transition-opacity hover:text-warning touch:opacity-100',
          favorite ? 'text-warning opacity-100' : 'bg-fill-3 text-fg-2 opacity-0 group-hover/tile:opacity-100',
        )}
      >
        <Star size={10} className={favorite ? 'fill-current' : undefined} />
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
