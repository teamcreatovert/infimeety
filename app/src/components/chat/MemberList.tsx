import { Crown, ShieldCheck, UserPlus } from 'lucide-react';
import type { Channel, Member } from '../../../../shared/protocol';
import { acceptFriend, addFriend } from '../people/person';
import { Avatar } from '../ui/Avatar';
import { Tooltip } from '../ui/overlay';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { useFriends } from '@/stores/friends';
import { openProfile, openUserMenu } from '@/stores/ui';

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
    <div
      role="button"
      onClick={(e) => openProfile(e, m.id)}
      onContextMenu={(e) => openUserMenu(e, m.id, { kind: 'member' })}
      className="group/member flex cursor-pointer items-center gap-2.5 rounded-[9px] px-2 py-1.5 transition-colors hover:bg-fill-1"
      style={{ opacity: online ? 1 : 0.45 }}
    >
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
      <FriendAction m={m} />
    </div>
  );
}

/** Discord-style: hover anyone in a channel to add them as a friend. */
function FriendAction({ m }: { m: Member }) {
  const meId = useAuth((s) => s.me?.id);
  const status = useFriends((s) => s.friends.find((f) => f.user.id === m.id)?.status);
  if (m.id === meId || status === 'accepted') return null;
  if (status === 'outgoing') return <span className="text-[10.5px] text-fg-3">Requested</span>;
  return (
    <Tooltip label={status === 'incoming' ? 'Accept friend request' : 'Add friend'}>
      <button
        aria-label="Add friend"
        onClick={(e) => {
          e.stopPropagation();
          void (status === 'incoming' ? acceptFriend(m) : addFriend(m));
        }}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-fg-3 opacity-0 transition hover:bg-fill-2 hover:text-success group-hover/member:opacity-100"
      >
        <UserPlus size={15} />
      </button>
    </Tooltip>
  );
}
