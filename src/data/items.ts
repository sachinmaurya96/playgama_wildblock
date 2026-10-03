import { BLOCK_DEFS } from './blocks';
import { archIndex, archMeta } from './architecture';
import type { ToolKind } from './blocks';

export type ItemCategory = 'block' | 'material' | 'tool' | 'weapon' | 'food' | 'seed' | 'equipment' | 'misc';
export type EquipSlot = 'head' | 'body' | 'legs' | 'feet' | 'offhand' | 'pack';
export type BuffId = 'swift' | 'sturdy' | 'well_fed' | 'hearty' | 'well_rested' | 'glowsight';

export interface ToolStats {
  kind: ToolKind | 'hand';
  tier: number;
  /** Break-speed multiplier on matching blocks. */
  speed: number;
  durability: number;
  damage: number;
  /** Swords: each swing also sweeps other hostiles in front of you. */
  sweep?: boolean;
}

export interface FoodStats {
  vitality: number;
  energy: number;
  buff?: { id: BuffId; seconds: number };
}

/** Procedural icon recipe (drawn by IconPainter — no image files needed). */
export interface DrawIcon {
  shape:
    | 'stick' | 'fiber' | 'rope' | 'nugget' | 'ingot' | 'gem' | 'fleece' | 'feather' | 'thorn' | 'wisp' | 'plate' | 'shell'
    | 'seed' | 'berry' | 'apple' | 'coconut' | 'root' | 'herb' | 'gourd' | 'grain' | 'flour' | 'mushroom' | 'bowl' | 'pie'
    | 'bread' | 'mug' | 'mix' | 'axe' | 'pick' | 'shovel' | 'hoe' | 'club' | 'hammer' | 'spear' | 'blade' | 'can'
    | 'pack' | 'boots' | 'vest' | 'hood' | 'flint' | 'clay' | 'sword' | 'boat' | 'corn' | 'tomato' | 'hay'
    | 'helmet' | 'chest' | 'leggings' | 'shield' | 'bow' | 'arrow' | 'hide' | 'fang';
  colors: string[];
}

export interface ItemDef {
  key: string;
  name: string;
  category: ItemCategory;
  maxStack: number;
  description: string;
  /** Places this block on right click. */
  placeBlock?: string;
  /** Block meta written on placement (architecture material index etc.). */
  placeMeta?: number;
  /** Plants this crop block on tilled soil. */
  plantsCrop?: string;
  tool?: ToolStats;
  food?: FoodStats;
  equip?: {
    slot: EquipSlot; defense?: number; speed?: number; slots?: number;
    /** Armor set id (wearing all four pieces of one set gives a bonus). */
    set?: string;
    /** Shields: chance to block a hit coming from in front of you. */
    block?: number;
  };
  /** Bows: arrows fly with this damage & launch speed (needs Arrows in the backpack). */
  ranged?: { damage: number; speed: number; cooldown: number };
  icon: { block: string; meta?: number } | DrawIcon;
  /** Journal section the item unlocks when first collected. */
  journal?: 'plants' | 'materials';
}

const tool = (kind: ToolKind, tier: number, speed: number, durability: number, damage: number): ToolStats => ({ kind, tier, speed, durability, damage });
const sword = (tier: number, durability: number, damage: number): ToolStats => ({ ...tool('weapon', tier, 1, durability, damage), sweep: true });

const TIER_COLORS = ['#9a8f7c', '#d9814a', '#8fb2c9', '#86f0ff'];
const TIER_NAMES = ['Scrap', 'Copper', 'Tempered', 'Crystal'];
const TIER_KEYS = ['scrap', 'copper', 'tempered', 'crystal'];
const TIER_STATS = [
  { speed: 2.2, dur: 70 },
  { speed: 3.6, dur: 200 },
  { speed: 5.2, dur: 450 },
  { speed: 7.5, dur: 1100 },
];

