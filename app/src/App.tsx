import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { useEffect } from 'react';
import { Onboarding } from './components/auth/Onboarding';
import { SignIn } from './components/auth/SignIn';
import { Lightbox } from './components/Lightbox';
import { ChannelSettingsModal } from './components/modals/ChannelSettingsModal';
import { CreateChannelModal } from './components/modals/CreateChannelModal';
import { InviteModal, JoinInviteModal } from './components/modals/InviteModals';
import { SettingsModal } from './components/modals/SettingsModal';
import { PartyPlanner } from './components/voice/PartyPlanner';
import { Background } from './components/shell/Background';
import { Shell } from './components/shell/Shell';
import { TitleBar } from './components/shell/TitleBar';
import { Toasts } from './components/ui/Toasts';
import { Spinner } from './components/ui/primitives';
import { UpdatePrompt } from './components/UpdatePrompt';
import { ProfileCard } from './components/people/ProfileCard';
import { UserMenu } from './components/people/UserMenu';
import { IncomingCall } from './components/home/IncomingCall';
import { JoinMeetingModal } from './components/meeting/JoinMeetingModal';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SafeModeBanner } from './components/shell/SafeModeBanner';
import { UpdateRequired } from './components/UpdateRequired';
import { UpdateGate } from './components/UpdateGate';
import { markHealthy, safeMode } from './lib/boot';
import { MeetingKnocks } from './components/meeting/MeetingKnocks';
import { startDeepLinks } from './lib/deeplink';
import { startNotifications } from './lib/notify';
import { startWebLinks } from './lib/weblinks';
import { startDesktop } from './lib/desktop';
import { startPushToTalk } from './lib/ptt';
import { connectLobby, disconnectLobby } from './lib/lobby';
import { closeAllHubs, syncHubs } from './lib/realtime';
import { startRevocationWatcher } from './lib/transfer';
import { startUpdateChecks } from './lib/updater';
import { voice } from './lib/voice/engine';
import { useAuth } from './stores/auth';
import { useChannels } from './stores/channels';
import { useFriends } from './stores/friends';
import { ACCENTS, useSettings } from './stores/settings';
import { toast } from './stores/ui';

export function useAppearance() {
  const theme = useSettings((s) => s.theme);
  const accent = useSettings((s) => s.accent);
  const reduce = useSettings((s) => s.reduceTransparency);

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', ACCENTS[accent] ?? ACCENTS.blue);
  }, [accent]);

  useEffect(() => {
    document.documentElement.dataset.transparency = reduce ? 'reduced' : 'full';
  }, [reduce]);
}

export default function App() {
  const status = useAuth((s) => s.status);
  const channelIds = useChannels((s) => s.channels.map((c) => c.id).join(','));
  useAppearance();

  useEffect(() => {
    void useAuth.getState().init();
    startUpdateChecks();
    void startDeepLinks();
    startNotifications();
    startWebLinks();
    startDesktop();
    startPushToTalk();

    // Feels like a native app: no browser context menu outside text.
    const onContext = (e: MouseEvent) => {
      if (!import.meta.env.DEV && !(e.target as HTMLElement).closest('input, textarea, .selectable')) e.preventDefault();
    };
    // Global shortcuts: Ctrl+Shift+M mute, Ctrl+Shift+D deafen.
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
      if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        void voice.toggleMute();
      } else if (e.key.toLowerCase() === 'd') {
        e.preventDefault();
        voice.toggleDeafen();
      }
    };

    window.addEventListener('contextmenu', onContext);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (status !== 'ready') {
      voice.leave({ silent: true });
      closeAllHubs();
      disconnectLobby();
      useFriends.getState().reset();
      useChannels.setState({ channels: [], loaded: false, members: {}, online: {}, voice: {} });
      return;
    }
    connectLobby();
    useChannels
      .getState()
      .load()
      .catch(() => toast({ kind: 'error', title: "Couldn't load your channels", body: 'Check your connection.' }));
    startRevocationWatcher();
  }, [status]);

  useEffect(() => {
    if (status === 'ready') syncHubs(channelIds ? channelIds.split(',') : []);
  }, [channelIds, status]);

  // Up and showing a screen for a few seconds: this start went fine (crash recovery, lib/boot).
  useEffect(() => {
    if (status === 'loading') return;
    const t = setTimeout(markHealthy, 8000);
    return () => clearTimeout(t);
  }, [status]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="safe-area relative flex h-full w-full flex-col overflow-hidden">
        <Background />
        <TitleBar />
        <div className="relative min-h-0 flex-1">
          {/* Screens crossfade (no "wait" mode) so a throttled, hidden window can never get stuck mid-transition. */}
          <AnimatePresence initial={false}>
            <motion.div
              key={status}
              className="absolute inset-0"
              initial={{ opacity: 0, scale: 0.99 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {status === 'loading' && (
                <div className="grid h-full place-items-center text-fg-3">
                  <Spinner size={22} />
                </div>
              )}
              {status === 'signedOut' && <SignIn />}
              {status === 'onboarding' && <Onboarding />}
              {status === 'ready' && safeMode && <SafeModeBanner />}
              {status === 'ready' && <Shell />}
            </motion.div>
          </AnimatePresence>
        </div>
        <ErrorBoundary quiet area="toasts"><Toasts /></ErrorBoundary>
        <ErrorBoundary quiet area="confirm"><ConfirmDialog /></ErrorBoundary>
        <ErrorBoundary quiet area="user-menu"><UserMenu /></ErrorBoundary>
        <ErrorBoundary quiet area="profile-card"><ProfileCard /></ErrorBoundary>
        <ErrorBoundary quiet area="settings"><SettingsModal /></ErrorBoundary>
        <ErrorBoundary quiet area="create-channel"><CreateChannelModal /></ErrorBoundary>
        <ErrorBoundary quiet area="channel-settings"><ChannelSettingsModal /></ErrorBoundary>
        <ErrorBoundary quiet area="invite"><InviteModal /></ErrorBoundary>
        <ErrorBoundary quiet area="party-planner"><PartyPlanner /></ErrorBoundary>
        {status === 'ready' && <ErrorBoundary quiet area="join-invite"><JoinInviteModal /></ErrorBoundary>}
        <ErrorBoundary quiet area="lightbox"><Lightbox /></ErrorBoundary>
        <ErrorBoundary quiet area="update-prompt"><UpdatePrompt /></ErrorBoundary>
        <ErrorBoundary quiet area="update-required"><UpdateRequired /></ErrorBoundary>
        <ErrorBoundary quiet area="update-gate"><UpdateGate /></ErrorBoundary>
        {status === 'ready' && <ErrorBoundary quiet area="incoming-call"><IncomingCall /></ErrorBoundary>}
        {status === 'ready' && <ErrorBoundary quiet area="join-meeting"><JoinMeetingModal /></ErrorBoundary>}
        {status === 'ready' && <ErrorBoundary quiet area="meeting-knocks"><MeetingKnocks /></ErrorBoundary>}
      </div>
    </MotionConfig>
  );
}
