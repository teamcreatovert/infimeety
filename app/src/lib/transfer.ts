import type { Attachment, RtcPayload } from '../../../shared/protocol';
import { randomId } from './api';
import type { HubClient } from './hub';
import { localMedia, type ReceiveTarget, type SharedFile } from './platform';
import { allHubs } from './realtime';
import { startReceive } from './saveFolder';
import { iceNow } from './voice/engine';
import { Peer, type Signal } from './voice/peer';
import { useMedia } from '@/stores/media';

/**
 * Peer-to-peer files. Chat attachments stream straight from the sender's device over WebRTC
 * data channels; nothing is uploaded. They're received one of two ways:
 * - into memory, for what the chat shows inline (images, videos, audio, subtitles);
 * - onto disk, for copies ("Copy" on a file, a watch party's movie): several connections at
 *   once ("lanes"), each with its own congestion window, so a copy can use all of the
 *   sender's upload. Each lane writes its parts of the file in place.
 *
 * Deleting the file on the sender's device removes it for everyone who hasn't copied it.
 */

/** Older apps only take 64 KB messages; Chromium takes 256 KB, which costs less per byte. */
const FRAME = 64 * 1024;
const BIG_FRAME = 256 * 1024;
/** A lane's unit of work, and the size of each read from disk. */
const CHUNK = 4 * 1024 * 1024;
/** Chromium closes a data channel whose send queue passes 16 MB, so stay well under it. */
const HIGH_WATER = 8 * 1024 * 1024;
const LOW_WATER = 2 * 1024 * 1024;
const MAX_UPLOADS = 4;
const MAX_LANES = 6;
const REVOKED_KEY = 'infimeety.revoked';

/** More lanes for bigger files: each one adds a connection's worth of throughput. */
export const lanesFor = (size: number) => (size < 8 * 1024 * 1024 ? 1 : size < 64 * 1024 * 1024 ? 2 : 4);

interface Lane {
  peer: Peer;
  /** Disk mode: frames waiting to be written, and where they start. */
  frames: Uint8Array[];
  framesLen: number;
  at: number;
  done: boolean;
  writes: Promise<void>;
}

interface Incoming {
  att: Attachment;
  target?: ReceiveTarget;
  lanes: Map<number, Lane>;
  /** How many lanes the sender opened (said in each lane's first message). */
  laneCount?: number;
  ownerPeer?: string;
  /** Memory mode: the file's bytes in order. */
  chunks: ArrayBuffer[];
  received: number;
  timer: ReturnType<typeof setTimeout>;
  meter?: ReturnType<typeof setInterval>;
  failed?: boolean;
}

const incoming = new Map<string, Incoming>();
const outgoing = new Map<string, Peer>();
let uploads = 0;
const waiting: (() => void)[] = [];
const laneKey = (reqId: string, lane: number) => `${reqId}#${lane}`;

// ─── Viewer side ─────────────────────────────────────────────────────────────

/** Streams a file into memory (chat media). */
export function requestMedia(hub: HubClient, att: Attachment) {
  const media = useMedia.getState();
  const status = media.items[att.id]?.status;
  if (status === 'requesting' || status === 'waiting' || status === 'loading' || status === 'ready') return;
  if (att.removed) return media.setEntry(att.id, { status: 'gone' });
  ask(hub, att, undefined, 1);
}

/**
 * Copies a file (or folder) from its owner straight onto this device's disk, into the save
 * folder (asked for the first time). Returns false if the user backed out of choosing one.
 * `handOver`: in a browser without a folder, download it when done (chat) or keep it (watch party).
 */
export async function copyFile(hub: HubClient, att: Attachment, { handOver = true } = {}) {
  const media = useMedia.getState();
  const status = media.items[att.id]?.status;
  if (status === 'requesting' || status === 'waiting' || status === 'loading') return true;
  if (att.removed) return void media.setEntry(att.id, { status: 'gone' }), true;
  const target = await startReceive(att, { folder: att.mime === 'inode/directory', handOver }).catch((err) => {
    media.setEntry(att.id, { status: 'error', progress: 0, problem: String(err?.message ?? err) });
    return undefined;
  });
  if (target === null) return false;
  if (!target) return true;
  ask(hub, att, target, lanesFor(att.size));
  return true;
}

