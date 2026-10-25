import clsx from 'clsx';
import { motion } from 'motion/react';
import { Check, Link2, Search, Send, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Channel, InvitePreview } from '../../../../shared/protocol';
import { Avatar } from '../ui/Avatar';
import { Modal } from '../ui/overlay';
import { Button, Spinner } from '../ui/primitives';
import { channelGradient } from '@/lib/format';
import { inviteUrl, loadInvitePreview } from '@/lib/invite';
import { getHub } from '@/lib/realtime';
import { sounds } from '@/lib/sounds';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { useFriends } from '@/stores/friends';
import { useMessages } from '@/stores/messages';
import { toast, useUI } from '@/stores/ui';

/** Sends a friend the channel's invite link in your DM with them. */
async function sendInvite(friendId: string, channel: Channel) {
  const me = useAuth.getState().me;
  if (!me || !channel.inviteCode) throw new Error('no invite');
  const dm = await useChannels.getState().ensureDm(friendId);
  const room = dm.rooms.find((r) => r.kind === 'text');
  // The DM's realtime hub connects right after it appears in the channel list.
  let hub = getHub(dm.id);
  for (let i = 0; i < 30 && !hub; i++) {
    await new Promise((r) => setTimeout(r, 100));
    hub = getHub(dm.id);
  }
  if (!hub || !room) throw new Error('not connected');
  const content = `Join me in ${channel.emoji} ${channel.name} on Infimeety: ${inviteUrl(channel.inviteCode)}`;
  const nonce = useMessages.getState().addPending(room.id, me.id, content, [], null);
  hub.send({ t: 'chat.send', roomId: room.id, content, nonce });
}

export function InviteModal() {
  const channelId = useUI((s) => s.inviteTo);
  const channel = useChannels((s) => s.channels.find((c) => c.id === channelId));
  const close = () => useUI.getState().set({ inviteTo: null });
  return (
    <Modal open={!!channel} onClose={close} width={440}>
      {channel && <InviteSheet channel={channel} onClose={close} />}
    </Modal>
  );
}

