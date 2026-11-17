import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { Hand, Music2, SmilePlus, Speaker } from 'lucide-react';
import { useState } from 'react';
import { REACTIONS } from '../../../../shared/protocol';
import { MusicPicker } from './Music';
import { SoundboardPanel } from './Soundboard';
import { sendReaction, useReactions } from '@/lib/reactions';
import { voice } from '@/lib/voice/engine';
import { useVoice } from '@/stores/voice';

type Tab = 'react' | 'sounds' | 'music';

/**
 * The call bar's one fun button: reactions and a raised hand on top, then the soundboard and
 * Share music, so the bar stays short.
 */
export function FunPanel({ sounds, music, busy, onDone }: { sounds: boolean; music: boolean; busy?: string; onDone: () => void }) {
  const [tab, setTab] = useState<Tab>('react');
  const hand = useVoice((s) => s.hand);
  const tabs: { id: Tab; label: string; icon: typeof Speaker }[] = [
    { id: 'react', label: 'React', icon: SmilePlus },
    ...(sounds ? [{ id: 'sounds' as const, label: 'Sounds', icon: Speaker }] : []),
    ...(music ? [{ id: 'music' as const, label: 'Music', icon: Music2 }] : []),
  ];
  return (
    <div className="flex flex-col">
      <div className="flex gap-1 p-2 pb-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx('flex flex-1 items-center justify-center gap-1.5 rounded-[10px] py-1.5 text-[12.5px] font-medium', tab === t.id ? 'bg-accent text-white' : 'text-fg-2 hover:bg-fill-2')}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'react' && (
        <div className="w-[300px] p-3">
          <div className="grid grid-cols-4 gap-1.5">
            {REACTIONS.map((e) => (
              <motion.button
                key={e}
                whileTap={{ scale: 0.85 }}
                onClick={() => sendReaction(e)}
                className="emoji grid h-12 place-items-center rounded-[12px] text-[26px] glass-key"
              >
                {e}
              </motion.button>
            ))}
          </div>
          <button
            onClick={() => voice.toggleHand()}
            className={clsx('mt-2 flex w-full items-center justify-center gap-2 rounded-[12px] py-2 text-[13px] font-semibold', hand ? 'bg-warning text-black' : 'glass-key')}
          >
            <Hand size={15} /> {hand ? 'Lower your hand' : 'Raise your hand'}
          </button>
        </div>
      )}
      {tab === 'sounds' && <SoundboardPanel />}
      {tab === 'music' && <MusicPicker busy={busy} onDone={onDone} />}
    </div>
  );
}

/** Reactions floating up the left side of the call, each with who sent it. */
export function FloatingReactions() {
  const list = useReactions((s) => s.list);
  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      <AnimatePresence>
        {list.map((r) => (
          <motion.div
            key={r.id}
            initial={{ opacity: 0, y: 0, scale: 0.6 }}
            animate={{ opacity: [0, 1, 1, 0], y: -320, scale: [0.6, 1.1, 1, 1] }}
            transition={{ duration: 3, ease: 'easeOut', times: [0, 0.12, 0.75, 1] }}
            className="absolute bottom-[110px] flex flex-col items-center"
            style={{ left: `${r.x}%` }}
          >
            <span className="emoji text-[40px] drop-shadow-[0_4px_10px_rgba(0,0,0,0.35)]">{r.emoji}</span>
            <span className="mt-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium text-white glass-ink">{r.name}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
