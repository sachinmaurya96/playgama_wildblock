import { BLOCK_DEFS, type ArchModel, type BlockDef } from '../../data/blocks';
import type { ArchShapeKind } from '../../data/architecture';
import { tileIndex } from './tiles';

/**
 * Central block registry: fast numeric lookups built once from data/blocks.ts.
 * Safe to import inside Web Workers (no DOM usage).
 */

export const BLOCK_COUNT = BLOCK_DEFS.length;

const keyToId = new Map<string, number>();
BLOCK_DEFS.forEach((d, i) => keyToId.set(d.key, i));

export function blockId(key: string): number {
  const id = keyToId.get(key);
  if (id === undefined) throw new Error(`Unknown block key "${key}"`);
  return id;
}

export function blockDef(id: number): BlockDef {
  return BLOCK_DEFS[id] ?? BLOCK_DEFS[0];
}

export function hasBlock(key: string): boolean {
  return keyToId.has(key);
}

/** Frequently used block ids. */
export const B = {
  AIR: blockId('air'),
  GRASS: blockId('grass'),
  DIRT: blockId('dirt'),
  STONE: blockId('stone'),
  SAND: blockId('sand'),
  CLAY: blockId('clay'),
  GRAVEL: blockId('gravel'),
  WATER: blockId('water'),
  LOG: blockId('log'),
  LEAVES: blockId('leaves'),
  PINE_LOG: blockId('pine_log'),
  PINE_NEEDLES: blockId('pine_needles'),
  BIRCH_LOG: blockId('birch_log'),
  BIRCH_LEAVES: blockId('birch_leaves'),
  PALM_LOG: blockId('palm_log'),
  PALM_FRONDS: blockId('palm_fronds'),
  BLOSSOM_LEAVES: blockId('blossom_leaves'),
  AMBERSTONE: blockId('amberstone'),
  AMBER_BANDED: blockId('amber_banded'),
  CRYSTAL_STONE: blockId('crystal_stone'),
  COPPER_ORE: blockId('copper_ore'),
  FERRA_ORE: blockId('ferra_ore'),
  GLOW_ORE: blockId('glow_ore'),
  MOON_ORE: blockId('moon_ore'),
  EMBER_ORE: blockId('ember_ore'),
  PLANKS: blockId('planks'),
  FIELDSTONE: blockId('fieldstone'),
  MOSSY_FIELDSTONE: blockId('mossy_fieldstone'),
  TALL_GRASS: blockId('tall_grass'),
  FLOWER_SUN: blockId('flower_sun'),
  FLOWER_SKY: blockId('flower_sky'),
  FLOWER_EMBER: blockId('flower_ember'),
  MUSHROOM: blockId('mushroom'),
  BERRY_BUSH: blockId('berry_bush'),
  SAPLING: blockId('sapling'),
  TILLED: blockId('tilled'),
  TILLED_MOIST: blockId('tilled_moist'),
  CHEST: blockId('chest'),
  LORE_STONE: blockId('lore_stone'),
  SHELL: blockId('shell'),
  CRYSTAL_CLUSTER: blockId('crystal_cluster'),
  DEEPSTONE: blockId('deepstone'),
  DRY_SHRUB: blockId('dry_shrub'),
  DOOR_LOWER: blockId('door_lower'),
  DOOR_UPPER: blockId('door_upper'),
  BED: blockId('bed'),
  SNOW: blockId('snow'),
  LEAF_LITTER: blockId('leaf_litter'),
  TORCH: blockId('torch'),
  COOKING_FIRE: blockId('cooking_fire'),
  THATCH: blockId('thatch'),
  FENCE: blockId('fence'),
  LANTERN: blockId('lantern'),
  PLANK_STAIRS: blockId('plank_stairs'),
  ROOF_STAIRS: blockId('roof_stairs'),
  WORKBENCH: blockId('workbench'),
  CROP_WHEAT: blockId('crop_wheat'),
  CROP_ROOT: blockId('crop_root'),
  CROP_GOURD: blockId('crop_gourd'),
  CROP_MINT: blockId('crop_mint'),
  GLASS: blockId('glass'),
  WINDOW: blockId('window'),
  BRICK: blockId('brick'),
  BIRCH_PLANKS: blockId('birch_planks'),
  FIREPLACE: blockId('fireplace'),
  ARCH_BLOCK: blockId('arch_block'),
  ARCH_GLASS: blockId('arch_glass'),
  ARCH_SLAB: blockId('arch_slab'),
  ARCH_STAIRS: blockId('arch_stairs'),
  ARCH_STAIRS_FLOAT: blockId('arch_stairs_float'),
  ARCH_SLOPE: blockId('arch_slope'),
  ARCH_SLOPE_OUTER: blockId('arch_slope_outer'),
  ARCH_SLOPE_INNER: blockId('arch_slope_inner'),
  ARCH_COLUMN: blockId('arch_column'),
  ARCH_COLUMN_ROUND: blockId('arch_column_round'),
  ARCH_BEAM: blockId('arch_beam'),
  ARCH_PANEL_H: blockId('arch_panel_h'),
  ARCH_PANEL_V: blockId('arch_panel_v'),
  ARCH_BASEBOARD: blockId('arch_baseboard'),
  ARCH_CROWN: blockId('arch_crown'),
  ARCH_RAILING_GLASS: blockId('arch_railing_glass'),
  ARCH_RAILING_BARS: blockId('arch_railing_bars'),
  ARCH_FENCE: blockId('arch_fence'),
  ARCH_FENCE_GLASS: blockId('arch_fence_glass'),
  ARCH_WALL_LOW: blockId('arch_wall_low'),
  HEDGE: blockId('hedge'),
  HEDGE_LOW: blockId('hedge_low'),
  FENCE_GATE: blockId('fence_gate'),
  ARCH_SLOPE_LOW1: blockId('arch_slope_low1'),
  ARCH_SLOPE_LOW2: blockId('arch_slope_low2'),
  PLANK_SLAB: blockId('plank_slab'),
  STONE_SLAB: blockId('stone_slab'),
} as const;

