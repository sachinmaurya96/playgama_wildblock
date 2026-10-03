/**
 * Names of every tile in the procedural terrain atlas. The index in this array is
 * the tile id used by the mesher (worker-safe: no canvas needed here). The painter
 * for each tile lives in game/textures/AtlasPainter.ts.
 */
export const TILE_NAMES = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'sand', 'clay', 'gravel', 'water',
  'log_side', 'log_top', 'leaves', 'pine_side', 'pine_top', 'pine_needles', 'birch_side', 'birch_top',
  'birch_leaves', 'palm_side', 'palm_top', 'palm_fronds', 'blossom_leaves', 'amberstone', 'amber_banded', 'crystal_stone',
  'copper_ore', 'ferra_ore', 'glow_ore', 'moon_ore', 'ember_ore', 'planks', 'birch_planks', 'fieldstone',
  'brick', 'glass', 'thatch', 'lantern', 'torch', 'tall_grass', 'flower_sun', 'flower_sky',
  'flower_ember', 'mushroom', 'berry_bush', 'berry_bush_ripe', 'sapling', 'tilled', 'tilled_moist', 'crop_wheat_0',
  'crop_wheat_1', 'crop_wheat_2', 'crop_wheat_3', 'crop_root_0', 'crop_root_1', 'crop_root_2', 'crop_root_3', 'crop_gourd_0',
  'crop_gourd_1', 'crop_gourd_2', 'crop_gourd_3', 'crop_mint_0', 'crop_mint_1', 'crop_mint_2', 'crop_mint_3', 'bench_top',
  'bench_side', 'metal', 'fire', 'oven', 'fabric_red', 'fabric_cream', 'wool_green', 'chest_side',
  'chest_front', 'crystal', 'lore_stone', 'shell', 'deepstone', 'mossy_fieldstone', 'dry_shrub', 'dark_wood',
  'ice', 'barrel', 'rug', 'soot', 'door', 'window', 'leaf_litter', 'snow',
  // architecture materials (Build Home) — light, fully tintable
  'plaster', 'concrete', 'brick_modern', 'stone_smooth', 'sandstone', 'wood_cladding', 'wood_slats', 'wood_panel',
  'metal_panel', 'wood_floor', 'marble', 'terrazzo', 'tile_square', 'tile_small', 'carpet', 'shingles',
  'roof_tile', 'metal_roof', 'wood_shingles', 'pavers', 'decking', 'glass_pane', 'hedge', 'gate',
  // farming expansion (crop stages must stay consecutive)
  'crop_corn_0', 'crop_corn_1', 'crop_corn_2', 'crop_corn_3', 'crop_tomato_0', 'crop_tomato_1', 'crop_tomato_2', 'crop_tomato_3',
  'hay_top', 'hay_side',
] as const;

export type TileName = (typeof TILE_NAMES)[number];

const TILE_INDEX: Record<string, number> = {};
TILE_NAMES.forEach((n, i) => (TILE_INDEX[n] = i));

export function tileIndex(name: TileName): number {
  return TILE_INDEX[name];
}

/** Each tile is one layer of a 2D array texture (no atlas bleeding, mipmaps just work). */
export const TILE_PIXELS = 64;
export const TILE_COUNT = TILE_NAMES.length;
