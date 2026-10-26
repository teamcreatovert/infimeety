import clsx from 'clsx';
import { motion, type HTMLMotionProps } from 'motion/react';
import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { snappy, spring } from '@/lib/motion';
import { Tooltip } from './overlay';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'plain';

export const Button = forwardRef<
  HTMLButtonElement,
  HTMLMotionProps<'button'> & { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode; loading?: boolean }
>(function Button({ variant = 'secondary', size = 'md', icon, loading, className, children, disabled, ...rest }, ref) {
  return (
    <motion.button
      ref={ref}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={snappy}
      disabled={disabled || loading}
      className={clsx(
        'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background,opacity,box-shadow] duration-150 disabled:opacity-45',
        size === 'sm' && 'h-7 rounded-[8px] px-3 text-[12px]',
        size === 'md' && 'h-9 rounded-[10px] px-4 text-[13px]',
        size === 'lg' && 'h-11 rounded-[12px] px-5 text-[14px]',
        variant === 'primary' && 'bg-accent text-white shadow-[inset_0_0.5px_0_rgba(255,255,255,0.35),0_1px_2px_rgba(0,0,0,0.2)] hover:brightness-110',
        variant === 'secondary' && 'bg-fill-2 text-fg shadow-[inset_0_0_0_0.5px_var(--hairline-strong)] hover:bg-fill-3',
        variant === 'ghost' && 'text-fg-2 hover:bg-fill-2 hover:text-fg',
        variant === 'danger' && 'bg-danger text-white shadow-[inset_0_0.5px_0_rgba(255,255,255,0.3)] hover:brightness-110',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : icon}
      {children as ReactNode}
    </motion.button>
  );
});

export function IconButton({
  label,
  children,
  active,
  tone,
  size = 30,
  tooltipSide = 'top',
  className,
  ...rest
}: HTMLMotionProps<'button'> & {
  label: string;
  active?: boolean;
  tone?: 'danger' | 'accent' | 'success';
  size?: number;
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
}) {
  const toneColor = tone === 'danger' ? 'var(--danger)' : tone === 'success' ? 'var(--success)' : 'var(--accent)';
  return (
    <Tooltip label={label} side={tooltipSide}>
      <motion.button
        aria-label={label}
        whileTap={{ scale: 0.9 }}
        transition={snappy}
        className={clsx(
          'grid shrink-0 place-items-center rounded-[9px] transition-colors duration-150',
          !tone && !active && 'text-fg-2 hover:bg-fill-2 hover:text-fg',
          !tone && active && 'bg-fill-3 text-fg',
          className,
        )}
        style={{
          width: size,
          height: size,
          ...(tone
            ? { color: toneColor, background: `color-mix(in srgb, ${toneColor} ${active ? 22 : 14}%, transparent)` }
            : null),
        }}
        {...rest}
      >
        {children}
      </motion.button>
    </Tooltip>
  );
}

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40"
      style={{ background: checked ? 'var(--accent)' : 'var(--fill-3)' }}
    >
      <motion.span
        className="absolute left-[2px] top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3),0_0_0_0.5px_rgba(0,0,0,0.06)]"
        animate={{ x: checked ? 16 : 0 }}
        transition={snappy}
      />
    </button>
  );
}

export function Slider({
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  className,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  className?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      className={clsx('slider', className)}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ ['--pct' as string]: `${pct}%` }}
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  id,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  id: string;
  className?: string;
}) {
  return (
    <div className={clsx('flex rounded-[10px] bg-fill-2 p-[3px] shadow-[inset_0_0_0_0.5px_var(--hairline)]', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx('relative flex-1 rounded-[7px] px-3 py-1 text-[12.5px] font-medium transition-colors', value === o.value ? 'text-fg' : 'text-fg-2 hover:text-fg')}
        >
          {value === o.value && (
            <motion.span
              layoutId={`seg-${id}`}
              transition={spring}
              className="absolute inset-0 rounded-[7px] bg-[var(--glass-pop)] shadow-[0_1px_3px_rgba(0,0,0,0.18),inset_0_0_0_0.5px_var(--hairline-strong)]"
            />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export const TextField = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { leading?: ReactNode; trailing?: ReactNode; inputClassName?: string }
>(function TextField({ leading, trailing, className, inputClassName, ...rest }, ref) {
  return (
    <label className={clsx('field flex h-10 items-center gap-2 px-3', className)}>
      {leading && <span className="shrink-0 text-fg-3">{leading}</span>}
      <input ref={ref} className={clsx('h-full w-full min-w-0 bg-transparent text-[14px] outline-none placeholder:text-fg-3', inputClassName)} {...rest} />
      {trailing && <span className="shrink-0">{trailing}</span>}
    </label>
  );
});

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={clsx('animate-spin', className)} fill="none">
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M21.5 12a9.5 9.5 0 0 0-9.5-9.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/** A macOS System Settings–style grouped list. */
export function Group({ title, footer, children }: { title?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-5">
      {title && <h3 className="mb-1.5 px-1 text-[12px] font-semibold text-fg-2">{title}</h3>}
      <div className="overflow-hidden rounded-[12px] bg-fill-1 shadow-[inset_0_0_0_0.5px_var(--hairline-strong)] [&>*+*]:shadow-[inset_0_0.5px_0_var(--hairline)]">
        {children}
      </div>
      {footer && <p className="mt-1.5 px-1 text-[11.5px] leading-snug text-fg-3">{footer}</p>}
    </section>
  );
}

export function Row({ label, detail, children, className }: { label: ReactNode; detail?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex min-h-[44px] items-center gap-4 px-3.5 py-2 compact:flex-wrap compact:gap-y-2', className)}>
      <div className="min-w-0 flex-1">
        <div className="text-[13px]">{label}</div>
        {detail && <div className="mt-0.5 text-[11.5px] leading-snug text-fg-3">{detail}</div>}
      </div>
      {children}
    </div>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={clsx('field h-8 max-w-[260px] truncate px-2.5 text-[12.5px] outline-none', className)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-[#1c1c22] text-white">
          {o.label}
        </option>
      ))}
    </select>
  );
}
