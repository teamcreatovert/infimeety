import { Check, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MenuItem, MenuSeparator } from '../ui/overlay';
import { Segmented, Slider } from '../ui/primitives';
import { listDevices } from '@/lib/voice/engine';
import { useSettings } from '@/stores/settings';
import { useUI } from '@/stores/ui';

type Devices = Awaited<ReturnType<typeof listDevices>>;

/** Browsers without AudioContext.setSinkId (Safari, Firefox) always play through the system's speakers. */
const canChooseOutput = typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;

/**
 * The quick menu beside the mic and headphone buttons, like Discord's: pick the microphone and
 * noise suppression, or the speakers and how loud calls are, without opening Settings.
 */
export function DeviceMenu({ kind, onClose }: { kind: 'input' | 'output'; onClose: () => void }) {
  const s = useSettings();
  const [devices, setDevices] = useState<Devices | null>(null);

  useEffect(() => {
    const load = () => void listDevices().then(setDevices);
    load();
    // Plugging in a headset while the menu is open shows it straight away.
    navigator.mediaDevices?.addEventListener?.('devicechange', load);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', load);
  }, []);

  const input = kind === 'input';
  const current = input ? s.inputDeviceId : s.outputDeviceId;
  const list = [{ id: 'default', label: 'System default' }, ...((input ? devices?.inputs : devices?.outputs) ?? []).filter((d) => d.id !== 'default')];
  const pick = (id: string) => s.set(input ? { inputDeviceId: id } : { outputDeviceId: id });

  return (
    <>
      <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-fg-3">{input ? 'Microphone' : 'Speakers'}</div>
      {!input && !canChooseOutput ? (
        <p className="px-2.5 pb-1.5 text-[12.5px] leading-snug text-fg-2">This browser plays calls through your system’s speakers. Change them in your computer’s sound settings.</p>
      ) : (
        list.map((d) => (
          <MenuItem key={d.id} icon={<Check size={14} className={d.id === current ? undefined : 'invisible'} />} onClick={() => pick(d.id)}>
            {d.label}
          </MenuItem>
        ))
      )}
      <MenuSeparator />
      {input ? (
        <div className="px-2.5 pb-1.5 pt-1">
          <div className="mb-1.5 text-[12px] text-fg-2">Noise suppression</div>
          <Segmented
            id="menu-noise-filter"
            className="w-full"
            value={s.noiseFilter}
            onChange={(v) => s.set({ noiseFilter: v })}
            options={[
              { value: 'strong', label: 'Strong' },
              { value: 'standard', label: 'Standard' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </div>
      ) : (
        <div className="px-2.5 pb-1.5 pt-1">
          <div className="mb-1.5 flex justify-between text-[12px] text-fg-2">
            <span>Call volume</span>
            <span className="tabular-nums">{Math.round(s.outputVolume * 100)}%</span>
          </div>
          <Slider value={s.outputVolume} min={0} max={2} onChange={(v) => s.set({ outputVolume: v })} />
        </div>
      )}
      <MenuSeparator />
      <MenuItem icon={<Settings size={15} />} onClick={() => (onClose(), useUI.getState().set({ settingsTab: 'voice' }))}>
        Voice settings
      </MenuItem>
    </>
  );
}
