import { archIndex as A, archMeta } from '../../data/architecture';
import { objectDef } from '../../data/furniture';
import type { BuildObjectSave } from '../../persistence/types';
import { B, blockId } from '../world/BlockRegistry';
import {
  buildFarmPlot, buildRoof, buildRoom, buildStaircase, buildWall, cutOpening, Edits, fillFloor, type BlockReader, type FarmOptions, type RoofOptions,
} from './BuildTools';

/**
 * Optional house templates. Each is built with the SAME tool functions the
 * player uses (room, wall, roof, staircase, openings), then captured as a
 * blueprint: blocks relative to the min corner + objects. Placing one shows a
 * ghost, can be rotated, and is fully editable afterwards.
 *
 * Plan coordinates: y = 0 is the ground/floor layer (replaces the lot surface),
 * walls stand on y = 1.., objects stand at y = 1 (on top of the floor).
 */
export interface PresetBlueprint {
  id: string;
  name: string;
  size: [number, number, number];
  blocks: [number, number, number, number, number][];
  objects: Omit<BuildObjectSave, 'id'>[];
}

class VirtualWorld implements BlockReader {
  cells = new Map<string, [number, number]>();
  get(x: number, y: number, z: number) {
    return this.cells.get(`${x},${y},${z}`)?.[0] ?? 0;
  }
  getMeta(x: number, y: number, z: number) {
    return this.cells.get(`${x},${y},${z}`)?.[1] ?? 0;
  }
}

const Y0 = 0, Y1 = 1;
const R0 = 0, R90 = Math.PI / 2, R180 = Math.PI, R270 = -Math.PI / 2;

/** Plans are authored with y = 0 as ground; Edits ignores y < 1, so everything is shifted up by OFF internally. */
const OFF = 1;

class Plan {
  vw = new VirtualWorld();
  ed = new Edits(this.vw);
  objects: Omit<BuildObjectSave, 'id'>[] = [];

  room(x0: number, z0: number, x1: number, z1: number, wall: string, floor: string, h = 3, y = Y0, ceiling?: string) {
    buildRoom(this.ed, { x: x0, y: y + OFF, z: z0 }, { x: x1, y: y + OFF, z: z1 }, { wallHeight: h, wallMat: A(wall), floorMat: A(floor), ceiling: !!ceiling, ceilingMat: A(ceiling ?? wall) });
  }
  wall(x0: number, z0: number, x1: number, z1: number, mat: string, h = 3, y = Y0) {
    buildWall(this.ed, { x: x0, y: y + OFF, z: z0 }, { x: x1, y: y + OFF, z: z1 }, h, A(mat));
  }
  floor(x0: number, z0: number, x1: number, z1: number, mat: string, y = Y0) {
    fillFloor(this.ed, { x: x0, y: y + OFF, z: z0 }, { x: x1, y: y + OFF, z: z1 }, A(mat));
  }
  block(x: number, y: number, z: number, id: number, meta: number) {
    this.ed.set(x, y + OFF, z, id, meta);
  }
  obj(itemId: string, x: number, y: number, z: number, rotation = R0, variantId = '', state?: BuildObjectSave['state']) {
    const def = objectDef(itemId);
    if (!def) throw new Error(`preset: unknown object ${itemId}`);
    this.objects.push({ itemId, x, y, z, rotation, variantId: variantId || def.variants?.[0]?.id || 'default', state });
  }
  /** Door / window in a wall: `along` = axis of the wall line; start = first cell; front faces `out`. */
  opening(itemId: string, along: 'x' | 'z', start: number, line: number, y: number, out: 1 | -1, variant = '') {
    const def = objectDef(itemId)!;
    const w = def.opening!.w;
    const x = along === 'x' ? start + w / 2 : line + 0.5;
    const z = along === 'x' ? line + 0.5 : start + w / 2;
    const rot = along === 'x' ? (out > 0 ? R0 : R180) : (out > 0 ? R90 : R270);
    cutOpening(this.ed, def, x, y + OFF, z, rot);
    this.obj(itemId, x, y, z, rot, variant);
  }
  roof(x0: number, z0: number, x1: number, z1: number, baseY: number, o: Omit<RoofOptions, 'mat' | 'gableMat'> & { mat: string; gable: string }) {
    buildRoof(this.ed, { x: x0, y: OFF, z: z0 }, { x: x1, y: OFF, z: z1 }, baseY + OFF, { ...o, mat: A(o.mat), gableMat: A(o.gable) });
  }
  stairs(x: number, y: number, z: number, toZ: number, rise: number, width: number, mat: string, floating = false) {
    buildStaircase(this.ed, { x, y: y + OFF, z }, { x, y: y + OFF + rise, z: toZ }, width, A(mat), floating);
  }
  finish(id: string, name: string): PresetBlueprint {
    const changes = this.ed.list().filter((c) => c.to[0] !== 0);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = 0, z1 = -Infinity;
    for (const c of changes) {
      x0 = Math.min(x0, c.x); z0 = Math.min(z0, c.z); x1 = Math.max(x1, c.x); z1 = Math.max(z1, c.z); y1 = Math.max(y1, c.y - OFF);
    }
    return {
      id, name,
      size: [x1 - x0 + 1, y1 + 1, z1 - z0 + 1],
      blocks: changes.map((c) => [c.x - x0, c.y - OFF, c.z - z0, c.to[0], c.to[1]]),
      objects: this.objects.map((o) => ({ ...o, x: o.x - x0, z: o.z - z0 })),
    };
  }
}

// ---------------------------------------------------------------- 1. Starter Modern Cabin

