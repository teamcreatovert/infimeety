import { emit, listen } from '@tauri-apps/api/event';
import clsx from 'clsx';
import { MicOff } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import type { OverlayState } from '@/lib/desktop';
import { spring } from '@/lib/motion';

/**
 * The who's-talking overlay: a transparent, click-through window floating over games and
 * other apps during a call. Everyone in the call has a pill, dimmed until they speak (or, set to
 * "Who's talking", pills slide in from the screen edge only while someone speaks).
 */
export function Overlay() {
  const [state, setState] = useState<OverlayState | null>(null);
  // Messages and calls while you're in a call (instead of pop-ups over a game), for 6 s each.
  const [notes, setNotes] = useState<{ id: number; title: string; body: string }[]>([]);

  useEffect(() => {
    const unlisten = listen<OverlayState>('overlay:state', (e) => setState(e.payload));
    void unlisten.then(() => emit('overlay:ready'));
    let next = 0;
    const offNote = listen<{ title: string; body: string }>('overlay:note', (e) => {
      const id = ++next;
      setNotes((n) => [...n.slice(-2), { id, ...e.payload }]);
      setTimeout(() => setNotes((n) => n.filter((x) => x.id !== id)), 6000);
    });
    return () => {
      void unlisten.then((off) => off());
      void offNote.then((off) => off());
    };
  }, []);

  const right = !!state?.corner.endsWith('right');
  const bottom = !!state?.corner.startsWith('bottom');
  const everyone = state?.show === 'everyone';
  const people = state?.visible ? state.people.filter((p) => everyone || p.speaking) : [];

  return (
    <div className={clsx('flex h-full w-full flex-col gap-1.5 p-2', right ? 'items-end' : 'items-start', bottom ? 'justify-end' : 'justify-start')}>
      <AnimatePresence initial={false}>
        {notes.map((n) => (
          <motion.div
            key={`note-${n.id}`}
            layout
            initial={{ opacity: 0, x: right ? 14 : -14, scale: 0.94 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.2 } }}
            transition={spring}
            className="max-w-[260px] rounded-[14px] px-3 py-1.5"
            style={{ background: 'rgba(14, 14, 20, 0.82)', boxShadow: 'inset 0 0 0 0.5px rgba(255, 255, 255, 0.14), 0 6px 18px rgba(0, 0, 0, 0.28)' }}
          >
            <div className="truncate text-[12px] font-semibold text-white">{n.title}</div>
            <div className="truncate text-[12px] text-white/75">{n.body}</div>
          </motion.div>
        ))}
        {people.map((p) => (
          <motion.div
            key={p.peerId}
            layout
            initial={{ opacity: 0, x: right ? 14 : -14, scale: 0.94 }}
            animate={{ opacity: everyone && !p.speaking ? 0.5 : 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.2 } }}
            transition={spring}
            className="flex h-9 max-w-full items-center gap-2 rounded-full py-1 pl-1 pr-3.5"
            style={{
              background: 'rgba(14, 14, 20, 0.72)',
              boxShadow: 'inset 0 0 0 0.5px rgba(255, 255, 255, 0.14), 0 6px 18px rgba(0, 0, 0, 0.28)',
            }}
          >
            <Avatar user={{ id: p.userId, name: p.name, avatarUrl: p.avatarUrl }} size={28} speaking={p.speaking} />
            <span className="truncate text-[13px] font-semibold tracking-[-0.01em] text-white" style={{ textShadow: '0 1px 2px rgba(0, 0, 0, 0.35)' }}>
              {p.name}
            </span>
            {p.screen && (
              <span className="flex items-center gap-1 rounded bg-danger px-1.5 py-0.5 text-[9.5px] font-bold leading-none text-white shadow-sm">
                LIVE
              </span>
            )}
            {p.muted && <MicOff size={12} className="shrink-0 text-white/55" />}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