const HAND_ITEMS: ItemDef[] = [
  // ---------------------------------------------------------------- materials
  { key: 'stick', name: 'Stick', category: 'material', maxStack: 64, description: 'A sturdy twig. The start of most things.', icon: { shape: 'stick', colors: ['#8a5a32', '#6b4424'] }, journal: 'materials' },
  { key: 'fiber', name: 'Plant Fiber', category: 'material', maxStack: 64, description: 'Stringy grass fibre. Twist it into rope.', icon: { shape: 'fiber', colors: ['#9cc46a', '#6f9a45'] }, journal: 'plants' },
  { key: 'rope', name: 'Rope', category: 'material', maxStack: 64, description: 'Braided fibre that binds tools and packs together.', icon: { shape: 'rope', colors: ['#c9a66b', '#8f6f3e'] }, journal: 'materials' },
  { key: 'flint', name: 'Flint Chip', category: 'material', maxStack: 64, description: 'A sharp dark stone found in gravel.', icon: { shape: 'flint', colors: ['#5d5f66', '#8a8d96'] }, journal: 'materials' },
  { key: 'clay_lump', name: 'Clay Lump', category: 'material', maxStack: 64, description: 'Soft river clay. Fire it into bricks.', icon: { shape: 'clay', colors: ['#b8a193', '#8f7a6d'] }, journal: 'materials' },
  { key: 'raw_copper', name: 'Raw Copper', category: 'material', maxStack: 64, description: 'Orange-green ore. Smelt it at a Forge.', icon: { shape: 'nugget', colors: ['#d9814a', '#5fa88b'] }, journal: 'materials' },
  { key: 'copper_ingot', name: 'Copper Ingot', category: 'material', maxStack: 64, description: 'Warm, easy-to-work metal.', icon: { shape: 'ingot', colors: ['#e0874d', '#a85a2c'] }, journal: 'materials' },
  { key: 'raw_ferra', name: 'Raw Ferra', category: 'material', maxStack: 64, description: 'Heavy blue-grey ore from deeper stone.', icon: { shape: 'nugget', colors: ['#8fb2c9', '#4f6475'] }, journal: 'materials' },
  { key: 'tempered_ingot', name: 'Tempered Alloy', category: 'material', maxStack: 64, description: 'Ferra folded with copper. Tough and springy.', icon: { shape: 'ingot', colors: ['#a9c3d6', '#607c92'] }, journal: 'materials' },
  { key: 'emberite', name: 'Emberite', category: 'material', maxStack: 64, description: 'A warm red mineral that burns slowly. Great fuel.', icon: { shape: 'nugget', colors: ['#e2553a', '#7a2a1e'] }, journal: 'materials' },
  { key: 'glow_crystal', name: 'Glow Crystal', category: 'material', maxStack: 64, description: 'Softly shining crystal. It hums when held.', icon: { shape: 'gem', colors: ['#86f0ff', '#3fb3d6'] }, journal: 'materials' },
  { key: 'moonstone', name: 'Moonstone', category: 'material', maxStack: 64, description: 'Pale stone that holds a little of the night sky.', icon: { shape: 'gem', colors: ['#d9d4ff', '#8f86d6'] }, journal: 'materials' },
  { key: 'moss_fleece', name: 'Moss Fleece', category: 'material', maxStack: 64, description: 'Soft green fleece shed by a happy Mossback.', icon: { shape: 'fleece', colors: ['#7fae5a', '#4f7a38'] }, journal: 'materials' },
  { key: 'puff_fluff', name: 'Puff Fluff', category: 'material', maxStack: 64, description: 'Cloud-light fluff from a Pufftail.', icon: { shape: 'fleece', colors: ['#f6efe6', '#d8cdbf'] }, journal: 'materials' },
  { key: 'twig_feather', name: 'Twiglet Feather', category: 'material', maxStack: 64, description: 'A striped feather, gifted not taken.', icon: { shape: 'feather', colors: ['#e0a94f', '#7b5a36'] }, journal: 'materials' },
  { key: 'thorn', name: 'Crawler Thorn', category: 'material', maxStack: 64, description: 'A hard spine left behind by a Thorncrawler.', icon: { shape: 'thorn', colors: ['#6f8a3a', '#3f5222'] }, journal: 'materials' },
  { key: 'shadow_wisp', name: 'Shadow Wisp', category: 'material', maxStack: 64, description: 'A curl of cool darkness from a Nightling.', icon: { shape: 'wisp', colors: ['#4b3f7a', '#a99bff'] }, journal: 'materials' },
  { key: 'stone_plate', name: 'Stone Plate', category: 'material', maxStack: 64, description: 'A shed armour plate from a Stoneback.', icon: { shape: 'plate', colors: ['#8d8a82', '#5e5b55'] }, journal: 'materials' },
  { key: 'mite_shell', name: 'Mite Shell', category: 'material', maxStack: 64, description: 'Glossy shell fragment from a Cave Mite.', icon: { shape: 'shell', colors: ['#5b6f8a', '#9fd0ff'] }, journal: 'materials' },
  { key: 'snapper_scale', name: 'Snapper Scale', category: 'material', maxStack: 64, description: 'A slick scale from a Bog Snapper.', icon: { shape: 'plate', colors: ['#4f8a6a', '#2b5240'] }, journal: 'materials' },
  { key: 'flour', name: 'Sunwheat Flour', category: 'material', maxStack: 64, description: 'Ground grain for baking.', icon: { shape: 'flour', colors: ['#f3e6c4', '#c9ad73'] } },
  { key: 'sunwheat', name: 'Sunwheat', category: 'material', maxStack: 64, description: 'Golden grain. Grind it into flour.', icon: { shape: 'grain', colors: ['#e7c35a', '#b88f2e'] }, journal: 'plants' },

  // ---------------------------------------------------------------- seeds
  { key: 'grass_seeds', name: 'Wild Seeds', category: 'seed', maxStack: 64, description: 'Mixed meadow seeds. Plant on tilled soil to grow Sunwheat.', plantsCrop: 'crop_wheat', icon: { shape: 'seed', colors: ['#b59a5a', '#7d6a3b'] }, journal: 'plants' },
  { key: 'sunwheat_seeds', name: 'Sunwheat Seeds', category: 'seed', maxStack: 64, description: 'Plant on tilled soil.', plantsCrop: 'crop_wheat', icon: { shape: 'seed', colors: ['#e7c35a', '#9a7a2e'] } },
  { key: 'skycorn_seeds', name: 'Skycorn Kernels', category: 'seed', maxStack: 64, description: 'Plant on tilled soil to grow tall Skycorn. Sometimes found in tall grass.', plantsCrop: 'crop_corn', icon: { shape: 'seed', colors: ['#f2cf4a', '#b8902e'] }, journal: 'plants' },
  { key: 'puffgourd_seeds', name: 'Puffgourd Seeds', category: 'seed', maxStack: 64, description: 'Plant on tilled soil. Grows a round orange gourd.', plantsCrop: 'crop_gourd', icon: { shape: 'seed', colors: ['#f0a04b', '#a8642a'] } },

  // ---------------------------------------------------------------- raw food
  { key: 'bramble_berries', name: 'Bramble Berries', category: 'food', maxStack: 32, description: 'Sweet and tart. Pufftails adore them.', food: { vitality: 5, energy: 8 }, icon: { shape: 'berry', colors: ['#9b3c6b', '#e05a8f'] }, journal: 'plants' },
  { key: 'sunapple', name: 'Sunapple', category: 'food', maxStack: 32, description: 'Crisp orchard fruit that tastes of summer.', food: { vitality: 8, energy: 12 }, icon: { shape: 'apple', colors: ['#f2b233', '#d65a2e'] }, journal: 'plants' },
  { key: 'coconut', name: 'Coconut', category: 'food', maxStack: 32, description: 'A hard shell full of sweet water.', food: { vitality: 6, energy: 12 }, icon: { shape: 'coconut', colors: ['#7a5230', '#f3ead8'] }, journal: 'plants' },
  { key: 'mushroom', name: 'Capmoss Mushroom', category: 'food', maxStack: 32, description: 'Earthy and filling once cooked.', food: { vitality: 3, energy: 5 }, icon: { shape: 'mushroom', colors: ['#c9674a', '#f4e8d4'] }, journal: 'plants' },
  { key: 'emberroot', name: 'Emberroot', category: 'food', maxStack: 32, description: 'A warm red root vegetable. Plant it on tilled soil, or roast it.', plantsCrop: 'crop_root', food: { vitality: 3, energy: 6 }, icon: { shape: 'root', colors: ['#d8493a', '#6fa84a'] }, journal: 'plants' },
  { key: 'brookmint', name: 'Brookmint', category: 'food', maxStack: 32, description: 'Fresh herb that grows near water. Plant it on tilled soil.', plantsCrop: 'crop_mint', food: { vitality: 2, energy: 4 }, icon: { shape: 'herb', colors: ['#5fcf8a', '#2f8a58'] }, journal: 'plants' },
  { key: 'skycorn', name: 'Skycorn', category: 'food', maxStack: 32, description: 'Sweet golden cobs. Roast them, or shell them into kernels to plant.', food: { vitality: 4, energy: 8 }, icon: { shape: 'corn', colors: ['#f2cf4a', '#6fa84a'] }, journal: 'plants' },
  { key: 'blushberry', name: 'Blushberry', category: 'food', maxStack: 32, description: 'A juicy red vine fruit. Eat it fresh or plant it on tilled soil.', plantsCrop: 'crop_tomato', food: { vitality: 4, energy: 6 }, icon: { shape: 'tomato', colors: ['#e0453a', '#4f8f3a'] }, journal: 'plants' },
  { key: 'puffgourd', name: 'Puffgourd', category: 'food', maxStack: 16, description: 'Round, sweet and surprisingly light.', food: { vitality: 4, energy: 8 }, icon: { shape: 'gourd', colors: ['#f0a04b', '#6f9a45'] }, journal: 'plants' },

  // ---------------------------------------------------------------- cooked food
  { key: 'roasted_roots', name: 'Roasted Roots', category: 'food', maxStack: 16, description: 'Crispy outside, soft inside.', food: { vitality: 18, energy: 25 }, icon: { shape: 'bowl', colors: ['#d8493a', '#8a5a32'] } },
  { key: 'mushroom_soup', name: 'Mushroom Soup', category: 'food', maxStack: 8, description: 'Warming soup. Makes you feel sturdy.', food: { vitality: 22, energy: 30, buff: { id: 'sturdy', seconds: 180 } }, icon: { shape: 'bowl', colors: ['#b58a5a', '#8a5a32'] } },
  { key: 'mint_tea', name: 'Brookmint Tea', category: 'food', maxStack: 8, description: 'Bright tea that puts a spring in your step.', food: { vitality: 6, energy: 20, buff: { id: 'swift', seconds: 120 } }, icon: { shape: 'mug', colors: ['#5fcf8a', '#c9a66b'] } },
  { key: 'fruit_bowl', name: 'Fruit Bowl', category: 'food', maxStack: 8, description: 'A colourful bowl of fresh fruit.', food: { vitality: 15, energy: 30 }, icon: { shape: 'bowl', colors: ['#e05a8f', '#c9a66b'] } },
  { key: 'berry_pie', name: 'Bramble Pie', category: 'food', maxStack: 8, description: 'A proper treat. You will not tire for a while.', food: { vitality: 30, energy: 45, buff: { id: 'well_fed', seconds: 300 } }, icon: { shape: 'pie', colors: ['#9b3c6b', '#e6b36b'] } },
  { key: 'sunbread', name: 'Sunbread', category: 'food', maxStack: 16, description: 'Golden loaf, still warm.', food: { vitality: 20, energy: 40 }, icon: { shape: 'bread', colors: ['#e6b36b', '#a8742e'] } },
  { key: 'gourd_stew', name: 'Gourd Stew', category: 'food', maxStack: 8, description: 'Thick, hearty stew. Heals you faster.', food: { vitality: 35, energy: 50, buff: { id: 'hearty', seconds: 240 } }, icon: { shape: 'bowl', colors: ['#f0a04b', '#8a5a32'] } },
  { key: 'trail_mix', name: 'Trail Mix', category: 'food', maxStack: 16, description: 'Crunchy explorer snack. Quick feet!', food: { vitality: 10, energy: 35, buff: { id: 'swift', seconds: 90 } }, icon: { shape: 'mix', colors: ['#9b3c6b', '#f3ead8'] } },
  { key: 'roasted_skycorn', name: 'Roasted Skycorn', category: 'food', maxStack: 16, description: 'Smoky, buttery and sweet.', food: { vitality: 16, energy: 28 }, icon: { shape: 'corn', colors: ['#e0a83a', '#8a5a32'] } },
  { key: 'garden_salad', name: 'Garden Salad', category: 'food', maxStack: 8, description: 'Blushberries, mint and crunchy roots. Light and lively.', food: { vitality: 14, energy: 26, buff: { id: 'swift', seconds: 120 } }, icon: { shape: 'bowl', colors: ['#e0453a', '#5fcf8a'] } },
  { key: 'glow_jam', name: 'Glowberry Jam', category: 'food', maxStack: 8, description: 'Crystal-infused jam. Lets you see a little in the dark.', food: { vitality: 12, energy: 20, buff: { id: 'glowsight', seconds: 240 } }, icon: { shape: 'mug', colors: ['#86f0ff', '#9b3c6b'] } },

  // ---------------------------------------------------------------- weapons & special tools
  { key: 'wood_club', name: 'Wood Club', category: 'weapon', maxStack: 1, description: 'A knobbly club. Better than bare paws.', tool: tool('weapon', 0, 1, 90, 5), icon: { shape: 'club', colors: ['#8a5a32', '#6b4424'] } },
  { key: 'stone_hammer', name: 'Stone Hammer', category: 'weapon', maxStack: 1, description: 'Heavy and honest.', tool: tool('weapon', 0, 1, 160, 7), icon: { shape: 'hammer', colors: ['#8d8a82', '#8a5a32'] } },
  { key: 'copper_spear', name: 'Copper Spear', category: 'weapon', maxStack: 1, description: 'Long reach, quick jabs.', tool: tool('weapon', 1, 1, 260, 9), icon: { shape: 'spear', colors: ['#e0874d', '#8a5a32'] } },
  // swords: quick swings that sweep every hostile in front of you; strike while falling for a critical hit
  { key: 'wood_sword', name: 'Wooden Sword', category: 'weapon', maxStack: 1, description: 'A carved practice sword. Sweeps foes in front of you; hit while falling for a critical strike.', tool: sword(0, 80, 5), icon: { shape: 'sword', colors: ['#c49563', '#6b4424'] } },
  { key: 'stone_sword', name: 'Stone Sword', category: 'weapon', maxStack: 1, description: 'Heavy fieldstone edge on a sturdy grip. Sweeps foes in front of you.', tool: sword(0, 170, 7), icon: { shape: 'sword', colors: ['#a6a39b', '#6b4424'] } },
  { key: 'copper_sword', name: 'Copper Sword', category: 'weapon', maxStack: 1, description: 'A bright, quick copper sword. Sweeps foes in front of you.', tool: sword(1, 320, 10), icon: { shape: 'sword', colors: ['#e0874d', '#5a3a22'] } },
  { key: 'tempered_blade', name: 'Tempered Sword', category: 'weapon', maxStack: 1, description: 'A springy, well-balanced sword. Sweeps foes in front of you.', tool: sword(2, 520, 13), icon: { shape: 'sword', colors: ['#a9c3d6', '#6b4424'] } },
  { key: 'crystal_blade', name: 'Crystal Sword', category: 'weapon', maxStack: 1, description: 'It rings like a bell with every swing. Sweeps foes in front of you.', tool: sword(3, 1200, 18), icon: { shape: 'sword', colors: ['#86f0ff', '#8f86d6'] } },
  { key: 'boat', name: 'Rowboat', category: 'misc', maxStack: 1, description: 'A little wooden rowboat for rivers and lakes. Use it on water to set it down, then press F / ✋ to climb in. Jump (Space / ⛵) to step out; hit it to pick it back up.', icon: { shape: 'boat', colors: ['#b0804a', '#6b4424'] } },
  { key: 'watering_can', name: 'Watering Can', category: 'tool', maxStack: 1, description: 'Right-click tilled soil to water it. Refill at any water.', tool: tool('hoe', 1, 1, 400, 1), icon: { shape: 'can', colors: ['#e0874d', '#5fa8d6'] } },

  // ---------------------------------------------------------------- equipment
  { key: 'explorer_pack', name: "Explorer's Pack", category: 'equipment', maxStack: 1, description: 'A roomy pack with extra pockets. +8 backpack slots.', equip: { slot: 'pack', slots: 8 }, icon: { shape: 'pack', colors: ['#b0703c', '#6f8a3a'] } },
  { key: 'trail_boots', name: 'Trail Boots', category: 'equipment', maxStack: 1, description: 'Springy soles. Walk a little faster.', equip: { slot: 'feet', speed: 0.1 }, icon: { shape: 'boots', colors: ['#7a5230', '#c9a66b'] } },
  { key: 'moss_vest', name: 'Moss Vest', category: 'equipment', maxStack: 1, description: 'A padded fleece vest. Softens blows.', equip: { slot: 'body', defense: 0.15 }, icon: { shape: 'vest', colors: ['#7fae5a', '#4f7a38'] } },
  { key: 'wayfarer_hood', name: 'Wayfarer Hood', category: 'equipment', maxStack: 1, description: 'Keeps the rain off and the thorns out.', equip: { slot: 'head', defense: 0.1 }, icon: { shape: 'hood', colors: ['#c0563f', '#f3ead8'] } },
  // ---------------------------------------------------------------- armory: shields, bows, arrows, mob materials
  { key: 'gloom_hide', name: 'Gloom Hide', category: 'material', maxStack: 64, description: 'Tough, shadow-soaked hide left by a Gloomstalker. Stitches into light armor.', icon: { shape: 'hide', colors: ['#4b3f7a', '#2a2240'] }, journal: 'materials' },
  { key: 'dusk_fang', name: 'Dusk Fang', category: 'material', maxStack: 64, description: 'A sharp fang from a Duskfang. Makes keen arrowheads.', icon: { shape: 'fang', colors: ['#f4f1ea', '#b8b0a0'] }, journal: 'materials' },
  { key: 'arrow', name: 'Arrow', category: 'material', maxStack: 64, description: 'Ammunition for bows. Recover them where they land… sometimes.', icon: { shape: 'arrow', colors: ['#8a8f96', '#c49563'] } },
  { key: 'hunter_bow', name: 'Hunter Bow', category: 'weapon', maxStack: 1, description: 'Use (right-click / tap) to loose an arrow. Needs Arrows.', tool: tool('weapon', 0, 1, 260, 2), ranged: { damage: 8, speed: 32, cooldown: 0.65 }, icon: { shape: 'bow', colors: ['#a4744a', '#e8e0c8'] } },
  { key: 'crystal_bow', name: 'Crystal Bow', category: 'weapon', maxStack: 1, description: 'A singing crystal longbow. Faster, harder-hitting arrows.', tool: tool('weapon', 3, 1, 900, 3), ranged: { damage: 14, speed: 42, cooldown: 0.5 }, icon: { shape: 'bow', colors: ['#86f0ff', '#e8e0ff'] } },
  { key: 'wood_shield', name: 'Wooden Shield', category: 'equipment', maxStack: 1, description: 'Off-hand. 25% chance to block a hit from the front.', equip: { slot: 'offhand', block: 0.25, defense: 0.02 }, icon: { shape: 'shield', colors: ['#a4744a', '#6b4424'] } },
  { key: 'copper_shield', name: 'Copper Shield', category: 'equipment', maxStack: 1, description: 'Off-hand. 35% chance to block a hit from the front.', equip: { slot: 'offhand', block: 0.35, defense: 0.03 }, icon: { shape: 'shield', colors: ['#e0874d', '#8a5a32'] } },
  { key: 'tempered_shield', name: 'Tempered Shield', category: 'equipment', maxStack: 1, description: 'Off-hand. 45% chance to block a hit from the front.', equip: { slot: 'offhand', block: 0.45, defense: 0.04 }, icon: { shape: 'shield', colors: ['#a9c3d6', '#4f6475'] } },
  { key: 'crystal_shield', name: 'Crystal Shield', category: 'equipment', maxStack: 1, description: 'Off-hand. 55% chance to block a hit from the front.', equip: { slot: 'offhand', block: 0.55, defense: 0.05 }, icon: { shape: 'shield', colors: ['#86f0ff', '#8f86d6'] } },
  { key: 'stone_vest', name: 'Plated Vest', category: 'equipment', maxStack: 1, description: 'Stoneback plates stitched onto fleece.', equip: { slot: 'body', defense: 0.3 }, icon: { shape: 'vest', colors: ['#8d8a82', '#4f7a38'] } },
];