function starterCabin(): PresetBlueprint {
  const p = new Plan();
  p.floor(-1, 7, 9, 9, 'decking');
  p.room(0, 0, 8, 6, 'wood_cladding_dark', 'floor_oak');
  p.opening('window_tall_wide', 'x', 1, 6, Y1, 1);
  p.opening('door_modern', 'x', 4, 6, Y1, 1, 'walnut');
  p.opening('window_tall_wide', 'x', 6, 6, Y1, 1);
  p.opening('window_horizontal', 'x', 2, 0, Y1, -1);
  p.opening('window_standard', 'z', 3, 0, Y1, -1);
  p.opening('window_standard', 'z', 3, 8, Y1, 1);
  p.roof(0, 0, 8, 6, 4, { type: 'shed', mat: 'roof_metal', gable: 'wood_cladding_dark', overhang: 1 });
  // kitchen along the back wall
  p.obj('kitchen_base', 1.5, Y1, 1.31, R0, 'black_stone');
  p.obj('kitchen_sink', 2.5, Y1, 1.31, R0, 'black_stone');
  p.obj('stove', 3.5, Y1, 1.32, R0, 'dark');
  p.obj('fridge', 4.5, Y1, 1.36, R0, 'dark');
  p.obj('table_dining_2', 2.5, Y1, 4.1, R0, 'oak');
  p.obj('dining_chair', 2.5, Y1, 3.35, R0, 'black');
  p.obj('dining_chair', 2.5, Y1, 4.85, R180, 'black');
  // sleeping + lounge
  p.obj('bed_double', 6.5, Y1, 2.05, R0, 'gray');
  p.obj('nightstand', 7.7, Y1, 1.22, R0, 'walnut');
  p.obj('table_lamp', 7.7, 1.55, 1.22, R0, 'black');
  p.obj('sofa_2', 6.4, Y1, 5.35, R180, 'sage');
  p.obj('coffee_table', 6.4, Y1, 4.25, R0, 'walnut');
  p.obj('rug_medium', 6.4, Y1, 4.3, R0, 'natural');
  p.obj('floor_lamp', 7.65, Y1, 5.6, R0, 'black');
  p.obj('plant_floor', 1.45, Y1, 5.5, R0, 'basket');
  p.obj('art_abstract', 0.5 + 0.525, 1 + 1.25, 3.5, R90, 'black');
  p.obj('exterior_wall_light', 3.35, 1 + 2.0, 7.1, R0, 'black');
  p.obj('lounge_bed', 7.5, Y1, 8.1, R90, 'teak');
  p.obj('planter_box', 1.5, Y1, 8.2, R0, 'charcoal');
  return p.finish('starter_cabin', 'Starter Modern Cabin');
}

// ---------------------------------------------------------------- 2. Modern One-Story Home

function oneStory(): PresetBlueprint {
  const p = new Plan();
  // patio + garden path
  p.floor(-1, 13, 17, 16, 'pavers');
  p.floor(7, -3, 8, -1, 'pavers');
  p.room(0, 0, 16, 12, 'plaster_white', 'floor_light');
  // bedroom wing partitions
  p.wall(10, 0, 10, 12, 'plaster_warm');
  p.wall(10, 6, 16, 6, 'plaster_warm');
  p.wall(13, 6, 13, 12, 'plaster_warm');
  p.floor(14, 7, 15, 11, 'tile_white');
  p.floor(11, 1, 15, 5, 'carpet_cream');
  // openings
  p.opening('door_entrance', 'x', 7, 0, Y1, -1, 'walnut');
  p.opening('window_horizontal', 'x', 2, 0, Y1, -1);
  p.opening('window_double', 'x', 12, 0, Y1, -1);
  p.opening('window_tall', 'z', 3, 16, Y1, 1);
  p.opening('window_tall_wide', 'x', 1, 12, Y1, 1);
  p.opening('door_sliding', 'x', 4, 12, Y1, 1);
  p.opening('window_tall_wide', 'x', 7, 12, Y1, 1);
  p.opening('window_standard', 'x', 11, 12, Y1, 1);
  p.opening('window_small', 'x', 15, 12, Y1, 1);
  p.opening('window_standard', 'z', 8, 0, Y1, -1);
  p.opening('door_interior', 'z', 3, 10, Y1, 1, 'white');
  p.opening('door_interior', 'z', 8, 10, Y1, 1, 'white');
  p.opening('door_interior', 'x', 14, 6, Y1, 1, 'white');
  p.roof(0, 0, 16, 12, 4, { type: 'flat', mat: 'concrete_light', gable: 'plaster_white', overhang: 1 });
  // kitchen
  const k = 1.31;
  p.obj('fridge', 1.5, Y1, 1.36, R0, 'steel');
  p.obj('kitchen_drawers', 2.5, Y1, k, R0, 'white_stone');
  p.obj('kitchen_sink', 3.5, Y1, k, R0, 'white_stone');
  p.obj('dishwasher', 4.5, Y1, k, R0, 'steel');
  p.obj('stove', 5.5, Y1, 1.32, R0, 'steel');
  p.obj('range_hood', 5.5, 1 + 1.55, 1.25, R0, 'steel');
  p.obj('kitchen_base', 6.5, Y1, k, R0, 'white_stone');
  p.obj('kitchen_island_3', 4, Y1, 3.9, R0, 'white_stone');
  for (const x of [3, 4, 5]) p.obj('bar_stool', x, Y1, 4.95, R0, 'oak');
  for (const x of [3, 5]) p.obj('pendant_light', x, 3.1, 3.9, R0, 'brass');
  // dining
  p.obj('table_dining_6', 4.2, Y1, 7.3, R0, 'oak');
  for (const x of [3.4, 4.2, 5.0]) {
    p.obj('dining_chair_upholstered', x, Y1, 6.45, R0, 'cream');
    p.obj('dining_chair_upholstered', x, Y1, 8.15, R180, 'cream');
  }
  p.obj('chandelier', 4.2, 3.0, 7.3, R0, 'brass');
  // living
  p.obj('tv_console', 1.23, Y1, 10, R90, 'walnut');
  p.obj('tv_wall', 1.04, 1 + 1.0, 10, R90);
  p.obj('sofa_3', 5.2, Y1, 10, R270, 'gray');
  p.obj('coffee_table', 3.6, Y1, 10, R90, 'walnut');
  p.obj('rug_large', 3.8, Y1, 10, R90, 'natural');
  p.obj('armchair', 3.6, Y1, 8.6, R0, 'terracotta');
  p.obj('floor_lamp', 5.4, Y1, 11.5, R0, 'black');
  p.obj('plant_floor', 9.4, Y1, 11.4, R0, 'terracotta');
  p.obj('bookshelf', 9.8, Y1, 9.5, R270, 'walnut');
  p.obj('art_landscape', 9.475, 1 + 1.25, 3, R270, 'oak');
  for (const [x, z] of [[2, 2.5], [6, 2.5], [2, 9], [7, 9]]) p.obj('recessed_light', x, 3.98, z, R0, 'white');
  // master bedroom
  p.obj('bed_queen', 13, Y1, 2.12, R0, 'white');
  p.obj('nightstand', 11.6, Y1, 1.22, R0, 'oak');
  p.obj('nightstand', 14.4, Y1, 1.22, R0, 'oak');
  p.obj('table_lamp', 11.6, 1.55, 1.22, R0, 'ceramic');
  p.obj('table_lamp', 14.4, 1.55, 1.22, R0, 'ceramic');
  p.obj('wardrobe_sliding', 13, Y1, 5.66, R180, 'oak');
  p.obj('ceiling_light', 13, 3.9, 3, R0, 'white');
  // second bedroom
  p.obj('bed_single', 12, Y1, 10, R90, 'blue');
  p.obj('office_desk', 11.9, Y1, 7.38, R0, 'white');
  p.obj('office_chair', 11.9, Y1, 8.2, R180, 'white');
  p.obj('laptop', 11.9, 1.76, 7.3, R0);
  p.obj('ceiling_light', 11.5, 3.9, 9, R0, 'white');
  // bathroom
  p.obj('toilet', 15.5, Y1, 7.36, R0);
  p.obj('vanity', 14.5, Y1, 11.75, R180, 'wood');
  p.obj('bath_mirror', 14.5, 1 + 1.25, 11.93, R180);
  p.obj('shower', 14.5, Y1, 7.5, R0);
  p.obj('towel_rack', 15.94, 1 + 1.0, 9.5, R270, 'white');
  // patio
  p.obj('pergola', 4.5, Y1, 14.6, R0, 'black_wood');
  p.obj('outdoor_sofa', 4.5, Y1, 15.3, R180, 'sand');
  p.obj('outdoor_table', 12, Y1, 14.6, R0, 'teak');
  for (const x of [11.3, 12.7]) {
    p.obj('outdoor_chair', x, Y1, 13.8, R0);
    p.obj('outdoor_chair', x, Y1, 15.4, R180);
  }
  p.obj('bbq_grill', 16, Y1, 14.5, R270, 'black');
  p.obj('exterior_wall_light', 6.65, 1 + 2.0, -0.1, R180, 'black');
  p.obj('exterior_wall_light', 9.35, 1 + 2.0, -0.1, R180, 'black');
  for (const x of [-1, 17]) p.obj('path_light', x, Y1, 13.5, R0);
  for (const x of [1, 3, 13, 15]) p.obj('planter_box', x + 0.5, Y1, -0.8, R180, 'concrete');
  return p.finish('one_story', 'Modern One-Story Home');
}

