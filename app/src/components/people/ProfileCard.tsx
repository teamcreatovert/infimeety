import { Check, MessageCircle, Pencil, Phone, UserCheck, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { callFriend, messageFriend } from '../home/FriendsPage';
import { Avatar } from '../ui/Avatar';
import { Popover } from '../ui/overlay';
import { Button } from '../ui/primitives';
import { acceptFriend, addFriend, useFriendStatus, useIsOnline, usePerson } from './person';
import { gradientFor } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import { useSettings } from '@/stores/settings';
import { useUI } from '@/stores/ui';

/** A person's card: who they are, your private note about them, and quick actions. */
export function ProfileCard() {
  const card = useUI((s) => s.profileCard);
  const close = () => useUI.getState().set({ profileCard: null });
  return (
    <Popover open={!!card} anchor={card ? { x: card.x, y: card.y } : null} onClose={close} side="right" className="w-[300px] overflow-hidden">
      {card && <Card key={card.userId} userId={card.userId} focusNote={!!card.focusNote} close={close} />}
    </Popover>
  );
}

function Card({ userId, focusNote, close }: { userId: string; focusNote: boolean; close: () => void }) {
  const user = usePerson(userId);
  const self = useAuth((s) => s.me?.id === userId);
  const online = useIsOnline(userId) || self;
  const status = useFriendStatus(userId);
  const [note, setNote] = useState(() => useSettings.getState().notes[userId] ?? '');

  const act = (fn: () => unknown) => () => {
    close();
    void fn();
  };

  return (
    <>
      <div className="h-[84px]" style={{ background: gradientFor(userId) }}>
        <div className="h-full w-full bg-gradient-to-b from-white/10 to-black/20" />
      </div>
      <div className="px-4 pb-4">
        <div className="-mt-[42px] w-fit rounded-full" style={{ boxShadow: '0 0 0 4px var(--ring-bg)' }}>
          <Avatar user={user} size={80} presence={online ? 'online' : 'offline'} />
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <span className="truncate font-display text-[19px] font-bold tracking-[-0.02em]">{user?.name ?? 'Someone'}</span>
          {status === 'accepted' && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-fill-2 px-2 py-0.5 text-[11px] font-medium text-fg-2">
              <Check size={11} /> Friend
            </span>
          )}
        </div>
        {user?.guest ? (
          <div className="text-[13px] text-fg-2">Guest in a meeting</div>
        ) : (
          user?.username && <div className="selectable text-[13px] text-fg-2">@{user.username}</div>
        )}
        <div className="mt-1 text-[12px] text-fg-3">{self ? 'This is you' : online ? 'Online' : 'Offline'}</div>

        {!self && (
          <div className="mt-3.5 rounded-[12px] bg-fill-1 px-3 pb-2 pt-2.5">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-fg-3">Note</div>
            <textarea
              autoFocus={focusNote}
              value={note}
              maxLength={300}
              rows={2}
              placeholder="Only you can see this"
              onChange={(e) => {
                setNote(e.target.value);
                useSettings.getState().setNote(userId, e.target.value);
              }}
              className="mt-0.5 w-full resize-none bg-transparent text-[12.5px] leading-snug outline-none placeholder:text-fg-3"
            />
          </div>
        )}

        <div className="mt-3.5 flex gap-2">
          {self ? (
            <Button size="sm" icon={<Pencil size={13} />} onClick={act(() => useUI.getState().set({ settingsTab: 'account' }))}>
              Edit profile
            </Button>
          ) : (
            <>
              {!user?.guest && (
                <Button variant="primary" size="sm" icon={<MessageCircle size={13} />} onClick={act(() => messageFriend(userId))}>
                  Message
                </Button>
              )}
              {status === 'accepted' && (
                <Button size="sm" icon={<Phone size={13} />} onClick={act(() => callFriend(userId))}>
                  Call
                </Button>
              )}
              {!status && user?.username && (
                <Button size="sm" icon={<UserPlus size={13} />} onClick={act(() => addFriend(user))}>
                  Add friend
                </Button>
              )}
              {status === 'incoming' && user && (
                <Button size="sm" icon={<UserCheck size={13} />} onClick={act(() => acceptFriend(user))}>
                  Accept
                </Button>
              )}
              {status === 'outgoing' && (
                <Button size="sm" disabled>
                  Request sent
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
