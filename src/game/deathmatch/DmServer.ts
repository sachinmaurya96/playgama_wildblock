import { mulberry32, seedFromString } from '../core/random';
import { HEALTH_STATIONS, LOOT_POINTS, PLAY_HALF, cityBlueprint, spawnPoints, type CityBlueprint, type Team } from './DeathmatchMap';
import { DmRoom, LOAD_TIMEOUT_SECONDS, PREP_SECONDS, PROTECT_SECONDS, RESPAWN_SECONDS, type RoomPlayer } from './DeathmatchRules';
import { effectiveSpread, rayPlayers, shotSeed, spreadDirs, traceVoxels, type Target, type Vec } from './HitDetection';
import { LootManager, applyPickup, pickupBlock, type LootItem } from './LootManager';
import { computeResult, type MatchResult } from './MatchResults';
import { DM_PROTOCOL, parseClientMsg, type ClientMsg, type ServerMsg } from './Protocol';
import { chooseSpawn } from './SpawnManager';
import { GUNS, GUN_IDS, HEALTH_STATION, LARGE_MEDKIT, MAX_HP, SMALL_MEDKIT, SWORD, falloff, type GunId, type WeaponId } from './WeaponDefinitions';
import { Arsenal } from './WeaponSystem';

/**
 * The Deathmatch referee. Runs only on the host's device and is the single
 * source of truth for: roster & teams, match phases and clock, health,
 * eliminations, scores, loadouts, pickups and respawns.
 *
 * Clients send inputs (I moved here, I fired this way, I want that pickup);
 * the referee checks them against its own state and announces outcomes. It is
 * fair for casual play — a peer-hosted game can never be fully cheat-proof
 * (the host itself could cheat), and nothing here claims otherwise.
 *
 * No DOM / three.js / timers inside: the host calls tick() regularly and
 * provides send() + now(), which also makes this class directly testable.
 */
export interface ServerIO {
  /** to = player id, or null = everyone (the host's own client included). `except` skips one player. */
  send(to: string | null, msg: ServerMsg, except?: string): void;
  /** Seconds, monotonic. */
  now(): number;
  /** Drop a player's connection (load timeout). */
  kick?(id: string, reason: string): void;
}

const SNAP_HZ = 15;
const MAX_REWIND = 0.3;
const INTERP = 0.1;
const MAX_SPEED = 12.5;

interface MatchPlayer {
  id: string;
  team: Team;
  name: string;
  hp: number;
  alive: boolean;
  spawned: boolean;
  ready: boolean;
  kills: number;
  deaths: number;
  damage: number;
  arsenal: Arsenal;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  w: WeaponId;
  flags: number;
  move: number;
  speed: number;
  hist: { t: number; x: number; y: number; z: number; crouch: boolean }[];
  lastSt: number;
  lastSeq: number;
  lastFireAt: number;
  protUntil: number;
  respawnAt: number;
  heal: { size: 'small' | 'large'; endsAt: number } | null;
  lastHit: { by: string; at: number; w: string } | null;
  lastInvSent: number;
}

export class DmServer {
  readonly room: DmRoom;
  private players = new Map<string, MatchPlayer>();
  private tokens = new Map<string, string>();
  private departed = new Map<string, { p: RoomPlayer; mp: MatchPlayer; round: number }>();
  private city: CityBlueprint | null = null;
  private loot: LootManager | null = null;
  private seed = 0;
  private loadDeadline = 0;
  private prepEndsAt = 0;
  private startAt = 0;
  private endAt = 0;
  private snapTimer = 0;
  private lastTick = 0;
  private red = 0;
  private blue = 0;
  private stations = new Map<string, number>();
  private rnd = mulberry32(Date.now() >>> 0);
  result: MatchResult | null = null;

  constructor(readonly io: ServerIO, readonly code: string, readonly hostId: string, hostName: string, minutes?: number) {
    this.room = new DmRoom(code, hostId, hostName, minutes);
    this.tokens.set(hostId, this.makeToken());
  }

  get phase() {
    return this.room.phase;
  }

  get round(): number {
    return this.room.round;
  }

  private makeToken(): string {
    return Math.floor(this.rnd() * 2 ** 32).toString(36) + Math.floor(this.rnd() * 2 ** 32).toString(36);
  }

  private broadcastLobby(): void {
    this.io.send(null, { t: 'lobby', lobby: this.room.snapshot() });
  }