// ---------------------------------------------------------------- 3. Two-Story Family Home

function twoStory(): PresetBlueprint {
  const p = new Plan();
  const U = 5; // upper floor objects stand on the slab at y = 4
  p.floor(-1, 13, 15, 15, 'pavers');
  // ---- ground floor: open kitchen / dining / living (west), bathroom + stair hall (east)
  p.room(0, 0, 14, 12, 'brick_white', 'floor_oak');
  p.wall(7, 0, 7, 6, 'plaster_white');
  p.wall(7, 9, 7, 12, 'plaster_white');
  p.wall(7, 4, 14, 4, 'plaster_white');
  p.floor(8, 1, 13, 3, 'tile_beige');
  // ---- upper floor slab + walls
  p.floor(0, 0, 14, 12, 'floor_walnut', 4);
  p.room(0, 0, 14, 12, 'plaster_white', 'floor_walnut', 3, 4);
  p.wall(7, 0, 7, 12, 'plaster_warm', 3, 4);
  p.wall(0, 6, 7, 6, 'plaster_warm', 3, 4);
  p.wall(7, 4, 14, 4, 'plaster_warm', 3, 4);
  p.floor(8, 1, 13, 3, 'tile_white', 4);
  p.floor(1, 1, 6, 5, 'carpet_cream', 4);
  // balcony (south, upper floor)
  p.floor(9, 13, 13, 14, 'decking', 4);
  for (let x = 9; x <= 13; x++) p.block(x, 5, 14, B.ARCH_RAILING_GLASS, archMeta.rotated(A('metal_black'), 0));
  for (const x of [9, 13]) p.block(x, 5, 13, B.ARCH_RAILING_GLASS, archMeta.rotated(A('metal_black'), 1));
  // staircase: 2 wide, rising toward +X through the hall (cuts its own stairwell)
  p.stairs(8, 1, 7, 7, 4, 2, 'floor_oak');
  for (let x = 8; x <= 11; x++) {
    p.block(x, U, 6, B.ARCH_RAILING_GLASS, archMeta.rotated(A('metal_black'), 0));
    p.block(x, U, 9, B.ARCH_RAILING_GLASS, archMeta.rotated(A('metal_black'), 0));
  }
  // ---- ground openings
  p.opening('door_entrance', 'x', 10, 12, Y1, 1, 'charcoal');
  p.opening('window_tall', 'x', 1, 12, Y1, 1);
  p.opening('window_tall', 'x', 6, 12, Y1, 1);
  p.opening('window_double', 'x', 2, 0, Y1, -1);
  p.opening('window_double', 'x', 5, 0, Y1, -1);
  p.opening('window_small', 'x', 11, 0, Y1, -1);
  p.opening('window_standard', 'z', 8, 0, Y1, -1);
  p.opening('door_interior', 'x', 12, 4, Y1, 1, 'white');
  // ---- upper openings
  p.opening('window_double', 'x', 3, 0, U, -1);
  p.opening('window_small', 'x', 11, 0, U, -1);
  p.opening('window_double', 'x', 3, 12, U, 1);
  p.opening('door_sliding', 'x', 10, 12, U, 1);
  p.opening('window_standard', 'z', 3, 0, U, -1);
  p.opening('window_standard', 'z', 9, 0, U, -1);
  p.opening('window_standard', 'z', 8, 14, U, 1);
  p.opening('door_interior', 'z', 5, 7, U, 1, 'oak');
  p.opening('door_interior', 'z', 10, 7, U, 1, 'oak');
  p.opening('door_interior', 'x', 12, 4, U, 1, 'oak');
  p.roof(0, 0, 14, 12, 8, { type: 'gable', mat: 'shingles_dark', gable: 'plaster_white', overhang: 1 });
  // ---- kitchen + dining
  p.obj('kitchen_sink', 1.5, Y1, 1.31, R0, 'wood');
  p.obj('kitchen_base', 2.5, Y1, 1.31, R0, 'wood');
  p.obj('stove', 3.5, Y1, 1.32, R0, 'white');
  p.obj('range_hood', 3.5, 1 + 1.55, 1.25, R0, 'white');
  p.obj('kitchen_drawers', 4.5, Y1, 1.31, R0, 'wood');
  p.obj('dishwasher', 5.5, Y1, 1.31, R0, 'white');
  p.obj('fridge', 6.5, Y1, 1.36, R0, 'white');
  p.obj('table_dining_4', 3.5, Y1, 4, R0, 'oak');
  for (const x of [2.9, 4.1]) {
    p.obj('dining_chair', x, Y1, 3.3, R0, 'white');
    p.obj('dining_chair', x, Y1, 4.7, R180, 'white');
  }
  p.obj('pendant_light', 3.5, 3.1, 4, R0, 'sage');
  // ---- living
  p.obj('sofa_3', 3.5, Y1, 7.6, R0, 'blue');
  p.obj('coffee_table_round', 3.5, Y1, 8.9, R0, 'oak');
  p.obj('rug_large', 3.5, Y1, 8.8, R0, 'navy');
  p.obj('tv_console', 3.5, Y1, 11.73, R180, 'white');
  p.obj('tv_stand', 3.5, 1.5, 11.8, R180);
  p.obj('armchair', 6.1, Y1, 9, R270, 'cream');
  p.obj('floor_lamp', 1.3, Y1, 7.4, R0, 'brass');
  p.obj('plant_floor', 6.4, Y1, 11.4, R0, 'cream');
  p.obj('ceiling_light', 3.5, 3.9, 8.5, R0, 'white');
  p.obj('bookshelf', 1.18, Y1, 10, R90, 'oak');
  // ---- downstairs bathroom
  p.obj('toilet', 13.5, Y1, 1.36, R0);
  p.obj('vanity', 9.5, Y1, 1.26, R0, 'white_stone');
  p.obj('bath_mirror', 9.5, 1 + 1.25, 1.07, R0);
  p.obj('shower', 11.5, Y1, 1.5, R0);
  // ---- master bedroom (upper north-west)
  p.obj('bed_queen', 3.5, U, 2.12, R0, 'beige');
  p.obj('nightstand', 2.1, U, 1.22, R0, 'walnut');
  p.obj('nightstand', 4.9, U, 1.22, R0, 'walnut');
  p.obj('table_lamp', 2.1, U + 0.55, 1.22, R0, 'brass');
  p.obj('table_lamp', 4.9, U + 0.55, 1.22, R0, 'brass');
  p.obj('wardrobe_double', 3.5, U, 5.69, R180, 'white');
  p.obj('ceiling_light', 3.5, U + 2.9, 3.5, R0, 'white');
  // ---- second bedroom (upper south-west)
  p.obj('bed_single', 1.55, U, 9, R0, 'green');
  p.obj('dresser', 4.5, U, 11.75, R180, 'white');
  p.obj('mirror_wall', 6.97, U + 1.0, 9.5, R270, 'black');
  p.obj('ceiling_light', 3.5, U + 2.9, 9, R0, 'white');
  // ---- upstairs bathroom (north-east)
  p.obj('bathtub_builtin', 9.5, U, 2, R90, 'white');
  p.obj('toilet', 13.5, U, 1.36, R0);
  p.obj('vanity', 12, U, 3.75, R180, 'marble');
  // ---- office landing (upper south-east) + balcony
  p.obj('office_desk', 12.5, U, 11.63, R180, 'oak');
  p.obj('office_chair', 12.5, U, 10.8, R0, 'gray');
  p.obj('monitor', 12.5, U + 0.76, 11.8, R180);
  p.obj('desk_lamp', 11.9, U + 0.76, 11.8, R180, 'black');
  p.obj('bookshelf', 13.83, U, 7.5, R270, 'oak');
  p.obj('lounge_chair', 11, U, 13.7, R180);
  p.obj('plant_small', 12.6, U, 13.6, R0);
  p.obj('exterior_wall_light', 9.65, 1 + 2.0, 13.1, R0, 'black');
  p.obj('exterior_wall_light', 12.35, 1 + 2.0, 13.1, R0, 'black');
  return p.finish('two_story', 'Two-Story Family Home');
}

