import { usePenalties } from './penalties';
import { isMac, isTauri } from './platform';
import { listDevices, voice } from './voice/engine';
import { canShareNatively } from './voice/nativeScreen';
import { useChannels } from '@/stores/channels';
import { useSettings } from '@/stores/settings';
import { useUI } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

/**
 * Fixer, the built-in troubleshooting bot. "@Fixer my mic doesn't work" is answered by this
 * device, privately: it checks what it can see here (permissions, devices, mute and deafen,
 * sound, the call's connections) and offers one-click fixes. No AI, no waiting.
 */

export const FIXER_ID = 'bot-fixer';

export interface Fix {
  label: string;
  /** Does it; returns what happened. */
  run: () => Promise<string> | string;
}

export interface Finding {
  level: 'ok' | 'problem' | 'info';
  text: string;
  fix?: Fix;
}

export interface FixerReport {
  intro: string;
  findings: Finding[];
}

type Topic = 'mic' | 'hearing' | 'camera' | 'screen' | 'connection';

const TOPICS: [Topic, RegExp][] = [
  ['screen', /screen|share|sharing|stream|live/i],
  ['camera', /camera|cam\b|webcam|video/i],
  ['mic', /\bmic|microphone|can'?t hear me|cannot hear me|hear me|talk|speak|my voice|mute/i],
  ['hearing', /deaf|hear|sound|audio|speaker|headphone|volume|quiet|loud|silent/i],
  ['connection', /lag|connect|disconnect|join|drop|freez|stuck|slow|ping|kick/i],
];

const permission = async (name: 'microphone' | 'camera') => {
  try {
    return (await navigator.permissions.query({ name: name as PermissionName })).state;
  } catch {
    return 'prompt';
  }
};

/** How loud your mic is over about a second (0 when nothing comes through). */
async function micLevel() {
  let peak = 0;
  for (let i = 0; i < 10; i++) {
    peak = Math.max(peak, voice.micLevel());
    await new Promise((r) => setTimeout(r, 100));
  }
  return peak;
}

async function checkMic(): Promise<Finding[]> {
  const v = useVoice.getState();
  const s = useSettings.getState();
  const out: Finding[] = [];
  const muteUntil = v.channelId ? usePenalties.getState()[v.channelId]?.voiceUntil : undefined;
  if (muteUntil && muteUntil > Date.now()) out.push({ level: 'problem', text: 'A fun rule muted you. It lifts by itself when the countdown on your mic button ends, or a moderator can lift it.' });
  else if (v.serverMuted) out.push({ level: 'problem', text: 'An admin or moderator muted you, so nobody hears you. Ask them to unmute you.' });
  if (v.deafened) out.push({ level: 'problem', text: 'You’re deafened, which also mutes your mic.', fix: { label: 'Undeafen', run: () => (voice.toggleDeafen(), 'Undeafened. Your mic is back on.') } });
  else if (v.muted) out.push({ level: 'problem', text: 'You’re muted.', fix: { label: 'Unmute', run: async () => (await voice.toggleMute(), 'Unmuted.') } });
  const blocked: Finding[] = [];
  if ((await permission('microphone')) === 'denied')
    blocked.push({
      level: 'problem',
      text: isTauri
        ? 'Windows isn’t letting Infimeety use your microphone. Open Windows Settings, Privacy and security, Microphone, and turn on "Let desktop apps access your microphone".'
        : 'This browser blocked the microphone. Click the lock next to the address and allow the microphone, then reload.',
    });
  const { inputs } = await listDevices().catch(() => ({ inputs: [] as { id: string; label: string }[] }));
  if (!inputs.length) out.push({ level: 'problem', text: 'I can’t find any microphone. Plug one in, or check it’s switched on.' });
  else if (s.inputDeviceId !== 'default' && !inputs.some((d) => d.id === s.inputDeviceId))
    out.push({
      level: 'problem',
      text: 'The microphone picked in Settings isn’t connected anymore.',
      fix: { label: 'Use the default mic', run: async () => (useSettings.getState().set({ inputDeviceId: 'default' }), await voice.restartMic(), 'Switched to your default microphone.') },
    });
  if (s.voiceInputMode === 'ptt') out.push({ level: 'info', text: 'Push to talk is on: friends only hear you while you hold your key.', fix: { label: 'Use voice activity', run: () => (useSettings.getState().set({ voiceInputMode: 'activity' }), 'Your mic now opens when you speak.') } });
  if (v.channelId && !v.muted && !v.deafened && !v.serverMuted) {
    const level = await micLevel();
    if (level < 0.004)
      out.push({
        level: 'problem',
        text: 'Your mic is on, but no sound is coming through it. If you were talking just now, restart it.',
        fix: { label: 'Restart the mic', run: async () => (await voice.restartMic(), 'Restarted your microphone. Say something to check.') },
      });
    else return [...out, { level: 'ok', text: 'Your mic is working: I can see your voice coming through.' }];
  }
  // Sound coming through means it isn't blocked after all, whatever the browser reports.
  return [...blocked, ...out];
}

async function checkHearing(): Promise<Finding[]> {
  const v = useVoice.getState();
  const s = useSettings.getState();
  const out: Finding[] = [];
  if (v.deafened) out.push({ level: 'problem', text: 'You’re deafened, so you can’t hear anyone.', fix: { label: 'Undeafen', run: () => (voice.toggleDeafen(), 'Undeafened.') } });
  if (v.audioBlocked) out.push({ level: 'problem', text: 'Sound for the call hasn’t started yet.', fix: { label: 'Turn sound on', run: async () => (await voice.resumeAudio(), 'Sound is on.') } });
  if (s.outputVolume < 0.05) out.push({ level: 'problem', text: 'Your call volume is all the way down.', fix: { label: 'Set it to 100%', run: () => (useSettings.getState().set({ outputVolume: 1 }), 'Call volume is back to 100%.') } });
  const { outputs } = await listDevices().catch(() => ({ outputs: [] as { id: string; label: string }[] }));
  if (s.outputDeviceId !== 'default' && outputs.length && !outputs.some((d) => d.id === s.outputDeviceId))
    out.push({ level: 'problem', text: 'The speakers picked in Settings aren’t connected anymore.', fix: { label: 'Use default speakers', run: () => (useSettings.getState().set({ outputDeviceId: 'default' }), 'Switched to your default speakers.') } });
  const users = useChannels.getState().users;
  const inCall = v.channelId ? (useChannels.getState().voice[v.channelId]?.participants ?? []) : [];
  for (const p of inCall) {
    if (s.localMutes[p.userId])
      out.push({ level: 'problem', text: `You muted ${users[p.userId]?.name ?? 'someone'} for yourself.`, fix: { label: 'Unmute them', run: () => (useSettings.getState().toggleLocalMute(p.userId), `You can hear ${users[p.userId]?.name ?? 'them'} again.`) } });
    else if ((s.userVolumes[p.userId] ?? 1) < 0.05)
      out.push({ level: 'problem', text: `${users[p.userId]?.name ?? 'Someone'}’s volume is turned all the way down.`, fix: { label: 'Reset their volume', run: () => (useSettings.getState().setUserVolume(p.userId, 1), 'Their volume is back to 100%.') } });
  }
  if (!out.length && v.channelId) out.push({ level: 'info', text: 'Everything on your side looks right. If one person is quiet, their mic may be the problem: ask them to write @Fixer too.' });
  return out;
}

async function checkCamera(): Promise<Finding[]> {
  const v = useVoice.getState();
  const out: Finding[] = [];
  if ((await permission('camera')) === 'denied')
    out.push({ level: 'problem', text: isTauri ? 'Windows isn’t letting Infimeety use your camera. Open Windows Settings, Privacy and security, Camera, and turn on access for desktop apps.' : 'This browser blocked the camera. Allow it from the lock next to the address.' });
  const { cameras } = await listDevices().catch(() => ({ cameras: [] as { id: string; label: string }[] }));
  if (!cameras.length) out.push({ level: 'problem', text: 'I can’t find a camera.' });
  if (v.camera) out.push({ level: 'info', text: 'Your camera is on. If the picture is frozen or black, restart it.', fix: { label: 'Restart the camera', run: async () => (voice.stopCamera(), await voice.toggleCamera(), 'Restarted your camera.') } });
  else if (v.channelId && cameras.length) out.push({ level: 'info', text: 'Your camera is off.', fix: { label: 'Turn it on', run: async () => (await voice.toggleCamera(), 'Camera on.') } });
  out.push({ level: 'info', text: 'If another app (Zoom, Teams, OBS) is using the camera, close it and try again.' });
  return out;
}

async function checkScreen(): Promise<Finding[]> {
  const v = useVoice.getState();
  const s = useSettings.getState();
  const out: Finding[] = [];
  const sharers = v.channelId ? (useChannels.getState().voice[v.channelId]?.participants ?? []).filter((p) => p.screen) : [];
  const watching = useUI.getState().watching;
  for (const p of sharers) {
    if (p.peerId === voice.peerId) continue;
    const name = useChannels.getState().users[p.userId]?.name ?? 'Someone';
    if (!watching.includes(p.peerId) && useUI.getState().focusedPeer !== p.peerId)
      out.push({ level: 'problem', text: `${name} is sharing, but you haven’t clicked Watch Stream, so you don’t hear it yet.`, fix: { label: 'Watch it', run: () => (useUI.getState().set({ watching: [...watching, p.peerId] }), `Watching ${name}’s screen, with sound.`) } });
  }
  if (v.screen) {
    if (!s.shareAudio) out.push({ level: 'problem', text: 'You’re sharing without sound: "Share sound" is off.', fix: { label: 'Turn sound on', run: () => (useSettings.getState().set({ shareAudio: true }), 'Share sound is on. Stop and start your share to add it.') } });
    else if (isMac) out.push({ level: 'info', text: 'On a Mac, screen shares can’t include the computer’s sound yet.' });
    else if (!isTauri) out.push({ level: 'info', text: 'From a browser, sound only goes along if you tick "Share audio" in its picker. The Windows app shares sound by itself.' });
    else out.push({ level: 'ok', text: 'You’re sharing with sound. Friends hear it once they click Watch Stream.' });
  } else if (!sharers.length) out.push({ level: 'info', text: canShareNatively ? 'Nobody is sharing right now. Press Share in the call and pick a screen or app.' : 'Nobody is sharing right now.' });
  return out;
}

async function checkConnection(): Promise<Finding[]> {
  const v = useVoice.getState();
  const out: Finding[] = [];
  if (!navigator.onLine) out.push({ level: 'problem', text: 'This device is offline. Check your Wi-Fi or cable.' });
  const failed = Object.entries(v.connection).filter(([, state]) => state === 'failed' || state === 'disconnected');
  if (failed.length)
    out.push({
      level: 'problem',
      text: `The connection to ${failed.length === 1 ? 'one person' : `${failed.length} people`} in the call dropped.`,
      fix: { label: 'Rejoin the call', run: async () => (await voice.rejoin(), 'Rejoined the call.') },
    });
  else if (v.channelId) out.push({ level: 'ok', text: 'Your connections to everyone in the call are up.' });
  return out;
}

const CHECKS: Record<Topic, () => Promise<Finding[]>> = { mic: checkMic, hearing: checkHearing, camera: checkCamera, screen: checkScreen, connection: checkConnection };

export async function diagnose(question: string): Promise<FixerReport> {
  let topics = TOPICS.filter(([, re]) => re.test(question)).map(([t]) => t);
  // "@Fixer help" or nothing specific: everything that matters for a call.
  if (!topics.length) topics = ['mic', 'hearing', 'connection'];
  const findings = (await Promise.all(topics.map((t) => CHECKS[t]()))).flat();
  const problems = findings.filter((f) => f.level === 'problem').length;
  const inCall = !!useVoice.getState().channelId;
  const intro = !inCall
    ? 'You’re not in a call right now, so I checked what I can. Join a voice room and ask again for a live test.'
    : problems
      ? `I found ${problems === 1 ? 'one thing' : `${problems} things`} to fix:`
      : 'I checked your setup and everything looks fine:';
  return { intro, findings: findings.length ? findings : [{ level: 'ok', text: 'Nothing looks wrong on this device.' }] };
}
