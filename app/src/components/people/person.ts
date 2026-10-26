import type { PublicUser } from '../../../../shared/protocol';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { useFriends } from '@/stores/friends';
import { toast } from '@/stores/ui';

/** Anyone we know about: channel members, friends, or the other side of a DM. */
export function usePerson(userId: string | undefined): PublicUser | undefined {
  const member = useChannels((s) => (userId ? s.users[userId] : undefined));
  const friend = useFriends((s) => (userId ? s.friends.find((f) => f.user.id === userId)?.user : undefined));
  const peer = useChannels((s) => (userId ? s.channels.find((c) => c.peer?.id === userId)?.peer : undefined));
  const me = useAuth((s) => (s.me?.id === userId ? s.me : undefined));
  return member ?? friend ?? peer ?? me ?? undefined;
}

export function useFriendStatus(userId: string) {
  return useFriends((s) => s.friends.find((f) => f.user.id === userId)?.status);
}

/** Online if a friend's presence says so, or they're connected to any shared channel. */
export function useIsOnline(userId: string) {
  const friend = useFriends((s) => !!s.online[userId]);
  const member = useChannels((s) => Object.values(s.online).some((ids) => ids.includes(userId)));
  return friend || member;
}

export async function addFriend(user: PublicUser) {
  try {
    const f = await useFriends.getState().add(user.username ?? '');
    toast({ kind: 'success', title: f.status === 'accepted' ? `You and ${user.name} are now friends` : `Friend request sent to ${user.name}` });
  } catch {
    toast({ kind: 'error', title: "Couldn't send the friend request" });
  }
}

export async function acceptFriend(user: PublicUser) {
  try {
    await useFriends.getState().accept(user.id);
    toast({ kind: 'success', title: `You and ${user.name} are now friends` });
  } catch {
    toast({ kind: 'error', title: "Couldn't accept the request" });
  }
}

export async function removeFriend(user: PublicUser, confirmFirst = true) {
  if (confirmFirst && !confirm(`Remove ${user.name} from your friends?`)) return;
  try {
    await useFriends.getState().remove(user.id);
  } catch {
    toast({ kind: 'error', title: "Couldn't update friends" });
  }
}
