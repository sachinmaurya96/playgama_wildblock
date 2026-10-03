/**
 * Peer-to-peer transports for PvP — no game server needed.
 *
 * Online: WebRTC data channels via PeerJS. The free public PeerJS cloud
 * (0.peerjs.com) is only used for the handshake ("signalling"); game traffic
 * then flows directly between the players' browsers. The host's peer id is
 * derived from the room code, so friends join with just the code.
 *
 * Local: BroadcastChannel between tabs of the same browser — for trying PvP
 * on one computer (and for automated tests). Same message flow as online.
 *
 * Topology: a star. Clients only talk to the host; the host relays.
 */

export type NetMsg = { t: string } & Record<string, unknown>;

export interface Transport {
  readonly selfId: string;
  readonly isHost: boolean;
  /** Client: to the host. Host: to one peer (`to`) or every client. */
  send(msg: NetMsg, to?: string): void;
  onMessage: (from: string, msg: NetMsg) => void;
  onPeerJoin: (id: string) => void;
  onPeerLeave: (id: string) => void;
  /** Lost the connection for good (host gone, signalling dead…). */
  onClosed: (reason: string) => void;
  peers(): string[];
  close(): void;
}

const ROOM_PREFIX = 'wildblocks-pvp-v1-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L confusion

export function makeRoomCode(): string {
  let s = '';
  const r = new Uint32Array(6);
  crypto.getRandomValues(r);
  for (const v of r) s += CODE_CHARS[v % CODE_CHARS.length];
  return s;
}

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

/** STUN finds a direct route between players. Add a TURN server (VITE_TURN_*) for strict networks. */
export function iceServers(): RTCIceServer[] {
  const list: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  if (env.VITE_TURN_URL) list.push({ urls: env.VITE_TURN_URL.split(','), username: env.VITE_TURN_USER, credential: env.VITE_TURN_PASS });
  return list;
}

function peerServerOptions(): Record<string, unknown> {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  // optional self-hosted PeerServer (e.g. a free Render/Glitch instance); default = PeerJS cloud
  if (env.VITE_PEER_HOST) return { host: env.VITE_PEER_HOST, port: Number(env.VITE_PEER_PORT || 443), path: env.VITE_PEER_PATH || '/', secure: env.VITE_PEER_SECURE !== 'false' };
  return {};
}

function friendlyPeerError(type: string): string {
  switch (type) {
    case 'peer-unavailable': return 'Room not found. Check the code — the host must keep the game open.';
    case 'unavailable-id': return 'That room code is already in use.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed': return 'Could not reach the connection service. Check your internet connection and try again.';
    case 'browser-incompatible': return 'This browser does not support peer-to-peer games (WebRTC).';
    case 'webrtc': return 'Could not open a direct connection to the other player (strict network / firewall).';
    default: return `Connection problem (${type}).`;
  }
}

// ---------------------------------------------------------------- PeerJS (online)

type PeerLike = import('peerjs').Peer;
type ConnLike = import('peerjs').DataConnection;

class PeerTransport implements Transport {
  onMessage: Transport['onMessage'] = () => {};
  onPeerJoin: Transport['onPeerJoin'] = () => {};
  onPeerLeave: Transport['onPeerLeave'] = () => {};
  onClosed: Transport['onClosed'] = () => {};
  private conns = new Map<string, ConnLike>();
  private closed = false;

  constructor(private peer: PeerLike, readonly isHost: boolean, hostConn: ConnLike | null) {
    peer.on('disconnected', () => {
      // lost the signalling socket: existing data channels keep working; try to reconnect quietly
      if (!this.closed && !peer.destroyed) {
        try {
          peer.reconnect();
        } catch {
          /* ignore */
        }
      }
    });
    if (isHost) {
      peer.on('connection', (c) => this.accept(c));
    } else if (hostConn) {
      this.wire(hostConn);
      this.conns.set(hostConn.peer, hostConn);
    }
  }

  get selfId(): string {
    return this.peer.id;
  }

