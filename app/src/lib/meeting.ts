import type { MeetingPreview } from '../../../shared/protocol';
import { api } from './api';

export const meetingUrl = (code: string) => `https://infimeety.pages.dev/${code}`;

const CODE = '([a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{3})';
const LINK = new RegExp(`(?:infimeety\\.pages\\.dev\\/(?:web\\/?\\?meet=)?|infimeety:\\/\\/meet\\/?)${CODE}(?![a-z0-9])`, 'i');
const BARE = /^\s*([a-z0-9]{4})-?([a-z0-9]{4})-?([a-z0-9]{3})\s*$/i;

/** Finds a meeting link (web or `infimeety://meet/`) in text. */
export function findMeetingCode(text: string): string | null {
  return LINK.exec(text)?.[1].toLowerCase() ?? null;
}

/** A pasted meeting link, or a code typed with or without its dashes. */
export function parseMeetingInput(text: string): string | null {
  const link = findMeetingCode(text);
  if (link) return link;
  const m = BARE.exec(text);
  return m ? `${m[1]}-${m[2]}-${m[3]}`.toLowerCase() : null;
}

/** The meeting a browser tab was opened for (`/web/?meet=CODE`), if any. */
export function meetingInLocation(): string | null {
  const code = new URLSearchParams(location.search).get('meet');
  return code ? parseMeetingInput(code) : null;
}

export const loadMeetingPreview = (code: string) => api<MeetingPreview>(`/meetings/${code}`).catch(() => null);

/** "in 23 h", "in 40 min" */
export function timeLeft(until: number) {
  const min = Math.max(1, Math.round((until - Date.now()) / 60_000));
  return min >= 60 ? `${Math.round(min / 60)} h` : `${min} min`;
}
