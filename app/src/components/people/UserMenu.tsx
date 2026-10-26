import {
  AtSign,
  Bell,
  BellOff,
  CheckCheck,
  HeadphoneOff,
  MessageCircle,
  MicOff,
  MoveRight,
  Phone,
  PhoneOff,
  Pin,
  PinOff,
  Send,
  Settings,
  ShieldAlert,
  StickyNote,
  UserCheck,
  UserMinus,
  UserPlus,
  UserRound,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { PublicUser } from '../../../../shared/protocol';
import { callFriend, messageFriend } from '../home/FriendsPage';
import { Avatar } from '../ui/Avatar';
import { MenuItem, MenuSeparator, Popover, SubMenu } from '../ui/overlay';
import { Slider, Switch } from '../ui/primitives';
import { acceptFriend, addFriend, removeFriend, useFriendStatus, usePerson } from './person';
import { inviteUrl } from '@/lib/invite';
import { getHub, moveVoice, sendChat } from '@/lib/realtime';
import { voice } from '@/lib/voice/engine';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { useMessages } from '@/stores/messages';
import { useSettings } from '@/stores/settings';
import { toast, useUI, type UserMenuContext } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

type Close = () => void;

/** Right-click menu for a person. What it offers depends on where they were clicked. */
export function UserMenu() {
  const menu = useUI((s) => s.userMenu);
  const close = () => useUI.getState().set({ userMenu: null });
  return (
    <Popover open={!!menu} anchor={menu ? { x: menu.x, y: menu.y } : null} onClose={close} side="right" className="w-[256px] p-1.5">
      {menu && <MenuBody userId={menu.userId} context={menu.context} at={{ x: menu.x, y: menu.y }} close={close} />}
    </Popover>
  );
}

function MenuBody({ userId, context, at, close }: { userId: string; context: UserMenuContext; at: { x: number; y: number }; close: Close }) {
  const user = usePerson(userId);
  const self = useAuth((s) => s.me?.id === userId);
  const hasNote = useSettings((s) => !!s.notes[userId]);

  const profile = (focusNote = false) => useUI.getState().set({ userMenu: null, profileCard: { userId, ...at, focusNote } });
  const mention = () => {
    close();
    if (context.kind === 'voice') useUI.getState().set({ voiceChat: true });
    useUI.getState().set({ composerInsert: { text: `@${user?.username}`, at: Date.now() } });
  };

  const people = (
    <>
      <MenuItem icon={<UserRound size={14} />} onClick={() => profile()}>
        Profile
      </MenuItem>
      {!self && context.kind !== 'dm' && (
        <MenuItem icon={<MessageCircle size={14} />} onClick={() => (close(), void messageFriend(userId))}>
          Message
        </MenuItem>
      )}
      {!self && context.kind !== 'dm' && user?.username && (
        <MenuItem icon={<AtSign size={14} />} onClick={mention}>
          Mention
        </MenuItem>
      )}
      {!self && (
        <MenuItem icon={<StickyNote size={14} />} onClick={() => profile(true)}>
          {hasNote ? 'Edit note' : 'Add note'}
        </MenuItem>
      )}
    </>
  );

  return (
    <>
      <Header user={user} />
      {context.kind === 'voice' && self && (
        <>
          <SelfVoice channelId={context.channelId} close={close} />
          <MenuSeparator />
          {people}
        </>
      )}
      {context.kind === 'voice' && !self && (
        <>
          <PeerVoice channelId={context.channelId} peerId={context.peerId} userId={userId} />
          <MenuSeparator />
          {people}
          {user && <FriendItems user={user} close={close} />}
          <Moderation channelId={context.channelId} peerId={context.peerId} userId={userId} close={close} />
        </>
      )}
      {context.kind === 'dm' && (
        <>
          {people}
          <DmItems channelId={context.channelId} userId={userId} close={close} />
          {user && <FriendItems user={user} close={close} />}
        </>
      )}
      {context.kind === 'member' && (
        <>
          {people}
          {!self && user && <FriendItems user={user} close={close} />}
        </>
      )}
    </>
  );
}

function Header({ user }: { user?: PublicUser }) {
  return (
    <div className="flex items-center gap-2.5 px-2 pb-2 pt-1.5">
      <Avatar user={user} size={36} />
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-semibold">{user?.name ?? 'Someone'}</div>
        {user?.username && <div className="truncate text-[11.5px] text-fg-3">@{user.username}</div>}
      </div>
    </div>
  );
}

function Toggle({ icon, label, checked, onChange, disabled }: { icon: ReactNode; label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex h-8 items-center gap-2.5 rounded-[8px] px-2.5 text-[13px]" style={{ opacity: disabled ? 0.45 : 1 }}>
      <span className="grid w-4 shrink-0 place-items-center opacity-80">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      <Switch checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

function VolumeRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="px-2.5 pb-1.5 pt-1">
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-fg-2">{label}</span>
        <span className="tabular-nums text-fg-3">{Math.round(value * 100)}%</span>
      </div>
      <Slider value={value} min={0} max={2} step={0.01} onChange={onChange} />
    </div>
  );
}

/** Other voice rooms in the channel, for moving yourself or (admins) someone else. */
function MoveTo({ channelId, fromRoomId, onPick }: { channelId: string; fromRoomId: string | null | undefined; onPick: (roomId: string) => void }) {
  const channel = useChannels((s) => s.channels.find((c) => c.id === channelId));
  const rooms = channel?.kind === 'space' ? channel.rooms.filter((r) => r.kind === 'voice' && r.id !== fromRoomId) : [];
  if (rooms.length === 0) return null;
  return (
    <SubMenu icon={<MoveRight size={14} />} label="Move to">
      {rooms.map((r) => (
        <MenuItem key={r.id} onClick={() => onPick(r.id)}>
          {r.name}
        </MenuItem>
      ))}
    </SubMenu>
  );
}

function SelfVoice({ channelId, close }: { channelId: string; close: Close }) {
  const muted = useVoice((s) => s.muted);
  const deafened = useVoice((s) => s.deafened);
  const serverMuted = useVoice((s) => s.serverMuted);
  const inThisCall = useVoice((s) => s.channelId === channelId);
  const roomId = useVoice((s) => s.roomId);
  if (!inThisCall) return null;
  return (
    <>
      <Toggle icon={<MicOff size={14} />} label={serverMuted ? 'Muted by an admin' : 'Mute'} checked={muted || serverMuted} disabled={serverMuted} onChange={() => void voice.toggleMute()} />
      <Toggle icon={<HeadphoneOff size={14} />} label="Deafen" checked={deafened} onChange={() => voice.toggleDeafen()} />
      <MoveTo channelId={channelId} fromRoomId={roomId} onPick={(id) => (close(), void moveVoice(channelId, id))} />
      <MenuItem icon={<Settings size={14} />} onClick={() => (close(), useUI.getState().set({ settingsTab: 'voice' }))}>
        Voice settings
      </MenuItem>
    </>
  );
}

function PeerVoice({ channelId, peerId, userId }: { channelId: string; peerId: string; userId: string }) {
  const sharing = useChannels((s) => !!s.voice[channelId]?.participants.find((p) => p.peerId === peerId)?.screen);
  const volume = useSettings((s) => s.userVolumes[userId] ?? 1);
  const streamVolume = useSettings((s) => s.streamVolumes[userId] ?? 1);
  const localMuted = useSettings((s) => !!s.localMutes[userId]);
  const settings = useSettings.getState();
  return (
    <>
      <VolumeRow label="Volume for me" value={volume} onChange={(v) => settings.setUserVolume(userId, v)} />
      {sharing && <VolumeRow label="Screen share volume" value={streamVolume} onChange={(v) => settings.setStreamVolume(userId, v)} />}
      <Toggle icon={<MicOff size={14} />} label="Mute for me" checked={localMuted} onChange={() => settings.toggleLocalMute(userId)} />
    </>
  );
}

function Moderation({ channelId, peerId, userId, close }: { channelId: string; peerId: string; userId: string; close: Close }) {
  const myRole = useChannels((s) => s.channels.find((c) => c.id === channelId)?.role);
  const targetRole = useChannels((s) => s.members[channelId]?.find((m) => m.id === userId)?.role);
  const participant = useChannels((s) => s.voice[channelId]?.participants.find((p) => p.peerId === peerId));
  // Mirrors the hub's rule: owners moderate anyone but themselves, admins moderate members.
  const canModerate = !!participant && (myRole === 'owner' || (myRole === 'admin' && targetRole === 'member'));
  if (!canModerate) return null;
  const send = (msg: Parameters<NonNullable<ReturnType<typeof getHub>>['send']>[0]) => getHub(channelId)?.send(msg);
  return (
    <>
      <MenuSeparator />
      <Toggle icon={<ShieldAlert size={14} className="text-danger" />} label="Server mute" checked={participant.serverMuted} onChange={(v) => send({ t: 'voice.serverMute', peerId, muted: v })} />
      <MoveTo channelId={channelId} fromRoomId={participant.roomId} onPick={(roomId) => (close(), send({ t: 'voice.move', peerId, roomId }))} />
      <MenuItem danger icon={<PhoneOff size={14} />} onClick={() => (close(), send({ t: 'voice.disconnect', peerId }))}>
        Disconnect from voice
      </MenuItem>
    </>
  );
}

function DmItems({ channelId, userId, close }: { channelId: string; userId: string; close: Close }) {
  const dm = useChannels((s) => s.channels.find((c) => c.id === channelId));
  const channels = useChannels((s) => s.channels);
  const textRoom = dm?.rooms.find((r) => r.kind === 'text');
  const callRoom = dm?.rooms.find((r) => r.kind === 'voice');
  const unread = useMessages((s) => (textRoom ? (s.unread[textRoom.id] ?? 0) : 0));
  const inCall = useVoice((s) => !!callRoom && s.roomId === callRoom.id);
  const pinned = useSettings((s) => s.pinnedDms.includes(channelId));
  const muted = useSettings((s) => !!s.mutedChats[channelId]);
  const settings = useSettings.getState();
  const spaces = channels.filter((c) => c.kind === 'space' && c.inviteCode);

  const invite = (space: (typeof spaces)[number]) => {
    close();
    if (textRoom && sendChat(channelId, textRoom.id, inviteUrl(space.inviteCode!))) toast({ kind: 'success', title: `Invite to ${space.name} sent` });
    else toast({ kind: 'error', title: "Couldn't send the invite", body: 'Check your connection.' });
  };
  const closeDm = () => {
    close();
    settings.setDmClosed(channelId, true);
    if (useChannels.getState().activeChannelId === channelId) useChannels.getState().select(null);
  };

  return (
    <>
      {!inCall && (
        <MenuItem icon={<Phone size={14} />} onClick={() => (close(), void callFriend(userId))}>
          Start a call
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem icon={<CheckCheck size={14} />} disabled={!unread} onClick={() => (close(), textRoom && useMessages.getState().markRead(textRoom.id))}>
        Mark as read
      </MenuItem>
      <MenuItem icon={pinned ? <PinOff size={14} /> : <Pin size={14} />} onClick={() => (close(), settings.toggleDmPin(channelId))}>
        {pinned ? 'Unpin' : 'Pin to top'}
      </MenuItem>
      <MenuItem icon={muted ? <Bell size={14} /> : <BellOff size={14} />} onClick={() => (close(), settings.toggleChatMute(channelId))}>
        {muted ? 'Unmute notifications' : 'Mute notifications'}
      </MenuItem>
      {spaces.length > 0 && (
        <SubMenu icon={<Send size={14} />} label="Invite to channel">
          {spaces.map((c) => (
            <MenuItem key={c.id} icon={<span className="text-[13px] leading-none">{c.emoji}</span>} onClick={() => invite(c)}>
              {c.name}
            </MenuItem>
          ))}
        </SubMenu>
      )}
      <MenuItem icon={<X size={14} />} onClick={closeDm}>
        Close conversation
      </MenuItem>
    </>
  );
}

function FriendItems({ user, close }: { user: PublicUser; close: Close }) {
  const status = useFriendStatus(user.id);
  if (!status && !user.username) return null;
  return (
    <>
      <MenuSeparator />
      {!status && user.username && (
        <MenuItem icon={<UserPlus size={14} />} onClick={() => (close(), void addFriend(user))}>
          Add friend
        </MenuItem>
      )}
      {status === 'incoming' && (
        <MenuItem icon={<UserCheck size={14} />} onClick={() => (close(), void acceptFriend(user))}>
          Accept friend request
        </MenuItem>
      )}
      {status === 'outgoing' && (
        <MenuItem icon={<X size={14} />} onClick={() => (close(), void removeFriend(user, false))}>
          Cancel friend request
        </MenuItem>
      )}
      {status === 'accepted' && (
        <MenuItem danger icon={<UserMinus size={14} />} onClick={() => (close(), void removeFriend(user))}>
          Remove friend
        </MenuItem>
      )}
    </>
  );
}
