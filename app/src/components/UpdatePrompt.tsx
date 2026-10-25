import { AnimatePresence, motion } from 'motion/react';
import { Sparkles } from 'lucide-react';
import { Button } from './ui/primitives';
import { spring } from '@/lib/motion';
import { useUpdater } from '@/lib/updater';
import { useVoice } from '@/stores/voice';

export function UpdatePrompt() {
  const { status, update, progress, dismissed } = useUpdater();
  const inCall = useVoice((s) => s.status !== 'idle');
  const show = !!update && !dismissed && (status === 'available' || status === 'downloading' || status === 'installing');

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={spring}
          className="fixed bottom-5 right-5 z-[110] w-[340px] rounded-[20px] p-4 glass-pop"
        >
          <div className="flex gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-accent text-white shadow-[inset_0_0.5px_0_rgba(255,255,255,0.35)]">
              <Sparkles size={19} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold">
                {status === 'available' ? 'A new version is ready' : status === 'downloading' ? 'Downloading update…' : 'Installing — back in a moment'}
              </div>
              <div className="mt-0.5 text-[12px] leading-snug text-fg-2">
                {status === 'available'
                  ? `Infimeety ${update.version} installs in seconds and reopens. You’ll stay signed in${inCall ? ', but this call will end' : ''}.`
                  : `Version ${update.version}`}
              </div>
              {update.body && status === 'available' && <div className="mt-2 line-clamp-3 text-[11.5px] text-fg-3">{update.body}</div>}
            </div>
          </div>
          {status === 'available' ? (
            <div className="mt-3.5 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => useUpdater.getState().dismiss()}>
                Later
              </Button>
              <Button size="sm" variant="primary" onClick={() => void useUpdater.getState().install()}>
                Update & restart
              </Button>
            </div>
          ) : (
            <div className="mt-3.5 h-1.5 overflow-hidden rounded-full bg-fill-2">
              <motion.div className="h-full rounded-full bg-accent" animate={{ width: `${Math.round(progress * 100)}%` }} transition={{ duration: 0.25 }} />
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
