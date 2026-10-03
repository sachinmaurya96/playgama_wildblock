import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { archIndex, archMeta } from '../../data/architecture';
import { objectDef } from '../../data/furniture';
import { BUILD_CATALOG, catalogItem, matchesTheme } from '../../data/buildCatalog';
import { B } from '../world/BlockRegistry';
import { Chunk } from '../world/Chunk';
import { World } from '../world/World';
import { generatePlotChunk, LOT_HALF, PLOT_Y, PlotSampler } from '../world/PlotGenerator';
import { BuildHistory, BlockChangeCommand, ObjectChangeCommand, type BlockChange, type EditTarget } from './BuildHistory';
import {
  buildPool, buildRoof, buildRoom, buildStaircase, buildWall, captureRegion, cutOpening, Edits, openingCells, pasteBlocks,
  rotateMeta, terrainFlatten, terrainLower, terrainRaise, brushCells, type BlockReader,
} from './BuildTools';
import { BuildObjects } from './BuildObjects';
import { boxCollides } from '../player/VoxelPhysics';
import { objectMaterials } from './ObjectGeometry';
import { createWorldUniforms } from '../rendering/TerrainMaterials';
import { presetBlueprint, PRESET_IDS } from './Presets';
import type { BuildObjectSave } from '../../persistence/types';
import { localBounds } from './BuildObjects';
import { PlotBackdrop } from '../rendering/PlotBackdrop';
import { CHALLENGES } from '../../data/buildChallenges';

class Grid implements BlockReader {
  cells = new Map<string, [number, number]>();
  ground = -1;
  get(x: number, y: number, z: number) {
    const c = this.cells.get(`${x},${y},${z}`);
    if (c) return c[0];
    return y <= this.ground ? B.GRASS : 0;
  }
  getMeta(x: number, y: number, z: number) {
    return this.cells.get(`${x},${y},${z}`)?.[1] ?? 0;
  }
  apply(changes: BlockChange[], dir: 'to' | 'from' = 'to') {
    for (const c of changes) this.cells.set(`${c.x},${c.y},${c.z}`, dir === 'to' ? c.to : c.from);
  }
}

const WHITE = archIndex('plaster_white');