// ---------------------------------------------------------------- 4. Lakeside Glass House

function glassHouse(): PresetBlueprint {
  const p = new Plan();
  p.floor(-3, -3, 15, 11, 'decking');
  p.floor(0, 0, 12, 8, 'concrete_light');
  // glass perimeter with white columns every 4 blocks
  for (let x = 0; x <= 12; x++)
    for (const z of [0, 8])
      for (let y = 1; y <= 3; y++) p.block(x, y, z, x % 4 === 0 ? B.ARCH_BLOCK : B.ARCH_GLASS, x % 4 === 0 ? archMeta.cube(A('plaster_white')) : 0);
  for (let z = 1; z < 8; z++)
    for (const x of [0, 12])
      for (let y = 1; y <= 3; y++) p.block(x, y, z, z % 4 === 0 ? B.ARCH_BLOCK : B.ARCH_GLASS, z % 4 === 0 ? archMeta.cube(A('plaster_white')) : 0);
  // bathroom box in frosted glass + slatted wood partition behind the bed
  for (let y = 1; y <= 3; y++) {
    for (let x = 9; x <= 11; x++) p.block(x, y, 5, B.ARCH_GLASS, 1);
    for (let z = 5; z <= 7; z++) p.block(9, y, z, B.ARCH_GLASS, 1);
    for (let z = 1; z <= 3; z++) p.block(8, y, z, B.ARCH_BLOCK, archMeta.cube(A('wood_slats')));
  }
  p.opening('door_glass', 'x', 5, 8, Y1, 1);
  p.opening('door_glass', 'x', 10, 5, Y1, -1);
  p.roof(0, 0, 12, 8, 4, { type: 'flat', mat: 'plaster_white', gable: 'plaster_white', overhang: 1 });
  // extra-deep canopy on the lake (south) side
  for (let x = -2; x <= 14; x++) p.block(x, 4, 10, B.ARCH_PANEL_H, archMeta.panelH(A('plaster_white'), true));
  // open plan living
  p.obj('sofa_section_end', 2.1, Y1, 5.4, R0, 'cream');
  p.obj('sofa_section', 3.2, Y1, 5.4, R0, 'cream');
  p.obj('sofa_section_corner', 4.2, Y1, 5.4, R0, 'cream');
  p.obj('coffee_table_round', 3.2, Y1, 6.7, R0, 'marble');
  p.obj('rug_large', 3.3, Y1, 6.2, R0, 'natural');
  p.obj('floor_lamp', 1.3, Y1, 7.3, R0, 'brass');
  p.obj('plant_floor', 1.4, Y1, 1.5, R0, 'basket');
  p.obj('kitchen_island_4', 4.5, Y1, 2.3, R0, 'marble');
  for (const x of [3.5, 4.5, 5.5]) p.obj('bar_stool', x, Y1, 3.35, R0, 'walnut');
  p.obj('pendant_light', 3.5, 3.1, 2.3, R0, 'black');
  p.obj('pendant_light', 5.5, 3.1, 2.3, R0, 'black');
  p.obj('table_dining_4', 6.5, Y1, 6.3, R90, 'walnut');
  for (const z of [5.7, 6.9]) {
    p.obj('dining_chair', 5.8, Y1, z, R90, 'walnut');
    p.obj('dining_chair', 7.2, Y1, z, R270, 'walnut');
  }
  // bedroom corner behind the slats
  p.obj('bed_platform', 10.2, Y1, 2.5, R0, 'white');
  p.obj('side_table', 11.6, Y1, 1.4, R0, 'walnut');
  p.obj('table_lamp', 11.6, 1.55, 1.4, R0, 'black');
  // bathroom
  p.obj('bathtub_freestanding', 11.4, Y1, 7.0, R0);
  p.obj('bath_sink', 10.4, Y1, 7.77, R180);
  // deck
  p.obj('lounge_bed', 2, Y1, 10.1, R0, 'white');
  p.obj('lounge_bed', 3.2, Y1, 10.1, R0, 'white');
  p.obj('umbrella', 4.8, Y1, 10, R0, 'sand');
  p.obj('outdoor_table', 10, Y1, 9.8, R0, 'teak');
  p.obj('lamp_post', -2.5, Y1, -2.5, R0, 'black');
  p.obj('lamp_post', 14.5, Y1, -2.5, R0, 'black');
  return p.finish('glass_house', 'Lakeside Glass House');
}

