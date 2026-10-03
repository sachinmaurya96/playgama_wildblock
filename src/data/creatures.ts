import type { BiomeId } from './biomes';

export type CreatureKind =
  | 'mossback' | 'pufftail' | 'twiglet' | 'mudsnout' | 'glowbug' | 'fenn'
  | 'thorncrawler' | 'nightling' | 'stoneback' | 'cave_mite' | 'bog_snapper' | 'gloomstalker' | 'duskfang';

export interface CreatureDef {
  kind: CreatureKind;
  name: string;
  hostile: boolean;
  health: number;
  /** Walk speed in blocks/second (run = ×1.9). */
  speed: number;
  /** Collision half-width and height. */
  radius: number;
  height: number;
  biomes: BiomeId[] | 'any';
  /** When it spawns. */
  time: 'day' | 'night' | 'any';
  /** 'surface' spawns on grass/sand with sky above; 'cave' needs darkness under ground; 'water' near water edges. */
  habitat: 'surface' | 'cave' | 'water';
  /** Relative spawn weight within its group. */
  weight: number;
  groupSize: [number, number];
  /** Items that befriend / attract it (friendly only). */
  favoriteFood?: string[];
  /** Friendly gift after feeding or petting (item, cooldown seconds). */
  gift?: { item: string; cooldown: number; count?: [number, number] };
  /** Hostile only. */
  damage?: number;
  attackRange?: number;
  aggroRange?: number;
  /** Retreats from bright light / burrows at dawn. */
  shy?: boolean;
  drops?: { item: string; chance: number; count?: [number, number] }[];
  flies?: boolean;
  glows?: boolean;
  description: string;
  /** Subtitle for accessibility when it makes an important sound. */
  subtitle?: string;
}

