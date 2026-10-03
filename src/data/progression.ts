/**
 * Quests (onboarding), achievements, homestead levels, lore fragments and tips.
 * Quest/achievement progress is driven by GameEvents counted in QuestSystem.
 */

export type StatKey =
  | 'wood' | 'crafted' | 'craftedAxe' | 'workbench' | 'sheltered' | 'cooked' | 'river' | 'backpack' | 'cave'
  | 'trees' | 'placed' | 'broken' | 'animalsFed' | 'crystals' | 'landmarks' | 'harvested' | 'defeated' | 'slept'
  | 'tilled' | 'planted' | 'lore' | 'friends';

export interface QuestDef {
  id: string;
  title: string;
  hint: string;
  stat: StatKey;
  goal: number;
  reward: { item: string; count: number }[];
  homestead: number;
}

export const QUESTS: QuestDef[] = [
  { id: 'gather_wood', title: 'Gather Wood', hint: 'Hold left click on a tree trunk. Chop the lowest log to fell the whole tree!', stat: 'wood', goal: 4, reward: [{ item: 'sunapple', count: 2 }], homestead: 2 },
  { id: 'craft_axe', title: 'Craft an Axe', hint: 'Open your pack (E), go to Crafting and make Planks, Rope (from Plant Fiber) and a Scrap Axe.', stat: 'craftedAxe', goal: 1, reward: [{ item: 'torch', count: 4 }], homestead: 3 },
  { id: 'workbench', title: 'Build a Workbench', hint: 'Craft a Workbench and place it with right click. Press F to use it.', stat: 'workbench', goal: 1, reward: [{ item: 'rope', count: 3 }], homestead: 5 },
  { id: 'shelter', title: 'Build Shelter', hint: 'Build walls, a roof and a door around you. The home icon lights up when you are sheltered.', stat: 'sheltered', goal: 1, reward: [{ item: 'lantern', count: 1 }], homestead: 10 },
  { id: 'cook', title: 'Cook Your First Meal', hint: 'Place a Cooking Fire, press F on it and cook Roasted Roots or Mint Tea.', stat: 'cooked', goal: 1, reward: [{ item: 'bramble_berries', count: 4 }], homestead: 4 },
  { id: 'river', title: 'Discover a River', hint: 'Follow the land downhill. Rivers wind through the valleys.', stat: 'river', goal: 1, reward: [{ item: 'brookmint', count: 2 }], homestead: 3 },
  { id: 'backpack', title: 'Craft a Backpack', hint: "Make an Explorer's Pack at a Workbench and equip it for 8 extra slots.", stat: 'backpack', goal: 1, reward: [{ item: 'trail_mix', count: 2 }], homestead: 3 },
  { id: 'cave', title: 'Explore a Cave', hint: 'Bring torches and head underground. Caves hide copper and glow crystals.', stat: 'cave', goal: 1, reward: [{ item: 'emberite', count: 4 }], homestead: 5 },
  { id: 'farm', title: 'Plant a Garden', hint: 'Till soil with a hoe (right click), then plant seeds or roots on it.', stat: 'planted', goal: 3, reward: [{ item: 'puffgourd_seeds', count: 3 }], homestead: 6 },
  { id: 'friend', title: 'Make a Friend', hint: 'Hold a creature’s favourite food and press F near it. Pufftails love berries.', stat: 'animalsFed', goal: 2, reward: [{ item: 'puff_fluff', count: 2 }], homestead: 5 },
];

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  stat: StatKey;
  goal: number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_tree', title: 'First Tree', description: 'Fell your first tree.', stat: 'trees', goal: 1 },
  { id: 'home_builder', title: 'Home Builder', description: 'Shelter under a roof of your own.', stat: 'sheltered', goal: 1 },
  { id: 'river_explorer', title: 'River Explorer', description: 'Find a river.', stat: 'river', goal: 1 },
  { id: 'crystal_hunter', title: 'Crystal Hunter', description: 'Collect 10 glow crystals.', stat: 'crystals', goal: 10 },
  { id: 'animal_friend', title: 'Animal Friend', description: 'Befriend 5 creatures.', stat: 'animalsFed', goal: 5 },
  { id: 'cave_dweller', title: 'Cave Dweller', description: 'Venture into the underground.', stat: 'cave', goal: 1 },
  { id: 'blocks_100', title: '100 Blocks Placed', description: 'Place 100 blocks.', stat: 'placed', goal: 100 },
  { id: 'landmarks_3', title: 'Wayfinder', description: 'Discover 3 landmarks.', stat: 'landmarks', goal: 3 },
  { id: 'green_thumb', title: 'Green Thumb', description: 'Harvest 20 crops.', stat: 'harvested', goal: 20 },
  { id: 'lore_keeper', title: 'Lore Keeper', description: 'Read 5 Whisper Steles.', stat: 'lore', goal: 5 },
  { id: 'defender', title: 'Brave Heart', description: 'Drive off 10 hostile creatures.', stat: 'defeated', goal: 10 },
];