// ---------------------------------------------------------------- 6. Cozy Cottage

function cozyCottage(): PresetBlueprint {
  const p = new Plan();
  // front garden path + picket fence with a gate gap
  p.floor(3, 8, 4, 12, 'pavers');
  const fence = blockId('fence');
  for (let x = -1; x <= 11; x++) if (x < 3 || x > 4) p.block(x, Y1, 12, fence, 0);
  for (let z = 8; z <= 11; z++) {
    p.block(-1, Y1, z, fence, 0);
    p.block(11, Y1, z, fence, 0);
  }
  p.room(0, 0, 10, 7, 'plaster_cream', 'floor_oak', 3);
  p.wall(7, 0, 7, 7, 'plaster_warm');
  p.opening('door_wood', 'x', 3, 7, Y1, 1, 'oak');
  p.opening('window_standard', 'x', 1, 7, Y1, 1);
  p.opening('window_standard', 'x', 5, 7, Y1, 1);
  p.opening('window_standard', 'x', 8, 7, Y1, 1);
  p.opening('window_double', 'x', 2, 0, Y1, -1);
  p.opening('window_standard', 'x', 9, 0, Y1, -1);
  p.opening('window_standard', 'z', 3, 0, Y1, -1);
  p.opening('window_standard', 'z', 3, 10, Y1, 1);
  p.opening('door_interior', 'z', 4, 7, Y1, 1, 'oak');
  p.roof(0, 0, 10, 7, 4, { type: 'gable', pitch: 'steep', mat: 'roof_terracotta', gable: 'plaster_cream', overhang: 1 });
  // brick chimney on the back wall
  for (let y = 1; y <= 8; y++) p.block(5, y, -1, B.ARCH_BLOCK, archMeta.cube(A('brick_red')));
  // kitchen & dining
  p.obj('fridge', 1.5, Y1, 1.36, R0, 'white');
  p.obj('kitchen_sink', 2.5, Y1, 1.31, R0);
  p.obj('stove', 3.5, Y1, 1.32, R0);
  p.obj('kitchen_base', 4.5, Y1, 1.31, R0);
  p.obj('table_dining_4', 2.6, Y1, 4.2, R0, 'oak');
  p.obj('dining_chair', 2.2, Y1, 3.4, R0, 'oak');
  p.obj('dining_chair', 3.0, Y1, 3.4, R0, 'oak');
  p.obj('dining_chair', 2.2, Y1, 5.0, R180, 'oak');
  p.obj('dining_chair', 3.0, Y1, 5.0, R180, 'oak');
  p.obj('pendant_light', 2.6, 3.1, 4.2, R0);
  // reading nook
  p.obj('sofa_2', 5.4, Y1, 6.4, R180, 'sage');
  p.obj('coffee_table_round', 5.4, Y1, 5.2, R0, 'oak');
  p.obj('armchair', 6.3, Y1, 3.6, R270, 'terracotta');
  p.obj('floor_lamp', 6.5, Y1, 6.5, R0);
  p.obj('plant_floor', 1.4, Y1, 6.4, R0);
  // bedroom
  p.obj('bed_double', 9, Y1, 2.1, R0, 'cream');
  p.obj('wardrobe_single', 9.5, Y1, 6.6, R180, 'white');
  p.obj('ceiling_light', 9, 3.9, 3.5, R0);
  // garden
  p.obj('flower_bed', 1.5, Y1, 9.5, R0, 'pink');
  p.obj('flower_bed', 8.5, Y1, 9.5, R0, 'sunny');
  p.obj('bench', 7.5, Y1, 10.6, R180);
  p.obj('lamp_post', 2.5, Y1, 11.3, R0, 'black');
  p.obj('bush_round', 0.5, Y1, 11.2, R0);
  p.obj('bush_round', 9.8, Y1, 11.2, R0);
  return p.finish('cozy_cottage', 'Cozy Cottage');
}

