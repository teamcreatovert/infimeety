import clsx from 'clsx';
import { motion } from 'motion/react';
import { CalendarClock, CalendarPlus, Check, Copy, Download, Link2, Zap } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { Channel, MeetingRepeat } from '../../../../shared/protocol';
import { Modal } from '../ui/overlay';
import { Button, Select, TextField } from '../ui/primitives';
import { channelGradient } from '@/lib/format';
import { REPEAT_LABEL, googleCalendarUrl, invitationText, meetingUrl, openIcsInvite, outlookCalendarUrl, whenLabel, type CalendarEvent } from '@/lib/meeting';
import { openExternal } from '@/lib/platform';
import { confirmCallSwitch } from '@/lib/voice/callSwitch';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { useMeetings } from '@/stores/meetings';
import { toast } from '@/stores/ui';

/** "New meeting": start one now, make a link for later, or schedule one (like Google Meet). */
export function NewMeetingMenu({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState<'now' | 'later' | null>(null);
  const now = async () => {
    if (!(await confirmCallSwitch(null, 'Starting a new meeting'))) return;
    setBusy('now');
    try {
      const meeting = await useMeetings.getState().create();
      onDone();
      await useMeetings.getState().enterCall(meeting, { confirmed: true });
    } catch {
      toast({ kind: 'error', title: 'Couldn’t start a meeting', body: 'Check your connection.' });
    } finally {
      setBusy(null);
    }
  };
  const later = async () => {
    setBusy('later');
    try {
      await useMeetings.getState().create({ later: true });
      onDone();
    } catch {
      toast({ kind: 'error', title: 'Couldn’t make a meeting link', body: 'Check your connection.' });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="w-[268px] p-1.5">
      <Choice icon={<Zap size={15} />} title="Start a meeting now" detail="Opens the call right away" busy={busy === 'now'} onClick={() => void now()} />
      <Choice icon={<Link2 size={15} />} title="Create a meeting for later" detail="A link to share, ready when you are" busy={busy === 'later'} onClick={() => void later()} />
      <Choice
        icon={<CalendarClock size={15} />}
        title="Schedule a meeting"
        detail="Pick a time, repeat it, add it to calendars"
        onClick={() => {
          onDone();
          useMeetings.getState().set({ scheduling: true });
        }}
      />
    </div>
  );
}

function Choice({ icon, title, detail, onClick, busy }: { icon: ReactNode; title: string; detail: string; onClick: () => void; busy?: boolean }) {
  return (
    <button disabled={busy} onClick={onClick} className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 text-left transition-colors hover:bg-fill-2 disabled:opacity-60">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/12 text-accent">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium">{title}</span>
        <span className="block text-[11.5px] leading-snug text-fg-3">{detail}</span>
      </span>
    </button>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const dateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** The next half hour, at least 10 minutes from now. */
function nextSlot() {
  const d = new Date(Date.now() + 10 * 60_000);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return d;
}

const DURATIONS = [
  { value: '30', label: '30 minutes' },
  { value: '45', label: '45 minutes' },
  { value: '60', label: '1 hour' },
  { value: '90', label: '1½ hours' },
  { value: '120', label: '2 hours' },
];
const REPEATS: { value: 'none' | MeetingRepeat; label: string }[] = [
  { value: 'none', label: 'Doesn’t repeat' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly', label: 'Every week' },
];

/** Schedule a meeting: a time (maybe repeating), then the link and calendar invites. */
export function ScheduleMeetingModal() {
  const open = useMeetings((s) => s.scheduling);
  const close = () => useMeetings.getState().set({ scheduling: false });
  return (
    <Modal open={open} onClose={close} width={420}>
      {open && <Schedule onClose={close} />}
    </Modal>
  );
}

function Schedule({ onClose }: { onClose: () => void }) {
  const me = useAuth((s) => s.me);
  const slot = nextSlot();
  const [title, setTitle] = useState(`${me?.name ?? 'My'}’s meeting`);
  const [date, setDate] = useState(dateInput(slot));
  const [time, setTime] = useState(timeInput(slot));
  const [duration, setDuration] = useState('60');
  const [repeat, setRepeat] = useState<'none' | MeetingRepeat>('none');
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<Channel | null>(null);

  const startsAt = new Date(`${date}T${time}`).getTime();
  const valid = Number.isFinite(startsAt) && startsAt > Date.now() - 5 * 60_000 && startsAt < Date.now() + 90 * 86_400_000 && title.trim().length > 0;

  const schedule = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const channel = await useMeetings.getState().create({ name: title.trim(), startsAt, repeat: repeat === 'none' ? null : repeat });
      useMeetings.getState().set({ durations: { ...useMeetings.getState().durations, [channel.id]: Number(duration) } });
      setMade(channel);
    } catch {
      toast({ kind: 'error', title: 'Couldn’t schedule the meeting', body: 'Check your connection and the time you picked.' });
    } finally {
      setBusy(false);
    }
  };

  if (made)
    return (
      <div className="p-6">
        <Tile />
        <h2 className="mt-4 text-center font-display text-[20px] font-bold tracking-[-0.02em]">Meeting scheduled</h2>
        <p className="mt-1 text-center text-[13px] text-fg-2">
          {whenLabel(made.startsAt ?? startsAt)}
          {made.repeat ? ` · ${REPEAT_LABEL[made.repeat].toLowerCase()}` : ''}
        </p>
        <CalendarButtons channel={made} className="mt-5" />
        <Button variant="primary" className="mt-5 w-full" onClick={() => (useChannels.getState().select(made.id), onClose())}>
          Done
        </Button>
      </div>
    );

  return (
    <form
      className="p-6"
      onSubmit={(e) => {
        e.preventDefault();
        void schedule();
      }}
    >
      <Tile />
      <h2 className="mt-4 text-center font-display text-[20px] font-bold tracking-[-0.02em]">Schedule a meeting</h2>
      <div className="mt-5 flex flex-col gap-3 text-left">
        <Field label="Title">
          <TextField value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="Team catch-up" />
        </Field>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Date">
            <TextField type="date" value={date} min={dateInput(new Date())} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Starts at">
            <TextField type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Length">
            <Select value={duration} options={DURATIONS} onChange={setDuration} className="h-10! w-full max-w-none! text-[13px]!" />
          </Field>
          <Field label="Repeats">
            <Select value={repeat} options={REPEATS} onChange={setRepeat} className="h-10! w-full max-w-none! text-[13px]!" />
          </Field>
        </div>
      </div>
      <p className="mt-3 text-[11.5px] leading-snug text-fg-3">
        {repeat === 'none'
          ? 'The link opens anytime before the meeting and works for a day after it starts.'
          : 'The same link works every time. Each meeting starts with a fresh chat.'}
      </p>
      <div className="mt-5 flex gap-2">
        <Button type="button" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" className="flex-1" loading={busy} disabled={!valid}>
          Schedule
        </Button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-medium text-fg-2">{label}</span>
      {children}
    </label>
  );
}

function Tile() {
  return (
    <motion.div
      initial={{ scale: 0.8, rotate: -6 }}
      animate={{ scale: 1, rotate: 0 }}
      className="mx-auto grid h-[68px] w-[68px] place-items-center rounded-[22px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_14px_34px_rgba(0,0,0,0.3)]"
      style={{ background: channelGradient('teal') }}
    >
      <CalendarClock size={30} strokeWidth={1.8} />
    </motion.div>
  );
}

/** A meeting's calendar event (its scheduled time, or now). */
export function calendarEvent(channel: Channel, duration = 60): CalendarEvent {
  return { title: channel.name, start: channel.startsAt ?? Date.now(), duration, link: meetingUrl(channel.inviteCode ?? ''), repeat: channel.repeat ?? null };
}

/** Add to Google Calendar or Outlook, open in the calendar app, or copy the invitation. */
export function CalendarButtons({ channel, className }: { channel: Channel; className?: string }) {
  const duration = useMeetings((s) => s.durations[channel.id] ?? 60);
  const [copied, setCopied] = useState(false);
  const event = calendarEvent(channel, duration);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invitationText(event));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast({ kind: 'error', title: 'Couldn’t copy the invitation' });
    }
  };
  return (
    <div className={clsx('grid grid-cols-2 gap-2', className)}>
      <CalButton icon={<CalendarPlus size={14} />} onClick={() => void openExternal(googleCalendarUrl(event))}>
        Google Calendar
      </CalButton>
      <CalButton icon={<CalendarPlus size={14} />} onClick={() => void openExternal(outlookCalendarUrl(event))}>
        Outlook
      </CalButton>
      <CalButton icon={<Download size={14} />} onClick={() => void openIcsInvite(event, channel.id).catch(() => toast({ kind: 'error', title: 'Couldn’t open the invite' }))}>
        Calendar app (.ics)
      </CalButton>
      <CalButton icon={copied ? <Check size={14} className="text-success" /> : <Copy size={13} />} onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy invitation'}
      </CalButton>
    </div>
  );
}

function CalButton({ icon, children, onClick }: { icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-9 items-center justify-center gap-1.5 rounded-[10px] bg-fill-2 px-2 text-[12.5px] font-medium transition-colors hover:bg-fill-3">
      {icon}
      <span className="truncate">{children}</span>
    </button>
  );
}

/** "Tomorrow at 3:00 PM · every week" for a scheduled meeting; null otherwise. */
export function scheduleLabel(channel: Channel) {
  if (!channel.startsAt) return null;
  return `${whenLabel(channel.startsAt)}${channel.repeat ? ` · ${REPEAT_LABEL[channel.repeat].toLowerCase()}` : ''}`;
}

