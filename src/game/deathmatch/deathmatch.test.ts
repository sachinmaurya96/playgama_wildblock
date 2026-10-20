import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeathmatchSession } from './DeathmatchSession';
import { useDeathmatchStore } from '../../stores/deathmatchStore';
import { useGameStore } from '../../stores/gameStore';
import { CITY_G, LOOT_POINTS, spawnPoints } from './DeathmatchMap';
import { DmRoom, LOAD_TIMEOUT_SECONDS, PREP_SECONDS } from './DeathmatchRules';
import { DmServer, type ServerIO } from './DmServer';
import { blocksBullets, rayPlayers, spreadDirs, traceVoxels, type Vec } from './HitDetection';
import { LootManager } from './LootManager';
import { computeResult, pickMvp } from './MatchResults';
import { DM_PROTOCOL, parseClientMsg, type ServerMsg } from './Protocol';
import { GUNS, GUN_IDS, MAX_HP } from './WeaponDefinitions';
import { Arsenal } from './WeaponSystem';
import { cityBlueprint } from './DeathmatchMap';

// ---------------------------------------------------------------- harness

class Harness implements ServerIO {
  t = 100;
  inbox = new Map<string, ServerMsg[]>();
  all: ServerMsg[] = [];
  kicked: string[] = [];
  server: DmServer;
  constructor(minutes = 5) {
    this.server = new DmServer(this, 'ABC234', 'host', 'Host', minutes);
  }
  now() {
    return this.t;
  }
  send(to: string | null, msg: ServerMsg, except?: string) {
    this.all.push(msg);
    const ids = to ? [to] : [...this.server.room.players.keys(), 'host'];
    for (const id of new Set(ids)) {
      if (id === except) continue;
      if (!this.inbox.has(id)) this.inbox.set(id, []);
      this.inbox.get(id)!.push(msg);
    }
  }
  kick(id: string) {
    this.kicked.push(id);
  }
  msgs<T extends ServerMsg['t']>(id: string, t: T): Extract<ServerMsg, { t: T }>[] {
    return (this.inbox.get(id) ?? []).filter((m) => m.t === t) as Extract<ServerMsg, { t: T }>[];
  }
  last<T extends ServerMsg['t']>(id: string, t: T) {
    const l = this.msgs(id, t);
    return l[l.length - 1];
  }
  join(id: string, name = id) {
    this.server.receive(id, { t: 'hello', name, v: DM_PROTOCOL });
  }
  advance(s: number, step = 0.05) {
    for (let k = 0; k < s / step; k++) {
      this.t += step;
      this.server.tick();
    }
  }
  get r() {
    return this.server.round;
  }
  /** Lobby → loading → everyone ready → 10 s countdown → playing. */
  startMatch() {
    this.server.receive('host', { t: 'start' });
    for (const id of this.server.room.players.keys()) this.server.receive(id, { t: 'ready', r: this.r });
    this.advance(PREP_SECONDS + 0.1);
    expect(this.server.phase).toBe('playing');
    this.advance(3.2); // spawn protection runs out
  }
  /** Teleport a player (as if they walked there, through st messages). */
  place(id: string, x: number, z: number, y = CITY_G + 1) {
    const p = this.server.debugPlayer(id)!;
    p.x = x;
    p.y = y;
    p.z = z;
    p.hist = [];
  }
  give(id: string, gun: keyof typeof GUNS) {
    this.server.debugPlayer(id)!.arsenal.addGun(gun, GUNS[gun].magazine, 60, this.t - 1);
  }
  seq = 0;
  shoot(id: string, at: Vec, opts: { from?: Vec; gun?: keyof typeof GUNS } = {}) {
    const p = this.server.debugPlayer(id)!;
    const o: Vec = opts.from ?? [p.x, p.y + 1.5, p.z];
    const d = [at[0] - o[0], at[1] - o[1], at[2] - o[2]];
    const l = Math.hypot(d[0], d[1], d[2]);
    this.server.receive(id, { t: 'fire', r: this.r, s: ++this.seq, w: opts.gun ?? p.arsenal.gun ?? 'm416', o, d: [d[0] / l, d[1] / l, d[2] / l], at: this.t, ads: true });
  }
}

