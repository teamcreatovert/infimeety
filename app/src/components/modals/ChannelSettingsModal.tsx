import { motion } from 'motion/react';
import { Camera, Copy, Crown, ImageMinus, ImageUp, RefreshCw, Shield, ShieldCheck, Smile, Trash2, UserMinus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { outranks, type Member, type Role } from '../../../../shared/protocol';
import { prepareAvatar } from '../auth/AvatarEditor';
import { EmojiPicker } from '../chat/EmojiPicker';
import { AutoModSettings } from './AutoModSettings';
import { Avatar } from '../ui/Avatar';
import { MenuItem, Modal, Popover, type Anchor } from '../ui/overlay';
import { Button, Group, Row, Select, Spinner, TextField } from '../ui/primitives';
import { api } from '@/lib/api';
import { CHANNEL_COLORS, channelGradient } from '@/lib/format';
import { spring } from '@/lib/motion';
import { voice } from '@/lib/voice/engine';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { toast, useUI } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

const NO_MEMBERS: Member[] = [];

export function ChannelSettingsModal() {
  const id = useUI((s) => s.channelSettings);
  const channel = useChannels((s) => s.channels.find((c) => c.id === id));
  const members = useChannels((s) => (id ? (s.members[id] ?? NO_MEMBERS) : NO_MEMBERS));
  const me = useAuth((s) => s.me);
  const close = () => useUI.getState().set({ channelSettings: null });
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [color, setColor] = useState('blue');
  const [picker, setPicker] = useState<Anchor | null>(null);
  const [tileMenu, setTileMenu] = useState<Anchor | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (channel) {
      setName(channel.name);
      setEmoji(channel.emoji);
      setColor(channel.color);
    }
  }, [channel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!channel) return <Modal open={false} onClose={close}>{null}</Modal>;
  const isOwner = channel.role === 'owner';
  const dirty = name.trim() !== channel.name || emoji !== channel.emoji || color !== channel.color;

  const save = async () => {
    await useChannels.getState().update(channel.id, { name: name.trim(), emoji, color });
    toast({ kind: 'success', title: 'Channel updated' });
  };

  const setPicture = async (file: File | null) => {
    setUploading(true);
    try {
      await useChannels.getState().setIcon(channel.id, file ? await prepareAvatar(file) : null);
      toast({ kind: 'success', title: file ? 'Channel picture updated' : 'Picture removed' });
    } catch (err) {
      toast({ kind: 'error', title: 'Couldn’t change the picture', body: err instanceof Error ? err.message : undefined });
    } finally {
      setUploading(false);
    }
  };

  const resetInvite = async () => {
    const { inviteCode } = await api<{ inviteCode: string }>(`/channels/${channel.id}/invite/reset`, { method: 'POST' });
    useChannels.setState((s) => ({ channels: s.channels.map((c) => (c.id === channel.id ? { ...c, inviteCode } : c)) }));
    toast({ kind: 'success', title: 'New invite code created', body: 'The old code no longer works.' });
  };

  const setRole = async (userId: string, role: Role) => {
    await api(`/channels/${channel.id}/members/${userId}`, { method: 'PATCH', json: { role } });
    await useChannels.getState().loadMembers(channel.id);
  };

  const kick = async (m: Member) => {
    if (!confirm(`Remove ${m.name} from ${channel.name}?`)) return;
    await api(`/channels/${channel.id}/members/${m.id}`, { method: 'DELETE' });
    await useChannels.getState().loadMembers(channel.id);
  };

  const remove = async () => {
    if (!confirm(`Delete ${channel.name} for everyone? All rooms and messages will be gone.`)) return;
    await api(`/channels/${channel.id}`, { method: 'DELETE' });
    if (useVoice.getState().channelId === channel.id) voice.leave({ silent: true });
    useChannels.getState().removeLocal(channel.id);
    close();
  };

  const rank = { owner: 0, admin: 1, moderator: 2, member: 3 };

  return (
    <Modal open={!!id} onClose={close} width={600}>
      <div className="relative max-h-[640px] overflow-y-auto px-7 pb-6 pt-6">
        <button aria-label="Close" onClick={close} className="absolute right-4 top-4 grid h-7 w-7 place-items-center rounded-full bg-fill-2 text-fg-2 hover:bg-fill-3">
          <X size={14} />
        </button>
        <h2 className="mb-5 font-display text-[20px] font-bold tracking-[-0.02em]">Channel settings</h2>

        <Group title="Overview">
          <div className="flex items-center gap-4 p-3.5">
            <motion.button
              aria-label="Change the channel’s picture or emoji"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={(e) => setTileMenu(e.currentTarget.getBoundingClientRect())}
              className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-[20px] text-[32px]"
              style={{ background: channelGradient(color) }}
            >
              {channel.iconUrl ? (
                <img src={channel.iconUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="emoji grid h-full w-full place-items-center">{emoji}</span>
              )}
              <span className="absolute inset-0 grid place-items-center bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
                {uploading ? <Spinner size={18} /> : <Camera size={18} />}
              </span>
            </motion.button>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void setPicture(file);
              }}
            />
            <div className="min-w-0 flex-1">
              <TextField className="h-9!" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
              <div className="mt-2.5 flex gap-2">
                {Object.keys(CHANNEL_COLORS).map((c) => (
                  <button key={c} aria-label={c} onClick={() => setColor(c)} className="relative h-[18px] w-[18px] rounded-full" style={{ background: channelGradient(c) }}>
                    {color === c && <motion.span layoutId="settings-color" transition={spring} className="absolute -inset-[3px] rounded-full shadow-[0_0_0_2px_var(--fg)]" />}
                  </button>
                ))}
              </div>
            </div>
            <Button variant="primary" size="sm" disabled={!dirty || !name.trim()} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </Group>

        <Group title="Invite" footer="Anyone with this code can join. Reset it to stop old codes from working.">
          <Row label={<span className="font-mono text-[20px] tracking-[0.25em]">{channel.inviteCode}</span>}>
            <div className="flex gap-2">
              <Button size="sm" icon={<Copy size={13} />} onClick={() => void navigator.clipboard.writeText(channel.inviteCode ?? '').then(() => toast({ kind: 'success', title: 'Copied' }))}>
                Copy
              </Button>
              <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={() => void resetInvite()}>
                Reset
              </Button>
            </div>
          </Row>
        </Group>

        <Group title={`Members — ${members.length}`}>
          {[...members]
            .sort((a, b) => rank[a.role] - rank[b.role] || a.name.localeCompare(b.name))
            .map((m) => {
              const self = m.id === me?.id;
              const canKick = !self && outranks(channel.role, m.role);
              return (
                <div key={m.id} className="flex items-center gap-3 px-3.5 py-2">
                  <Avatar user={m} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[13px] font-medium">
                      {m.name}
                      {m.role === 'owner' && <Crown size={12} className="text-[#ffd60a]" />}
                      {m.role === 'admin' && <ShieldCheck size={12} className="text-accent" />}
                      {m.role === 'moderator' && <Shield size={12} className="text-success" />}
                    </div>
                    <div className="text-[11.5px] text-fg-3">@{m.username}</div>
                  </div>
                  {isOwner && !self && m.role !== 'owner' ? (
                    <Select
                      value={m.role}
                      options={[
                        { value: 'member', label: 'Member' },
                        { value: 'moderator', label: 'Moderator' },
                        { value: 'admin', label: 'Admin' },
                      ]}
                      onChange={(r) => void setRole(m.id, r)}
                    />
                  ) : (
                    <span className="text-[12px] capitalize text-fg-3">{m.role}</span>
                  )}
                  {canKick && (
                    <button aria-label={`Remove ${m.name}`} onClick={() => void kick(m)} className="grid h-7 w-7 place-items-center rounded-[8px] text-fg-3 hover:bg-danger hover:text-white">
                      <UserMinus size={14} />
                    </button>
                  )}
                </div>
              );
            })}
        </Group>

        {(channel.role === 'owner' || channel.role === 'admin') && <AutoModSettings channelId={channel.id} />}

        {isOwner && (
          <Group title="Danger zone">
            <Row label="Delete this channel" detail="Removes every room and message for everyone. This can’t be undone.">
              <Button variant="danger" size="sm" icon={<Trash2 size={13} />} onClick={() => void remove()}>
                Delete
              </Button>
            </Row>
          </Group>
        )}
      </div>
      <Popover open={!!tileMenu} anchor={tileMenu} onClose={() => setTileMenu(null)} side="bottom" align="start" className="w-[220px] p-1.5">
        <MenuItem icon={<ImageUp size={15} />} onClick={() => (setTileMenu(null), fileInput.current?.click())}>
          {channel.iconUrl ? 'Change picture…' : 'Upload a picture…'}
        </MenuItem>
        {channel.iconUrl && (
          <MenuItem icon={<ImageMinus size={15} />} onClick={() => (setTileMenu(null), void setPicture(null))}>
            Remove picture (use the emoji)
          </MenuItem>
        )}
        <MenuItem icon={<Smile size={15} />} onClick={() => (setPicker(tileMenu), setTileMenu(null))}>
          Choose an emoji
        </MenuItem>
      </Popover>
      <Popover open={!!picker} anchor={picker} onClose={() => setPicker(null)} side="right" align="center">
        <EmojiPicker
          onPick={(e) => {
            setEmoji(e);
            setPicker(null);
          }}
        />
      </Popover>
    </Modal>
  );
}
