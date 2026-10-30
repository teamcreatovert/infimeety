import { useEffect } from 'react';
import { Button } from './ui/primitives';
import { APP_VERSION, DOWNLOAD_PAGE } from '@/config';
import { isTauri, openExternal } from '@/lib/platform';
import { useRemote, useUpdateRequired } from '@/lib/remote';
import { useUpdater } from '@/lib/updater';

/**
 * This version is older than the server still supports (RemoteConfig.minVersion): rather than
 * half-working with friends on newer versions, it asks to update. The desktop app updates in
 * place; the web app just reloads into the latest.
 */
export function UpdateRequired() {
  const required = useUpdateRequired();
  const minVersion = useRemote((s) => s.minVersion);
  const { status, progress } = useUpdater();

  useEffect(() => {
    if (required && isTauri && status === 'idle') void useUpdater.getState().check(true);
  }, [required, status]);

  if (!required) return null;
  const busy = status === 'checking' || status === 'downloading' || status === 'installing';
  const update = () => {
    if (!isTauri) return location.reload();
    if (status === 'available') return void useUpdater.getState().install();
    if (status === 'error' || status === 'uptodate' || status === 'unsupported') return openExternal(DOWNLOAD_PAGE);
    void useUpdater.getState().check(true);
  };
  const label =
    status === 'downloading'
      ? `Downloading… ${Math.round((progress ?? 0) * 100)}%`
      : status === 'installing'
        ? 'Installing…'
        : !isTauri
          ? 'Reload'
          : status === 'error' || status === 'uptodate' || status === 'unsupported'
            ? 'Download the latest version'
            : 'Update now';

  return (
    <div className="absolute inset-0 z-[90] grid place-items-center bg-black/40 p-6 backdrop-blur-[6px]">
      <div className="w-full max-w-[380px] rounded-[24px] p-7 text-center glass-pop">
        <div className="emoji text-[40px]">✨</div>
        <h1 className="mt-3 font-display text-[19px] font-semibold tracking-[-0.02em]">Time to update Infimeety</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-fg-2">
          Your friends are on a newer version, and this one ({APP_VERSION}) can’t keep up with them anymore. Updating takes a moment, and you stay signed in.
        </p>
        <Button variant="primary" className="mt-5 w-full" loading={busy} onClick={update}>
          {label}
        </Button>
        <p className="mt-3 text-[11.5px] text-fg-3">Needs version {minVersion} or newer.</p>
      </div>
    </div>
  );
}
