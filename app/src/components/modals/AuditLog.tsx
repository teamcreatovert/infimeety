import { useEffect, useState } from 'react';
import type { AuditEntry, PublicUser } from '../../../../shared/protocol';
import { Avatar } from '../ui/Avatar';
import { Button, Group } from '../ui/primitives';
import { api } from '@/lib/api';
import { useChannels } from '@/stores/channels';

/** One entry as a sentence ("Sam made Ana a moderator"), from what the server recorded. */
function describe(e: AuditEntry, name: (id: string | null) => string, room: (id: string | null) => string) {
  const d = e.detail as Record<string, string | number | boolean | undefined>;
  switch (e.action) {
    case 'channel.update':
      return 'changed the channel’s name or look';
    case 'channel.icon':
      return 'changed the channel’s picture';
    case 'invite.reset':
      return 'reset the invite code';
    case 'member.role':
      return `made ${name(e.target)} ${d.to === 'member' ? 'a member' : `a${d.to === 'admin' ? 'n' : ''} ${d.to}`}`;
    case 'member.remove':
      return `removed ${name(e.target)}`;
    case 'room.create':
      return `created ${room(e.target)}`;
    case 'room.update':
      return `changed ${room(e.target)}`;
    case 'room.delete':
      return `deleted the room ${d.name ?? ''}`.trim();
    case 'category.create':
      return `created the category ${d.name ?? ''}`.trim();
    case 'category.rename':
      return `renamed a category to ${d.name ?? ''}`.trim();
    case 'category.delete':
      return 'deleted a category';
    case 'automod.update':
      return 'changed the AutoMod rules';
    case 'automod.block':
      return `AutoMod blocked a message from ${name(e.target)}`;
    case 'message.delete':
      return `deleted a message by ${name(e.target)}`;
    case 'voice.mute':
      return `${d.muted ? 'muted' : 'unmuted'} ${name(e.target)} in voice`;
    case 'voice.roomMute':
      return `${d.muted ? 'muted' : 'unmuted'} everyone in ${room(e.target)}`;
    case 'voice.disconnect':
      return `disconnected ${name(e.target)} from voice`;
    case 'voice.move':
      return `moved ${name(e.target)} to ${room(typeof d.room === 'string' ? d.room : null)}`;
    default:
      return e.action;
  }
}

/**
 * Channel settings → Audit log (admins): who changed what, newest first. The server keeps
 * 90 days of entries.
 */
export function AuditLog({ channelId }: { channelId: string }) {
  const rooms = useChannels((s) => s.channels.find((c) => c.id === channelId)?.rooms ?? []);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [users, setUsers] = useState<Record<string, PublicUser>>({});
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = async (before?: number) => {
    setLoading(true);
    try {
      const page = await api<{ entries: AuditEntry[]; users: PublicUser[] }>(`/channels/${channelId}/audit${before ? `?before=${before}` : ''}`);
      setUsers((u) => ({ ...u, ...Object.fromEntries(page.users.map((p) => [p.id, p])) }));
      setEntries((e) => [...(before ? (e ?? []) : []), ...page.entries]);
      setMore(page.entries.length === 50);
    } catch {
      setEntries((e) => e ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = (id: string | null) => (id ? (users[id]?.name ?? 'someone') : 'someone');
  const room = (id: string | null) => {
    const r = rooms.find((x) => x.id === id);
    return r ? `${r.kind === 'text' ? '#' : ''}${r.name}` : 'a room';
  };

  return (
    <Group title="Audit log" footer="What admins and moderators changed, newest first. Kept for 90 days.">
      {entries === null ? (
        <div className="px-4 py-3 text-[13px] text-fg-3">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="px-4 py-3 text-[13px] text-fg-3">Nothing yet. Changes to rooms, roles and members will show here.</div>
      ) : (
        <div className="max-h-[320px] overflow-y-auto">
          {entries.map((e) => {
            const actor = e.actorId ? users[e.actorId] : undefined;
            return (
              <div key={e.id} className="hairline-b flex items-center gap-3 px-4 py-2.5 last:border-0">
                {actor ? <Avatar user={actor} size={26} /> : <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-fill-2 text-[12px]">🛡️</span>}
                <div className="min-w-0 flex-1 text-[13px] leading-snug">
                  <span className="font-semibold">{actor?.name ?? (e.action.startsWith('automod') ? 'AutoMod' : 'Someone')}</span> {describe(e, name, room)}
                </div>
                <time className="shrink-0 text-[11.5px] text-fg-3" dateTime={new Date(e.createdAt).toISOString()}>
                  {new Date(e.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </time>
              </div>
            );
          })}
          {more && (
            <div className="p-2 text-center">
              <Button size="sm" variant="ghost" loading={loading} onClick={() => void load(entries[entries.length - 1]?.createdAt)}>
                Load older
              </Button>
            </div>
          )}
        </div>
      )}
    </Group>
  );
}
