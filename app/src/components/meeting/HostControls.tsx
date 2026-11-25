import clsx from 'clsx';
import { Check, Globe, Hand, Lock, MessageSquareLock, MessageSquareText, Mic, MicOff, PenLine, ScreenShare, ShieldCheck, SmilePlus, UserCheck, Video } from 'lucide-react';
import type { ReactNode } from 'react';
import { DEFAULT_MEETING, type MeetingSettings, type VoiceParticipant } from '../../../../shared/protocol';
import { Switch } from '../ui/primitives';
import { useMeetings } from '@/stores/meetings';
import { toast } from '@/stores/ui';

const ACCESS: { value: MeetingSettings['access']; label: string; detail: string; icon: ReactNode }[] = [
  { value: 'open', label: 'Open', detail: 'Anyone with the link joins straight away', icon: <Globe size={15} /> },
  { value: 'trusted', label: 'Trusted', detail: 'Infimeety users join straight away, guests ask first', icon: <UserCheck size={15} /> },
  { value: 'restricted', label: 'Restricted', detail: 'Everyone asks first, and you let them in', icon: <ShieldCheck size={15} /> },
];

const EVERYONE: { key: 'share' | 'chat' | 'privateChat' | 'mic' | 'camera' | 'reactions'; label: string; icon: ReactNode }[] = [
  { key: 'share', label: 'Share their screen', icon: <ScreenShare size={15} /> },
  { key: 'chat', label: 'Send chat messages', icon: <MessageSquareText size={15} /> },
  { key: 'privateChat', label: 'Message each other privately', icon: <MessageSquareLock size={15} /> },
  { key: 'mic', label: 'Turn on their mic', icon: <Mic size={15} /> },
  { key: 'camera', label: 'Turn on their camera', icon: <Video size={15} /> },
  { key: 'reactions', label: 'Send reactions', icon: <SmilePlus size={15} /> },
];

/** The host's and co-hosts' controls for a meeting (like Google Meet's): who gets in, and what everyone may do. */
export function HostControls({ channelId, participants, myPeer, onDone }: { channelId: string; participants: VoiceParticipant[]; myPeer: string | null; onDone: () => void }) {
  const saved = useMeetings((s) => s.settings[channelId]);
  const rules = { ...DEFAULT_MEETING, ...saved };
  const set = (patch: Partial<MeetingSettings>) => useMeetings.getState().configure(channelId, patch);
  const hands = participants.filter((p) => p.hand).length;
  const talking = participants.filter((p) => p.peerId !== myPeer && !p.muted).length;

  return (
    <div className="w-[332px] max-w-[calc(100vw-24px)] p-2">
      <div className="px-2 pb-2 pt-1">
        <div className="font-display text-[15px] font-semibold tracking-[-0.01em]">Host controls</div>
        <div className="text-[11.5px] text-fg-3">Only the host and co-hosts see these.</div>
      </div>

      <Section title="Meeting access">
        <div className="flex flex-col gap-1" role="radiogroup" aria-label="Meeting access">
          {ACCESS.map((a) => {
            const on = rules.access === a.value;
            return (
              <button
                key={a.value}
                role="radio"
                aria-checked={on}
                onClick={() => set({ access: a.value })}
                className={clsx(
                  'flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors',
                  on ? 'bg-accent/12 shadow-[inset_0_0_0_1px_var(--accent)]' : 'hover:bg-fill-2',
                )}
              >
                <span className={clsx('grid h-7 w-7 shrink-0 place-items-center rounded-full', on ? 'bg-accent text-white' : 'bg-fill-2 text-fg-2')}>{a.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{a.label}</span>
                  <span className="block text-[11.5px] leading-snug text-fg-3">{a.detail}</span>
                </span>
                {on && <Check size={15} className="shrink-0 text-accent" />}
              </button>
            );
          })}
        </div>
        <Row icon={<Lock size={15} />} label="Lock the meeting" detail="Nobody new can join, even by asking">
          <Switch checked={rules.locked} onChange={(v) => set({ locked: v })} />
        </Row>
      </Section>

      <Section title="Let everyone">
        {EVERYONE.map((e) => (
          <Row key={e.key} icon={e.icon} label={e.label}>
            <Switch checked={rules[e.key]} onChange={(v) => set({ [e.key]: v })} />
          </Row>
        ))}
      </Section>

      <Section title="Advanced">
        <Row icon={<PenLine size={15} />} label="Draw on shared screens" detail={rules.share ? 'You, co-hosts and everyone who can share can mark up a shared screen' : 'You and co-hosts can mark up a shared screen'}>
          <Switch checked={rules.annotate} onChange={(v) => set({ annotate: v })} />
        </Row>
      </Section>

      <div className="mt-1 grid grid-cols-2 gap-1.5 px-1 pb-1">
        <ActionButton
          icon={<MicOff size={14} />}
          disabled={!talking}
          onClick={() => {
            useMeetings.getState().act(channelId, 'muteAll');
            toast({ kind: 'success', title: 'Everyone’s muted', body: rules.mic ? 'They can unmute themselves when they want to talk.' : undefined });
            onDone();
          }}
        >
          Mute everyone
        </ActionButton>
        <ActionButton
          icon={<Hand size={14} />}
          disabled={!hands}
          onClick={() => {
            useMeetings.getState().act(channelId, 'lowerHands');
            onDone();
          }}
        >
          Lower all hands{hands ? ` (${hands})` : ''}
        </ActionButton>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-1.5 rounded-[14px] bg-fill-1 p-1.5">
      <h3 className="px-1.5 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-3">{title}</h3>
      {children}
    </section>
  );
}

function Row({ icon, label, detail, children }: { icon: ReactNode; label: string; detail?: string; children: ReactNode }) {
  return (
    <label className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 py-1.5">
      <span className="grid w-4 shrink-0 place-items-center text-fg-2">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px]">{label}</span>
        {detail && <span className="block text-[11.5px] leading-snug text-fg-3">{detail}</span>}
      </span>
      {children}
    </label>
  );
}

function ActionButton({ icon, children, onClick, disabled }: { icon: ReactNode; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="flex h-9 items-center justify-center gap-1.5 rounded-[10px] bg-fill-2 px-2 text-[12.5px] font-medium transition-colors hover:bg-fill-3 disabled:opacity-40 disabled:hover:bg-fill-2"
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  );
}
