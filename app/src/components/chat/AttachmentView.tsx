import { motion } from 'motion/react';
import { Check, CloudOff, Download, File, FileArchive, FileCode, FileSpreadsheet, FileText, Film, Folder, FolderOpen, ImageOff, Play, RotateCw, Trash2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Attachment } from '../../../../shared/protocol';
import { Spinner } from '../ui/primitives';
import { formatBytes } from '@/lib/format';
import { DOWNLOAD_PAGE } from '@/config';
import { isTauri, localMedia } from '@/lib/platform';
import { getHub } from '@/lib/realtime';
import { cancelCopy, copyFile, requestMedia, resolveOwn } from '@/lib/transfer';
import { FOLDER_MIME } from '@/lib/webMedia';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { useMedia } from '@/stores/media';
import { useUI } from '@/stores/ui';

const AUTO_LOAD_LIMIT = 30 * 1024 * 1024;

function boxSize(att: Attachment, max = 340, maxH = 300) {
  if (!att.width || !att.height) return { width: 300, height: att.mime.startsWith('audio/') ? 64 : 190 };
  const scale = Math.min(1, max / att.width, maxH / att.height);
  return { width: Math.max(140, Math.round(att.width * scale)), height: Math.max(90, Math.round(att.height * scale)) };
}

/** Shown inline (and streamed into memory) only when small enough; a movie is a file to copy. */
const INLINE_LIMIT = 100 * 1024 * 1024;
const isInline = (att: Attachment) =>
  /^(image|video|audio)\//.test(att.mime) && att.size <= INLINE_LIMIT && !/matroska|x-msvideo|avi/.test(att.mime) && !/\.(mkv|avi)$/i.test(att.name);

export function AttachmentView({ att, channelId }: { att: Attachment; channelId: string }) {
  return isInline(att) ? <MediaView att={att} channelId={channelId} /> : <FileView att={att} channelId={channelId} />;
}

