import type { TileName } from '../game/world/tiles';
import type { ArchShapeKind } from './architecture';

export type ToolKind = 'axe' | 'pick' | 'shovel' | 'hoe' | 'weapon';
export type BlockShape = 'none' | 'cube' | 'cross' | 'liquid' | 'model' | 'fence' | 'arch';
export type RenderLayer = 'opaque' | 'cutout' | 'liquid' | 'glass' | 'none';
export type SoundMaterial = 'wood' | 'stone' | 'dirt' | 'plant' | 'metal' | 'glass' | 'sand' | 'cloth';
export type BuildCategory = 'Structure' | 'Furniture' | 'Storage' | 'Lighting' | 'Crafting' | 'Decoration' | 'Nature';
export type Interaction = 'container' | 'station' | 'bed' | 'door' | 'lore' | 'harvest' | 'sit';
export type StationKind = 'workbench' | 'stonecutter' | 'forge' | 'cooking_fire' | 'stone_oven' | 'kitchen_table' | 'carpentry_bench' | 'crystal_bench';
export type TintKind = 'none' | 'grass' | 'foliage';

/** Geometry of an architecture block; colour/texture come from ARCH_MATERIALS via meta. */
export type ArchModel =
  | 'cube' | 'glass' | 'slab' | 'stairs' | 'stairs_float' | 'slope' | 'slope_outer' | 'slope_inner' | 'slope_low1' | 'slope_low2'
  | 'column' | 'column_round' | 'beam' | 'panel_h' | 'panel_v' | 'baseboard' | 'crown'
  | 'railing_glass' | 'railing_bars' | 'fence_rail' | 'fence_glass' | 'wall_low';

export interface BlockDef {
  /** Stable string key (used in saves, items, recipes). */
  key: string;
  name: string;
  /** Seconds to break with bare hands (tools divide this). Infinity = unbreakable. */
  hardness: number;
  tool?: ToolKind;
  /** Minimum tool tier (0 hand/scrap, 1 copper, 2 tempered, 3 crystal) needed to get drops. */
  minTier?: number;
  shape: BlockShape;
  layer: RenderLayer;
  tiles?: { top: TileName; bottom: TileName; side: TileName; variants?: number };
  model?: string;
  tint?: TintKind;
  /** Blocks movement. */
  solid: boolean;
  /** Custom collision in 1/16 units (unrotated); default full cube when solid. */
  collisionHeight?: number;
  /** 0..15 light emitted (used for dynamic point lights + glow). */
  light?: number;
  lightColor?: string;
  liquid?: boolean;
  sound: SoundMaterial;
  /** Item key dropped; default = block's own item. `null` = nothing. */
  drop?: string | null;
  dropCount?: [number, number];
  /** Extra chance drops. */
  bonusDrops?: { item: string; chance: number; count?: [number, number] }[];
  category?: BuildCategory;
  interact?: Interaction;
  station?: StationKind;
  /** Rotates toward the player on placement. */
  rotates?: boolean;
  /** Needs a solid block below (plants, torches, crops). */
  needsSupport?: boolean;
  /** Comfort points for the Home Comfort system. */
  comfort?: number;
  /** Homestead points awarded the first time each is placed near home. */
  homestead?: number;
  /** Seconds of growth per stage (crops). */
  growth?: { stages: number; secondsPerStage: number; harvest: string; harvestCount: [number, number]; seed: string };
  /** Replaceable by placement (tall grass, flowers). */
  replaceable?: boolean;
  /** Overrides every box tile of the model (e.g. stone slab reuses the slab model). */
  modelTile?: TileName;
  /** Emits wind sway in the shader. */
  sway?: boolean;
  /** Architecture block: material from meta (see data/architecture.ts). */
  arch?: { kind: ArchShapeKind; model: ArchModel };
  /** Produced by world generation (used by the data validator's obtainability graph). */
  natural?: boolean;
  description?: string;
}

/**
 * The master block list. ORDER MATTERS: the index is the numeric BlockId stored in
 * chunk arrays and saves. Only ever append new blocks at the end.
 */