/** Stops a copy in progress and deletes the partial file. */
export function cancelCopy(attId: string) {
  for (const [reqId, req] of incoming) if (req.att.id === attId) fail(reqId, 'idle');
}

function ask(hub: HubClient, att: Attachment, target: ReceiveTarget | undefined, lanes: number) {
  const reqId = randomId(9);
  useMedia.getState().setEntry(att.id, { status: 'requesting', progress: 0, speed: 0, where: target?.where, problem: undefined });
  incoming.set(reqId, { att, target, lanes: new Map(), chunks: [], received: 0, timer: setTimeout(() => fail(reqId, 'offline'), 9000) });
  hub.send({ t: 'media.request', ownerId: att.ownerId, attachmentId: att.id, reqId, lanes });
}

/** Own attachments load straight from disk (with video seeking) via the asset protocol. */
export async function resolveOwn(hub: HubClient, att: Attachment) {
  const media = useMedia.getState();
  if (media.items[att.id]?.status === 'ready') return;
  const file = localMedia.available ? await localMedia.stat(att.id).catch(() => null) : null;
  if (file) return media.setEntry(att.id, { status: 'ready', url: localMedia.src(file.path), local: true, progress: 1, savedId: file.id });
  // Not on this device: maybe it's on another of mine.
  requestMedia(hub, att);
}

function fail(reqId: string, status: 'offline' | 'gone' | 'error' | 'idle', problem?: string) {
  const req = incoming.get(reqId);
  if (!req || req.failed) return;
  req.failed = true;
  clearTimeout(req.timer);
  clearInterval(req.meter);
  for (const lane of req.lanes.values()) lane.peer.close();
  incoming.delete(reqId);
  void req.target?.close(false).catch(() => {});
  useMedia.getState().setEntry(req.att.id, { status, progress: 0, speed: 0, problem });
}

export function onMediaOffline(reqId: string) {
  fail(reqId, 'offline');
}

export function onTransferSignal(hub: HubClient, from: string, data: RtcPayload) {
  if (data.kind === 'media.reply') {
    const req = incoming.get(data.reqId);
    if (!req) return;
    // 'unknown' comes from the owner's other devices that don't have the file: keep waiting.
    if (data.status === 'gone') fail(data.reqId, 'gone');
    if (data.status === 'busy') {
      // The sender is busy sending to others; we're next in line.
      clearTimeout(req.timer);
      req.timer = setTimeout(() => fail(data.reqId, 'offline'), 15 * 60_000);
      useMedia.getState().setEntry(req.att.id, { status: 'waiting' });
    }
    return;
  }
  if (data.kind !== 'xfer') return;
  const lane = data.lane ?? 0;

  const out = outgoing.get(laneKey(data.reqId, lane));
  if (out) return void out.handle(data as Signal);

  const req = incoming.get(data.reqId);
  if (!req) return;
  let entry = req.lanes.get(lane);
  if (!entry) {
    if (data.description?.type !== 'offer') return;
    if (req.ownerPeer && req.ownerPeer !== from) return; // a second device of the owner answered too
    req.ownerPeer = from;
    const reqId = data.reqId;
    const peer = new Peer(from, true, iceNow(), (sig) => hub.send({ t: 'rtc', to: from, data: { kind: 'xfer', reqId, lane, ...sig } as RtcPayload }));
    entry = { peer, frames: [], framesLen: 0, at: 0, done: false, writes: Promise.resolve() };
    req.lanes.set(lane, entry);
    peer.pc.ondatachannel = (e) => receive(reqId, lane, e.channel);
    stall(reqId);
  }
  if (req.ownerPeer === from) void entry.peer.handle(data as Signal);
}

