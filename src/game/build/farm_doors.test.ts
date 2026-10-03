import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BLOCK_DEFS } from '../../data/blocks';
import { BUILD_CATALOG, LIVE_CROP_BIT } from '../../data/buildCatalog';
import { itemDef } from '../../data/items';
import { RECIPES } from '../../data/recipes';
import { B, blockId } from '../world/BlockRegistry';
import { Chunk } from '../world/Chunk';
import { World } from '../world/World';
import { generatePlotChunk, PLOT_Y } from '../world/PlotGenerator';
import { createWorldUniforms } from '../rendering/TerrainMaterials';
import { BuildObjects } from './BuildObjects';
import { buildFarmPlot, Edits, type BlockReader } from './BuildTools';
import { objectMaterials } from './ObjectGeometry';
import { presetBlueprint } from './Presets';

class Ground implements BlockReader {
  get(_x: number, y: number) {
    return y <= 10 ? B.GRASS : 0;
  }
  getMeta() {
    return 0;
  }
}

/** World-space translation of every instance of every mesh (optionally only animated door leaves). */
function instancePositions(objs: BuildObjects): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const m = new THREE.Matrix4();
  objs.group.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    if (!im.isInstancedMesh) return;
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m);
      out.push(new THREE.Vector3().setFromMatrixPosition(m));
    }
  });
  return out;
}

describe('Build Home doors', () => {
  const world = new World(7, 'meadow');
  world.addChunk(new Chunk(generatePlotChunk(0, 0, world.plotSampler!)));

  it('renders every part of a swinging door (incl. the leaf) where the door stands — closed and open', () => {
    const objs = new BuildObjects(world, objectMaterials(createWorldUniforms()));
    const door = objs.add({ itemId: 'door_modern', x: 10.5, y: PLOT_Y + 1, z: 2.5, rotation: Math.PI / 2, variantId: 'charcoal' })!;
    const near = () => instancePositions(objs).every((p) => Math.hypot(p.x - 10.5, p.z - 2.5) < 1.2 && Math.abs(p.y - (PLOT_Y + 1)) < 0.5);
    // regression: the leaf used to be placed at the world origin (a shared scratch matrix was overwritten)
    expect(near()).toBe(true);
    objs.patch(door.id, { state: { open: true } });
    for (let i = 0; i < 30; i++) objs.tick(0.05, 0, 0);
    expect(objs.get(door.id)!.openAmt).toBe(1);
    expect(near()).toBe(true);
  });

  it('garden gates animate in place too', () => {
    const objs = new BuildObjects(world, objectMaterials(createWorldUniforms()));
    const gate = objs.add({ itemId: 'garden_gate', x: 20.5, y: PLOT_Y + 1, z: 20.5, rotation: 0, variantId: 'oak' })!;
    objs.patch(gate.id, { state: { open: true } });
    for (let i = 0; i < 30; i++) objs.tick(0.05, 0, 0);
    expect(instancePositions(objs).every((p) => Math.hypot(p.x - 20.5, p.z - 20.5) < 1.2)).toBe(true);
  });
});

describe('Build Home farming', () => {
  it('farm plot tills, plants rows, adds water channels and a fence with a gate gap', () => {
    const ed = new Edits(new Ground());
    const planted = buildFarmPlot(ed, { x: 0, y: 10, z: 0 }, { x: 9, y: 10, z: 7 }, { crop: 'crop_corn', stage: 'grow', irrigation: true, fence: true }, LIVE_CROP_BIT);
    expect(planted.length).toBeGreaterThan(50);
    // live crops carry the live bit and start as seedlings
    expect(ed.get(planted[0].x, planted[0].y, planted[0].z)).toEqual([blockId('crop_corn'), LIVE_CROP_BIT]);
    // channel rows are water, crop rows sit on watered soil
    expect(ed.get(0, 10, 2)[0]).toBe(B.WATER);
    expect(ed.get(0, 10, 0)[0]).toBe(blockId('tilled_moist'));
    // fence ring outside the field, with a 2-wide gap in the middle of the near side
    expect(ed.get(-1, 11, 3)[0]).toBe(blockId('fence'));
    expect(ed.get(4, 11, 8)[0]).toBe(0);
    expect(ed.get(0, 11, 8)[0]).toBe(blockId('fence'));
  });

  it('fixed-stage fields are ripe and dry fields use tilled soil', () => {
    const ed = new Edits(new Ground());
    const planted = buildFarmPlot(ed, { x: 0, y: 10, z: 0 }, { x: 3, y: 10, z: 3 }, { crop: 'mixed', stage: 3, irrigation: false, fence: false });
    expect(planted.length).toBe(16);
    for (const p of planted) {
      const [id, meta] = ed.get(p.x, p.y, p.z);
      expect(BLOCK_DEFS[id].growth).toBeDefined();
      expect((meta >> 3) & 7).toBe(3);
    }
    expect(ed.get(1, 10, 1)[0]).toBe(blockId('tilled'));
  });

  it('has a Farming catalog with every crop, a farm tool and the farmstead template', () => {
    const farm = BUILD_CATALOG.filter((i) => i.category === 'Farming');
    for (const k of ['crop_wheat', 'crop_corn', 'crop_tomato', 'crop_root', 'crop_gourd', 'crop_mint']) expect(farm.some((i) => i.block === k)).toBe(true);
    expect(farm.some((i) => i.tool === 'farm')).toBe(true);
    expect(farm.some((i) => i.object === 'scarecrow')).toBe(true);
    const bp = presetBlueprint('farmstead')!;
    expect(bp.blocks.some((b) => b[3] === blockId('hay_bale'))).toBe(true);
    expect(bp.blocks.filter((b) => BLOCK_DEFS[b[3]].growth && b[4] & LIVE_CROP_BIT).length).toBeGreaterThan(30);
    expect(bp.objects.some((o) => o.itemId === 'barn_door')).toBe(true);
  });
});

describe('Survival additions', () => {
  it('swords sweep and scale by tier; boats are craftable', () => {
    const swords = ['wood_sword', 'stone_sword', 'copper_sword', 'tempered_blade', 'crystal_blade'].map(itemDef);
    for (const s of swords) expect(s.tool?.sweep).toBe(true);
    for (let i = 1; i < swords.length; i++) expect(swords[i].tool!.damage).toBeGreaterThan(swords[i - 1].tool!.damage);
    for (const k of ['wood_sword', 'stone_sword', 'copper_sword', 'boat', 'hay_bale', 'roasted_skycorn']) expect(RECIPES.some((r) => r.output.item === k)).toBe(true);
  });
});
