import { invoke } from '@tauri-apps/api/core';
import type { MeetingPreview, MeetingRepeat } from '../../../shared/protocol';
import { api } from './api';
import { isTauri } from './platform';

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

// ─── Scheduling and calendars ─────────────────────────────────────────────────

export const REPEAT_LABEL: Record<MeetingRepeat, string> = { daily: 'Every day', weekdays: 'Every weekday', weekly: 'Every week' };

/** "Today at 3:00 PM", "Tomorrow at 9:30 AM", "Tue, Nov 25 at 3:00 PM" */
export function whenLabel(at: number) {
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = new Date(at).setHours(0, 0, 0, 0);
  const today = new Date().setHours(0, 0, 0, 0);
  const diff = Math.round((day - today) / 86_400_000);
  const date = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return `${date} at ${time}`;
}

export interface CalendarEvent {
  title: string;
  start: number;
  /** Minutes. */
  duration: number;
  link: string;
  repeat?: MeetingRepeat | null;
}

const RRULE: Record<MeetingRepeat, string> = { daily: 'FREQ=DAILY', weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', weekly: 'FREQ=WEEKLY' };
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const details = (e: CalendarEvent) => `Join the Infimeety meeting: ${e.link}\n\nOpens in the Infimeety app, or in any browser.`;

export function googleCalendarUrl(e: CalendarEvent) {
  const q = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates: `${stamp(e.start)}/${stamp(e.start + e.duration * 60_000)}`, details: details(e), location: e.link });
  if (e.repeat) q.set('recur', `RRULE:${RRULE[e.repeat]}`);
  return `https://calendar.google.com/calendar/render?${q}`;
}

export function outlookCalendarUrl(e: CalendarEvent) {
  const q = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: e.title,
    startdt: new Date(e.start).toISOString(),
    enddt: new Date(e.start + e.duration * 60_000).toISOString(),
    body: details(e),
    location: e.link,
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${q}`;
}

/** An .ics invite that any calendar app opens (Outlook, Apple Calendar, Google Calendar). */
export function icsInvite(e: CalendarEvent, uid: string) {
  const esc = (t: string) => t.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Infimeety//Meetings//EN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}@infimeety`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(e.start)}`,
    `DTEND:${stamp(e.start + e.duration * 60_000)}`,
    ...(e.repeat ? [`RRULE:${RRULE[e.repeat]}`] : []),
    `SUMMARY:${esc(e.title)}`,
    `DESCRIPTION:${esc(details(e))}`,
    `LOCATION:${esc(e.link)}`,
    `URL:${e.link}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

/** The desktop app opens the invite in the calendar app; a browser downloads it. */
export async function openIcsInvite(e: CalendarEvent, uid: string) {
  const ics = icsInvite(e, uid);
  if (isTauri) return invoke('open_calendar_invite', { name: e.title, ics });
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${e.title.replace(/[^\w -]/g, '').trim() || 'Infimeety meeting'}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** The text to paste in an email or chat. */
export function invitationText(e: CalendarEvent) {
  const when = `${whenLabel(e.start)}${e.repeat ? `, ${REPEAT_LABEL[e.repeat].toLowerCase()}` : ''}`;
  return `${e.title}\n${when}\n\nJoin on Infimeety: ${e.link}`;
}