// ---------------------------------------------------------------- 7. Beach House on stilts

function beachHouse(): PresetBlueprint {
  const p = new Plan();
  const F = 3; // the house floor sits 3 blocks up on stilts
  const U = F + 1;
  for (let x = -3; x <= 13; x++) for (let z = -3; z <= 15; z++) p.block(x, Y0, z, B.SAND, 0);
  for (const [x, z] of [[0, 0], [5, 0], [10, 0], [0, 6], [10, 6], [0, 10], [5, 10], [10, 10]] as const)
    for (let y = 1; y < F; y++) p.block(x, y, z, B.ARCH_COLUMN, archMeta.rotated(A('wood_white'), 0));
  p.floor(-1, 7, 11, 10, 'decking', F);
  p.room(0, 0, 10, 6, 'wood_white', 'floor_light', 3, F);
  p.wall(6, 0, 6, 6, 'plaster_white', 3, F);
  // deck railings
  for (let x = -1; x <= 11; x++) p.block(x, U, 10, B.ARCH_RAILING_GLASS, archMeta.rotated(A('metal_silver'), 0));
  for (let z = 7; z <= 9; z++) {
    p.block(-1, U, z, B.ARCH_RAILING_GLASS, archMeta.rotated(A('metal_silver'), 1));
    if (z !== 9) p.block(11, U, z, B.ARCH_RAILING_GLASS, archMeta.rotated(A('metal_silver'), 1));
  }
  // stairs from the sand up to the deck (east side)
  p.stairs(12, 0, 13, 9, F, 1, 'decking');
  p.opening('door_sliding', 'x', 2, 6, U, 1);
  p.opening('window_tall_wide', 'x', 4, 6, U, 1);
  p.opening('window_tall', 'x', 1, 6, U, 1);
  p.opening('window_double', 'x', 7, 6, U, 1);
  p.opening('window_horizontal', 'x', 2, 0, U, -1);
  p.opening('window_standard', 'x', 8, 0, U, -1);
  p.opening('window_standard', 'z', 3, 0, U, -1);
  p.opening('window_standard', 'z', 3, 10, U, 1);
  p.opening('door_interior', 'z', 4, 6, U, 1, 'white');
  p.roof(0, 0, 10, 6, F + 4, { type: 'shed', mat: 'roof_metal', gable: 'wood_white', overhang: 1 });
  // living & kitchen
  p.obj('sofa_3', 3, U, 5.2, R180, 'blue');
  p.obj('coffee_table', 3, U, 4.0, R0, 'oak');
  p.obj('kitchen_sink', 1.5, U, 1.31, R0);
  p.obj('stove', 2.5, U, 1.32, R0);
  p.obj('fridge', 3.5, U, 1.36, R0, 'white');
  p.obj('table_dining_2', 4.8, U, 2.4, R0, 'oak');
  p.obj('dining_chair', 4.8, U, 1.7, R0, 'white');
  p.obj('dining_chair', 4.8, U, 3.1, R180, 'white');
  p.obj('plant_floor', 5.5, U, 5.5, R0);
  // bedroom
  p.obj('bed_queen', 8.5, U, 2.2, R0, 'white');
  p.obj('nightstand', 9.6, U, 1.3, R0, 'oak');
  p.obj('ceiling_light', 8.5, F + 3.9, 3, R0);
  // deck & beach
  p.obj('lounge_bed', 1.5, U, 8.5, R0, 'teak');
  p.obj('lounge_bed', 3.0, U, 8.5, R0, 'teak');
  p.obj('umbrella', 2.3, U, 9.3, R0, 'sand');
  p.obj('outdoor_table', 8, U, 8.5, R0, 'teak');
  p.obj('outdoor_chair', 7.3, U, 8.5, R90);
  p.obj('outdoor_chair', 8.7, U, 8.5, R270);
  p.obj('lounge_bed', 5, Y1, 13.5, R0, 'teak');
  p.obj('umbrella', 6.2, Y1, 13.8, R0, 'sand');
  p.obj('bicycle', 2.5, Y1, 3, R90);
  return p.finish('beach_house', 'Beach House on Stilts');
}

// ---------------------------------------------------------------- 8. Modern Villa with Pool

