import { findInviteCode } from './invite';
import { isTauri } from './platform';
import { useUI } from '@/stores/ui';

/**
 * Invite links: `infimeety://invite/CODE` (from the invite web page) opens the app, or is
 * handed to the already-running app, and shows the "Join ⟨channel⟩?" sheet.
 */
export async function startDeepLinks() {
  if (!isTauri) return;
  const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
  const handle = (urls: string[] | null) => {
    for (const url of urls ?? []) {
      const code = findInviteCode(url);
      if (code) useUI.getState().set({ pendingInvite: code });
    }
  };
  handle(await getCurrent().catch(() => null));
  await onOpenUrl(handle);
}
