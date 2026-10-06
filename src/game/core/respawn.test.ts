import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../Game';
import { Player } from '../player/Player';
import { World } from '../world/World';
import { Chunk } from '../world/Chunk';
import { B } from '../world/BlockRegistry';
import { VOID_Y } from '../world/constants';
import { EventBus } from './EventBus';
import { useGameStore, type Difficulty } from '../../stores/gameStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { usePlayerStore } from '../../stores/playerStore';
import { useWorldStore } from '../../stores/worldStore';
import { makeStack } from '../systems/InventoryLogic';
import { BuildNavigation } from '../build/BuildNavigation';

const oldGame = useGameStore.getState(), oldWorld = useWorldStore.getState();
const oldInventory = useInventoryStore.getState(), oldPlayer = usePlayerStore.getState();
afterEach(() => {
  vi.restoreAllMocks();
  useGameStore.setState(oldGame); useWorldStore.setState(oldWorld);
  useInventoryStore.setState(oldInventory); usePlayerStore.setState(oldPlayer);
});

function setup(difficulty: Difficulty = 'explorer', home = true) {
  useGameStore.setState({ screen: 'playing', overlay: null, death: null, toasts: [] });
  useWorldStore.setState({ home: home ? { x: 8, y: 11, z: 8 } : null, camp: { x: 2, y: 11, z: 2 }, deathMarker: null });
  useInventoryStore.getState().reset();
  const world = new World(1); world.addChunk(Chunk.empty(0, 0));
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) world.set(x, 10, z, B.STONE);
  const ready = vi.fn().mockReturnValue(true);
  const game = Object.assign(Object.create(Game.prototype), {
    world, scene: new THREE.Scene(), difficulty, dm: null, pvp: null, build: null, ready: true, disposed: false,
    chunks: { isReady: ready }, rest: { release: vi.fn(), stand: vi.fn() },
    boats: { riding: null, dismount: vi.fn() }, bus: new EventBus(),
    audio: { play: vi.fn() }, particles: { emit: vi.fn() },
    drops: { spawn: vi.fn(), throwFromPlayer: vi.fn() }, containers: { set: vi.fn() },
    input: {
      gyro: { configure: vi.fn(), take: () => ({ yaw: 0, pitch: 0 }) }, cursorFree: false,
      lookX: 0, lookY: 0, moveVector: () => new THREE.Vector2(), isDown: () => false, wasPressed: () => false,
      touch: { active: false, jump: false, crouch: false, sprint: false }, requestLock: vi.fn(),
    },
  }) as Game;
  Object.assign(game, { player: new Player(game) });
  game.player.teleport(4.5, 11, 6.5);
  return { game, ready };
}

function inventory() {
  const snap = useInventoryStore.getState().snapshot();
  snap.slots[0] = { ...makeStack('scrap_axe', 1), durability: 7 };
  snap.slots[1] = makeStack('stick', 9);
  snap.slots[9] = makeStack('stick', 5);
  snap.slots[10] = { ...makeStack('scrap_axe', 1), durability: 11 };
  snap.slots[11] = makeStack('sunbread', 3);
  snap.slots[12] = makeStack('grass_seeds', 1);
  snap.slots[13] = makeStack('planks', 7);
  snap.equipment.feet = makeStack('trail_boots', 1);
  useInventoryStore.getState().load(snap);
  return snap;
}

