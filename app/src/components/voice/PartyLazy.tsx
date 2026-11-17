import { lazy, Suspense, type ComponentProps, type ComponentType } from 'react';

/**
 * The watch party's screens (player, controls, planner panel) load the first time a party
 * shows up, so the app starts without them. The party's state (lib/party) stays loaded.
 */
type Party = typeof import('./Party');
type Name = 'PartyBadge' | 'PartyControls' | 'PartyHeaderInfo' | 'PartyMedia' | 'PartyPersonExtra' | 'PartyRequests' | 'PartyVotes' | 'PartyPanel';

let loading: Promise<Party> | null = null;
/** Starts loading the watch party's code (once), so it is ready when someone opens it. */
export const preloadParty = () => (loading ??= import('./Party'));

function later<K extends Name>(name: K) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Lazy = lazy(() => preloadParty().then((m) => ({ default: m[name] as ComponentType<any> })));
  return function Later(props: ComponentProps<Party[K]>) {
    return (
      <Suspense fallback={null}>
        <Lazy {...(props as object)} />
      </Suspense>
    );
  };
}

export const PartyBadge = later('PartyBadge');
export const PartyControls = later('PartyControls');
export const PartyHeaderInfo = later('PartyHeaderInfo');
export const PartyMedia = later('PartyMedia');
export const PartyPersonExtra = later('PartyPersonExtra');
export const PartyRequests = later('PartyRequests');
export const PartyVotes = later('PartyVotes');
export const PartyPanel = later('PartyPanel');
