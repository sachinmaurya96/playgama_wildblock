import { seedFromString } from '../game/core/random';
import { DEFAULT_PVP_SETTINGS, usePvpStore, type PvpPlayerInfo, type PvpSettings } from '../stores/pvpStore';
import { hostLocal, hostOnline, joinLocal, joinOnline, makeRoomCode, normalizeCode, type NetMsg, type Transport } from './transport';

/**
 * The PvP connection that outlives menus: created on the PvP screen, then
 * handed to the in-game PvpSession (src/game/pvp). Messages that arrive while
 * the world is still loading are queued.
 */
export interface WelcomeMsg extends NetMsg {
  t: 'welcome';
  you: string;
  seedText: string;
  settings: PvpSettings;
  time: number;
  players: PvpPlayerInfo[];
  edits: [number, number, number, number][];
  timeLeft: number | null;
}

export class NetSession {
  readonly isHost: boolean;
  welcome: WelcomeMsg | null = null;
  private handler: ((from: string, msg: NetMsg) => void) | null = null;
  private queue: [string, NetMsg][] = [];
  onPeerLeave: (id: string) => void = () => {};
  onPeerJoin: (id: string) => void = () => {};
  onClosed: (reason: string) => void = () => {};
  closedReason: string | null = null;
  /** Host of an opened Build Home: the lot's objects (walls, furniture…), sent to each player who joins. */
  sourceObjects: unknown[] = [];

  constructor(readonly transport: Transport, readonly code: string, readonly online: boolean, readonly name: string, readonly color: string, public settings: PvpSettings) {
    this.settings = { ...settings, minutes: 0 };
    this.isHost = transport.isHost;
    transport.onMessage = (from, msg) => {
      if (this.handler) this.handler(from, msg);
      else this.queue.push([from, msg]);
    };
    transport.onPeerJoin = (id) => this.onPeerJoin(id);
    transport.onPeerLeave = (id) => this.onPeerLeave(id);
    transport.onClosed = (reason) => {
      this.closedReason = reason;
      this.onClosed(reason);
    };
  }

  get selfId(): string {
    return this.transport.selfId;
  }

  /** In-game session takes over; queued messages are delivered right away. */
  attach(fn: (from: string, msg: NetMsg) => void): void {
    this.handler = fn;
    const q = this.queue;
    this.queue = [];
    for (const [f, m] of q) fn(f, m);
  }

  /** Host: to everyone (or one client). Client: to the host. */
  send(msg: NetMsg, to?: string): void {
    this.transport.send(msg, to);
  }

  /** Host: relay to every client except one. */
  sendExcept(except: string, msg: NetMsg): void {
    for (const p of this.transport.peers()) if (p !== except) this.transport.send(msg, p);
  }

  get seed(): number {
    return seedFromString(this.settings.seedText);
  }

  close(): void {
    this.handler = null;
    this.transport.close();
  }
}

let current: NetSession | null = null;

export const pvpNet = {
  get current(): NetSession | null {
    return current;
  },
  leave(): void {
    current?.close();
    current = null;
    usePvpStore.getState().reset();
  },
};

/** Host a room: online (internet, via PeerJS) or local (two tabs on this device). */
export async function hostRoom(opts: { name: string; color: string; online: boolean; settings: PvpSettings }): Promise<NetSession> {
  pvpNet.leave();
  const settings = { ...DEFAULT_PVP_SETTINGS, ...opts.settings, minutes: 0 };
  if (settings.style === 'together') settings.building = true;
  if (!settings.seedText.trim()) settings.seedText = `arena-${Math.floor(Math.random() * 1e6)}`;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = makeRoomCode();
    try {
      const t = opts.online ? await hostOnline(code) : await hostLocal(code);
      current = new NetSession(t, code, opts.online, opts.name, opts.color, settings);
      return current;
    } catch (e) {
      lastErr = e;
      if (!String((e as Error).message).includes('already in use')) break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Could not create the room.');
}

/** Join a room by code; resolves once the host has sent the map seed and settings. */
export async function joinRoom(opts: { code: string; name: string; color: string; online: boolean }): Promise<NetSession> {
  pvpNet.leave();
  const code = normalizeCode(opts.code);
  if (code.length !== 6) throw new Error('Room codes have 6 letters/numbers.');
  const t = opts.online ? await joinOnline(code) : await joinLocal(code);
  try {
    const welcome = await new Promise<WelcomeMsg>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The host did not answer. Try again.')), 15000);
      t.onClosed = (reason) => {
        clearTimeout(timer);
        reject(new Error(reason));
      };
      t.onMessage = (_from, msg) => {
        if (msg.t === 'full') {
          clearTimeout(timer);
          reject(new Error('That match is full (8 players).'));
        } else if (msg.t === 'welcome') {
          clearTimeout(timer);
          resolve(msg as WelcomeMsg);
        }
      };
      t.send({ t: 'hello', name: opts.name, color: opts.color });
    });
    // re-wire the transport through the session (queueing until the game attaches)
    const s2 = new NetSession(t, code, opts.online, opts.name, opts.color, welcome.settings);
    s2.welcome = welcome;
    current = s2;
    return s2;
  } catch (e) {
    t.close();
    throw e;
  }
}
