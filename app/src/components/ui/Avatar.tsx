import { motion } from 'motion/react';
import { useState } from 'react';
import type { PublicUser } from '../../../../shared/protocol';
import { gradientFor, initials } from '@/lib/format';

export function Avatar({
  user,
  size = 32,
  speaking,
  presence,
  className,
}: {
  user?: Pick<PublicUser, 'id' | 'name' | 'avatarUrl'> | null;
  size?: number;
  speaking?: boolean;
  presence?: 'online' | 'offline' | null;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = user?.avatarUrl && user.avatarUrl !== failedUrl ? user.avatarUrl : null;
  const dot = Math.max(8, Math.round(size * 0.3));

  return (
    <div className={className} style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <motion.div
        className="h-full w-full overflow-hidden rounded-full"
        style={{ background: url ? 'var(--fill-2)' : gradientFor(user?.id ?? '?') }}
        animate={{
          boxShadow: speaking
            ? '0 0 0 2px var(--success), 0 0 16px color-mix(in srgb, var(--success) 55%, transparent)'
            : '0 0 0 0px rgba(0,0,0,0), 0 0 0px rgba(0,0,0,0)',
        }}
        transition={{ duration: 0.16 }}
      >
        {url ? (
          <img src={url} alt="" draggable={false} referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} className="h-full w-full object-cover" />
        ) : (
          <span className="grid h-full w-full place-items-center font-semibold text-white" style={{ fontSize: size * 0.38, letterSpacing: '-0.02em' }}>
            {initials(user?.name ?? '?')}
          </span>
        )}
      </motion.div>
      {presence && (
        <span
          className="absolute rounded-full"
          style={{
            width: dot,
            height: dot,
            right: -1,
            bottom: -1,
            background: presence === 'online' ? 'var(--success)' : 'var(--fg-3)',
            boxShadow: '0 0 0 2.5px var(--ring-bg)',
          }}
        />
      )}
    </div>
  );
}
