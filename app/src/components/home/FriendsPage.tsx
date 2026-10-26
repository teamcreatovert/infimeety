import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { AtSign, Check, Copy, Ellipsis, MessageSquare, Phone, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { Friend } from '../../../../shared/protocol';
import { MobileBack } from '../shell/MobileBack';
import { Avatar } from '../ui/Avatar';
import { MenuItem, Popover, Tooltip, type Anchor } from '../ui/overlay';
import { Button, Spinner } from '../ui/primitives';
import { ApiError } from '@/lib/api';
import { spring } from '@/lib/motion';
import { sounds } from '@/lib/sounds';
import { voice } from '@/lib/voice/engine';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { useFriends } from '@/stores/friends';
import { toast } from '@/stores/ui';

type Tab = 'online' | 'all' | 'pending' | 'add';

export async function messageFriend(userId: string) {
  try {
    return await useChannels.getState().openDm(userId);
  } catch {
    toast({ kind: 'error', title: "Couldn't open the conversation" });
    return null;
  }
}

export async function callFriend(userId: string, withVideo = false) {
  const dm = await messageFriend(userId);
  const callRoom = dm?.rooms.find((r) => r.kind === 'voice');
  if (!dm || !callRoom) return;
  await voice.join(dm.id, callRoom.id);
  if (withVideo) await voice.toggleCamera();
}

export function FriendsPage() {
  const [tab, setTab] = useState<Tab>('online');
  const friends = useFriends((s) => s.friends);
  const online = useFriends((s) => s.online);
  const loaded = useFriends((s) => s.loaded);
  const accepted = friends.filter((f) => f.status === 'accepted').sort((a, b) => a.user.name.localeCompare(b.user.name));
  const pending = friends.filter((f) => f.status !== 'accepted').sort((a) => (a.status === 'incoming' ? -1 : 1));
  const incoming = pending.filter((f) => f.status === 'incoming').length;
  const list = tab === 'online' ? accepted.filter((f) => online[f.user.id]) : tab === 'all' ? accepted : pending;
  const label = tab === 'online' ? 'Online' : tab === 'all' ? 'All friends' : 'Pending';

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Phones: the tabs scroll sideways. */}
      <header data-tauri-drag-region className="hairline-b flex h-[52px] shrink-0 items-center gap-1.5 px-5 compact:overflow-x-auto compact:px-3 compact:[scrollbar-width:none]">
        <MobileBack />
        <Users size={18} className="mr-1 shrink-0 text-fg-3 compact:hidden" />
        <h1 data-tauri-drag-region className="mr-3 shrink-0 font-display text-[15px] font-semibold tracking-[-0.015em] compact:mr-1">
          Friends
        </h1>
        <TabButton active={tab === 'online'} onClick={() => setTab('online')}>Online</TabButton>
        <TabButton active={tab === 'all'} onClick={() => setTab('all')}>All</TabButton>
        <TabButton active={tab === 'pending'} onClick={() => setTab('pending')}>
          Pending
          {incoming > 0 && <span className="ml-1.5 grid h-[16px] min-w-[16px] place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{incoming}</span>}
        </TabButton>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => setTab('add')}
          className={clsx('ml-2 flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[8px] px-3 text-[12.5px] font-semibold transition-colors', tab === 'add' ? 'bg-success/15 text-success' : 'bg-success text-white hover:brightness-110')}
        >
          <UserPlus size={14} /> <span className="compact:hidden">Add friend</span>
        </motion.button>
        <div data-tauri-drag-region className="flex-1 self-stretch" />
      </header>

      <div className="scroll min-h-0 flex-1 px-5 pb-6 pt-4 compact:px-3" style={{ scrollbarGutter: 'auto' }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }} transition={spring}>
            {tab === 'add' ? (
              <AddFriend />
            ) : !loaded ? (
              <div className="grid place-items-center py-16 text-fg-3">
                <Spinner />
              </div>
            ) : list.length === 0 ? (
              <EmptyState tab={tab} onAdd={() => setTab('add')} />
            ) : (
              <>
                <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-fg-3">
                  {label} — {list.length}
                </div>
                <div className="flex flex-col gap-px">
                  <AnimatePresence initial={false}>
                    {list.map((f) => (
                      <FriendRow key={f.user.id} friend={f} online={!!online[f.user.id]} />
                    ))}
                  </AnimatePresence>
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx('relative flex h-7 shrink-0 items-center whitespace-nowrap rounded-[8px] px-3 text-[12.5px] font-medium transition-colors', active ? 'text-fg' : 'text-fg-2 hover:bg-fill-2 hover:text-fg')}
    >
      {active && <motion.span layoutId="friends-tab" transition={spring} className="absolute inset-0 rounded-[8px] bg-fill-3" />}
      <span className="relative flex items-center">{children}</span>
    </button>
  );
}