  private accept(c: ConnLike) {
    if (this.conns.size >= 7) {
      c.on('open', () => {
        c.send({ t: 'full' });
        setTimeout(() => c.close(), 300);
      });
      return;
    }
    c.on('open', () => {
      this.conns.set(c.peer, c);
      this.onPeerJoin(c.peer);
    });
    this.wire(c);
  }

  private wire(c: ConnLike) {
    c.on('data', (d) => {
      if (d && typeof d === 'object' && typeof (d as NetMsg).t === 'string') this.onMessage(c.peer, d as NetMsg);
    });
    const gone = () => {
      if (!this.conns.has(c.peer)) return;
      this.conns.delete(c.peer);
      if (this.isHost) this.onPeerLeave(c.peer);
      else if (!this.closed) this.onClosed('The host left the match.');
    };
    c.on('close', gone);
    c.on('error', gone);
    // data channels sometimes die without a close event: watch the ICE state
    const pc = (c as unknown as { peerConnection?: RTCPeerConnection }).peerConnection;
    pc?.addEventListener?.('iceconnectionstatechange', () => {
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') gone();
    });
  }

  send(msg: NetMsg, to?: string): void {
    if (this.closed) return;
    if (!this.isHost) {
      for (const c of this.conns.values()) if (c.open) c.send(msg);
      return;
    }
    if (to) {
      const c = this.conns.get(to);
      if (c?.open) c.send(msg);
      return;
    }
    for (const c of this.conns.values()) if (c.open) c.send(msg);
  }

  peers(): string[] {
    return [...this.conns.keys()];
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const c of this.conns.values()) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
    this.conns.clear();
    try {
      this.peer.destroy();
    } catch {
      /* ignore */
    }
  }
}

async function loadPeer(): Promise<typeof import('peerjs').Peer> {
  const mod = await import('peerjs');
  return mod.Peer ?? (mod as unknown as { default: typeof import('peerjs').Peer }).default;
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(msg)), ms);
    p.then((v) => {
      clearTimeout(id);
      resolve(v);
    }, (e) => {
      clearTimeout(id);
      reject(e);
    });
  });
}

export async function hostOnline(code: string): Promise<Transport> {
  if (typeof RTCPeerConnection === 'undefined') throw new Error(friendlyPeerError('browser-incompatible'));
  const Peer = await loadPeer();
  const peer = new Peer(ROOM_PREFIX + code, { ...peerServerOptions(), config: { iceServers: iceServers() }, debug: 0 });
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      peer.once('open', () => resolve());
      peer.once('error', (e) => reject(new Error(friendlyPeerError(e.type))));
    }),
    15000,
    friendlyPeerError('network'),
  ).catch((e) => {
    peer.destroy();
    throw e;
  });
  const t = new PeerTransport(peer, true, null);
  peer.on('error', (e) => {
    // after start-up, only signalling-level errors matter to the host; clients come and go
    if (e.type === 'browser-incompatible') t.onClosed(friendlyPeerError(e.type));
  });
  return t;
}

export async function joinOnline(code: string): Promise<Transport> {
  if (typeof RTCPeerConnection === 'undefined') throw new Error(friendlyPeerError('browser-incompatible'));
  const Peer = await loadPeer();
  const peer = new Peer({ ...peerServerOptions(), config: { iceServers: iceServers() }, debug: 0 });
  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        peer.once('open', () => resolve());
        peer.once('error', (e) => reject(new Error(friendlyPeerError(e.type))));
      }),
      15000,
      friendlyPeerError('network'),
    );
    const conn = peer.connect(ROOM_PREFIX + code, { reliable: true, serialization: 'json' });
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        conn.once('open', () => resolve());
        peer.once('error', (e) => reject(new Error(friendlyPeerError(e.type))));
        conn.once('error', () => reject(new Error(friendlyPeerError('webrtc'))));
      }),
      20000,
      'Could not connect to that room. Check the code, and that the host still has the game open.',
    );
    return new PeerTransport(peer, false, conn);
  } catch (e) {
    peer.destroy();
    throw e;
  }
}

// ---------------------------------------------------------------- BroadcastChannel (same device)