function poolVilla(): PresetBlueprint {
  const p = new Plan();
  p.floor(-7, 9, 15, 17, 'pavers');
  // main wing (living) + bedroom wing (L shape) + garage
  p.room(0, 0, 14, 8, 'concrete_light', 'floor_light', 3);
  p.wall(9, 0, 9, 8, 'plaster_white');
  p.room(-6, 0, -1, 6, 'paint_charcoal', 'concrete_gray', 3);
  p.opening('garage_door', 'x', -5, 6, Y1, 1);
  p.opening('door_entrance', 'x', 3, 0, Y1, -1, 'charcoal');
  for (const x of [1, 6]) p.opening('window_tall_wide', 'x', x, 8, Y1, 1);
  p.opening('door_sliding', 'x', 4, 8, Y1, 1);
  p.opening('window_tall_wide', 'x', 10, 8, Y1, 1);
  p.opening('window_tall', 'x', 13, 8, Y1, 1);
  p.opening('window_horizontal', 'x', 10, 0, Y1, -1);
  p.opening('window_tall', 'z', 3, 14, Y1, 1);
  p.opening('door_interior', 'z', 4, 9, Y1, 1, 'white');
  p.roof(0, 0, 14, 8, 4, { type: 'flat', mat: 'concrete_light', gable: 'concrete_light', overhang: 1 });
  p.roof(-6, 0, -1, 6, 4, { type: 'flat', mat: 'concrete_dark', gable: 'paint_charcoal', overhang: 0 });
  // raised infinity-style pool: tiled basin, stone coping, water
  const cope = archMeta.cube(A('stone_cut'));
  for (let x = 0; x <= 10; x++)
    for (let z = 10; z <= 15; z++) {
      const edge = x === 0 || x === 10 || z === 10 || z === 15;
      p.block(x, Y0, z, B.ARCH_BLOCK, edge ? cope : archMeta.cube(A('pool_tile')));
      p.block(x, Y1, z, edge ? B.ARCH_BLOCK : B.WATER, edge ? cope : 0);
    }
  p.obj('pool_ladder', 9.5, 2, 12.5, R270);
  p.obj('lounge_bed', 12.3, Y1, 11.5, R90, 'teak');
  p.obj('lounge_bed', 12.3, Y1, 13.2, R90, 'teak');
  p.obj('umbrella', 13.6, Y1, 12.4, R0, 'sand');
  p.obj('pergola', -3.5, Y1, 13, R0, 'black_wood');
  p.obj('outdoor_sofa', -3.5, Y1, 13.8, R180, 'sand');
  p.obj('bbq_grill', -6, Y1, 11, R90);
  // garage
  p.obj('car', -3.5, Y1, 3.0, R0);
  p.obj('tool_cabinet', -5.4, Y1, 1.4, R0);
  // kitchen & living
  p.obj('fridge', 5.5, Y1, 1.36, R0, 'steel');
  p.obj('kitchen_sink', 6.5, Y1, 1.31, R0);
  p.obj('stove', 7.5, Y1, 1.32, R0, 'steel');
  p.obj('range_hood', 7.5, 1 + 1.55, 1.25, R0, 'steel');
  p.obj('table_dining_6', 6.8, Y1, 4.3, R0, 'walnut');
  for (const x of [6.0, 6.8, 7.6]) {
    p.obj('dining_chair_upholstered', x, Y1, 3.45, R0, 'gray');
    p.obj('dining_chair_upholstered', x, Y1, 5.15, R180, 'gray');
  }
  p.obj('sofa_section_end', 1.6, Y1, 6.6, R180, 'gray');
  p.obj('sofa_section', 2.6, Y1, 6.6, R180, 'gray');
  p.obj('sofa_section_corner', 3.6, Y1, 6.6, R180, 'gray');
  p.obj('coffee_table', 2.6, Y1, 5.2, R0, 'walnut');
  p.obj('tv_console', 2.6, Y1, 3.2, R0, 'walnut');
  p.obj('chandelier', 6.8, 3.0, 4.3, R0);
  // bedroom wing
  p.obj('bed_platform', 12, Y1, 2.2, R0, 'gray');
  p.obj('nightstand', 10.6, Y1, 1.3, R0, 'walnut');
  p.obj('nightstand', 13.4, Y1, 1.3, R0, 'walnut');
  p.obj('wardrobe_sliding', 12, Y1, 7.6, R180, 'walnut');
  for (const x of [-1, 15]) p.obj('lamp_post', x, Y1, 9.5, R0, 'black');
  return p.finish('pool_villa', 'Modern Villa with Pool');
}

// ---------------------------------------------------------------- 9. Mountain A-Frame Chalet

function aFrameChalet(): PresetBlueprint {
  const p = new Plan();
  p.floor(-2, 9, 8, 12, 'decking');
  p.room(0, 0, 6, 8, 'wood_cladding_dark', 'floor_walnut', 2);
  p.opening('door_glass', 'x', 3, 8, Y1, 1);
  p.opening('window_small', 'x', 1, 8, Y1, 1);
  p.opening('window_small', 'x', 5, 8, Y1, 1);
  p.opening('window_small', 'x', 3, 0, Y1, -1);
  p.opening('window_small', 'z', 2, 0, Y1, -1);
  p.opening('window_small', 'z', 6, 6, Y1, 1);
  // a steep gable that comes almost to the ground = the A-frame look
  p.roof(0, 0, 6, 8, 3, { type: 'gable', pitch: 'steep', mat: 'shingles_dark', gable: 'wood_cladding', overhang: 1 });
  // stone chimney
  for (let y = 1; y <= 8; y++) p.block(1, y, -1, B.ARCH_BLOCK, archMeta.cube(A('fieldstone')));
  p.obj('bed_double', 4.3, Y1, 2.1, R0, 'terracotta');
  p.obj('sofa_2', 2.0, Y1, 5.5, R90, 'gray');
  p.obj('coffee_table_round', 3.0, Y1, 5.5, R0, 'walnut');
  p.obj('armchair', 4.4, Y1, 6.4, R270, 'terracotta');
  p.obj('stove', 1.5, Y1, 1.32, R0);
  p.obj('kitchen_sink', 2.5, Y1, 1.31, R0);
  p.obj('table_dining_2', 2.0, Y1, 3.3, R0, 'walnut');
  p.obj('floor_lamp', 5.5, Y1, 7.4, R0);
  p.obj('bookshelf', 5.6, Y1, 4.5, R270, 'walnut');
  // deck
  p.obj('outdoor_chair', 1.5, Y1, 10.5, R0);
  p.obj('outdoor_chair', 4.5, Y1, 10.5, R0);
  p.obj('bbq_grill', 7.2, Y1, 10.8, R270);
  p.obj('lamp_post', -1.5, Y1, 11.5, R0, 'black');
  return p.finish('aframe_chalet', 'Mountain A-Frame Chalet');
}

