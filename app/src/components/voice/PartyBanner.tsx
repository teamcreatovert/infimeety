import { Popcorn } from 'lucide-react';
import type { Channel } from '../../../../shared/protocol';
import { Button } from '../ui/primitives';
import { useParty } from '@/lib/party';
import { confirmCallSwitch } from '@/lib/voice/callSwitch';
import { voice } from '@/lib/voice/engine';
import { useChannels } from '@/stores/channels';
import { useUI } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

/** Top of a chat: a watch party going on in this channel, with a way in. */
export function PartyBanner({ channel }: { channel: Channel }) {
  const parties = useParty((s) => s.parties);
  const snapshot = useChannels((s) => s.voice[channel.id]);
  const myRoom = useVoice((s) => (s.channelId === channel.id ? s.roomId : null));
  const live = channel.rooms.filter((r) => r.kind === 'voice' && parties[r.id]);
  if (!live.length) return null;

  const open = async (roomId: string) => {
    if (myRoom !== roomId) {
      if (!(await confirmCallSwitch(channel.id))) return;
      await voice.join(channel.id, roomId, { confirmed: true });
    }
    if (channel.kind === 'space') useChannels.getState().selectRoom(channel.id, roomId);
    else useChannels.getState().select(channel.id);
    useUI.getState().set({ partyView: true, focusedPeer: null });
  };

  return (
    <div className="flex flex-col gap-1.5 px-4 pt-2.5 compact:px-2.5">
      {live.map((room) => {
        const party = parties[room.id];
        const people = new Set((snapshot?.participants ?? []).filter((p) => p.roomId === room.id).map((p) => p.userId));
        const ready = party.ready.filter((u) => people.has(u)).length;
        const here = myRoom === room.id;
        return (
          <div key={room.id} className="flex items-center gap-3 rounded-[14px] bg-accent/12 px-3 py-2 shadow-[inset_0_0_0_0.5px_var(--hairline-strong)]">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-accent text-white">
              <Popcorn size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">{party.file.name}</div>
              <div className="truncate text-[11.5px] text-fg-2">
                Watch party{channel.kind === 'space' ? ` in ${room.name}` : ''} ·{' '}
                {party.phase === 'lobby' ? `getting ready, ${ready}/${people.size} ready` : `on now, ${people.size} watching`}
              </div>
            </div>
            <Button size="sm" variant="primary" onClick={() => void open(room.id)}>
              {here ? 'Open' : 'Join'}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
