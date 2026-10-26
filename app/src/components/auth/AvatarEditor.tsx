import { motion } from 'motion/react';
import { Camera, RotateCcw, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import type { Me } from '../../../../shared/protocol';
import { Avatar } from '../ui/Avatar';
import { Button, Spinner } from '../ui/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { toast } from '@/stores/ui';

/** Square-crops and shrinks still images; GIFs upload as-is so they stay animated. */
export async function prepareAvatar(file: File): Promise<{ body: Blob; type: string }> {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error('Use a PNG, JPG, GIF or WebP image.');
  if (file.type === 'image/gif') {
    if (file.size > 4 * 1024 * 1024) throw new Error('GIFs need to be under 4 MB.');
    return { body: file, type: file.type };
  }
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const out = Math.min(512, side);
  const canvas = new OffscreenCanvas(out, out);
  canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, out, out);
  return { body: await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 }), type: 'image/webp' };
}

const providerName = (me: Me) => (me.providers.includes('google') ? 'Google' : me.providers.includes('discord') ? 'Discord' : 'original');

export function AvatarEditor({ size = 104 }: { size?: number }) {
  const me = useAuth((s) => s.me);
  const setMe = useAuth((s) => s.setMe);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  if (!me) return null; // signed out while a sheet is still animating closed

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const { body, type } = await prepareAvatar(file);
      setMe(await api<Me>('/me/avatar', { method: 'PUT', body, headers: { 'Content-Type': type } }));
    } catch (err) {
      toast({ kind: 'error', title: "Couldn't update your photo", body: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const useProvider = async () => {
    setBusy(true);
    try {
      setMe(await api<Me>('/me', { method: 'PATCH', json: { useProviderAvatar: true } }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={() => input.current?.click()} className="group relative rounded-full" aria-label="Change photo">
        <Avatar user={me} size={size} />
        <span className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
          {busy ? <Spinner size={22} /> : <Camera size={22} />}
        </span>
        {busy && (
          <span className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white">
            <Spinner size={22} />
          </span>
        )}
      </motion.button>
      <div className="flex gap-2">
        <Button size="sm" icon={<Upload size={13} />} onClick={() => input.current?.click()} disabled={busy}>
          Upload photo or GIF
        </Button>
        {me.hasCustomAvatar && me.providerAvatarUrl && (
          <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => void useProvider()} disabled={busy}>
            Use {providerName(me)} photo
          </Button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void upload(f);
        }}
      />
    </div>
  );
}
