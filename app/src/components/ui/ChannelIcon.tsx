import clsx from 'clsx';
import type { CSSProperties } from 'react';
import type { Channel } from '../../../../shared/protocol';
import { channelGradient } from '@/lib/format';

/** A channel's picture, or its emoji on its colour. Fills its box; the parent sets size and corners. */
export function ChannelIcon({ channel, className, style }: { channel: Pick<Channel, 'emoji' | 'color' | 'iconUrl'>; className?: string; style?: CSSProperties }) {
  if (channel.iconUrl)
    return <img src={channel.iconUrl} alt="" draggable={false} className={clsx('h-full w-full object-cover', className)} style={style} />;
  return (
    <span className={clsx('emoji grid h-full w-full place-items-center', className)} style={{ background: channelGradient(channel.color), ...style }}>
      {channel.emoji}
    </span>
  );
}
