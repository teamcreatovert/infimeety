import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Copy, Link2, LogOut, Phone, PhoneOff, Video, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Channel, Room, VoiceParticipant } from '../../../../shared/protocol';
import { Avatar } from '../ui/Avatar';
import { Popover, Tooltip, type Anchor } from '../ui/overlay';
import { MobileBack } from '../shell/MobileBack';
import { Button } from '../ui/primitives';
import { ChatToggle, VoiceChatPanel, VoiceRoomView } from '../voice/VoiceRoomView';
import { channelGradient } from '@/lib/format';
import { meetingUrl, timeLeft } from '@/lib/meeting';
import { spring } from '@/lib/motion';
import { useCompact } from '@/lib/responsive';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { useMeetings } from '@/stores/meetings';
import { toast, useUI } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

const EMPTY: VoiceParticipant[] = [];

function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return toast({ kind: 'error', title: 'Couldn’t copy the link' });
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return [copied, copy] as const;
}

/** A quick meeting: its call (with the meeting chat beside it), or the "ready to join" screen. */
export function MeetingView({ channel }: { channel: Channel }) {
  const callRoom = channel.rooms.find((r) => r.kind === 'voice');
  const chatRoom = channel.rooms.find((r) => r.kind === 'text');
  const inCall = useVoice((s) => !!callRoom && s.roomId === callRoom.id);
  if (!callRoom || !chatRoom) return null;

  return (
    <div className="relative h-full">
      {inCall ? (
        <VoiceRoomView channel={channel} room={callRoom} chatRoom={chatRoom} extras={<StageActions channel={channel} />} />
      ) : (
        <MeetingLobby channel={channel} callRoom={callRoom} chatRoom={chatRoom} />
      )}
      {/* The lobby shows the link itself. */}
      {inCall && <ShareCard channel={channel} />}
    </div>
  );
}

/** In the call's header: the link to share, and End for the host. */
function StageActions({ channel }: { channel: Channel }) {
  const [copied, copy] = useCopy();
  const compact = useCompact();
  const code = channel.inviteCode ?? '';
  const link = meetingUrl(code);
  // Phones hand the link to the share sheet (Messages, WhatsApp…); computers copy it.
  const share = async () => {
    if (compact && navigator.share) {
      await navigator.share({ title: channel.name, text: `Join ${channel.name} on Infimeety`, url: link }).catch(() => {});
      return;
    }
    await copy(link);
  };
  return (
    <>
      <Tooltip label={copied ? 'Link copied' : 'Copy the meeting link'} side="bottom">
        <button
          aria-label="Share the meeting link"
          onClick={() => void share()}
          className="mr-1 flex h-[30px] shrink-0 items-center gap-1.5 rounded-full bg-fill-2 px-3 font-mono text-[12px] text-fg-2 transition-colors hover:bg-fill-3 hover:text-fg compact:mr-0 compact:h-9 compact:w-9 compact:justify-center compact:px-0"
        >
          {copied ? <Check size={compact ? 16 : 13} className="text-success" /> : <Link2 size={compact ? 16 : 13} />}
          <span className="compact:hidden">{code}</span>
        </button>
      </Tooltip>
      {channel.role === 'owner' && <EndMeeting channel={channel} variant="pill" />}
    </>
  );
}

