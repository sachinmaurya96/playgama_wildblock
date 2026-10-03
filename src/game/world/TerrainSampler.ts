import { BIOMES, type BiomeDef } from '../../data/biomes';
import { clamp, hash2, lerp, smoothstep } from '../core/random';
import { SEA_LEVEL, WORLD_HEIGHT } from './constants';
import { SimplexNoise } from './noise';

/**
 * Column sampler: everything about one (x, z) world column that does not depend
 * on neighbouring blocks. Pure & deterministic — used by chunk workers, the spawn
 * finder, the map and tests.
 */
export interface ColumnSample {
  height: number;
  /** Water surface level for this column (0 = no water). Water fills height+1..waterLevel. */
  waterLevel: number;
  /** Dominant biome index into BIOMES. */
  biome: number;
  /** Per-column dithered biome choice used for surface blocks (soft borders). */
  surfaceBiome: number;
  weights: Float32Array;
  /** 0..1 how much this column is part of a river channel. */
  river: number;
  /** 0..1 lake basin factor. */
  lake: number;
  /** 0..1 land (vs ocean). */
  land: number;
  grassTint: [number, number, number];
  foliageTint: [number, number, number];
  waterTint: [number, number, number];
}

const BIOME_COUNT = BIOMES.length;
const IDX = { meadow: 0, forest: 1, pine: 2, coast: 3, canyon: 4, crystal: 5 };

export class TerrainSampler {
  readonly seed: number;
  private continental: SimplexNoise;
  private elevation: SimplexNoise;
  private detail: SimplexNoise;
  private temperature: SimplexNoise;
  private humidity: SimplexNoise;
  private riverNoise: SimplexNoise;
  private warp: SimplexNoise;
  private rare: SimplexNoise;
  private lakeNoise: SimplexNoise;
  private erosion: SimplexNoise;
  readonly cave: SimplexNoise;
  readonly cave2: SimplexNoise;
  readonly chamber: SimplexNoise;
  /** Extra noise for caves v2 (long tunnels + ravines). */
  readonly tunnel: SimplexNoise;
  readonly tunnel2: SimplexNoise;
  readonly ravine: SimplexNoise;

  constructor(seed: number, readonly caveVersion = 1) {
    this.seed = seed >>> 0;
    const s = this.seed;
    this.continental = new SimplexNoise(s ^ 0x1234567);
    this.elevation = new SimplexNoise(s ^ 0x2345678);
    this.detail = new SimplexNoise(s ^ 0x3456789);
    this.temperature = new SimplexNoise(s ^ 0x456789a);
    this.humidity = new SimplexNoise(s ^ 0x56789ab);
    this.riverNoise = new SimplexNoise(s ^ 0x6789abc);
    this.warp = new SimplexNoise(s ^ 0x789abcd);
    this.rare = new SimplexNoise(s ^ 0x89abcde);
    this.lakeNoise = new SimplexNoise(s ^ 0x9abcdef);
    this.erosion = new SimplexNoise(s ^ 0x0fedcba);
    this.cave = new SimplexNoise(s ^ 0x1a2b3c4);
    this.cave2 = new SimplexNoise(s ^ 0x2b3c4d5);
    this.chamber = new SimplexNoise(s ^ 0x3c4d5e6);
    this.tunnel = new SimplexNoise(s ^ 0x4d5e6f7);
    this.tunnel2 = new SimplexNoise(s ^ 0x5e6f708);
    this.ravine = new SimplexNoise(s ^ 0x6f70819);
  }

  /**
   * Caves v2 ravines: the lowest y carved open at this column (999 = no ravine).
   * Long, narrow cracks up to ~28 blocks deep; only on dry land.
   */
  ravineBottom(x: number, z: number, height: number): number {
    if (this.caveVersion < 2) return 999;
    const rn = Math.abs(this.ravine.noise2D(x / 150, z / 150));
    if (rn >= 0.05) return 999;
    const gate = this.ravine.noise2D(x / 400 + 31.7, z / 400 - 12.3);
    if (gate <= 0.25) return 999;
    const k = 1 - rn / 0.05; // 1 at the centre line
    return Math.max(6, height - Math.round(6 + 22 * k * Math.min(1, (gate - 0.25) * 4)));
  }

