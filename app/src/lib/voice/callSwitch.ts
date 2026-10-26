import { confirmDialog } from '@/lib/confirm';
import { useChannels } from '@/stores/channels';
import { useVoice } from '@/stores/voice';

/** A call, in words: "Lounge in Movie Night", "the call with Sam", a meeting's name. */
function describe(channelId: string, roomId?: string | null) {
  const channel = useChannels.getState().channels.find((c) => c.id === channelId);
  if (!channel) return 'another call';
  if (channel.kind === 'dm') return `the call with ${channel.peer?.name ?? 'your friend'}`;
  if (channel.kind === 'meeting') return channel.name;
  const room = roomId ? channel.rooms.find((r) => r.id === roomId) : null;
  return room ? `${room.name} in ${channel.name}` : channel.name;
}

/**
 * Leaving your call for one somewhere else (another server, a meeting, a DM call) asks first,
 * so a stray click doesn't hang up on everyone. Moving between voice rooms in the same server
 * doesn't ask, and neither does joining when you're not in a call. `action` says what's about
 * to happen when there's no channel yet ("Starting a new meeting"); `toRoomId` names the room.
 */
export async function confirmCallSwitch(toChannelId: string | null, action?: string, toRoomId?: string): Promise<boolean> {
  const { channelId, roomId } = useVoice.getState();
  if (!channelId || !roomId || channelId === toChannelId) return true;
  const doing = action ?? (toChannelId ? `Joining ${describe(toChannelId, toRoomId)}` : 'Joining another call');
  return confirmDialog({
    title: 'Leave your call?',
    body: `You’re in ${describe(channelId, roomId)}. ${doing} hangs up that call.`,
    confirm: 'Switch',
    cancel: 'Stay',
  });
}