/** Host (red) + bob (blue) in an open spot of the plaza. */
function duel(minutes = 5) {
  const h = new Harness(minutes);
  h.join('bob', 'Bob');
  h.startMatch();
  h.place('host', -6, -14);
  h.place('bob', 6, -14);
  return h;
}

// ---------------------------------------------------------------- lobby

describe('Deathmatch client respawn requests', () => {
  const original = useDeathmatchStore.getState();
  const originalGame = useGameStore.getState();
  afterEach(() => {
    useDeathmatchStore.setState(original);
    useGameStore.setState(originalGame);
    vi.useRealTimers();
  });
  it('keeps the cursor available for manual respawn after reconnecting while defeated', () => {
    vi.useFakeTimers();
    const requestLock = vi.fn();
    const player = { dead: true };
    const client = Object.assign(Object.create(DeathmatchSession.prototype), {
      disposed: false, phase: 'preparing', alive: false, hp: 0, protUntil: 0,
      net: { hostNow: () => 110 }, game: { input: { requestLock }, player },
    }) as DeathmatchSession;
    useGameStore.setState({ overlay: null });
    useDeathmatchStore.setState({ alive: false, optionsOpen: false });
    (client as unknown as { receive(m: ServerMsg): void }).receive({ t: 'go', r: 7, startAt: 100, endAt: 400 });
    expect(useDeathmatchStore.getState()).toMatchObject({ phase: 'playing', alive: false });
    expect(player.dead).toBe(true);
    expect(requestLock).not.toHaveBeenCalled();
    vi.runAllTimers();
  });
  it('sends one explicit request after the cooldown, and permits retry if the host is still waiting', () => {
    let hostTime = 104;
    const net = { hostNow: () => hostTime, send: vi.fn() };
    const client = Object.assign(Object.create(DeathmatchSession.prototype), {
      disposed: false, phase: 'playing', alive: false, round: 7, respawnAt: 105, net,
    }) as DeathmatchSession;
    useDeathmatchStore.setState({ respawnPending: false });
    expect(client.requestRespawn()).toBe(false);
    expect(net.send).not.toHaveBeenCalled();
    hostTime = 106;
    expect(client.requestRespawn()).toBe(true);
    expect(net.send).toHaveBeenCalledExactlyOnceWith({ t: 'respawn', r: 7 });
    expect(client.requestRespawn()).toBe(false);
    (client as unknown as { receive(m: ServerMsg): void }).receive({ t: 'respawnWait', r: 7, until: 108 });
    expect(useDeathmatchStore.getState()).toMatchObject({ respawnPending: false, respawnIn: 2 });
    expect(client.requestRespawn()).toBe(false);
    hostTime = 108;
    expect(client.requestRespawn()).toBe(true);
    expect(net.send).toHaveBeenCalledTimes(2);
  });
  it.each(['alive', 'ended', 'disposed'])('rejects a request while %s', (condition) => {
    const net = { hostNow: () => 200, send: vi.fn() };
    const client = Object.assign(Object.create(DeathmatchSession.prototype), {
      disposed: condition === 'disposed', phase: condition === 'ended' ? 'ended' : 'playing',
      alive: condition === 'alive', round: 7, respawnAt: 105, net,
    }) as DeathmatchSession;
    useDeathmatchStore.setState({ respawnPending: false });
    expect(client.requestRespawn()).toBe(false);
    expect(net.send).not.toHaveBeenCalled();
  });
});

