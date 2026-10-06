import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../Game';
import { GameClock } from '../core/GameClock';
import { World } from '../world/World';
import { Chunk } from '../world/Chunk';
import { B, blockId } from '../world/BlockRegistry';
import { Player } from './Player';
import { FurnitureInteraction } from './FurnitureInteraction';
import { useGameStore } from '../../stores/gameStore';
import { useRestStore } from '../../stores/restStore';
import { useWorldStore } from '../../stores/worldStore';
import { useBuildStore } from '../../stores/buildStore';
import { BuildObjects } from '../build/BuildObjects';
import { objectMaterials } from '../build/ObjectGeometry';
import { createWorldUniforms } from '../rendering/TerrainMaterials';

const CHAIR = blockId('chair');
const oldGame = useGameStore.getState(), oldWorld = useWorldStore.getState(), oldBuild = useBuildStore.getState();
afterEach(() => {
  vi.restoreAllMocks(); useGameStore.setState(oldGame); useWorldStore.setState(oldWorld); useBuildStore.setState(oldBuild);
  useRestStore.setState({ bed: null, chair: null, seated: false });
});

function setup(build = false) {
  useGameStore.setState({ overlay: null });
  const world = new World(1);
  world.addChunk(Chunk.empty(0, 0));
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) world.set(x, 10, z, B.STONE);
  const pressed = new Set<string>(), mv = new THREE.Vector2();
  const game = Object.assign(Object.create(Game.prototype), {
    world, scene: new THREE.Scene(), chunks: { isReady: () => true },
    clock: new GameClock(600, 20), time: 1, isBuild: build, build: null, dm: null, pvp: null,
    boats: { riding: null }, entities: { creatures: [], hostileNear: vi.fn().mockReturnValue(0), poof: vi.fn() },
    audio: { play: vi.fn() }, bus: { emit: vi.fn() }, saveNow: vi.fn().mockResolvedValue(true),
    input: { moveVector: () => mv, isDown: (key: string) => pressed.has(key), wasPressed: (key: string) => pressed.has(key),
      touch: { jump: false, interactPressed: false }, requestLock: vi.fn() },
    openOverlay: vi.fn((overlay) => useGameStore.setState({ overlay })),
    closeOverlay: vi.fn(() => useGameStore.setState({ overlay: null })),
  }) as Game;
  Object.assign(game, { player: new Player(game), rest: new FurnitureInteraction(game) });
  game.player.teleport(4.5, 11, 6.5);
  if (build) Object.assign(game, { build: { usesFreeCamera: () => false, objects: new BuildObjects(world, objectMaterials(createWorldUniforms())) } });
  return { game, world, rest: game.rest, pressed, mv };
}

