import { PhoneOff, ShieldAlert } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { MenuItem, MenuSeparator, Popover } from '../ui/overlay';
import { Slider, Switch } from '../ui/primitives';
import { getHub } from '@/lib/realtime';
import { useChannels } from '@/stores/channels';
import { useSettings } from '@/stores/settings';
import { useUI } from '@/stores/ui';

/** Right-click menu for a person in voice: personal volume/mute, plus admin moderation. */
export function ParticipantMenu() {
  const menu = useUI((s) => s.participantMenu);
  const close = () => useUI.getState().set({ participantMenu: null });
  const user = useChannels((s) => (menu ? s.users[menu.userId] : undefined));
  const channel = useChannels((s) => s.channels.find((c) => c.id === menu?.channelId));
  const participant = useChannels((s) => (menu ? s.voice[menu.channelId]?.participants.find((p) => p.peerId === menu.peerId) : undefined));
  const targetRole = useChannels((s) => (menu ? s.members[menu.channelId]?.find((m) => m.id === menu.userId)?.role : undefined));
  const volume = useSettings((s) => (menu ? (s.userVolumes[menu.userId] ?? 1) : 1));
  const streamVolume = useSettings((s) => (menu ? (s.streamVolumes[menu.userId] ?? 1) : 1));
  const localMuted = useSettings((s) => (menu ? !!s.localMutes[menu.userId] : false));

  const myRole = channel?.role;
  const canModerate = !!participant && (myRole === 'owner' || (myRole === 'admin' && targetRole === 'member'));
  const send = (msg: Parameters<NonNullable<ReturnType<typeof getHub>>['send']>[0]) => menu && getHub(menu.channelId)?.send(msg);

  return (
    <Popover open={!!menu} anchor={menu ? { x: menu.x, y: menu.y } : null} onClose={close} side="right" className="w-[264px] p-1.5">
      {menu && (
        <>
          <div className="flex items-center gap-2.5 px-2 pb-2 pt-1.5">
            <Avatar user={user} size={36} />
            <div className="min-w-0">
              <div className="truncate text-[13.5px] font-semibold">{user?.name ?? 'Someone'}</div>
              <div className="truncate text-[11.5px] text-fg-3">@{user?.username}</div>
            </div>
          </div>
          <VolumeRow label="User volume" value={volume} onChange={(v) => useSettings.getState().setUserVolume(menu.userId, v)} />
          {participant?.screen && <VolumeRow label="Stream volume" value={streamVolume} onChange={(v) => useSettings.getState().setStreamVolume(menu.userId, v)} />}
          <div className="flex h-9 items-center justify-between px-2.5 text-[13px]">
            <span>Mute for me</span>
            <Switch checked={localMuted} onChange={() => useSettings.getState().toggleLocalMute(menu.userId)} />
          </div>
          {canModerate && (
            <>
              <MenuSeparator />
              <div className="flex h-9 items-center justify-between px-2.5 text-[13px]">
                <span className="flex items-center gap-2">
                  <ShieldAlert size={14} className="text-danger" /> Server mute
                </span>
                <Switch checked={participant.serverMuted} onChange={(v) => send({ t: 'voice.serverMute', peerId: menu.peerId, muted: v })} />
              </div>
              <MenuItem
                danger
                icon={<PhoneOff size={14} />}
                onClick={() => {
                  send({ t: 'voice.disconnect', peerId: menu.peerId });
                  close();
                }}
              >
                Disconnect from voice
              </MenuItem>
            </>
          )}
        </>
      )}
    </Popover>
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