describe('Deathmatch lobby', () => {
  it('host creates a room on Red, first joiner goes Blue, then the smaller team', () => {
    const h = new Harness();
    expect(h.server.room.players.get('host')!.team).toBe('red');
    h.join('a');
    expect(h.server.room.players.get('a')!.team).toBe('blue');
    h.join('b');
    expect(h.server.room.players.get('b')!.team).toBe('red');
    h.join('c');
    expect(h.server.room.players.get('c')!.team).toBe('blue');
    expect(h.last('a', 'welcome').lobby.players).toHaveLength(2);
    expect(h.last('c', 'lobby').lobby.players).toHaveLength(4);
  });

  it('lets a player switch teams and back; never into a full team', () => {
    const h = new Harness();
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) h.join(id);
    const room = h.server.room;
    expect(room.teamCount('red')).toBe(4);
    expect(room.teamCount('blue')).toBe(4);
    const blue = [...room.players.values()].find((p) => p.team === 'blue')!;
    h.server.receive(blue.id, { t: 'team', team: 'red' });
    expect(room.players.get(blue.id)!.team).toBe('blue');
    expect(h.last(blue.id, 'teamRej').reason).toMatch(/full/);
  });

  it('serialises two simultaneous requests for the last slot', () => {
    const room = new DmRoom('X', 'h', 'H');
    for (const id of ['a', 'b', 'c', 'd', 'e']) room.join(id, id);
    // red: h,b,d (3)  blue: a,c,e (3)
    expect(room.teamCount('red')).toBe(3);
    const r1 = room.requestTeam('a', 'red');
    const r2 = room.requestTeam('c', 'red');
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    expect(room.teamCount('red')).toBe(4);
  });

  it('auto-balance never overrides a manual choice', () => {
    const room = new DmRoom('X', 'h', 'H');
    room.join('a', 'A');
    room.requestTeam('a', 'red');
    room.join('b', 'B');
    expect(room.players.get('a')!.team).toBe('red');
    expect(room.players.get('b')!.team).toBe('blue');
  });

  it('room full at 8', () => {
    const h = new Harness();
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) h.join(id);
    h.join('late');
    expect(h.last('late', 'reject').reason).toBe('full');
  });

  it('cannot start alone, with an empty team, or as a non-host', () => {
    const h = new Harness();
    h.server.receive('host', { t: 'start' });
    expect(h.last('host', 'startRej').reason).toMatch(/one more/);
    h.join('a');
    h.server.receive('a', { t: 'start' });
    expect(h.last('a', 'startRej').reason).toMatch(/host/);
    h.server.receive('a', { t: 'team', team: 'red' });
    h.server.receive('host', { t: 'start' });
    expect(h.last('host', 'startRej').reason).toMatch(/Blue/);
    expect(h.server.phase).toBe('lobby');
  });

  it('locks teams once preparation starts and rejects late joins', () => {
    const h = new Harness();
    h.join('a');
    h.server.receive('host', { t: 'start' });
    expect(h.server.phase).toBe('loading');
    h.server.receive('a', { t: 'team', team: 'red' });
    expect(h.server.room.players.get('a')!.team).toBe('blue');
    expect(h.last('a', 'teamRej').reason).toMatch(/locked/);
    h.join('late');
    expect(h.last('late', 'reject').reason).toBe('in_progress');
  });
});

// ---------------------------------------------------------------- preparation & clock

