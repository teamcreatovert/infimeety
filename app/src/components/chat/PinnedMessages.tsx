import { Pin, PinOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { canModerateRole, type Channel, type Message, type Room } from '../../../../shared/protocol';
import { Avatar } from '../ui/Avatar';
import { Popover, type Anchor } from '../ui/overlay';
import { IconButton, Spinner } from '../ui/primitives';
import { api } from '@/lib/api';
import { formatFull } from '@/lib/format';
import { getHub } from '@/lib/realtime';
import { useChannels } from '@/stores/channels';
import { useMessages } from '@/stores/messages';

/** The pin in a room's header: its pinned messages, newest first, with Jump (and Unpin for moderators). */
export function PinnedMessages({ channel, room }: { channel: Channel; room: Room }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [pins, setPins] = useState<Message[] | null>(null);
  const users = useChannels((s) => s.users);
  const mod = canModerateRole(channel.role);
  // Pins changed in this room while the list is open: load it again.
  const version = useMessages((s) => s.rooms[room.id]?.items.filter((m) => m.pinnedAt).map((m) => `${m.id}:${m.pinnedAt}`).join());

  useEffect(() => {
    if (!anchor) return;
    let live = true;
    void api<Message[]>(`/channels/${channel.id}/rooms/${room.id}/pins`)
      .then((list) => live && setPins(list))
      .catch(() => live && setPins([]));
    return () => void (live = false);
  }, [anchor, channel.id, room.id, version]);

  const jump = (id: string) => {
    setAnchor(null);
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.animate([{ background: 'color-mix(in srgb, var(--accent) 22%, transparent)' }, { background: 'transparent' }], { duration: 1400, easing: 'ease-out' });
  };

  return (
    <>
      <IconButton label="Pinned messages" active={!!anchor} onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())} tooltipSide="bottom">
        <Pin size={17} />
      </IconButton>
      <Popover open={!!anchor} anchor={anchor} onClose={() => setAnchor(null)} side="bottom" align="end" className="w-[380px] max-w-[calc(100vw-24px)] p-2">
        <div className="px-2 pb-2 pt-1 text-[13.5px] font-semibold">Pinned messages</div>
        <div className="max-h-[min(420px,60vh)] overflow-y-auto">
          {!pins ? (
            <div className="grid h-20 place-items-center text-fg-3">
              <Spinner />
            </div>
          ) : !pins.length ? (
            <p className="px-2 pb-3 pt-1 text-[12.5px] leading-relaxed text-fg-3">
              Nothing pinned in #{room.name} yet. {mod ? 'Hover a message and press the pin to keep it here.' : 'Moderators and admins can pin important messages.'}
            </p>
          ) : (
            pins.map((m) => (
              <div key={m.id} className="group/pin mb-1 rounded-[12px] bg-fill-1 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Avatar user={users[m.userId]} size={20} />
                  <span className="truncate text-[12.5px] font-semibold">{users[m.userId]?.name ?? 'Someone'}</span>
                  <span className="truncate text-[11px] text-fg-3">{formatFull(m.createdAt)}</span>
                  <span className="flex-1" />
                  <button onClick={() => jump(m.id)} className="rounded-full px-2 py-0.5 text-[11.5px] font-medium text-accent hover:bg-fill-2">
                    Jump
                  </button>
                  {mod && (
                    <button aria-label="Unpin" title="Unpin" onClick={() => getHub(channel.id)?.send({ t: 'chat.pin', id: m.id, pinned: false })} className="grid h-6 w-6 place-items-center rounded-full text-fg-3 hover:bg-fill-2 hover:text-danger">
                      <PinOff size={13} />
                    </button>
                  )}
                </div>
                <div className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-[13px] text-fg-2">{m.content || (m.attachments.length ? `${m.attachments.length} attachment${m.attachments.length === 1 ? '' : 's'}` : '')}</div>
              </div>
            ))
          )}
        </div>
      </Popover>
    </>
  );
}
