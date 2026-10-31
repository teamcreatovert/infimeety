import { useEffect, useState } from 'react';
import { create } from 'zustand';

/** Your fun-rule penalties per channel: when your chat ban and voice mute end (ms). */
export const usePenalties = create<Record<string, { chatUntil?: number; voiceUntil?: number }>>()(() => ({}));

export function setPenalty(channelId: string, patch: { chatUntil?: number; voiceUntil?: number }) {
  usePenalties.setState({ [channelId]: { ...usePenalties.getState()[channelId], ...patch } });
}

/** Seconds left until `until`, ticking; 0 once it has passed. */
export function useSecondsLeft(until?: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until || until <= Date.now()) return;
    const tick = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= until) clearInterval(tick);
    }, 250);
    return () => clearInterval(tick);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - Math.max(now, Date.now() - 1000)) / 1000)) : 0;
}

/** 75 → "1:15". */
export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