describe('Deathmatch match flow', () => {
  it('waits for every client to load, then a host-timed 10 s countdown', () => {
    const h = new Harness();
    h.join('a');
    h.server.receive('host', { t: 'start' });
    h.server.receive('host', { t: 'ready', r: h.r });
    h.advance(1);
    expect(h.server.phase).toBe('loading');
    h.server.receive('a', { t: 'ready', r: h.r });
    expect(h.server.phase).toBe('preparing');
    const prep = h.last('a', 'prep');
    expect(prep.endsAt - h.t).toBeCloseTo(PREP_SECONDS, 3);
    h.advance(9.5);
    expect(h.server.phase).toBe('preparing');
    h.advance(0.6);
    expect(h.server.phase).toBe('playing');
    const go = h.last('a', 'go');
    expect(go.endAt - go.startAt).toBeCloseTo(5 * 60, 3);
  });

  it('nobody can shoot, pick up or take damage during preparation', () => {
    const h = new Harness();
    h.join('bob');
    h.server.receive('host', { t: 'start' });
    h.server.receive('host', { t: 'ready', r: h.r });
    h.server.receive('bob', { t: 'ready', r: h.r });
    h.give('host', 'm416');
    const before = h.server.debugPlayer('host')!.arsenal.mag('m416');
    h.shoot('host', [0, 42, 0]);
    expect(h.server.debugPlayer('host')!.arsenal.mag('m416')).toBe(before);
    expect(h.msgs('bob', 'dmg')).toHaveLength(0);
  });

  it('drops a player who never finishes loading, cancels if a team empties', () => {
    const h = new Harness();
    h.join('a');
    h.server.receive('host', { t: 'start' });
    h.server.receive('host', { t: 'ready', r: h.r });
    h.advance(LOAD_TIMEOUT_SECONDS + 1);
    expect(h.kicked).toContain('a');
    expect(h.server.phase).toBe('lobby');
    expect(h.last('host', 'cancel').reason).toMatch(/finished loading/);
  });

  it('keeps a slower device in the room past 30 seconds and starts when it is ready', () => {
    const h = new Harness();
    h.join('phone');
    h.server.receive('host', { t: 'start' });
    h.server.receive('host', { t: 'ready', r: h.r });
    h.advance(45);
    expect(h.kicked).toEqual([]);
    expect(h.server.phase).toBe('loading');
    h.server.receive('phone', { t: 'ready', r: h.r });
    expect(h.server.phase).toBe('preparing');
    h.advance(PREP_SECONDS + 0.1);
    expect(h.server.phase).toBe('playing');
    expect(h.server.room.players.has('phone')).toBe(true);
  });

  it('ends the match at the deadline and stops all scoring', () => {
    const h = duel(5);
    h.advance(5 * 60);
    expect(h.server.phase).toBe('ended');
    const end = h.last('bob', 'end');
    expect(end.result.winner).toBe('draw');
    h.give('host', 'm416');
    h.shoot('host', [6, 42.2, -14]);
    expect(h.msgs('bob', 'dmg')).toHaveLength(0);
  });

  it('play again resets kills, loot and health, back to the lobby', () => {
    const h = duel(5);
    h.give('host', 'm24');
    h.shoot('host', [6, CITY_G + 2.5, -14]); // headshot
    expect(h.server.scores().red).toBe(1);
    h.advance(5 * 60);
    h.server.receive('bob', { t: 'again' }); // not host
    expect(h.server.phase).toBe('ended');
    h.server.receive('host', { t: 'again' });
    expect(h.server.phase).toBe('lobby');
    expect(h.server.scores()).toEqual({ red: 0, blue: 0 });
    expect(h.server.lootItems()).toHaveLength(0);
    h.server.receive('host', { t: 'team', team: 'blue' }); // switching works again
    expect(h.server.room.players.get('host')!.team).toBe('blue');
  });
});

// ---------------------------------------------------------------- combat