export const CREATURES: Record<CreatureKind, CreatureDef> = {
  mossback: {
    kind: 'mossback', name: 'Mossback', hostile: false, health: 30, speed: 1.3, radius: 0.55, height: 1.3,
    biomes: ['meadow', 'forest', 'pine'], time: 'day', habitat: 'surface', weight: 3, groupSize: [2, 4],
    favoriteFood: ['sunapple', 'fiber', 'sunwheat'], gift: { item: 'moss_fleece', cooldown: 240, count: [1, 2] },
    description: 'A gentle grazer whose back grows a soft carpet of moss. Feed it and it may share its fleece.',
  },
  pufftail: {
    kind: 'pufftail', name: 'Pufftail', hostile: false, health: 12, speed: 2.2, radius: 0.3, height: 0.55,
    biomes: ['meadow', 'forest', 'coast', 'crystal'], time: 'any', habitat: 'surface', weight: 4, groupSize: [1, 3],
    favoriteFood: ['bramble_berries', 'emberroot'], gift: { item: 'puff_fluff', cooldown: 200 },
    description: 'A round, bouncy critter with a tail like a dandelion clock. Berries win its heart.',
  },
  twiglet: {
    kind: 'twiglet', name: 'Twiglet', hostile: false, health: 6, speed: 2.4, radius: 0.2, height: 0.4,
    biomes: ['forest', 'meadow', 'pine'], time: 'day', habitat: 'surface', weight: 3, groupSize: [1, 3],
    favoriteFood: ['grass_seeds', 'sunwheat_seeds'], gift: { item: 'twig_feather', cooldown: 300 },
    description: 'A tiny striped bird that hops more than it flies. It collects shiny things.',
  },
  mudsnout: {
    kind: 'mudsnout', name: 'Mudsnout', hostile: false, health: 26, speed: 1.5, radius: 0.5, height: 0.9,
    biomes: ['forest', 'meadow', 'coast'], time: 'day', habitat: 'surface', weight: 2, groupSize: [1, 3],
    favoriteFood: ['mushroom', 'puffgourd', 'emberroot'], gift: { item: 'emberroot', cooldown: 220, count: [1, 3] },
    description: 'A snuffly boar-ish friend with a nose for buried roots. Well-fed Mudsnouts dig up treats.',
  },
  glowbug: {
    kind: 'glowbug', name: 'Glowbug', hostile: false, health: 4, speed: 1.2, radius: 0.25, height: 0.4,
    biomes: 'any', time: 'night', habitat: 'surface', weight: 3, groupSize: [2, 5], flies: true, glows: true,
    favoriteFood: ['glow_crystal'], gift: { item: 'glow_crystal', cooldown: 600 },
    description: 'A big, harmless lantern-insect that drifts over meadows at night.',
  },
  fenn: {
    kind: 'fenn', name: 'Fenn', hostile: false, health: 40, speed: 2.6, radius: 0.35, height: 0.75,
    biomes: ['forest', 'pine', 'meadow'], time: 'any', habitat: 'surface', weight: 1, groupSize: [1, 1],
    favoriteFood: ['bramble_berries', 'sunapple'],
    description: 'A clever woodland fox-creature with ember-tipped ears. Feed one three times and it may choose to travel with you.',
    subtitle: 'Fenn yips',
  },
  thorncrawler: {
    kind: 'thorncrawler', name: 'Thorncrawler', hostile: true, health: 22, speed: 1.9, radius: 0.5, height: 0.7,
    biomes: ['meadow', 'forest', 'pine', 'coast'], time: 'night', habitat: 'surface', weight: 3, groupSize: [1, 2],
    damage: 9, attackRange: 1.4, aggroRange: 14, shy: true,
    drops: [{ item: 'thorn', chance: 0.9, count: [1, 2] }, { item: 'fiber', chance: 0.5, count: [1, 3] }],
    description: 'A bristling bundle of bramble and beetle that skitters out after dark.', subtitle: 'Thorncrawler rustles',
  },
  nightling: {
    kind: 'nightling', name: 'Nightling', hostile: true, health: 16, speed: 2.4, radius: 0.3, height: 0.8,
    biomes: 'any', time: 'night', habitat: 'surface', weight: 3, groupSize: [1, 3],
    damage: 7, attackRange: 1.2, aggroRange: 16, shy: true,
    drops: [{ item: 'shadow_wisp', chance: 0.8 }],
    description: 'A small shadow with bright eyes. It hates light and flees from torches.', subtitle: 'Nightling whispers',
  },
  stoneback: {
    kind: 'stoneback', name: 'Stoneback', hostile: true, health: 55, speed: 1.1, radius: 0.65, height: 1.1,
    biomes: ['pine', 'canyon', 'crystal'], time: 'any', habitat: 'cave', weight: 2, groupSize: [1, 1],
    damage: 14, attackRange: 1.6, aggroRange: 10,
    drops: [{ item: 'stone_plate', chance: 1, count: [1, 2] }, { item: 'raw_copper', chance: 0.4 }],
    description: 'A slow, armoured grump that guards cave hollows. Hits hard, forgets fast.', subtitle: 'Stoneback grinds',
  },
  cave_mite: {
    kind: 'cave_mite', name: 'Cave Mite', hostile: true, health: 10, speed: 2.8, radius: 0.3, height: 0.4,
    biomes: 'any', time: 'any', habitat: 'cave', weight: 4, groupSize: [2, 3],
    damage: 5, attackRange: 1.0, aggroRange: 12,
    drops: [{ item: 'mite_shell', chance: 0.7 }, { item: 'glow_crystal', chance: 0.08 }],
    description: 'A skittering underground nibbler. Weak alone, annoying in groups.', subtitle: 'Cave Mite clicks',
  },
  bog_snapper: {
    kind: 'bog_snapper', name: 'Bog Snapper', hostile: true, health: 34, speed: 1.4, radius: 0.6, height: 0.6,
    biomes: ['forest', 'meadow', 'coast'], time: 'night', habitat: 'water', weight: 2, groupSize: [1, 1],
    damage: 12, attackRange: 1.5, aggroRange: 9,
    drops: [{ item: 'snapper_scale', chance: 1, count: [1, 2] }],
    description: 'A lurking shore predator. It rarely strays far from water.', subtitle: 'Bog Snapper hisses',
  },
  // ---- night hunters: they come looking for you after dark
  gloomstalker: {
    kind: 'gloomstalker', name: 'Gloomstalker', hostile: true, health: 34, speed: 1.75, radius: 0.32, height: 1.75,
    biomes: 'any', time: 'night', habitat: 'surface', weight: 4, groupSize: [1, 2],
    damage: 9, attackRange: 1.4, aggroRange: 22, shy: true,
    drops: [{ item: 'gloom_hide', chance: 0.85, count: [1, 2] }, { item: 'shadow_wisp', chance: 0.3 }],
    description: 'A tall, hollow-eyed husk of moss and shadow that shambles out of the dark and follows your footsteps.', subtitle: 'Gloomstalker groans',
  },
  duskfang: {
    kind: 'duskfang', name: 'Duskfang', hostile: true, health: 20, speed: 2.9, radius: 0.36, height: 0.85,
    biomes: ['meadow', 'forest', 'pine', 'canyon'], time: 'night', habitat: 'surface', weight: 3, groupSize: [2, 3],
    damage: 6, attackRange: 1.3, aggroRange: 24, shy: true,
    drops: [{ item: 'dusk_fang', chance: 0.8, count: [1, 2] }, { item: 'gloom_hide', chance: 0.25 }],
    description: 'Lean night hunters that run in packs. Fast and bold in the dark, they melt away at sunrise.', subtitle: 'Duskfang howls',
  },
};

export const FRIENDLY_KINDS = (Object.keys(CREATURES) as CreatureKind[]).filter((k) => !CREATURES[k].hostile);
export const HOSTILE_KINDS = (Object.keys(CREATURES) as CreatureKind[]).filter((k) => CREATURES[k].hostile);
