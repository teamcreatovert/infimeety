import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import {
  cloneElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ChevronRight } from 'lucide-react';
import { createPortal } from 'react-dom';
import { spring } from '@/lib/motion';

type Side = 'top' | 'bottom' | 'left' | 'right';

// ─── Tooltip ─────────────────────────────────────────────────────────────────

export function Tooltip({ label, side = 'top', children }: { label: ReactNode; side?: Side; children: ReactElement }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const props = children.props as Record<string, (e: ReactMouseEvent<HTMLElement>) => void>;

  useEffect(() => () => clearTimeout(timer.current), []);

  const child = cloneElement(children as ReactElement<Record<string, unknown>>, {
    onMouseEnter: (e: ReactMouseEvent<HTMLElement>) => {
      props.onMouseEnter?.(e);
      const el = e.currentTarget;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setRect(el.getBoundingClientRect()), 420);
    },
    onMouseLeave: (e: ReactMouseEvent<HTMLElement>) => {
      props.onMouseLeave?.(e);
      clearTimeout(timer.current);
      setRect(null);
    },
    onPointerDown: (e: ReactMouseEvent<HTMLElement>) => {
      props.onPointerDown?.(e);
      clearTimeout(timer.current);
      setRect(null);
    },
  });

  let style: React.CSSProperties = {};
  if (rect) {
    const gap = 8;
    if (side === 'top') style = { left: rect.left + rect.width / 2, top: rect.top - gap, translate: '-50% -100%' };
    if (side === 'bottom') style = { left: rect.left + rect.width / 2, top: rect.bottom + gap, translate: '-50% 0' };
    if (side === 'right') style = { left: rect.right + gap, top: rect.top + rect.height / 2, translate: '0 -50%' };
    if (side === 'left') style = { left: rect.left - gap, top: rect.top + rect.height / 2, translate: '-100% -50%' };
  }

  return (
    <>
      {child}
      {createPortal(
        <AnimatePresence>
          {rect && label && (
            <motion.div
              className="pointer-events-none fixed z-[100] whitespace-nowrap rounded-[7px] px-2 py-1 text-[11.5px] font-medium glass-pop"
              style={style}
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
              transition={{ duration: 0.14 }}
            >
              {label}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

// ─── Popover ─────────────────────────────────────────────────────────────────

export type Anchor = DOMRect | { x: number; y: number };

export function Popover({
  open,
  anchor,
  onClose,
  side = 'bottom',
  align = 'start',
  children,
  className,
  offset = 8,
}: {
  open: boolean;
  anchor: Anchor | null;
  onClose: () => void;
  side?: Side;
  align?: 'start' | 'center' | 'end';
  children: ReactNode;
  className?: string;
  offset?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) return setPos(null);
    const el = ref.current;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const r = 'width' in anchor ? anchor : new DOMRect(anchor.x, anchor.y, 0, 0);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let s = side;
    if (s === 'bottom' && r.bottom + offset + h > vh && r.top - offset - h > 0) s = 'top';
    if (s === 'top' && r.top - offset - h < 0) s = 'bottom';
    if (s === 'right' && r.right + offset + w > vw) s = 'left';

    let left = 0;
    let top = 0;
    if (s === 'bottom' || s === 'top') {
      top = s === 'bottom' ? r.bottom + offset : r.top - offset - h;
      left = align === 'start' ? r.left : align === 'end' ? r.right - w : r.left + r.width / 2 - w / 2;
    } else {
      left = s === 'right' ? r.right + offset : r.left - offset - w;
      top = align === 'start' ? r.top : align === 'end' ? r.bottom - h : r.top + r.height / 2 - h / 2;
    }
    left = Math.max(8, Math.min(left, vw - w - 8));
    top = Math.max(8, Math.min(top, vh - h - 8));
    const origin = s === 'bottom' ? 'top' : s === 'top' ? 'bottom' : s === 'right' ? 'left' : 'right';
    setPos({ left, top, origin });
  }, [open, anchor, side, align, offset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element;
      // Submenus render in their own portal (marked data-menu-layer) but belong to this popover.
      if (ref.current?.contains(target) || target.closest?.('[data-menu-layer]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => window.addEventListener('pointerdown', onDown), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && anchor && (
        <motion.div
          ref={ref}
          className={clsx('fixed z-[90] rounded-[14px] glass-pop', className)}
          style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, transformOrigin: pos?.origin }}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: pos ? 1 : 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
          transition={spring}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function MenuItem({
  icon,
  children,
  onClick,
  danger,
  trailing,
  disabled,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  trailing?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13px] transition-colors disabled:opacity-40',
        danger ? 'text-danger hover:bg-danger hover:text-white' : 'hover:bg-accent hover:text-white',
      )}
    >
      {icon && <span className="grid w-4 shrink-0 place-items-center opacity-80">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {trailing}
    </button>
  );
}

export const MenuSeparator = () => <div className="mx-2 my-1 h-px bg-[var(--hairline-strong)]" />;

/** A menu row that opens a side panel on hover (flips left near the screen edge). */
export function SubMenu({ icon, label, children }: { icon?: ReactNode; label: ReactNode; children: ReactNode }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = (el: HTMLElement) => {
    clearTimeout(timer.current);
    setRect(el.getBoundingClientRect());
  };
  // A short grace period lets the pointer cross the gap between the row and the panel.
  const hide = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setRect(null), 160);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  useLayoutEffect(() => {
    if (!rect || !panel.current) return setPos(null);
    const w = panel.current.offsetWidth;
    const h = panel.current.offsetHeight;
    const left = rect.right + 6 + w > window.innerWidth - 8 ? rect.left - 6 - w : rect.right + 6;
    const top = Math.max(8, Math.min(rect.top - 6, window.innerHeight - h - 8));
    setPos({ left, top });
  }, [rect]);

  return (
    <div onMouseEnter={(e) => show(e.currentTarget)} onMouseLeave={hide}>
      <MenuItem icon={icon} trailing={<ChevronRight size={13} className="opacity-50" />}>
        {label}
      </MenuItem>
      {createPortal(
        <AnimatePresence>
          {rect && (
            <motion.div
              ref={panel}
              data-menu-layer
              onMouseEnter={() => clearTimeout(timer.current)}
              onMouseLeave={hide}
              className="fixed z-[91] w-[216px] rounded-[12px] p-1.5 glass-pop"
              style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: pos ? 1 : 0, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
              transition={{ duration: 0.14 }}
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
// ─── Modal sheet ─────────────────────────────────────────────────────────────

export function Modal({
  open,
  onClose,
  children,
  width = 460,
  className,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[80] grid place-items-center p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          <div className="absolute inset-0 bg-black/45 backdrop-blur-[3px]" onPointerDown={onClose} />
          <motion.div
            role="dialog"
            aria-modal
            className={clsx('relative max-h-full overflow-hidden rounded-[22px] glass-pop', className)}
            style={{ width, maxWidth: '100%' }}
            initial={{ opacity: 0, scale: 0.93, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6, transition: { duration: 0.14 } }}
            transition={spring}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