describe('Deathmatch combat', () => {
  it('sword damages enemies (25), never teammates', () => {
    const h = new Harness();
    h.join('bob');
    h.join('cat'); // red, the host's teammate
    h.startMatch();
    h.place('host', -6, -14);
    h.place('bob', -4, -14);
    h.place('cat', -6, -12);
    h.server.receive('host', { t: 'melee', r: h.r, s: 1, o: [-6, 42.5, -14], d: [1, 0, 0], at: h.t });
    expect(h.server.debugPlayer('bob')!.hp).toBe(MAX_HP - 25);
    h.advance(1);
    h.server.receive('host', { t: 'melee', r: h.r, s: 2, o: [-6, 42.5, -14], d: [0, 0, 1], at: h.t });
    expect(h.server.debugPlayer('cat')!.hp).toBe(MAX_HP);
  });

  it('guns consume ammo; an empty magazine cannot fire; cooldown is enforced', () => {
    const h = duel();
    h.give('host', 'm24');
    const a = h.server.debugPlayer('host')!.arsenal;
    h.shoot('host', [6, 41.5, -30]);
    expect(a.mag('m24')).toBe(4);
    h.shoot('host', [6, 41.5, -30]); // bolt still cycling
    expect(a.mag('m24')).toBe(4);
    for (let i = 0; i < 6; i++) {
      h.advance(1.2);
      h.shoot('host', [6, 41.5, -30]);
    }
    expect(a.mag('m24')).toBe(0);
  });

  it('reload moves rounds from the reserve and never creates ammunition', () => {
    const a = new Arsenal();
    a.addGun('m416', 30, 10, 0);
    for (let t = 1; t < 4; t += 0.1) if (!a.canFire(t)) a.fire(t);
    const total = a.mag('m416') + a.reserveFor('m416');
    expect(a.startReload(5)).toBe(true);
    expect(a.startReload(5.1)).toBe(false); // repeated request rejected
    expect(a.canFire(5.2)).toBe('reloading');
    a.update(5 + GUNS.m416.reloadSeconds);
    expect(a.mag('m416') + a.reserveFor('m416')).toBe(total);
    a.ammo['556'] = 0;
    while (!a.canFire(20)) a.fire(20 + Math.random());
    expect(a.reloadBlock()).toBe(a.mag('m416') >= 30 ? 'full' : 'no_ammo');
  });

  it('switching weapons cancels a reload (consistent rule)', () => {
    const a = new Arsenal();
    a.addGun('mp5', 10, 50, 0);
    a.startReload(1);
    a.equip(0, 1.2);
    a.update(10);
    expect(a.mag('mp5')).toBe(10);
  });

  it('bullets stop at solid cover', () => {
    const city = cityBlueprint(1);
    // the warehouse wall stands between these points
    const o: Vec = [0, CITY_G + 2, -40];
    const tr = traceVoxels(o, [0, 0, -1], 50, (x, y, z) => city.blockAt(x, y, z));
    expect(tr.hit).toBe(true);
    expect(tr.dist).toBeLessThan(10);
    const hit = rayPlayers(o, [0, 0, -1], tr.dist, [{ id: 'x', x: 0, y: CITY_G + 1, z: -60, crouch: false }]);
    expect(hit).toBeNull();
    expect(blocksBullets(city.blockAt(0, CITY_G - 1, 0))).toBe(true);
  });

  it('host-validated shots land, with head bonus and distance falloff', () => {
    const h = duel();
    h.give('host', 'm416');
    h.shoot('host', [6, CITY_G + 1.6, -14]); // body
    const d1 = h.last('bob', 'dmg');
    expect(d1.n).toBeCloseTo(GUNS.m416.damage, 1);
    expect(d1.head).toBe(false);
    h.advance(0.2);
    h.shoot('host', [6, CITY_G + 2.5, -14]); // head
    expect(h.last('bob', 'dmg').head).toBe(true);
    expect(h.last('bob', 'dmg').n).toBeCloseTo(GUNS.m416.damage * GUNS.m416.headMultiplier, 1);
  });

  it('shotgun pellets add up close, fade far away', () => {
    const h = duel();
    h.give('host', 'shotgun');
    h.place('bob', -3, -14);
    h.shoot('host', [-3, CITY_G + 1.6, -14]);
    const close = h.last('bob', 'dmg').n;
    expect(close).toBeGreaterThan(GUNS.shotgun.damage * 4);
    const dirs = spreadDirs([1, 0, 0], 5, 8, 42);
    expect(dirs).toHaveLength(8);
    expect(spreadDirs([1, 0, 0], 5, 8, 42)).toEqual(dirs); // deterministic on both sides
  });

  it('spawn protection blocks damage and ends when the protected player attacks', () => {
    const h = new Harness();
    h.join('bob');
    h.server.receive('host', { t: 'start' });
    for (const id of ['host', 'bob']) h.server.receive(id, { t: 'ready', r: h.r });
    h.advance(PREP_SECONDS + 0.1);
    h.place('host', -6, -14);
    h.place('bob', 6, -14);
    h.give('host', 'm416');
    h.give('bob', 'm416');
    h.shoot('host', [6, CITY_G + 1.6, -14]);
    expect(h.server.debugPlayer('bob')!.hp).toBe(MAX_HP); // bob still protected
    expect(h.server.debugPlayer('host')!.protUntil).toBe(0); // host attacked: protection gone
    h.shoot('bob', [-6, CITY_G + 1.6, -14]);
    expect(h.server.debugPlayer('host')!.hp).toBeLessThan(MAX_HP);
  });

  it('counts each elimination once; deaths, team score and kill feed', () => {
    const h = duel();
    h.give('host', 'm24');
    h.shoot('host', [6, CITY_G + 2.5, -14]);
    h.advance(1.2);
    h.shoot('host', [6, CITY_G + 2.5, -14]); // body is down: nothing more
    expect(h.msgs('bob', 'kill')).toHaveLength(1);
    expect(h.server.debugPlayer('host')!.kills).toBe(1);
    expect(h.server.debugPlayer('bob')!.deaths).toBe(1);
    expect(h.server.scores()).toEqual({ red: 1, blue: 0 });
    expect(h.last('bob', 'kill').w).toBe('m24');
  });

  it('stays dead after the cooldown and respawns only on request with the existing loadout rules', () => {
    const h = duel();
    h.give('bob', 'ak47');
    h.give('host', 'm24');
    h.shoot('host', [6, CITY_G + 2.5, -14]);
    // bob's AK dropped where he fell
    expect(h.server.lootItems().some((i) => i.kind.k === 'gun' && i.kind.gun === 'ak47')).toBe(true);
    h.advance(4.8);
    expect(h.server.debugPlayer('bob')!.alive).toBe(false);
    h.server.receive('bob', { t: 'respawn', r: h.r });
    expect(h.server.debugPlayer('bob')!.alive).toBe(false);
    expect(h.last('bob', 'respawnWait').until).toBeGreaterThan(h.t);
    h.advance(30);
    expect(h.server.debugPlayer('bob')!.alive).toBe(false);
    h.server.receive('bob', { t: 'respawn', r: h.r - 1 });
    expect(h.server.debugPlayer('bob')!.alive).toBe(false);
    h.server.receive('bob', { t: 'respawn', r: h.r });
    const bob = h.server.debugPlayer('bob')!;
    expect(bob.alive).toBe(true);
    expect(bob.hp).toBe(MAX_HP);
    const [gun, none] = bob.arsenal.guns;
    expect(none).toBeNull();
    expect(GUN_IDS).toContain(gun);
    expect(bob.arsenal.mag(gun!)).toBe(GUNS[gun!].magazine);
    expect(bob.arsenal.reserveFor(gun!)).toBe(GUNS[gun!].magazine);
    expect(bob.x).toBeGreaterThan(60);
    expect(bob.protUntil).toBeGreaterThan(h.t);
    const spawns = h.msgs('bob', 'spawn').length;
    const position = [bob.x, bob.y, bob.z];
    h.server.receive('bob', { t: 'respawn', r: h.r });
    expect(h.msgs('bob', 'spawn')).toHaveLength(spawns);
    expect([bob.x, bob.y, bob.z]).toEqual(position);
  });

  it('healing cannot exceed 100, dead players cannot heal or pick up', () => {
    const h = duel();
    const bob = h.server.debugPlayer('bob')!;
    bob.arsenal.addMedkit('large');
    bob.hp = 80;
    h.server.receive('bob', { t: 'heal', r: h.r, size: 'large' });
    h.advance(2.1);
    expect(bob.hp).toBe(MAX_HP);
    bob.arsenal.addMedkit('small');
    h.give('host', 'm24');
    h.shoot('host', [6, CITY_G + 2.5, -14]);
    h.server.receive('bob', { t: 'heal', r: h.r, size: 'small' });
    expect(h.last('bob', 'heal').ok).toBe(false);
    const item = h.server.lootItems()[0];
    h.place('bob', item.x, item.z, item.y);
    h.server.receive('bob', { t: 'pick', r: h.r, lid: item.lid });
    expect(h.server.lootItems().some((i) => i.lid === item.lid)).toBe(true);
  });

  it('taking damage interrupts a large medkit', () => {
    const h = duel();
    const bob = h.server.debugPlayer('bob')!;
    bob.arsenal.addMedkit('large');
    bob.hp = 50;
    h.server.receive('bob', { t: 'heal', r: h.r, size: 'large' });
    h.give('host', 'mp5');
    h.advance(0.5);
    h.shoot('host', [6, CITY_G + 1.6, -14]);
    h.advance(2);
    expect(bob.hp).toBeLessThan(50);
    expect(bob.arsenal.large).toBe(1);
  });
});

