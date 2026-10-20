import { DmServer } from '../game/deathmatch/DmServer';
import { preferences } from '../platform/storage';
import { DM_PROTOCOL, parseServerMsg, type ClientMsg, type ServerMsg } from '../game/deathmatch/Protocol';
import { useDeathmatchStore } from '../stores/deathmatchStore';
import { useGameStore } from '../stores/gameStore';
import { useVoiceStore } from '../stores/voiceStore';
import { VoiceChat } from './voice';
import { DM_ROOM_PREFIX, hostLocal, hostOnline, joinLocal, joinOnline, makeRoomCode, normalizeCode, type NetMsg, type Transport } from './transport';

/**
 * Deathmatch room connection — lives from "Create / Join Room" until the
 * player leaves, across the lobby, the match and "Play Again".
 *
 * Star topology over the existing PeerJS / BroadcastChannel transports. The
 * host runs the referee (DmServer) in this tab; its own player talks to it
 * through a local loopback, so the host plays by exactly the same rules as
 * everyone else. The referee ticks on a timer, not the render loop, so it keeps
 * running (throttled) even if the host's tab is in the background.
 */

const now = () => performance.now() / 1000;

export interface LaunchInfo {
  round: number;
  seed: number;
  spawn: [number, number, number, number] | null;
  late: boolean;
}

export class DmNet {
  readonly isHost: boolean;
  server: DmServer | null = null;
  selfId = '';
  token = '';
  round = 0;
  launch: LaunchInfo | null = null;
  /** Host clock − local clock (seconds). 0 on the host. */
  offset = 0;
  private bestRtt = Infinity;
  private handler: ((m: ServerMsg) => void) | null = null;
  private queue: ServerMsg[] = [];
  private timers: number[] = [];
  private closed = false;
  /** Voice chat (the shared voice mesh, signalled through the host) with team / all scopes. */
  voice: VoiceChat | null = null;
  /** Called by the launcher when the city should load (wired in app/launch). */
  onLaunch: (info: LaunchInfo) => void = () => {};

  constructor(readonly transport: Transport, readonly code: string, readonly online: boolean, readonly name: string) {
    this.isHost = transport.isHost;
    this.selfId = transport.selfId;
  }

  /** Estimated host clock now. */
  hostNow(): number {
    return now() + this.offset;
  }

  // ---------------------------------------------------------------- wiring

  startHost(minutes: number): void {
    const io = {
      now,
      send: (to: string | null, msg: ServerMsg, except?: string) => this.serverSend(to, msg, except),
      kick: (id: string, reason: string) => this.serverSend(id, { t: 'closed', reason }),
    };
    this.server = new DmServer(io, this.code, this.selfId, this.name, minutes);
    this.transport.onMessage = (from, msg) => {
      if (msg.t === 'v' || msg.t === 'vs') this.relayVoice(from, msg);
      else this.server?.receive(from, msg);
    };
    this.transport.onPeerJoin = () => { /* they introduce themselves with "hello" */ };
    this.transport.onPeerLeave = (id) => {
      this.voice?.drop(id);
      this.server?.leave(id);
    };
    this.transport.onClosed = (reason) => this.lost(reason);
    this.timers.push(window.setInterval(() => this.server?.tick(), 50));
    this.token = 'host';
    // the host's own player gets the lobby through the same messages as everyone else
    this.deliver({ t: 'welcome', you: this.selfId, token: 'host', lobby: this.server.room.snapshot(), v: DM_PROTOCOL });
    this.startVoice();
  }

  startClient(): void {
    this.transport.onMessage = (_from, msg) => {
      if (msg.t === 'v' || msg.t === 'vs') this.voiceIn(msg);
      else this.deliver(msg as unknown);
    };
    this.transport.onClosed = (reason) => this.lost(reason);
    const ping = () => this.send({ t: 'ping', c: now() });
    ping();
    this.timers.push(window.setInterval(ping, 2000));
    this.startVoice();
  }

  // ---------------------------------------------------------------- team voice