// ---------------------------------------------------------------- tiered tools
for (let tier = 0; tier < 4; tier++) {
  const tk = TIER_KEYS[tier];
  const st = TIER_STATS[tier];
  const col = TIER_COLORS[tier];
  const kinds: [ToolKind, string, DrawIcon['shape'], number][] = [
    ['axe', 'Axe', 'axe', 4 + tier * 2],
    ['pick', 'Pick', 'pick', 3 + tier * 2],
    ['shovel', 'Shovel', 'shovel', 2 + tier],
    ['hoe', 'Hoe', 'hoe', 2 + tier],
  ];
  for (const [kind, label, shape, dmg] of kinds) {
    if (tier === 3 && (kind === 'shovel' || kind === 'hoe')) continue;
    if (tier === 2 && kind === 'hoe') continue;
    HAND_ITEMS.push({
      key: `${tk}_${kind}`,
      name: `${TIER_NAMES[tier]} ${label}`,
      category: 'tool',
      maxStack: 1,
      description: {
        axe: 'Chops wood fast. Fell a tree by cutting its lowest log.',
        pick: 'Breaks stone and ore.',
        shovel: 'Digs soil, sand and gravel quickly.',
        hoe: 'Right-click grass or soil to till it for planting.',
      }[kind as 'axe' | 'pick' | 'shovel' | 'hoe'],
      tool: tool(kind, tier, st.speed, st.dur, dmg),
      icon: { shape, colors: [col, '#8a5a32'] },
    });
  }
}

