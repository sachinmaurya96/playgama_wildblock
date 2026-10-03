import type { SoundMaterial } from './blocks';
import type { TileName } from '../game/world/tiles';

/**
 * Architecture material library (Build Home + modern survival building).
 *
 * One material table is shared by every architecture block shape (full block,
 * slab, stairs, roof slope, column, beam, panel...). The material index is
 * stored in the block's meta byte, so painting a wall only rewrites meta —
 * no new block ids per colour, and the Paint tool can recolour any shape.
 *
 * ORDER MATTERS: indices are saved in worlds. Only append new materials.
 *
 * Tile textures are painted light/neutral with a full tint mask, and `tint`
 * colours them (sRGB hex). A tint of #ffffff shows the tile as painted.
 */
export type ArchGroup = 'paint' | 'concrete' | 'masonry' | 'wood' | 'metal' | 'floor' | 'tile' | 'fabric' | 'roof' | 'ground' | 'natural';

export interface ArchMaterial {
  key: string;
  name: string;
  tile: TileName;
  /** Optional different tile for top/bottom faces of full blocks. */
  topTile?: TileName;
  tint: string;
  group: ArchGroup;
  sound: SoundMaterial;
  /** Search tags + style themes (warm-minimal, modern-dark, scandinavian, tropical). */
  tags: string[];
}

const m = (key: string, name: string, tile: TileName, tint: string, group: ArchGroup, sound: SoundMaterial, tags: string[] = [], topTile?: TileName): ArchMaterial =>
  ({ key, name, tile, tint, group, sound, tags, topTile });