describe('nearby bed and chair actions', () => {
  it('offers both proximity actions without aiming at the furniture', () => {
    const { game, world, rest } = setup();
    world.set(4, 11, 4, CHAIR);
    world.set(6, 11, 5, B.BED);
    rest.update(0.1, true);
    expect(useRestStore.getState()).toMatchObject({ bed: 'Cozy Cot', chair: 'Chair' });
    rest.activate('sleep');
    expect(game.pendingBed).toMatchObject({ x: 6, y: 11, z: 5 });
    expect(game.openOverlay).toHaveBeenCalledWith('sleep');
  });

  it('sits, keeps a safe save position, and stands on movement without consuming furniture', () => {
    const { game, world, rest, mv } = setup();
    world.set(4, 11, 4, CHAIR);
    const before = game.player.position.clone();
    rest.activate('sit');
    expect(game.player.seated).toBe(true);
    expect(game.player.body.vel.length()).toBe(0);
    expect(rest.savePosition()).toEqual(before);
    mv.set(0, 1);
    rest.update(0.1, true);
    expect(rest.seated).toBe(false);
    expect(rest.consumed).toBe(true);
    expect(game.player.position).toEqual(before);
    expect(world.get(4, 11, 4)).toBe(CHAIR);
  });

  it('uses jump and Interact to stand once; teleport clears the seated state', () => {
    const { game, world, rest, pressed } = setup();
    world.set(4, 11, 4, CHAIR);
    for (const key of ['jump', 'interact']) {
      rest.activate('sit'); pressed.add(key); rest.update(0.1, true); pressed.clear();
      expect(rest.seated).toBe(false);
      expect(rest.consumed).toBe(true);
    }
    rest.activate('sit');
    game.player.teleport(8, 11, 8);
    expect(rest.seated).toBe(false);
    expect(game.player.seated).toBe(false);
  });

  it.each([0, 1, 2, 3])('faces the front of a voxel chair at rotation %i', (rotation) => {
    const { game, world, rest } = setup();
    world.set(4, 11, 4, CHAIR, rotation);
    rest.activate('sit');
    expect(rest.seated).toBe(true);
    const dir = game.player.lookDirection();
    expect(dir.x).toBeCloseTo(Math.sin(rotation * Math.PI / 2));
    expect(dir.z).toBeCloseTo(-Math.cos(rotation * Math.PI / 2));
  });

  it('does not expose furniture through walls or outside reach', () => {
    const { game, world, rest } = setup();
    world.set(4, 11, 4, CHAIR);
    world.set(4, 11, 5, B.STONE); world.set(4, 12, 5, B.STONE);
    rest.update(0.1, true);
    expect(useRestStore.getState().chair).toBeNull();
    rest.activate('sit'); expect(rest.seated).toBe(false);
    game.player.teleport(12, 11, 12); rest.update(0.3, true);
    expect(useRestStore.getState().chair).toBeNull();
  });

  it('rechecks deleted furniture and leaves if a seated chair is removed', () => {
    const { world, rest } = setup();
    world.set(4, 11, 4, CHAIR); rest.update(0.1, true);
    world.set(4, 11, 4, B.AIR); rest.activate('sit');
    expect(rest.seated).toBe(false);
    world.set(4, 11, 4, CHAIR); rest.activate('sit');
    world.set(4, 11, 4, B.STONE); rest.update(0.1, true);
    expect(rest.seated).toBe(false);
  });

  it('prevents seating below a low ceiling and uses a clear alternative when the original exit is blocked', () => {
    const { game, world, rest } = setup();
    world.set(4, 11, 4, CHAIR); world.set(4, 12, 4, B.STONE);
    rest.activate('sit'); expect(rest.seated).toBe(false);
    world.set(4, 12, 4, B.AIR); rest.activate('sit');
    world.set(4, 11, 6, B.STONE); world.set(4, 12, 6, B.STONE);
    rest.stand();
    expect(rest.seated).toBe(false);
    expect(game.player.position.z).not.toBe(6.5);
  });

  it('Build Home object chairs sit, and object beds sleep even with daytime locked', () => {
    const { game, rest } = setup(true);
    const objects = game.build!.objects;
    const chair = objects.add({ itemId: 'dining_chair', variantId: 'oak', x: 4.5, y: 11, z: 4.5, rotation: Math.PI / 2 })!;
    rest.useObject(chair); expect(rest.seated).toBe(true);
    rest.stand(); objects.remove(chair.id);
    const bed = objects.add({ itemId: 'bed_double', variantId: 'white', x: 4.5, y: 11, z: 4.5, rotation: 0 })!;
    game.clock.time = 0; // daytime
    rest.useObject(bed); game.sleepAtBed('sleep');
    expect(game.clock.dayFraction).toBeCloseTo(0.27);
    expect(game.player.hasBuff('well_rested')).toBe(true);
    expect(game.saveNow).toHaveBeenCalledWith('sleep');
    objects.dispose();
  });

  it('stands safely when a friend moves the occupied Build Home chair', () => {
    const { game, rest } = setup(true);
    const objects = game.build!.objects;
    const chair = objects.add({ itemId: 'dining_chair', variantId: 'oak', x: 4.5, y: 11, z: 4.5, rotation: 0 })!;
    rest.useObject(chair); expect(rest.seated).toBe(true);
    objects.patch(chair.id, { x: 12 });
    rest.update(0.1, true);
    expect(rest.seated).toBe(false);
    expect(game.player.position.toArray()).toEqual([4.5, 11, 6.5]);
    objects.dispose();
  });

  it('keeps survival night and nearby-enemy requirements; stale beds do not heal', () => {
    const { game, world, rest } = setup();
    world.set(4, 11, 4, B.BED);
    game.clock.time = 0; rest.activate('sleep'); game.sleepAtBed('sleep');
    expect(game.player.hasBuff('well_rested')).toBe(false);
    game.clock.time = 600;
    vi.mocked(game.entities.hostileNear).mockReturnValue(1);
    rest.activate('sleep'); game.sleepAtBed('sleep');
    expect(game.player.hasBuff('well_rested')).toBe(false);
    vi.mocked(game.entities.hostileNear).mockReturnValue(0);
    rest.activate('sleep'); world.set(4, 11, 4, B.AIR); game.sleepAtBed('sleep');
    expect(game.player.hasBuff('well_rested')).toBe(false);
    world.set(4, 11, 4, B.BED); rest.activate('sleep'); game.sleepAtBed('sleep');
    expect(game.player.hasBuff('well_rested')).toBe(true);
  });
});