// ---------------------------------------------------------------- armor sets (helmet · chestplate · leggings · boots)
export const ARMOR_SETS: { key: string; name: string; colors: [string, string]; defense: [number, number, number, number]; speed?: number }[] = [
  { key: 'thorn', name: 'Thornhide', colors: ['#6f8a3a', '#3f5222'], defense: [0.04, 0.08, 0.06, 0.03] },
  { key: 'gloom', name: 'Gloomhide', colors: ['#4b3f7a', '#2a2240'], defense: [0.05, 0.1, 0.08, 0.04], speed: 0.03 },
  { key: 'copper', name: 'Copper', colors: ['#e0874d', '#a85a2c'], defense: [0.07, 0.13, 0.1, 0.06] },
  { key: 'tempered', name: 'Tempered', colors: ['#a9c3d6', '#607c92'], defense: [0.09, 0.17, 0.13, 0.08] },
  { key: 'crystal', name: 'Crystal', colors: ['#86f0ff', '#8f86d6'], defense: [0.12, 0.21, 0.16, 0.1] },
];
export const ARMOR_PIECES: { slot: EquipSlot; key: string; label: string; shape: DrawIcon['shape'] }[] = [
  { slot: 'head', key: 'helmet', label: 'Helmet', shape: 'helmet' },
  { slot: 'body', key: 'chestplate', label: 'Chestplate', shape: 'chest' },
  { slot: 'legs', key: 'leggings', label: 'Leggings', shape: 'leggings' },
  { slot: 'feet', key: 'boots', label: 'Boots', shape: 'boots' },
];
/** Wearing all four pieces of one set. */
export const SET_BONUS_DEFENSE = 0.08;
for (const set of ARMOR_SETS) {
  ARMOR_PIECES.forEach((p, i) => {
    HAND_ITEMS.push({
      key: `${set.key}_${p.key}`, name: `${set.name} ${p.label}`, category: 'equipment', maxStack: 1,
      description: `Armor (${p.label.toLowerCase()}): ${Math.round(set.defense[i] * 100)}% less damage${set.speed ? ', a little faster' : ''}. Wear the full ${set.name} set for +${Math.round(SET_BONUS_DEFENSE * 100)}%.`,
      equip: { slot: p.slot, defense: set.defense[i], speed: set.speed, set: set.key },
      icon: { shape: p.shape, colors: [...set.colors] },
    });
  });
}