function stall(reqId: string) {
  const req = incoming.get(reqId);
  if (!req) return;
  clearTimeout(req.timer);
  req.timer = setTimeout(() => fail(reqId, 'error'), 20_000);
}

/** Progress and speed, a couple of times a second (not per message). */
function startMeter(req: Incoming) {
  if (req.meter) return;
  let last = { at: performance.now(), bytes: 0 };
  let speed = 0;
  req.meter = setInterval(() => {
    const now = performance.now();
    const rate = ((req.received - last.bytes) * 1000) / Math.max(1, now - last.at);
    speed = speed ? speed * 0.6 + rate * 0.4 : rate;
    last = { at: now, bytes: req.received };
    useMedia.getState().setEntry(req.att.id, { progress: req.att.size ? Math.min(1, req.received / req.att.size) : 0, speed });
  }, 500);
}

function flush(reqId: string, lane: Lane) {
  const req = incoming.get(reqId);
  if (!req?.target || !lane.framesLen) return;
  const data = new Uint8Array(lane.framesLen);
  let o = 0;
  for (const f of lane.frames) {
    data.set(f, o);
    o += f.byteLength;
  }
  const at = lane.at;
  lane.at += lane.framesLen;
  lane.frames = [];
  lane.framesLen = 0;
  const target = req.target;
  lane.writes = lane.writes.then(() => target.write(at, data)).catch((err) => fail(reqId, 'error', `Couldn't save: ${err?.message ?? err}`));
}

async function maybeFinish(reqId: string) {
  const req = incoming.get(reqId);
  if (!req) return;
  const total = req.laneCount ?? 1;
  const lanes = [...req.lanes.values()];
  if (lanes.length < total || lanes.some((l) => !l.done)) return;
  if (req.received !== req.att.size) return fail(reqId, 'error', 'The copy came out the wrong size');
  clearTimeout(req.timer);
  clearInterval(req.meter);
  incoming.delete(reqId);
  const media = useMedia.getState();
  setTimeout(() => lanes.forEach((l) => l.peer.close()), 500);
  if (!req.target) {
    const blob = new Blob(req.chunks, { type: req.att.mime });
    return media.setEntry(req.att.id, { status: 'ready', url: URL.createObjectURL(blob), blob, progress: 1, speed: 0 });
  }
  try {
    await Promise.all(lanes.map((l) => l.writes));
    media.setEntry(req.att.id, { status: 'saving', progress: 1, speed: 0 });
    const saved = await req.target.close(true);
    media.setEntry(req.att.id, {
      status: 'ready',
      progress: 1,
      speed: 0,
      savedId: saved?.id,
      url: saved?.path && /^(image|video|audio)\//.test(req.att.mime) ? localMedia.src(saved.path) : undefined,
    });
  } catch (err) {
    media.setEntry(req.att.id, { status: 'error', progress: 0, problem: String((err as Error)?.message ?? err) });
  }
}

function receive(reqId: string, laneNo: number, dc: RTCDataChannel) {
  const req = incoming.get(reqId);
  const lane = req?.lanes.get(laneNo);
  if (!req || !lane) return dc.close();
  dc.binaryType = 'arraybuffer';
  useMedia.getState().setEntry(req.att.id, { status: 'loading' });
  startMeter(req);

  dc.onmessage = (e) => {
    if (!incoming.has(reqId)) return;
    if (typeof e.data === 'string') {
      const msg = JSON.parse(e.data) as { lanes?: number; at?: number; done?: boolean; error?: string };
      if (msg.lanes) req.laneCount = Math.min(MAX_LANES, msg.lanes);
      if (msg.at !== undefined) {
        flush(reqId, lane);
        lane.at = msg.at;
      }
      if (msg.done) {
        flush(reqId, lane);
        lane.done = true;
        void maybeFinish(reqId);
      } else if (msg.error) {
        fail(reqId, msg.error === 'gone' ? 'gone' : 'error');
      }
      return;
    }
    const data = e.data as ArrayBuffer;
    req.received += data.byteLength;
    if (req.received > req.att.size + 1024 * 1024) return fail(reqId, 'error');
    stall(reqId);
    if (req.target) {
      lane.frames.push(new Uint8Array(data));
      lane.framesLen += data.byteLength;
      if (lane.framesLen >= CHUNK) flush(reqId, lane);
    } else {
      req.chunks.push(data);
    }
  };
  dc.onclose = () => {
    if (incoming.has(reqId) && !lane.done) fail(reqId, 'error');
  };
}

