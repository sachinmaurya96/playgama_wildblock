import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pvpNet, type NetSession } from '../../net/pvpNet';
import type { NetMsg } from '../../net/transport';
import { DEFAULT_PVP_SETTINGS, usePvpStore } from '../../stores/pvpStore';
import { useGameStore } from '../../stores/gameStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { Game } from '../Game';
import { GameClock } from '../core/GameClock';
import { kitItems, PvpSession } from './PvpSession';
import { World } from '../world/World';
import { Chunk } from '../world/Chunk';
import { B } from '../world/BlockRegistry';
import { Player } from '../player/Player';
import { EventBus } from '../core/EventBus';
import { useInventoryStore } from '../../stores/inventoryStore';
import { usePlayerStore } from '../../stores/playerStore';
import { makeStack } from '../systems/InventoryLogic';

const oldPvp = usePvpStore.getState(), oldGame = useGameStore.getState(), oldVoice = useVoiceStore.getState();
const oldInventory = useInventoryStore.getState(), oldPlayer = usePlayerStore.getState();
const sessions: PvpSession[] = [];
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  usePvpStore.setState(oldPvp); useGameStore.setState(oldGame); useVoiceStore.setState(oldVoice);
  useInventoryStore.setState(oldInventory); usePlayerStore.setState(oldPlayer);
});

function setup(host = true, style: 'battle' | 'together' = 'battle') {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const net = {
    isHost: host, selfId: host ? 'host' : 'guest', code: 'ABC234', name: 'Explorer', color: '#ff0000', online: false,
    settings: { ...DEFAULT_PVP_SETTINGS, minutes: 10, style },
    welcome: { players: [], timeLeft: 2 }, send: vi.fn(),
  } as unknown as NetSession;
  vi.spyOn(pvpNet, 'current', 'get').mockReturnValue(net);
  const world = new World(1); world.addChunk(Chunk.empty(0, 0)); world.set(4, 11, 4, B.BED);
  const game = Object.assign(Object.create(Game.prototype), {
    scene: new THREE.Scene(), world, chunks: { isReady: () => true }, ready: false, time: 1,
    clock: new GameClock(600, 20), build: null, drops: { clearNet: vi.fn() },
    entities: { creatures: [], poof: vi.fn() }, player: { position: new THREE.Vector3(4.5, 11, 6.5) },
    completeBedSleep: vi.fn(),
  }) as Game;
  const session = new PvpSession(game);
  sessions.push(session);
  const internals = session as unknown as {
    receive(from: string, msg: NetMsg): void; updateMoves(dt: number): void; updateVoice(dt: number): void;
    endMatch(id: string | null): void; restartLocal(): void; timeLeft: number | null;
    lastHit: { by: string; at: number; how: string } | null;
    remotes: Map<string, { pos: THREE.Vector3; dead: boolean; dispose(): void }>;
    players: Map<string, { id: string; name: string; color: string; kills: number; deaths: number }>;
  };
  vi.spyOn(internals, 'updateMoves').mockImplementation(() => {});
  vi.spyOn(internals, 'updateVoice').mockImplementation(() => {});
  return { net, game, session, internals };
}

function combat(host = true, style: 'battle' | 'together' = 'battle') {
  const result = setup(host, style);
  const { game, session, internals } = result;
  Object.assign(game, {
    pvp: session, dm: null, difficulty: 'explorer',
    rest: { release: vi.fn(), stand: vi.fn() }, boats: { riding: null }, bus: new EventBus(),
    audio: { play: vi.fn() }, particles: { emit: vi.fn() },
    input: { pointerLocked: false, clearHeld: vi.fn(), requestLock: vi.fn() },
  });
  Object.assign(game.drops, { spawnNet: vi.fn() });
  Object.assign(game, { player: new Player(game) });
  game.player.teleport(4.5, 11, 6.5);
  game.player.vitality = 1; game.player.energy = 3; game.player.buffs = [{ id: 'hearty', remaining: 20 }];
  vi.spyOn(session, 'randomSpawn').mockReturnValue({ x: 12.5, y: 11.1, z: 12.5 });
  internals.players.set(session.selfId, { id: session.selfId, name: 'Explorer', color: '#fff', kills: 0, deaths: 0 });
  const attacker = host ? 'guest' : 'host';
  internals.players.set(attacker, { id: attacker, name: 'Attacker', color: '#f00', kills: 0, deaths: 0 });
  useGameStore.setState({ overlay: null, death: null, toasts: [] });
  useInventoryStore.getState().reset();
  const snap = useInventoryStore.getState().snapshot();
  snap.slots[0] = { ...makeStack('scrap_axe', 1), durability: 7 };
  snap.slots[9] = makeStack('stick', 5);
  snap.equipment.feet = makeStack('trail_boots', 1);
  useInventoryStore.getState().load(snap);
  const hit = () => internals.receive(attacker, { t: 'hit', id: attacker, to: session.selfId, dmg: 60, how: 'arrow', x: 4.5, y: 11, z: 4.5 });
  return { ...result, attacker, hit, snap };
}