export const ARCH_MATERIALS: ArchMaterial[] = [
  /* 0 */ m('plaster_white', 'White Plaster', 'plaster', '#f4f2ec', 'paint', 'stone', ['white', 'exterior', 'interior', 'wall', 'warm-minimal', 'scandinavian', 'tropical']),
  /* 1 */ m('plaster_warm', 'Warm White', 'plaster', '#f3e9d8', 'paint', 'stone', ['white', 'warm', 'wall', 'warm-minimal']),
  /* 2 */ m('plaster_cream', 'Cream', 'plaster', '#ecdcbe', 'paint', 'stone', ['cream', 'warm', 'wall', 'warm-minimal']),
  /* 3 */ m('plaster_beige', 'Beige', 'plaster', '#d9c4a2', 'paint', 'stone', ['beige', 'wall', 'tropical']),
  /* 4 */ m('paint_sage', 'Sage Green', 'plaster', '#a8b898', 'paint', 'stone', ['green', 'sage', 'wall', 'accent', 'scandinavian']),
  /* 5 */ m('paint_lightgray', 'Light Gray', 'plaster', '#cdcfcd', 'paint', 'stone', ['gray', 'wall', 'scandinavian']),
  /* 6 */ m('paint_gray', 'Gray', 'plaster', '#8f9396', 'paint', 'stone', ['gray', 'wall', 'modern-dark']),
  /* 7 */ m('paint_charcoal', 'Charcoal', 'plaster', '#46494e', 'paint', 'stone', ['dark', 'charcoal', 'wall', 'accent', 'modern-dark']),
  /* 8 */ m('paint_blue', 'Pastel Blue', 'plaster', '#aac4d9', 'paint', 'stone', ['blue', 'pastel', 'wall', 'accent']),
  /* 9 */ m('paint_navy', 'Navy', 'plaster', '#34465f', 'paint', 'stone', ['blue', 'dark', 'wall', 'accent']),
  /* 10 */ m('paint_terracotta', 'Terracotta Accent', 'plaster', '#c8704c', 'paint', 'stone', ['terracotta', 'orange', 'wall', 'accent', 'tropical']),
  /* 11 */ m('paint_blush', 'Blush', 'plaster', '#e3baad', 'paint', 'stone', ['pink', 'wall', 'accent']),
  /* 12 */ m('paint_olive', 'Olive', 'plaster', '#80855a', 'paint', 'stone', ['green', 'olive', 'wall', 'accent']),
  /* 13 */ m('paint_black', 'Matte Black', 'plaster', '#27282b', 'paint', 'stone', ['black', 'dark', 'wall', 'modern-dark']),
  /* 14 */ m('concrete_light', 'Light Concrete', 'concrete', '#d6d4ce', 'concrete', 'stone', ['concrete', 'exterior', 'wall', 'floor', 'roof', 'modern-dark']),
  /* 15 */ m('concrete_gray', 'Gray Concrete', 'concrete', '#a5a39e', 'concrete', 'stone', ['concrete', 'exterior', 'wall', 'floor', 'roof', 'garage', 'modern-dark']),
  /* 16 */ m('concrete_dark', 'Dark Concrete', 'concrete', '#6b6a67', 'concrete', 'stone', ['concrete', 'dark', 'exterior', 'wall', 'modern-dark']),
  /* 17 */ m('brick_red', 'Red Brick', 'brick', '#ffffff', 'masonry', 'stone', ['brick', 'red', 'exterior', 'wall']),
  /* 18 */ m('brick_white', 'White Brick', 'brick_modern', '#eeebe3', 'masonry', 'stone', ['brick', 'white', 'exterior', 'wall', 'scandinavian']),
  /* 19 */ m('brick_gray', 'Gray Brick', 'brick_modern', '#8f8d89', 'masonry', 'stone', ['brick', 'gray', 'exterior', 'wall', 'modern-dark']),
  /* 20 */ m('stone_cut', 'Cut Stone', 'stone_smooth', '#d1ccc2', 'masonry', 'stone', ['stone', 'exterior', 'wall', 'tropical']),
  /* 21 */ m('stone_dark', 'Dark Stone', 'stone_smooth', '#5c5c60', 'masonry', 'stone', ['stone', 'dark', 'exterior', 'wall', 'modern-dark']),
  /* 22 */ m('sandstone', 'Sandstone', 'sandstone', '#e5cb9c', 'masonry', 'stone', ['stone', 'sand', 'desert', 'exterior', 'wall', 'tropical']),
  /* 23 */ m('wood_cladding', 'Wood Cladding', 'wood_cladding', '#bd8a55', 'wood', 'wood', ['wood', 'exterior', 'wall', 'warm-minimal', 'tropical']),
  /* 24 */ m('wood_cladding_dark', 'Dark Wood Cladding', 'wood_cladding', '#5f402a', 'wood', 'wood', ['wood', 'dark', 'exterior', 'wall', 'modern-dark']),
  /* 25 */ m('wood_slats', 'Vertical Wood Slats', 'wood_slats', '#c48e58', 'wood', 'wood', ['wood', 'slats', 'exterior', 'interior', 'wall', 'scandinavian', 'tropical']),
  /* 26 */ m('wood_panel', 'Wood Paneling', 'wood_panel', '#cba26e', 'wood', 'wood', ['wood', 'interior', 'wall', 'warm-minimal']),
  /* 27 */ m('metal_dark', 'Dark Metal Panel', 'metal_panel', '#3f4348', 'metal', 'metal', ['metal', 'dark', 'exterior', 'wall', 'modern-dark']),
  /* 28 */ m('metal_silver', 'Silver Metal Panel', 'metal_panel', '#b9bec3', 'metal', 'metal', ['metal', 'exterior', 'wall']),
  /* 29 */ m('floor_oak', 'Oak Floor', 'wood_floor', '#cb9c63', 'floor', 'wood', ['wood', 'floor', 'oak', 'warm-minimal']),
  /* 30 */ m('floor_walnut', 'Walnut Floor', 'wood_floor', '#7b5337', 'floor', 'wood', ['wood', 'floor', 'walnut', 'dark', 'modern-dark']),
  /* 31 */ m('floor_light', 'Light Wood Floor', 'wood_floor', '#e4c89d', 'floor', 'wood', ['wood', 'floor', 'light', 'scandinavian']),
  /* 32 */ m('floor_dark', 'Dark Wood Floor', 'wood_floor', '#4c3627', 'floor', 'wood', ['wood', 'floor', 'dark']),
  /* 33 */ m('marble', 'Marble', 'marble', '#f3f1ed', 'tile', 'stone', ['marble', 'floor', 'white', 'bathroom', 'kitchen', 'counter']),
  /* 34 */ m('terrazzo', 'Terrazzo', 'terrazzo', '#e9e4db', 'tile', 'stone', ['terrazzo', 'floor', 'kitchen']),
  /* 35 */ m('tile_beige', 'Beige Tile', 'tile_square', '#dccbb0', 'tile', 'stone', ['tile', 'floor', 'beige', 'bathroom', 'tropical']),
  /* 36 */ m('tile_dark', 'Dark Tile', 'tile_square', '#4b4c50', 'tile', 'stone', ['tile', 'floor', 'dark', 'bathroom', 'modern-dark']),
  /* 37 */ m('tile_white', 'White Tile', 'tile_square', '#f1f1ee', 'tile', 'stone', ['tile', 'floor', 'white', 'bathroom', 'kitchen', 'wall']),
  /* 38 */ m('pool_tile', 'Pool Tile', 'tile_small', '#63b8d6', 'tile', 'stone', ['tile', 'pool', 'blue', 'outdoor']),
  /* 39 */ m('carpet_cream', 'Cream Carpet', 'carpet', '#e7ddcc', 'fabric', 'cloth', ['carpet', 'floor', 'bedroom', 'warm-minimal']),
  /* 40 */ m('carpet_gray', 'Gray Carpet', 'carpet', '#9c9fa1', 'fabric', 'cloth', ['carpet', 'floor', 'bedroom']),
  /* 41 */ m('carpet_blue', 'Blue Carpet', 'carpet', '#7090b1', 'fabric', 'cloth', ['carpet', 'floor', 'bedroom']),
  /* 42 */ m('carpet_sage', 'Sage Carpet', 'carpet', '#9bac8d', 'fabric', 'cloth', ['carpet', 'floor', 'bedroom', 'scandinavian']),
  /* 43 */ m('shingles_dark', 'Dark Shingles', 'shingles', '#4b4e53', 'roof', 'stone', ['roof', 'shingles', 'dark']),
  /* 44 */ m('shingles_brown', 'Brown Shingles', 'shingles', '#7b5b45', 'roof', 'stone', ['roof', 'shingles', 'brown']),
  /* 45 */ m('roof_terracotta', 'Terracotta Roof Tile', 'roof_tile', '#c4673e', 'roof', 'stone', ['roof', 'terracotta', 'tile', 'tropical']),
  /* 46 */ m('roof_metal', 'Metal Roofing', 'metal_roof', '#596069', 'roof', 'metal', ['roof', 'metal', 'modern-dark']),
  /* 47 */ m('roof_wood', 'Wooden Shingles', 'wood_shingles', '#9b6f45', 'roof', 'wood', ['roof', 'wood']),
  /* 48 */ m('pavers', 'Stone Pavers', 'pavers', '#c5beb3', 'ground', 'stone', ['pavers', 'outdoor', 'patio', 'driveway', 'path']),
  /* 49 */ m('pavers_dark', 'Charcoal Pavers', 'pavers', '#6e6d6b', 'ground', 'stone', ['pavers', 'outdoor', 'dark', 'patio', 'driveway', 'modern-dark']),
  /* 50 */ m('decking', 'Wood Decking', 'decking', '#aa764b', 'ground', 'wood', ['deck', 'wood', 'outdoor', 'patio', 'tropical']),
  /* 51 */ m('decking_gray', 'Gray Decking', 'decking', '#9b968d', 'ground', 'wood', ['deck', 'wood', 'outdoor', 'patio']),
  /* 52 */ m('gravel', 'Gravel', 'gravel', '#ffffff', 'ground', 'sand', ['gravel', 'outdoor', 'path', 'driveway']),
  /* 53 */ m('planks', 'Broadleaf Boards', 'planks', '#ffffff', 'natural', 'wood', ['wood', 'rustic']),
  /* 54 */ m('fieldstone', 'Fieldstone', 'fieldstone', '#ffffff', 'natural', 'stone', ['stone', 'rustic']),
  /* 55 */ m('studio_white', 'Studio White', 'plaster', '#ffffff', 'paint', 'stone', ['white', 'studio']),
  /* 56 */ m('thatch', 'Thatch', 'thatch', '#ffffff', 'natural', 'plant', ['roof', 'rustic']),
  /* 57 */ m('wood_white', 'White Painted Wood', 'wood_cladding', '#f1eee6', 'wood', 'wood', ['wood', 'white', 'exterior', 'wall', 'scandinavian']),
  /* 58 */ m('metal_black', 'Black Steel', 'metal_panel', '#232427', 'metal', 'metal', ['metal', 'black', 'steel', 'beam', 'modern-dark']),
  /* 59 */ m('marble_black', 'Black Marble', 'marble', '#3a3a3e', 'tile', 'stone', ['marble', 'black', 'counter', 'dark', 'modern-dark']),
  /* 60 */ m('barn_red', 'Barn Red Boards', 'wood_cladding', '#b0503a', 'wood', 'wood', ['red', 'barn', 'farm', 'rustic', 'exterior', 'wall']),
];