// ---- Fast lookup tables (typed arrays for the mesher / physics hot loops) ----

/** 1 when the block fully hides neighbouring faces. */
export const OPAQUE = new Uint8Array(256);
/** 1 when the block uses the cutout (alpha-tested) pass as a full cube (leaves, glass). */
export const CUTOUT_CUBE = new Uint8Array(256);
/** 1 when the player collides with the block. */
export const SOLID = new Uint8Array(256);
/** 1 for liquids. */
export const LIQUID = new Uint8Array(256);
/** Shape code: 0 none,1 cube,2 cross,3 liquid,4 model,5 fence,6 arch shape,7 glass cube. */
export const SHAPE = new Uint8Array(256);
/** Tile ids per face: [top, bottom, side]. */
export const TILE_TOP = new Uint16Array(256);
export const TILE_BOTTOM = new Uint16Array(256);
export const TILE_SIDE = new Uint16Array(256);
export const TILE_VARIANTS = new Uint8Array(256);
/** Tint code: 0 none, 1 grass, 2 foliage. */
export const TINT = new Uint8Array(256);
/** Light emission 0..15. */
export const LIGHT = new Uint8Array(256);
/** Sways in wind. */
export const SWAY = new Uint8Array(256);
/** Collision height in 1/16 units (16 = full block). */
export const COLLISION_H = new Uint8Array(256);
/** Architecture model code (0 = not architecture), index into ARCH_MODELS. */
export const ARCH_MODEL = new Uint8Array(256);
/** Architecture meta layout: 0 none, 1 cube, 2 slab, 3 rotated, 4 horizontal panel. */
export const ARCH_KIND = new Uint8Array(256);
/** 1 when the block stops skylight (roofs, slabs, walls) for interior shading. */
export const SKYBLOCK = new Uint8Array(256);
/** 1 for blocks the player walks up like stairs (auto-step a full block). */
export const STAIRS = new Uint8Array(256);

export const ARCH_MODELS: ArchModel[] = [
  'cube', 'cube', 'glass', 'slab', 'stairs', 'stairs_float', 'slope', 'slope_outer', 'slope_inner', 'column', 'column_round', 'beam',
  'panel_h', 'panel_v', 'baseboard', 'crown', 'railing_glass', 'railing_bars', 'fence_rail', 'fence_glass', 'wall_low', 'slope_low1', 'slope_low2',
];
const ARCH_KIND_CODE: Record<ArchShapeKind, number> = { cube: 1, slab: 2, rotated: 3, panel_h: 4 };

const shapeCode = { none: 0, cube: 1, cross: 2, liquid: 3, model: 4, fence: 5, arch: 6 } as const;

BLOCK_DEFS.forEach((d, id) => {
  SHAPE[id] = d.layer === 'glass' ? 7 : shapeCode[d.shape];
  if (d.arch) {
    ARCH_MODEL[id] = Math.max(1, ARCH_MODELS.indexOf(d.arch.model, 1));
    ARCH_KIND[id] = ARCH_KIND_CODE[d.arch.kind];
  }
  const m = d.arch?.model;
  SKYBLOCK[id] = (d.shape === 'cube' && d.layer === 'opaque' && d.tint !== 'foliage') ||
    m === 'slab' || m === 'stairs' || m === 'slope' || m === 'slope_outer' || m === 'slope_inner' || m === 'panel_h' || m === 'slope_low1' || m === 'slope_low2' ||
    d.model === 'slab' || d.model === 'stairs' ? 1 : 0;
  STAIRS[id] = m === 'stairs' || m === 'stairs_float' || m === 'slope' || m === 'slope_outer' || m === 'slope_inner' || m === 'slope_low1' || m === 'slope_low2' || d.model === 'stairs' ? 1 : 0;
  OPAQUE[id] = d.shape === 'cube' && d.layer === 'opaque' ? 1 : 0;
  CUTOUT_CUBE[id] = d.shape === 'cube' && d.layer === 'cutout' ? 1 : 0;
  SOLID[id] = d.solid ? 1 : 0;
  LIQUID[id] = d.liquid ? 1 : 0;
  TINT[id] = d.tint === 'grass' ? 1 : d.tint === 'foliage' ? 2 : 0;
  LIGHT[id] = d.light ?? 0;
  SWAY[id] = d.sway ? 1 : 0;
  COLLISION_H[id] = d.solid ? (d.collisionHeight ?? 16) : 0;
  if (d.tiles) {
    TILE_TOP[id] = tileIndex(d.tiles.top);
    TILE_BOTTOM[id] = tileIndex(d.tiles.bottom);
    TILE_SIDE[id] = tileIndex(d.tiles.side);
    TILE_VARIANTS[id] = d.tiles.variants ?? 1;
  }
});

export function isReplaceable(id: number): boolean {
  return id === B.AIR || !!BLOCK_DEFS[id]?.replaceable;
}

export function allBlockDefs(): readonly BlockDef[] {
  return BLOCK_DEFS;
}