export const BLOCK_DEFS: BlockDef[] = [
  { key: 'air', name: 'Air', hardness: 0, shape: 'none', layer: 'none', solid: false, sound: 'dirt', drop: null },
  { key: 'grass', natural: true, name: 'Meadow Turf', hardness: 0.7, tool: 'shovel', shape: 'cube', layer: 'opaque', tiles: { top: 'grass_top', bottom: 'dirt', side: 'grass_side', variants: 3 }, tint: 'grass', solid: true, sound: 'dirt', drop: 'dirt', bonusDrops: [{ item: 'grass_seeds', chance: 0.08 }] },
  { key: 'dirt', natural: true, name: 'Soil', hardness: 0.6, tool: 'shovel', shape: 'cube', layer: 'opaque', tiles: { top: 'dirt', bottom: 'dirt', side: 'dirt', variants: 3 }, solid: true, sound: 'dirt', category: 'Structure' },
  { key: 'stone', natural: true, name: 'Stone', hardness: 4.5, tool: 'pick', minTier: 0, shape: 'cube', layer: 'opaque', tiles: { top: 'stone', bottom: 'stone', side: 'stone', variants: 3 }, solid: true, sound: 'stone', drop: 'fieldstone' },
  { key: 'sand', natural: true, name: 'Sand', hardness: 0.6, tool: 'shovel', shape: 'cube', layer: 'opaque', tiles: { top: 'sand', bottom: 'sand', side: 'sand', variants: 2 }, solid: true, sound: 'sand', category: 'Structure' },
  { key: 'clay', natural: true, name: 'River Clay', hardness: 0.8, tool: 'shovel', shape: 'cube', layer: 'opaque', tiles: { top: 'clay', bottom: 'clay', side: 'clay' }, solid: true, sound: 'dirt', drop: 'clay_lump', dropCount: [2, 4] },
  { key: 'gravel', natural: true, name: 'Gravel', hardness: 0.8, tool: 'shovel', shape: 'cube', layer: 'opaque', tiles: { top: 'gravel', bottom: 'gravel', side: 'gravel' }, solid: true, sound: 'sand', bonusDrops: [{ item: 'flint', chance: 0.25 }] },
  { key: 'water', natural: true, name: 'Water', hardness: Infinity, shape: 'liquid', layer: 'liquid', solid: false, liquid: true, sound: 'dirt', drop: null, replaceable: true },
  { key: 'log', natural: true, name: 'Broadleaf Log', hardness: 2.6, tool: 'axe', shape: 'cube', layer: 'opaque', tiles: { top: 'log_top', bottom: 'log_top', side: 'log_side' }, solid: true, sound: 'wood', category: 'Structure' },
  { key: 'leaves', natural: true, name: 'Broadleaf Canopy', hardness: 0.25, shape: 'cube', layer: 'cutout', tiles: { top: 'leaves', bottom: 'leaves', side: 'leaves' }, tint: 'foliage', solid: true, sound: 'plant', drop: null, bonusDrops: [{ item: 'sapling', chance: 0.12 }, { item: 'stick', chance: 0.2 }], sway: true },
  { key: 'pine_log', natural: true, name: 'Pine Log', hardness: 2.6, tool: 'axe', shape: 'cube', layer: 'opaque', tiles: { top: 'pine_top', bottom: 'pine_top', side: 'pine_side' }, solid: true, sound: 'wood', drop: 'log' },
  { key: 'pine_needles', natural: true, name: 'Pine Needles', hardness: 0.25, shape: 'cube', layer: 'cutout', tiles: { top: 'pine_needles', bottom: 'pine_needles', side: 'pine_needles' }, tint: 'foliage', solid: true, sound: 'plant', drop: null, bonusDrops: [{ item: 'sapling', chance: 0.1 }, { item: 'stick', chance: 0.2 }], sway: true },
  { key: 'birch_log', natural: true, name: 'Paleback Log', hardness: 2.4, tool: 'axe', shape: 'cube', layer: 'opaque', tiles: { top: 'birch_top', bottom: 'birch_top', side: 'birch_side' }, solid: true, sound: 'wood' },
  { key: 'birch_leaves', natural: true, name: 'Paleback Leaves', hardness: 0.25, shape: 'cube', layer: 'cutout', tiles: { top: 'birch_leaves', bottom: 'birch_leaves', side: 'birch_leaves' }, solid: true, sound: 'plant', drop: null, bonusDrops: [{ item: 'sapling', chance: 0.12 }], sway: true },
  { key: 'palm_log', natural: true, name: 'Palm Trunk', hardness: 2.2, tool: 'axe', shape: 'cube', layer: 'opaque', tiles: { top: 'palm_top', bottom: 'palm_top', side: 'palm_side' }, solid: true, sound: 'wood', drop: 'log' },
  { key: 'palm_fronds', natural: true, name: 'Palm Fronds', hardness: 0.2, shape: 'cube', layer: 'cutout', tiles: { top: 'palm_fronds', bottom: 'palm_fronds', side: 'palm_fronds' }, tint: 'foliage', solid: true, sound: 'plant', drop: null, bonusDrops: [{ item: 'coconut', chance: 0.15 }], sway: true },
  { key: 'blossom_leaves', natural: true, name: 'Orchard Blossom', hardness: 0.25, shape: 'cube', layer: 'cutout', tiles: { top: 'blossom_leaves', bottom: 'blossom_leaves', side: 'blossom_leaves' }, solid: true, sound: 'plant', drop: null, bonusDrops: [{ item: 'sunapple', chance: 0.35 }, { item: 'sapling', chance: 0.1 }], sway: true },
  { key: 'amberstone', natural: true, name: 'Amberstone', hardness: 4, tool: 'pick', shape: 'cube', layer: 'opaque', tiles: { top: 'amberstone', bottom: 'amberstone', side: 'amberstone', variants: 2 }, solid: true, sound: 'stone', category: 'Structure' },
  { key: 'amber_banded', natural: true, name: 'Banded Amberstone', hardness: 4, tool: 'pick', shape: 'cube', layer: 'opaque', tiles: { top: 'amberstone', bottom: 'amberstone', side: 'amber_banded' }, solid: true, sound: 'stone', category: 'Structure' },
  { key: 'crystal_stone', natural: true, name: 'Shimmerrock', hardness: 5, tool: 'pick', shape: 'cube', layer: 'opaque', tiles: { top: 'crystal_stone', bottom: 'crystal_stone', side: 'crystal_stone' }, solid: true, sound: 'stone', category: 'Structure' },
  { key: 'copper_ore', natural: true, name: 'Copper Vein', hardness: 5, tool: 'pick', minTier: 0, shape: 'cube', layer: 'opaque', tiles: { top: 'copper_ore', bottom: 'copper_ore', side: 'copper_ore' }, solid: true, sound: 'stone', drop: 'raw_copper', dropCount: [1, 2] },
  { key: 'ferra_ore', natural: true, name: 'Ferra Vein', hardness: 6, tool: 'pick', minTier: 1, shape: 'cube', layer: 'opaque', tiles: { top: 'ferra_ore', bottom: 'ferra_ore', side: 'ferra_ore' }, solid: true, sound: 'stone', drop: 'raw_ferra' },
  { key: 'glow_ore', natural: true, name: 'Glow Crystal Vein', hardness: 6, tool: 'pick', minTier: 1, shape: 'cube', layer: 'opaque', tiles: { top: 'glow_ore', bottom: 'glow_ore', side: 'glow_ore' }, solid: true, light: 7, lightColor: '#8ff2ff', sound: 'glass', drop: 'glow_crystal', dropCount: [1, 3] },
  { key: 'moon_ore', natural: true, name: 'Moonstone Vein', hardness: 8, tool: 'pick', minTier: 2, shape: 'cube', layer: 'opaque', tiles: { top: 'moon_ore', bottom: 'moon_ore', side: 'moon_ore' }, solid: true, light: 4, lightColor: '#c9c3ff', sound: 'glass', drop: 'moonstone' },
  { key: 'ember_ore', natural: true, name: 'Emberite Seam', hardness: 4, tool: 'pick', shape: 'cube', layer: 'opaque', tiles: { top: 'ember_ore', bottom: 'ember_ore', side: 'ember_ore' }, solid: true, sound: 'stone', drop: 'emberite', dropCount: [1, 3] },
  { key: 'planks', name: 'Broadleaf Boards', hardness: 2, tool: 'axe', shape: 'cube', layer: 'opaque', tiles: { top: 'planks', bottom: 'planks', side: 'planks' }, solid: true, sound: 'wood', category: 'Structure', homestead: 1 },
  { key: 'birch_planks', name: 'Paleback Boards', hardness: 2, tool: 'axe', shape: 'cube', layer: 'opaque', tiles: { top: 'birch_planks', bottom: 'birch_planks', side: 'birch_planks' }, solid: true, sound: 'wood', category: 'Structure', homestead: 1 },
  { key: 'fieldstone', name: 'Fieldstone', hardness: 4, tool: 'pick', shape: 'cube', layer: 'opaque', tiles: { top: 'fieldstone', bottom: 'fieldstone', side: 'fieldstone' }, solid: true, sound: 'stone', category: 'Structure', homestead: 1 },
  { key: 'brick', name: 'Kiln Brick', hardness: 4.5, tool: 'pick', shape: 'cube', layer: 'opaque', tiles: { top: 'brick', bottom: 'brick', side: 'brick' }, solid: true, sound: 'stone', category: 'Structure', homestead: 1 },
  { key: 'glass', name: 'Clear Glass', hardness: 0.6, shape: 'cube', layer: 'cutout', tiles: { top: 'glass', bottom: 'glass', side: 'glass' }, solid: true, sound: 'glass', category: 'Structure', homestead: 1 },
  { key: 'thatch', name: 'Thatch Roofing', hardness: 0.8, tool: 'axe', shape: 'cube', layer: 'opaque', tiles: { top: 'thatch', bottom: 'thatch', side: 'thatch' }, solid: true, sound: 'plant', category: 'Structure', homestead: 1 },
  { key: 'lantern', name: 'Hanging Lantern', hardness: 0.5, shape: 'model', model: 'lantern', layer: 'cutout', solid: true, light: 13, lightColor: '#ffc978', sound: 'metal', category: 'Lighting', homestead: 3, comfort: 1, collisionHeight: 8 },
  { key: 'torch', name: 'Torch', hardness: 0.1, shape: 'model', model: 'torch', layer: 'cutout', solid: false, light: 12, lightColor: '#ffb566', sound: 'wood', category: 'Lighting', needsSupport: true },
  { key: 'tall_grass', natural: true, name: 'Tall Grass', hardness: 0.05, shape: 'cross', layer: 'cutout', tiles: { top: 'tall_grass', bottom: 'tall_grass', side: 'tall_grass' }, tint: 'grass', solid: false, sound: 'plant', drop: null, bonusDrops: [{ item: 'grass_seeds', chance: 0.18 }, { item: 'fiber', chance: 0.45 }, { item: 'skycorn_seeds', chance: 0.05 }, { item: 'blushberry', chance: 0.04 }], replaceable: true, needsSupport: true, sway: true },
  { key: 'flower_sun', natural: true, name: 'Sunpetal', hardness: 0.05, shape: 'cross', layer: 'cutout', tiles: { top: 'flower_sun', bottom: 'flower_sun', side: 'flower_sun' }, solid: false, sound: 'plant', replaceable: true, needsSupport: true, sway: true, category: 'Nature' },
  { key: 'flower_sky', natural: true, name: 'Skybell', hardness: 0.05, shape: 'cross', layer: 'cutout', tiles: { top: 'flower_sky', bottom: 'flower_sky', side: 'flower_sky' }, solid: false, sound: 'plant', replaceable: true, needsSupport: true, sway: true, category: 'Nature' },
  { key: 'flower_ember', natural: true, name: 'Emberbloom', hardness: 0.05, shape: 'cross', layer: 'cutout', tiles: { top: 'flower_ember', bottom: 'flower_ember', side: 'flower_ember' }, solid: false, sound: 'plant', replaceable: true, needsSupport: true, sway: true, category: 'Nature' },
  { key: 'mushroom', natural: true, name: 'Capmoss Mushroom', hardness: 0.05, shape: 'cross', layer: 'cutout', tiles: { top: 'mushroom', bottom: 'mushroom', side: 'mushroom' }, solid: false, sound: 'plant', replaceable: true, needsSupport: true },
  { key: 'berry_bush', natural: true, name: 'Bramble Bush', hardness: 0.5, shape: 'cross', layer: 'cutout', tiles: { top: 'berry_bush', bottom: 'berry_bush', side: 'berry_bush' }, solid: false, sound: 'plant', drop: 'bramble_berries', dropCount: [0, 1], needsSupport: true, sway: true, interact: 'harvest' },
  { key: 'sapling', name: 'Sapling', hardness: 0.05, shape: 'cross', layer: 'cutout', tiles: { top: 'sapling', bottom: 'sapling', side: 'sapling' }, solid: false, sound: 'plant', needsSupport: true, sway: true, category: 'Nature' },
  { key: 'tilled', name: 'Tilled Soil', hardness: 0.6, tool: 'shovel', shape: 'cube', layer: 'opaque', tiles: { top: 'tilled', bottom: 'dirt', side: 'dirt' }, solid: true, sound: 'dirt', drop: 'dirt' },
  { key: 'tilled_moist', name: 'Watered Soil', hardness: 0.6, tool: 'shovel', shape: 'cube', layer: 'opaque', tiles: { top: 'tilled_moist', bottom: 'dirt', side: 'dirt' }, solid: true, sound: 'dirt', drop: 'dirt' },
  { key: 'crop_wheat', natural: true, name: 'Sunwheat', hardness: 0.05, shape: 'cross', layer: 'cutout', tiles: { top: 'crop_wheat_0', bottom: 'crop_wheat_0', side: 'crop_wheat_0' }, solid: false, sound: 'plant', drop: 'sunwheat_seeds', needsSupport: true, sway: true, growth: { stages: 4, secondsPerStage: 90, harvest: 'sunwheat', harvestCount: [1, 3], seed: 'sunwheat_seeds' } },
  { key: 'crop_root', natural: true, name: 'Emberroot', hardness: 0.05, shape: 'cross', layer: 'cutout', tiles: { top: 'crop_root_0', bottom: 'crop_root_0', side: 'crop_root_0' }, solid: false, sound: 'plant', drop: 'emberroot', needsSupport: true, sway: true, growth: { stages: 4, secondsPerStage: 80, harvest: 'emberroot', harvestCount: [2, 4], seed: 'emberroot' } },
  { key: 'crop_gourd', natural: true, name: 'Puffgourd Vine', hardness: 0.05, shape: 'cross', layer: 'cutout', tiles: { top: 'crop_gourd_0', bottom: 'crop_gourd_0', side: 'crop_gourd_0' }, solid: false, sound: 'plant', drop: 'puffgourd_seeds', needsSupport: true, sway: true, growth: { stages: 4, secondsPerStage: 120, harvest: 'puffgourd', harvestCount: [1, 2], seed: 'puffgourd_seeds' } },
  { key: 'crop_mint', natural: true, name: 'Brookmint', hardness: 0.05, shape: 'cross', layer: 'cutout', tiles: { top: 'crop_mint_0', bottom: 'crop_mint_0', side: 'crop_mint_0' }, solid: false, sound: 'plant', drop: 'brookmint', needsSupport: true, sway: true, growth: { stages: 4, secondsPerStage: 60, harvest: 'brookmint', harvestCount: [1, 3], seed: 'brookmint' } },
  { key: 'workbench', name: 'Workbench', hardness: 2, tool: 'axe', shape: 'model', model: 'workbench', layer: 'cutout', solid: true, sound: 'wood', category: 'Crafting', interact: 'station', station: 'workbench', rotates: true, homestead: 5 },
  { key: 'stonecutter', name: 'Stone Cutter', hardness: 3, tool: 'pick', shape: 'model', model: 'stonecutter', layer: 'cutout', solid: true, sound: 'stone', category: 'Crafting', interact: 'station', station: 'stonecutter', rotates: true, homestead: 6, collisionHeight: 10 },
  { key: 'forge', name: 'Forge', hardness: 4, tool: 'pick', shape: 'model', model: 'forge', layer: 'cutout', solid: true, light: 9, lightColor: '#ff9a4a', sound: 'stone', category: 'Crafting', interact: 'station', station: 'forge', rotates: true, homestead: 10 },
  { key: 'cooking_fire', name: 'Cooking Fire', hardness: 1, tool: 'axe', shape: 'model', model: 'cooking_fire', layer: 'cutout', solid: false, light: 13, lightColor: '#ffa04d', sound: 'wood', category: 'Crafting', interact: 'station', station: 'cooking_fire', homestead: 4, comfort: 1 },
  { key: 'stone_oven', name: 'Stone Oven', hardness: 3, tool: 'pick', shape: 'model', model: 'stone_oven', layer: 'cutout', solid: true, light: 6, lightColor: '#ff8f40', sound: 'stone', category: 'Crafting', interact: 'station', station: 'stone_oven', rotates: true, homestead: 8, comfort: 1 },
  { key: 'carpentry_bench', name: 'Carpentry Bench', hardness: 2, tool: 'axe', shape: 'model', model: 'carpentry_bench', layer: 'cutout', solid: true, sound: 'wood', category: 'Crafting', interact: 'station', station: 'carpentry_bench', rotates: true, homestead: 8, collisionHeight: 13 },
  { key: 'crystal_bench', name: 'Crystal Bench', hardness: 4, tool: 'pick', shape: 'model', model: 'crystal_bench', layer: 'cutout', solid: true, light: 8, lightColor: '#9bf6ff', sound: 'glass', category: 'Crafting', interact: 'station', station: 'crystal_bench', rotates: true, homestead: 15 },
  { key: 'chest', name: 'Storage Chest', hardness: 2, tool: 'axe', shape: 'model', model: 'chest', layer: 'cutout', solid: true, sound: 'wood', category: 'Storage', interact: 'container', rotates: true, homestead: 3, collisionHeight: 13 },
  { key: 'bed', name: 'Cozy Cot', hardness: 1, tool: 'axe', shape: 'model', model: 'bed', layer: 'cutout', solid: true, sound: 'cloth', category: 'Furniture', interact: 'bed', rotates: true, homestead: 8, comfort: 3, collisionHeight: 9 },
  { key: 'table', name: 'Table', hardness: 1.5, tool: 'axe', shape: 'model', model: 'table', layer: 'cutout', solid: true, sound: 'wood', category: 'Furniture', homestead: 3, comfort: 1 },
  { key: 'chair', name: 'Chair', hardness: 1.2, tool: 'axe', shape: 'model', model: 'chair', layer: 'cutout', solid: true, sound: 'wood', category: 'Furniture', rotates: true, homestead: 2, comfort: 1, collisionHeight: 9, interact: 'sit' },
  { key: 'shelf', name: 'Wall Shelf', hardness: 1.2, tool: 'axe', shape: 'model', model: 'shelf', layer: 'cutout', solid: true, sound: 'wood', category: 'Decoration', rotates: true, homestead: 2, comfort: 1 },
  { key: 'cabinet', name: 'Cabinet', hardness: 1.5, tool: 'axe', shape: 'model', model: 'cabinet', layer: 'cutout', solid: true, sound: 'wood', category: 'Storage', interact: 'container', rotates: true, homestead: 3, comfort: 1 },
  { key: 'rug', name: 'Woven Rug', hardness: 0.3, shape: 'model', model: 'rug', layer: 'cutout', solid: false, sound: 'cloth', category: 'Decoration', homestead: 2, comfort: 1, needsSupport: true },
  { key: 'fireplace', name: 'Hearth', hardness: 3, tool: 'pick', shape: 'model', model: 'fireplace', layer: 'cutout', solid: true, light: 13, lightColor: '#ff9d55', sound: 'stone', category: 'Furniture', rotates: true, homestead: 10, comfort: 3 },
  { key: 'flower_pot', name: 'Flower Pot', hardness: 0.3, shape: 'model', model: 'flower_pot', layer: 'cutout', solid: false, sound: 'stone', category: 'Decoration', homestead: 2, comfort: 1 },
  { key: 'ice_box', name: 'Ice Box', hardness: 2, tool: 'pick', shape: 'model', model: 'ice_box', layer: 'cutout', solid: true, sound: 'metal', category: 'Storage', interact: 'container', rotates: true, homestead: 6, comfort: 1 },
  { key: 'water_barrel', name: 'Water Barrel', hardness: 1.5, tool: 'axe', shape: 'model', model: 'water_barrel', layer: 'cutout', solid: true, sound: 'wood', category: 'Storage', homestead: 3, comfort: 1, collisionHeight: 14 },
  { key: 'wind_lamp', name: 'Wind Lamp', hardness: 0.8, shape: 'model', model: 'wind_lamp', layer: 'cutout', solid: true, light: 12, lightColor: '#ffe2a0', sound: 'metal', category: 'Lighting', homestead: 3, comfort: 1 },
  { key: 'grinder', name: 'Grain Grinder', hardness: 2.5, tool: 'pick', shape: 'model', model: 'grinder', layer: 'cutout', solid: true, sound: 'stone', category: 'Crafting', interact: 'station', station: 'kitchen_table', homestead: 5, collisionHeight: 10 },
  { key: 'crystal_lantern', name: 'Crystal Lantern', hardness: 0.8, shape: 'model', model: 'crystal_lantern', layer: 'cutout', solid: true, light: 14, lightColor: '#a8f4ff', sound: 'glass', category: 'Lighting', homestead: 6, comfort: 2, collisionHeight: 11 },
  { key: 'lore_stone', natural: true, name: 'Whisper Stele', hardness: Infinity, shape: 'model', model: 'lore_stone', layer: 'cutout', solid: true, sound: 'stone', drop: null, interact: 'lore' },
  { key: 'shell', natural: true, name: 'Spiral Shell', hardness: 0.05, shape: 'model', model: 'shell', layer: 'cutout', solid: false, sound: 'glass', replaceable: true, needsSupport: true },
  { key: 'crystal_cluster', natural: true, name: 'Crystal Cluster', hardness: 1.2, tool: 'pick', shape: 'cross', layer: 'cutout', tiles: { top: 'crystal', bottom: 'crystal', side: 'crystal' }, solid: false, light: 10, lightColor: '#9ff3ff', sound: 'glass', drop: 'glow_crystal', needsSupport: true },
  { key: 'deepstone', natural: true, name: 'Deepstone', hardness: Infinity, shape: 'cube', layer: 'opaque', tiles: { top: 'deepstone', bottom: 'deepstone', side: 'deepstone' }, solid: true, sound: 'stone', drop: null },
  { key: 'mossy_fieldstone', name: 'Mossy Fieldstone', hardness: 4, tool: 'pick', shape: 'cube', layer: 'opaque', tiles: { top: 'mossy_fieldstone', bottom: 'fieldstone', side: 'mossy_fieldstone' }, solid: true, sound: 'stone', category: 'Structure', homestead: 1 },
  { key: 'dry_shrub', natural: true, name: 'Dry Shrub', hardness: 0.05, shape: 'cross', layer: 'cutout', tiles: { top: 'dry_shrub', bottom: 'dry_shrub', side: 'dry_shrub' }, solid: false, sound: 'plant', drop: 'stick', replaceable: true, needsSupport: true, sway: true },
  { key: 'plank_stairs', name: 'Board Stairs', hardness: 2, tool: 'axe', shape: 'model', model: 'stairs', layer: 'cutout', solid: true, sound: 'wood', category: 'Structure', rotates: true, homestead: 1 },
  { key: 'plank_slab', name: 'Board Slab', hardness: 1.5, tool: 'axe', shape: 'model', model: 'slab', layer: 'cutout', solid: true, sound: 'wood', category: 'Structure', homestead: 1, collisionHeight: 8 },
  { key: 'stone_slab', name: 'Fieldstone Slab', hardness: 3, tool: 'pick', shape: 'model', model: 'slab', modelTile: 'fieldstone', layer: 'cutout', solid: true, sound: 'stone', category: 'Structure', homestead: 1, collisionHeight: 8 },
  { key: 'roof_stairs', name: 'Thatch Roof Slope', hardness: 0.8, tool: 'axe', shape: 'model', model: 'stairs', modelTile: 'thatch', layer: 'cutout', solid: true, sound: 'plant', category: 'Structure', rotates: true, homestead: 1 },
  { key: 'fence', name: 'Picket Fence', hardness: 1.5, tool: 'axe', shape: 'fence', layer: 'cutout', solid: true, collisionHeight: 24, sound: 'wood', category: 'Structure', homestead: 1 },
  { key: 'door_lower', name: 'Cottage Door', hardness: 1.5, tool: 'axe', shape: 'model', model: 'door', layer: 'cutout', solid: true, sound: 'wood', category: 'Structure', interact: 'door', rotates: true, homestead: 3, drop: 'door' },
  { key: 'door_upper', name: 'Cottage Door', hardness: 1.5, tool: 'axe', shape: 'model', model: 'door', layer: 'cutout', solid: true, sound: 'wood', interact: 'door', rotates: true, drop: null },
  { key: 'window', name: 'Window Pane', hardness: 0.6, shape: 'model', model: 'pane', layer: 'cutout', solid: true, sound: 'glass', category: 'Structure', rotates: true, homestead: 2 },
  { key: 'snow', natural: true, name: 'Frost Cap', hardness: 0.6, tool: 'shovel', shape: 'cube', layer: 'opaque', tiles: { top: 'snow', bottom: 'dirt', side: 'snow' }, solid: true, sound: 'sand', drop: 'dirt' },
  { key: 'leaf_litter', natural: true, name: 'Forest Floor', hardness: 0.7, tool: 'shovel', shape: 'cube', layer: 'opaque', tiles: { top: 'leaf_litter', bottom: 'dirt', side: 'grass_side' }, tint: 'grass', solid: true, sound: 'dirt', drop: 'dirt' },
  { key: 'kitchen_table', name: 'Kitchen Table', hardness: 1.5, tool: 'axe', shape: 'model', model: 'kitchen_table', layer: 'cutout', solid: true, sound: 'wood', category: 'Crafting', interact: 'station', station: 'kitchen_table', rotates: true, homestead: 6, comfort: 1 },

  // ---------------------------------------------------------------- architecture (Build Home + modern building)
  // Material/colour lives in meta (data/architecture.ts), so one block id covers every paint colour.
  { key: 'arch_block', name: 'Architectural Block', hardness: 1.8, tool: 'pick', shape: 'cube', layer: 'opaque', tiles: { top: 'plaster', bottom: 'plaster', side: 'plaster' }, solid: true, sound: 'stone', drop: null, category: 'Structure', arch: { kind: 'cube', model: 'cube' }, homestead: 1 },
  { key: 'arch_glass', name: 'Glass Wall', hardness: 0.6, shape: 'cube', layer: 'glass', tiles: { top: 'glass_pane', bottom: 'glass_pane', side: 'glass_pane' }, solid: true, sound: 'glass', drop: null, category: 'Structure', arch: { kind: 'cube', model: 'glass' }, homestead: 1 },
  { key: 'arch_slab', name: 'Slab', hardness: 1.4, tool: 'pick', shape: 'arch', layer: 'opaque', solid: true, sound: 'stone', drop: null, category: 'Structure', arch: { kind: 'slab', model: 'slab' } },
  { key: 'arch_stairs', name: 'Stairs', hardness: 1.4, tool: 'pick', shape: 'arch', layer: 'opaque', solid: true, sound: 'stone', drop: null, category: 'Structure', rotates: true, arch: { kind: 'rotated', model: 'stairs' } },
  { key: 'arch_stairs_float', name: 'Floating Stairs', hardness: 1.2, tool: 'axe', shape: 'arch', layer: 'opaque', solid: true, sound: 'wood', drop: null, category: 'Structure', rotates: true, arch: { kind: 'rotated', model: 'stairs_float' } },
  { key: 'arch_slope', name: 'Roof Slope', hardness: 1.2, tool: 'pick', shape: 'arch', layer: 'opaque', solid: true, sound: 'stone', drop: null, category: 'Structure', rotates: true, arch: { kind: 'rotated', model: 'slope' } },
  { key: 'arch_slope_outer', name: 'Roof Outer Corner', hardness: 1.2, tool: 'pick', shape: 'arch', layer: 'opaque', solid: true, sound: 'stone', drop: null, category: 'Structure', rotates: true, arch: { kind: 'rotated', model: 'slope_outer' } },
  { key: 'arch_slope_inner', name: 'Roof Inner Corner', hardness: 1.2, tool: 'pick', shape: 'arch', layer: 'opaque', solid: true, sound: 'stone', drop: null, category: 'Structure', rotates: true, arch: { kind: 'rotated', model: 'slope_inner' } },
  { key: 'arch_column', name: 'Square Column', hardness: 1.6, tool: 'pick', shape: 'arch', layer: 'opaque', solid: true, sound: 'stone', drop: null, category: 'Structure', arch: { kind: 'rotated', model: 'column' } },
  { key: 'arch_column_round', name: 'Round Column', hardness: 1.6, tool: 'pick', shape: 'arch', layer: 'opaque', solid: true, sound: 'stone', drop: null, category: 'Structure', arch: { kind: 'rotated', model: 'column_round' } },
  { key: 'arch_beam', name: 'Beam', hardness: 1.4, tool: 'axe', shape: 'arch', layer: 'opaque', solid: true, sound: 'wood', drop: null, category: 'Structure', arch: { kind: 'rotated', model: 'beam' } },
  { key: 'arch_panel_h', name: 'Thin Panel', hardness: 0.8, shape: 'arch', layer: 'opaque', solid: true, sound: 'stone', drop: null, category: 'Structure', arch: { kind: 'panel_h', model: 'panel_h' } },
  { key: 'arch_panel_v', name: 'Wall Panel', hardness: 0.8, shape: 'arch', layer: 'opaque', solid: true, sound: 'stone', drop: null, category: 'Structure', rotates: true, arch: { kind: 'rotated', model: 'panel_v' } },
  { key: 'arch_baseboard', name: 'Baseboard', hardness: 0.3, shape: 'arch', layer: 'opaque', solid: false, sound: 'wood', drop: null, category: 'Decoration', rotates: true, arch: { kind: 'rotated', model: 'baseboard' } },
  { key: 'arch_crown', name: 'Ceiling Trim', hardness: 0.3, shape: 'arch', layer: 'opaque', solid: false, sound: 'wood', drop: null, category: 'Decoration', rotates: true, arch: { kind: 'rotated', model: 'crown' } },
  { key: 'arch_railing_glass', name: 'Glass Railing', hardness: 0.8, shape: 'arch', layer: 'opaque', solid: true, sound: 'glass', drop: null, category: 'Structure', rotates: true, arch: { kind: 'rotated', model: 'railing_glass' } },
  { key: 'arch_railing_bars', name: 'Modern Railing', hardness: 0.8, shape: 'arch', layer: 'opaque', solid: true, sound: 'metal', drop: null, category: 'Structure', rotates: true, arch: { kind: 'rotated', model: 'railing_bars' } },
  { key: 'arch_fence', name: 'Modern Fence', hardness: 1, shape: 'arch', layer: 'opaque', solid: true, collisionHeight: 24, sound: 'wood', drop: null, category: 'Structure', arch: { kind: 'cube', model: 'fence_rail' } },
  { key: 'arch_fence_glass', name: 'Glass Fence', hardness: 1, shape: 'arch', layer: 'opaque', solid: true, collisionHeight: 24, sound: 'glass', drop: null, category: 'Structure', arch: { kind: 'cube', model: 'fence_glass' } },
  { key: 'arch_wall_low', name: 'Garden Wall', hardness: 2, tool: 'pick', shape: 'arch', layer: 'opaque', solid: true, sound: 'stone', drop: null, category: 'Structure', arch: { kind: 'cube', model: 'wall_low' } },
  { key: 'hedge', name: 'Hedge', hardness: 0.4, shape: 'cube', layer: 'opaque', tiles: { top: 'hedge', bottom: 'hedge', side: 'hedge' }, solid: true, sound: 'plant', category: 'Nature', homestead: 1 },
  { key: 'hedge_low', name: 'Low Hedge', hardness: 0.3, shape: 'model', model: 'hedge_low', layer: 'cutout', solid: true, collisionHeight: 10, sound: 'plant', category: 'Nature' },
  { key: 'arch_slope_low1', name: 'Low Roof Slope (lower half)', hardness: 1.2, tool: 'pick', shape: 'arch', layer: 'opaque', solid: true, sound: 'stone', drop: null, category: 'Structure', rotates: true, arch: { kind: 'rotated', model: 'slope_low1' } },
  { key: 'arch_slope_low2', name: 'Low Roof Slope (upper half)', hardness: 1.2, tool: 'pick', shape: 'arch', layer: 'opaque', solid: true, sound: 'stone', drop: null, category: 'Structure', rotates: true, arch: { kind: 'rotated', model: 'slope_low2' } },
  { key: 'fence_gate', name: 'Garden Gate', hardness: 1.5, tool: 'axe', shape: 'model', model: 'gate', layer: 'cutout', solid: true, collisionHeight: 24, sound: 'wood', category: 'Structure', interact: 'door', rotates: true, homestead: 2 },

  // ---------------------------------------------------------------- farming expansion (append-only ids)
  { key: 'crop_corn', natural: true, name: 'Skycorn', hardness: 0.05, shape: 'cross', layer: 'cutout', tiles: { top: 'crop_corn_0', bottom: 'crop_corn_0', side: 'crop_corn_0' }, solid: false, sound: 'plant', drop: 'skycorn_seeds', needsSupport: true, sway: true, growth: { stages: 4, secondsPerStage: 100, harvest: 'skycorn', harvestCount: [1, 3], seed: 'skycorn_seeds' } },
  { key: 'crop_tomato', natural: true, name: 'Blushberry Vine', hardness: 0.05, shape: 'cross', layer: 'cutout', tiles: { top: 'crop_tomato_0', bottom: 'crop_tomato_0', side: 'crop_tomato_0' }, solid: false, sound: 'plant', drop: 'blushberry', needsSupport: true, sway: true, growth: { stages: 4, secondsPerStage: 90, harvest: 'blushberry', harvestCount: [2, 4], seed: 'blushberry' } },
  { key: 'hay_bale', name: 'Hay Bale', hardness: 0.6, shape: 'cube', layer: 'opaque', tiles: { top: 'hay_top', bottom: 'hay_top', side: 'hay_side' }, solid: true, sound: 'plant', category: 'Decoration', homestead: 1, comfort: 0, description: 'A tight bundle of golden Sunwheat straw. Cosy farm decor.' },
];