describe('immediate survival respawn', () => {
  it.each([
    ['peaceful', true], ['peaceful', false], ['explorer', true], ['explorer', false],
    ['adventurer', true], ['adventurer', false],
  ] as const)('%s with home=%s revives immediately and keeps difficulty-specific losses', (difficulty, home) => {
    const { game } = setup(difficulty, home);
    const before = inventory();
    const died = vi.fn(() => {
      expect(game.player.dead).toBe(true);
      expect(game.player.position.toArray()).toEqual([4.5, 11, 6.5]);
    });
    game.bus.on('playerDied', died);
    game.player.maxVitality = 120; game.player.energy = 20;
    game.player.hurt(1000, 'fall');
    expect(game.player.dead).toBe(false);
    expect(game.player.vitality).toBe(90);
    expect(game.player.energy).toBe(60);
    expect(game.player.invulnerable).toBe(3);
    expect(game.player.position.toArray()).toEqual(home ? [8.5, 11.1, 8.5] : [2.5, 11.1, 2.5]);
    expect(useGameStore.getState()).toMatchObject({ overlay: null, death: null });
    expect(useWorldStore.getState().deathMarker).toEqual({ x: 4, z: 6 });
    expect(died).toHaveBeenCalledExactlyOnceWith({ cause: 'fall' });
    const after = useInventoryStore.getState().snapshot();
    expect(after.equipment).toEqual(before.equipment);
    const drops = vi.mocked(game.drops.spawn).mock.calls;
    expect(drops.every(([, x, y, z]) => x === 4.5 && y === 11.5 && z === 6.5)).toBe(true);
    if (difficulty === 'peaceful') {
      expect(after).toEqual(before); expect(drops).toHaveLength(0);
    } else if (difficulty === 'explorer') {
      expect(after.slots.slice(0, 9)).toEqual(before.slots.slice(0, 9));
      expect(after.slots[9]).toEqual(makeStack('stick', 2));
      expect(after.slots[10]).toEqual(before.slots[10]);
      expect(after.slots[11]).toEqual(makeStack('sunbread', 1));
      expect(after.slots[12]).toBeNull();
      expect(after.slots[13]).toEqual(makeStack('planks', 3));
      expect(drops.map(([s]) => [s.item, s.count])).toEqual([['stick', 3], ['sunbread', 2], ['grass_seeds', 1], ['planks', 4]]);
    } else {
      expect(after.slots.every((s) => s === null)).toBe(true);
      expect(drops.map(([s]) => s)).toEqual(before.slots.filter((s) => s !== null));
    }
    const dropCount = drops.length;
    expect(game.player.hurt(1000, 'fall')).toBe(0);
    expect(died).toHaveBeenCalledTimes(1);
    expect(game.drops.spawn).toHaveBeenCalledTimes(dropCount);
    expect(useGameStore.getState().toasts.at(-1)?.text).toContain(`Respawned at ${home ? 'home' : 'starting camp'}`);
  });

  it('freezes immediately at an unloaded destination until terrain is ready', () => {
    const { game, ready } = setup();
    useWorldStore.setState({ home: { x: 80, y: 30, z: 80 } });
    ready.mockReturnValue(false);
    game.player.hurt(1000, 'fall');
    expect(game.player.dead).toBe(false); expect(game.player.waitingForGround).toBe(true);
    const spawn = game.player.position.clone();
    game.player.update(0.1, true);
    expect(game.player.position).toEqual(spawn);
    expect(game.player.body.vel.length()).toBe(0);
    expect(game.player.invulnerable).toBe(3);
    ready.mockReturnValue(true); game.player.update(0.01, true);
    expect(game.player.waitingForGround).toBe(false);
  });

  it('uses the existing safety check when the home has become blocked', () => {
    const { game } = setup();
    game.world.set(8, 11, 8, B.STONE); game.world.set(8, 12, 8, B.STONE);
    game.player.hurt(1000, 'fall');
    expect(game.player.dead).toBe(false);
    expect(game.player.position.y).toBeGreaterThan(12);
    expect(game.world.isSolid(8, Math.floor(game.player.position.y), 8)).toBe(false);
  });

  it('keeps the home spawn when void damage is lethal instead of running a second rescue', () => {
    const { game } = setup();
    game.player.teleport(4.5, VOID_Y - 5, 6.5); game.player.vitality = 1;
    const respawn = vi.spyOn(game, 'respawn');
    game.player.update(0.01, true);
    expect(respawn).toHaveBeenCalledExactlyOnceWith('home');
    expect(game.player.position.toArray()).toEqual([8.5, 11.1, 8.5]);
    expect(game.player.dead).toBe(false);
  });

  it('still rescues nonlethal void falls without dropping items or resetting health', () => {
    const { game } = setup(); inventory();
    game.player.teleport(4.5, VOID_Y - 5, 6.5);
    const respawn = vi.spyOn(game, 'respawn');
    game.player.update(0.01, true);
    expect(respawn).toHaveBeenCalledExactlyOnceWith('safe');
    expect(game.player.vitality).toBe(90);
    expect(game.player.position.x).toBe(4.5); expect(game.player.position.y).toBeGreaterThan(10);
    expect(game.drops.spawn).not.toHaveBeenCalled();
    expect(useWorldStore.getState().deathMarker).toBeNull();
  });

  it('leaves creative Build Home invulnerable', () => {
    const { game } = setup(); game.player.creative = true;
    const spawn = game.player.position.clone();
    expect(game.player.hurt(1000, 'fall')).toBe(0);
    expect(game.player.position).toEqual(spawn); expect(game.player.dead).toBe(false);
    expect(game.drops.spawn).not.toHaveBeenCalled();
  });

  it('leaves Deathmatch health and death handling to its referee', () => {
    const { game } = setup();
    const envDamage = vi.fn().mockReturnValue(10);
    Object.assign(game, { dm: { envDamage } });
    const spawn = game.player.position.clone(), respawn = vi.spyOn(game, 'respawn');
    expect(game.player.hurt(1000, 'fall')).toBe(10);
    expect(envDamage).toHaveBeenCalledWith(1000, 'fall');
    game.player.dead = true; game.onPlayerDeath('fall');
    expect(game.player.dead).toBe(true); expect(game.player.position).toEqual(spawn);
    expect(respawn).not.toHaveBeenCalled(); expect(game.drops.spawn).not.toHaveBeenCalled();
  });
});

