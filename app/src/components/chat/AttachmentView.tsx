import { motion } from 'motion/react';
import { CloudOff, Film, ImageOff, Play, RotateCw, Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Attachment } from '../../../../shared/protocol';
import { Spinner } from '../ui/primitives';
import { formatBytes } from '@/lib/format';
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

export function AttachmentView({ att, channelId }: { att: Attachment; channelId: string }) {
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
    return <audio src={entry.url} controls className="w-[300px]" />;
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
