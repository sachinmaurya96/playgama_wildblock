import type { StationKind } from './blocks';
import { CREATURE_MEAT } from './creatureFood';

export type RecipeCategory = 'Tools' | 'Weapons' | 'Armor' | 'Building' | 'Furniture' | 'Storage' | 'Lighting' | 'Cooking' | 'Farming' | 'Utility' | 'Exploration';

export const RECIPE_CATEGORIES: RecipeCategory[] = ['Tools', 'Weapons', 'Armor', 'Building', 'Furniture', 'Storage', 'Lighting', 'Cooking', 'Farming', 'Utility', 'Exploration'];

export interface Ingredient {
  item: string;
  count: number;
}

export interface Recipe {
  id: string;
  output: Ingredient;
  inputs: Ingredient[];
  /** null = can be crafted anywhere from the backpack. */
  station: StationKind | null;
  category: RecipeCategory;
  /** Homestead level required (default 1). */
  homestead?: number;
}

export const STATION_NAMES: Record<StationKind, string> = {
  workbench: 'Workbench',
  stonecutter: 'Stone Cutter',
  forge: 'Forge',
  cooking_fire: 'Cooking Fire',
  stone_oven: 'Stone Oven',
  kitchen_table: 'Kitchen Table',
  carpentry_bench: 'Carpentry Bench',
  crystal_bench: 'Crystal Bench',
};

const i = (item: string, count = 1): Ingredient => ({ item, count });
let n = 0;
const r = (
  output: Ingredient, inputs: Ingredient[], station: StationKind | null, category: RecipeCategory, homestead?: number,
): Recipe => ({ id: `${output.item}#${n++}`, output, inputs, station, category, homestead });

/**
 * WildBlocks uses a recipe book (pick a recipe, press Craft) rather than a
 * shaped grid. Order within a category is the display order.
 */
const ARMOR_COST = [[4, 1], [7, 2], [6, 1], [3, 1]] as const; // helmet, chest, legs, boots: [main, binder]
const ARMOR_KEYS = ['helmet', 'chestplate', 'leggings', 'boots'];
function armorRecipes(set: string, main: string, binder: string, station: StationKind, homestead?: number): Recipe[] {
  return ARMOR_KEYS.map((k, idx) => {
    const [m, b] = ARMOR_COST[idx];
    return r(i(`${set}_${k}`), [i(main, m), i(binder, b)], station, 'Armor', homestead);
  });
}