function MeetingLobby({ channel, callRoom, chatRoom }: { channel: Channel; callRoom: Room; chatRoom: Room }) {
  const all = useChannels((s) => s.voice[channel.id]?.participants ?? EMPTY);
  const participants = useMemo(() => all.filter((p) => p.roomId === callRoom.id).sort((a, b) => a.joinedAt - b.joinedAt), [all, callRoom.id]);
  const users = useChannels((s) => s.users);
  const voiceChat = useUI((s) => s.voiceChat);
  const guest = useAuth((s) => !!s.me?.guest);
  const [busy, setBusy] = useState<'voice' | 'video' | null>(null);
  const [leaving, setLeaving] = useState(false);

  const names = participants.map((p) => users[p.userId]?.name ?? 'Someone');
  const who =
    names.length === 0
      ? 'Nobody’s in the call right now'
      : names.length <= 2
        ? `${names.join(' and ')} ${names.length === 1 ? 'is' : 'are'} in the call`
        : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more are in the call`;

  const join = async (camera: boolean) => {
    setBusy(camera ? 'video' : 'voice');
    try {
      await useMeetings.getState().enterCall(channel, { camera });
    } finally {
      setBusy(null);
    }
  };

  const leave = async () => {
    setLeaving(true);
    try {
      await useMeetings.getState().leave(channel.id);
    } catch {
      toast({ kind: 'error', title: 'Couldn’t leave the meeting' });
      setLeaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header data-tauri-drag-region className="hairline-b flex h-[52px] shrink-0 items-center gap-2 px-5 compact:px-3">
          <MobileBack />
          <Video size={18} className="shrink-0 text-fg-3" />
          <h1 data-tauri-drag-region className="truncate font-display text-[15px] font-semibold tracking-[-0.015em]">
            {channel.name}
          </h1>
          <div data-tauri-drag-region className="flex-1 self-stretch" />
          <ChatToggle />
        </header>
        <div className="grid flex-1 place-items-center overflow-y-auto p-8 compact:p-5">
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="flex w-full max-w-[400px] flex-col items-center text-center">
            <motion.div
              className="grid h-24 w-24 place-items-center rounded-[30px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_20px_50px_rgba(0,0,0,0.35)]"
              style={{ background: channelGradient(channel.color) }}
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Video size={40} strokeWidth={1.8} />
            </motion.div>
            <h2 className="mt-6 font-display text-[28px] font-bold tracking-[-0.03em]">{channel.name}</h2>
            <p className="mt-1.5 flex items-center gap-2 text-[14px] text-fg-2">
              {participants.length > 0 && <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-success shadow-[0_0_0_3px_color-mix(in_srgb,var(--success)_25%,transparent)]" />}
              {who}
            </p>
            {participants.length > 0 && (
              <div className="mt-4 flex -space-x-2">
                {participants.slice(0, 6).map((p) => (
                  <div key={p.peerId} className="rounded-full shadow-[0_0_0_2.5px_var(--ring-bg)]">
                    <Avatar user={users[p.userId]} size={34} />
                  </div>
                ))}
              </div>
            )}
            <div className="mt-7 flex w-full gap-2">
              <Button variant="primary" size="lg" className="flex-1" icon={<Phone size={17} />} loading={busy === 'voice'} disabled={!!busy} onClick={() => void join(false)}>
                Join now
              </Button>
              <Button size="lg" className="flex-1" icon={<Video size={17} />} loading={busy === 'video'} disabled={!!busy} onClick={() => void join(true)}>
                Join with video
              </Button>
            </div>
            {channel.inviteCode && <LinkField code={channel.inviteCode} className="mt-6" />}
            {channel.expiresAt && (
              <p className="mt-2.5 text-[11.5px] leading-snug text-fg-3">
                The link works for {timeLeft(channel.expiresAt)} more, or until nobody has been in the call for an hour.
              </p>
            )}
            {channel.role === 'owner' ? (
              <EndMeeting channel={channel} variant="link" />
            ) : (
              !guest && (
                <Button variant="ghost" size="sm" className="mt-5" icon={<LogOut size={13} />} loading={leaving} onClick={() => void leave()}>
                  Leave meeting
                </Button>
              )
            )}
          </motion.div>
        </div>
      </div>
      <VoiceChatPanel open={voiceChat} channel={channel} room={chatRoom} />
    </div>
  );
}

function LinkField({ code, className }: { code: string; className?: string }) {
  const [copied, copy] = useCopy();
  const link = meetingUrl(code);
  return (
    <div className={clsx('field flex h-10 w-full items-center gap-2 pl-3 pr-1', className)}>
      <Link2 size={14} className="shrink-0 text-fg-3" />
      <span className="selectable min-w-0 flex-1 truncate text-left font-mono text-[12px]">{link}</span>
      <Button size="sm" variant={copied ? 'secondary' : 'primary'} icon={copied ? <Check size={13} /> : <Copy size={12} />} onClick={() => void copy(link)}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

/** Shown once, right after you start a meeting. */
function ShareCard({ channel }: { channel: Channel }) {
  const open = useMeetings((s) => s.sharing === channel.id);
  const close = () => useMeetings.getState().set({ sharing: null });
  return (
    <AnimatePresence>
      {open && channel.inviteCode && (
        <motion.div
          initial={{ opacity: 0, y: -10, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.97, transition: { duration: 0.14 } }}
          transition={spring}
          className="absolute left-5 top-[64px] z-40 w-[372px] max-w-[calc(100%-40px)] rounded-[20px] p-4 glass-pop compact:left-2.5 compact:top-[58px] compact:max-w-[calc(100%-20px)]"
        >
          <button aria-label="Close" onClick={close} className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-fill-2 text-fg-2 hover:bg-fill-3">
            <X size={14} />
          </button>
          <div className="font-display text-[16px] font-semibold tracking-[-0.015em]">Your meeting’s ready</div>
          <p className="mt-1 pr-8 text-[12.5px] leading-snug text-fg-2">Share this link with the people you want in the meeting.</p>
          <LinkField code={channel.inviteCode} className="mt-3" />
          <p className="mt-2.5 text-[11.5px] leading-snug text-fg-3">People with Infimeety join right away. Anyone else can join from their browser once you let them in.</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function EndMeeting({ channel, variant }: { channel: Channel; variant: 'pill' | 'link' }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [busy, setBusy] = useState(false);
  const end = async () => {
    setBusy(true);
    try {
      await useMeetings.getState().end(channel.id);
    } catch {
      toast({ kind: 'error', title: 'Couldn’t end the meeting' });
      setBusy(false);
    }
  };

  return (
    <>
      {variant === 'pill' ? (
        <button
          aria-label="End the meeting"
          onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
          className="mr-1 flex h-[30px] shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold text-danger transition-[filter] hover:brightness-125 compact:mr-0 compact:h-9"
          style={{ background: 'color-mix(in srgb, var(--danger) 14%, transparent)' }}
        >
          <PhoneOff size={13} /> End
        </button>
      ) : (
        <button onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())} className="mt-5 text-[12.5px] font-medium text-danger hover:underline">
          End meeting for everyone
        </button>
      )}
      <Popover open={!!anchor} anchor={anchor} onClose={() => setAnchor(null)} side={variant === 'pill' ? 'bottom' : 'top'} align="center" className="w-[280px] p-3.5">
        <div className="text-[14px] font-semibold">End the meeting for everyone?</div>
        <p className="mt-1 text-[12px] leading-snug text-fg-2">Everyone is disconnected, the link stops working and the meeting’s chat is deleted.</p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => setAnchor(null)}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" className="flex-1" loading={busy} onClick={() => void end()}>
            End meeting
          </Button>
        </div>
      </Popover>
    </>
  );
}