// ---------------------------------------------------------------- results

describe('Deathmatch results', () => {
  const p = (id: string, team: 'red' | 'blue', kills: number, deaths: number) => ({ id, name: id, team, kills, deaths, damage: 0 });
  it('red / blue / draw', () => {
    expect(computeResult([p('a', 'red', 3, 1), p('b', 'blue', 1, 3)], 3, 1, 480).winner).toBe('red');
    expect(computeResult([p('a', 'red', 1, 3), p('b', 'blue', 3, 1)], 1, 3, 480).winner).toBe('blue');
    expect(computeResult([p('a', 'red', 2, 2), p('b', 'blue', 2, 2)], 2, 2, 480).winner).toBe('draw');
  });
  it('MVP = most kills, fewer deaths breaks ties, joint MVP otherwise, can be on the losing team', () => {
    expect(pickMvp([p('a', 'red', 5, 4), p('b', 'blue', 7, 9)])).toEqual(['b']);
    expect(pickMvp([p('a', 'red', 5, 4), p('b', 'blue', 5, 2)])).toEqual(['b']);
    expect(pickMvp([p('a', 'red', 5, 2), p('b', 'blue', 5, 2)])).toEqual(['a', 'b']);
    expect(pickMvp([p('a', 'red', 0, 0)])).toEqual([]);
  });
  it('every client receives the same final result', () => {
    const h = duel();
    h.join('x'); // too late: rejected, never part of the result
    h.advance(5 * 60);
    expect(h.last('host', 'end').result).toEqual(h.last('bob', 'end').result);
  });
});

