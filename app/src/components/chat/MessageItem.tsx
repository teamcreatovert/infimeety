import clsx from 'clsx';
import { motion } from 'motion/react';
import { Copy, Pencil, Reply, SmilePlus, Trash2 } from 'lucide-react';
import { memo, useState } from 'react';
import type { Channel } from '../../../../shared/protocol';
import { Avatar } from '../ui/Avatar';
import { Popover, Tooltip, type Anchor } from '../ui/overlay';
import { AttachmentView } from './AttachmentView';
import { EmojiPicker } from './EmojiPicker';
import { InviteCard } from '../modals/InviteModals';
import { QUICK_REACTIONS } from '@/lib/emoji';
import { findInviteCode } from '@/lib/invite';
import { formatFull, formatTime, isJumboEmoji } from '@/lib/format';
import { localMedia } from '@/lib/platform';
import { getHub } from '@/lib/realtime';
import { renderRich } from '@/lib/richtext';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import type { LocalMessage } from '@/stores/messages';
import { openProfile, openUserMenu, useUI } from '@/stores/ui';

interface Props {
  msg: LocalMessage;
  grouped: boolean;
  channel: Channel;
  replyTarget?: LocalMessage;
  animate: boolean;
  onReply: (m: LocalMessage) => void;
  onJump: (id: string) => void;
}