// ─── Owner side ──────────────────────────────────────────────────────────────

export async function onMediaRequest(hub: HubClient, msg: { from: string; attachmentId: string; reqId: string; lanes?: number }) {
  if (!localMedia.available) return;
  const file = await localMedia.stat(msg.attachmentId).catch(() => null);
  if (!file) {
    const missing = await localMedia.missing().catch(() => [] as string[]);
    const gone = missing.includes(msg.attachmentId);
    hub.send({ t: 'rtc', to: msg.from, data: { kind: 'media.reply', reqId: msg.reqId, status: gone ? 'gone' : 'unknown' } });
    if (missing.length) revoke(missing);
    return;
  }
  if (uploads >= MAX_UPLOADS) {
    hub.send({ t: 'rtc', to: msg.from, data: { kind: 'media.reply', reqId: msg.reqId, status: 'busy' } });
    await new Promise<void>((r) => waiting.push(r));
  }
  uploads++;
  try {
    const lanes = Math.max(1, Math.min(MAX_LANES, Math.floor(msg.lanes ?? 1)));
    await Promise.all(Array.from({ length: lanes }, (_, lane) => serveLane(hub, msg.from, msg.reqId, file, lane, lanes)));
  } finally {
    uploads--;
    waiting.shift()?.();
  }
}

/** One lane sends chunks lane, lane+lanes, lane+2·lanes… each preceded by where it goes. */
function serveLane(hub: HubClient, to: string, reqId: string, file: SharedFile, lane: number, lanes: number) {
  return new Promise<void>((resolve) => {
    const key = laneKey(reqId, lane);
    const peer = new Peer(to, false, iceNow(), (sig) => hub.send({ t: 'rtc', to, data: { kind: 'xfer', reqId, lane, ...sig } as RtcPayload }));
    outgoing.set(key, peer);
    const dc = peer.pc.createDataChannel('file', { ordered: true });
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = LOW_WATER;

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(connectTimeout);
      outgoing.delete(key);
      setTimeout(() => peer.close(), 2000);
      resolve();
    };
    const connectTimeout = setTimeout(finish, 25_000);
    const drained = () =>
      new Promise<void>((r) => {
        dc.onbufferedamountlow = () => {
          dc.onbufferedamountlow = null;
          r();
        };
      });

    dc.onopen = async () => {
      clearTimeout(connectTimeout);
      const max = peer.pc.sctp?.maxMessageSize ?? 0;
      const frame = max >= BIG_FRAME ? BIG_FRAME : FRAME;
      const chunks = Math.ceil(file.size / CHUNK);
      const read = (c: number) => localMedia.read(file.id, c * CHUNK, CHUNK);
      let next: Promise<ArrayBuffer> | null = lane < chunks ? read(lane) : null;
      next?.catch(() => {});
      try {
        dc.send(JSON.stringify({ lanes, lane }));
        for (let c = lane; c < chunks; c += lanes) {
          const buf = await next!;
          // Read the next chunk from disk while this one goes out.
          next = c + lanes < chunks ? read(c + lanes) : null;
          next?.catch(() => {});
          dc.send(JSON.stringify({ at: c * CHUNK }));
          for (let i = 0; i < buf.byteLength; i += frame) {
            if (dc.readyState !== 'open') throw new Error('closed');
            if (dc.bufferedAmount > HIGH_WATER) await drained();
            dc.send(new Uint8Array(buf, i, Math.min(frame, buf.byteLength - i)));
          }
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