  /**
   * Listening starts on its own (as in PvP); the mic is only asked for when the player talks. Everyone in the
   * room is linked; the scopes decide who is heard (my team / all players) and who hears you.
   */
  private startVoice(): void {
    const v = new VoiceChat(this.selfId, (m) => this.voiceOut(m));
    v.proximityAllowed = false; // team radio: everyone at full volume, wherever they are
    v.useTeams((id) => useDeathmatchStore.getState().lobby?.players.find((p) => p.id === id)?.team);
    this.voice = v;
    let last = now();
    const here = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1 }, nowhere = new Map<string, { x: number; y: number; z: number }>();
    this.timers.push(window.setInterval(() => {
      const t = now();
      v.update(t - last, here, nowhere);
      last = t;
    }, 150));
    // roster for the voice controls; team changes re-route who hears our mic
    const sync = () => {
      const players = useDeathmatchStore.getState().lobby?.players ?? [];
      useVoiceStore.getState().set({ roster: players.map((p) => ({ id: p.id, name: p.name, color: p.team === 'red' ? '#ff6a5a' : '#5aa0ff', team: p.team })) });
      // someone left the room: hang up on them
      for (const id of useVoiceStore.getState().peers) if (!players.some((p) => p.id === id)) v.drop(id);
      v.refreshTeams();
    };
    sync();
    const off = useDeathmatchStore.subscribe((st, prev) => {
      if (st.lobby?.players !== prev.lobby?.players) sync();
    });
    this.offVoice = off;
    v.autoStart();
  }

  private offVoice: (() => void) | null = null;

  private voiceOut(m: NetMsg): void {
    if (this.closed) return;
    if (this.server && m.t === 'v' && typeof m.to === 'string') this.transport.send(m, m.to);
    else this.transport.send(m);
  }

  /** Host: pass voice signalling on between players (and take our own share). */
  private relayVoice(from: string, msg: NetMsg): void {
    msg.id = from;
    if (msg.t === 'v') {
      if (msg.to === this.selfId) this.voiceIn(msg);
      else if (typeof msg.to === 'string') this.transport.send(msg, msg.to);
      return;
    }
    for (const p of this.transport.peers()) if (p !== from) this.transport.send(msg, p);
    this.voiceIn(msg);
  }

  private voiceIn(msg: NetMsg): void {
    const v = this.voice;
    const id = String(msg.id ?? '');
    if (!v || !id || id === this.selfId) return;
    if (msg.t === 'v') {
      if (msg.to === this.selfId) void v.handleSignal(msg);
    } else v.handleState(msg);
  }


  private serverSend(to: string | null, msg: ServerMsg, except?: string): void {
    if (this.closed) return;
    const wire = msg as unknown as NetMsg;
    if (to === this.selfId) return this.deliverLocal(msg);
    if (to) return this.transport.send(wire, to);
    if (except) for (const p of this.transport.peers()) {
      if (p !== except) this.transport.send(wire, p);
    } else this.transport.send(wire);
    if (except !== this.selfId) this.deliverLocal(msg);
  }

  /** Loopback for the host's own player (async, like a real network message). */
  private deliverLocal(msg: ServerMsg): void {
    queueMicrotask(() => this.deliver(msg));
  }

  /** Client → host. */
  send(msg: ClientMsg): void {
    if (this.closed) return;
    if (this.server) {
      const id = this.selfId;
      queueMicrotask(() => this.server?.receive(id, msg));
    } else this.transport.send(msg as unknown as NetMsg);
  }

  /** The in-game session takes over gameplay messages (queued while the city loads). */
  attach(fn: ((m: ServerMsg) => void) | null): void {
    this.handler = fn;
    if (!fn) return;
    const q = this.queue.filter((m) => !('r' in m) || m.r === this.round);
    this.queue = [];
    for (const m of q) fn(m);
  }

  // ---------------------------------------------------------------- incoming

  private deliver(raw: unknown): void {
    if (this.closed) return;
    const msg = parseServerMsg(raw);
    if (!msg) {
      if ((raw as { t?: unknown })?.t === 'full') this.lost('That room is full (8 players).');
      return;
    }
    const st = useDeathmatchStore.getState();
    switch (msg.t) {
      case 'welcome':
        this.selfId = msg.you;
        this.token = msg.token;
        try {
          preferences.setItem(`wb-dm-token-${this.code}`, msg.token);
        } catch {
          /* ignore */
        }
        st.set({ conn: 'room', selfId: msg.you, lobby: msg.lobby, error: null });
        return;
      case 'reject':
        return this.lost(msg.reason === 'full' ? 'Room Full — that room already has 8 players.' : msg.reason === 'in_progress' ? 'Match in progress — wait for the next round and join again.' : 'Your game version does not match the host. Refresh the page.');
      case 'closed':
        return this.lost(msg.reason);
      case 'lobby': {
        const prev = st.lobby?.phase;
        st.set({ lobby: msg.lobby });
        // the host chose Play Again (or the match was cancelled): back to the team lobby
        if (msg.lobby.phase === 'lobby' && prev && prev !== 'lobby') this.backToLobby(null);
        return;
      }
      case 'teamRej':
        st.set({ teamError: msg.reason });
        setTimeout(() => useDeathmatchStore.getState().set({ teamError: null }), 3000);
        return;
      case 'startRej':
        st.set({ startError: msg.reason });
        setTimeout(() => useDeathmatchStore.getState().set({ startError: null }), 3500);
        return;
      case 'pong': {
        const t = now(), rtt = t - msg.c;
        if (rtt <= this.bestRtt * 1.3 || rtt < 0.05) {
          this.bestRtt = Math.min(this.bestRtt, rtt);
          this.offset = msg.h + rtt / 2 - t;
        }
        return;
      }
      case 'load': {
        this.round = msg.r;
        this.queue = [];
        this.launch = { round: msg.r, seed: msg.seed, spawn: msg.spawns[this.selfId] ?? null, late: !!msg.late };
        st.resetMatch();
        st.set({ lobby: msg.lobby, phase: 'loading' });
        this.onLaunch(this.launch);
        return;
      }
      case 'cancel':
        this.backToLobby(msg.reason);
        return;
    }
    if ('r' in msg && msg.r !== this.round) return;
    if (this.handler) this.handler(msg);
    else if (this.launch) {
      this.queue.push(msg);
      if (this.queue.length > 400) this.queue.splice(0, this.queue.length - 400);
    }
  }

  private backToLobby(reason: string | null): void {
    this.launch = null;
    this.queue = [];
    useDeathmatchStore.getState().resetMatch();
    if (reason) useDeathmatchStore.getState().set({ error: reason });
    const gs = useGameStore.getState();
    if (gs.screen !== 'deathmatch') gs.setScreen('deathmatch');
  }

  private lost(reason: string): void {
    if (this.closed) return;
    dmNet.leave();
    useDeathmatchStore.getState().set({ error: reason });
    const gs = useGameStore.getState();
    if (gs.screen !== 'deathmatch' && gs.screen !== 'menu') gs.setScreen('deathmatch');
  }

  close(): void {
    if (this.closed) return;
    if (this.server) {
      // tell everyone right away so nobody is left in a frozen match
      this.transport.send({ t: 'closed', reason: 'The host closed the room.' });
    }
    this.closed = true;
    this.offVoice?.();
    this.voice?.dispose();
    this.voice = null;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.handler = null;
    this.server = null;
    try {
      this.transport.close();
    } catch {
      /* ignore */
    }
  }
}

