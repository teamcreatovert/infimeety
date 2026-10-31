import clsx from 'clsx';
import { AppWindow, Monitor, Radio } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Modal } from '../ui/overlay';
import { Button, Segmented, Spinner, Switch } from '../ui/primitives';
import { screenSources, type ScreenSource } from '@/lib/voice/nativeScreen';
import { voice } from '@/lib/voice/engine';
import { SCREEN_PRESETS, useSettings, type ScreenQuality } from '@/stores/settings';
import { useUI } from '@/stores/ui';

/**
 * The Windows app's screen picker, like Discord's: apps and screens with live thumbnails, the
 * stream quality and whether the computer's sound goes along, then Go Live.
 */
export function ScreenPicker() {
  const open = useUI((s) => s.screenPicker);
  const [sources, setSources] = useState<ScreenSource[] | null>(null);
  const [tab, setTab] = useState<'window' | 'screen'>('window');
  const [picked, setPicked] = useState<string | null>(null);
  const quality = useSettings((s) => s.screenQuality);
  const shareAudio = useSettings((s) => s.shareAudio);
  const close = () => useUI.getState().set({ screenPicker: false });

  useEffect(() => {
    if (!open) return;
    setSources(null);
    setPicked(null);
    let live = true;
    screenSources()
      .then((list) => {
        if (!live) return;
        setSources(list);
        // Nothing to pick among apps (all minimized): start on the screens.
        if (!list.some((s) => s.kind === 'window')) setTab('screen');
      })
      .catch(() => live && setSources([]));
    return () => {
      live = false;
    };
  }, [open]);

  const shown = sources?.filter((s) => s.kind === tab) ?? [];
  const goLive = (id = picked) => {
    if (!id) return;
    close();
    void voice.startScreen(id);
  };

  return (
    <Modal open={open} onClose={close} width={720}>
      <div className="flex max-h-[min(640px,calc(100dvh-48px))] flex-col">
        <div className="flex items-center gap-3 px-6 pb-3 pt-5">
          <h2 className="flex-1 font-display text-[19px] font-bold tracking-[-0.02em]">Share your screen</h2>
          <Segmented
            id="screen-picker-tab"
            value={tab}
            onChange={(t) => (setTab(t), setPicked(null))}
            options={[
              { value: 'window', label: 'Applications' },
              { value: 'screen', label: 'Screens' },
            ]}
          />
        </div>

        <div className="scroll min-h-[240px] flex-1 px-6 pb-4">
          {!sources ? (
            <div className="grid h-[240px] place-items-center text-fg-3">
              <Spinner size={20} />
            </div>
          ) : !shown.length ? (
            <div className="grid h-[240px] place-items-center text-center text-[13px] text-fg-3">
              {tab === 'window' ? 'No open apps to share. Open one, or share a whole screen.' : 'No screens found.'}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 compact:grid-cols-2">
              {shown.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setPicked(s.id)}
                  onDoubleClick={() => goLive(s.id)}
                  className={clsx(
                    'group flex flex-col gap-2 rounded-[14px] p-2 text-left transition-colors',
                    picked === s.id ? 'bg-accent/15 ring-2 ring-accent' : 'hover:bg-fill-2',
                  )}
                >
                  <span className="grid aspect-video w-full place-items-center overflow-hidden rounded-[9px] bg-black/80">
                    {s.thumb ? <img src={s.thumb} alt="" className="h-full w-full object-contain" /> : s.kind === 'window' ? <AppWindow size={26} className="text-white/50" /> : <Monitor size={26} className="text-white/50" />}
                  </span>
                  <span className="min-w-0 px-0.5">
                    <span className="block truncate text-[12.5px] font-medium">{s.name}</span>
                    {s.app && s.app.toLowerCase() !== s.name.toLowerCase() && <span className="block truncate text-[11px] text-fg-3">{s.app}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="hairline-t flex flex-wrap items-center gap-x-5 gap-y-3 px-6 py-4">
          <label className="flex items-center gap-2 text-[13px]">
            <span className="text-fg-2">Quality</span>
            <select
              value={quality}
              onChange={(e) => useSettings.getState().set({ screenQuality: e.target.value as ScreenQuality })}
              className="field h-8 rounded-[9px] px-2 text-[13px]"
            >
              {Object.entries(SCREEN_PRESETS).map(([id, p]) => (
                <option key={id} value={id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <Switch checked={shareAudio} onChange={(v) => useSettings.getState().set({ shareAudio: v })} />
            <span className="text-fg-2">Share sound</span>
          </label>
          <div className="flex-1" />
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Radio size={15} />} disabled={!picked} onClick={() => goLive()}>
            Go Live
          </Button>
        </div>
      </div>
    </Modal>
  );
}