/** Homestead Points needed to reach each level (index = level - 1). */
export const HOMESTEAD_LEVELS = [0, 25, 70, 150, 280, 460, 700];

export const HOMESTEAD_UNLOCKS: Record<number, string> = {
  2: 'Carpentry Bench, shelves, rugs, cabinets and windows',
  3: 'Stone Oven, Hearth and baked meals',
  4: 'Crystal Bench, crystal tools and Crystal Lanterns',
  5: 'Scarf dyes: Sunset and Moss (cosmetic)',
  6: 'Scarf dye: Starlight (cosmetic)',
  7: 'The wilds call you kin. (Thank you for playing!)',
};

export const SCARF_COLORS: { id: string; name: string; color: string; level: number }[] = [
  { id: 'ember', name: 'Ember', color: '#d9573f', level: 1 },
  { id: 'meadow', name: 'Meadow', color: '#e0b23d', level: 1 },
  { id: 'river', name: 'River', color: '#3f8fd9', level: 1 },
  { id: 'sunset', name: 'Sunset', color: '#f07a5a', level: 5 },
  { id: 'moss', name: 'Moss', color: '#5f9a4a', level: 5 },
  { id: 'starlight', name: 'Starlight', color: '#9b8cff', level: 6 },
];

/** Environmental storytelling: fragments of the Wayfarers' journal found on Whisper Steles. */
export const LORE: { title: string; text: string }[] = [
  { title: 'The First Stele', text: 'We came over the ridge with nothing but seeds in our pockets. The land did not want to be owned, so we asked to be guests instead.' },
  { title: 'On Rivers', text: 'Follow the water and you will never starve. The rivers here carve stairs into the hills, and every stair has a song.' },
  { title: 'The Mossbacks', text: 'Old Tamsin says the Mossbacks remember every kindness. I believe her. One followed me home for a whole season.' },
  { title: 'Night Things', text: 'The Nightlings are not cruel, only afraid of the light. Keep a lantern lit and they will keep their distance.' },
  { title: 'The Crystal Heights', text: 'Up where the grass turns teal the stones sing at dusk. We cut only what we needed, and thanked the mountain for the rest.' },
  { title: 'Hearthkeeping', text: 'A house is walls and a roof. A home is a bed you want to return to, a table for friends, and a light in the window.' },
  { title: 'The Sky Pillars', text: 'Nobody knows who raised the pillars. We only know the view from the top makes the whole valley look like a quilt.' },
  { title: 'A Warning', text: 'Take a tree, plant a tree. When we forgot this, the Pufftails went away, and the meadows grew quiet.' },
  { title: 'The Hollow Tree', text: 'Wren grew up inside the great hollow tree. She said it breathed in winter. We laughed. Then we heard it too.' },
  { title: 'Last Entry', text: 'The others have gone ahead over the far hills. I leave these stones for whoever comes next. Be a good guest, traveller.' },
];

export const TIPS = [
  'Rivers often lead to useful resources.',
  'Friendly creatures remember good food.',
  'Your world is generated from its seed — share it with friends!',
  'Chop the lowest log of a tree and the whole tree comes down.',
  'Torches and lanterns keep night creatures away from your home.',
  'A bed lets you set your home and sleep through the night.',
  'Hold Ctrl (or C) to crouch — you won’t slip off ledges while building.',
  'Planting saplings keeps the wilds in harmony. Harmony attracts rare wildlife.',
  'Waterfalls hide where rivers tumble off cliffs. Listen for them.',
  'Crafting stations unlock more recipes. Look for the station tabs in the recipe book.',
  'Furniture near your bed adds Comfort — sleep there for a better morning.',
  'Press J to open your Discovery Journal.',
];
