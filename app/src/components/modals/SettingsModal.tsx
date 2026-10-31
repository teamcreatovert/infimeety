import clsx from 'clsx';
import { motion } from 'motion/react';
import { AppWindow, AtSign, Bell, Download, FolderDown, LogOut, Mic, MonitorUp, Palette, UserPlus, UserRound, Video, VideoOff, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Me } from '../../../../shared/protocol';
import { AvatarEditor } from '../auth/AvatarEditor';
import { DiscordLogo, GoogleLogo } from '../auth/SignIn';
import { UsernameStatus, useUsernameCheck } from '../auth/Onboarding';
import { MAX_ACCOUNTS, okToLeaveCall } from '../shell/AccountMenu';
import { Avatar } from '../ui/Avatar';
import { Modal } from '../ui/overlay';
import { Button, Group, Row, Segmented, Select, Slider, Switch, TextField } from '../ui/primitives';
import { APP_VERSION, PRIVACY_PAGE } from '@/config';
import { addAccount, savedAccounts, switchAccount } from '@/lib/accounts';
import { api } from '@/lib/api';
import { resetApp, restartInSafeMode } from '@/lib/boot';
import { confirmDialog } from '@/lib/confirm';
import { isMac, isTauri, openExternal } from '@/lib/platform';
import { canChooseFolder, chooseSaveFolder } from '@/lib/saveFolder';
import { spring } from '@/lib/motion';
import { sounds } from '@/lib/sounds';
import { useUpdater } from '@/lib/updater';
import { denoise, type Denoised } from '@/lib/voice/denoise';
import { listDevices, voice } from '@/lib/voice/engine';
import { useAuth } from '@/stores/auth';
import { useVoice } from '@/stores/voice';
import { ACCENTS, SCREEN_PRESETS, WALLPAPERS, useSettings, type Accent, type NoiseFilter, type ScreenQuality, type Wallpaper } from '@/stores/settings';
import { toast, useUI, type SettingsTab } from '@/stores/ui';

const TABS: { id: SettingsTab; label: string; icon: ReactNode; tint: string }[] = [
  { id: 'account', label: 'Account', icon: <UserRound size={15} />, tint: '#0a84ff' },
  { id: 'voice', label: 'Voice & Video', icon: <Mic size={15} />, tint: '#30d158' },
  { id: 'screen', label: 'Screen Share', icon: <MonitorUp size={15} />, tint: '#bf5af2' },
  { id: 'files', label: 'Files', icon: <FolderDown size={15} />, tint: '#64d2ff' },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={15} />, tint: '#ff9f0a' },
  { id: 'sounds', label: 'Sounds', icon: <Bell size={15} />, tint: '#ff375f' },
  { id: 'desktop', label: 'Overlay & Tray', icon: <AppWindow size={15} />, tint: '#5e5ce6' },
  { id: 'updates', label: 'Updates', icon: <Download size={15} />, tint: '#8e8e93' },
];