function MediaView({ att, channelId }: { att: Attachment; channelId: string }) {
  const entry = useMedia((s) => s.items[att.id]);
  const owner = useChannels((s) => s.users[att.ownerId]);
  const meId = useAuth((s) => s.me?.id);
  const mine = att.ownerId === meId;
  const ref = useRef<HTMLDivElement>(null);
  const status = att.removed ? 'gone' : (entry?.status ?? 'idle');
  const kind = att.mime.startsWith('image/') ? 'image' : att.mime.startsWith('video/') ? 'video' : 'audio';
  const size = boxSize(att);
  const ownerName = mine ? 'you' : (owner?.name ?? 'the sender');

  const load = () => {
    const hub = getHub(channelId);
    if (!hub) return;
    if (mine) void resolveOwn(hub, att);
    else requestMedia(hub, att);
  };

  // Own files always resolve from disk; small images auto-stream when scrolled into view.
  useEffect(() => {
    if (status !== 'idle' || att.removed) return;
    if (mine) return load();
    if (kind !== 'image' || att.size > AUTO_LOAD_LIMIT) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        io.disconnect();
        load();
      }
    });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, att.id]);

  const retry = () => {
    useMedia.getState().setEntry(att.id, { status: 'idle', progress: 0 });
    setTimeout(load, 0);
  };

  if (status === 'ready' && entry?.url) {
    if (kind === 'image')
      return (
        <motion.img
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          src={entry.url}
          alt={att.name}
          draggable={false}
          onClick={() => useUI.getState().set({ lightbox: { src: entry.url!, kind: 'image', name: att.name } })}
          className="cursor-zoom-in rounded-[14px] object-cover shadow-[0_0_0_0.5px_var(--hairline-strong)]"
          style={size}
        />
      );
    if (kind === 'video')
      return <video src={entry.url} controls playsInline className="rounded-[14px] bg-black shadow-[0_0_0_0.5px_var(--hairline-strong)]" style={{ ...size, maxWidth: 420 }} />;
    return <audio src={entry.url} controls className="w-[300px] max-w-full" />;
  }

  const card = (icon: React.ReactNode, title: string, detail: string, action?: React.ReactNode) => (
    <div ref={ref} className="relative grid place-items-center overflow-hidden rounded-[14px] bg-fill-1 shadow-[inset_0_0_0_0.5px_var(--hairline-strong)]" style={size}>
      {(status === 'requesting' || status === 'loading') && <div className="shimmer absolute inset-0" />}
      <div className="relative flex flex-col items-center gap-1.5 px-4 text-center">
        {icon}
        <div className="text-[12.5px] font-medium">{title}</div>
        <div className="text-[11.5px] text-fg-3">{detail}</div>
        {action}
      </div>
      {status === 'loading' && (
        <div className="absolute inset-x-3 bottom-3 h-1 overflow-hidden rounded-full bg-fill-2">
          <motion.div className="h-full rounded-full bg-accent" animate={{ width: `${Math.round((entry?.progress ?? 0) * 100)}%` }} transition={{ duration: 0.2 }} />
        </div>
      )}
    </div>
  );

  const retryButton = (
    <button onClick={retry} className="mt-1 flex items-center gap-1 rounded-full bg-fill-2 px-2.5 py-1 text-[11.5px] font-medium hover:bg-fill-3">
      <RotateCw size={11} /> Try again
    </button>
  );

  switch (status) {
    case 'gone':
      return card(<Trash2 size={20} className="text-fg-3" />, 'Removed', `${mine ? 'You' : (owner?.name ?? 'The sender')} deleted this file`);
    case 'offline':
      return card(<CloudOff size={20} className="text-fg-3" />, `${owner?.name ?? 'The sender'} is offline`, 'Media streams from their PC while they’re online', retryButton);
    case 'error':
      return card(<ImageOff size={20} className="text-fg-3" />, "Couldn't load", att.name, retryButton);
    case 'requesting':
      return card(<Spinner className="text-fg-2" />, `Connecting to ${ownerName}…`, formatBytes(att.size));
    case 'loading':
      return card(<Spinner className="text-fg-2" />, `Streaming from ${ownerName}`, `${Math.round((entry?.progress ?? 0) * 100)}% of ${formatBytes(att.size)}`);
    default:
      return (
        <button ref={ref as never} onClick={load} className="group relative grid place-items-center overflow-hidden rounded-[14px] bg-fill-1 shadow-[inset_0_0_0_0.5px_var(--hairline-strong)] transition-colors hover:bg-fill-2" style={size}>
          <div className="flex flex-col items-center gap-2 px-4 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-[var(--glass-pop)] shadow-[0_4px_14px_rgba(0,0,0,0.25)] transition-transform group-hover:scale-105">
              {kind === 'video' ? <Play size={18} className="ml-0.5" fill="currentColor" /> : <Film size={18} />}
            </span>
            <span className="max-w-[240px] truncate text-[12.5px] font-medium">{att.name}</span>
            <span className="text-[11.5px] text-fg-3">
              {formatBytes(att.size)} · {mine ? 'on this PC' : `from ${ownerName}`}
            </span>
          </div>
        </button>
      );
  }
}

function fileIcon(att: Attachment) {
  if (att.mime === FOLDER_MIME) return Folder;
  const ext = att.name.split('.').pop()?.toLowerCase() ?? '';
  if (/zip|rar|7z|tar|gz|bz2|xz/.test(ext) || /zip|compressed|archive/.test(att.mime)) return FileArchive;
  if (/^(xlsx?|csv|ods|numbers)$/.test(ext)) return FileSpreadsheet;
  if (/^(js|ts|tsx|jsx|py|rs|go|java|c|cpp|h|cs|rb|php|html|css|json|xml|ya?ml|sh|sql|md)$/.test(ext)) return FileCode;
  if (/^(pdf|docx?|odt|rtf|txt|pptx?|key|pages)$/.test(ext) || att.mime.startsWith('text/')) return FileText;
  if (/^(mkv|mp4|avi|mov|webm|m4v)$/.test(ext)) return Film;
  return File;
}

/** "12.4 MB/s · 1 min left" */
export function pace(speed: number | undefined, left: number) {
  if (!speed) return '';
  const secs = left / speed;
  const eta = secs < 60 ? `${Math.max(1, Math.round(secs))} s left` : secs < 3600 ? `${Math.round(secs / 60)} min left` : `${(secs / 3600).toFixed(1)} h left`;
  return ` · ${formatBytes(speed)}/s · ${eta}`;
}

/** Copies of big files: worth pointing out the app, which writes straight to disk at full speed. */
const APP_HINT_SIZE = 200 * 1024 * 1024;

/**
 * Any other file or folder (documents, archives, movies…): a card with its name and size.
 * Nothing streams until someone copies it; then it comes peer-to-peer from the sender, over
 * several connections at once, straight into the save folder.
 */
