import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, File as FileIcon, Folder, Music, Paperclip, Popcorn, Reply, Smile, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_FILE_SIZE, type Attachment, type Channel, type Member, type Room } from '../../../../shared/protocol';
import { Avatar } from '../ui/Avatar';
import { MenuItem, MenuSeparator, Popover, type Anchor } from '../ui/overlay';
import { IconButton } from '../ui/primitives';
import { EmojiPicker } from './EmojiPicker';
import { formatBytes } from '@/lib/format';
import { spring, snappy } from '@/lib/motion';
import { isMobile, isPhoneApp, isTauri, localMedia, type SharedFile } from '@/lib/platform';
import { adopt, FOLDER_MIME, fromDrop } from '@/lib/webMedia';

/** Phones can't pick folders. */
const canShareFolders = isTauri || !isMobile;
import { getHub } from '@/lib/realtime';
import { featureOn } from '@/lib/remote';
import { sounds } from '@/lib/sounds';
import { useAuth } from '@/stores/auth';
import { useChannels, type Bot } from '@/stores/channels';
import { useMedia } from '@/stores/media';
import { useMessages, type LocalMessage } from '@/stores/messages';
import { toast, useUI } from '@/stores/ui';
import { canModerateRole } from '../../../../shared/protocol';
import { noteSent, slowLabel, useSlowWait } from '@/lib/slowMode';

interface Staged {
  file: SharedFile;
  preview: string;
  width?: number;
  height?: number;
}

const drafts = new Map<string, string>();

/** The @name being typed right before the caret, if any: where it starts and what's typed so far. */
function mentionAt(text: string, caret: number) {
  const m = /(?:^|\s)@([\p{L}\p{N}_.-]{0,24})$/u.exec(text.slice(0, caret));
  return m ? { query: m[1], start: caret - m[1].length - 1 } : null;
}

interface Suggestion {
  id: string;
  name: string;
  /** What goes after the @: a person's username, a bot's name. */
  handle: string;
  avatarUrl: string | null;
  bot: boolean;
  online: boolean;
  about?: string;
}

const NO_MEMBERS: Member[] = [];
const NO_BOTS: Bot[] = [];
const NO_IDS: string[] = [];

