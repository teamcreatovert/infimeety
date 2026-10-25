import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { spring } from '@/lib/motion';
import { useUI } from '@/stores/ui';

export function Lightbox() {
  const item = useUI((s) => s.lightbox);
  const [zoom, setZoom] = useState(false);
  const close = () => {
    useUI.getState().set({ lightbox: null });
    setZoom(false);
  };

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item]);

  return createPortal(
    <AnimatePresence>
      {item && (
        <motion.div className="fixed inset-0 z-[95] grid place-items-center bg-black/80 backdrop-blur-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close}>
          <motion.img
            src={item.src}
            alt={item.name}
            draggable={false}
            onClick={(e) => {
              e.stopPropagation();
              setZoom((z) => !z);
            }}
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: zoom ? 1.6 : 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={spring}
            className="max-h-[88vh] max-w-[90vw] rounded-[12px] object-contain shadow-[0_30px_80px_rgba(0,0,0,0.6)]"
            style={{ cursor: zoom ? 'zoom-out' : 'zoom-in' }}
          />
          <div className="absolute left-5 top-5 text-[13px] font-medium text-white/80">{item.name}</div>
          <button aria-label="Close" onClick={close} className="absolute right-5 top-5 grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20">
            <X size={17} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
