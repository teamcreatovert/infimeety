import { ShieldCheck } from 'lucide-react';
import { hasSettingsBackup, keepDefaults, restoreSettings } from '@/lib/boot';

/**
 * Shown while Infimeety runs in Safe Mode (it crashed twice in a row while starting). Your own
 * settings are kept aside: bring them back, or keep the defaults if they were the problem.
 */
export function SafeModeBanner() {
  const backup = hasSettingsBackup();
  return (
    <div className="absolute inset-x-0 top-0 z-40 flex justify-center p-2">
      <div className="flex max-w-[640px] items-center gap-3 rounded-[14px] px-3.5 py-2.5 text-[12.5px] glass-pop compact:flex-wrap">
        <ShieldCheck size={17} className="shrink-0 text-success" />
        <span className="min-w-0 flex-1 leading-snug">
          <b className="font-semibold">Safe Mode.</b> Infimeety had trouble starting, so it opened with default settings.{' '}
          {backup ? 'Your own settings are kept.' : ''}
        </span>
        {backup && (
          <button onClick={restoreSettings} className="h-7 shrink-0 rounded-[8px] bg-fill-2 px-3 font-semibold shadow-[inset_0_0_0_0.5px_var(--hairline-strong)] hover:bg-fill-3">
            Restore my settings
          </button>
        )}
        <button onClick={keepDefaults} className="h-7 shrink-0 rounded-[8px] bg-accent px-3 font-semibold text-white hover:brightness-110">
          {backup ? 'Keep defaults' : 'Done'}
        </button>
      </div>
    </div>
  );
}
