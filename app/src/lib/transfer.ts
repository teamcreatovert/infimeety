import type { Attachment, RtcPayload } from '../../../shared/protocol';
import { randomId } from './api';
import type { HubClient } from './hub';
import { localMedia, type SharedFile } from './platform';
import { allHubs } from './realtime';
import { iceNow } from './voice/engine';
import { Peer, type Signal } from './voice/peer';
import { useMedia } from '@/stores/media';

/**
 * Peer-to-peer media: chat attachments are streamed straight from the sender's disk
 * over a WebRTC data channel. Viewers keep them in memory only, so deleting the file
 * on the sender's PC removes it for everyone.
 */

const FRAME = 64 * 1024;
const READ = 1024 * 1024;
const HIGH_WATER = 8 * 1024 * 1024;
const MAX_UPLOADS = 3;
const REVOKED_KEY = 'infimeety.revoked';

interface Incoming {
  att: Attachment;
  peer?: Peer;
  ownerPeer?: string;
  chunks: ArrayBuffer[];
  received: number;
  lastProgress: number;
  timer: ReturnType<typeof setTimeout>;
}

const incoming = new Map<string, Incoming>();
const outgoing = new Map<string, Peer>();
let uploads = 0;
const waiting: (() => void)[] = [];

// ─── Viewer side ─────────────────────────────────────────────────────────────

export function requestMedia(hub: HubClient, att: Attachment) {
  const media = useMedia.getState();
  const status = media.items[att.id]?.status;
  if (status === 'requesting' || status === 'loading' || status === 'ready') return;
  if (att.removed) return media.setEntry(att.id, { status: 'gone' });

  const reqId = randomId(9);
  media.setEntry(att.id, { status: 'requesting', progress: 0 });
  incoming.set(reqId, { att, chunks: [], received: 0, lastProgress: 0, timer: setTimeout(() => fail(reqId, 'offline'), 9000) });
  hub.send({ t: 'media.request', ownerId: att.ownerId, attachmentId: att.id, reqId });
}

/** Own attachments load straight from disk (with video seeking) via the asset protocol. */
export async function resolveOwn(hub: HubClient, att: Attachment) {
  const media = useMedia.getState();
  if (media.items[att.id]?.status === 'ready') return;
  const file = localMedia.available ? await localMedia.stat(att.id).catch(() => null) : null;
  if (file) return media.setEntry(att.id, { status: 'ready', url: localMedia.src(file.path), local: true, progress: 1 });
  // Not on this PC: maybe it's on another of my devices.
  requestMedia(hub, att);
}

function fail(reqId: string, status: 'offline' | 'gone' | 'error') {
  const req = incoming.get(reqId);
  if (!req) return;
  clearTimeout(req.timer);
  req.peer?.close();
  incoming.delete(reqId);
  useMedia.getState().setEntry(req.att.id, { status, progress: 0 });
}

export function onMediaOffline(reqId: string) {
  fail(reqId, 'offline');
}

export function onTransferSignal(hub: HubClient, from: string, data: RtcPayload) {
  if (data.kind === 'media.reply') {
    // 'unknown' comes from my other devices that don't have the file: keep waiting.
    if (data.status === 'gone') fail(data.reqId, 'gone');
    return;
  }
  if (data.kind !== 'xfer') return;

  const out = outgoing.get(data.reqId);
  if (out) return void out.handle(data as Signal);

  const req = incoming.get(data.reqId);
  if (!req) return;
  if (!req.peer) {
    if (data.description?.type !== 'offer') return;
    req.ownerPeer = from;
    const reqId = data.reqId;
    req.peer = new Peer(from, true, iceNow(), (sig) =>
      hub.send({ t: 'rtc', to: from, data: { kind: 'xfer', reqId, ...sig } as RtcPayload }),
    );
    req.peer.pc.ondatachannel = (e) => receive(reqId, e.channel);
    stall(reqId);
  }
  if (req.ownerPeer === from) void req.peer.handle(data as Signal);
}

function stall(reqId: string) {
  const req = incoming.get(reqId);
  if (!req) return;
  clearTimeout(req.timer);
  req.timer = setTimeout(() => fail(reqId, 'error'), 20_000);
}

