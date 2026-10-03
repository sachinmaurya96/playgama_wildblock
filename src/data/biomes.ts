/**
 * Biome definitions. Terrain parameters are blended between biomes by weight, so
 * transitions are smooth. Colors are RGB 0..1.
 */
export type BiomeId = 'meadow' | 'forest' | 'pine' | 'coast' | 'canyon' | 'crystal';

export type TreeKind = 'broadleaf' | 'pine' | 'birch' | 'palm' | 'orchard' | 'jungle' | 'none';

export interface BiomeDef {
  id: BiomeId;
  name: string;
  /** Climate center (temperature, humidity) in -1..1 */
  climate: [number, number];
  baseHeight: number;
  heightScale: number;
  roughness: number;
  /** Terrace / plateau strength 0..1 (canyon cliffs). */
  terrace: number;
  grassTint: [number, number, number];
  foliageTint: [number, number, number];
  waterTint: [number, number, number];
  fogTint: [number, number, number];
  surface: string;
  subsurface: string;
  treeDensity: number;
  trees: { kind: TreeKind; weight: number }[];
  grassDensity: number;
  flowers: { key: string; weight: number }[];
  flowerDensity: number;
  description: string;
  mapColor: [number, number, number];
}

export const BIOMES: BiomeDef[] = [
  {
    id: 'meadow', name: 'Sunny Meadow', climate: [0.2, 0.1], baseHeight: 50, heightScale: 9, roughness: 0.45, terrace: 0,
    grassTint: [0.52, 0.8, 0.33], foliageTint: [0.42, 0.72, 0.3], waterTint: [0.25, 0.62, 0.78], fogTint: [0.78, 0.88, 0.95],
    surface: 'grass', subsurface: 'dirt', treeDensity: 0.011,
    trees: [{ kind: 'broadleaf', weight: 5 }, { kind: 'orchard', weight: 2 }, { kind: 'birch', weight: 1 }],
    grassDensity: 0.32, flowers: [{ key: 'flower_sun', weight: 3 }, { key: 'flower_sky', weight: 2 }, { key: 'flower_ember', weight: 1 }, { key: 'berry_bush', weight: 2 }, { key: 'crop_root', weight: 0.6 }, { key: 'crop_gourd', weight: 0.35 }, { key: 'crop_wheat', weight: 0.4 }],
    flowerDensity: 0.06, description: 'Rolling grass, wildflowers and gentle hills. A kind place to begin.', mapColor: [0.5, 0.75, 0.35],
  },
  {
    id: 'forest', name: 'Deepwood', climate: [0.15, 0.7], baseHeight: 53, heightScale: 12, roughness: 0.5, terrace: 0,
    grassTint: [0.36, 0.66, 0.28], foliageTint: [0.26, 0.55, 0.22], waterTint: [0.2, 0.5, 0.55], fogTint: [0.62, 0.75, 0.7],
    surface: 'grass', subsurface: 'dirt', treeDensity: 0.085,
    trees: [{ kind: 'broadleaf', weight: 4 }, { kind: 'jungle', weight: 2 }, { kind: 'birch', weight: 2 }],
    grassDensity: 0.4, flowers: [{ key: 'mushroom', weight: 3 }, { key: 'flower_sky', weight: 1 }, { key: 'crop_mint', weight: 0.8 }, { key: 'berry_bush', weight: 1 }], flowerDensity: 0.05,
    description: 'Tall trees, mossy floors and shy creatures beneath a dark canopy.', mapColor: [0.24, 0.5, 0.24],
  },
  {
    id: 'pine', name: 'Pine Highlands', climate: [-0.6, 0.2], baseHeight: 66, heightScale: 24, roughness: 0.6, terrace: 0.15,
    grassTint: [0.45, 0.62, 0.38], foliageTint: [0.22, 0.42, 0.3], waterTint: [0.3, 0.58, 0.72], fogTint: [0.72, 0.8, 0.88],
    surface: 'grass', subsurface: 'dirt', treeDensity: 0.05,
    trees: [{ kind: 'pine', weight: 1 }], grassDensity: 0.18, flowers: [{ key: 'flower_sky', weight: 2 }, { key: 'berry_bush', weight: 1 }, { key: 'crop_mint', weight: 0.6 }],
    flowerDensity: 0.03, description: 'Cool, high ground with fragrant pines and fast streams.', mapColor: [0.35, 0.5, 0.4],
  },
  {
    id: 'coast', name: 'Sandy Coast', climate: [0.6, 0.0], baseHeight: 42, heightScale: 3, roughness: 0.3, terrace: 0,
    grassTint: [0.62, 0.8, 0.38], foliageTint: [0.45, 0.72, 0.3], waterTint: [0.18, 0.7, 0.78], fogTint: [0.82, 0.9, 0.95],
    surface: 'sand', subsurface: 'sand', treeDensity: 0.012,
    trees: [{ kind: 'palm', weight: 1 }], grassDensity: 0.04, flowers: [{ key: 'shell', weight: 1 }, { key: 'crop_gourd', weight: 0.25 }], flowerDensity: 0.02,
    description: 'Warm sand, palms and the soft hush of the sea.', mapColor: [0.9, 0.84, 0.6],
  },
  {
    id: 'canyon', name: 'Amber Canyon', climate: [0.8, -0.7], baseHeight: 60, heightScale: 26, roughness: 0.55, terrace: 0.85,
    grassTint: [0.7, 0.68, 0.36], foliageTint: [0.6, 0.62, 0.3], waterTint: [0.35, 0.6, 0.6], fogTint: [0.95, 0.82, 0.66],
    surface: 'amberstone', subsurface: 'amber_banded', treeDensity: 0.004,
    trees: [{ kind: 'birch', weight: 1 }], grassDensity: 0.02, flowers: [{ key: 'dry_shrub', weight: 3 }, { key: 'flower_ember', weight: 1 }],
    flowerDensity: 0.03, description: 'Sun-baked cliffs striped in amber, rich in minerals.', mapColor: [0.85, 0.55, 0.3],
  },
  {
    id: 'crystal', name: 'Crystal Highlands', climate: [-0.3, -0.5], baseHeight: 72, heightScale: 28, roughness: 0.65, terrace: 0.45,
    grassTint: [0.45, 0.78, 0.72], foliageTint: [0.5, 0.7, 0.85], waterTint: [0.4, 0.75, 0.95], fogTint: [0.8, 0.82, 0.98],
    surface: 'grass', subsurface: 'crystal_stone', treeDensity: 0.012,
    trees: [{ kind: 'birch', weight: 1 }], grassDensity: 0.14, flowers: [{ key: 'crystal_cluster', weight: 2 }, { key: 'flower_sky', weight: 2 }],
    flowerDensity: 0.04, description: 'Rare heights where glowing crystals push through teal grass.', mapColor: [0.55, 0.8, 0.85],
  },
];

export const BIOME_INDEX: Record<BiomeId, number> = BIOMES.reduce(
  (acc, b, i) => ((acc[b.id] = i), acc),
  {} as Record<BiomeId, number>,
);