  /** Continentalness in -1..1; below ~-0.25 becomes ocean. The spawn region is nudged to land. */
  landFactor(x: number, z: number): number {
    let c = this.continental.fbm2D(x / 1100, z / 1100, 3) * 0.9 + 0.12;
    // Guarantee a friendly landmass around the origin.
    const d = Math.sqrt(x * x + z * z);
    c += (1 - smoothstep(150, 420, d)) * 0.35;
    return smoothstep(-0.3, -0.08, c);
  }

  biomeWeights(x: number, z: number, land: number, out: Float32Array): void {
    const wx = x + this.warp.noise2D(x / 180, z / 180) * 40;
    const wz = z + this.warp.noise2D(z / 180 + 50, x / 180) * 40;
    let t = this.temperature.fbm2D(wx / 720, wz / 720, 2) * 1.25;
    let h = this.humidity.fbm2D(wx / 640 + 100, wz / 640, 2) * 1.25;
    const d = Math.sqrt(x * x + z * z);
    // Spawn region leans toward temperate meadow/forest.
    const spawnPull = 1 - smoothstep(60, 260, d);
    t = lerp(t, 0.2, spawnPull * 0.8);
    h = lerp(h, 0.3, spawnPull * 0.8);
    let sum = 0;
    for (let i = 0; i < BIOME_COUNT; i++) {
      const b = BIOMES[i];
      const dt = t - b.climate[0];
      const dh = h - b.climate[1];
      let w = Math.exp(-(dt * dt + dh * dh) / 0.16);
      if (i === IDX.coast) w = 0;
      if (i === IDX.crystal) {
        const r = this.rare.fbm2D(x / 520, z / 520, 2);
        w *= smoothstep(0.32, 0.5, r) * 3 * (1 - spawnPull);
      }
      if (i === IDX.canyon) w *= 1 - spawnPull;
      out[i] = w;
      sum += w;
    }
    if (sum < 1e-5) {
      out[IDX.meadow] = 1;
      sum = 1;
    }
    for (let i = 0; i < BIOME_COUNT; i++) out[i] /= sum;
    // Coasts appear where land meets ocean.
    const coast = (1 - land) * 0.9 + (land < 1 ? smoothstep(1, 0.6, land) * 0.6 : 0);
    if (coast > 0) {
      for (let i = 0; i < BIOME_COUNT; i++) out[i] *= 1 - clamp(coast, 0, 1);
      out[IDX.coast] = clamp(coast, 0, 1);
    }
  }