let current: DmNet | null = null;

export const dmNet = {
  get current(): DmNet | null {
    return current;
  },
  leave(): void {
    const c = current;
    current = null;
    c?.close();
    useDeathmatchStore.getState().reset();
  },
};

/** Room code from an invite link (?dm=CODE). */
export function dmInviteFromUrl(): string {
  try {
    return normalizeCode(new URLSearchParams(location.search).get('dm') ?? '');
  } catch {
    return '';
  }
}

export function dmInviteUrl(code: string): string {
  try {
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    u.searchParams.set('dm', code);
    return u.toString();
  } catch {
    return `?dm=${code}`;
  }
}

export async function hostDeathmatch(opts: { name: string; online: boolean; minutes: number }, onLaunch: (info: LaunchInfo) => void): Promise<DmNet> {
  dmNet.leave();
  useDeathmatchStore.getState().set({ conn: 'connecting', error: null });
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = makeRoomCode();
    try {
      const t = opts.online ? await hostOnline(code, DM_ROOM_PREFIX) : await hostLocal(code, DM_ROOM_PREFIX);
      const n = new DmNet(t, code, opts.online, opts.name);
      n.onLaunch = onLaunch;
      current = n;
      useDeathmatchStore.getState().set({ code, online: opts.online, isHost: true });
      n.startHost(opts.minutes);
      return n;
    } catch (e) {
      lastErr = e;
      if (!String((e as Error).message).includes('already in use')) break;
    }
  }
  useDeathmatchStore.getState().set({ conn: 'idle' });
  throw lastErr instanceof Error ? lastErr : new Error('Could not create the room.');
}

export async function joinDeathmatch(opts: { code: string; name: string; online: boolean }, onLaunch: (info: LaunchInfo) => void): Promise<DmNet> {
  dmNet.leave();
  const code = normalizeCode(opts.code);
  if (code.length !== 6) throw new Error('Room codes have 6 letters / numbers.');
  useDeathmatchStore.getState().set({ conn: 'connecting', error: null });
  let t: Transport;
  try {
    t = opts.online ? await joinOnline(code, DM_ROOM_PREFIX) : await joinLocal(code, DM_ROOM_PREFIX);
  } catch (e) {
    useDeathmatchStore.getState().set({ conn: 'idle' });
    throw e;
  }
  const n = new DmNet(t, code, opts.online, opts.name);
  n.onLaunch = onLaunch;
  current = n;
  useDeathmatchStore.getState().set({ code, online: opts.online, isHost: false });
  let token: string | undefined;
  try {
    token = preferences.getItem(`wb-dm-token-${code}`) ?? undefined;
  } catch {
    /* ignore */
  }
  n.startClient();
  n.send({ t: 'hello', name: opts.name, v: DM_PROTOCOL, token });
  // wait for the host's answer (welcome, or a clear rejection)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      dmNet.leave();
      reject(new Error('The host did not answer. Check the code and try again.'));
    }, 15000);
    const off = useDeathmatchStore.subscribe((s) => {
      if (s.conn === 'room') {
        clearTimeout(timer);
        off();
        resolve();
      } else if (s.error) {
        clearTimeout(timer);
        off();
        reject(new Error(s.error));
      }
    });
  });
  return n;
}

// Debug / automated play-test handle (like window.wildblocks): window.wildblocksDm.store.getState()
if (typeof window !== 'undefined') (window as unknown as { wildblocksDm?: unknown }).wildblocksDm = { store: useDeathmatchStore, net: dmNet };
