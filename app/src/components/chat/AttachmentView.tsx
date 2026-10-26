import { motion } from 'motion/react';
import { Check, CloudOff, Download, File, FileArchive, FileCode, FileSpreadsheet, FileText, Film, ImageOff, Play, RotateCw, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Attachment } from '../../../../shared/protocol';
import { Spinner } from '../ui/primitives';
import { formatBytes } from '@/lib/format';
import { saveFile } from '@/lib/platform';
import { getHub } from '@/lib/realtime';
import { requestMedia, resolveOwn } from '@/lib/transfer';
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

const isMedia = (mime: string) => /^(image|video|audio)\//.test(mime);

export function AttachmentView({ att, channelId }: { att: Attachment; channelId: string }) {
  return isMedia(att.mime) ? <MediaView att={att} channelId={channelId} /> : <FileView att={att} channelId={channelId} />;
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
  const ext = att.name.split('.').pop()?.toLowerCase() ?? '';
  if (/zip|rar|7z|tar|gz|bz2|xz/.test(ext) || /zip|compressed|archive/.test(att.mime)) return FileArchive;
  if (/^(xlsx?|csv|ods|numbers)$/.test(ext)) return FileSpreadsheet;
  if (/^(js|ts|tsx|jsx|py|rs|go|java|c|cpp|h|cs|rb|php|html|css|json|xml|ya?ml|sh|sql|md)$/.test(ext)) return FileCode;
  if (/^(pdf|docx?|odt|rtf|txt|pptx?|key|pages)$/.test(ext) || att.mime.startsWith('text/')) return FileText;
  return File;
}

/**
 * Any other file (documents, archives, apps…): a card with its name and size. Nothing streams
 * until someone asks for it; then it comes peer-to-peer from the sender and is saved.
 */
function FileView({ att, channelId }: { att: Attachment; channelId: string }) {
  const entry = useMedia((s) => s.items[att.id]);
  const owner = useChannels((s) => s.users[att.ownerId]);
  const meId = useAuth((s) => s.me?.id);
  const mine = att.ownerId === meId;
  const status = att.removed ? 'gone' : (entry?.status ?? 'idle');
  const ownerName = owner?.name ?? 'the sender';
  const [saved, setSaved] = useState(false);
  const saveWhenReady = useRef(false);
  const Icon = fileIcon(att);

  const save = async (blob: Blob) => {
    try {
      if (await saveFile(att.name, blob)) setSaved(true);
    } catch {
      /* the save dialog was closed or the disk refused; the Save button stays */
    }
  };

  const download = () => {
    if (entry?.blob) return void save(entry.blob);
    const hub = getHub(channelId);
    if (!hub) return;
    saveWhenReady.current = true;
    useMedia.getState().setEntry(att.id, { status: 'idle', progress: 0 });
    setTimeout(() => requestMedia(hub, att), 0);
  };

  useEffect(() => {
    if (status === 'ready' && entry?.blob && saveWhenReady.current) {
      saveWhenReady.current = false;
      void save(entry.blob);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, entry?.blob]);

  const progress = entry?.progress ?? 0;
  const detail = mine
    ? `${formatBytes(att.size)} · on this device`
    : status === 'requesting'
      ? `Connecting to ${ownerName}…`
      : status === 'loading'
        ? `${Math.round(progress * 100)}% of ${formatBytes(att.size)}`
        : status === 'offline'
          ? `${ownerName} is offline. Files come from their device while they’re online.`
          : status === 'gone'
            ? `${mine ? 'You' : ownerName} deleted this file`
            : status === 'error'
              ? 'Couldn’t download it'
              : status === 'ready'
                ? saved
                  ? 'Saved'
                  : formatBytes(att.size)
                : `${formatBytes(att.size)} · from ${ownerName}`;

  const busy = status === 'requesting' || status === 'loading';
  const action = mine || status === 'gone' ? null : busy ? (
    <Spinner className="text-fg-2" />
  ) : status === 'offline' || status === 'error' ? (
    <button onClick={download} className="flex items-center gap-1 rounded-full bg-fill-2 px-3 py-1.5 text-[12px] font-medium hover:bg-fill-3">
      <RotateCw size={12} /> Try again
    </button>
  ) : (
    <button
      onClick={download}
      className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:brightness-110"
    >
      {saved ? <Check size={13} /> : <Download size={13} />}
      {status === 'ready' ? (saved ? 'Save again' : 'Save') : 'Download'}
    </button>
  );

  return (
    <div className="relative flex w-[340px] max-w-full items-center gap-3 overflow-hidden rounded-[14px] bg-fill-1 p-3 shadow-[inset_0_0_0_0.5px_var(--hairline-strong)]">
      {busy && <div className="shimmer absolute inset-0 opacity-60" />}
      <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-[var(--glass-pop)] text-accent shadow-[inset_0_0_0_0.5px_var(--hairline-strong)]">
        {status === 'gone' ? <Trash2 size={18} className="text-fg-3" /> : status === 'offline' ? <CloudOff size={18} className="text-fg-3" /> : <Icon size={19} />}
      </span>
      <span className="relative min-w-0 flex-1">
        <span className={`block truncate text-[13px] font-medium ${status === 'gone' ? 'text-fg-3 line-through' : ''}`}>{att.name}</span>
        <span className="block text-[11.5px] leading-snug text-fg-3">{detail}</span>
      </span>
      <span className="relative shrink-0">{action}</span>
      {status === 'loading' && (
        <div className="absolute inset-x-3 bottom-1.5 h-[3px] overflow-hidden rounded-full bg-fill-2">
          <motion.div className="h-full rounded-full bg-accent" animate={{ width: `${Math.round(progress * 100)}%` }} transition={{ duration: 0.2 }} />
        </div>
      )}
    </div>
  );
}
