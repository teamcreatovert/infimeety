import { appWindow, isTauri } from './platform';
import { useUI } from '@/stores/ui';

type FullscreenVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

/** Full screen for watching (the window, or on an iPhone the system player). */
export async function setImmersive(on: boolean) {
  // iPhones can't make a page full screen, only a video: hand the stage to the system player.
  const video = document.querySelector<FullscreenVideo>('video[data-stage]');
  if (on && !isTauri && !document.documentElement.requestFullscreen && video?.webkitEnterFullscreen) return video.webkitEnterFullscreen();
  useUI.getState().set({ immersive: on });
  await appWindow.setFullscreen(on).catch(() => {});
  // Phones: a shared screen is landscape, so turn with it while full screen.
  const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  if (on) void orientation?.lock?.('landscape').catch(() => {});
  else orientation?.unlock?.();
}

export const toggleImmersive = () => void setImmersive(!useUI.getState().immersive);