function FriendRow({ friend, online }: { friend: Friend; online: boolean }) {
  const [menu, setMenu] = useState<Anchor | null>(null);
  const [busy, setBusy] = useState(false);
  const { user, status } = friend;
  const store = useFriends.getState();
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      toast({ kind: 'error', title: 'Something went wrong. Try again.' });
    } finally {
      setBusy(false);
    }
  };
  const subtitle = status === 'incoming' ? 'Incoming friend request' : status === 'outgoing' ? 'Outgoing friend request' : online ? 'Online' : 'Offline';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={spring}
      onDoubleClick={() => status === 'accepted' && void messageFriend(user.id)}
      className="group flex items-center gap-3 rounded-[12px] px-2 py-2 transition-colors hover:bg-fill-1"
    >
      <Avatar user={user} size={38} presence={status === 'accepted' ? (online ? 'online' : 'offline') : null} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[14px] font-semibold">{user.name}</span>
          <span className="truncate text-[12px] text-fg-3">@{user.username}</span>
        </div>
        <div className={clsx('text-[12px]', status === 'incoming' ? 'text-accent' : 'text-fg-3')}>{subtitle}</div>
      </div>

      <div className="flex items-center gap-1.5">
        {busy && <Spinner size={14} className="text-fg-3" />}
        {status === 'accepted' && (
          <>
            <RowButton label="Message" onClick={() => void messageFriend(user.id)}>
              <MessageSquare size={16} />
            </RowButton>
            <RowButton label="Call" onClick={() => void callFriend(user.id)}>
              <Phone size={16} />
            </RowButton>
            <RowButton label="More" onClick={(el) => setMenu(el.getBoundingClientRect())}>
              <Ellipsis size={16} />
            </RowButton>
          </>
        )}
        {status === 'incoming' && (
          <>
            <RowButton label="Accept" tone="success" onClick={() => void act(() => store.accept(user.id).then(() => sounds.pop()))}>
              <Check size={17} />
            </RowButton>
            <RowButton label="Decline" tone="danger" onClick={() => void act(() => store.remove(user.id))}>
              <X size={17} />
            </RowButton>
          </>
        )}
        {status === 'outgoing' && (
          <RowButton label="Cancel request" tone="danger" onClick={() => void act(() => store.remove(user.id))}>
            <X size={17} />
          </RowButton>
        )}
      </div>

      <Popover open={!!menu} anchor={menu} onClose={() => setMenu(null)} side="bottom" align="end" className="w-[200px] p-1.5">
        <MenuItem icon={<Phone size={14} />} onClick={() => (setMenu(null), void callFriend(user.id, true))}>
          Video call
        </MenuItem>
        <MenuItem
          danger
          icon={<UserMinus size={14} />}
          onClick={() => {
            setMenu(null);
            if (confirm(`Remove ${user.name} from your friends?`)) void act(() => store.remove(user.id));
          }}
        >
          Remove friend
        </MenuItem>
      </Popover>
    </motion.div>
  );
}