describe('player-chosen shared-world respawn', () => {
  it('rescues a living friend-room player without loot, kit refills or death scores', () => {
    const { game, net, session, internals, snap } = combat();
    game.player.vitality = 79; game.player.energy = 51; game.player.invulnerable = 4;
    Object.assign(game, { chunks: { isReady: () => false } });
    useGameStore.setState({ overlay: 'pause' });
    expect(session.quickRespawn()).toBeNull();
    expect(game.player.position.toArray()).toEqual([12.5, 11.1, 12.5]);
    expect(game.player.vitality).toBe(79); expect(game.player.energy).toBe(51);
    expect(game.player.buffs).toEqual([{ id: 'hearty', remaining: 20 }]);
    expect(game.player.invulnerable).toBe(4); expect(game.player.waitingForGround).toBe(true);
    expect(useInventoryStore.getState().snapshot()).toEqual(snap);
    expect(internals.players.get(session.selfId)?.deaths).toBe(0);
    expect(net.send).not.toHaveBeenCalled(); expect(game.drops.spawnNet).not.toHaveBeenCalled();
    expect(session.quickRespawn()).toContain('Ready again in 8 s.');
  });

  it.each([[true, 'battle'], [false, 'battle'], [true, 'together'], [false, 'together']] as const)(
    'host=%s style=%s credits death once and revives only on request', (host, style) => {
      const { game, net, session, internals, attacker, hit, snap } = combat(host, style);
      const lethalHit = style === 'battle' ? hit : () => game.player.hurt(60, 'Zombie');
      lethalHit();
      expect(game.player.dead).toBe(true);
      expect(game.player.position.toArray()).toEqual([4.5, 11, 6.5]);
      expect(useGameStore.getState().overlay).toBe('death');
      const deathMessages = vi.mocked(net.send).mock.calls.length;
      session.onLocalDeath('duplicate');
      expect(net.send).toHaveBeenCalledTimes(deathMessages);
      session.update(60);
      expect(game.player.dead).toBe(true);
      expect(vi.mocked(net.send).mock.calls.filter(([msg]) => msg.t === 's')).toMatchObject([[{ dead: true }]]);
      expect(session.requestRespawn()).toBe(true);
      expect(game.player.dead).toBe(false);
      expect(game.player.position.toArray()).toEqual([12.5, 11.1, 12.5]);
      expect(game.player.vitality).toBe(100); expect(game.player.energy).toBe(100);
      expect(game.player.buffs).toEqual([]); expect(game.player.invulnerable).toBe(3);
      expect(session.respawnIn).toBe(0); expect(usePvpStore.getState().respawnIn).toBe(0);
      expect(internals.lastHit).toBeNull(); expect(session.moveBlocked()).toBeNull();
      expect(useGameStore.getState().overlay).toBeNull();
      const messages = vi.mocked(net.send).mock.calls.map(([msg]) => msg);
      expect(messages.filter((msg) => msg.t === 's')).toMatchObject([
        { dead: true, hp: 0, p: [4.5, 11, 6.5], f: 1 },
        { dead: false, hp: 100, p: [12.5, 11.1, 12.5], f: 1 },
      ]);
      if (host) {
        expect(internals.players.get(session.selfId)?.deaths).toBe(1);
        expect(internals.players.get(attacker)?.kills).toBe(style === 'battle' ? 1 : 0);
        expect(messages.filter((msg) => msg.t === 'kill')).toEqual([{ t: 'kill', victim: session.selfId, by: style === 'battle' ? attacker : null, how: style === 'battle' ? 'arrow' : 'Zombie' }]);
      } else expect(messages.filter((msg) => msg.t === 'died')).toEqual([{ t: 'died', id: session.selfId, by: style === 'battle' ? attacker : null, how: style === 'battle' ? 'arrow' : 'Zombie' }]);
      const loot = messages.filter((msg) => msg.t === 'loot');
      if (style === 'battle') {
        expect(loot).toHaveLength(1);
        expect((loot[0].items as unknown[][]).map((entry) => entry.slice(1, 7))).toEqual([
          ['scrap_axe', 1, 7, 4.5, 11.9, 6.5], ['stick', 5, -1, 4.5, 11.9, 6.5], ['trail_boots', 1, -1, 4.5, 11.9, 6.5],
        ]);
        expect(game.drops.spawnNet).toHaveBeenCalledTimes(snap.slots.filter(Boolean).length + 1);
      } else {
        expect(loot).toHaveLength(0); expect(game.drops.spawnNet).not.toHaveBeenCalled();
      }
      const inv = useInventoryStore.getState();
      for (const [item, count] of kitItems(session.settings.kit, session.settings.building || session.together, session.together).hotbar) {
        expect(inv.count(item)).toBeGreaterThanOrEqual(count);
      }
      const messageCount = messages.length;
      expect(session.requestRespawn()).toBe(false);
      lethalHit(); // repeated hits cannot immediately kill the new spawn
      expect(game.player.vitality).toBe(100); expect(net.send).toHaveBeenCalledTimes(messageCount);
      expect(internals.lastHit).toBeNull();
    },
  );

  it('credits the final attacker rather than an earlier attacker', () => {
    const { game, internals, session, attacker, hit } = combat();
    internals.players.set('earlier', { id: 'earlier', name: 'Earlier', color: '#fff', kills: 0, deaths: 0 });
    internals.lastHit = { by: 'earlier', at: performance.now(), how: 'melee' };
    hit();
    expect(internals.players.get(attacker)?.kills).toBe(1);
    expect(internals.players.get('earlier')?.kills).toBe(0);
    expect(internals.players.get(session.selfId)?.deaths).toBe(1);
    expect(game.player.dead).toBe(true);
  });

  it('does not credit protected or shield-blocked hits', () => {
    const { game, net, internals, attacker, hit } = combat();
    const earlier = { by: 'earlier', at: performance.now(), how: 'melee' };
    internals.lastHit = earlier;
    game.player.invulnerable = 3; hit();
    expect(internals.lastHit).toEqual(earlier); expect(game.player.vitality).toBe(1);
    game.player.invulnerable = 0;
    useInventoryStore.setState({ equipment: { ...useInventoryStore.getState().equipment, offhand: makeStack('wood_shield', 1) } });
    vi.spyOn(Math, 'random').mockReturnValue(0); hit();
    expect(internals.lastHit).toEqual(earlier); expect(game.player.vitality).toBe(1);
    expect(net.send).toHaveBeenCalledWith({ t: 'blk', id: 'host', to: attacker }, attacker);
    expect(internals.players.get(attacker)?.kills).toBe(0);
  });

  it('freezes a requested spawn until its ground is loaded', () => {
    const { game, hit, session } = combat();
    Object.assign(game, { chunks: { isReady: () => false } });
    hit();
    expect(session.requestRespawn()).toBe(true);
    expect(game.player.dead).toBe(false); expect(game.player.waitingForGround).toBe(true);
    expect(game.player.invulnerable).toBe(3); expect(game.player.body.vel.length()).toBe(0);
  });

  it('keeps a round-ending death on the results screen instead of respawning', () => {
    const { game, net, session, hit } = combat();
    session.settings.killLimit = 1;
    hit();
    expect(usePvpStore.getState()).toMatchObject({ phase: 'ended', scoreboardOpen: true, winner: 'Attacker', respawnIn: 0 });
    expect(game.player.dead).toBe(true);
    expect(session.randomSpawn).not.toHaveBeenCalled();
    expect(vi.mocked(net.send).mock.calls.filter(([msg]) => msg.t === 's')).toHaveLength(1);
    const count = vi.mocked(net.send).mock.calls.length;
    session.onLocalDeath('duplicate'); expect(net.send).toHaveBeenCalledTimes(count);
    session.update(10);
    expect(game.player.dead).toBe(true); expect(session.randomSpawn).not.toHaveBeenCalled();
    expect(session.requestRespawn()).toBe(false);
  });
});

