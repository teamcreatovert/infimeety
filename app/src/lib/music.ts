import type { MusicAction, MusicState } from '../../../shared/protocol';
import { serverNow } from './party';
import { getHub } from './realtime';
import { useChannels } from '@/stores/channels';
import { useVoice } from '@/stores/voice';

/**
 * Music in a voice room: a shared queue of YouTube videos that the hub keeps, played by each
 * person's own YouTube player (the official embed, which YouTube requires to stay visible) and
 * kept in step with everyone else's.
 */

/** The music in the voice room you're in. */
export function useRoomMusic(): MusicState | undefined {
  const channelId = useVoice((s) => s.channelId);
  const roomId = useVoice((s) => s.roomId);
  return useChannels((s) => (channelId && roomId ? s.voice[channelId]?.music?.[roomId] : undefined));
}

/** Where the song should be now, in seconds. */
export const musicPosition = (s: MusicState, now = serverNow()) => (s.playing ? s.position + Math.max(0, now - s.at) / 1000 : s.position);

const hub = () => {
  const id = useVoice.getState().channelId;
  return id ? getHub(id) : undefined;
};

export const addMusic = (videoId: string) => hub()?.send({ t: 'music.add', videoId });
export const controlMusic = (action: MusicAction) => hub()?.send({ t: 'music.control', ...action });

const VIDEO_ID = /^[\w-]{11}$/;

/** The video in a YouTube or YouTube Music link (watch, youtu.be, shorts, embed, live), or a bare id. */
export function youtubeId(text: string): string | null {
  const t = text.trim();
  if (VIDEO_ID.test(t)) return t;
  try {
    const url = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    const host = url.hostname.replace(/^(www|m)\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.slice(1, 12);
      return VIDEO_ID.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
      const v = url.searchParams.get('v');
      if (v && VIDEO_ID.test(v)) return v;
      return url.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/)?.[1] ?? null;
    }
  } catch {
    /* not a link */
  }
  return null;
}