/** Who `@query` could mean, like Discord's list: best matches first, then bots, then who's online. */
function useMentionSuggestions(channelId: string, meId: string | undefined, query: string | undefined) {
  const members = useChannels((s) => s.members[channelId] ?? NO_MEMBERS);
  const bots = useChannels((s) => s.bots[channelId] ?? NO_BOTS);
  const online = useChannels((s) => s.online[channelId] ?? NO_IDS);
  return useMemo(() => {
    if (query === undefined) return [];
    const q = query.toLowerCase();
    const all: Suggestion[] = [
      ...bots.map((b) => ({ id: b.id, name: b.name, handle: b.name, avatarUrl: b.avatarUrl, bot: true, online: true, about: b.instructions })),
      ...members
        .filter((m) => m.id !== meId && m.username)
        .map((m) => ({ id: m.id, name: m.name, handle: m.username!, avatarUrl: m.avatarUrl, bot: false, online: online.includes(m.id) })),
    ];
    const score = (x: Suggestion) => {
      if (!q) return 1;
      const name = x.name.toLowerCase();
      const handle = x.handle.toLowerCase();
      if (handle.startsWith(q) || name.startsWith(q)) return 3;
      if (name.split(/\s+/).some((w) => w.startsWith(q))) return 2;
      return handle.includes(q) || name.includes(q) ? 1 : 0;
    };
    return all
      .map((x) => ({ x, score: score(x) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || Number(b.x.bot) - Number(a.x.bot) || Number(b.x.online) - Number(a.x.online) || a.x.name.localeCompare(b.x.name))
      .slice(0, 8)
      .map((r) => r.x);
  }, [members, bots, online, meId, query]);
}
/** Shared across message boxes so one insert lands once, even if two boxes are mounted. */
let lastInsert = 0;

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
  const slowWait = useSlowWait(room, channel.role);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [emoji, setEmoji] = useState<Anchor | null>(null);
  const [dragging, setDragging] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const lastTyping = useRef(0);

  // @mentions: a list of people and bots while you type a name; arrows, Enter or Tab pick one.
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const mention = mentionAt(text, caret);
  const suggestions = useMentionSuggestions(channel.id, me?.id, mention?.query);
  const mentioning = !!mention && suggestions.length > 0 && dismissed !== mention.start;
  useEffect(() => setPick(0), [mention?.query]);
  const chooseMention = (s: Suggestion) => {
    if (!mention) return;
    const insert = `@${s.handle} `;
    const pos = mention.start + insert.length;
    setText(text.slice(0, mention.start) + insert + text.slice(caret));
    setCaret(pos);
    requestAnimationFrame(() => {
      ta.current?.focus();
      ta.current?.setSelectionRange(pos, pos);
    });
  };

  // "Mention" from a person's menu types @username here.
  const insert = useUI((s) => s.composerInsert);
  useEffect(() => {
    if (!insert || insert.at <= lastInsert) return;
    lastInsert = insert.at;
    setText((t) => `${t}${t && !/\s$/.test(t) ? ' ' : ''}${insert.text} `);
    ta.current?.focus();
    useUI.getState().set({ composerInsert: null });
  }, [insert]);

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

  const stage = async (picked: SharedFile[]) => {
    if (!featureOn('fileShare')) return toast({ kind: 'info', title: 'Sending files is paused', body: 'We switched it off for a moment while we fix something. It’ll be back soon.' });
    // Past 4 GB a file can't go in a message; say so rather than dropping it quietly.
    const tooBig = picked.filter((f) => f.size > MAX_FILE_SIZE);
    if (tooBig.length)
      toast({
        kind: 'error',
        title: tooBig.length === 1 ? `${tooBig[0].name} is too big to send` : `${tooBig.length} files are too big to send`,
        body: 'Files and folders can be up to 4 GB each.',
      });
    const files = picked.filter((f) => f.size <= MAX_FILE_SIZE);
    if (!files.length) return;
    const next = await Promise.all(
      files.map(async (file) => {
        const preview = localMedia.src(file.path);
        return { file, preview, ...(await measure(file, preview)) };
      }),
    );
    setStaged((s) => [...s, ...next].slice(0, 10));
    ta.current?.focus();
  };

  // Browser drag-and-drop: the files themselves are dropped, and kept in this browser.
  useEffect(() => {
    if (isTauri) return;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const leave = (e: DragEvent) => {
      if (hasFiles(e) && --depth <= 0) setDragging(false);
    };
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = e.dataTransfer ? await fromDrop(e.dataTransfer).catch(() => []) : [];
      if (files.length) void stage(files);
      else toast({ kind: 'info', title: 'Nothing to share there', body: 'That folder looks empty.' });
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
              else toast({ kind: 'info', title: 'Nothing to share there', body: 'That folder looks empty.' });
            }, 40);
          }
        })
        .then((fn) => (unlisten = fn)),
    );
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [attachMenu, setAttachMenu] = useState<Anchor | null>(null);
  // A watch party needs a voice room to watch in (spaces have them; DMs and meetings have their call).
  // From a voice room's chat: that room must allow parties. From a chat room: any voice room that does.
  const canWatch = room.kind === 'voice' ? room.allowParty !== false : channel.rooms.some((r) => r.kind === 'voice' && r.allowParty !== false);
  const attach = async (folder: boolean) => {
    setAttachMenu(null);
    try {
      const files = await (folder ? localMedia.pickFolder() : localMedia.pick());
      if (files.length) await stage(files);
    } catch {
      toast({ kind: 'error', title: `Couldn't open that ${folder ? 'folder' : 'file'}` });
    }
  };

  const onPaste = async (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (!files.length) return;
    e.preventDefault();
    if (!isTauri) return void stage(await adopt(files));
    for (const f of files) {
      const ext = f.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'bin';
      const saved = await localMedia.saveBytes(f.name && f.name !== 'image.png' ? f.name : `pasted.${ext}`, new Uint8Array(await f.arrayBuffer()));
      await stage([saved]);
    }
  };

  const send = () => {
    const content = text.trim();
    if ((!content && !staged.length) || !me || slowWait) return;
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
    // A browser shares straight from the open tab; the app keeps sharing from disk in the background.
    if (!isTauri && staged.some((s) => s.file.mime === FOLDER_MIME || s.file.size > 64 * 1024 * 1024)) {
      toast({
        kind: 'info',
        title: 'Keep Infimeety open while friends copy it',
        body: isPhoneApp
          ? 'Files come straight from this phone, so keep the app open until they’re done.'
          : 'Files come straight from this tab. The desktop app shares them even when it’s in the background.',
      });
    }
    const replyId = replyTo && !replyTo.pending ? replyTo.id : null;
    const nonce = useMessages.getState().addPending(room.id, me.id, content, attachments, replyId);
    getHub(channel.id)?.send({ t: 'chat.send', roomId: room.id, content, attachments, replyTo: replyId, nonce });
    noteSent(room.id);
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

  const canSend = (!!text.trim() || staged.length > 0) && !slowWait;

  return (
    <div className="relative shrink-0 px-4 pb-4 compact:px-2.5 compact:pb-2.5">
      <AnimatePresence>
        {mentioning && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6, transition: { duration: 0.12 } }}
            transition={snappy}
            className="absolute inset-x-4 bottom-full z-20 mb-1 rounded-[16px] p-1.5 glass-pop compact:inset-x-2.5"
          >
            <div className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-fg-3">{mention?.query ? `Matching @${mention.query}` : 'Mention someone'}</div>
            {suggestions.map((s, i) => (
              <button
                key={s.id}
                // Keeps the caret in the message box.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => chooseMention(s)}
                onMouseEnter={() => setPick(i)}
                className={clsx('flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left', i === pick && 'bg-fill-2')}
              >
                <Avatar user={s} size={24} presence={s.bot ? null : s.online ? 'online' : 'offline'} />
                <span className="shrink-0 truncate text-[13.5px] font-medium">{s.name}</span>
                {s.bot ? (
                  <span className="shrink-0 rounded-[4px] bg-accent px-1 text-[9.5px] font-bold leading-[15px] text-white">AI BOT</span>
                ) : (
                  <span className="truncate text-[12.5px] text-fg-3">@{s.handle}</span>
                )}
                {s.about && <span className="ml-auto min-w-0 truncate pl-3 text-[12px] text-fg-3">{s.about}</span>}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
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
                      <div className="flex h-full flex-col items-center justify-center gap-1 px-1.5 pb-4 text-center text-fg-2">
                        {s.file.mime === FOLDER_MIME ? <Folder size={20} /> : s.file.mime.startsWith('audio/') ? <Music size={20} /> : <FileIcon size={20} />}
                        <span className="w-full truncate text-[10px] font-medium uppercase">
                          {s.file.mime === FOLDER_MIME ? s.file.name : s.file.name.includes('.') ? s.file.name.split('.').pop() : 'file'}
                        </span>
                      </div>
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
          <IconButton
            label="Share files, a folder, or plan a watch party"
            size={34}
            className="rounded-full!"
            onClick={(e) => (canShareFolders || canWatch ? setAttachMenu(e.currentTarget.getBoundingClientRect()) : void attach(false))}
          >
            <Paperclip size={18} />
          </IconButton>
          <Popover open={!!attachMenu} anchor={attachMenu} onClose={() => setAttachMenu(null)} side="top" className="w-[220px] p-1.5">
            <MenuItem icon={<FileIcon size={15} />} onClick={() => void attach(false)}>
              Share files
            </MenuItem>
            {canShareFolders && (
              <MenuItem icon={<Folder size={15} />} onClick={() => void attach(true)}>
                Share a folder
              </MenuItem>
            )}
            {canWatch && (
              <>
                <MenuSeparator />
                <MenuItem
                  icon={<Popcorn size={15} />}
                  onClick={() => (setAttachMenu(null), useUI.getState().set({ partyPlanner: { channelId: channel.id, roomId: room.kind === 'voice' ? room.id : undefined } }))}
                >
                  Watch party…
                </MenuItem>
              </>
            )}
          </Popover>
          <textarea
            ref={ta}
            rows={1}
            value={text}
            onChange={(e) => (onChange(e.target.value), setCaret(e.target.selectionStart))}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onPaste={(e) => void onPaste(e)}
            onKeyDown={(e) => {
              if (mentioning && mention) {
                const n = suggestions.length;
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  return setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
                }
                if ((e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) || e.key === 'Tab') {
                  e.preventDefault();
                  return chooseMention(suggestions[Math.min(pick, n - 1)]);
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  return setDismissed(mention.start);
                }
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
              if (e.key === 'Escape' && replyTo) onCancelReply();
            }}
            placeholder={
              slowWait
                ? `Slow mode: you can post again in ${slowLabel(slowWait)}`
                : channel.kind === 'dm'
                  ? `Message ${channel.peer?.name ?? 'your friend'}`
                  : room.kind === 'text'
                    ? `Message #${room.name}${room.slowMode && !canModerateRole(channel.role) ? ` · slow mode ${slowLabel(room.slowMode)}` : ''}`
                    : `Chat in ${room.name}`
            }
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
              <Paperclip size={30} className="text-accent" />
              <div className="font-display text-[17px] font-semibold">Drop to share in #{room.name}</div>
              <div className="text-[12.5px] text-fg-2">Any kind of file. It stays on your device; friends stream it from you.</div>
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