describe('Build Home construction tools', () => {
  it('Edits keeps the first "from", the last "to" and drops no-ops', () => {
    const g = new Grid();
    const ed = new Edits(g);
    ed.set(0, 5, 0, B.ARCH_BLOCK, 1);
    ed.set(0, 5, 0, B.ARCH_BLOCK, 2);
    ed.set(1, 5, 0, B.ARCH_BLOCK, 3);
    ed.set(1, 5, 0, 0, 0); // back to air → no-op
    const list = ed.list();
    expect(list.length).toBe(1);
    expect(list[0].from).toEqual([0, 0]);
    expect(list[0].to).toEqual([B.ARCH_BLOCK, 2]);
  });

  it('wall tool raises a full-height line between two points', () => {
    const g = new Grid();
    const ed = new Edits(g);
    buildWall(ed, { x: 0, y: 10, z: 0 }, { x: 7, y: 10, z: 0 }, 3, WHITE);
    expect(ed.list().length).toBe(8 * 3);
    expect(ed.get(7, 13, 0)).toEqual([B.ARCH_BLOCK, archMeta.cube(WHITE)]);
    expect(ed.get(0, 14, 0)[0]).toBe(0);
  });

  it('room tool builds floor + 4 walls (+ optional ceiling), no doors', () => {
    const g = new Grid();
    const ed = new Edits(g);
    buildRoom(ed, { x: 0, y: 10, z: 0 }, { x: 5, y: 10, z: 4 }, { wallHeight: 3, wallMat: WHITE, floorMat: archIndex('floor_oak'), ceiling: true, ceilingMat: WHITE });
    const floor = 6 * 5, perimeter = 2 * 6 + 2 * 3;
    expect(ed.list().length).toBe(floor + perimeter * 3 + floor);
    expect(ed.get(2, 11, 2)[0]).toBe(0); // interior stays open
    expect(ed.get(0, 12, 2)[0]).toBe(B.ARCH_BLOCK);
  });

  it('gable roof uses slopes that rise toward the ridge + fills gable ends', () => {
    const g = new Grid();
    const ed = new Edits(g);
    buildRoof(ed, { x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 4 }, 14, { type: 'gable', mat: archIndex('shingles_dark'), gableMat: WHITE, overhang: 0 });
    // 5 rows across z: 0,1 rise +Z (rot 0), 2 is the ridge slab, 3,4 rise −Z (rot 2)
    expect(ed.get(3, 14, 0)).toEqual([B.ARCH_SLOPE, archMeta.rotated(archIndex('shingles_dark'), 0)]);
    expect(ed.get(3, 15, 1)[0]).toBe(B.ARCH_SLOPE);
    expect(ed.get(3, 16, 2)[0]).toBe(B.ARCH_SLAB);
    expect(ed.get(3, 14, 4)).toEqual([B.ARCH_SLOPE, archMeta.rotated(archIndex('shingles_dark'), 2)]);
    expect(ed.get(0, 14, 2)[0]).toBe(B.ARCH_BLOCK); // gable end wall
  });

  it('hip roof uses four outer-corner pieces per ring', () => {
    const g = new Grid();
    const ed = new Edits(g);
    buildRoof(ed, { x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 6 }, 10, { type: 'hip', mat: archIndex('roof_terracotta'), gableMat: WHITE, overhang: 0 });
    const corners = ed.list().filter((c) => c.to[0] === B.ARCH_SLOPE_OUTER);
    expect(corners.length).toBe(4 * 3);
    expect(ed.get(3, 13, 3)[0]).toBe(B.ARCH_SLAB); // apex
  });

  it('pool tool excavates, tiles, adds coping and fills with water', () => {
    const g = new Grid();
    g.ground = 40;
    const ed = new Edits(g);
    buildPool(ed, { x: 0, y: 40, z: 0 }, { x: 5, y: 40, z: 2 }, { depth: 2, tile: archIndex('pool_tile'), coping: archIndex('stone_cut'), steps: false });
    const water = ed.list().filter((c) => c.to[0] === B.WATER).length;
    expect(water).toBe(6 * 3 * 2);
    expect(ed.get(-1, 40, 0)).toEqual([B.ARCH_BLOCK, archIndex('stone_cut')]);
    expect(ed.get(2, 38, 1)).toEqual([B.ARCH_BLOCK, archIndex('pool_tile')]);
  });

  it('staircase rises one block per step and cuts headroom through ceilings', () => {
    const g = new Grid();
    for (let x = -2; x < 8; x++) for (let z = -2; z < 4; z++) g.cells.set(`${x},14,${z}`, [B.ARCH_BLOCK, WHITE]);
    const ed = new Edits(g);
    const n = buildStaircase(ed, { x: 0, y: 11, z: 0 }, { x: 5, y: 15, z: 0 }, 2, archIndex('floor_oak'), false);
    expect(n).toBe(4);
    expect(ed.get(3, 14, 0)[0]).toBe(B.ARCH_STAIRS);
    expect(ed.get(2, 14, 0)[0]).toBe(0); // stairwell opening in the upper floor
    expect(ed.get(0, 11, 1)[0]).toBe(B.ARCH_STAIRS); // 2 wide
  });

  it('terrain brushes raise, lower and flatten only terrain', () => {
    const g = new Grid();
    g.ground = 40;
    const ed = new Edits(g);
    const cells = brushCells(0, 0, 3);
    expect(cells.length).toBe(9);
    terrainRaise(ed, cells, 40);
    expect(ed.get(0, 41, 0)[0]).toBe(B.GRASS);
    expect(ed.get(0, 40, 0)[0]).toBe(B.DIRT);
    const ed2 = new Edits(g);
    terrainLower(ed2, cells, 40);
    expect(ed2.get(0, 40, 0)[0]).toBe(0);
    const ed3 = new Edits(g);
    terrainFlatten(ed3, cells, 38, [B.GRASS, 0]);
    expect(ed3.get(1, 39, 1)[0]).toBe(0);
    expect(ed3.get(1, 38, 1)[0]).toBe(B.GRASS);
  });

  it('door / window openings cut exactly the wall cells they cover (undo restores them)', () => {
    const g = new Grid();
    for (let x = 0; x < 6; x++) for (let y = 11; y <= 13; y++) g.cells.set(`${x},${y},3`, [B.ARCH_BLOCK, WHITE]);
    const door = objectDef('door_modern')!;
    const cells = openingCells(door, 2.5, 11, 3.5, 0);
    expect(cells).toEqual([{ x: 2, y: 11, z: 3 }, { x: 2, y: 12, z: 3 }]);
    const win = objectDef('window_standard')!;
    expect(openingCells(win, 4.5, 11, 3.5, 0).map((c) => c.y)).toEqual([12, 13]);
    const wide = objectDef('window_double')!;
    const rc = openingCells(wide, 3.5, 3, 1, Math.PI / 2).map((c) => `${c.x},${c.y},${c.z}`).sort();
    expect(rc).toEqual(['3,4,0', '3,4,1', '3,5,0', '3,5,1']);
    const ed = new Edits(g);
    expect(cutOpening(ed, door, 2.5, 11, 3.5, 0)).toBe(2);
    const changes = ed.list();
    g.apply(changes);
    expect(g.get(2, 11, 3)).toBe(0);
    g.apply(changes, 'from');
    expect(g.get(2, 12, 3)).toBe(B.ARCH_BLOCK);
  });

  it('copy / paste with rotation is consistent (4 quarter turns = identity)', () => {
    const g = new Grid();
    g.cells.set('0,1,0', [B.ARCH_STAIRS, archMeta.rotated(WHITE, 0)]);
    g.cells.set('2,1,0', [B.ARCH_BLOCK, WHITE]);
    g.cells.set('2,2,1', [B.ARCH_BEAM, archMeta.rotated(WHITE, 0)]);
    const cap = captureRegion(g, { x: 0, y: 1, z: 0 }, { x: 2, y: 2, z: 1 });
    expect(cap.size).toEqual([3, 2, 2]);
    let meta = archMeta.rotated(WHITE, 0);
    for (let i = 0; i < 4; i++) meta = rotateMeta(B.ARCH_STAIRS, meta, 1);
    expect(meta).toBe(archMeta.rotated(WHITE, 0));
    expect(rotateMeta(B.ARCH_BEAM, archMeta.rotated(WHITE, 0), 1) & 1).toBe(1);
    const out = new Grid();
    const ed = new Edits(out);
    pasteBlocks(ed, cap, { x: 10, y: 1, z: 10 }, 1);
    // 90°: (x, z) → (depth-1-z, x); the stair turned by one step
    expect(ed.get(11, 1, 10)).toEqual([B.ARCH_STAIRS, archMeta.rotated(WHITE, 1)]);
    expect(ed.get(11, 1, 12)[0]).toBe(B.ARCH_BLOCK);
  });
});

