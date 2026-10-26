import { findInviteCode } from './invite';
import { findMeetingCode } from './meeting';
import { isTauri } from './platform';
import { useMeetings } from '@/stores/meetings';
import { useUI } from '@/stores/ui';

/**
 * Links from the web pages open the app, or are handed to the already-running app:
 * `infimeety://invite/CODE` shows the "Join ⟨channel⟩?" sheet, `infimeety://meet/CODE` the "Join meeting?" one.
 */
export async function startDeepLinks() {
  if (!isTauri) return;
  const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
  const handle = (urls: string[] | null) => {
    for (const url of urls ?? []) {
      const meeting = findMeetingCode(url);
      if (meeting) {
        useMeetings.getState().set({ joining: meeting });
        continue;
      }
      const code = findInviteCode(url);
      if (code) useUI.getState().set({ pendingInvite: code });
    }
  };
  handle(await getCurrent().catch(() => null));
  await onOpenUrl(handle);
}