export const ARCH_COUNT = ARCH_MATERIALS.length;

const byKey = new Map(ARCH_MATERIALS.map((mat, i) => [mat.key, i]));

export function archIndex(key: string): number {
  const i = byKey.get(key);
  if (i === undefined) throw new Error(`Unknown architecture material "${key}"`);
  return i;
}

export function archMaterial(i: number): ArchMaterial {
  return ARCH_MATERIALS[i] ?? ARCH_MATERIALS[0];
}

/** Parse "#rrggbb" to 0..255 triple. */
export function hexRgb(h: string): [number, number, number] {
  const v = parseInt(h.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Translucent glass variants for the glass wall block (meta = index). */
export const GLASS_VARIANTS: { key: string; name: string; tint: string; opacity: number; frosted: boolean }[] = [
  { key: 'clear', name: 'Clear Glass', tint: '#d8ecf2', opacity: 0.2, frosted: false },
  { key: 'frosted', name: 'Frosted Glass', tint: '#eef4f6', opacity: 0.62, frosted: true },
  { key: 'smoked', name: 'Smoked Glass', tint: '#6d7478', opacity: 0.42, frosted: false },
  { key: 'blue', name: 'Blue Tinted Glass', tint: '#9cc8e0', opacity: 0.3, frosted: false },
  { key: 'bronze', name: 'Bronze Tinted Glass', tint: '#c9a47a', opacity: 0.36, frosted: false },
];

/**
 * Meta layouts for architecture shape blocks:
 *   full block                 meta = material (0..255)
 *   slab                       meta = material (0..63) | top << 6
 *   stairs / slopes / columns /
 *   vertical panels / trims    meta = rotation (0..3) | material (0..63) << 2
 *   beam                       meta = axis(bit 0) | high(bit 1) | material << 2
 *   horizontal panel           meta = top(bit 0) | material (0..127) << 1
 */
export const archMeta = {
  cube: (mat: number) => mat & 255,
  slab: (mat: number, top = false) => (mat & 63) | (top ? 64 : 0),
  rotated: (mat: number, rot: number) => (rot & 3) | ((mat & 63) << 2),
  panelH: (mat: number, top: boolean) => (top ? 1 : 0) | ((mat & 127) << 1),
};

export type ArchShapeKind = 'cube' | 'slab' | 'rotated' | 'panel_h';

/** Extract the material index from any architecture block's meta. */
export function archMaterialOf(kind: ArchShapeKind, meta: number): number {
  switch (kind) {
    case 'cube': return meta;
    case 'slab': return meta & 63;
    case 'rotated': return meta >> 2;
    case 'panel_h': return meta >> 1;
  }
}

/** Replace the material in a meta byte, keeping orientation bits. */
export function withArchMaterial(kind: ArchShapeKind, meta: number, mat: number): number {
  switch (kind) {
    case 'cube': return mat & 255;
    case 'slab': return (meta & 64) | (mat & 63);
    case 'rotated': return (meta & 3) | ((mat & 63) << 2);
    case 'panel_h': return (meta & 1) | ((mat & 127) << 1);
  }
}

/** Highest material index a shape can store. */
export function archMaterialLimit(kind: ArchShapeKind): number {
  return kind === 'cube' ? 255 : kind === 'panel_h' ? 127 : 63;
}