export function SettingsModal() {
  const tab = useUI((s) => s.settingsTab);
  const close = () => useUI.getState().set({ settingsTab: null });
  return (
    <Modal open={!!tab} onClose={close} width={1080}>
      {/* Phones: the tabs become a scrolling row above the page. */}
      <div className="flex h-[min(800px,calc(100dvh-48px))] compact:h-[calc(100dvh-24px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] compact:flex-col">
        <nav className="hairline-r flex w-[240px] shrink-0 flex-col gap-0.5 bg-fill-1 p-2.5 pt-4 compact:w-auto compact:flex-row compact:overflow-x-auto compact:pt-2.5 compact:[scrollbar-width:none]">
          <div className="mb-2 px-2.5 font-display text-[18px] font-bold tracking-[-0.02em] compact:hidden">Settings</div>
          {TABS.filter((t) => isTauri || (t.id !== 'desktop' && t.id !== 'updates')).map((t) => (
            <button
              key={t.id}
              onClick={() => useUI.getState().set({ settingsTab: t.id })}
              className={clsx('relative flex h-8 shrink-0 items-center gap-2.5 rounded-[8px] px-2 text-[13px] transition-colors compact:h-9', tab === t.id ? 'text-white' : 'hover:bg-fill-2')}
            >
              {tab === t.id && <motion.span layoutId="settings-tab" transition={spring} className="absolute inset-0 rounded-[8px] bg-accent" />}
              <span className="relative grid h-[22px] w-[22px] place-items-center rounded-[6px] text-white" style={{ background: t.tint }}>
                {t.icon}
              </span>
              <span className="relative">{t.label}</span>
            </button>
          ))}
          <div className="mt-auto px-2.5 pb-1 text-[11px] leading-snug text-fg-3 compact:hidden">
            Infimeety {APP_VERSION}
            <br />
            by Creatovert
          </div>
        </nav>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* The page's title and the close button stay put; only the page below scrolls. */}
          <header className="hairline-b flex h-[60px] shrink-0 items-center gap-3 px-8 compact:h-12 compact:px-4">
            <h2 className="flex-1 truncate font-display text-[20px] font-bold tracking-[-0.02em] compact:text-[17px]">{TABS.find((t) => t.id === tab)?.label}</h2>
            <button aria-label="Close" onClick={close} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-fill-2 text-fg-2 hover:bg-fill-3 hover:text-fg">
              <X size={15} />
            </button>
          </header>
          <motion.div key={tab} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={spring} className="scroll min-h-0 flex-1 px-8 pb-8 pt-5 compact:px-4 compact:pt-4">
            {tab === 'account' && <AccountTab />}
            {tab === 'voice' && <VoiceTab />}
            {tab === 'screen' && <ScreenTab />}
            {tab === 'files' && <FilesTab />}
            {tab === 'appearance' && <AppearanceTab />}
            {tab === 'sounds' && <SoundsTab />}
            {tab === 'desktop' && <DesktopTab />}
            {tab === 'updates' && <UpdatesTab />}
          </motion.div>
        </div>
      </div>
    </Modal>
  );
}

/** Signing out clears `me` while this sheet is still animating closed; render nothing then. */
function AccountTab() {
  const me = useAuth((s) => s.me);
  return me ? <AccountForm me={me} /> : null;
}

function AccountForm({ me }: { me: Me }) {
  const setMe = useAuth((s) => s.setMe);
  const [name, setName] = useState(me.name);
  const [username, setUsername] = useState(me.username ?? '');
  const availability = useUsernameCheck(username, me.username);
  const dirty = name.trim() !== me.name || username !== me.username;

  const save = async () => {
    try {
      setMe(await api<Me>('/me', { method: 'PATCH', json: { name: name.trim(), username } }));
      toast({ kind: 'success', title: 'Profile updated' });
    } catch {
      toast({ kind: 'error', title: "Couldn't save your profile" });
    }
  };

  return (
    <>
      <div className="mb-6">
        <AvatarEditor size={96} />
      </div>
      <Group title="Profile">
        <Row label="Display name">
          <TextField className="h-8! w-[240px]" inputClassName="text-[13px]!" value={name} onChange={(e) => setName(e.target.value)} maxLength={48} />
        </Row>
        <Row label="Username">
          <TextField
            className="h-8! w-[240px]"
            inputClassName="text-[13px]!"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))}
            leading={<AtSign size={13} />}
            trailing={<UsernameStatus state={availability} />}
          />
        </Row>
        <Row label="Email" detail={`From ${me.providers.filter((p) => p !== 'dev').map((p) => p[0].toUpperCase() + p.slice(1)).join(' & ') || 'test login'}`}>
          <span className="text-[13px] text-fg-2">{me.email}</span>
        </Row>
      </Group>
      <ConnectedAccounts me={me} />
      <DeviceAccounts me={me} />
      <div className="flex justify-between">
        <Button variant="ghost" className="text-danger!" icon={<LogOut size={14} />} onClick={() => (voice.leave({ silent: true }), useUI.getState().set({ settingsTab: null }), void useAuth.getState().signOut())}>
          Sign out
        </Button>
        <Button variant="primary" disabled={!dirty || availability !== 'ok' || !name.trim()} onClick={() => void save()}>
          Save changes
        </Button>
      </div>
      <p className="mt-6 text-[12px] text-fg-3">
        <button onClick={() => void openExternal(PRIVACY_PAGE)} className="hover:text-accent hover:underline">
          Privacy policy
        </button>
      </p>
    </>
  );
}

