import type { ServerMsg } from '../../../shared/protocol';
import { HubClient, type HubStatus } from './hub';
import { onClock, onParties, onParty, onRequest, onStatus as onPartyStatus } from './party';
import { onSound } from './soundboard';
import { sounds } from './sounds';
import { announceRevocations, onMediaOffline, onMediaRequest, onTransferSignal } from './transfer';
import { voice } from './voice/engine';
import { useAuth } from '@/stores/auth';
import { useChannels } from '@/stores/channels';
import { useMeetings } from '@/stores/meetings';
import { useMessages } from '@/stores/messages';
import { useMedia } from '@/stores/media';
import { useSettings } from '@/stores/settings';
import { toast } from '@/stores/ui';
import { useVoice } from '@/stores/voice';

const hubs = new Map<string, HubClient>();

export const getHub = (channelId: string) => hubs.get(channelId);
export const allHubs = () => [...hubs.values()];

/** Keep exactly one live connection per channel the user belongs to. */
export function syncHubs(channelIds: string[]) {
  const wanted = new Set(channelIds);
  for (const [id, hub] of hubs) {
    if (!wanted.has(id)) {
      hub.close();
      hubs.delete(id);
    }
  }
  for (const id of wanted) if (!hubs.has(id)) hubs.set(id, new HubClient(id, onMessage, onStatus));
}

export function closeAllHubs() {
  for (const hub of hubs.values()) hub.close();
  hubs.clear();
}

window.addEventListener('online', () => hubs.forEach((h) => h.nudge()));
// Open sockets can't be hot-swapped; reload the page in dev instead of duplicating them.
import.meta.hot?.accept(() => location.reload());

/** Sends a plain text message as if typed in the room's message box. */
export function sendChat(channelId: string, roomId: string, content: string) {
  const me = useAuth.getState().me;
  const hub = getHub(channelId);
  if (!me || !hub) return false;
  const nonce = useMessages.getState().addPending(roomId, me.id, content, [], null);
  hub.send({ t: 'chat.send', roomId, content, attachments: [], replyTo: null, nonce });
  return true;
}

/** Switches the call to another voice room; the view follows if you were looking at the old one. */
export async function moveVoice(channelId: string, roomId: string) {
  const { roomId: from } = useVoice.getState();
  const channels = useChannels.getState();
  const viewingOld = channels.activeChannelId === channelId && channels.activeRoom[channelId] === from;
  await voice.join(channelId, roomId);
  if (viewingOld) channels.selectRoom(channelId, roomId);
}

function onStatus(hub: HubClient, status: HubStatus) {
  useChannels.setState((s) => ({ hubStatus: { ...s.hubStatus, [hub.channelId]: status } }));
}

function isViewing(roomId: string) {
  const s = useChannels.getState();
  const channel = s.channels.find((c) => c.id === s.activeChannelId);
  return document.hasFocus() && !!channel && s.activeRoom[channel.id] === roomId;
}

function onMessage(hub: HubClient, msg: ServerMsg) {
  const channels = useChannels.getState();
  const cid = hub.channelId;

  switch (msg.t) {
    case 'welcome':
      channels.set({ online: { ...channels.online, [cid]: msg.online }, voice: { ...channels.voice, [cid]: msg.voice } });
      voice.onWelcome(hub);
      onParties(msg.parties, channels.channels.find((c) => c.id === cid)?.rooms.map((r) => r.id) ?? []);
      announceRevocations(hub);
      if (channels.channels.some((c) => c.id === cid && c.kind === 'meeting' && c.role !== 'member')) void useMeetings.getState().loadWaiting(cid);
      return;
    case 'presence':
      return channels.set({ online: { ...channels.online, [cid]: msg.online } });
    case 'voice':
      channels.set({ voice: { ...channels.voice, [cid]: msg.voice } });
      return voice.onSnapshot(cid, msg.voice);
    case 'voice.kicked':
      if (useVoice.getState().channelId === cid) voice.leave({ kicked: true });
      return;
    case 'sound':
      if (useVoice.getState().channelId === cid) onSound(msg);
      return;
    case 'voice.moved': {
      if (useVoice.getState().channelId !== cid) return;
      const room = channels.channels.find((c) => c.id === cid)?.rooms.find((r) => r.id === msg.roomId);
      void moveVoice(cid, msg.roomId);
      toast({ kind: 'info', title: `An admin moved you to ${room?.name ?? 'another room'}` });
      return;
    }

    case 'chat.new': {
      useMessages.getState().receive(msg.message, msg.nonce);
      const mine = msg.message.userId === useAuth.getState().me?.id;
      if (mine) return;
      const settings = useSettings.getState();
      settings.setDmClosed(cid, false); // a closed DM comes back when they write again
      if (!isViewing(msg.message.roomId)) {
        useMessages.getState().bumpUnread(msg.message.roomId);
        if (settings.messageSounds && !settings.mutedChats[cid]) sounds.message();
      }
      return;
    }
    case 'chat.edited':
      return useMessages.getState().patch(msg.roomId, msg.id, { content: msg.content, editedAt: msg.editedAt });
    case 'chat.deleted':
      return useMessages.getState().remove(msg.roomId, msg.id);
    case 'chat.reactions':
      return useMessages.getState().patch(msg.roomId, msg.id, { reactions: msg.reactions });
    case 'chat.attachments':
      return useMessages.getState().patch(msg.roomId, msg.id, { attachments: msg.attachments });
    case 'typing':
      return channels.setTyping(msg.roomId, msg.userId);

    case 'rtc':
      if (msg.data.kind === 'voice') return voice.onSignal(cid, msg.from, msg.data);
      return onTransferSignal(hub, msg.from, msg.data);
    case 'media.request':
      return void onMediaRequest(hub, msg);
    case 'media.offline':
      return onMediaOffline(msg.reqId);
    case 'media.revoked':
      return useMedia.getState().revoke(msg.attachmentIds);

    case 'channel.changed':
      return void channels.refresh(cid).catch(() => {});
    case 'channel.removed': {
      const channel = channels.channels.find((c) => c.id === cid);
      if (useVoice.getState().channelId === cid) voice.leave({ silent: true });
      channels.removeLocal(cid);
      hubs.get(cid)?.close();
      hubs.delete(cid);
      if (channel?.kind === 'meeting') useMeetings.getState().onRemoved(cid);
      else if (channel) toast({ kind: 'info', title: `You're no longer in ${channel.name}` });
      return;
    }
    case 'member.updated':
      return channels.upsertUser(msg.user);

    case 'meeting.waiting':
      return useMeetings.getState().setWaiting(cid, msg.users);
    case 'meeting.cohost':
      return useMeetings.getState().onCohost(cid, msg.userId);
    case 'meeting.ended':
      return useMeetings.getState().onEnded(cid);
    case 'party':
      return onParty(msg.roomId, msg.party, msg.resolved);
    case 'party.status':
      return onPartyStatus(msg.roomId, msg.peerId, msg.userId, msg.status);
    case 'party.request':
      return onRequest({ id: msg.id, roomId: msg.roomId, from: msg.from, action: msg.action });
    case 'clock':
      return onClock(msg.c, msg.s);

    case 'error':
      return toast({ kind: 'error', title: msg.message });
  }
}