  sample(x: number, z: number): ColumnSample {
    const weights = new Float32Array(BIOME_COUNT);
    const land = this.landFactor(x, z);
    this.biomeWeights(x, z, land, weights);

    let base = 0, scale = 0, rough = 0, terrace = 0;
    const grass: [number, number, number] = [0, 0, 0];
    const foliage: [number, number, number] = [0, 0, 0];
    const water: [number, number, number] = [0, 0, 0];
    let dominant = 0;
    let best = -1;
    for (let i = 0; i < BIOME_COUNT; i++) {
      const w = weights[i];
      if (w <= 0) continue;
      const b: BiomeDef = BIOMES[i];
      base += b.baseHeight * w;
      scale += b.heightScale * w;
      rough += b.roughness * w;
      terrace += b.terrace * w;
      for (let c = 0; c < 3; c++) {
        grass[c] += b.grassTint[c] * w;
        foliage[c] += b.foliageTint[c] * w;
        water[c] += b.waterTint[c] * w;
      }
      if (w > best) {
        best = w;
        dominant = i;
      }
    }

    // Layered elevation: broad hills + erosion-shaped detail.
    const e = this.elevation.fbm2D(x / 260, z / 260, 4, 2, 0.5);
    const erosion = smoothstep(-0.4, 0.6, this.erosion.fbm2D(x / 500, z / 500, 2));
    const det = this.detail.fbm2D(x / 60, z / 60, 3, 2, rough);
    let height = base + e * scale * (0.6 + erosion * 0.6) + det * scale * 0.25;
    // Plateaus / cliffs.
    if (terrace > 0.05) {
      const step = 7;
      const k = height / step;
      const fl = Math.floor(k);
      const frac = k - fl;
      const terraced = (fl + smoothstep(0.35, 0.65, frac)) * step;
      height = lerp(height, terraced, terrace);
    }
    // Ocean floor.
    const oceanFloor = SEA_LEVEL - 10 + this.detail.noise2D(x / 90, z / 90) * 4;
    height = lerp(oceanFloor, height, land);

    // Smooth reference height used for river and lake water levels.
    const smoothRef = lerp(oceanFloor, base + e * scale * 0.9, land);
    let waterLevel = 0;
    let river = 0;
    let lake = 0;

    if (height <= SEA_LEVEL) waterLevel = SEA_LEVEL;

    // Rivers: thin bands where warped noise crosses zero.
    if (land > 0.35) {
      const rwx = x + this.warp.noise2D(x / 140, z / 140) * 55;
      const rwz = z + this.warp.noise2D(z / 140 + 9, x / 140 + 3) * 55;
      const r = Math.abs(this.riverNoise.fbm2D(rwx / 520, rwz / 520, 2));
      const width = 0.018 + 0.012 * (this.detail.noise2D(x / 200, z / 200) + 1) * 0.5;
      const bank = width * 2.8;
      if (r < bank) {
        const level = SEA_LEVEL + Math.max(0, Math.floor((smoothRef - SEA_LEVEL - 2) / 6) * 6);
        const valley = smoothstep(bank, width, r);
        const landFade = smoothstep(0.35, 0.6, land);
        if (r < width) {
          river = (1 - r / width) * landFade;
          const depth = 1 + Math.round(3 * (1 - r / width));
          const bed = level - depth;
          height = lerp(height, bed, landFade);
          if (landFade > 0.5) waterLevel = Math.max(waterLevel, level);
        } else {
          // Valley walls: pull toward the river level but keep banks above water.
          const target = Math.max(level + 1, lerp(height, level + 1.5, valley * 0.85));
          height = lerp(height, Math.max(target, level + 1), landFade * valley);
        }
      } else if (r < bank * 2.2) {
        // Just outside the valley: never dip below the river surface (no hanging water walls).
        const level = SEA_LEVEL + Math.max(0, Math.floor((smoothRef - SEA_LEVEL - 2) / 6) * 6);
        const k = smoothstep(bank * 2.2, bank, r) * smoothstep(0.35, 0.6, land);
        if (height < level + 1) height = lerp(height, level + 1, k > 0.01 ? 1 : 0);
      }
    }

    // Lakes and ponds.
    if (land > 0.7 && river === 0) {
      const ln = this.lakeNoise.fbm2D(x / 150, z / 150, 2);
      if (ln > 0.5) {
        // Quantised like rivers so a lake surface is flat (steps between terraces become cascades).
        const level = SEA_LEVEL + Math.max(0, Math.floor((smoothRef - SEA_LEVEL - 1) / 6) * 6);
        const f = smoothstep(0.5, 0.64, ln);
        if (f >= 0.5) {
          lake = f;
          height = Math.min(height, level - 1 - Math.round((f - 0.5) * 8));
          waterLevel = Math.max(waterLevel, level);
        } else {
          height = Math.max(level + 1, lerp(height, level + 1, f * 2));
        }
      }
    }

    height = clamp(Math.floor(height), 4, WORLD_HEIGHT - 20);

    // Dithered surface biome for soft ground transitions.
    let pick = hash2(x, z, this.seed ^ 0xabc) * 0.999;
    let surfaceBiome = dominant;
    for (let i = 0; i < BIOME_COUNT; i++) {
      pick -= weights[i];
      if (pick <= 0) {
        surfaceBiome = i;
        break;
      }
    }

    const tintJitter = this.detail.noise2D(x / 40 + 300, z / 40) * 0.04;
    for (let c = 0; c < 3; c++) {
      grass[c] = clamp(grass[c] + tintJitter, 0, 1);
      foliage[c] = clamp(foliage[c] + tintJitter, 0, 1);
    }

    return {
      height, waterLevel: waterLevel > height ? waterLevel : 0, biome: dominant, surfaceBiome, weights, river, lake, land,
      grassTint: grass, foliageTint: foliage, waterTint: water,
    };
  }
}