describe('untimed shared-world rooms', () => {
  it.each([[true, 'battle'], [false, 'battle'], [true, 'together'], [false, 'together']] as const)(
    'host=%s style=%s never expires, including legacy settings and welcome clocks', (host, style) => {
      const { net, game, session, internals } = setup(host, style);
      const end = vi.spyOn(internals, 'endMatch');
      expect(usePvpStore.getState().timeLeft).toBeNull();
      if (!host) internals.receive('host', { t: 'clock', time: 700, left: 1 });
      session.update(3600);
      expect(internals.timeLeft).toBeNull();
      expect(usePvpStore.getState().timeLeft).toBeNull();
      expect(end).not.toHaveBeenCalled();
      if (host) expect(net.send).toHaveBeenCalledWith({ t: 'clock', time: game.clock.time, left: null });
      else expect(game.clock.time).toBe(700);
      if (host) {
        vi.spyOn(internals, 'restartLocal').mockImplementation(() => {});
        session.restartMatch(); expect(internals.timeLeft).toBeNull();
      }
    },
  );
});

describe('shared-world sleep synchronization', () => {
  it('host accepts sleep at an available nearby bed and broadcasts morning without a countdown', () => {
    const { game, net, internals } = setup();
    internals.remotes.set('guest', { pos: new THREE.Vector3(4.5, 11, 6.5), dead: false, dispose: vi.fn() });
    internals.players.set('guest', { id: 'guest', name: 'Guest', color: '#fff', kills: 0, deaths: 0 });
    internals.receive('guest', { t: 'sleep', request: 1, bed: { x: 4, y: 11, z: 4 } });
    expect(game.clock.dayFraction).toBeCloseTo(0.27);
    expect(net.send).toHaveBeenCalledWith({ t: 'clock', time: game.clock.time, left: null });
    expect(net.send).toHaveBeenCalledWith({ t: 'awake', request: 1, accepted: true, time: game.clock.time }, 'guest');
  });

  it.each(['missing-bed', 'far-away', 'daytime', 'enemy-nearby', 'unknown-player', 'invalid-coordinates'])('host rejects %s sleep requests', (reason) => {
    const { game, net, internals } = setup();
    internals.remotes.set('guest', { pos: new THREE.Vector3(4.5, 11, 6.5), dead: false, dispose: vi.fn() });
    internals.players.set('guest', { id: 'guest', name: 'Guest', color: '#fff', kills: 0, deaths: 0 });
    const bed = { x: 4, y: 11, z: 4 };
    if (reason === 'missing-bed') game.world.set(4, 11, 4, B.AIR);
    if (reason === 'far-away') internals.remotes.get('guest')!.pos.set(14, 11, 14);
    if (reason === 'daytime') game.clock.time = 0;
    if (reason === 'unknown-player') internals.players.clear();
    if (reason === 'invalid-coordinates') bed.x = NaN;
    if (reason === 'enemy-nearby') Object.assign(game.entities, { creatures: [{ def: { hostile: true }, fade: 0, body: { pos: new THREE.Vector3(4, 11, 4) } }] });
    const time = game.clock.time;
    internals.receive('guest', { t: 'sleep', request: 1, bed });
    expect(game.clock.time).toBe(time);
    expect(net.send).toHaveBeenCalledWith({ t: 'awake', request: 1, accepted: false, time }, 'guest');
  });

  it('guest applies an accepted reply once and ignores unsolicited or duplicate replies', () => {
    const { game, net, session, internals } = setup(false);
    const bed = { x: 4, y: 11, z: 4 };
    internals.receive('host', { t: 'awake', request: 1, accepted: true, time: 2000 });
    expect(game.completeBedSleep).not.toHaveBeenCalled();
    session.requestSleep(bed);
    expect(net.send).toHaveBeenCalledWith({ t: 'sleep', request: 1, bed });
    internals.receive('host', { t: 'awake', request: 1, accepted: true, time: 2000 });
    internals.receive('host', { t: 'awake', request: 1, accepted: true, time: 2000 });
    expect(game.clock.time).toBe(2000);
    expect(game.pendingBed).toEqual(bed);
    expect(game.completeBedSleep).toHaveBeenCalledExactlyOnceWith(false);
  });
});
