import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { B } from '../world/BlockRegistry';
import { Chunk } from '../world/Chunk';
import { World } from '../world/World';
import { generatePlotChunk, PLOT_Y } from '../world/PlotGenerator';
import { createWorldUniforms } from '../rendering/TerrainMaterials';
import { objectMaterials } from './ObjectGeometry';
import { BuildObjects } from './BuildObjects';
import { BuildMode, inLot } from './BuildMode';
import { BuildHistory } from './BuildHistory';
import { PastePlacement, type PlacementClip } from './PastePlacement';
import { presetBlueprint, PRESET_IDS } from './Presets';
import type { P3 } from './BuildTools';
import type { PlotType } from '../../persistence/types';
import { useBuildStore } from '../../stores/buildStore';

const originalBuild = useBuildStore.getState();
const resources: { objects: BuildObjects; mats: ReturnType<typeof objectMaterials> }[] = [];
const origin: P3 = { x: 4, y: PLOT_Y, z: 4 };
const small: PlacementClip = { name: 'Room', size: [4, 4, 6], blocks: [[0, 0, 0, B.ARCH_BLOCK, 0], [3, 3, 5, B.ARCH_BLOCK, 0]], objects: [] };

function setup(plot: PlotType = 'meadow', existing?: World) {
  const world = existing ?? new World(7, plot);
  for (let cz = -1; cz <= 3; cz++) for (let cx = -1; cx <= 3; cx++) world.addChunk(new Chunk(generatePlotChunk(cx, cz, world.plotSampler!)));
  const mats = objectMaterials(createWorldUniforms());
  const objects = new BuildObjects(world, mats);
  resources.push({ objects, mats });
  const placement = new PastePlacement(world, objects, inLot);
  return { world, objects, placement };
}

function harness() {
  const { world, objects, placement } = setup();
  const flash = vi.fn();
  const audio = { play: vi.fn() };
  const input = { mouseLeftPressed: false, touch: { placePressed: false } };
  const ghost = new THREE.Group();
  const tint = vi.fn();
  const history = new BuildHistory();
  const build = Object.assign(Object.create(BuildMode.prototype), {
    game: { world, input, audio, farming: { crops: new Map() }, growthNow: () => 0 },
    objects, history, pastePlacement: placement, pasteSteps: 0, pasteGhost: ghost,
    flash, setPasteGhost: vi.fn(), setGhostTint: tint, pasteOrigin: () => origin, selectedId: null,
  }) as BuildMode;
  const internal = build as unknown as { commitPaste(clip: PlacementClip, point: P3): void; updatePaste(dt: number): void };
  useBuildStore.setState({ selectedItem: null, pasting: true });
  return { world, objects, placement, build, internal, flash, audio, input, ghost, tint, history };
}

afterEach(() => {
  for (const { objects, mats } of resources.splice(0)) { objects.dispose(); for (const mat of Object.values(mats)) mat.dispose(); }
  vi.restoreAllMocks();
  useBuildStore.setState(originalBuild);
});

