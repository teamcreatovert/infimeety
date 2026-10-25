import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, ImagePlus, Reply, Smile, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Attachment, Channel, Room } from '../../../../shared/protocol';
import { Avatar } from '../ui/Avatar';
import { Popover, type Anchor } from '../ui/overlay';
import { IconButton } from '../ui/primitives';
import { EmojiPicker } from './EmojiPicker';
import { formatBytes } from '@/lib/format';
import { spring, snappy } from '@/lib/motion';
import { isTauri, localMedia, type SharedFile } from '@/lib/platform';
import { getHub } from '@/lib/realtime';
import { sounds } from '@/lib/sounds';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { useMedia } from '@/stores/media';
import { useMessages, type LocalMessage } from '@/stores/messages';
import { toast } from '@/stores/ui';

interface Staged {
  file: SharedFile;
  preview: string;
  width?: number;
  height?: number;
}

const drafts = new Map<string, string>();

async function measure(file: SharedFile, src: string): Promise<{ width?: number; height?: number }> {
  try {
    if (file.mime.startsWith('image/')) {
      const img = new Image();
      img.src = src;
      await img.decode();
      return { width: img.naturalWidth, height: img.naturalHeight };
    }
    if (file.mime.startsWith('video/')) {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.src = src;
      await new Promise((r) => {
        v.onloadedmetadata = r;
        v.onerror = r;
        setTimeout(r, 3000);
      });
      return v.videoWidth ? { width: v.videoWidth, height: v.videoHeight } : {};
    }
  } catch {
    /* unknown dimensions are fine */
  }
  return {};
}