  /** Test / debug view of one player's authoritative state. */
  debugPlayer(id: string): MatchPlayer | undefined {
    return this.players.get(id);
  }

  scores(): { red: number; blue: number } {
    return { red: this.red, blue: this.blue };
  }

  lootItems(): LootItem[] {
    return this.loot ? [...this.loot.items.values()] : [];
  }

  // ---------------------------------------------------------------- connection events

  receive(from: string, raw: unknown): void {
    const msg = parseClientMsg(raw);
    if (!msg) return;
    if (msg.t === 'hello') return this.hello(from, msg);
    if (msg.t === 'ping') return this.io.send(from, { t: 'pong', c: msg.c, h: this.io.now() });
    if (!this.room.players.has(from)) return;
    switch (msg.t) {
      case 'team': {
        const r = this.room.requestTeam(from, msg.team);
        if (r.ok) this.broadcastLobby();
        else if (r.reason !== 'same') this.io.send(from, { t: 'teamRej', reason: r.reason === 'full' ? 'That team is full (4 players).' : 'Teams are locked now.' });
        return;
      }
      case 'minutes':
        if (from === this.hostId && this.room.setMinutes(msg.m)) this.broadcastLobby();
        return;
      case 'start': return this.start(from);
      case 'again': return this.again(from);
    }
    if (msg.r !== this.room.round) return; // stale: another round
    switch (msg.t) {
      case 'ready': return this.ready(from);
      case 'respawn': return this.requestRespawn(from);
      case 'st': return this.state(from, msg);
      case 'fire': return this.fire(from, msg);
      case 'melee': return this.melee(from, msg);
      case 'reload': return this.reload(from);
      case 'equip': return this.equip(from, msg.slot);
      case 'pick': return this.pick(from, msg.lid);
      case 'heal': return this.healStart(from, msg.size);
      case 'station': return this.station(from, msg.sid);
      case 'env': return this.env(from, msg.amt);
    }
  }

  private hello(from: string, msg: Extract<ClientMsg, { t: 'hello' }>): void {
    if (msg.v !== DM_PROTOCOL) return this.io.send(from, { t: 'reject', reason: 'version' });
    // coming back after a dropped connection during the match?
    const back = msg.token ? this.departed.get(msg.token) : undefined;
    if (back && back.round === this.room.round && (this.room.phase === 'playing' || this.room.phase === 'preparing')) {
      this.departed.delete(msg.token!);
      const p: RoomPlayer = { ...back.p, id: from, connected: true };
      this.room.rejoin(p);
      this.tokens.set(from, msg.token!);
      const mp: MatchPlayer = { ...back.mp, id: from, ready: false, spawned: false, alive: false, hist: [] };
      this.players.set(from, mp);
      this.io.send(from, { t: 'welcome', you: from, token: msg.token!, lobby: this.room.snapshot(), v: DM_PROTOCOL });
      this.io.send(from, { t: 'load', r: this.room.round, seed: this.seed, lobby: this.room.snapshot(), spawns: {}, late: true });
      this.broadcastLobby();
      return;
    }
    const res = this.room.join(from, msg.name);
    if (!res.ok) return this.io.send(from, { t: 'reject', reason: res.reason });
    const token = this.makeToken();
    this.tokens.set(from, token);
    this.io.send(from, { t: 'welcome', you: from, token, lobby: this.room.snapshot(), v: DM_PROTOCOL });
    this.broadcastLobby();
  }

  leave(id: string): void {
    const rp = this.room.leave(id);
    const mp = this.players.get(id);
    this.players.delete(id);
    if (!rp) return;
    const token = this.tokens.get(id);
    this.tokens.delete(id);
    const ph = this.room.phase;
    if ((ph === 'playing' || ph === 'preparing') && mp && token) this.departed.set(token, { p: rp, mp, round: this.room.round });
    if (ph === 'loading' || ph === 'preparing') {
      if (!this.room.viable()) return this.cancel('A team is empty — back to the lobby.');
      this.broadcastLobby();
      this.checkReady();
      return;
    }
    if (ph === 'playing') {
      this.broadcastLobby();
      if (!this.room.viable()) this.end('forfeit');
      return;
    }
    this.broadcastLobby();
  }

  // ---------------------------------------------------------------- lifecycle

