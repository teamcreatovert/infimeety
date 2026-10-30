import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from './platform';
import { voice } from './voice/engine';
import { useSettings } from '@/stores/settings';
import { toast } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

/**
 * Push to talk. The desktop app watches the key system-wide (ptt.rs), so it works while a game
 * is in front, like Discord: the game still gets the key too, which is why a key the game
 * doesn't use (a mouse side button) is best. Where that can't run (the browser, a Mac without
 * the Accessibility permission, Linux without X11) Infimeety listens in its own window only.
 */

let systemWide = false;
let release: ReturnType<typeof setTimeout> | undefined;

function hold(down: boolean) {
  clearTimeout(release);
  if (down) return voice.setPttActive(true);
  // A short tail so the end of a word isn't cut off.
  release = setTimeout(() => voice.setPttActive(false), useSettings.getState().pttReleaseDelay ?? 150);
}

/** The key as the settings name it: a KeyboardEvent.code, or "Mouse3"…"Mouse5". */
const pressed = (e: KeyboardEvent | MouseEvent) => ('code' in e ? e.code || e.key : `Mouse${e.button + 1}`);

function inWindow(e: KeyboardEvent | MouseEvent, down: boolean) {
  const s = useSettings.getState();
  if (systemWide || s.voiceInputMode !== 'ptt' || !voice.inCall || pressed(e) !== s.pttKey) return;
  const target = e.target as HTMLElement | null;
  if (down && 'code' in e && target?.closest?.('input, textarea, [contenteditable="true"]')) return;
  if (!('code' in e)) e.preventDefault(); // the side buttons would otherwise go back and forward
  hold(down);
}

export function startPushToTalk() {
  window.addEventListener('keydown', (e) => !e.repeat && inWindow(e, true));
  window.addEventListener('keyup', (e) => inWindow(e, false));
  window.addEventListener('mousedown', (e) => e.button > 1 && inWindow(e, true));
  window.addEventListener('mouseup', (e) => e.button > 1 && inWindow(e, false));
  // Leaving the window lets go, unless the key is watched system-wide.
  window.addEventListener('blur', () => !systemWide && useSettings.getState().voiceInputMode === 'ptt' && hold(false));

  if (!isTauri) return;
  void listen<boolean>('ptt', (e) => systemWide && hold(e.payload));

  let watching: string | null = null;
  let warned = false;
  const sync = async () => {
    const s = useSettings.getState();
    const key = s.voiceInputMode === 'ptt' && useVoice.getState().roomId ? s.pttKey : null;
    if (key === watching) return;
    watching = key;
    const ok = await invoke<boolean>('ptt_watch', { key }).catch(() => false);
    systemWide = !!key && ok;
    if (key && !ok && !warned) {
      warned = true;
      toast({
        kind: 'info',
        title: 'Push to talk works in Infimeety’s window only',
        body: navigator.userAgent.includes('Mac')
          ? 'To use it in games and other apps, allow Infimeety in System Settings → Privacy & Security → Accessibility.'
          : 'This system doesn’t let apps watch keys outside their window.',
      });
    }
    if (!key) hold(false);
  };
  useSettings.subscribe((s, prev) => (s.voiceInputMode !== prev.voiceInputMode || s.pttKey !== prev.pttKey) && void sync());
  useVoice.subscribe((s, prev) => s.roomId !== prev.roomId && void sync());
}
