import type { InvitePreview } from '../../../shared/protocol';
import { api } from './api';

export const inviteUrl = (code: string) => `https://infimeety.pages.dev/invite/${code}`;

const LINK = /(?:infimeety\.pages\.dev\/invite\/|infimeety:\/\/invite\/?)([A-Za-z0-9]{8})\b/i;

/** Finds an invite link (web or `infimeety://`) in text. */
export function findInviteCode(text: string): string | null {
  return LINK.exec(text)?.[1].toUpperCase() ?? null;
}

/** "Join with a code" accepts a bare code or a whole invite link. */
export function parseJoinInput(text: string): string {
  return (findInviteCode(text) ?? text.toUpperCase().replace(/[^A-Z0-9]/g, '')).slice(0, 8);
}

const previews = new Map<string, Promise<InvitePreview | null>>();

export function loadInvitePreview(code: string) {
  if (!previews.has(code)) previews.set(code, api<InvitePreview>(`/invites/${code}`).catch(() => null));
  return previews.get(code)!;
}