  private start(from: string): void {
    const chk = this.room.startCheck(from);
    if (!chk.ok) return this.io.send(from, { t: 'startRej', reason: chk.reason });
    this.room.transition('loading');
    this.seed = seedFromString(`${this.code}-${this.room.round}`);
    this.city = cityBlueprint(this.seed);
    this.loot = new LootManager(LOOT_POINTS, this.seed);
    this.players.clear();
    this.departed.clear();
    this.red = this.blue = 0;
    this.result = null;
    this.stations.clear();
    const spawns: Record<string, [number, number, number, number]> = {};
    const used: Record<Team, number> = { red: 0, blue: 0 };
    for (const p of this.room.snapshot().players) {
      const sp = spawnPoints(p.team)[used[p.team]++ % 8];
      spawns[p.id] = [sp.x, sp.y, sp.z, sp.yaw];
      this.players.set(p.id, this.newPlayer(p, sp.x, sp.y, sp.z, sp.yaw));
    }
    this.loadDeadline = this.io.now() + LOAD_TIMEOUT_SECONDS;
    this.io.send(null, { t: 'load', r: this.room.round, seed: this.seed, lobby: this.room.snapshot(), spawns });
  }

  private newPlayer(p: RoomPlayer, x: number, y: number, z: number, yaw: number): MatchPlayer {
    return {
      id: p.id, team: p.team, name: p.name, hp: MAX_HP, alive: true, spawned: true, ready: false, kills: 0, deaths: 0, damage: 0,
      arsenal: new Arsenal({ tolerance: 0.06, reloadScale: 0.85, equipDelay: 0.15 }),
      x, y, z, yaw, pitch: 0, w: 'sword', flags: 2, move: 0, speed: 0, hist: [], lastSt: 0, lastSeq: -1, lastFireAt: -1,
      protUntil: 0, respawnAt: 0, heal: null, lastHit: null, lastInvSent: 0,
    };
  }

  private ready(id: string): void {
    const mp = this.players.get(id);
    if (!mp) return;
    mp.ready = true;
    if (this.room.phase === 'playing' && !mp.spawned) {
      if (mp.respawnAt > 0) {
        // Reconnecting must not revive someone who was waiting to respawn.
        mp.spawned = true;
        this.io.send(id, { t: 'kill', r: this.room.round, v: id, k: null, w: 'city', head: false, red: this.red, blue: this.blue, respawnAt: mp.respawnAt });
      } else this.respawn(mp);
      this.sendLoot(id);
      this.io.send(id, { t: 'go', r: this.room.round, startAt: this.startAt, endAt: this.endAt });
      return;
    }
    this.checkReady();
  }

  private checkReady(): void {
    if (this.room.phase !== 'loading') return;
    if ([...this.players.values()].every((p) => p.ready)) this.beginPrep();
  }

  private beginPrep(): void {
    if (!this.room.viable()) return this.cancel('A team is empty — back to the lobby.');
    this.room.transition('preparing');
    this.prepEndsAt = this.io.now() + PREP_SECONDS;
    this.io.send(null, { t: 'prep', r: this.room.round, endsAt: this.prepEndsAt });
    this.broadcastLobby();
  }

  private go(): void {
    const now = this.io.now();
    this.room.transition('playing');
    this.startAt = now;
    this.endAt = now + this.room.minutes * 60;
    for (const mp of this.players.values()) {
      mp.protUntil = now + PROTECT_SECONDS;
      this.sendInv(mp, true);
    }
    this.io.send(null, { t: 'go', r: this.room.round, startAt: this.startAt, endAt: this.endAt });
    const items = this.loot!.reset();
    this.io.send(null, { t: 'loot', r: this.room.round, items: items.map((i) => [i.lid, i.kind, i.x, i.y, i.z]), reset: true });
    this.broadcastLobby();
  }

  private sendLoot(to: string): void {
    if (!this.loot) return;
    this.io.send(to, { t: 'loot', r: this.room.round, items: [...this.loot.items.values()].map((i) => [i.lid, i.kind, i.x, i.y, i.z]), reset: true });
  }

  private cancel(reason: string): void {
    if (!['loading', 'preparing', 'playing'].includes(this.room.phase)) return;
    this.room.transition('lobby');
    this.players.clear();
    this.io.send(null, { t: 'cancel', reason });
    this.broadcastLobby();
  }

