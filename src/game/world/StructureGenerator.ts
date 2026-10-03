import { hash2, mulberry32 } from '../core/random';
import { B, blockId } from './BlockRegistry';
import { SEA_LEVEL } from './constants';
import type { TerrainSampler } from './TerrainSampler';
import type { BlockWriter } from './TreeGenerator';
import { buildTree } from './TreeGenerator';

export const LANDMARK_REGION = 80;
/** Max horizontal reach of any landmark from its center (for chunk overlap tests). */
export const LANDMARK_REACH = 12;

export type LandmarkType =
  | 'stone_circle' | 'ruin' | 'campsite' | 'hollow_tree' | 'crystal_spire' | 'forgotten_cabin' | 'flower_valley' | 'sky_pillar';

export const LANDMARK_NAMES: Record<LandmarkType, string> = {
  stone_circle: 'Ancient Stone Circle',
  ruin: 'Overgrown Ruin',
  campsite: 'Forgotten Campsite',
  hollow_tree: 'Giant Hollow Tree',
  crystal_spire: 'Crystal Spire',
  forgotten_cabin: 'Abandoned Cabin',
  flower_valley: 'Flower Valley',
  sky_pillar: 'Sky Pillar',
};

export interface LandmarkPlan {
  type: LandmarkType;
  x: number;
  y: number;
  z: number;
  rot: number;
  seed: number;
}

/** Find the landmark (if any) belonging to a region cell. Deterministic. */
export function planLandmark(rx: number, rz: number, sampler: TerrainSampler): LandmarkPlan | null {
  const seed = sampler.seed;
  const r = hash2(rx, rz, seed ^ 0x51ab);
  if (r > 0.62) return null;
  const x = rx * LANDMARK_REGION + 14 + Math.floor(hash2(rx, rz, seed ^ 0x77) * (LANDMARK_REGION - 28));
  const z = rz * LANDMARK_REGION + 14 + Math.floor(hash2(rz, rx, seed ^ 0x99) * (LANDMARK_REGION - 28));
  // Keep the immediate spawn clear so players build their own first home.
  if (Math.abs(x) < 24 && Math.abs(z) < 24) return null;
  const col = sampler.sample(x, z);
  if (col.waterLevel > 0 || col.height <= SEA_LEVEL + 1) return null;
  const biome = col.biome;
  const pick = hash2(rx, rz, seed ^ 0x1f1f);
  let type: LandmarkType;
  switch (biome) {
    case 1: type = pick < 0.35 ? 'hollow_tree' : pick < 0.6 ? 'forgotten_cabin' : pick < 0.85 ? 'campsite' : 'ruin'; break;
    case 2: type = pick < 0.35 ? 'stone_circle' : pick < 0.6 ? 'sky_pillar' : pick < 0.8 ? 'campsite' : 'ruin'; break;
    case 3: type = pick < 0.5 ? 'ruin' : 'campsite'; break;
    case 4: type = pick < 0.5 ? 'sky_pillar' : 'ruin'; break;
    case 5: type = pick < 0.7 ? 'crystal_spire' : 'stone_circle'; break;
    default: type = pick < 0.3 ? 'flower_valley' : pick < 0.55 ? 'stone_circle' : pick < 0.8 ? 'forgotten_cabin' : 'ruin';
  }
  return { type, x, y: col.height + 1, z, rot: Math.floor(hash2(x, z, seed ^ 3) * 4), seed: Math.floor(r * 1e9) };
}

const id = {
  fieldstone: B.FIELDSTONE,
  mossy: B.MOSSY_FIELDSTONE,
  planks: B.PLANKS,
  log: B.LOG,
  chest: B.CHEST,
  lore: B.LORE_STONE,
  fire: B.COOKING_FIRE,
  crystalStone: B.CRYSTAL_STONE,
  glowOre: B.GLOW_ORE,
  cluster: B.CRYSTAL_CLUSTER,
  thatch: B.THATCH,
  door: B.DOOR_LOWER,
  doorUp: B.DOOR_UPPER,
  bed: B.BED,
  torch: B.TORCH,
  fence: B.FENCE,
};