describe('house placement areas', () => {
  it.each(['meadow', 'studio', 'desert'] as const)('allows all ten house presets and every rotation on a fresh %s plot', (plot) => {
    const { placement } = setup(plot);
    for (const id of PRESET_IDS) {
      const house = presetBlueprint(id)!;
      for (let steps = 0; steps < 4; steps++) expect(placement.validate(house, origin, steps), `${id} at ${steps * 90}°`).toBeNull();
    }
  });

  it('checks the empty interior of the house area, not only its pasted block cells', () => {
    const { world, placement } = setup();
    world.set(6, PLOT_Y + 1, 7, B.ARCH_BLOCK, 0);
    expect(placement.validate(small, origin, 0)).toContain('overlaps');
  });

  it('protects the existing house floor even when it would be overwritten at ground level', () => {
    const { world, placement } = setup();
    world.set(6, PLOT_Y, 7, B.ARCH_BLOCK, 0);
    expect(placement.validate(small, origin, 0)).toContain('overlaps');
  });

  it('blocks a new house above an existing house when aiming at its roof', () => {
    const { world, placement } = setup();
    world.set(6, PLOT_Y + 5, 7, B.ARCH_BLOCK, 0);
    expect(placement.validate(small, { ...origin, y: PLOT_Y + 6 }, 0)).toContain('overlaps');
  });

  it('also protects manually built stone walls', () => {
    const { world, placement } = setup();
    world.set(6, PLOT_Y + 1, 7, B.STONE);
    expect(placement.validate(small, origin, 0)).toContain('overlaps');
  });

  it('rejects partial overlap and handles the width/depth swap after rotation', () => {
    const { world, placement } = setup();
    world.set(9, PLOT_Y + 1, 5, B.ARCH_BLOCK, 0);
    expect(placement.validate(small, origin, 0)).toBeNull();
    expect(placement.validate(small, origin, 1)).toContain('overlaps');
    expect(placement.validate(small, { ...origin, x: 6 }, 0)).toContain('overlaps');
  });

  it('allows neighboring houses whose areas touch without intersecting', () => {
    const { world, placement } = setup();
    world.set(8, PLOT_Y, 5, B.ARCH_BLOCK, 0);
    expect(placement.validate(small, origin, 0)).toBeNull();
  });

  it('includes roof blocks extending beyond a blueprint’s declared footprint', () => {
    const { world, placement } = setup();
    const clip: PlacementClip = { ...small, blocks: [...small.blocks, [5, 4, 1, B.ARCH_SLOPE, 0]] };
    world.set(9, PLOT_Y + 1, 5, B.ARCH_BLOCK, 0);
    expect(placement.validate(clip, origin, 0)).toContain('overlaps');
  });

  it('includes furniture extending past the footprint and its rotated bounds', () => {
    const { world, placement } = setup();
    const clip: PlacementClip = { ...small, objects: [{ itemId: 'sofa_3', x: 4, y: 1, z: 2, rotation: Math.PI / 2, variantId: 'gray' }] };
    world.set(8, PLOT_Y + 1, 5, B.ARCH_BLOCK, 0);
    expect(placement.validate(clip, origin, 0)).toContain('overlaps');
  });

  it('does not erase existing furniture or non-solid decoration to make a house fit', () => {
    const { placement, objects } = setup();
    objects.add({ itemId: 'rug_medium', x: 6, y: PLOT_Y + 1, z: 7, rotation: 0, variantId: 'natural' });
    expect(placement.validate(small, origin, 0)).toContain('object');
    expect(objects.objects.size).toBe(1);
  });

  it('checks the whole footprint is loaded instead of treating unloaded house blocks as air', () => {
    const { world, placement } = setup();
    world.removeChunk(1, 0);
    expect(placement.validate(small, { ...origin, x: 14 }, 0)).toContain('loading');
    world.addChunk(new Chunk(generatePlotChunk(1, 0, world.plotSampler!)));
    expect(placement.validate(small, { ...origin, x: 14 }, 0)).toBeNull();
  });

  it.each([{ x: 128, y: 40, z: 0 }, { x: 0, y: 120, z: 0 }, { x: NaN, y: 40, z: 0 }])('rejects an invalid/out-of-lot pose %j', (point) => {
    const { placement } = setup();
    expect(placement.validate(small, point, 0)).not.toBeNull();
  });

  it('reuses preview results until blocks, objects or loaded chunks change', () => {
    const { world, placement, objects } = setup();
    expect(placement.validate(small, origin, 0)).toBeNull();
    const get = vi.spyOn(world, 'get');
    expect(placement.validate(small, origin, 0)).toBeNull();
    expect(get).not.toHaveBeenCalled();
    world.applyRemote(6, PLOT_Y, 7, B.ARCH_BLOCK, 0);
    expect(placement.validate(small, origin, 0)).toContain('overlaps');
    world.set(6, PLOT_Y, 7, B.GRASS);
    expect(placement.validate(small, origin, 0)).toBeNull();
    const object = objects.add({ itemId: 'rug_medium', x: 6, y: PLOT_Y + 1, z: 7, rotation: 0, variantId: 'natural' })!;
    expect(placement.validate(small, origin, 0)).toContain('object');
    objects.patch(object.id, { x: 30 });
    expect(placement.validate(small, origin, 0)).toBeNull();
    objects.remove(object.id);
    world.removeChunk(0, 0);
    expect(placement.validate(small, origin, 0)).toContain('loading');
  });
});

