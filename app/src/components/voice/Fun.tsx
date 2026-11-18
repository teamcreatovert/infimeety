import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, Music2, Plus, SmilePlus, Speaker } from 'lucide-react';
import { useState } from 'react';
import { MEETING_REACTIONS, REACTIONS, validReaction } from '../../../../shared/protocol';
import { EmojiPicker } from '../chat/EmojiPicker';
import { MusicPicker } from './Music';
import { SoundboardPanel, politeSound } from './Soundboard';
import { sendReaction, useReactions } from '@/lib/reactions';

type Tab = 'react' | 'sounds' | 'music';

const RECENT_KEY = 'infimeety.reactRecent';
const readRecent = (): string[] => {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((e): e is string => typeof e === 'string').slice(0, 3) : [];
  } catch {
    return [];
  }
};
const keepRecent = (e: string) => {
  const list = [e, ...readRecent().filter((x) => x !== e)].slice(0, 3);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* private window: fine without */
  }
  return list;
};

/**
 * The call bar's fun button. Server rooms get every reaction, the soundboard and Share music;
 * meetings get polite reactions and applause. One width for every tab, so it never jumps.
 */
export function FunPanel({ meeting, sounds, music, busy, onDone }: { meeting?: boolean; sounds: boolean; music: boolean; busy?: string; onDone: () => void }) {
  const [tab, setTab] = useState<Tab>('react');
  const [picking, setPicking] = useState(false);
  const [recent, setRecent] = useState(readRecent);
  const tabs: { id: Tab; label: string; icon: typeof Speaker }[] = [
    { id: 'react', label: 'React', icon: SmilePlus },
    ...(sounds ? [{ id: 'sounds' as const, label: meeting ? 'Applause' : 'Sounds', icon: Speaker }] : []),
    ...(music && !meeting ? [{ id: 'music' as const, label: 'Music', icon: Music2 }] : []),
  ];
  const base: readonly string[] = meeting ? MEETING_REACTIONS : REACTIONS;
  // Server rooms can send any emoji; the last few picked from the full list sit next to the usual ones.
  const extra = meeting ? [] : recent.filter((e) => !base.includes(e));
  const emojis = [...base, ...extra];
  return (
    <div className="flex w-[400px] max-w-[calc(100vw-24px)] flex-col">
      {tabs.length > 1 && (
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
      )}
      {/* Every tab fills the same width. */}
      <div className="[&>*]:w-full!">
        {tab === 'react' && picking && (
          <div className="flex flex-col">
            <button onClick={() => setPicking(false)} className="mx-2 mt-2 flex items-center gap-1 self-start rounded-[8px] px-1.5 py-1 text-[12.5px] font-medium text-fg-2 hover:bg-fill-2">
              <ChevronLeft size={14} /> Back
            </button>
            <EmojiPicker
              onPick={(e) => {
                if (!validReaction(e)) return;
                sendReaction(e);
                setRecent(keepRecent(e));
                setPicking(false);
              }}
            />
          </div>
        )}
        {tab === 'react' && !picking && (
          <div className="p-3">
            <div className="grid grid-cols-4 gap-1.5">
              {emojis.map((e) => (
                <motion.button key={e} whileTap={{ scale: 0.85 }} onClick={() => sendReaction(e)} className="emoji grid h-14 place-items-center rounded-[12px] text-[28px] glass-key">
                  {e}
                </motion.button>
              ))}
              {!meeting && (
                <motion.button whileTap={{ scale: 0.85 }} aria-label="More emoji" onClick={() => setPicking(true)} className="grid h-14 place-items-center rounded-[12px] text-fg-2 glass-key hover:text-fg">
                  <Plus size={22} />
                </motion.button>
              )}
            </div>
          </div>
        )}
        {tab === 'sounds' && <SoundboardPanel only={meeting ? politeSound : undefined} />}
        {tab === 'music' && <MusicPicker busy={busy} onDone={onDone} />}
      </div>
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