export const MessageItem = memo(function MessageItem({ msg, grouped, channel, replyTarget, animate, onReply, onJump }: Props) {
  const author = useChannels((s) => s.users[msg.userId]);
  const replyAuthor = useChannels((s) => (replyTarget ? s.users[replyTarget.userId] : undefined));
  const me = useAuth((s) => s.me);
  // Touch screens have no hover: a tap on the message shows its actions.
  const touched = useUI((s) => s.touchedMessage === msg.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);
  const [picker, setPicker] = useState<Anchor | null>(null);
  const mine = msg.userId === me?.id;
  const canDelete = mine || channel.role !== 'member';
  const hub = () => getHub(channel.id);

  const react = (emoji: string) => hub()?.send({ t: 'chat.react', id: msg.id, emoji });
  const saveEdit = () => {
    const content = draft.trim();
    if (content && content !== msg.content) hub()?.send({ t: 'chat.edit', id: msg.id, content });
    setEditing(false);
  };
  const remove = () => {
    hub()?.send({ t: 'chat.delete', id: msg.id });
    if (mine && localMedia.available) for (const a of msg.attachments) void localMedia.forget(a.id);
  };

  const jumbo = !msg.attachments.length && isJumboEmoji(msg.content);
  const inviteCode = findInviteCode(msg.content);
  const reactions = Object.entries(msg.reactions);

  return (
    <motion.div
      id={`msg-${msg.id}`}
      initial={animate ? { opacity: 0, y: 10, scale: 0.99 } : false}
      animate={{ opacity: msg.pending ? 0.55 : 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 38 }}
      onPointerUp={(e) => {
        if (e.pointerType !== 'touch' || (e.target as Element).closest('button, a, input, textarea, video, audio, img')) return;
        useUI.getState().set({ touchedMessage: touched ? null : msg.id });
      }}
      className={clsx('group relative flex gap-3 rounded-[10px] px-5 py-[3px] transition-colors hover:bg-fill-1 compact:px-3', grouped ? '' : 'mt-3 pt-1.5', touched && 'bg-fill-1')}
    >
      <div className="w-9 shrink-0">
        {grouped ? (
          <span className="block pt-[3px] text-right text-[10.5px] tabular-nums text-fg-3 opacity-0 group-hover:opacity-100">{formatTime(msg.createdAt)}</span>
        ) : (
          <button
            aria-label={`${author?.name ?? 'Someone'}'s profile`}
            onClick={(e) => openProfile(e, msg.userId)}
            onContextMenu={(e) => openUserMenu(e, msg.userId, { kind: 'member', channelId: channel.id })}
            className="block rounded-full transition-transform active:scale-95"
          >
            <Avatar user={author} size={36} />
          </button>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {replyTarget && (
          <button onClick={() => onJump(replyTarget.id)} className="mb-0.5 flex max-w-full items-center gap-1.5 text-[12px] text-fg-3 hover:text-fg-2">
            <Reply size={12} className="shrink-0 -scale-x-100" />
            <Avatar user={replyAuthor} size={14} />
            <span className="shrink-0 font-semibold">{replyAuthor?.name ?? 'Someone'}</span>
            <span className="truncate">{replyTarget.content || 'Attachment'}</span>
          </button>
        )}
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <button
              onClick={(e) => openProfile(e, msg.userId)}
              onContextMenu={(e) => openUserMenu(e, msg.userId, { kind: 'member', channelId: channel.id })}
              className="text-[13.5px] font-semibold tracking-[-0.01em] hover:underline"
            >
              {author?.name ?? 'Someone'}
            </button>
            <Tooltip label={formatFull(msg.createdAt)}>
              <span className="text-[11px] tabular-nums text-fg-3">{formatTime(msg.createdAt)}</span>
            </Tooltip>
          </div>
        )}

        {editing ? (
          <div className="mt-1">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  saveEdit();
                }
                if (e.key === 'Escape') setEditing(false);
              }}
              rows={Math.min(8, draft.split('\n').length)}
              className="field w-full resize-none px-3 py-2 text-[14px] outline-none"
            />
            <div className="mt-1 text-[11px] text-fg-3">Enter to save · Esc to cancel</div>
          </div>
        ) : (
          msg.content && (
            <div className={clsx('selectable whitespace-pre-wrap break-words', jumbo ? 'emoji py-0.5 text-[42px] leading-[1.15]' : 'text-[14.5px] leading-[1.45] text-fg')}>
              {jumbo ? msg.content : renderRich(msg.content, me?.username)}
              {msg.editedAt && <span className="ml-1.5 text-[10.5px] text-fg-3">(edited)</span>}
            </div>
          )
        )}

        {inviteCode && !msg.pending && <InviteCard code={inviteCode} />}

        {msg.attachments.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-2">
            {msg.attachments.map((a) => (
              <AttachmentView key={a.id} att={a} channelId={channel.id} />
            ))}
          </div>
        )}

        {reactions.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {reactions.map(([emoji, users]) => {
              const active = !!me && users.includes(me.id);
              return (
                <motion.button
                  key={emoji}
                  layout
                  whileTap={{ scale: 0.9 }}
                  onClick={() => react(emoji)}
                  className={clsx(
                    'flex h-[26px] items-center gap-1 rounded-full px-2 text-[12px] font-semibold tabular-nums transition-colors',
                    active ? 'text-accent' : 'bg-fill-2 text-fg-2 hover:bg-fill-3',
                  )}
                  style={active ? { background: 'color-mix(in srgb, var(--accent) 20%, transparent)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent)' } : undefined}
                >
                  <span className="emoji text-[14px]">{emoji}</span>
                  {users.length}
                </motion.button>
              );
            })}
          </div>
        )}
      </div>

      {!msg.pending && !editing && (
        <div
          className={clsx(
            'absolute -top-3.5 right-4 z-10 flex items-center gap-px rounded-[10px] p-[3px] opacity-0 glass-pop transition-opacity duration-100 group-hover:opacity-100 compact:right-2',
            touched ? 'opacity-100' : 'touch:pointer-events-none',
          )}
        >
          {QUICK_REACTIONS.slice(0, 3).map((e) => {
            const mineHere = !!me && !!msg.reactions[e]?.includes(me.id);
            return (
              <button
                key={e}
                onClick={() => react(e)}
                className="emoji grid h-7 w-7 place-items-center rounded-[7px] text-[15px] transition-transform hover:scale-110 hover:bg-fill-2"
                style={mineHere ? { background: 'color-mix(in srgb, var(--accent) 22%, transparent)' } : undefined}
              >
                {e}
              </button>
            );
          })}
          <ToolButton label="Add reaction" onClick={(el) => setPicker(el.getBoundingClientRect())}>
            <SmilePlus size={15} />
          </ToolButton>
          <ToolButton label="Reply" onClick={() => onReply(msg)}>
            <Reply size={15} />
          </ToolButton>
          {mine && msg.content && (
            <ToolButton label="Edit" onClick={() => (setDraft(msg.content), setEditing(true))}>
              <Pencil size={14} />
            </ToolButton>
          )}
          {msg.content && (
            <ToolButton label="Copy text" onClick={() => void navigator.clipboard.writeText(msg.content)}>
              <Copy size={14} />
            </ToolButton>
          )}
          {canDelete && (
            <ToolButton label="Delete" danger onClick={remove}>
              <Trash2 size={14} />
            </ToolButton>
          )}
        </div>
      )}

      <Popover open={!!picker} anchor={picker} onClose={() => setPicker(null)} side="left" align="start">
        <EmojiPicker
          onPick={(e) => {
            react(e);
            setPicker(null);
          }}
        />
      </Popover>
    </motion.div>
  );
});

function ToolButton({ label, onClick, danger, children }: { label: string; onClick: (el: HTMLElement) => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip label={label}>
      <button
        aria-label={label}
        onClick={(e) => onClick(e.currentTarget)}
        className={clsx('grid h-7 w-7 place-items-center rounded-[7px] text-fg-2 transition-colors', danger ? 'hover:bg-danger hover:text-white' : 'hover:bg-fill-2 hover:text-fg')}
      >
        {children}
      </button>
    </Tooltip>
  );
}