/** Block keys that exist as placeable inventory items (item key == block key). */
const PLACEABLE_BLOCKS = [
  'dirt', 'sand', 'gravel', 'log', 'birch_log', 'amberstone', 'amber_banded', 'crystal_stone', 'planks', 'birch_planks',
  'fieldstone', 'mossy_fieldstone', 'brick', 'glass', 'thatch', 'lantern', 'torch', 'flower_sun', 'flower_sky', 'flower_ember',
  'sapling', 'workbench', 'stonecutter', 'forge', 'cooking_fire', 'stone_oven', 'carpentry_bench', 'crystal_bench', 'chest', 'bed',
  'table', 'chair', 'shelf', 'cabinet', 'rug', 'fireplace', 'flower_pot', 'ice_box', 'water_barrel', 'wind_lamp', 'grinder',
  'crystal_lantern', 'shell', 'plank_stairs', 'plank_slab', 'stone_slab', 'roof_stairs', 'fence', 'window', 'kitchen_table',
  'hedge', 'hedge_low', 'fence_gate', 'hay_bale',
];

/**
 * Survival items that place architecture blocks with a fixed material (the
 * block's meta). Build Home uses the catalog instead and can paint anything.
 */
const ARCH_ITEMS: { key: string; name: string; block: string; meta: number; description: string; maxStack?: number }[] = [
  { key: 'plaster_wall', name: 'White Plaster Wall', block: 'arch_block', meta: archMeta.cube(archIndex('plaster_white')), description: 'Smooth white plaster. The base of every modern home.' },
  { key: 'concrete_block', name: 'Concrete Block', block: 'arch_block', meta: archMeta.cube(archIndex('concrete_gray')), description: 'Cast gray concrete for walls, floors and flat roofs.' },
  { key: 'cut_stone', name: 'Cut Stone Block', block: 'arch_block', meta: archMeta.cube(archIndex('stone_cut')), description: 'Neatly dressed stone blocks.' },
  { key: 'oak_floor', name: 'Oak Floorboards', block: 'arch_block', meta: archMeta.cube(archIndex('floor_oak')), description: 'Long warm floorboards for a cosy interior.' },
  { key: 'wood_cladding', name: 'Wood Cladding', block: 'arch_block', meta: archMeta.cube(archIndex('wood_cladding')), description: 'Overlapping boards for exterior walls.' },
  { key: 'clay_roof', name: 'Clay Roof Slope', block: 'arch_slope', meta: archMeta.rotated(archIndex('roof_terracotta'), 0), description: 'Terracotta roof tiles. Place facing away from you to build a pitched roof.' },
  { key: 'shingle_roof', name: 'Shingle Roof Slope', block: 'arch_slope', meta: archMeta.rotated(archIndex('shingles_brown'), 0), description: 'Wooden-framed shingle roof slope.' },
  { key: 'glass_wall', name: 'Glass Wall', block: 'arch_glass', meta: 0, description: 'A clear glass wall block. Great for big bright windows.' },
  { key: 'stone_stairs', name: 'Stone Stairs', block: 'arch_stairs', meta: archMeta.rotated(archIndex('stone_cut'), 0), description: 'Sturdy stone steps.' },
  { key: 'wood_beam', name: 'Wooden Beam', block: 'arch_beam', meta: archMeta.rotated(archIndex('floor_oak'), 2), description: 'An exposed ceiling beam. Runs along the direction you face.' },
  { key: 'stone_column', name: 'Stone Column', block: 'arch_column', meta: archMeta.rotated(archIndex('stone_cut'), 0), description: 'A square stone column. Stacks into pillars.' },
  { key: 'garden_wall', name: 'Garden Wall', block: 'arch_wall_low', meta: archMeta.cube(archIndex('fieldstone')), description: 'A low fieldstone wall that joins up with its neighbours.' },
  { key: 'modern_fence', name: 'White Slat Fence', block: 'arch_fence', meta: archMeta.cube(archIndex('wood_white')), description: 'A clean white fence that connects to walls and gates.' },
  { key: 'glass_railing', name: 'Glass Railing', block: 'arch_railing_glass', meta: archMeta.rotated(archIndex('metal_black'), 0), description: 'A frameless glass balustrade for balconies and stairs.' },
];