/** Every account signed in on this device, like Discord's switcher: one click to change, or add another. */
function DeviceAccounts({ me }: { me: Me }) {
  const saved = savedAccounts();
  const accounts = saved.some((a) => a.id === me.id) ? saved : [{ id: me.id, name: me.name, username: me.username ?? '', avatarUrl: me.avatarUrl ?? null }, ...saved];
  const full = accounts.length >= MAX_ACCOUNTS;
  const go = async (action: () => void) => {
    if (await okToLeaveCall()) action();
  };
  return (
    <Group title="Accounts on this device" footer={`Switch without signing out: every account here stays signed in, up to ${MAX_ACCOUNTS}.`}>
      {accounts.map((a) => (
        <Row
          key={a.id}
          label={
            <span className="flex items-center gap-2.5">
              <Avatar user={a} size={28} />
              <span className="min-w-0">
                <span className="block truncate">{a.name}</span>
                <span className="block truncate text-[11.5px] text-fg-3">@{a.username}</span>
              </span>
            </span>
          }
        >
          {a.id === me.id ? (
            <span className="text-[12px] font-medium text-fg-3">Using now</span>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => void go(() => switchAccount(a.id))}>
              Switch
            </Button>
          )}
        </Row>
      ))}
      <Row
        label={
          <span className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-fill-2 text-fg-2">
              <UserPlus size={14} />
            </span>
            Add an account
          </span>
        }
      >
        <Button size="sm" variant="primary" disabled={full} onClick={() => void go(addAccount)}>
          {full ? `Up to ${MAX_ACCOUNTS}` : 'Add'}
        </Button>
      </Row>
    </Group>
  );
}

/** Sign in with Google or Discord into the same account: connect the other one here. */
function ConnectedAccounts({ me }: { me: Me }) {
  const linking = useAuth((s) => s.linking);
  const available = useAuth((s) => s.providers);
  const connected = me.providers.filter((p) => p !== 'dev');

  const connect = async (provider: 'google' | 'discord') => {
    const name = provider === 'google' ? 'Google' : 'Discord';
    const result = await useAuth.getState().link(provider).catch(() => 'failed');
    if (result === 'linked') toast({ kind: 'success', title: `${name} connected`, body: 'You can now sign in with either one.' });
    else if (result === 'in_use') toast({ kind: 'error', title: `That ${name} account belongs to another Infimeety account` });
    else if (result === 'provider_taken') toast({ kind: 'error', title: `A ${name} account is already connected` });
    else if (result !== 'cancelled') toast({ kind: 'error', title: `Couldn't connect ${name}`, body: 'Please try again.' });
  };

  const disconnect = async (provider: 'google' | 'discord') => {
    if (!confirm(`Disconnect ${provider === 'google' ? 'Google' : 'Discord'}? You won't be able to sign in with it anymore.`)) return;
    try {
      await useAuth.getState().unlink(provider);
    } catch {
      toast({ kind: 'error', title: "Couldn't disconnect" });
    }
  };

  const row = (provider: 'google' | 'discord', label: string, logo: ReactNode) => {
    const isConnected = me.providers.includes(provider);
    return (
      <Row
        key={provider}
        label={
          <span className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-[8px]" style={{ background: provider === 'google' ? '#fff' : '#5865F2', color: '#fff' }}>
              {logo}
            </span>
            {label}
          </span>
        }
        detail={isConnected ? 'Connected. You can sign in with it.' : 'Connect it to sign in to this same account.'}
      >
        {isConnected ? (
          <Button size="sm" variant="ghost" disabled={connected.length <= 1} onClick={() => void disconnect(provider)}>
            Disconnect
          </Button>
        ) : (
          <Button size="sm" variant="primary" loading={linking === provider} disabled={!available?.[provider] || (!!linking && linking !== provider)} onClick={() => void connect(provider)}>
            {linking === provider ? 'Waiting for browser…' : 'Connect'}
          </Button>
        )}
      </Row>
    );
  };

  return (
    <Group title="Connected accounts" footer="Connecting both means Google and Discord sign you into this same account. Your friends and channels stay put.">
      {row('google', 'Google', <GoogleLogo />)}
      {row('discord', 'Discord', <DiscordLogo />)}
    </Group>
  );
}