function FileView({ att, channelId }: { att: Attachment; channelId: string }) {
  const entry = useMedia((s) => s.items[att.id]);
  const owner = useChannels((s) => s.users[att.ownerId]);
  const meId = useAuth((s) => s.me?.id);
  const mine = att.ownerId === meId;
  const status = att.removed ? 'gone' : (entry?.status ?? 'idle');
  const ownerName = owner?.name ?? 'the sender';
  const folder = att.mime === FOLDER_MIME;
  const Icon = fileIcon(att);

  const copy = () => {
    const hub = getHub(channelId);
    if (hub) void copyFile(hub, att);
  };

  const progress = entry?.progress ?? 0;
  const busy = status === 'requesting' || status === 'waiting' || status === 'loading' || status === 'saving';
  const kind = folder ? 'Folder' : formatBytes(att.size);
  const detail = mine
    ? `${folder ? `Folder · ${formatBytes(att.size)}` : formatBytes(att.size)} · on this device`
    : status === 'requesting'
      ? `Connecting to ${ownerName}…`
      : status === 'waiting'
        ? `${ownerName} is sending to others first. You’re next.`
        : status === 'loading'
          ? `${Math.round(progress * 100)}% of ${formatBytes(att.size)}${pace(entry?.speed, att.size * (1 - progress))}`
          : status === 'saving'
            ? folder
              ? 'Unpacking the folder…'
              : 'Saving…'
            : status === 'offline'
              ? `${ownerName} is offline. Files come from their device while they’re online.`
              : status === 'gone'
                ? `${mine ? 'You' : ownerName} deleted this ${folder ? 'folder' : 'file'}`
                : status === 'error'
                  ? (entry?.problem ?? 'Couldn’t copy it')
                  : status === 'ready'
                    ? `Saved${entry?.where ? ` to ${entry.where}` : ''}`
                    : `${folder ? `Folder · ${formatBytes(att.size)}` : kind} · from ${ownerName}`;

  const button = (label: string, icon: React.ReactNode, onClick: () => void, primary = false) => (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-semibold ${primary ? 'bg-accent text-white hover:brightness-110' : 'bg-fill-2 hover:bg-fill-3'}`}
    >
      {icon}
      {label}
    </button>
  );

  const action =
    mine || status === 'gone'
      ? null
      : busy
        ? status === 'saving'
          ? <Spinner className="text-fg-2" />
          : button('Cancel', <X size={12} />, () => cancelCopy(att.id))
        : status === 'offline' || status === 'error'
          ? button('Try again', <RotateCw size={12} />, copy)
          : status === 'ready'
            ? entry?.savedId && isTauri
              ? button('Show in folder', <FolderOpen size={13} />, () => void localMedia.reveal(entry.savedId!))
              : <Check size={18} className="text-success" />
            : button('Copy', <Download size={13} />, copy, true);

  return (
    <div className="relative w-[360px] max-w-full overflow-hidden rounded-[14px] bg-fill-1 p-3 shadow-[inset_0_0_0_0.5px_var(--hairline-strong)]">
      {busy && <div className="shimmer absolute inset-0 opacity-50" />}
      <div className="relative flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-[var(--glass-pop)] text-accent shadow-[inset_0_0_0_0.5px_var(--hairline-strong)]">
          {status === 'gone' ? <Trash2 size={18} className="text-fg-3" /> : status === 'offline' ? <CloudOff size={18} className="text-fg-3" /> : <Icon size={19} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[13px] font-medium ${status === 'gone' ? 'text-fg-3 line-through' : ''}`}>{att.name}</span>
          <span className="block text-[11.5px] leading-snug text-fg-3">{detail}</span>
        </span>
        <span className="shrink-0">{action}</span>
      </div>
      {status === 'loading' && (
        <div className="relative mt-2.5 h-[3px] overflow-hidden rounded-full bg-fill-2">
          <motion.div className="h-full rounded-full bg-accent" animate={{ width: `${Math.round(progress * 100)}%` }} transition={{ duration: 0.3 }} />
        </div>
      )}
      {!isTauri && !mine && att.size >= APP_HINT_SIZE && (status === 'idle' || busy) && (
        <a href={DOWNLOAD_PAGE} target="_blank" rel="noopener" className="relative mt-2 block text-[11.5px] text-fg-3 hover:text-accent">
          Big copies are faster in the Infimeety app →
        </a>
      )}
    </div>
  );
}
