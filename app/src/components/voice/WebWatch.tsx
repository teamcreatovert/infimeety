import clsx from 'clsx';
import { MonitorPlay, X } from 'lucide-react';
import type { Channel, WebStatus } from '../../../../shared/protocol';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/primitives';
import { endWeb, siteName, useWeb } from '@/lib/watchWeb';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { useVoice } from '@/stores/voice';

function useRoomPeople(roomId: string) {
  const channelId = useVoice((s) => s.channelId);
  const participants = useChannels((s) => (channelId ? s.voice[channelId]?.participants : undefined));
  return [...new Set((participants ?? []).filter((p) => p.roomId === roomId).sort((a, b) => a.joinedAt - b.joinedAt).map((p) => p.userId))];
}

const STATUS: Record<WebStatus['state'], string> = { opening: 'Opening it…', signin: 'Signing in', ready: 'Ready', ad: 'Watching an ad', away: 'Not watching' };

/** A website the room is watching together, in the lobby: what it is, and where everyone stands. */
export function WebCard({ channel, roomId }: { channel: Channel; roomId: string }) {
  const web = useWeb((s) => s.webs[roomId]);
  const statuses = useWeb((s) => s.statuses[roomId]);
  const people = useRoomPeople(roomId);
  const users = useChannels((s) => s.users);
  const me = useAuth((s) => s.me?.id);
  if (!web) return null;
  const host = users[web.hostId];
  const canEnd = web.hostId === me || channel.role !== 'member';
  return (
    <div className="scroll h-full p-3">
      <div className="flex items-center gap-3 rounded-[14px] bg-fill-1 p-3 shadow-[inset_0_0_0_0.5px_var(--hairline)]">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[13px] bg-accent text-white">
          <MonitorPlay size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold">{web.title}</div>
          <div className="mt-0.5 truncate text-[11.5px] text-fg-3">
            {siteName(web.url)} · {web.hostId === me ? 'You lead' : `${host?.name ?? 'Someone'} leads`}
          </div>
        </div>
      </div>

      <h4 className="mb-1.5 mt-4 px-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-fg-3">{people.length} in the room</h4>
      <div className="rounded-[14px] bg-fill-1 p-1.5 shadow-[inset_0_0_0_0.5px_var(--hairline)]">
        {people.map((id) => {
          const state = statuses?.[id]?.state ?? 'away';
          return (
            <div key={id} className="flex items-center gap-2.5 rounded-[10px] px-1.5 py-1.5">
              <Avatar user={users[id]} size={26} />
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {users[id]?.name ?? 'Someone'}
                {id === me && <span className="text-fg-3"> (you)</span>}
              </span>
              <span className={clsx('shrink-0 text-[11.5px]', state === 'ready' ? 'text-success' : state === 'ad' ? 'text-warning' : 'text-fg-3')}>{STATUS[state]}</span>
            </div>
          );
        })}
      </div>

      {canEnd && (
        <Button size="sm" variant="soft-danger" className="mt-4 w-full" icon={<X size={13} />} onClick={() => endWeb(roomId)}>
          Stop watching together
        </Button>
      )}
    </div>
  );
}