const NOISE_DETAIL: Record<NoiseFilter, string> = {
  strong: 'Filters out fans, typing, traffic and barking, on your device. Only your voice gets through.',
  standard: 'Your device’s built-in filter. Lighter, and lets more noise through.',
  off: 'Everything your mic hears is sent. Best for music.',
};

/** "KeyV" → "V", "Mouse4" → "Mouse button 4", "ShiftLeft" → "Left Shift". */
function keyName(code: string) {
  if (code === 'Space') return 'Spacebar';
  if (code === 'Backquote') return '`';
  if (code.startsWith('Mouse')) return `Mouse button ${code.slice(5)}`;
  const side = /^(Shift|Control|Alt|Meta)(Left|Right)$/.exec(code);
  if (side) return `${side[2]} ${side[1] === 'Control' ? 'Ctrl' : side[1]}`;
  return code.replace(/^(Key|Digit)/, '');
}

function PttKeyRecorder({ currentKey, onChange }: { currentKey: string; onChange: (key: string) => void }) {
  const [recording, setRecording] = useState(false);
  const pttActive = useVoice((s) => s.pttActive);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const code = e.code || e.key;
      if (code && code !== 'Escape') onChange(code);
      setRecording(false);
    };
    // The middle and side mouse buttons work too (Discord-style); left and right stay clicks.
    const onMouse = (e: MouseEvent) => {
      if (e.button < 1) return setRecording(false);
      if (e.button === 2) return;
      e.preventDefault();
      e.stopPropagation();
      onChange(`Mouse${e.button + 1}`);
      setRecording(false);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    window.addEventListener('mousedown', onMouse, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true });
      window.removeEventListener('mousedown', onMouse, { capture: true });
    };
  }, [recording, onChange]);

  const displayKey = keyName(currentKey);

  return (
    <div className="flex items-center gap-2">
      <Button
        variant={recording ? 'primary' : 'secondary'}
        size="sm"
        onClick={() => setRecording(true)}
        className="min-w-[110px]"
      >
        {recording ? 'Press a key or mouse button…' : displayKey}
      </Button>
      {pttActive && (
        <span className="flex items-center gap-1 rounded-full bg-success/20 px-2 py-0.5 text-[11px] font-semibold text-success">
          <Mic size={11} /> Transmitting
        </span>
      )}
    </div>
  );
}