export const RECIPES: Recipe[] = [
  // ---------------------------------------------------------------- anywhere (backpack crafting)
  r(i('planks', 4), [i('log')], null, 'Building'),
  r(i('birch_planks', 4), [i('birch_log')], null, 'Building'),
  r(i('stick', 4), [i('planks', 2)], null, 'Tools'),
  r(i('rope'), [i('fiber', 3)], null, 'Exploration'),
  r(i('torch', 2), [i('stick'), i('fiber', 2)], null, 'Lighting'),
  r(i('torch', 4), [i('stick'), i('emberite')], null, 'Lighting'),
  r(i('scrap_axe'), [i('stick', 2), i('planks', 2), i('rope')], null, 'Tools'),
  r(i('scrap_pick'), [i('stick', 2), i('planks', 3), i('rope')], null, 'Tools'),
  r(i('wood_club'), [i('log'), i('rope')], null, 'Weapons'),
  r(i('wood_sword'), [i('planks', 2), i('stick')], null, 'Weapons'),
  r(i('workbench'), [i('planks', 6), i('log')], null, 'Utility'),
  r(i('cooking_fire'), [i('log', 2), i('stick', 3)], null, 'Cooking'),
  r(i('fruit_bowl'), [i('bramble_berries', 3), i('sunapple')], null, 'Cooking'),
  r(i('skycorn_seeds', 3), [i('skycorn')], null, 'Farming'),
  r(i('garden_salad'), [i('blushberry', 2), i('brookmint'), i('emberroot')], null, 'Cooking'),

  // ---------------------------------------------------------------- workbench
  r(i('scrap_shovel'), [i('stick', 2), i('planks'), i('rope')], 'workbench', 'Tools'),
  r(i('scrap_hoe'), [i('stick', 2), i('planks', 2)], 'workbench', 'Farming'),
  r(i('stone_hammer'), [i('stick', 2), i('fieldstone', 3), i('rope')], 'workbench', 'Weapons'),
  r(i('stone_sword'), [i('fieldstone', 2), i('stick'), i('rope')], 'workbench', 'Weapons'),
  r(i('boat'), [i('planks', 5), i('rope', 2)], 'workbench', 'Exploration'),
  r(i('hay_bale'), [i('sunwheat', 6)], 'workbench', 'Farming'),
  r(i('chest'), [i('planks', 8)], 'workbench', 'Storage'),
  r(i('door'), [i('planks', 6)], 'workbench', 'Building'),
  r(i('fence_gate'), [i('planks', 2), i('stick', 4)], 'workbench', 'Building'),
  r(i('plank_stairs', 4), [i('planks', 6)], 'workbench', 'Building'),
  r(i('plank_slab', 6), [i('planks', 3)], 'workbench', 'Building'),
  r(i('fence', 4), [i('planks', 2), i('stick', 4)], 'workbench', 'Building'),
  r(i('thatch', 2), [i('fiber', 4)], 'workbench', 'Building'),
  r(i('roof_stairs', 4), [i('thatch', 6)], 'workbench', 'Building'),
  r(i('bed'), [i('planks', 4), i('fiber', 10)], 'workbench', 'Furniture'),
  r(i('table'), [i('planks', 5)], 'workbench', 'Furniture'),
  r(i('chair'), [i('planks', 3), i('stick', 2)], 'workbench', 'Furniture'),
  r(i('stonecutter'), [i('fieldstone', 8), i('planks', 2)], 'workbench', 'Utility'),
  r(i('forge'), [i('fieldstone', 12), i('clay_lump', 6)], 'workbench', 'Utility'),
  r(i('carpentry_bench'), [i('planks', 10), i('log', 2), i('rope', 2)], 'workbench', 'Utility', 2),
  r(i('explorer_pack'), [i('rope', 4), i('fiber', 10), i('stick', 2)], 'workbench', 'Exploration'),
  r(i('trail_boots'), [i('fiber', 6), i('rope', 2), i('puff_fluff', 2)], 'workbench', 'Exploration'),
  r(i('moss_vest'), [i('moss_fleece', 4), i('rope', 2)], 'workbench', 'Exploration'),
  r(i('wayfarer_hood'), [i('twig_feather', 2), i('fiber', 6), i('moss_fleece')], 'workbench', 'Exploration'),
  r(i('stone_vest'), [i('stone_plate', 4), i('moss_vest')], 'workbench', 'Exploration', 2),
  r(i('trail_mix', 2), [i('bramble_berries', 2), i('coconut')], 'workbench', 'Cooking'),
  r(i('hedge', 2), [i('sapling'), i('fiber', 4)], 'workbench', 'Farming'),
  r(i('hedge_low', 2), [i('hedge')], 'workbench', 'Farming'),

  // ---------------------------------------------------------------- stone cutter
  r(i('mossy_fieldstone', 2), [i('fieldstone', 2), i('fiber')], 'stonecutter', 'Building'),
  r(i('stone_slab', 6), [i('fieldstone', 3)], 'stonecutter', 'Building'),
  r(i('amber_banded', 2), [i('amberstone', 2)], 'stonecutter', 'Building'),
  r(i('cut_stone', 2), [i('fieldstone', 2)], 'stonecutter', 'Building'),
  r(i('stone_stairs', 4), [i('cut_stone', 6)], 'stonecutter', 'Building'),
  r(i('stone_column', 2), [i('cut_stone', 3)], 'stonecutter', 'Building'),
  r(i('plaster_wall', 4), [i('clay_lump', 2), i('sand', 2)], 'stonecutter', 'Building'),
  r(i('concrete_block', 4), [i('gravel', 2), i('sand', 2), i('fieldstone')], 'stonecutter', 'Building'),
  r(i('garden_wall', 4), [i('fieldstone', 4)], 'stonecutter', 'Building'),
  r(i('clay_roof', 4), [i('brick', 3), i('clay_lump')], 'stonecutter', 'Building'),
  r(i('flower_pot'), [i('clay_lump', 3)], 'stonecutter', 'Furniture'),
  r(i('grinder'), [i('fieldstone', 6), i('planks', 2)], 'stonecutter', 'Utility'),
  r(i('stone_oven'), [i('fieldstone', 10), i('brick', 4)], 'stonecutter', 'Cooking', 3),
  r(i('fireplace'), [i('brick', 12), i('fieldstone', 4)], 'stonecutter', 'Furniture', 3),

  // ---------------------------------------------------------------- forge
  r(i('copper_ingot'), [i('raw_copper'), i('emberite')], 'forge', 'Tools'),
  r(i('tempered_ingot'), [i('raw_ferra', 2), i('copper_ingot'), i('emberite', 2)], 'forge', 'Tools'),
  r(i('glass', 2), [i('sand', 4), i('emberite')], 'forge', 'Building'),
  r(i('glass_wall', 2), [i('glass', 2)], 'forge', 'Building'),
  r(i('glass_railing', 2), [i('glass'), i('copper_ingot')], 'forge', 'Building'),
  r(i('brick', 4), [i('clay_lump', 4), i('emberite')], 'forge', 'Building'),
  r(i('copper_axe'), [i('copper_ingot', 3), i('stick', 2)], 'forge', 'Tools'),
  r(i('copper_pick'), [i('copper_ingot', 3), i('stick', 2)], 'forge', 'Tools'),
  r(i('copper_shovel'), [i('copper_ingot'), i('stick', 2)], 'forge', 'Tools'),
  r(i('copper_hoe'), [i('copper_ingot', 2), i('stick', 2)], 'forge', 'Farming'),
  r(i('copper_spear'), [i('copper_ingot', 2), i('stick', 3), i('rope')], 'forge', 'Weapons'),
  r(i('copper_sword'), [i('copper_ingot', 2), i('stick')], 'forge', 'Weapons'),
  r(i('watering_can'), [i('copper_ingot', 3)], 'forge', 'Farming'),
  r(i('tempered_axe'), [i('tempered_ingot', 3), i('stick', 2)], 'forge', 'Tools'),
  r(i('tempered_pick'), [i('tempered_ingot', 3), i('stick', 2)], 'forge', 'Tools'),
  r(i('tempered_shovel'), [i('tempered_ingot'), i('stick', 2)], 'forge', 'Tools'),
  r(i('tempered_blade'), [i('tempered_ingot', 3), i('stick'), i('rope')], 'forge', 'Weapons'),
  r(i('lantern', 2), [i('copper_ingot'), i('torch'), i('glass')], 'forge', 'Lighting'),
  r(i('wind_lamp'), [i('copper_ingot'), i('planks', 2), i('torch')], 'forge', 'Lighting'),
  r(i('ice_box'), [i('copper_ingot', 4), i('planks', 4), i('glow_crystal')], 'forge', 'Storage', 2),
  r(i('crystal_bench'), [i('glow_crystal', 8), i('amberstone', 6), i('tempered_ingot', 2)], 'forge', 'Utility', 4),

  // ---------------------------------------------------------------- carpentry bench
  r(i('shelf'), [i('planks', 4), i('stick', 2)], 'carpentry_bench', 'Furniture', 2),
  r(i('cabinet'), [i('planks', 8), i('copper_ingot')], 'carpentry_bench', 'Storage', 2),
  r(i('rug'), [i('fiber', 8), i('puff_fluff', 2)], 'carpentry_bench', 'Furniture', 2),
  r(i('kitchen_table'), [i('planks', 6), i('fieldstone', 2)], 'carpentry_bench', 'Cooking', 2),
  r(i('window', 2), [i('glass'), i('stick', 2)], 'carpentry_bench', 'Building', 2),
  r(i('water_barrel'), [i('planks', 6), i('rope', 2)], 'carpentry_bench', 'Storage', 2),
  r(i('oak_floor', 4), [i('planks', 3)], 'carpentry_bench', 'Building', 2),
  r(i('wood_cladding', 4), [i('planks', 3)], 'carpentry_bench', 'Building', 2),
  r(i('wood_beam', 2), [i('log')], 'carpentry_bench', 'Building', 2),
  r(i('shingle_roof', 4), [i('planks', 2), i('flint')], 'carpentry_bench', 'Building', 2),
  r(i('modern_fence', 4), [i('birch_planks', 2), i('stick', 2)], 'carpentry_bench', 'Building', 2),

  // ---------------------------------------------------------------- cooking fire
  r(i('roasted_roots'), [i('emberroot', 3)], 'cooking_fire', 'Cooking'),
  r(i('roasted_skycorn', 2), [i('skycorn', 2)], 'cooking_fire', 'Cooking'),
  r(i('mushroom_soup'), [i('mushroom', 3), i('brookmint')], 'cooking_fire', 'Cooking'),
  r(i('mint_tea'), [i('brookmint', 2)], 'cooking_fire', 'Cooking'),

  // ---------------------------------------------------------------- kitchen (grinder / kitchen table)
  r(i('flour'), [i('sunwheat', 3)], 'kitchen_table', 'Cooking'),
  r(i('glow_jam'), [i('bramble_berries', 4), i('glow_crystal')], 'kitchen_table', 'Cooking', 2),

  // ---------------------------------------------------------------- stone oven
  r(i('sunbread'), [i('flour', 2)], 'stone_oven', 'Cooking', 3),
  r(i('berry_pie'), [i('flour'), i('bramble_berries', 4)], 'stone_oven', 'Cooking', 3),
  r(i('gourd_stew'), [i('puffgourd'), i('emberroot', 2), i('brookmint')], 'stone_oven', 'Cooking', 3),

  // ---------------------------------------------------------------- crystal bench
  r(i('crystal_axe'), [i('glow_crystal', 6), i('tempered_ingot', 2), i('stick', 2)], 'crystal_bench', 'Tools', 4),
  r(i('crystal_pick'), [i('glow_crystal', 6), i('tempered_ingot', 2), i('stick', 2)], 'crystal_bench', 'Tools', 4),
  r(i('crystal_blade'), [i('glow_crystal', 8), i('moonstone'), i('tempered_ingot', 2)], 'crystal_bench', 'Weapons', 4),
  r(i('crystal_lantern', 2), [i('glow_crystal', 3), i('copper_ingot')], 'crystal_bench', 'Lighting', 4),

  // ---------------------------------------------------------------- farming extras
  r(i('sunwheat_seeds', 2), [i('sunwheat')], null, 'Farming'),
  r(i('puffgourd_seeds', 3), [i('puffgourd')], null, 'Farming'),
  r(i('sapling'), [i('stick', 2), i('fiber', 2), i('sunapple')], 'workbench', 'Farming'),

  // ---------------------------------------------------------------- armory
  r(i('arrow', 6), [i('stick', 2), i('flint'), i('fiber', 2)], null, 'Weapons'),
  r(i('arrow', 10), [i('stick', 2), i('dusk_fang'), i('fiber', 2)], null, 'Weapons'),
  r(i('hunter_bow'), [i('stick', 3), i('rope', 3)], 'workbench', 'Weapons'),
  r(i('crystal_bow'), [i('glow_crystal', 4), i('moonstone'), i('rope', 2)], 'crystal_bench', 'Weapons', 4),
  r(i('wood_shield'), [i('planks', 6), i('rope')], 'workbench', 'Armor'),
  r(i('copper_shield'), [i('copper_ingot', 4), i('planks', 2)], 'forge', 'Armor'),
  r(i('tempered_shield'), [i('tempered_ingot', 4), i('planks', 2)], 'forge', 'Armor'),
  r(i('crystal_shield'), [i('glow_crystal', 5), i('tempered_ingot', 2)], 'crystal_bench', 'Armor', 4),
  ...armorRecipes('thorn', 'thorn', 'rope', 'workbench'),
  ...armorRecipes('gloom', 'gloom_hide', 'rope', 'workbench'),
  ...armorRecipes('copper', 'copper_ingot', 'rope', 'forge'),
  ...armorRecipes('tempered', 'tempered_ingot', 'copper_ingot', 'forge'),
  ...armorRecipes('crystal', 'glow_crystal', 'tempered_ingot', 'crystal_bench', 4),

  // Append new recipes so existing recipe IDs remain stable in saved worlds.
  ...CREATURE_MEAT.map(([kind]) => r(i(`cooked_${kind}_meat`), [i(`raw_${kind}_meat`)], 'cooking_fire', 'Cooking')),
  r(i('arrow', 6), [i('stick', 2), i('bone'), i('fiber', 2)], null, 'Weapons'),
];

/** Which block provides each station (for the validator and "where do I craft this?" hints). */
export const STATION_BLOCKS: Record<StationKind, string[]> = {
  workbench: ['workbench'],
  stonecutter: ['stonecutter'],
  forge: ['forge'],
  cooking_fire: ['cooking_fire'],
  stone_oven: ['stone_oven'],
  kitchen_table: ['kitchen_table', 'grinder'],
  carpentry_bench: ['carpentry_bench'],
  crystal_bench: ['crystal_bench'],
};