  private end(reason: MatchResult['reason']): void {
    if (this.room.phase !== 'playing') return;
    this.room.transition('ended');
    for (const mp of this.players.values()) mp.heal = null;
    const stats = [...this.players.values()].map((p) => ({ id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, damage: Math.round(p.damage) }));
    for (const d of this.departed.values()) if (d.round === this.room.round) stats.push({ id: d.mp.id, name: d.mp.name, team: d.mp.team, kills: d.mp.kills, deaths: d.mp.deaths, damage: Math.round(d.mp.damage) });
    // team scores are counted live (kills by players who left still count)
    this.result = computeResult(stats, this.red, this.blue, this.io.now() - this.startAt, reason);
    this.io.send(null, { t: 'end', r: this.room.round, result: this.result });
    this.broadcastLobby();
  }

  /** Host: back to the team lobby for another round (scores, loot and loadouts all reset). */
  private again(from: string): void {
    if (from !== this.hostId || this.room.phase !== 'ended') return;
    this.room.transition('lobby');
    this.players.clear();
    this.departed.clear();
    this.loot = null;
    this.red = this.blue = 0;
    this.broadcastLobby();
  }

  // ---------------------------------------------------------------- per tick

  tick(): void {
    const now = this.io.now();
    const dt = this.lastTick ? Math.min(1, now - this.lastTick) : 0;
    this.lastTick = now;
    const ph = this.room.phase;
    if (ph === 'loading' && now >= this.loadDeadline) {
      // players who never finished loading are dropped; start with the rest if the teams still work
      for (const mp of [...this.players.values()]) if (!mp.ready) {
        this.io.kick?.(mp.id, 'Loading the city took too long.');
        this.room.leave(mp.id);
        this.players.delete(mp.id);
      }
      if (!this.room.viable() || this.players.size < 2) this.cancel('Not enough players finished loading.');
      else this.beginPrep();
    }
    if (ph === 'preparing' && now >= this.prepEndsAt) this.go();
    if (this.room.phase === 'playing') {
      for (const mp of this.players.values()) {
        const reloaded = mp.arsenal.update(now);
        if (reloaded) this.sendInv(mp);
        if (mp.heal && now >= mp.heal.endsAt) this.healFinish(mp);
      }
      const l = this.loot!.tick(now);
      if (l.added.length) this.io.send(null, { t: 'loot', r: this.room.round, items: l.added.map((i) => [i.lid, i.kind, i.x, i.y, i.z]), reset: false });
      for (const lid of l.removed) this.io.send(null, { t: 'lootGone', r: this.room.round, lid, by: null });
      if (now >= this.endAt) this.end('time');
    }
    if (['preparing', 'playing', 'ended', 'loading'].includes(this.room.phase)) {
      this.snapTimer -= dt;
      if (this.snapTimer <= 0) {
        this.snapTimer = 1 / SNAP_HZ;
        this.snapshot(now);
      }
    }
  }

