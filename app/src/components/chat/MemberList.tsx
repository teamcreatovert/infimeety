import { Crown, ShieldCheck } from 'lucide-react';
import type { Channel, Member } from '../../../../shared/protocol';
import { Avatar } from '../ui/Avatar';
import { Tooltip } from '../ui/overlay';
import { useChannels } from '@/stores/channels';

const EMPTY: Member[] = [];
const NONE: string[] = [];

export function MemberList({ channel }: { channel: Channel }) {
  const members = useChannels((s) => s.members[channel.id] ?? EMPTY);
  const onlineIds = useChannels((s) => s.online[channel.id] ?? NONE);
  const voice = useChannels((s) => s.voice[channel.id]);
  const online = new Set(onlineIds);
  const inVoice = new Set(voice?.participants.map((p) => p.userId));
  const rank = { owner: 0, admin: 1, member: 2 };
  const sorted = [...members].sort((a, b) => rank[a.role] - rank[b.role] || a.name.localeCompare(b.name));
  const on = sorted.filter((m) => online.has(m.id));
  const off = sorted.filter((m) => !online.has(m.id));

  return (
    <div className="scroll h-full w-[248px] px-2.5 pb-4 pt-3" style={{ scrollbarGutter: 'auto' }}>
      <Group title={`Online — ${on.length}`}>
        {on.map((m) => (
          <MemberRow key={m.id} m={m} online inVoice={inVoice.has(m.id)} />
        ))}
      </Group>
      {off.length > 0 && (
        <Group title={`Offline — ${off.length}`}>
          {off.map((m) => (
            <MemberRow key={m.id} m={m} online={false} inVoice={false} />
          ))}
        </Group>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-fg-3">{title}</div>
      {children}
    </div>
  );
}

function MemberRow({ m, online, inVoice }: { m: Member; online: boolean; inVoice: boolean }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[9px] px-2 py-1.5 transition-colors hover:bg-fill-1" style={{ opacity: online ? 1 : 0.45 }}>
      <Avatar user={m} size={32} presence={online ? 'online' : 'offline'} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="truncate text-[13px] font-medium">{m.name}</span>
          {m.role === 'owner' && (
            <Tooltip label="Owner">
              <Crown size={12} className="shrink-0 text-[#ffd60a]" />
            </Tooltip>
          )}
          {m.role === 'admin' && (
            <Tooltip label="Admin">
              <ShieldCheck size={12} className="shrink-0 text-accent" />
            </Tooltip>
          )}
        </div>
        <div className="truncate text-[11.5px] text-fg-3">{inVoice ? '🔊 In a voice room' : `@${m.username}`}</div>
      </div>
    </div>
  );
}