function VoiceTab() {
  const s = useSettings();
  const [devices, setDevices] = useState<Awaited<ReturnType<typeof listDevices>> | null>(null);
  const [level, setLevel] = useState(0);
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    void listDevices().then(setDevices);
  }, []);

  // Live mic meter while this tab is open, after noise suppression (so you can see the noise go).
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cleaned: Denoised | null = null;
    let raf = 0;
    let ctx: AudioContext | null = null;
    let gone = false;
    void navigator.mediaDevices
      .getUserMedia({
        audio: {
          deviceId: s.inputDeviceId !== 'default' ? { exact: s.inputDeviceId } : undefined,
          echoCancellation: s.echoCancellation,
          noiseSuppression: s.noiseFilter === 'standard',
          autoGainControl: s.autoGainControl,
        },
      })
      .then(async (st) => {
        stream = st;
        cleaned = s.noiseFilter === 'strong' ? await denoise(st) : null;
        if (gone) return cleaned?.stop();
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(cleaned?.stream ?? st).connect(analyser);
        const data = new Float32Array(analyser.fftSize);
        const loop = () => {
          analyser.getFloatTimeDomainData(data);
          let sum = 0;
          for (const v of data) sum += v * v;
          setLevel(Math.min(1, Math.sqrt(sum / data.length) * 6));
          raf = requestAnimationFrame(loop);
        };
        loop();
      })
      .catch(() => {});
    return () => {
      gone = true;
      cancelAnimationFrame(raf);
      cleaned?.stop();
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
    };
  }, [s.inputDeviceId, s.echoCancellation, s.noiseFilter, s.autoGainControl]);

  useEffect(() => () => preview?.getTracks().forEach((t) => t.stop()), [preview]);
  useEffect(() => {
    if (videoRef.current && preview) videoRef.current.srcObject = preview;
  }, [preview]);

  const togglePreview = async () => {
    if (preview) return setPreview(null);
    try {
      setPreview(await navigator.mediaDevices.getUserMedia({ video: { deviceId: s.cameraDeviceId !== 'default' ? { ideal: s.cameraDeviceId } : undefined } }));
    } catch {
      toast({ kind: 'error', title: 'Camera unavailable' });
    }
  };

  const opts = (list?: { id: string; label: string }[]) => [{ value: 'default', label: 'System default' }, ...(list ?? []).filter((d) => d.id !== 'default').map((d) => ({ value: d.id, label: d.label }))];

  return (
    <>
      <Group title="Microphone">
        <Row label="Input device">
          <Select value={s.inputDeviceId} options={opts(devices?.inputs)} onChange={(v) => s.set({ inputDeviceId: v })} />
        </Row>
        <Row label="Input level" detail="Speak to test your mic">
          <div className="flex h-2 w-[240px] gap-[3px]">
            {Array.from({ length: 24 }, (_, i) => (
              <span key={i} className="flex-1 rounded-full transition-colors duration-75" style={{ background: i / 24 < level ? (i > 19 ? 'var(--warning)' : 'var(--success)') : 'var(--fill-3)' }} />
            ))}
          </div>
        </Row>
        <Row label="Noise suppression" detail={NOISE_DETAIL[s.noiseFilter]}>
          <Segmented
            id="noise-filter"
            className="w-[240px]"
            value={s.noiseFilter}
            onChange={(v) => s.set({ noiseFilter: v })}
            options={[
              { value: 'strong', label: 'Strong' },
              { value: 'standard', label: 'Standard' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </Row>
        <Row label="Echo cancellation">
          <Switch checked={s.echoCancellation} onChange={(v) => s.set({ echoCancellation: v })} />
        </Row>
        <Row label="Automatic gain" detail="Keeps your voice at a steady volume">
          <Switch checked={s.autoGainControl} onChange={(v) => s.set({ autoGainControl: v })} />
        </Row>
        <Row label="Input mode" detail={s.voiceInputMode === 'ptt' ? 'Hold your shortcut key to transmit voice' : 'Microphone activates automatically when you speak'}>
          <Segmented
            id="voice-input-mode"
            className="w-[240px]"
            value={s.voiceInputMode}
            onChange={(v) => s.set({ voiceInputMode: v })}
            options={[
              { value: 'activity', label: 'Voice Activity' },
              { value: 'ptt', label: 'Push to Talk' },
            ]}
          />
        </Row>
        {s.voiceInputMode === 'ptt' && (
          <Row label="Shortcut key" detail="Works in games too. Like Discord, the game still gets the key, so pick one it doesn’t use: a mouse side button is ideal.">
            <PttKeyRecorder currentKey={s.pttKey} onChange={(key) => s.set({ pttKey: key })} />
          </Row>
        )}
      </Group>
      <Group title="Speakers">
        <Row label="Output device">
          <Select value={s.outputDeviceId} options={opts(devices?.outputs)} onChange={(v) => s.set({ outputDeviceId: v })} />
        </Row>
        <Row label="Call volume" detail={`Everyone in calls, together · ${Math.round(s.outputVolume * 100)}%`}>
          <div className="w-[240px]">
            <Slider value={s.outputVolume} min={0} max={2} onChange={(v) => s.set({ outputVolume: v })} />
          </div>
        </Row>
      </Group>
      <Group title="Camera">
        <Row label="Camera">
          <Select value={s.cameraDeviceId} options={opts(devices?.cameras)} onChange={(v) => s.set({ cameraDeviceId: v })} />
        </Row>
        {/* A preview sized to fit the window (whole, not cut off), with its button inside. */}
        <div className="p-3.5">
          <div className="relative mx-auto grid aspect-video w-full max-w-[480px] place-items-center overflow-hidden rounded-[14px] bg-black/50">
            {preview ? (
              <>
                <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" style={{ transform: 'scaleX(-1)' }} />
                <Button size="sm" className="absolute bottom-2.5 right-2.5" onClick={() => void togglePreview()}>
                  Stop preview
                </Button>
              </>
            ) : (
              <div className="flex flex-col items-center gap-2.5 text-center">
                <VideoOff size={26} className="text-white/45" />
                <span className="text-[12.5px] text-white/60">Your camera is off</span>
                <Button size="sm" icon={<Video size={13} />} onClick={() => void togglePreview()}>
                  Test camera
                </Button>
              </div>
            )}
          </div>
        </div>
      </Group>
    </>
  );
}

function ScreenTab() {
  const s = useSettings();
  return (
    <>
      <Group title="Quality" footer="Higher quality needs more upload bandwidth. In big rooms the bitrate is shared between viewers automatically.">
        <Row label="Resolution & frame rate">
          <Select value={s.screenQuality} options={(Object.keys(SCREEN_PRESETS) as ScreenQuality[]).map((q) => ({ value: q, label: SCREEN_PRESETS[q].label }))} onChange={(v) => s.set({ screenQuality: v })} />
        </Row>
        <Row label="Optimize for" detail="Movies keeps motion smooth; Text keeps it sharp">
          <Segmented
            id="screen-mode-settings"
            className="w-[240px]"
            value={s.screenMode}
            onChange={(v) => s.set({ screenMode: v })}
            options={[
              { value: 'motion', label: 'Movies' },
              { value: 'detail', label: 'Text' },
            ]}
          />
        </Row>
        <Row label="Share sound" detail="Includes your computer's audio when sharing your entire screen">
          <Switch checked={s.shareAudio} onChange={(v) => s.set({ shareAudio: v })} />
        </Row>
      </Group>
      <Group title="Watching together">
        <div className="space-y-2 px-3.5 py-3 text-[12.5px] leading-relaxed text-fg-2">
          <p>
            Have the movie file? Plan a <b>watch party</b> from any chat’s <b>+</b> menu. Everyone copies the file straight from you, says they’re ready, and you start it
            together, in perfect sync and with subtitles. You choose who can play and pause; everyone else can ask.
          </p>
          <p>Or share your entire screen with sound on, open the movie, and everyone sees and hears it in watch mode. Chat and everyone’s faces sit in a panel beside it, or switch to Mini or Full screen.</p>
          <p className="text-fg-3">
            Netflix, Disney+ and other DRM-protected sites can appear black when captured. In your browser, turn off <i>Use graphics acceleration</i> (Settings → System), restart it, and share again.
          </p>
        </div>
      </Group>
    </>
  );
}

function Swatch({ active, onClick, style, label }: { active: boolean; onClick: () => void; style: React.CSSProperties; label: string }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} className="relative h-6 w-6 rounded-full transition-transform hover:scale-110" style={style}>
      {active && <motion.span layoutId={`swatch-${label.split(' ')[0]}`} className="absolute -inset-[3px] rounded-full" style={{ boxShadow: '0 0 0 2px var(--fg)' }} transition={spring} />}
    </button>
  );
}