describe('Build Home undo / redo', () => {
  function target() {
    const g = new Grid();
    const objs = new Map<number, BuildObjectSave>();
    const t: EditTarget = {
      applyBlocks: (c, d) => g.apply(c, d),
      addObject: (o) => objs.set(o.id, o),
      removeObject: (id) => objs.delete(id),
      updateObject: (o) => objs.set(o.id, o),
    };
    return { g, objs, t };
  }

  it('undoes and redoes block and object commands in order', () => {
    const { g, objs, t } = target();
    const h = new BuildHistory();
    const ed = new Edits(g);
    buildWall(ed, { x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, 2, WHITE);
    h.run(new BlockChangeCommand(t, ed.list(), 'Wall'));
    const o: BuildObjectSave = { id: 1, itemId: 'sofa_2', x: 1, y: 1, z: 2, rotation: 0, variantId: 'gray' };
    h.run(new ObjectChangeCommand(t, [{ before: null, after: o }], 'Place'));
    h.run(new ObjectChangeCommand(t, [{ before: o, after: { ...o, rotation: Math.PI / 2 } }], 'Rotate'));
    expect(objs.get(1)!.rotation).toBeCloseTo(Math.PI / 2);
    h.undo();
    expect(objs.get(1)!.rotation).toBe(0);
    h.undo();
    expect(objs.has(1)).toBe(false);
    h.undo();
    expect(g.get(0, 1, 0)).toBe(0);
    h.redo();
    expect(g.get(0, 1, 0)).toBe(B.ARCH_BLOCK);
    expect(h.peekRedo()).toBe('Place');
  });

  it('keeps at least 100 actions and clears redo after a new action', () => {
    const { t } = target();
    const h = new BuildHistory();
    for (let i = 0; i < 180; i++) h.run(new ObjectChangeCommand(t, [{ before: null, after: { id: i + 1, itemId: 'vase', x: i, y: 1, z: 0, rotation: 0, variantId: 'cream' } }], 'Place'));
    expect(h.size).toBeGreaterThanOrEqual(100);
    h.undo();
    expect(h.canRedo).toBe(true);
    h.run(new ObjectChangeCommand(t, [{ before: null, after: { id: 999, itemId: 'vase', x: 0, y: 1, z: 0, rotation: 0, variantId: 'cream' } }], 'Place'));
    expect(h.canRedo).toBe(false);
  });
});

describe('Build Home objects', () => {
  const world = new World(7, 'meadow');
  world.addChunk(new Chunk(generatePlotChunk(0, 0, world.plotSampler!)));
  const objs = new BuildObjects(world, objectMaterials(createWorldUniforms()));

  it('places objects, collides with the player box and serialises plain data', () => {
    const sofa = objs.add({ itemId: 'sofa_3', x: 5, y: PLOT_Y + 1, z: 5, rotation: 0, variantId: 'sage' })!;
    expect(sofa.def.id).toBe('sofa_3');
    expect(boxCollides(world, 4.5, PLOT_Y + 1.05, 4.5, 5.5, PLOT_Y + 2, 5.5)).toBe(true);
    expect(boxCollides(world, 4.5, PLOT_Y + 1.05, 8.5, 5.5, PLOT_Y + 2, 9.5)).toBe(false);
    const saved = objs.serialize();
    expect(saved[0]).toEqual({ id: sofa.id, itemId: 'sofa_3', x: 5, y: PLOT_Y + 1, z: 5, rotation: 0, variantId: 'sage' });
    expect(JSON.parse(JSON.stringify(saved))).toEqual(saved);
  });

  it('doors block the doorway only while closed', () => {
    const door = objs.add({ itemId: 'door_modern', x: 10.5, y: PLOT_Y + 1, z: 2.5, rotation: 0, variantId: 'charcoal' })!;
    const blocked = () => boxCollides(world, 10.3, PLOT_Y + 1.1, 2.3, 10.7, PLOT_Y + 2.5, 2.7);
    expect(blocked()).toBe(true);
    objs.patch(door.id, { state: { open: true } });
    expect(blocked()).toBe(false);
  });

  it('raycasts rotated objects and reports the face normal', () => {
    objs.add({ itemId: 'fridge', x: 2.5, y: PLOT_Y + 1, z: 12.5, rotation: Math.PI / 2, variantId: 'white' });
    const hit = objs.raycast(new THREE.Vector3(8, PLOT_Y + 2, 12.5), new THREE.Vector3(-1, 0, 0), 10);
    expect(hit?.obj.itemId).toBe('fridge');
    expect(hit!.normal.x).toBeCloseTo(1);
  });

  it('instances identical models into shared buckets (one draw call per model/variant/part)', () => {
    const before = objs.stats().buckets;
    for (let i = 0; i < 20; i++) objs.add({ itemId: 'dining_chair', x: 20 + i, y: PLOT_Y + 1, z: 20, rotation: 0, variantId: 'oak' });
    expect(objs.stats().buckets - before).toBe(1);
    expect(objs.stats().objects).toBeGreaterThanOrEqual(23);
  });
});

describe('Build Home plots, catalog and presets', () => {
  it('generates a flat 256×256 lot with a paved border for every plot type', () => {
    for (const plot of ['meadow', 'coastal', 'forest', 'mountain', 'lakeside', 'desert', 'studio'] as const) {
      const s = new PlotSampler(99, plot);
      for (const [x, z] of [[0, 0], [-LOT_HALF, -LOT_HALF], [LOT_HALF - 1, 40], [17, -LOT_HALF]]) {
        expect(s.column(x, z).height).toBe(PLOT_Y);
        expect(s.column(x, z).zone).toBe(0);
      }
      const c = generatePlotChunk(0, 0, s);
      expect(c.heightmap.every((h) => h >= PLOT_Y)).toBe(true);
    }
    expect(new PlotSampler(1, 'meadow').column(LOT_HALF + 1, 0).zone).toBe(1);
  });

  it('has every required catalog category, searchable items and theme suggestions', () => {
    const cats = new Set(BUILD_CATALOG.map((i) => i.category));
    for (const c of ['Structure', 'Doors & Windows', 'Kitchen', 'Living Room', 'Bedroom', 'Bathroom', 'Office', 'Outdoor', 'Landscaping', 'Lighting', 'Decoration', 'Utility', 'Modern Architecture']) {
      expect(cats.has(c as never)).toBe(true);
    }
    for (const q of ['sofa', 'window', 'white wall', 'lamp', 'sink', 'pool']) {
      expect(BUILD_CATALOG.some((i) => `${i.name} ${i.tags.join(' ')} ${i.sub}`.toLowerCase().includes(q.split(' ').pop()!))).toBe(true);
    }
    expect(catalogItem('wall')!.variants.length).toBeGreaterThan(10);
    expect(BUILD_CATALOG.some((i) => matchesTheme(i, 'scandinavian'))).toBe(true);
  });

  it('builds every house preset with the required rooms and furniture', () => {
    for (const id of PRESET_IDS) {
      const bp = presetBlueprint(id)!;
      expect(bp.blocks.length).toBeGreaterThan(100);
      for (const o of bp.objects) {
        expect(objectDef(o.itemId)).toBeDefined();
        expect(o.x).toBeGreaterThanOrEqual(-0.5);
        expect(o.z).toBeGreaterThanOrEqual(-0.5);
      }
    }
    const two = presetBlueprint('two_story')!;
    const items = two.objects.map((o) => o.itemId);
    for (const k of ['bed_queen', 'bed_single', 'toilet', 'shower', 'bathtub_builtin', 'sofa_3', 'fridge', 'stove', 'kitchen_sink', 'office_desk', 'wardrobe_double', 'door_entrance', 'table_dining_4']) {
      expect(items).toContain(k);
    }
    expect(items.filter((i) => i === 'toilet').length).toBe(2);
    expect(two.size[1]).toBeGreaterThan(9); // two floors + roof
    expect(two.blocks.some((b) => b[3] === B.ARCH_STAIRS)).toBe(true);
  });

  it('window bounds start at the sill so the wall below never blocks placement', () => {
    for (const id of ['window_small', 'window_standard', 'window_wide', 'window_horizontal']) {
      const def = objectDef(id)!;
      const [a, b] = localBounds(def);
      expect(a[1]).toBeGreaterThan((def.opening!.y0 ?? 0) - 0.05);
      expect(b[1]).toBeCloseTo((def.opening!.y0 ?? 0) + def.opening!.h, 5);
    }
    const tall = localBounds(objectDef('window_tall')!);
    expect(tall[0][1]).toBe(0);
  });

  it('builds a distant scenery backdrop for every plot except the white studio', () => {
    const u = createWorldUniforms();
    for (const plot of ['meadow', 'coastal', 'forest', 'mountain', 'lakeside', 'desert'] as const) {
      const b = new PlotBackdrop(plot, 1234, PLOT_Y, u);
      expect(b.mesh).not.toBeNull();
      const pos = b.mesh!.geometry.getAttribute('position');
      expect(pos.count).toBeGreaterThan(1000);
      let maxY = 0;
      for (let i = 0; i < pos.count; i++) maxY = Math.max(maxY, pos.getY(i));
      expect(maxY).toBeGreaterThan(5);
      b.dispose();
    }
    const mtn = new PlotBackdrop('mountain', 99, PLOT_Y, u);
    const p = mtn.mesh!.geometry.getAttribute('position');
    // the mountain plot's ridge is tallest toward the north (-Z)
    let north = 0, south = 0;
    for (let i = 0; i < p.count; i++) {
      if (p.getZ(i) < -300) north = Math.max(north, p.getY(i));
      if (p.getZ(i) > 300) south = Math.max(south, p.getY(i));
    }
    expect(north).toBeGreaterThan(south + 20);
    expect(new PlotBackdrop('studio', 1, PLOT_Y, u).mesh).toBeNull();
  });

  it('has design challenges with measurable goals', () => {
    expect(CHALLENGES.length).toBeGreaterThanOrEqual(4);
    for (const c of CHALLENGES) {
      expect(c.goals.length).toBeGreaterThan(2);
      for (const g of c.goals) {
        expect(g.count).toBeGreaterThan(0);
        for (const id of g.items ?? []) expect(objectDef(id)).toBeDefined();
      }
    }
  });
});
