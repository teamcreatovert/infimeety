import { Channel, invoke } from '@tauri-apps/api/core';
import { isTauri, isWindows } from './platform';
import { getHub } from './realtime';
import { useSettings } from '@/stores/settings';
import { useVoice } from '@/stores/voice';

/**
 * Spoken fun rules (Windows app): while you're in a call, Windows' speech recognizer listens
 * on this PC for the channel's rule words only (src-tauri/src/voice_words.rs). A word heard
 * while your mic is live is reported to the hub, which applies the rule like a typed one.
 */

let listening = '';

export async function listenForWords(channelId: string, words: string[]) {
  if (!isTauri || !isWindows) return;
  const key = `${channelId}|${words.join(',')}`;
  if (key === listening) return;
  listening = key;
  if (!words.length) return void invoke('voice_words_stop').catch(() => {});
  const heard = new Channel<string>();
  heard.onmessage = (word) => {
    const v = useVoice.getState();
    // Only what friends could actually hear counts.
    if (v.channelId !== channelId || v.muted || v.deafened || v.serverMuted) return;
    if (useSettings.getState().voiceInputMode === 'ptt' && !v.pttActive) return;
    getHub(channelId)?.send({ t: 'voice.said', word });
  };
  try {
    await invoke('voice_words_start', { words, onWord: heard });
  } catch (err) {
    // No speech recognizer for this PC's language: spoken rules just don't apply here.
    listening = '';
    console.info('Spoken rules are off:', err);
  }
}

// Leaving the call stops listening.
useVoice.subscribe((s, prev) => {
  if (prev.channelId && !s.channelId && listening) {
    listening = '';
    void invoke('voice_words_stop').catch(() => {});
  }
});
