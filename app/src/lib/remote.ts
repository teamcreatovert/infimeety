import { create } from 'zustand';
import type { RemoteConfig, RemoteFeature } from '../../../shared/protocol';
import { APP_VERSION } from '@/config';

/**
 * What the server says on connect (RemoteConfig): the oldest version it still supports, and
 * features switched off while something is wrong with them. Lets a release be steered, or a
 * bad feature parked, without shipping a new app.
 */
export const useRemote = create<RemoteConfig>()(() => ({}));

export function onRemoteConfig(config: unknown) {
  const c = config && typeof config === 'object' ? (config as Record<string, unknown>) : {};
  const minVersion = typeof c.minVersion === 'string' && /^\d+\.\d+\.\d+$/.test(c.minVersion) ? c.minVersion : undefined;
  const off = Array.isArray(c.off) ? c.off.filter((f): f is string => typeof f === 'string') : undefined;
  useRemote.setState({ minVersion, off }, true);
}

/** "1.2.3" < "1.10.0", numerically. */
export function olderThan(a: string, b: string) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  return false;
}

export const featureOn = (feature: RemoteFeature) => !useRemote.getState().off?.includes(feature);
export const useFeatureOn = (feature: RemoteFeature) => useRemote((s) => !s.off?.includes(feature));
export const useUpdateRequired = () => useRemote((s) => !!s.minVersion && olderThan(APP_VERSION, s.minVersion));