class LocalTransport implements Transport {
  onMessage: Transport['onMessage'] = () => {};
  onPeerJoin: Transport['onPeerJoin'] = () => {};
  onPeerLeave: Transport['onPeerLeave'] = () => {};
  onClosed: Transport['onClosed'] = () => {};
  readonly selfId: string;
  private bc: BroadcastChannel;
  private known = new Map<string, number>();
  private hostId: string | null = null;
  private timer: number;
  private closed = false;

  constructor(code: string, readonly isHost: boolean) {
    this.selfId = (isHost ? 'host-' : 'p-') + Math.random().toString(36).slice(2, 9);
    this.bc = new BroadcastChannel(ROOM_PREFIX + code);
    this.bc.onmessage = (e: MessageEvent) => this.receive(e.data as { from: string; to?: string; kind: string; msg?: NetMsg });
    this.timer = window.setInterval(() => this.heartbeat(), 1000);
  }

  private post(kind: string, msg?: NetMsg, to?: string) {
    if (!this.closed) this.bc.postMessage({ from: this.selfId, to, kind, msg });
  }

  /** Client: knock until the host answers. */
  async connect(): Promise<void> {
    await withTimeout(
      new Promise<void>((resolve) => {
        const knock = () => this.post('knock');
        const id = window.setInterval(knock, 300);
        knock();
        this.onReady = () => {
          clearInterval(id);
          resolve();
        };
      }),
      15000,
      'No game with that code is open in another tab of this browser.',
    );
  }

  private onReady: (() => void) | null = null;

  private receive(d: { from: string; to?: string; kind: string; msg?: NetMsg }) {
    if (this.closed || d.from === this.selfId) return;
    if (d.to && d.to !== this.selfId) return;
    if (this.isHost) {
      if (d.kind === 'knock') {
        if (!this.known.has(d.from)) {
          if (this.known.size >= 7) return;
          this.known.set(d.from, performance.now());
          this.post('welcome-link', undefined, d.from);
          this.onPeerJoin(d.from);
        } else this.post('welcome-link', undefined, d.from);
        return;
      }
      if (!this.known.has(d.from)) return;
      this.known.set(d.from, performance.now());
      if (d.kind === 'bye') {
        this.known.delete(d.from);
        this.onPeerLeave(d.from);
      } else if (d.kind === 'msg' && d.msg) this.onMessage(d.from, d.msg);
    } else {
      if (d.kind === 'welcome-link') {
        this.hostId = d.from;
        this.known.set(d.from, performance.now());
        this.onReady?.();
        this.onReady = null;
        return;
      }
      if (d.from !== this.hostId) return;
      this.known.set(d.from, performance.now());
      if (d.kind === 'bye') this.onClosed('The host left the match.');
      else if (d.kind === 'msg' && d.msg) this.onMessage(d.from, d.msg);
    }
  }

  private heartbeat() {
    this.post('ping', undefined, this.isHost ? undefined : this.hostId ?? undefined);
    const now = performance.now();
    for (const [id, t] of this.known) {
      if (now - t < 20000) continue;
      this.known.delete(id);
      if (this.isHost) this.onPeerLeave(id);
      else this.onClosed('Lost connection to the host.');
    }
  }

  send(msg: NetMsg, to?: string): void {
    if (this.isHost) this.post('msg', msg, to);
    else if (this.hostId) this.post('msg', msg, this.hostId);
  }

  peers(): string[] {
    return [...this.known.keys()];
  }

  close(): void {
    if (this.closed) return;
    this.post('bye');
    this.closed = true;
    clearInterval(this.timer);
    this.bc.close();
  }
}

export async function hostLocal(code: string): Promise<Transport> {
  if (typeof BroadcastChannel === 'undefined') throw new Error('This browser cannot run two-tab games.');
  return new LocalTransport(code, true);
}

export async function joinLocal(code: string): Promise<Transport> {
  if (typeof BroadcastChannel === 'undefined') throw new Error('This browser cannot run two-tab games.');
  const t = new LocalTransport(code, false);
  try {
    await t.connect();
  } catch (e) {
    t.close();
    throw e;
  }
  return t;
}