// ---------------------------------------------------------------- network

describe('Deathmatch network rules', () => {
  it('two players grabbing the same pickup: only one gets it', () => {
    const h = new Harness();
    h.join('bob');
    h.join('cat');
    h.startMatch();
    const item = h.server.lootItems().find((i) => i.kind.k === 'gun' || i.kind.k === 'med')!;
    h.place('bob', item.x, item.z, item.y);
    h.place('cat', item.x + 0.5, item.z, item.y);
    h.server.receive('bob', { t: 'pick', r: h.r, lid: item.lid });
    h.server.receive('cat', { t: 'pick', r: h.r, lid: item.lid });
    const gone = h.all.filter((m) => m.t === 'lootGone' && m.lid === item.lid && m.by);
    expect(gone).toHaveLength(1);
    expect(h.msgs('cat', 'lootGone').some((m) => m.lid === item.lid && m.by === 'bob')).toBe(true);
  });

  it('pickups respawn after their cooldown', () => {
    const lm = new LootManager(LOOT_POINTS, 5);
    const items = lm.reset();
    const it = items.find((i) => i.point!.startsWith('w-avenue'))!;
    expect('item' in lm.take(it.lid, it, 0)).toBe(true);
    expect('error' in lm.take(it.lid, it, 0)).toBe(true);
    expect(lm.tick(10).added).toHaveLength(0);
    expect(lm.tick(21).added).toHaveLength(1);
    expect('error' in lm.take(lm.reset()[0].lid, { x: 999, y: 0, z: 999 }, 0)).toBe(true);
  });

  it('a disconnecting player leaves the roster; empty team ends the match', () => {
    const h = duel();
    h.server.leave('bob');
    expect(h.server.room.players.has('bob')).toBe(false);
    expect(h.server.phase).toBe('ended');
    expect(h.last('host', 'end').result.reason).toBe('forfeit');
  });

  it('a player leaving during preparation cancels to a usable lobby', () => {
    const h = new Harness();
    h.join('bob');
    h.server.receive('host', { t: 'start' });
    h.server.leave('bob');
    expect(h.server.phase).toBe('lobby');
    expect(h.last('host', 'cancel')).toBeTruthy();
  });

  it('reconnects a dropped player into the running match with their score', () => {
    const h = new Harness();
    h.join('bob');
    h.join('cat');
    h.startMatch();
    const token = h.last('cat', 'welcome').token;
    h.server.debugPlayer('cat')!.kills = 2;
    h.server.leave('cat');
    expect(h.server.phase).toBe('playing');
    h.server.receive('cat2', { t: 'hello', name: 'cat', v: DM_PROTOCOL, token });
    expect(h.last('cat2', 'load').late).toBe(true);
    h.server.receive('cat2', { t: 'ready', r: h.r });
    expect(h.server.debugPlayer('cat2')!.kills).toBe(2);
    expect(h.server.debugPlayer('cat2')!.alive).toBe(true);
  });

  it('keeps a defeated player dead after reconnecting until they request respawn', () => {
    const h = new Harness();
    h.join('bob'); h.join('cat'); h.startMatch();
    const token = h.last('cat', 'welcome').token;
    h.server.receive('cat', { t: 'env', r: h.r, amt: 100, cause: 'fall' });
    expect(h.server.debugPlayer('cat')!.alive).toBe(false);
    h.server.leave('cat');
    h.advance(10);
    h.server.receive('cat2', { t: 'hello', name: 'cat', v: DM_PROTOCOL, token });
    h.server.receive('cat2', { t: 'ready', r: h.r });
    expect(h.server.debugPlayer('cat2')!.alive).toBe(false);
    expect(h.last('cat2', 'kill').v).toBe('cat2');
    expect(h.msgs('cat2', 'spawn')).toHaveLength(0);
    h.server.receive('cat2', { t: 'respawn', r: h.r });
    expect(h.server.debugPlayer('cat2')!.alive).toBe(true);
  });

  it('stale events from a previous round are ignored', () => {
    const h = duel();
    h.give('host', 'm416');
    const r = h.r;
    h.server.receive('host', { t: 'fire', r: r - 1, s: 99, w: 'm416', o: [-6, 42.5, -14], d: [1, 0, 0], at: h.t, ads: false });
    expect(h.msgs('bob', 'dmg')).toHaveLength(0);
  });

  it('malformed payloads and impossible coordinates never crash or teleport', () => {
    const h = duel();
    for (const junk of [null, 5, 'x', {}, { t: 'fire' }, { t: 'st', r: h.r, p: [NaN, 1, 2] }, { t: 'fire', r: h.r, s: 1, w: 'm416', o: [0, 0, 0], d: [5, 5, 5], at: 1 }, { t: 'pick', r: h.r, lid: 7 }]) {
      expect(() => h.server.receive('bob', junk)).not.toThrow();
    }
    expect(parseClientMsg({ t: 'st', r: 1, p: [1e9, 0, 0], yw: 0, pt: 0, w: 'sword', f: 0, m: 0 })).toBeNull();
    h.advance(0.2);
    h.server.receive('bob', { t: 'st', r: h.r, p: [-40, 41, -14], yw: 0, pt: 0, w: 'sword', f: 2, m: 1 });
    expect(h.server.debugPlayer('bob')!.x).toBe(6);
    expect(h.last('bob', 'correct').p[0]).toBe(6);
  });

  it('spawn points are spread out per team', () => {
    expect(spawnPoints('red').every((p) => p.x < 0)).toBe(true);
    expect(spawnPoints('blue').every((p) => p.x > 0)).toBe(true);
  });
});