export function Composer({ channel, room, replyTo, onCancelReply }: { channel: Channel; room: Room; replyTo: LocalMessage | null; onCancelReply: () => void }) {
  const me = useAuth((s) => s.me);
  const replyAuthor = useChannels((s) => (replyTo ? s.users[replyTo.userId] : undefined));
  const [text, setText] = useState(() => drafts.get(room.id) ?? '');
  const [staged, setStaged] = useState<Staged[]>([]);
  const [emoji, setEmoji] = useState<Anchor | null>(null);
  const [dragging, setDragging] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const lastTyping = useRef(0);

  useEffect(() => {
    drafts.set(room.id, text);
    const el = ta.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
    }
  }, [text, room.id]);

  useEffect(() => {
    ta.current?.focus();
  }, [room.id, replyTo]);

  const stage = async (files: SharedFile[]) => {
    const next = await Promise.all(
      files.map(async (file) => {
        const preview = localMedia.src(file.path);
        return { file, preview, ...(await measure(file, preview)) };
      }),
    );
    setStaged((s) => [...s, ...next].slice(0, 10));
    ta.current?.focus();
  };

  // Native drag-and-drop: Rust records the dropped paths, then we register them by id.
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    void import('@tauri-apps/api/webview').then(({ getCurrentWebview }) =>
      getCurrentWebview()
        .onDragDropEvent((event) => {
          const t = event.payload.type;
          if (t === 'enter' || t === 'over') setDragging(true);
          else if (t === 'leave') setDragging(false);
          else if (t === 'drop') {
            setDragging(false);
            setTimeout(async () => {
              let files = await localMedia.takeDropped();
              if (!files.length) {
                await new Promise((r) => setTimeout(r, 150));
                files = await localMedia.takeDropped();
              }
              if (files.length) void stage(files);
              else toast({ kind: 'info', title: 'Only images, GIFs, videos and audio can be shared' });
            }, 40);
          }
        })
        .then((fn) => (unlisten = fn)),
    );
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const attach = async () => {
    if (!localMedia.available) return toast({ kind: 'info', title: 'Sharing media needs the desktop app' });
    try {
      const files = await localMedia.pick();
      if (files.length) await stage(files);
    } catch {
      toast({ kind: 'error', title: "Couldn't open that file" });
    }
  };

  const onPaste = async (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files).filter((f) => /^(image|video)\//.test(f.type));
    if (!files.length) return;
    e.preventDefault();
    if (!localMedia.available) return toast({ kind: 'info', title: 'Sharing media needs the desktop app' });
    for (const f of files) {
      const ext = f.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
      const saved = await localMedia.saveBytes(f.name && f.name !== 'image.png' ? f.name : `pasted.${ext}`, new Uint8Array(await f.arrayBuffer()));
      await stage([saved]);
    }
  };

  const send = () => {
    const content = text.trim();
    if ((!content && !staged.length) || !me) return;
    const attachments: Attachment[] = staged.map((s) => ({
      id: s.file.id,
      ownerId: me.id,
      name: s.file.name,
      mime: s.file.mime,
      size: s.file.size,
      width: s.width,
      height: s.height,
    }));
    for (const s of staged) useMedia.getState().setEntry(s.file.id, { status: 'ready', url: s.preview, local: true, progress: 1 });
    const replyId = replyTo && !replyTo.pending ? replyTo.id : null;
    const nonce = useMessages.getState().addPending(room.id, me.id, content, attachments, replyId);
    getHub(channel.id)?.send({ t: 'chat.send', roomId: room.id, content, attachments, replyTo: replyId, nonce });
    setText('');
    setStaged([]);
    onCancelReply();
    sounds.send();
  };

  const onChange = (value: string) => {
    setText(value);
    if (value && Date.now() - lastTyping.current > 3000) {
      lastTyping.current = Date.now();
      getHub(channel.id)?.send({ t: 'typing', roomId: room.id });
    }
  };

  const canSend = !!text.trim() || staged.length > 0;

  return (
    <div className="shrink-0 px-4 pb-4">
      <div className="field rounded-[20px]! bg-[var(--glass-tile)]!">
        <AnimatePresence initial={false}>
          {replyTo && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring} className="overflow-hidden">
              <div className="flex items-center gap-2 px-4 pt-2.5 text-[12px] text-fg-2">
                <Reply size={13} className="-scale-x-100" />
                <span>Replying to</span>
                <Avatar user={replyAuthor} size={16} />
                <span className="font-semibold text-fg">{replyAuthor?.name}</span>
                <button aria-label="Cancel reply" onClick={onCancelReply} className="ml-auto grid h-5 w-5 place-items-center rounded-full bg-fill-2 hover:bg-fill-3">
                  <X size={11} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {staged.length > 0 && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring} className="overflow-hidden">
              <div className="flex gap-2 overflow-x-auto px-3 pt-3">
                {staged.map((s) => (
                  <motion.div key={s.file.id} layout initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={snappy} className="group relative h-[84px] w-[84px] shrink-0 overflow-hidden rounded-[12px] bg-fill-2">
                    {s.file.mime.startsWith('image/') ? (
                      <img src={s.preview} alt="" className="h-full w-full object-cover" />
                    ) : s.file.mime.startsWith('video/') ? (
                      <video src={s.preview} muted className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full place-items-center text-[11px] text-fg-2">Audio</div>
                    )}
                    <span className="absolute inset-x-0 bottom-0 truncate bg-black/50 px-1.5 py-0.5 text-[10px] text-white">{formatBytes(s.file.size)}</span>
                    <button
                      aria-label="Remove"
                      onClick={() => setStaged((x) => x.filter((y) => y !== s))}
                      className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white opacity-0 transition group-hover:opacity-100"
                    >
                      <X size={11} />
                    </button>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-end gap-0.5 p-1.5">
          <IconButton label="Share images, GIFs or videos" size={34} className="rounded-full!" onClick={() => void attach()}>
            <ImagePlus size={18} />
          </IconButton>
          <textarea
            ref={ta}
            rows={1}
            value={text}
            onChange={(e) => onChange(e.target.value)}
            onPaste={(e) => void onPaste(e)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
              if (e.key === 'Escape' && replyTo) onCancelReply();
            }}
            placeholder={room.kind === 'text' ? `Message #${room.name}` : `Chat in ${room.name}`}
            className="max-h-[220px] min-h-[34px] flex-1 resize-none bg-transparent px-1.5 py-[7px] text-[14.5px] leading-[1.4] outline-none placeholder:text-fg-3"
          />
          <IconButton label="Emoji" size={34} className="rounded-full!" onClick={(e) => setEmoji(e.currentTarget.getBoundingClientRect())}>
            <Smile size={18} />
          </IconButton>
          <motion.button
            aria-label="Send"
            onClick={send}
            animate={{ scale: canSend ? 1 : 0.85, opacity: canSend ? 1 : 0.35 }}
            whileTap={canSend ? { scale: 0.88 } : undefined}
            transition={snappy}
            className={clsx('grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full text-white', canSend ? 'bg-accent' : 'bg-fill-3')}
          >
            <ArrowUp size={18} strokeWidth={2.4} />
          </motion.button>
        </div>
      </div>

      <Popover open={!!emoji} anchor={emoji} onClose={() => setEmoji(null)} side="top" align="end">
        <EmojiPicker
          onPick={(e) => {
            const el = ta.current;
            const at = el?.selectionStart ?? text.length;
            setText(text.slice(0, at) + e + text.slice(at));
            setEmoji(null);
            requestAnimationFrame(() => {
              el?.focus();
              el?.setSelectionRange(at + e.length, at + e.length);
            });
          }}
        />
      </Popover>

      <AnimatePresence>
        {dragging && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none fixed inset-0 z-[70] grid place-items-center bg-black/30 backdrop-blur-[2px]">
            <motion.div initial={{ scale: 0.92 }} animate={{ scale: 1 }} transition={spring} className="flex flex-col items-center gap-2 rounded-[24px] border-2 border-dashed border-[var(--accent)] px-12 py-10 text-center glass-pop">
              <ImagePlus size={30} className="text-accent" />
              <div className="font-display text-[17px] font-semibold">Drop to share in #{room.name}</div>
              <div className="text-[12.5px] text-fg-2">Files stay on your PC — friends stream them from you</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function TypingIndicator({ roomId }: { roomId: string }) {
  const typing = useChannels((s) => s.typing[roomId]);
  const users = useChannels((s) => s.users);
  const meId = useAuth((s) => s.me?.id);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const now = Date.now();
  const names = Object.entries(typing ?? {})
    .filter(([id, exp]) => exp > now && id !== meId)
    .map(([id]) => users[id]?.name ?? 'Someone');
  const label = !names.length ? '' : names.length === 1 ? `${names[0]} is typing` : names.length === 2 ? `${names[0]} and ${names[1]} are typing` : 'Several people are typing';

  return (
    <div className="h-5 shrink-0 px-6 text-[11.5px] text-fg-2">
      <AnimatePresence>
        {label && (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5">
            <span className="flex gap-[3px]">
              {[0, 1, 2].map((i) => (
                <motion.span key={i} className="h-1 w-1 rounded-full bg-fg-2" animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }} />
              ))}
            </span>
            <span>
              <b className="font-semibold text-fg">{label.split(' is ')[0].split(' are ')[0]}</b>
              {label.includes(' is typing') ? ' is typing' : label.includes(' are typing') ? ' are typing' : ''}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
