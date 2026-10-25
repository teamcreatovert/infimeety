import { AnimatePresence, motion } from 'motion/react';
import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import { spring } from '@/lib/motion';
import { useUI } from '@/stores/ui';

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[46px] z-[120] flex flex-col items-center gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            layout
            onClick={() => dismiss(t.id)}
            className="pointer-events-auto flex max-w-[420px] items-start gap-2.5 rounded-[16px] px-3.5 py-2.5 text-left glass-pop"
            initial={{ opacity: 0, y: -16, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.96, transition: { duration: 0.15 } }}
            transition={spring}
          >
            <span className="mt-px">
              {t.kind === 'error' ? (
                <CircleAlert size={17} className="text-danger" />
              ) : t.kind === 'success' ? (
                <CircleCheck size={17} className="text-success" />
              ) : (
                <Info size={17} className="text-accent" />
              )}
            </span>
            <span>
              <span className="block text-[13px] font-semibold">{t.title}</span>
              {t.body && <span className="mt-0.5 block text-[12px] leading-snug text-fg-2">{t.body}</span>}
            </span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
