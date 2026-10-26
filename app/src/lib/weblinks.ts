import { findInviteCode } from './invite';
import { meetingInLocation } from './meeting';
import { isApp } from './platform';
import { useMeetings } from '@/stores/meetings';
import { useUI } from '@/stores/ui';

/**
 * The web app's version of deep links: /web/?meet=CODE asks "Join this meeting?" and
 * /web/?invite=CODE "Join this channel?", once you're signed in. The link is then
 * dropped from the address bar so a refresh doesn't ask again.
 */
export function startWebLinks() {
  if (isApp) return;
  const params = new URLSearchParams(location.search);
  const meeting = meetingInLocation();
  const invite = params.get('invite') ? findInviteCode(`infimeety://invite/${params.get('invite')}`) : null;
  if (meeting) useMeetings.getState().set({ joining: meeting });
  else if (invite) useUI.getState().set({ pendingInvite: invite });
  if (meeting || invite) pendingLink = meeting ? { kind: 'meet', code: meeting } : { kind: 'invite', code: invite! };
  if (params.has('meet') || params.has('invite') || params.has('guest')) history.replaceState(null, '', location.pathname);
}

/** What the page was opened for, so the sign-in screen can offer to join a meeting as a guest instead. */
export let pendingLink: { kind: 'meet' | 'invite'; code: string } | null = null;