// ---------------------------------------------------------------- 10. Tiny Modern House

function tinyHouse(): PresetBlueprint {
  const p = new Plan();
  p.floor(-1, 5, 7, 7, 'decking');
  p.room(0, 0, 6, 4, 'paint_charcoal', 'floor_light', 3);
  p.opening('door_modern', 'x', 1, 4, Y1, 1, 'walnut');
  p.opening('window_tall_wide', 'x', 3, 4, Y1, 1);
  p.opening('window_horizontal', 'x', 2, 0, Y1, -1);
  p.opening('window_standard', 'z', 2, 6, Y1, 1);
  p.roof(0, 0, 6, 4, 4, { type: 'shed', mat: 'roof_metal', gable: 'paint_charcoal', overhang: 1 });
  p.obj('bed_platform', 4.6, Y1, 2.0, R90, 'cream');
  p.obj('kitchen_sink', 1.5, Y1, 1.31, R0);
  p.obj('stove', 2.5, Y1, 1.32, R0);
  p.obj('sofa_2', 1.6, Y1, 3.2, R90, 'sage');
  p.obj('pendant_light', 2.5, 3.1, 2.2, R0);
  p.obj('planter_box', 5.5, Y1, 6.4, R0, 'wood');
  p.obj('outdoor_chair', 3.5, Y1, 6, R0);
  p.obj('bicycle', -0.4, Y1, 2.2, R0);
  return p.finish('tiny_house', 'Tiny Modern House');
}

// ---------------------------------------------------------------- 5. Little Farmstead

function farmstead(): PresetBlueprint {
  const p = new Plan();
  // barn
  p.room(0, 0, 6, 7, 'barn_red', 'floor_dark', 3);
  p.opening('barn_door', 'x', 2, 7, Y1, 1, 'red');
  p.opening('window_standard', 'z', 2, 0, Y1, -1);
  p.opening('window_standard', 'z', 5, 0, Y1, -1);
  p.opening('window_standard', 'z', 3, 6, Y1, 1);
  p.roof(0, 0, 6, 7, 4, { type: 'gable', pitch: 'steep', mat: 'shingles_dark', gable: 'barn_red', overhang: 1 });
  const hay = blockId('hay_bale');
  for (const [x, z, h] of [[1, 1, 2], [2, 1, 1], [1, 2, 1], [5, 1, 1], [5, 2, 2]] as const) for (let y = 1; y <= h; y++) p.block(x, y, z, hay, 0);
  p.obj('water_trough', 4.2, Y1, 5.6, R0, 'wood');
  p.obj('wheelbarrow', 2.0, Y1, 5.2, R90, 'hay');
  // yard & path
  p.floor(-2, 8, 20, 9, 'gravel');
  p.obj('chicken_coop', -2.0, Y1, 3.5, R90, 'white');
  p.obj('farm_stand', 7.9, Y1, 10.9, R0, 'red');
  p.obj('produce_crate', 6.6, Y1, 10.1, R0, 'mixed');
  p.obj('produce_crate', 9.3, Y1, 10.2, R0, 'greens');
  p.obj('lamp_post', 7.9, Y1, 8.5, R0, 'black');
  // field of growing crops, irrigated and fenced (the gate gap faces the path)
  const field: FarmOptions = { crop: 'mixed', stage: 'grow', irrigation: true, fence: true };
  buildFarmPlot(p.ed, { x: 10, y: Y0 + OFF, z: -2 }, { x: 19, y: Y0 + OFF, z: 6 }, field, 1);
  p.block(14, Y1, 3, 0, 0);
  p.obj('scarecrow', 14.5, Y1, 3.5, R0, 'blue');
  p.obj('garden_gate', 14.5, Y1, 7.5, R0, 'oak');
  p.obj('garden_gate', 15.5, Y1, 7.5, R180, 'oak');
  p.obj('beehive', 21.5, Y1, -1.5, R0, 'honey');
  p.obj('compost_bin', 21.5, Y1, 2.5, R0, 'wood');
  for (const z of [-1, 2, 5]) p.block(-1, Y1, z, B.BERRY_BUSH, 1 << 3);
  return p.finish('farmstead', 'Little Farmstead');
}

const BUILDERS: Record<string, () => PresetBlueprint> = {
  starter_cabin: starterCabin,
  one_story: oneStory,
  two_story: twoStory,
  glass_house: glassHouse,
  farmstead,
  cozy_cottage: cozyCottage,
  beach_house: beachHouse,
  pool_villa: poolVilla,
  aframe_chalet: aFrameChalet,
  tiny_house: tinyHouse,
};

const cache = new Map<string, PresetBlueprint>();

export function presetBlueprint(id: string): PresetBlueprint | null {
  const b = BUILDERS[id];
  if (!b) return null;
  let bp = cache.get(id);
  if (!bp) {
    bp = b();
    cache.set(id, bp);
  }
  return bp;
}

export const PRESET_IDS = Object.keys(BUILDERS);

/** Surface of a plan used by tests. */
export function planStats(bp: PresetBlueprint): { blocks: number; objects: number; items: Set<string> } {
  return { blocks: bp.blocks.length, objects: bp.objects.length, items: new Set(bp.objects.map((o) => o.itemId)) };
}

void Edits;