function blockItems(): ItemDef[] {
  const out: ItemDef[] = [];
  for (const key of PLACEABLE_BLOCKS) {
    const def = BLOCK_DEFS.find((b) => b.key === key);
    if (!def) throw new Error(`Missing block for item ${key}`);
    out.push({
      key,
      name: def.name,
      category: 'block',
      maxStack: def.shape === 'model' && def.interact ? 16 : 64,
      description: def.description ?? blockDescription(def.category),
      placeBlock: key,
      icon: { block: key },
      journal: def.category === 'Nature' || def.shape === 'cross' ? 'plants' : undefined,
    });
  }
  out.push({
    key: 'door', name: 'Cottage Door', category: 'block', maxStack: 16, description: 'A friendly wooden door. Right-click or press F to open.',
    placeBlock: 'door_lower', icon: { block: 'door_lower' },
  });
  for (const a of ARCH_ITEMS) {
    out.push({
      key: a.key, name: a.name, category: 'block', maxStack: a.maxStack ?? 64, description: a.description,
      placeBlock: a.block, placeMeta: a.meta, icon: { block: a.block, meta: a.meta },
    });
  }
  return out;
}

function blockDescription(cat?: string): string {
  switch (cat) {
    case 'Structure': return 'A building block for walls, floors and roofs.';
    case 'Furniture': return 'Makes a house feel like home. Adds comfort.';
    case 'Storage': return 'Keeps your things safe. Press F to open.';
    case 'Lighting': return 'Pushes back the dark. Hostile creatures avoid light.';
    case 'Crafting': return 'A crafting station. Press F to use it.';
    case 'Decoration': return 'A little touch of charm.';
    case 'Nature': return 'A piece of the wild.';
    default: return 'A natural block.';
  }
}