function receive(reqId: string, dc: RTCDataChannel) {
  const req = incoming.get(reqId);
  if (!req) return dc.close();
  dc.binaryType = 'arraybuffer';
  const media = useMedia.getState();
  media.setEntry(req.att.id, { status: 'loading', progress: 0 });

  dc.onmessage = (e) => {
    if (!incoming.has(reqId)) return;
    if (typeof e.data === 'string') {
      const msg = JSON.parse(e.data) as { done?: boolean; error?: string };
      if (msg.done) {
        clearTimeout(req.timer);
        const url = URL.createObjectURL(new Blob(req.chunks, { type: req.att.mime }));
        incoming.delete(reqId);
        media.setEntry(req.att.id, { status: 'ready', url, progress: 1 });
        setTimeout(() => req.peer?.close(), 500);
      } else if (msg.error) {
        fail(reqId, msg.error === 'gone' ? 'gone' : 'error');
      }
      return;
    }
    req.chunks.push(e.data);
    req.received += e.data.byteLength;
    if (req.received > req.att.size + 1024 * 1024) return fail(reqId, 'error');
    stall(reqId);
    const progress = req.att.size ? req.received / req.att.size : 0;
    if (progress - req.lastProgress > 0.02) {
      req.lastProgress = progress;
      media.setEntry(req.att.id, { progress });
    }
  };
  dc.onclose = () => {
    if (incoming.has(reqId)) fail(reqId, 'error');
  };
}

// ─── Owner side ──────────────────────────────────────────────────────────────

export async function onMediaRequest(hub: HubClient, msg: { from: string; attachmentId: string; reqId: string }) {
  if (!localMedia.available) return;
  const file = await localMedia.stat(msg.attachmentId).catch(() => null);
  if (!file) {
    const missing = await localMedia.missing().catch(() => [] as string[]);
    const gone = missing.includes(msg.attachmentId);
    hub.send({ t: 'rtc', to: msg.from, data: { kind: 'media.reply', reqId: msg.reqId, status: gone ? 'gone' : 'unknown' } });
    if (missing.length) revoke(missing);
    return;
  }
  if (uploads >= MAX_UPLOADS) await new Promise<void>((r) => waiting.push(r));
  uploads++;
  try {
    await serve(hub, msg.from, msg.reqId, file);
  } finally {
    uploads--;
    waiting.shift()?.();
  }
}

function serve(hub: HubClient, to: string, reqId: string, file: SharedFile) {
  return new Promise<void>((resolve) => {
    const peer = new Peer(to, false, iceNow(), (sig) => hub.send({ t: 'rtc', to, data: { kind: 'xfer', reqId, ...sig } as RtcPayload }));
    outgoing.set(reqId, peer);
    const dc = peer.pc.createDataChannel('file', { ordered: true });
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = 1024 * 1024;

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(connectTimeout);
      outgoing.delete(reqId);
      setTimeout(() => peer.close(), 2000);
      resolve();
    };
    const connectTimeout = setTimeout(finish, 25_000);

    dc.onopen = async () => {
      clearTimeout(connectTimeout);
      try {
        let offset = 0;
        while (offset < file.size) {
          const buf = await localMedia.read(file.id, offset, READ);
          if (!buf.byteLength) break;
          for (let i = 0; i < buf.byteLength; i += FRAME) {
            if (dc.readyState !== 'open') throw new Error('closed');
            if (dc.bufferedAmount > HIGH_WATER) {
              await new Promise<void>((r) => {
                dc.onbufferedamountlow = () => {
                  dc.onbufferedamountlow = null;
                  r();
                };
              });
            }
            dc.send(buf.slice(i, i + FRAME));
          }
          offset += buf.byteLength;
        }
        dc.send(JSON.stringify({ done: true }));
        while (dc.readyState === 'open' && dc.bufferedAmount > 0) await new Promise((r) => setTimeout(r, 100));
      } catch (err) {
        try {
          dc.send(JSON.stringify({ error: String(err).includes('gone') ? 'gone' : 'failed' }));
        } catch {
          /* channel closed */
        }
      }
      finish();
    };
    dc.onclose = finish;
  });
}

// ─── Revocation ──────────────────────────────────────────────────────────────

function revokedList(): string[] {
  try {
    return JSON.parse(localStorage.getItem(REVOKED_KEY) ?? '[]');
  } catch {
    return [];
  }
}

/** Tell every channel that these files are gone. Remembered so offline channels hear it later. */
export function revoke(ids: string[]) {
  const list = [...new Set([...revokedList(), ...ids])].slice(-500);
  localStorage.setItem(REVOKED_KEY, JSON.stringify(list));
  for (const hub of allHubs()) hub.send({ t: 'media.revoked', attachmentIds: ids });
  useMedia.getState().revoke(ids);
}

/** Re-announce recent revocations when a channel (re)connects. */
export function announceRevocations(hub: HubClient) {
  const list = revokedList();
  if (list.length) hub.send({ t: 'media.revoked', attachmentIds: list.slice(-100) });
}

let watcher: ReturnType<typeof setInterval> | undefined;

/** Polls the local registry for deleted files and revokes them. */
export function startRevocationWatcher() {
  if (!localMedia.available || watcher) return;
  const tick = async () => {
    const missing = await localMedia.missing().catch(() => [] as string[]);
    if (missing.length) revoke(missing);
  };
  watcher = setInterval(tick, 10_000);
  setTimeout(tick, 3000);
}