/** Build a landmark through a (chunk-clipped) writer. Ground under it is filled so it never floats. */
export function buildLandmark(p: LandmarkPlan, sampler: TerrainSampler, w: BlockWriter): void {
  const rng = mulberry32(p.seed);
  const { x, y, z } = p;
  const rug = blockId('rug');
  const window = blockId('window');
  const table = blockId('table');
  const chair = blockId('chair');

  const foundation = (radius: number, block: number) => {
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) {
        const h = sampler.sample(x + dx, z + dz).height;
        for (let yy = Math.min(h, y - 1); yy <= y - 1; yy++) w.put(x + dx, yy, z + dz, yy === y - 1 ? block : B.DIRT, true);
        for (let yy = y; yy <= y + 8; yy++) w.put(x + dx, yy, z + dz, B.AIR, true);
      }
  };

  switch (p.type) {
    case 'stone_circle': {
      foundation(7, B.GRASS);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + p.rot;
        const px = x + Math.round(Math.cos(a) * 5.5);
        const pz = z + Math.round(Math.sin(a) * 5.5);
        const h = 2 + Math.floor(rng() * 3);
        for (let k = 0; k < h; k++) w.put(px, y + k, pz, rng() < 0.5 ? id.mossy : id.fieldstone, true);
      }
      w.put(x, y, z, id.lore, true, p.rot);
      break;
    }
    case 'ruin': {
      foundation(5, B.GRASS);
      for (let dz = -4; dz <= 4; dz++)
        for (let dx = -4; dx <= 4; dx++) {
          const edge = Math.abs(dx) === 4 || Math.abs(dz) === 4;
          if (!edge) {
            if (rng() < 0.6) w.put(x + dx, y - 1, z + dz, id.mossy, true);
            continue;
          }
          const h = Math.floor(rng() * 4);
          for (let k = 0; k < h; k++) w.put(x + dx, y + k, z + dz, rng() < 0.4 ? id.mossy : id.fieldstone, true);
        }
      w.put(x + 2, y, z + 2, id.chest, true, p.rot);
      w.put(x - 2, y, z - 1, id.lore, true, p.rot);
      break;
    }
    case 'campsite': {
      foundation(4, B.GRASS);
      w.put(x, y, z, id.fire, true);
      w.put(x + 2, y, z, id.log, true);
      w.put(x - 2, y, z + 1, id.log, true);
      w.put(x + 1, y, z - 2, rug, true);
      w.put(x, y, z - 3, id.chest, true, 0);
      w.put(x - 3, y, z - 2, id.lore, true, 1);
      break;
    }
    case 'hollow_tree': {
      foundation(4, B.LEAF_LITTER);
      const h = 14;
      for (let k = 0; k < h; k++)
        for (let dz = -2; dz <= 2; dz++)
          for (let dx = -2; dx <= 2; dx++) {
            const ring = Math.max(Math.abs(dx), Math.abs(dz)) === 2;
            const corner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
            if (corner) continue;
            const doorway = dz === 2 && dx === 0 && k < 3;
            if (ring && !doorway) w.put(x + dx, y + k, z + dz, id.log, true);
            else w.put(x + dx, y + k, z + dz, B.AIR, true);
          }
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) w.put(x + dx, y + h, z + dz, id.log, true);
      for (let i = 0; i < 5; i++) {
        const ox = Math.floor(rng() * 9) - 4, oz = Math.floor(rng() * 9) - 4;
        buildCanopy(w, x + ox, y + h + 1 + Math.floor(rng() * 2), z + oz, rng);
      }
      w.put(x, y, z - 1, id.chest, true, 0);
      w.put(x + 1, y, z, id.torch, true);
      w.put(x - 1, y, z, id.lore, true, 0);
      break;
    }
    case 'crystal_spire': {
      foundation(3, B.GRASS);
      const h = 10 + Math.floor(rng() * 8);
      for (let k = 0; k < h; k++) {
        const r = Math.max(0, 2 - Math.floor(k / 5));
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) + Math.abs(dz) > r + 1) continue;
            w.put(x + dx, y + k, z + dz, rng() < 0.18 ? id.glowOre : id.crystalStone, true);
          }
      }
      for (let i = 0; i < 10; i++) {
        const ox = Math.floor(rng() * 9) - 4, oz = Math.floor(rng() * 9) - 4;
        if (Math.abs(ox) < 3 && Math.abs(oz) < 3) continue;
        w.put(x + ox, y, z + oz, id.cluster);
      }
      w.put(x + 3, y, z, id.lore, true, 3);
      break;
    }
    case 'forgotten_cabin': {
      foundation(5, B.GRASS);
      // floor
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) w.put(x + dx, y - 1, z + dz, id.planks, true);
      for (let k = 0; k < 4; k++)
        for (let dz = -3; dz <= 3; dz++)
          for (let dx = -3; dx <= 3; dx++) {
            const edge = Math.abs(dx) === 3 || Math.abs(dz) === 3;
            if (!edge) continue;
            const corner = Math.abs(dx) === 3 && Math.abs(dz) === 3;
            if (dz === 3 && dx === 0 && k < 2) continue; // doorway
            if (k === 1 && !corner && (dx === 0 || dz === 0) && !(dz === 3)) {
              w.put(x + dx, y + k, z + dz, window, true, Math.abs(dx) === 3 ? 1 : 0);
              continue;
            }
            if (rng() < 0.06 && k > 1) continue; // weathered gaps
            w.put(x + dx, y + k, z + dz, corner ? id.log : id.planks, true);
          }
      for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
        const level = 4 - Math.max(0, Math.max(Math.abs(dx), Math.abs(dz)) - 2);
        w.put(x + dx, y + Math.max(4, level + 2), z + dz, id.thatch, true);
      }
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) w.put(x + dx, y + 4, z + dz, id.thatch, true);
      w.put(x, y, z + 3, id.door, true, 0);
      w.put(x, y + 1, z + 3, id.doorUp, true, 0);
      w.put(x - 2, y, z - 2, id.bed, true, 0);
      w.put(x + 2, y, z - 2, id.chest, true, 0);
      w.put(x + 1, y, z, table, true);
      w.put(x + 2, y, z, chair, true, 3);
      w.put(x, y, z, rug, true);
      w.put(x - 2, y, z + 1, id.lore, true, 1);
      w.put(x + 2, y + 2, z + 2, B.LANTERN, true);
      break;
    }
    case 'flower_valley': {
      const flowers = [B.FLOWER_SUN, B.FLOWER_SKY, B.FLOWER_EMBER];
      for (let dz = -11; dz <= 11; dz++)
        for (let dx = -11; dx <= 11; dx++) {
          if (dx * dx + dz * dz > 121) continue;
          if (rng() > 0.55) continue;
          const col = sampler.sample(x + dx, z + dz);
          if (col.waterLevel > 0) continue;
          w.put(x + dx, col.height + 1, z + dz, flowers[Math.floor(rng() * 3)]);
        }
      w.put(x, y, z, id.lore, true, 0);
      break;
    }
    case 'sky_pillar': {
      const h = 18 + Math.floor(rng() * 10);
      for (let k = -4; k < h; k++) {
        const r = k > h - 3 ? 3 : 2;
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dz * dz > r * r + 1) continue;
            w.put(x + dx, y + k, z + dz, rng() < 0.2 ? id.mossy : k > h - 2 ? B.GRASS : B.STONE, true);
          }
      }
      w.put(x, y + h, z, id.chest, true, p.rot);
      w.put(x + 1, y + h, z + 1, id.lore, true, 0);
      buildTree('pine', x - 2, y + h, z - 1, p.seed, w);
      break;
    }
  }
}

function buildCanopy(w: BlockWriter, x: number, y: number, z: number, rng: () => number) {
  for (let dy = -1; dy <= 2; dy++)
    for (let dz = -3; dz <= 3; dz++)
      for (let dx = -3; dx <= 3; dx++) {
        const d = dx * dx + dz * dz + dy * dy * 2;
        if (d > 10 || (d > 7 && rng() < 0.3)) continue;
        w.put(x + dx, y + dy, z + dz, B.LEAVES);
      }
}