function RowButton({ label, onClick, tone, children }: { label: string; onClick: (el: HTMLElement) => void; tone?: 'success' | 'danger'; children: ReactNode }) {
  const color = tone === 'success' ? 'var(--success)' : tone === 'danger' ? 'var(--danger)' : undefined;
  return (
    <Tooltip label={label}>
      <motion.button
        aria-label={label}
        whileTap={{ scale: 0.9 }}
        onClick={(e) => onClick(e.currentTarget)}
        className="grid h-9 w-9 place-items-center rounded-full bg-fill-2 text-fg-2 transition-colors hover:bg-fill-3 hover:text-fg"
        style={color ? { color } : undefined}
      >
        {children}
      </motion.button>
    </Tooltip>
  );
}

function EmptyState({ tab, onAdd }: { tab: Exclude<Tab, 'add'>; onAdd: () => void }) {
  const copy = {
    online: { emoji: '🌙', title: 'Nobody’s online right now', body: 'Your friends will show up here when they open Infimeety.' },
    all: { emoji: '👋', title: 'No friends yet', body: 'Add friends with their Infimeety username to call and message them.' },
    pending: { emoji: '📭', title: 'No pending requests', body: 'Friend requests you send or receive show up here.' },
  }[tab];
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <div className="emoji text-[52px]">{copy.emoji}</div>
      <div className="mt-3 font-display text-[18px] font-semibold tracking-[-0.02em]">{copy.title}</div>
      <p className="mt-1 max-w-[320px] text-[13px] text-fg-2">{copy.body}</p>
      <Button variant="primary" className="mt-5" icon={<UserPlus size={15} />} onClick={onAdd}>
        Add friend
      </Button>
    </div>
  );
}

function AddFriend() {
  const me = useAuth((s) => s.me);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const handle = name.trim().replace(/^@/, '');
    if (!handle) return;
    setBusy(true);
    setResult(null);
    try {
      const f = await useFriends.getState().add(handle);
      setResult({ ok: true, text: f.status === 'accepted' ? `You and ${f.user.name} are now friends! 🎉` : `Friend request sent to ${f.user.name}.` });
      setName('');
      sounds.pop();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      const text =
        code === 'user_not_found'
          ? 'Hmm, nobody has that username. Check the spelling and try again.'
          : code === 'self'
            ? 'That’s you! Try a friend’s username.'
            : code === 'already_friends'
              ? 'You’re already friends.'
              : code === 'already_requested'
                ? 'You already sent them a request.'
                : 'Something went wrong. Try again.';
      setResult({ ok: false, text });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[560px] pt-2">
      <h2 className="font-display text-[20px] font-bold tracking-[-0.02em]">Add a friend</h2>
      <p className="mt-1 text-[13.5px] text-fg-2">Add friends with their Infimeety username. Once they accept, you can message and call each other.</p>
      <form onSubmit={submit} className="field mt-5 flex h-[52px] items-center gap-2 rounded-[14px]! pl-4 pr-2" style={result && !result.ok ? { boxShadow: 'inset 0 0 0 1px var(--danger)' } : undefined}>
        <AtSign size={17} className="shrink-0 text-fg-3" />
        <input
          autoFocus
          value={name}
          onChange={(e) => (setName(e.target.value.toLowerCase().replace(/\s/g, '')), setResult(null))}
          placeholder="username"
          maxLength={25}
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-3"
        />
        <Button type="submit" variant="primary" size="md" loading={busy} disabled={!name.trim()}>
          Send request
        </Button>
      </form>
      <AnimatePresence>
        {result && (
          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-2.5 px-1 text-[13px]" style={{ color: result.ok ? 'var(--success)' : 'var(--danger)' }}>
            {result.text}
          </motion.p>
        )}
      </AnimatePresence>

      {me?.username && (
        <div className="mt-8 flex items-center gap-3 rounded-[14px] bg-fill-1 p-3.5 shadow-[inset_0_0_0_0.5px_var(--hairline-strong)]">
          <Avatar user={me} size={36} />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] text-fg-3">Your username</div>
            <div className="truncate text-[15px] font-semibold">@{me.username}</div>
          </div>
          <Button size="sm" icon={<Copy size={13} />} onClick={() => void navigator.clipboard.writeText(me.username!).then(() => toast({ kind: 'success', title: 'Username copied', body: 'Send it to a friend so they can add you.' }))}>
            Copy
          </Button>
        </div>
      )}
    </div>
  );
}
