import { Plus, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRef } from 'react';
import { spring } from '@/lib/motion';
import { addClip, BUILTIN_SOUNDS, MAX_CLIPS, playSound, removeClip, useMySounds, useSoundBursts } from '@/lib/soundboard';
import { useSettings } from '@/stores/settings';
import { useUI } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

/** The soundboard's sheet: Infimeety's sounds, then yours. Everyone in the call hears them. */
export function SoundboardPanel() {
  const clips = useMySounds((s) => s.clips);
  const serverMuted = useVoice((s) => s.serverMuted);
  const hearing = useSettings((s) => s.soundboard);
  const file = useRef<HTMLInputElement>(null);

  return (
    <div className="w-[316px] p-3">
      <div className="mb-2.5 flex items-baseline justify-between px-0.5">
        <span className="text-[13.5px] font-semibold">Soundboard</span>
        <span className="text-[11px] text-fg-3">Everyone in the call hears it</span>
      </div>
      {serverMuted && <p className="mb-2 rounded-[10px] bg-fill-1 px-2.5 py-2 text-[12px] text-fg-2">You’re muted by an admin, so your sounds don’t play.</p>}
      <div className="grid grid-cols-4 gap-1.5">
        {BUILTIN_SOUNDS.map((s) => (
          <SoundTile key={s.id} emoji={s.emoji} label={s.label} disabled={serverMuted} onPlay={() => playSound({ kind: 'builtin', id: s.id })} />
        ))}
      </div>

      <div className="mb-1.5 mt-3.5 flex items-center justify-between px-0.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-fg-3">Your sounds</span>
        {clips.length < MAX_CLIPS && (
          <button onClick={() => file.current?.click()} className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium text-accent hover:bg-fill-2">
            <Plus size={13} /> Add
          </button>
        )}
      </div>
      {clips.length > 0 ? (
        <div className="grid grid-cols-4 gap-1.5">
          {clips.map((c) => (
            <SoundTile
              key={c.id}
              emoji={c.emoji}
              label={c.name}
              disabled={serverMuted}
              onPlay={() => playSound({ kind: 'clip', name: c.name, emoji: c.emoji, mime: c.mime, data: c.data })}
              onRemove={() => removeClip(c.id)}
            />
          ))}
        </div>
      ) : (
        <button
          onClick={() => file.current?.click()}
          className="w-full rounded-[12px] border border-dashed border-[var(--hairline-strong)] px-3 py-3 text-left text-[12px] leading-snug text-fg-3 hover:bg-fill-1 hover:text-fg-2"
        >
          Add your own short clips, up to 8 seconds: a laugh, a “haha”, your favourite meme sound.
        </button>
      )}
      <input
        ref={file}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = '';
          if (picked) void addClip(picked);
        }}
      />
      {!hearing && (
        <button onClick={() => useUI.getState().set({ settingsTab: 'sounds' })} className="mt-3 w-full text-left text-[11.5px] text-fg-3 hover:text-accent">
          You’ve turned soundboard sounds off for yourself. Turn them on in Settings → Sounds →
        </button>
      )}
    </div>
  );
}

function SoundTile({ emoji, label, disabled, onPlay, onRemove }: { emoji: string; label: string; disabled?: boolean; onPlay: () => void; onRemove?: () => void }) {
  return (
    <div className="group/tile relative">
      <motion.button
        whileTap={{ scale: 0.92 }}
        transition={spring}
        disabled={disabled}
        onClick={onPlay}
        title={label}
        className="flex h-[64px] w-full flex-col items-center justify-center gap-1 rounded-[12px] bg-fill-1 px-1 transition-colors hover:bg-fill-2 disabled:opacity-40"
      >
        <span className="emoji text-[22px] leading-none">{emoji}</span>
        <span className="w-full truncate text-center text-[10.5px] text-fg-2">{label}</span>
      </motion.button>
      {onRemove && (
        <button
          aria-label={`Remove ${label}`}
          onClick={onRemove}
          className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-fg-2 text-[var(--bg)] opacity-0 shadow transition-opacity group-hover/tile:opacity-100 touch:opacity-100"
        >
          <X size={11} strokeWidth={3} />
        </button>
      )}
    </div>
  );
}

/** Little bubbles that rise above the call's controls when someone plays a sound. */
export function SoundBursts() {
  const bursts = useSoundBursts((s) => s.bursts);
  return (
    <div className="pointer-events-none absolute bottom-full right-2 mb-3 flex flex-col-reverse items-end gap-1.5">
      <AnimatePresence>
        {bursts.map((b) => (
          <motion.div
            key={b.id}
            initial={{ opacity: 0, y: 12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, transition: { duration: 0.25 } }}
            transition={spring}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[12.5px] font-medium glass-pop"
          >
            <span className="emoji text-[15px] leading-none">{b.emoji}</span>
            {b.who}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