describe('house placement commit and preview', () => {
  it('shows a red ghost and overlap reason, and clicking cannot place a blocked house', () => {
    const { world, build, internal, ghost, tint, input, history, flash } = harness();
    world.set(6, PLOT_Y + 1, 7, B.ARCH_BLOCK, 0);
    Object.assign(build, { paste: small, target: {} });
    input.mouseLeftPressed = true;
    internal.updatePaste(1 / 60);
    expect(ghost.visible).toBe(true);
    expect(tint).toHaveBeenCalledWith(ghost, false);
    expect(useBuildStore.getState().measure).toContain('overlaps');
    expect(flash).toHaveBeenCalledWith(expect.stringContaining('overlaps'));
    expect(history.size).toBe(0);
  });

  it('rechecks a destination changed by a friend after a valid preview', () => {
    const { world, placement, internal, objects, history, audio } = harness();
    expect(placement.validate(small, origin, 0)).toBeNull();
    world.applyRemote(6, PLOT_Y + 1, 7, B.ARCH_BLOCK, 3);
    const nextId = objects.nextId;
    internal.commitPaste(small, origin);
    expect(world.getMeta(6, PLOT_Y + 1, 7)).toBe(3);
    expect(world.get(4, PLOT_Y, 4)).toBe(B.GRASS);
    expect(objects.nextId).toBe(nextId);
    expect(history.size).toBe(0);
    expect(audio.play).toHaveBeenCalledWith('error');
  });

  it('places a house as one undo step, rejects overlapping houses, and frees the area after undo', () => {
    const { world, objects, internal, history, placement } = harness();
    const house = presetBlueprint('starter_cabin')!;
    internal.commitPaste(house, origin);
    expect(history.size).toBe(1);
    expect(objects.objects.size).toBe(house.objects.length);
    const saved = objects.serialize();
    const nextId = objects.nextId;
    const mods = new Map([...world.mods].map(([key, cells]) => [key, new Map(cells)]));
    internal.commitPaste(house, { ...origin, x: origin.x + 3 });
    expect(history.size).toBe(1);
    expect(objects.serialize()).toEqual(saved);
    expect(objects.nextId).toBe(nextId);
    expect(world.mods).toEqual(mods);
    history.undo();
    expect(objects.objects.size).toBe(0);
    expect(placement.validate(house, origin, 0)).toBeNull();
    history.redo();
    expect(placement.validate(house, origin, 0)).toContain('overlaps');
  });

  it('protects houses restored from saved block modifications and object data', () => {
    const { world, objects, internal } = harness();
    const house = presetBlueprint('starter_cabin')!;
    internal.commitPaste(house, origin);
    const restored = new World(world.seed, 'meadow');
    for (const [key, cells] of world.mods) restored.loadMods(key, [...cells]);
    const loaded = setup('meadow', restored);
    loaded.objects.load(objects.serialize(), objects.nextId);
    expect(loaded.placement.validate(house, origin, 0)).toContain('overlaps');
  });

  it('allows a second house in a clear nearby area without changing the first house', () => {
    const { internal, objects, history, placement } = harness();
    const house = presetBlueprint('starter_cabin')!;
    internal.commitPaste(house, origin);
    const first = objects.serialize();
    const neighbor = { ...origin, x: 30 };
    expect(placement.validate(house, neighbor, 0)).toBeNull();
    internal.commitPaste(house, neighbor);
    expect(history.size).toBe(2);
    expect(objects.objects.size).toBe(house.objects.length * 2);
    for (const object of first) expect(objects.serialize().find((o) => o.id === object.id)).toEqual(object);
    history.undo();
    expect(objects.serialize()).toEqual(first);
    expect(placement.validate(house, neighbor, 0)).toBeNull();
    expect(placement.validate(house, origin, 0)).toContain('overlaps');
  });
});
