import { create } from 'zustand';
import type { Lobby } from '../../../shared/protocol';
import { useParty } from './party';
import { getHub } from './realtime';
import { confirmCallSwitch } from './voice/callSwitch';
import { voice } from './voice/engine';
import { useWeb } from './watchWeb';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { toast, useUI } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

/**
 * Activity lobbies: a watch party (games later) in a voice room. Opening one takes the whole
 * window into it, like a game's lobby: the host picks a movie or a website, everyone gets ready,
 * and it plays there. Leaving the lobby goes back to the app while the party carries on.
 */
export const useLobby = create<{ lobbies: Record<string, Lobby> }>()(() => ({ lobbies: {} }));

const hubFor = () => {
  const id = useVoice.getState().channelId;
  return id ? getHub(id) : undefined;
};

export function onLobbies(lobbies: Record<string, Lobby> | undefined, roomIds: string[]) {
  useLobby.setState((s) => {
    const next = { ...s.lobbies };
    for (const id of roomIds) if (!lobbies?.[id]) delete next[id];
    return { lobbies: { ...next, ...lobbies } };
  });
}

export function onLobby(roomId: string, lobby: Lobby | null) {
  const before = useLobby.getState().lobbies[roomId];
  useLobby.setState((s) => {
    const lobbies = { ...s.lobbies };
    if (lobby) lobbies[roomId] = lobby;
    else delete lobbies[roomId];
    return { lobbies };
  });
  const me = useAuth.getState().me?.id;
  const inRoom = useVoice.getState().roomId === roomId;
  if (!lobby) {
    // Closed: everyone in it is back in the app.
    if (useUI.getState().lobby === roomId) useUI.getState().set({ lobby: null });
    return;
  }
  if (!before && inRoom && lobby.hostId !== me) {
    const name = useChannels.getState().users[lobby.hostId]?.name ?? 'Someone';
    toast({ kind: 'info', title: `${name} opened a watch party`, body: 'Press the popcorn in the call bar to join the lobby.' });
  }
}

/** Whether a room has a lobby (or something playing that belongs in one). */
export const hasLobby = (roomId: string) => !!(useLobby.getState().lobbies[roomId] || useParty.getState().parties[roomId] || useWeb.getState().webs[roomId]);
export const useHasLobby = (roomId: string | undefined) => {
  const lobby = useLobby((s) => (roomId ? !!s.lobbies[roomId] : false));
  const party = useParty((s) => (roomId ? !!s.parties[roomId] : false));
  const web = useWeb((s) => (roomId ? !!s.webs[roomId] : false));
  return lobby || party || web;
};

/** Opens a watch party lobby in your voice room and goes in. */
export function startLobby(roomId: string) {
  if (!hasLobby(roomId)) hubFor()?.send({ t: 'lobby.open', roomId, kind: 'watch' });
  enterLobby(roomId);
}

/** Joins a room's lobby: into its call first if you're elsewhere, then the lobby view. */
export async function joinLobby(channelId: string, roomId: string) {
  if (useVoice.getState().roomId !== roomId) {
    if (!(await confirmCallSwitch(channelId))) return;
    await voice.join(channelId, roomId, { confirmed: true });
  }
  if (useChannels.getState().channels.find((c) => c.id === channelId)?.kind === 'space') useChannels.getState().selectRoom(channelId, roomId);
  enterLobby(roomId);
}

function enterLobby(roomId: string) {
  useUI.getState().set({ lobby: roomId, tab: 'home', focusedPeer: null });
}

/** Back to the app; the party goes on (the popcorn in the call bar brings you back). */
export const leaveLobby = () => useUI.getState().set({ lobby: null });

/** Ends the lobby (and what's playing) for everyone: the host, co-hosts or an admin. */
export function closeLobby(roomId: string) {
  hubFor()?.send({ t: 'lobby.close', roomId });
  leaveLobby();
}

// Leaving the call leaves the lobby view.
useVoice.subscribe((s, prev) => {
  const lobby = useUI.getState().lobby;
  if (lobby && s.roomId !== prev.roomId && s.roomId !== lobby) useUI.getState().set({ lobby: null });
});