  private snapshot(now: number): void {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const l = [...this.players.values()].filter((p) => p.spawned).map((p) => [p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), r2(p.pitch), p.w, p.flags, r2(p.move), Math.ceil(p.hp), p.alive ? 1 : 0, p.protUntil > now ? 1 : 0, p.kills, p.deaths]);
    this.io.send(null, { t: 'ss', r: this.room.round, l, h: now });
  }

  // ---------------------------------------------------------------- movement

  private state(id: string, m: Extract<ClientMsg, { t: 'st' }>): void {
    const mp = this.players.get(id);
    const ph = this.room.phase;
    if (!mp || !mp.spawned || !(ph === 'preparing' || ph === 'playing' || ph === 'ended')) return;
    const now = this.io.now();
    const [x, y, z] = m.p;
    if (mp.alive) {
      // a long silence never earns a long move: speed is judged over at most half a second
      const dt = Math.min(0.5, Math.max(0.03, now - mp.lastSt));
      const horiz = Math.hypot(x - mp.x, z - mp.z);
      const bad = Math.abs(x) > PLAY_HALF + 1 || Math.abs(z) > PLAY_HALF + 1 || y < 30 || y > 80
        || (ph === 'preparing' ? horiz > 1.5 : horiz > MAX_SPEED * dt + 1.5);
      if (bad) {
        this.io.send(id, { t: 'correct', r: this.room.round, p: [mp.x, mp.y, mp.z] });
        mp.lastSt = now;
        return;
      }
      mp.speed = horiz / dt;
      mp.x = x;
      mp.y = y;
      mp.z = z;
    }
    mp.lastSt = now;
    mp.yaw = m.yw;
    mp.pitch = m.pt;
    mp.flags = m.f;
    mp.move = m.m;
    mp.w = mp.arsenal.weapon; // what they really hold, not what they claim
    mp.hist.push({ t: now, x: mp.x, y: mp.y, z: mp.z, crouch: (m.f & 1) !== 0 });
    while (mp.hist.length > 2 && mp.hist[0].t < now - 1) mp.hist.shift();
  }

  /** Where a player was at host time t (bounded lag compensation). */
  private posAt(mp: MatchPlayer, t: number): Target {
    const h = mp.hist;
    let best = { x: mp.x, y: mp.y, z: mp.z, crouch: (mp.flags & 1) !== 0 };
    for (let i = h.length - 1; i >= 0; i--) {
      if (h[i].t <= t) {
        const a = h[i], b = h[i + 1];
        if (b) {
          const k = (t - a.t) / Math.max(1e-3, b.t - a.t);
          best = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, crouch: a.crouch };
        } else best = { ...a };
        break;
      }
    }
    return { id: mp.id, ...best };
  }

  private rewindTargets(shooter: MatchPlayer, at: number): Target[] {
    const now = this.io.now();
    const t = Math.max(now - MAX_REWIND, Math.min(now, at - INTERP));
    const out: Target[] = [];
    for (const p of this.players.values()) if (p.id !== shooter.id && p.alive && p.spawned && p.team !== shooter.team) out.push(this.posAt(p, t));
    return out;
  }

  // ---------------------------------------------------------------- combat

  private canAct(mp: MatchPlayer | undefined): mp is MatchPlayer {
    return !!mp && this.room.phase === 'playing' && mp.alive && mp.spawned;
  }

  private fire(id: string, m: Extract<ClientMsg, { t: 'fire' }>): void {
    const mp = this.players.get(id);
    if (!this.canAct(mp)) return;
    const now = this.io.now();
    if (m.s <= mp.lastSeq) return; // replay / duplicate
    if (m.w !== mp.arsenal.gun || mp.arsenal.canFire(now)) return this.sendInv(mp);
    mp.lastSeq = m.s;
    mp.arsenal.fire(now);
    mp.lastFireAt = now;
    mp.protUntil = 0; // attacking ends spawn protection
    if (mp.heal?.size === 'large') this.cancelHeal(mp, 'Interrupted by firing');
    const def = GUNS[m.w];
    // the shot starts at the shooter's eye as the host knows it (client origin only if close)
    const eye: Vec = [mp.x, mp.y + ((mp.flags & 1) ? 1.25 : 1.5), mp.z];
    const o: Vec = Math.hypot(m.o[0] - eye[0], m.o[1] - eye[1], m.o[2] - eye[2]) < 2.5 ? m.o : eye;
    const spread = effectiveSpread(def.spreadHip, def.spreadAds, { aiming: m.ads, speed: mp.speed, airborne: (mp.flags & 2) === 0, crouch: (mp.flags & 1) !== 0 });
    const dirs = spreadDirs(m.d, spread, def.pellets, shotSeed(id, this.room.round, m.s));
    const targets = this.rewindTargets(mp, m.at);
    const per = new Map<string, { n: number; head: boolean }>();
    const ends: Vec[] = [], hits: boolean[] = [];
    for (const d of dirs) {
      const wall = traceVoxels(o, d, def.maxRange, (x, y, z) => this.city!.blockAt(x, y, z));
      const hit = rayPlayers(o, d, wall.dist, targets);
      const dist = hit ? hit.dist : wall.dist;
      ends.push([o[0] + d[0] * dist, o[1] + d[1] * dist, o[2] + d[2] * dist]);
      hits.push(!!hit);
      if (!hit) continue;
      const n = def.damage * falloff(def, hit.dist) * (hit.head ? def.headMultiplier : 1);
      const cur = per.get(hit.id) ?? { n: 0, head: false };
      cur.n += n;
      cur.head ||= hit.head;
      per.set(hit.id, cur);
    }
    const r2 = (v: number) => Math.round(v * 100) / 100;
    this.io.send(null, { t: 'shot', r: this.room.round, id, w: m.w, o: [r2(o[0]), r2(o[1]), r2(o[2])], ends: ends.map((e) => [r2(e[0]), r2(e[1]), r2(e[2])]), hits }, id);
    for (const [vid, h] of per) this.damage(vid, id, h.n, h.head, m.w, eye);
    if (mp.arsenal.mag(m.w) === 0) this.sendInv(mp);
  }

  private melee(id: string, m: Extract<ClientMsg, { t: 'melee' }>): void {
    const mp = this.players.get(id);
    if (!this.canAct(mp)) return;
    const now = this.io.now();
    if (m.s <= mp.lastSeq || !mp.arsenal.melee(now)) return;
    mp.lastSeq = m.s;
    mp.protUntil = 0;
    this.io.send(null, { t: 'swing', r: this.room.round, id }, id);
    const eye: Vec = [mp.x, mp.y + 1.5, mp.z];
    const targets = this.rewindTargets(mp, m.at);
    const wall = traceVoxels(eye, m.d, SWORD.range + 0.6, (x, y, z) => this.city!.blockAt(x, y, z));
    let hit = rayPlayers(eye, m.d, wall.dist, targets.map((t) => ({ ...t, x: t.x, z: t.z })));
    if (!hit) {
      // generous cone for close sword fights
      const fx = m.d[0], fz = m.d[2], fl = Math.hypot(fx, fz) || 1;
      let best: { id: string; d: number } | null = null;
      for (const t of targets) {
        const dx = t.x - mp.x, dz = t.z - mp.z, d = Math.hypot(dx, dz);
        if (d > SWORD.range || Math.abs(t.y - mp.y) > 1.6 || (dx * fx + dz * fz) / (fl * (d || 1)) < 0.6) continue;
        const tr = traceVoxels(eye, [dx / (d || 1), 0, dz / (d || 1)], d, (x, y, z) => this.city!.blockAt(x, y, z));
        if (tr.hit) continue;
        if (!best || d < best.d) best = { id: t.id, d };
      }
      if (best) hit = { id: best.id, dist: best.d, head: false };
    }
    if (hit && hit.dist <= SWORD.range + 0.4) this.damage(hit.id, id, SWORD.damage, false, 'sword', eye);
  }

  /** Apply damage. Friendly fire, spawn protection, dead targets and finished matches all deal nothing. */
  private damage(victimId: string, attackerId: string | null, amount: number, head: boolean, w: string, from: Vec): void {
    const v = this.players.get(victimId);
    const a = attackerId ? this.players.get(attackerId) : undefined;
    const now = this.io.now();
    if (!v || !v.alive || !v.spawned || this.room.phase !== 'playing') return;
    if (v.protUntil > now) return;
    if (a && a.id !== v.id && a.team === v.team) return;
    const n = Math.max(0, Math.min(v.hp, Math.round(amount * 10) / 10));
    if (n <= 0) return;
    v.hp -= n;
    if (a && a.id !== v.id) {
      a.damage += n;
      v.lastHit = { by: a.id, at: now, w };
    }
    if (v.heal) this.cancelHeal(v, 'Interrupted by damage');
    this.io.send(null, { t: 'dmg', r: this.room.round, v: v.id, a: attackerId ?? '', n, hp: Math.ceil(v.hp), head, w, from });
    if (v.hp <= 0.001) this.eliminate(v, a && a.id !== v.id ? a : null, w, head);
  }

  private eliminate(v: MatchPlayer, killer: MatchPlayer | null, w: string, head: boolean): void {
    const now = this.io.now();
    v.hp = 0;
    v.alive = false;
    v.deaths++;
    v.respawnAt = now + RESPAWN_SECONDS;
    v.heal = null;
    if (killer && killer.team !== v.team) {
      killer.kills++;
      if (killer.team === 'red') this.red++;
      else this.blue++;
    }
    // their guns drop where they fell — anyone can grab them
    const drops = v.arsenal.dropsOnDeath();
    const added: LootItem[] = [];
    drops.forEach((d, i) => {
      const a = (i / Math.max(1, drops.length)) * Math.PI * 2;
      added.push(this.loot!.drop({ k: 'gun', gun: d.gun, mag: d.mag, reserve: d.reserve }, v.x + Math.cos(a) * 0.8, v.y, v.z + Math.sin(a) * 0.8, now));
    });
    v.arsenal.reset();
    if (added.length) this.io.send(null, { t: 'loot', r: this.room.round, items: added.map((i) => [i.lid, i.kind, i.x, i.y, i.z]), reset: false });
    this.io.send(null, { t: 'kill', r: this.room.round, v: v.id, k: killer?.id ?? null, w, head, red: this.red, blue: this.blue, respawnAt: v.respawnAt });
  }

  private requestRespawn(id: string): void {
    const mp = this.players.get(id);
    if (this.room.phase !== 'playing' || !mp || mp.alive || !mp.ready || !mp.spawned || mp.respawnAt <= 0) return;
    if (this.io.now() < mp.respawnAt) {
      this.io.send(id, { t: 'respawnWait', r: this.room.round, until: mp.respawnAt });
      return;
    }
    this.respawn(mp, true);
  }

  /** `afterDeath`: comes back with a random gun (one loaded magazine + one spare) so nobody respawns sword-only. */
  private respawn(mp: MatchPlayer, afterDeath = false): void {
    const now = this.io.now();
    const others = [...this.players.values()].filter((p) => p.id !== mp.id && p.spawned).map((p) => ({ team: p.team, x: p.x, y: p.y, z: p.z, alive: p.alive }));
    const sp = chooseSpawn(mp.team, others, (x, y, z) => this.city!.blockAt(x, y, z), this.rnd);
    mp.x = sp.x;
    mp.y = sp.y;
    mp.z = sp.z;
    mp.yaw = sp.yaw;
    mp.hp = MAX_HP;
    mp.alive = true;
    mp.spawned = true;
    mp.respawnAt = 0;
    mp.hist = [];
    mp.lastSt = now;
    mp.lastHit = null;
    mp.protUntil = now + PROTECT_SECONDS;
    mp.arsenal.reset();
    if (afterDeath) {
      const gun = GUN_IDS[Math.floor(this.rnd() * GUN_IDS.length) % GUN_IDS.length];
      mp.arsenal.addGun(gun, GUNS[gun].magazine, GUNS[gun].magazine, now);
    }
    this.io.send(null, { t: 'spawn', r: this.room.round, id: mp.id, p: [sp.x, sp.y, sp.z], yw: sp.yaw, protUntil: mp.protUntil });
    this.sendInv(mp, true);
  }

  private sendInv(mp: MatchPlayer, force = false): void {
    const now = this.io.now();
    if (!force && now - mp.lastInvSent < 0.08) return;
    mp.lastInvSent = now;
    this.io.send(mp.id, { t: 'inv', r: this.room.round, inv: mp.arsenal.snapshot(), reload: mp.arsenal.reloading ? mp.arsenal.reloading.endsAt : 0 });
  }

  private reload(id: string): void {
    const mp = this.players.get(id);
    if (!this.canAct(mp)) return;
    if (!mp.arsenal.startReload(this.io.now())) this.sendInv(mp);
  }

  private equip(id: string, slot: 0 | 1 | 2): void {
    const mp = this.players.get(id);
    if (!mp || !mp.spawned || !mp.alive) return;
    if (!mp.arsenal.equip(slot, this.io.now())) this.sendInv(mp, true);
    mp.w = mp.arsenal.weapon;
  }

  // ---------------------------------------------------------------- pickups & healing

  private pick(id: string, lid: string): void {
    const mp = this.players.get(id);
    if (!this.canAct(mp)) return this.io.send(id, { t: 'pickRej', r: this.room.round, lid, reason: 'Not now' });
    const now = this.io.now();
    const it = this.loot!.items.get(lid);
    if (!it) return this.io.send(id, { t: 'lootGone', r: this.room.round, lid, by: null });
    const why = pickupBlock(it.kind, mp.arsenal);
    if (why) return this.io.send(id, { t: 'pickRej', r: this.room.round, lid, reason: why });
    const took = this.loot!.take(lid, mp, now);
    if ('error' in took) {
      if (took.error === 'gone') this.io.send(id, { t: 'lootGone', r: this.room.round, lid, by: null });
      else this.io.send(id, { t: 'pickRej', r: this.room.round, lid, reason: 'Too far away' });
      return;
    }
    const res = applyPickup(took.item.kind, mp.arsenal, now);
    this.io.send(null, { t: 'lootGone', r: this.room.round, lid, by: id });
    if (res.dropped) {
      const d = this.loot!.drop({ k: 'gun', gun: res.dropped.gun, mag: res.dropped.mag, reserve: 0 }, mp.x, mp.y, mp.z, now);
      this.io.send(null, { t: 'loot', r: this.room.round, items: [[d.lid, d.kind, d.x, d.y, d.z]], reset: false });
    }
    mp.w = mp.arsenal.weapon;
    this.sendInv(mp, true);
  }

  private healStart(id: string, size: 'small' | 'large'): void {
    const mp = this.players.get(id);
    const no = (reason: string) => this.io.send(id, { t: 'heal', r: this.room.round, size, until: 0, ok: false, reason });
    if (!this.canAct(mp)) return no('Not now');
    const now = this.io.now();
    if (mp.heal) return no('Already healing');
    if (mp.hp >= MAX_HP) return no('Health is full');
    if ((size === 'small' ? mp.arsenal.small : mp.arsenal.large) <= 0) return no('No medkit');
    if (size === 'large' && now - mp.lastFireAt < 0.4) return no('Stop firing to use a large medkit');
    const secs = size === 'small' ? SMALL_MEDKIT.seconds : LARGE_MEDKIT.seconds;
    mp.heal = { size, endsAt: now + secs };
    this.io.send(id, { t: 'heal', r: this.room.round, size, until: mp.heal.endsAt, ok: true });
  }

  private cancelHeal(mp: MatchPlayer, reason: string): void {
    if (!mp.heal) return;
    const size = mp.heal.size;
    mp.heal = null;
    this.io.send(mp.id, { t: 'heal', r: this.room.round, size, until: 0, ok: false, reason });
  }

  private healFinish(mp: MatchPlayer): void {
    const h = mp.heal!;
    mp.heal = null;
    if (!mp.alive) return;
    if (h.size === 'small') {
      if (mp.arsenal.small <= 0) return;
      mp.arsenal.small--;
      mp.hp = Math.min(MAX_HP, mp.hp + SMALL_MEDKIT.heal);
    } else {
      if (mp.arsenal.large <= 0) return;
      mp.arsenal.large--;
      mp.hp = Math.min(MAX_HP, mp.hp + LARGE_MEDKIT.heal);
    }
    this.io.send(null, { t: 'hp', r: this.room.round, id: mp.id, hp: Math.ceil(mp.hp) });
    this.io.send(mp.id, { t: 'heal', r: this.room.round, size: h.size, until: 0, ok: true, reason: 'done' });
    this.sendInv(mp, true);
  }

  private station(id: string, sid: string): void {
    const mp = this.players.get(id);
    const st = HEALTH_STATIONS.find((s) => s.id === sid);
    if (!this.canAct(mp) || !st) return;
    const now = this.io.now();
    if ((this.stations.get(sid) ?? 0) > now || mp.hp >= MAX_HP) return;
    if (Math.hypot(mp.x - st.x, mp.z - st.z) > 2.2 || Math.abs(mp.y - st.y) > 1.5) return;
    mp.hp = Math.min(MAX_HP, mp.hp + HEALTH_STATION.heal);
    const readyAt = now + HEALTH_STATION.cooldown;
    this.stations.set(sid, readyAt);
    this.io.send(null, { t: 'hp', r: this.room.round, id, hp: Math.ceil(mp.hp) });
    this.io.send(null, { t: 'station', r: this.room.round, sid, readyAt });
  }

  /** Fall damage reported by the player's own physics (bounded, never during protection). */
  private env(id: string, amt: number): void {
    const mp = this.players.get(id);
    if (!this.canAct(mp)) return;
    const now = this.io.now();
    const credit = mp.lastHit && now - mp.lastHit.at < 6 ? mp.lastHit : null;
    if (mp.protUntil > now) return;
    const n = Math.min(100, amt);
    if (credit && n >= mp.hp) {
      // finishing fall after an enemy hit: the enemy gets the kill
      return this.damage(id, credit.by, n, false, credit.w, [mp.x, mp.y, mp.z]);
    }
    this.damage(id, null, n, false, 'fall', [mp.x, mp.y, mp.z]);
  }
}

/** Weapon name for the kill feed. */
export function feedWeapon(w: string): string {
  if (w === 'sword') return 'Sword';
  if (w === 'fall') return 'Fall';
  return (GUNS as Record<string, { name: string } | undefined>)[w]?.name ?? w;
}

export type { GunId };