function AppearanceTab() {
  const s = useSettings();
  return (
    <>
      <Group title="Theme">
        <Row label="Appearance">
          <Segmented
            id="theme"
            className="w-[260px]"
            value={s.theme}
            onChange={(v) => s.set({ theme: v })}
            options={[
              { value: 'system', label: 'Auto' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </Row>
        <Row label="Accent color">
          <div className="flex gap-2.5">
            {(Object.keys(ACCENTS) as Accent[]).map((a) => (
              <Swatch key={a} label={`accent ${a}`} active={s.accent === a} onClick={() => s.set({ accent: a })} style={{ background: ACCENTS[a] }} />
            ))}
          </div>
        </Row>
      </Group>
      <Group title="Wallpaper" footer="The colors behind the glass.">
        <div className="grid grid-cols-5 gap-2.5 p-3.5">
          {(Object.keys(WALLPAPERS) as Wallpaper[]).map((w) => {
            const [a, b, c] = WALLPAPERS[w];
            return (
              <button key={w} onClick={() => s.set({ wallpaper: w })} className="group text-center">
                <div
                  className="aspect-[4/3] rounded-[10px] transition-transform group-hover:scale-[1.03]"
                  style={{
                    background: `radial-gradient(circle at 20% 20%, ${a}, transparent 60%), radial-gradient(circle at 85% 85%, ${b}, transparent 60%), radial-gradient(circle at 60% 40%, ${c}, transparent 55%), #0b0b10`,
                    boxShadow: s.wallpaper === w ? '0 0 0 2px var(--bg), 0 0 0 4px var(--accent)' : 'inset 0 0 0 0.5px var(--hairline-strong)',
                  }}
                />
                <div className="mt-1.5 text-[11.5px] capitalize text-fg-2">{w}</div>
              </button>
            );
          })}
        </div>
        <Row label="Living wallpaper" detail="Colors drift slowly. Pauses during calls.">
          <Switch checked={s.livingWallpaper} onChange={(v) => s.set({ livingWallpaper: v })} />
        </Row>
        <Row label="Reduce transparency" detail="Solid panels instead of glass">
          <Switch checked={s.reduceTransparency} onChange={(v) => s.set({ reduceTransparency: v })} />
        </Row>
      </Group>
    </>
  );
}

function FilesTab() {
  const folder = useSettings((s) => (isTauri ? s.saveFolder : s.saveFolderName));
  return (
    <>
      <Group
        title="Copies"
        footer="When friends share files, folders or a watch-party movie, Copy saves them here. They come straight from your friend’s device, over several connections at once."
      >
        {canChooseFolder ? (
          <Row label="Save copies to" detail={folder ?? 'Not chosen yet. You’ll be asked the first time you copy something.'}>
            <Button size="sm" onClick={() => void chooseSaveFolder()}>
              {folder ? 'Change…' : 'Choose…'}
            </Button>
          </Row>
        ) : (
          <Row label="Save copies to" detail="Your Downloads folder. Chrome, Edge and the Infimeety app can save into a folder you pick." />
        )}
      </Group>
      {!isTauri && (
        <p className="px-1 text-[12px] leading-snug text-fg-3">
          Big copies and watch parties work best in the Infimeety app: it writes straight to disk at full speed and keeps sharing in the background.
        </p>
      )}
    </>
  );
}

function SoundsTab() {
  const s = useSettings();
  return (
    <Group title="Sound effects" footer="Soft cues for joining, leaving, muting, messages and screen sharing.">
      <Row label="Play sound effects">
        <Switch checked={s.soundsEnabled} onChange={(v) => s.set({ soundsEnabled: v })} />
      </Row>
      <Row label="Volume">
        <div className="flex w-[240px] items-center gap-3">
          <Slider value={s.soundVolume} onChange={(v) => s.set({ soundVolume: v })} />
          <Button size="sm" onClick={() => sounds.join()}>
            Test
          </Button>
        </div>
      </Row>
      <Row label="New message sound" detail="When a message arrives in a room you're not looking at">
        <Switch checked={s.messageSounds} onChange={(v) => s.set({ messageSounds: v })} />
      </Row>
    </Group>
  );
}

function DesktopTab() {
  const s = useSettings();
  return (
    <>
      {/* The overlay is Windows-only until it's been tried on a Mac. */}
      {!isMac && (
        <Group title="Voice overlay" footer="While you're in a call and using another app or game, a light overlay shows who's talking. Clicks pass straight through it.">
          <Row label="Show voice overlay">
            <Switch checked={s.overlay} onChange={(v) => s.set({ overlay: v })} />
          </Row>
          <Row label="Show">
            <Segmented
              id="overlay-show"
              className="w-[240px]"
              value={s.overlayShow}
              onChange={(v) => s.set({ overlayShow: v })}
              options={[
                { value: 'speaking', label: "Who's talking" },
                { value: 'everyone', label: 'Everyone' },
              ]}
            />
          </Row>
          <Row label="Position">
            <Select
              value={s.overlayCorner}
              onChange={(v) => s.set({ overlayCorner: v })}
              options={[
                { value: 'top-left', label: 'Top left' },
                { value: 'top-right', label: 'Top right' },
                { value: 'bottom-left', label: 'Bottom left' },
                { value: 'bottom-right', label: 'Bottom right' },
              ]}
            />
          </Row>
        </Group>
      )}
      <Group
        title="Window"
        footer={
          isMac
            ? 'To quit completely, press ⌘Q, or click the Infimeety icon in the menu bar and choose Quit.'
            : 'To quit completely, right-click the Infimeety icon in the system tray (next to the clock) and choose Quit.'
        }
      >
        <Row label="Keep running when closed" detail={`The close button hides Infimeety to the ${isMac ? 'menu bar' : 'tray'}, so calls and messages keep coming in`}>
          <Switch checked={s.closeToTray} onChange={(v) => s.set({ closeToTray: v })} />
        </Row>
      </Group>
    </>
  );
}

function UpdatesTab() {
  const { status, update, error } = useUpdater();
  const label =
    status === 'checking'
      ? 'Checking…'
      : status === 'available'
        ? `Version ${update?.version} is available`
        : status === 'uptodate'
          ? 'Infimeety is up to date'
          : status === 'unsupported'
            ? 'Updates run in installed builds (not in dev mode)'
            : status === 'error'
              ? `Couldn't check for updates`
              : `You're on version ${APP_VERSION}`;
  return (
    <>
      <Group footer={status === 'error' ? error : 'Infimeety checks for updates every time it opens and installs them right away, so you’re always on the latest version. You stay signed in.'}>
        <Row label={label} detail={`Current version ${APP_VERSION}`}>
          {status === 'available' ? (
            <Button variant="primary" size="sm" onClick={() => void useUpdater.getState().install()}>
              Update & restart
            </Button>
          ) : (
            <Button size="sm" loading={status === 'checking'} onClick={() => void useUpdater.getState().check(true)}>
              Check now
            </Button>
          )}
        </Row>
      </Group>
      <Group title="Troubleshooting" footer="Safe Mode opens Infimeety once with default settings, keeping yours aside. A reset clears what this device remembers (settings, the last open screen). You stay signed in, and files you share keep sharing.">
        <Row label="Restart in Safe Mode">
          <Button size="sm" onClick={restartInSafeMode}>
            Restart
          </Button>
        </Row>
        <Row label="Reset Infimeety">
          <Button
            size="sm"
            variant="danger"
            onClick={() =>
              void confirmDialog({ title: 'Reset Infimeety?', body: 'Your settings go back to how they were when you installed it. You stay signed in.', confirm: 'Reset', danger: true }).then((ok) => ok && resetApp())
            }
          >
            Reset
          </Button>
        </Row>
      </Group>
    </>
  );
}