export const ITEM_DEFS: ItemDef[] = [...blockItems(), ...HAND_ITEMS];

const ITEM_MAP = new Map<string, ItemDef>();
for (const d of ITEM_DEFS) {
  if (ITEM_MAP.has(d.key)) throw new Error(`Duplicate item ${d.key}`);
  ITEM_MAP.set(d.key, d);
}

export function itemDef(key: string): ItemDef {
  const d = ITEM_MAP.get(key);
  if (!d) throw new Error(`Unknown item "${key}"`);
  return d;
}

export function hasItem(key: string): boolean {
  return ITEM_MAP.has(key);
}

/**
 * The survival item a placed architecture block drops (material + shape
 * match, orientation ignored), or null when no survival item exists for it.
 */
export function itemForBlock(block: string, meta: number): string | null {
  for (const a of ARCH_ITEMS) {
    if (a.block !== block) continue;
    const def = BLOCK_DEFS.find((b) => b.key === block);
    const kind = def?.arch?.kind;
    const strip = (m: number) => (kind === 'rotated' ? m >> 2 : kind === 'slab' ? m & 63 : kind === 'panel_h' ? m >> 1 : m);
    if (strip(a.meta) === strip(meta)) return a.key;
  }
  return null;
}

export const HAND_TOOL: ToolStats = { kind: 'hand', tier: -1, speed: 1, durability: Infinity, damage: 2 };
