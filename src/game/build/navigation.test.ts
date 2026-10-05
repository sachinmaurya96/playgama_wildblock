import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { B } from '../world/BlockRegistry';
import { Chunk } from '../world/Chunk';
import { generatePlotChunk, PLOT_Y } from '../world/PlotGenerator';
import { World } from '../world/World';
import { boxCollides } from '../player/VoxelPhysics';
import { BuildNavigation } from './BuildNavigation';

function setup(loaded = true) {
  const world = new World(7, 'meadow');
  if (loaded) world.addChunk(new Chunk(generatePlotChunk(0, 0, world.plotSampler!)));
  const body = { pos: new THREE.Vector3(1.5, 41.05, 1.5), vel: new THREE.Vector3(3, -8, 2), halfW: 0.3, height: 1.72, grounded: true };
  const player = {
    body,
    teleport: vi.fn((x: number, y: number, z: number) => { body.pos.set(x, y, z); body.vel.set(0, 0, 0); }),
  };
  const chunks = { isReady: vi.fn((x: number, z: number) => world.isLoaded(x, z)) };
  const onTeleport = vi.fn();
  const notify = vi.fn();
  const navigation = new BuildNavigation({ world, player, chunks, audio: { play: vi.fn() }, notify } as unknown as ConstructorParameters<typeof BuildNavigation>[0], onTeleport);
  return { navigation, world, player, onTeleport, notify };
}
afterEach(() => { vi.restoreAllMocks(); });

describe('Build Home teleport destinations', () => {
  it('lands on the plot when Y is omitted and clears old movement', async () => {
    const { navigation, player, onTeleport } = setup();
    expect(await navigation.teleportTo(10, 12)).toBeNull();
    expect(player.body.pos.toArray()).toEqual([10.5, PLOT_Y + 1.05, 12.5]);
    expect(player.body.vel.length()).toBe(0);
    expect(player.body.grounded).toBe(false);
    expect(onTeleport).toHaveBeenCalledOnce();
  });

  it('keeps an explicit indoor Y instead of moving onto the roof', async () => {
    const { navigation, world, player } = setup();
    world.set(5, 45, 5, B.STONE);
    expect(await navigation.teleportTo(5, 5, 41.05)).toBeNull();
    expect(player.body.pos.y).toBe(41.05);
  });

  it('lifts the whole body clear of blocks at an occupied coordinate', async () => {
    const { navigation, world, player } = setup();
    world.set(5, 41, 5, B.STONE);
    world.set(5, 42, 5, B.STONE);
    expect(await navigation.teleportTo(5, 5, 41)).toBeNull();
    expect(player.body.pos.y).toBe(43);
    expect(boxCollides(world, 5.2, 43, 5.2, 5.8, 44.72, 5.8)).toBe(false);
  });

  it('checks furniture and door colliders as well as voxels', async () => {
    const { navigation, world, player } = setup();
    world.objectColliders = (_a, _b, _c, _d, _e, _f, out) => { out.push(5, 41, 5, 6, 43, 6); };
    expect(await navigation.teleportTo(5, 5, 41)).toBeNull();
    expect(player.body.pos.y).toBe(43);
  });

  it('streams unloaded terrain before moving, including pending build edits', async () => {
    const { navigation, world, player, onTeleport } = setup(false);
    const move = navigation.teleportTo(5, 5);
    expect(player.teleport).not.toHaveBeenCalled();
    expect(navigation.target?.toArray()).toEqual([5.5, 0, 5.5]);
    world.applyRemote(5, 44, 5, B.STONE, 0);
    world.addChunk(new Chunk(generatePlotChunk(0, 0, world.plotSampler!)));
    navigation.update();
    expect(await move).toBeNull();
    expect(player.body.pos.y).toBe(45.05);
    expect(onTeleport).toHaveBeenCalledOnce();
    expect(navigation.target).toBeNull();
  });

  it.each([[128, 0], [-129, 0], [0, 128], [0, -129], [NaN, 0], [0, Infinity]])('rejects an off-lot or invalid destination %s %s', async (x, z) => {
    const { navigation, player } = setup();
    expect(await navigation.teleportTo(x, z)).toContain('inside the lot');
    expect(player.teleport).not.toHaveBeenCalled();
  });

  it.each([NaN, Infinity, -4, 0, 121])('rejects an invalid Y %s', async (y) => {
    const { navigation, player } = setup();
    expect(await navigation.teleportTo(5, 5, y)).toContain('Y must');
    expect(player.teleport).not.toHaveBeenCalled();
  });

  it('leaves the player where they were if there is no space below the height limit', async () => {
    const { navigation, world, player } = setup();
    for (let y = 41; y < 127; y++) world.set(5, y, 5, B.STONE);
    expect(await navigation.teleportTo(5, 5)).toContain('no clear space');
    expect(player.teleport).not.toHaveBeenCalled();
  });

  it('times out an unavailable destination without moving or keeping the loading target', async () => {
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { navigation, player } = setup(false);
    const move = navigation.teleportTo(5, 5);
    now += 16000;
    navigation.update();
    expect(await move).toContain('could not load');
    expect(player.teleport).not.toHaveBeenCalled();
    expect(navigation.target).toBeNull();
  });

  it('finishes a pending request when the project closes and rejects new requests', async () => {
    const { navigation, player } = setup(false);
    const move = navigation.teleportTo(5, 5);
    navigation.dispose();
    expect(await move).toContain('closed');
    expect(await navigation.teleportTo(0, 0)).toContain('closed');
    expect(player.teleport).not.toHaveBeenCalled();
  });

  it('rejects a second teleport while the first destination is still loading', async () => {
    const { navigation } = setup(false);
    const move = navigation.teleportTo(5, 5);
    expect(await navigation.teleportTo(10, 10)).toContain('already in progress');
    navigation.dispose();
    await move;
  });
});