describe('Pause-menu Quick Respawn', () => {
  it.each([true, false])('rescues a living player with home=%s without changing health, items or progress', async (home) => {
    const { game } = setup('adventurer', home);
    const before = inventory();
    useGameStore.setState({ overlay: 'pause' });
    useWorldStore.setState({ deathMarker: { x: 17, z: 23 }, stats: { defeated: 12 } });
    game.player.vitality = 79; game.player.energy = 51;
    game.player.buffs = [{ id: 'well_fed', remaining: 20 }];
    game.player.body.vel.set(2, -8, 3);
    const died = vi.fn(); game.bus.on('playerDied', died);
    expect(await game.quickRespawn()).toBeNull();
    expect(game.player.position.toArray()).toEqual(home ? [8.5, 11.1, 8.5] : [2.5, 11.1, 2.5]);
    expect(game.player.body.vel.length()).toBe(0);
    expect(game.player.dead).toBe(false); expect(game.player.vitality).toBe(79); expect(game.player.energy).toBe(51);
    expect(game.player.buffs).toEqual([{ id: 'well_fed', remaining: 20 }]);
    expect(game.player.invulnerable).toBe(2);
    expect(useInventoryStore.getState().snapshot()).toEqual(before);
    expect(useWorldStore.getState()).toMatchObject({ deathMarker: { x: 17, z: 23 }, stats: { defeated: 12 } });
    expect(useGameStore.getState().overlay).toBeNull();
    expect(died).not.toHaveBeenCalled(); expect(game.drops.spawn).not.toHaveBeenCalled();
  });

  it('dismounts a boat before moving and immediately waits for missing ground', async () => {
    const { game, ready } = setup();
    Object.assign(game.boats, { riding: {}, dismount: vi.fn(() => { game.player.teleport(4.5, 11, 6.5); }) });
    ready.mockReturnValue(false); game.player.invulnerable = 4;
    expect(await game.quickRespawn()).toBeNull();
    expect(game.boats.dismount).toHaveBeenCalledOnce();
    expect(game.player.position.toArray()).toEqual([8.5, 11.1, 8.5]);
    expect(game.player.waitingForGround).toBe(true); expect(game.player.invulnerable).toBe(4);
  });

  it.each(['loading', 'closed', 'dead', 'deathmatch'] as const)('rejects %s rescue without moving or closing Pause', async (why) => {
    const { game } = setup();
    useGameStore.setState({ overlay: 'pause' });
    if (why === 'loading') game.ready = false;
    if (why === 'closed') Object.assign(game, { disposed: true });
    if (why === 'dead') game.player.dead = true;
    if (why === 'deathmatch') Object.assign(game, { dm: {} });
    const pos = game.player.position.clone();
    expect(await game.quickRespawn()).toEqual(expect.any(String));
    expect(game.player.position).toEqual(pos); expect(useGameStore.getState().overlay).toBe('pause');
  });

  it('routes friend-room rescue through existing cooldown rules and resumes only on success', async () => {
    const { game } = setup();
    const quickRespawn = vi.fn().mockReturnValue('Ready again in 8 s.');
    Object.assign(game, { pvp: { quickRespawn } });
    useGameStore.setState({ overlay: 'pause' });
    const pos = game.player.position.clone();
    expect(await game.quickRespawn()).toBe('Ready again in 8 s.');
    expect(game.player.position).toEqual(pos); expect(useGameStore.getState().overlay).toBe('pause');
    quickRespawn.mockReturnValue(null);
    expect(await game.quickRespawn()).toBeNull();
    expect(quickRespawn).toHaveBeenCalledTimes(2); expect(useGameStore.getState().overlay).toBeNull();
  });

  it('uses collision-checked Build navigation and resumes after the entrance loads', async () => {
    const { game, ready } = setup();
    const onTeleport = vi.fn();
    const navigation = new BuildNavigation(game, onTeleport);
    Object.assign(game, { build: { navigation } });
    game.player.creative = true; game.player.vitality = 79; game.player.energy = 51;
    useGameStore.setState({ overlay: 'pause' });
    ready.mockReturnValue(false);
    let finished = false;
    const rescue = game.quickRespawn().then((why) => { finished = true; return why; });
    expect(finished).toBe(false); expect(navigation.target?.toArray()).toEqual([0.5, 0, 6.5]);
    expect(game.player.position.toArray()).toEqual([4.5, 11, 6.5]);
    game.world.objectColliders = (_a, _b, _c, _d, _e, _f, out) => { out.push(0, 11, 6, 1, 13, 7); };
    ready.mockReturnValue(true); navigation.update();
    expect(await rescue).toBeNull();
    expect(game.player.position.x).toBe(0.5); expect(game.player.position.z).toBe(6.5); expect(game.player.position.y).toBeGreaterThanOrEqual(13);
    expect(game.player.vitality).toBe(79); expect(game.player.energy).toBe(51);
    expect(onTeleport).toHaveBeenCalledOnce(); expect(useGameStore.getState().overlay).toBeNull();
  });

  it('leaves Build Pause open if there is no safe space at the entrance', async () => {
    const { game } = setup();
    const navigation = new BuildNavigation(game, vi.fn());
    Object.assign(game, { build: { navigation } }); useGameStore.setState({ overlay: 'pause' });
    for (let y = 11; y < 127; y++) game.world.set(0, y, 6, B.STONE);
    const pos = game.player.position.clone();
    expect(await game.quickRespawn()).toContain('no clear space');
    expect(game.player.position).toEqual(pos); expect(useGameStore.getState().overlay).toBe('pause');
  });
});