function InviteSheet({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const friends = useFriends((s) => s.friends);
  const members = useChannels((s) => s.members[channel.id]);
  const [query, setQuery] = useState('');
  const [state, setState] = useState<Record<string, 'sending' | 'sent'>>({});
  const [copied, setCopied] = useState(false);
  const link = channel.inviteCode ? inviteUrl(channel.inviteCode) : '';
  const memberIds = new Set(members?.map((m) => m.id));
  const q = query.trim().toLowerCase();
  const list = friends
    .filter((f) => f.status === 'accepted')
    .filter((f) => !q || f.user.name.toLowerCase().includes(q) || f.user.username?.toLowerCase().includes(q))
    .sort((a, b) => Number(memberIds.has(a.user.id)) - Number(memberIds.has(b.user.id)) || a.user.name.localeCompare(b.user.name));

  const invite = async (id: string) => {
    setState((s) => ({ ...s, [id]: 'sending' }));
    try {
      await sendInvite(id, channel);
      setState((s) => ({ ...s, [id]: 'sent' }));
      sounds.send();
    } catch {
      setState(({ [id]: _, ...rest }) => rest);
      toast({ kind: 'error', title: "Couldn't send the invite" });
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="relative p-6">
      <button aria-label="Close" onClick={onClose} className="absolute right-4 top-4 grid h-7 w-7 place-items-center rounded-full bg-fill-2 text-fg-2 hover:bg-fill-3">
        <X size={14} />
      </button>
      <h2 className="pr-8 font-display text-[19px] font-bold tracking-[-0.02em]">
        Invite friends to <span className="emoji">{channel.emoji}</span> {channel.name}
      </h2>

      <label className="field mt-4 flex h-9 items-center gap-2 px-3">
        <Search size={14} className="text-fg-3" />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your friends" className="h-full w-full bg-transparent text-[13px] outline-none placeholder:text-fg-3" />
      </label>

      <div className="scroll -mx-2 mt-2 max-h-[248px] px-2" style={{ scrollbarGutter: 'auto' }}>
        {list.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] text-fg-3">{friends.some((f) => f.status === 'accepted') ? 'No friends match.' : 'Add friends from Home to invite them in one tap, or share the link below.'}</p>
        ) : (
          list.map((f) => {
            const joined = memberIds.has(f.user.id);
            const s = state[f.user.id];
            return (
              <div key={f.user.id} className="flex items-center gap-3 rounded-[10px] px-2 py-1.5 hover:bg-fill-1">
                <Avatar user={f.user} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{f.user.name}</div>
                  <div className="truncate text-[11.5px] text-fg-3">@{f.user.username}</div>
                </div>
                {joined ? (
                  <span className="text-[12px] text-fg-3">Already here</span>
                ) : (
                  <Button size="sm" variant={s === 'sent' ? 'ghost' : 'secondary'} disabled={!!s} icon={s === 'sent' ? <Check size={13} /> : s === 'sending' ? <Spinner size={12} /> : <Send size={12} />} onClick={() => void invite(f.user.id)}>
                    {s === 'sent' ? 'Sent' : 'Invite'}
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="mt-5 text-[12px] font-semibold text-fg-2">Or share an invite link</div>
      <div className="field mt-1.5 flex h-10 items-center gap-2 pl-3 pr-1">
        <Link2 size={14} className="shrink-0 text-fg-3" />
        <span className="selectable min-w-0 flex-1 truncate font-mono text-[12px]">{link}</span>
        <Button size="sm" variant={copied ? 'secondary' : 'primary'} icon={copied ? <Check size={13} /> : undefined} onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="mt-2 text-[11.5px] leading-snug text-fg-3">Anyone with the link can join. New to Infimeety? The link page has a download button.</p>
    </div>
  );
}

/** "Join ⟨channel⟩?" sheet for invite links opened from outside the app. */
export function JoinInviteModal() {
  const code = useUI((s) => s.pendingInvite);
  const close = () => useUI.getState().set({ pendingInvite: null });
  return (
    <Modal open={!!code} onClose={close} width={380}>
      {code && <JoinInvite code={code} onClose={close} />}
    </Modal>
  );
}

function JoinInvite({ code, onClose }: { code: string; onClose: () => void }) {
  const [preview, setPreview] = useState<InvitePreview | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const existing = useChannels((s) => s.channels.find((c) => c.kind === 'space' && c.inviteCode === code));
  useEffect(() => void loadInvitePreview(code).then(setPreview), [code]);

  const join = async () => {
    if (existing) {
      useChannels.getState().select(existing.id);
      return onClose();
    }
    setBusy(true);
    try {
      const ch = await useChannels.getState().join(code);
      sounds.pop();
      toast({ kind: 'success', title: `Welcome to ${ch.name}` });
      onClose();
    } catch {
      toast({ kind: 'error', title: 'That invite doesn’t work anymore' });
      setBusy(false);
    }
  };

  return (
    <div className="p-7 text-center">
      {preview === undefined ? (
        <div className="grid h-[180px] place-items-center text-fg-3">
          <Spinner />
        </div>
      ) : preview === null ? (
        <>
          <div className="emoji text-[44px]">🔗</div>
          <h2 className="mt-2 font-display text-[19px] font-bold">This invite doesn’t work</h2>
          <p className="mt-1 text-[13px] text-fg-2">It may have been reset. Ask your friend for a new link.</p>
          <Button className="mt-6 w-full" onClick={onClose}>
            Close
          </Button>
        </>
      ) : (
        <>
          <motion.div initial={{ scale: 0.8, rotate: -6 }} animate={{ scale: 1, rotate: 0 }} className="emoji mx-auto grid h-[76px] w-[76px] place-items-center rounded-[24px] text-[38px] shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_14px_34px_rgba(0,0,0,0.3)]" style={{ background: channelGradient(preview.color) }}>
            {preview.emoji}
          </motion.div>
          <p className="mt-4 text-[12.5px] text-fg-2">You’ve been invited to join</p>
          <h2 className="font-display text-[22px] font-bold tracking-[-0.025em]">{preview.name}</h2>
          <p className="mt-0.5 text-[12.5px] text-fg-3">{preview.members} {preview.members === 1 ? 'member' : 'members'}</p>
          <div className="mt-6 flex gap-2">
            <Button className="flex-1" onClick={onClose}>
              Not now
            </Button>
            <Button variant="primary" className="flex-1" loading={busy} onClick={() => void join()}>
              {existing ? 'Open' : 'Join'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** An invite link inside a chat message renders as a card with a Join button. */
export function InviteCard({ code }: { code: string }) {
  const [preview, setPreview] = useState<InvitePreview | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const existing = useChannels((s) => s.channels.find((c) => c.kind === 'space' && c.inviteCode === code));
  useEffect(() => void loadInvitePreview(code).then(setPreview), [code]);
  if (preview === null) return null;

  const join = async () => {
    if (existing) return useChannels.getState().select(existing.id);
    setBusy(true);
    try {
      const ch = await useChannels.getState().join(code);
      sounds.pop();
      toast({ kind: 'success', title: `Welcome to ${ch.name}` });
    } catch {
      toast({ kind: 'error', title: 'That invite doesn’t work anymore' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1.5 w-[340px] max-w-full rounded-[14px] p-3.5 glass-tile">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-fg-3">Invite to a channel</div>
      <div className="mt-2.5 flex items-center gap-3">
        <div className={clsx('emoji grid h-12 w-12 shrink-0 place-items-center rounded-[15px] text-[24px]', !preview && 'shimmer')} style={preview ? { background: channelGradient(preview.color) } : undefined}>
          {preview?.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold">{preview?.name ?? ' '}</div>
          <div className="text-[12px] text-fg-3">{preview ? `${preview.members} ${preview.members === 1 ? 'member' : 'members'}` : ' '}</div>
        </div>
        <Button size="sm" variant={existing ? 'secondary' : 'primary'} loading={busy} disabled={!preview} onClick={() => void join()} className={existing ? '' : 'bg-success!'}>
          {existing ? 'Joined' : 'Join'}
        </Button>
      </div>
    </div>
  );
}
