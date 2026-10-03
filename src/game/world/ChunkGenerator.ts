import { BIOMES } from '../../data/biomes';
import { BLOCK_DEFS } from '../../data/blocks';
import { hash2, hash3 } from '../core/random';
import { B, blockId, isReplaceable } from './BlockRegistry';
import { CHUNK_SIZE, CHUNK_VOLUME, SEA_LEVEL, WORLD_HEIGHT } from './constants';
import { localIndex } from './coordinates';
import type { ChunkGenResult, LandmarkInfo, WaterfallInfo } from './Chunk';
import { buildLandmark, LANDMARK_REACH, LANDMARK_REGION, planLandmark } from './StructureGenerator';
import type { ColumnSample, TerrainSampler } from './TerrainSampler';
import { buildTree, type BlockWriter } from './TreeGenerator';

const S = CHUNK_SIZE;
const TREE_CELL = 3;

const flowerIds = new Map<string, number>();
function flowerId(key: string): number {
  let v = flowerIds.get(key);
  if (v === undefined) {
    v = blockId(key);
    flowerIds.set(key, v);
  }
  return v;
}

/** Writer that clips world-space writes to a single chunk. */
export class ChunkWriter implements BlockWriter {
  constructor(private blocks: Uint8Array, private meta: Uint8Array, private ox: number, private oz: number) {}
  put(x: number, y: number, z: number, id: number, hard = false, meta = 0): void {
    const lx = x - this.ox;
    const lz = z - this.oz;
    if (lx < 0 || lx >= S || lz < 0 || lz >= S || y < 1 || y >= WORLD_HEIGHT) return;
    const i = localIndex(lx, y, lz);
    const cur = this.blocks[i];
    if (!hard && !isReplaceable(cur) && cur !== B.WATER) return;
    if (!hard && cur === B.WATER) return;
    this.blocks[i] = id;
    this.meta[i] = meta;
  }
}

/**
 * Generates one chunk deterministically from the seed. Runs inside a Web Worker
 * (terrain.worker) but is plain TypeScript so it is unit-testable.
 */
export function generateChunk(cx: number, cz: number, sampler: TerrainSampler): ChunkGenResult {
  const seed = sampler.seed;
  const blocks = new Uint8Array(CHUNK_VOLUME);
  const meta = new Uint8Array(CHUNK_VOLUME);
  const heightmap = new Uint8Array(S * S);
  const biomes = new Uint8Array(S * S);
  const tints = new Uint8Array(S * S * 9);
  const mapColors = new Uint8Array(S * S * 3);
  const ox = cx * S;
  const oz = cz * S;

  // Column cache with a 1-block border for waterfall detection; extra lookups go through `col()`.
  const cache = new Map<number, ColumnSample>();
  const col = (x: number, z: number): ColumnSample => {
    const k = (x + 32768) * 65536 + (z + 32768);
    let c = cache.get(k);
    if (!c) {
      c = sampler.sample(x, z);
      cache.set(k, c);
    }
    return c;
  };

  // ---------------------------------------------------------------- terrain
  for (let lz = 0; lz < S; lz++) {
    for (let lx = 0; lx < S; lx++) {
      const wx = ox + lx;
      const wz = oz + lz;
      const c = col(wx, wz);
      const h = c.height;
      const sb = BIOMES[c.surfaceBiome];
      const underwater = c.waterLevel > h;
      const colIdx = lz * S + lx;
      biomes[colIdx] = c.biome;
      const surface = blockId(sb.surface);
      const sub = blockId(sb.subsurface);
      const isCanyon = sb.id === 'canyon';
      const beach = !underwater && h <= SEA_LEVEL + 1 && c.land < 0.95;
      const snowy = (sb.id === 'pine' && h > 84 + hash2(wx, wz, seed) * 4) || (sb.id === 'crystal' && h > 94);
      const forestFloor = sb.id === 'forest' && hash2(wx, wz, seed ^ 5) < 0.45;

      blocks[localIndex(lx, 0, lz)] = B.DEEPSTONE;
      for (let y = 1; y <= h; y++) {
        const depth = h - y;
        let id: number;
        if (y <= 2 && hash3(wx, y, wz, seed) < 0.5) id = B.DEEPSTONE;
        else if (underwater && depth === 0) {
          const r = hash2(wx, wz, seed ^ 11);
          id = c.lake > 0 ? (r < 0.5 ? B.CLAY : B.SAND) : c.river > 0 ? (r < 0.45 ? B.GRAVEL : r < 0.6 ? B.CLAY : B.SAND) : B.SAND;
        } else if (underwater && depth < 3) id = B.SAND;
        else if (beach && depth < 4) id = B.SAND;
        else if (isCanyon && depth < 26) id = (y % 5 < 2) ? B.AMBER_BANDED : B.AMBERSTONE;
        else if (depth === 0) id = snowy ? B.SNOW : forestFloor && surface === B.GRASS ? B.LEAF_LITTER : surface;
        else if (depth < 4) id = sub === B.SAND && depth > 2 ? B.STONE : sub;
        else id = B.STONE;
        blocks[localIndex(lx, y, lz)] = id;
      }
      if (underwater) {
        for (let y = h + 1; y <= c.waterLevel && y < WORLD_HEIGHT; y++) blocks[localIndex(lx, y, lz)] = B.WATER;
      }

      // tints
      const t = colIdx * 9;
      for (let k = 0; k < 3; k++) {
        tints[t + k] = Math.round(c.grassTint[k] * 255);
        tints[t + 3 + k] = Math.round(c.foliageTint[k] * 255);
        tints[t + 6 + k] = Math.round(c.waterTint[k] * 255);
      }
    }
  }

  // ---------------------------------------------------------------- caves + ores
  const cave = sampler.cave;
  const cave2 = sampler.cave2;
  const chamber = sampler.chamber;
  const v2 = sampler.caveVersion >= 2;
  for (let lz = 0; lz < S; lz++) {
    for (let lx = 0; lx < S; lx++) {
      const wx = ox + lx;
      const wz = oz + lz;
      const c = col(wx, wz);
      const dry = c.waterLevel === 0 && c.river === 0;
      const entrance = cave.noise2D(wx / 70, wz / 70) > (v2 ? 0.5 : 0.62) && dry;
      // caves v2: ravines — long, narrow cracks open to the sky, up to ~28 blocks deep
      const ravineBottom = v2 && dry ? sampler.ravineBottom(wx, wz, c.height) : 999;
      const ceiling = c.waterLevel > 0 ? c.height - 8 : entrance || ravineBottom < 999 ? c.height : c.height - (v2 ? 4 : 5);
      const crystalBiome = c.biome === 5;
      for (let y = 3; y <= ceiling; y++) {
        const i = localIndex(lx, y, lz);
        const cur = blocks[i];
        if (cur === B.WATER || cur === B.DEEPSTONE) continue;
        const n1 = cave.noise3D(wx / 34, y / 22, wz / 34);
        const n2 = cave2.noise3D(wx / 34, y / 22, wz / 34);
        let carve = n1 * n1 + n2 * n2 < (v2 ? 0.017 : 0.011);
        if (!carve && y < (v2 ? 50 : 42)) carve = chamber.noise3D(wx / (v2 ? 30 : 26), y / (v2 ? 15 : 13), wz / (v2 ? 30 : 26)) > (v2 ? 0.52 : 0.58);
        if (!carve && v2 && y < c.height - 10) {
          // a second, longer tunnel network (wide winding passages between cave systems)
          const t1 = sampler.tunnel.noise3D(wx / 58, y / 30, wz / 58);
          const t2 = sampler.tunnel2.noise3D(wx / 58, y / 30, wz / 58);
          carve = t1 * t1 + t2 * t2 < 0.008;
        }
        if (!carve && y >= ravineBottom) carve = true;
        if (carve) {
          blocks[i] = y <= 9 ? B.WATER : B.AIR;
          continue;
        }
        if (cur !== B.STONE && cur !== B.AMBERSTONE && cur !== B.AMBER_BANDED && cur !== B.CRYSTAL_STONE) continue;
        const vx = wx >> 1, vy = y >> 1, vz = wz >> 1;
        const fine = hash3(wx, y, wz, seed ^ 0x77) < 0.75;
        if (!fine) continue;
        const canyonBoost = c.biome === 4 ? 2 : 1;
        if (y < 14 && hash3(vx, vy, vz, seed ^ 0x501) < 0.0025) blocks[i] = B.MOON_ORE;
        else if ((y < 26 || (crystalBiome && y < 70)) && hash3(vx, vy, vz, seed ^ 0x502) < (crystalBiome ? 0.014 : 0.005)) blocks[i] = B.GLOW_ORE;
        else if (y < 40 && hash3(vx, vy, vz, seed ^ 0x503) < 0.007) blocks[i] = B.FERRA_ORE;
        else if (y < 60 && hash3(vx, vy, vz, seed ^ 0x504) < 0.011 * canyonBoost) blocks[i] = B.COPPER_ORE;
        else if (y < 75 && hash3(vx, vy, vz, seed ^ 0x505) < 0.013 * canyonBoost) blocks[i] = B.EMBER_ORE;
      }
    }
  }

  // Crystal clusters / mushrooms on cave floors.
  for (let lz = 0; lz < S; lz++)
    for (let lx = 0; lx < S; lx++) {
      const wx = ox + lx, wz = oz + lz;
      const c = col(wx, wz);
      for (let y = 4; y < c.height - 3; y++) {
        const i = localIndex(lx, y, lz);
        if (blocks[i] !== B.AIR) continue;
        const below = blocks[localIndex(lx, y - 1, lz)];
        if (below !== B.STONE && below !== B.CRYSTAL_STONE && below !== B.AMBERSTONE) continue;
        const r = hash3(wx, y, wz, seed ^ 0x919);
        if (r < (c.biome === 5 ? 0.06 : y < 30 ? 0.018 : 0)) blocks[i] = B.CRYSTAL_CLUSTER;
        else if (r > 0.985) blocks[i] = B.MUSHROOM;
      }
    }

  // ---------------------------------------------------------------- surface decoration
  for (let lz = 0; lz < S; lz++)
    for (let lx = 0; lx < S; lx++) {
      const wx = ox + lx, wz = oz + lz;
      const c = col(wx, wz);
      if (c.waterLevel > 0) continue;
      const y = c.height + 1;
      if (y >= WORLD_HEIGHT) continue;
      const top = blocks[localIndex(lx, c.height, lz)];
      if (blocks[localIndex(lx, y, lz)] !== B.AIR) continue;
      const b = BIOMES[c.surfaceBiome];
      const r = hash2(wx, wz, seed ^ 0x3131);
      const grassy = top === B.GRASS || top === B.LEAF_LITTER;
      if (r < b.flowerDensity && (grassy || top === B.SAND || top === B.AMBERSTONE || top === B.AMBER_BANDED)) {
        let total = 0;
        for (const f of b.flowers) total += f.weight;
        let pick = hash2(wz, wx, seed ^ 0x3232) * total;
        for (const f of b.flowers) {
          pick -= f.weight;
          if (pick <= 0) {
            const fid = flowerId(f.key);
            if (fid === B.SHELL && top !== B.SAND) break;
            if (fid !== B.SHELL && fid !== B.DRY_SHRUB && fid !== B.CRYSTAL_CLUSTER && !grassy) break;
            blocks[localIndex(lx, y, lz)] = fid;
            if (fid === B.BERRY_BUSH) meta[localIndex(lx, y, lz)] = 1 << 3; // ripe
            const growth = BLOCK_DEFS[fid].growth;
            if (growth) meta[localIndex(lx, y, lz)] = (growth.stages - 1) << 3; // wild crops are mature
            break;
          }
        }
      } else if (grassy && r > 0.965 && (col(wx + 1, wz).waterLevel > 0 || col(wx - 1, wz).waterLevel > 0 || col(wx, wz + 1).waterLevel > 0 || col(wx, wz - 1).waterLevel > 0)) {
        // brookmint grows wild on river banks
        blocks[localIndex(lx, y, lz)] = B.CROP_MINT;
        meta[localIndex(lx, y, lz)] = 3 << 3;
      } else if (grassy && r < b.flowerDensity + b.grassDensity) {
        blocks[localIndex(lx, y, lz)] = B.TALL_GRASS;
      } else if ((b.id === 'meadow' || b.id === 'pine') && r > 0.9975 && grassy) {
        // Small boulders make stone visible from the start.
        const w = new ChunkWriter(blocks, meta, ox, oz);
        w.put(wx, y, wz, B.STONE, true);
        if (r > 0.9985) w.put(wx, y + 1, wz, B.FIELDSTONE, true);
      }
    }

  // ---------------------------------------------------------------- trees (with neighbour overlap)
  const writer = new ChunkWriter(blocks, meta, ox, oz);
  const minCell = Math.floor((ox - 5) / TREE_CELL);
  const maxCell = Math.floor((ox + S + 5) / TREE_CELL);
  const minCellZ = Math.floor((oz - 5) / TREE_CELL);
  const maxCellZ = Math.floor((oz + S + 5) / TREE_CELL);
  for (let gz = minCellZ; gz <= maxCellZ; gz++)
    for (let gx = minCell; gx <= maxCell; gx++) {
      const tx = gx * TREE_CELL + Math.floor(hash2(gx, gz, seed ^ 0x7101) * TREE_CELL);
      const tz = gz * TREE_CELL + Math.floor(hash2(gz, gx, seed ^ 0x7102) * TREE_CELL);
      const c = col(tx, tz);
      if (c.waterLevel > 0 || c.river > 0) continue;
      const b = BIOMES[c.biome];
      // Groves: a low-frequency noise clusters trees so meadows have open clearings.
      const grove = (sampler.chamber.noise2D(tx / 46 + 500, tz / 46 - 300) + 1) * 0.5;
      const chance = Math.min(1, b.treeDensity * TREE_CELL * TREE_CELL * (0.25 + grove * grove * 2.2));
      if (hash2(tx, tz, seed ^ 0x7103) >= chance) continue;
      // Avoid steep ground.
      const hx = col(tx + 1, tz).height, hz = col(tx, tz + 1).height;
      if (Math.abs(hx - c.height) > 2 || Math.abs(hz - c.height) > 2) continue;
      // no trees growing out of thin air over a ravine
      if (sampler.caveVersion >= 2 && (sampler.ravineBottom(tx, tz, c.height) < 999 || sampler.ravineBottom(tx + 2, tz, c.height) < 999 || sampler.ravineBottom(tx - 2, tz, c.height) < 999 || sampler.ravineBottom(tx, tz + 2, c.height) < 999 || sampler.ravineBottom(tx, tz - 2, c.height) < 999)) continue;
      if (b.id === 'coast' && c.height > SEA_LEVEL + 5) continue;
      let total = 0;
      for (const t of b.trees) total += t.weight;
      let pick = hash2(tz, tx, seed ^ 0x7104) * total;
      let kind = b.trees[0].kind;
      for (const t of b.trees) {
        pick -= t.weight;
        if (pick <= 0) {
          kind = t.kind;
          break;
        }
      }
      buildTree(kind, tx, c.height + 1, tz, seed, writer);
    }

  // ---------------------------------------------------------------- landmarks
  const landmarks: LandmarkInfo[] = [];
  const rMin = Math.floor((ox - LANDMARK_REACH) / LANDMARK_REGION);
  const rMax = Math.floor((ox + S + LANDMARK_REACH) / LANDMARK_REGION);
  const rMinZ = Math.floor((oz - LANDMARK_REACH) / LANDMARK_REGION);
  const rMaxZ = Math.floor((oz + S + LANDMARK_REACH) / LANDMARK_REGION);
  for (let rz = rMinZ; rz <= rMaxZ; rz++)
    for (let rx = rMin; rx <= rMax; rx++) {
      const plan = planLandmark(rx, rz, sampler);
      if (!plan) continue;
      if (plan.x + LANDMARK_REACH < ox || plan.x - LANDMARK_REACH >= ox + S) continue;
      if (plan.z + LANDMARK_REACH < oz || plan.z - LANDMARK_REACH >= oz + S) continue;
      buildLandmark(plan, sampler, writer);
      if (plan.x >= ox && plan.x < ox + S && plan.z >= oz && plan.z < oz + S) {
        landmarks.push({ type: plan.type, x: plan.x, y: plan.y, z: plan.z });
      }
    }

  // ---------------------------------------------------------------- heightmap, map colors
  for (let lz = 0; lz < S; lz++)
    for (let lx = 0; lx < S; lx++) {
      let top = 0;
      let topId = 0;
      for (let y = WORLD_HEIGHT - 1; y > 0; y--) {
        const id = blocks[localIndex(lx, y, lz)];
        if (id !== 0) {
          top = y;
          topId = id;
          break;
        }
      }
      const ci = lz * S + lx;
      heightmap[ci] = top;
      const [r, g, bl] = mapColorFor(topId, top, tints, ci);
      mapColors[ci * 3] = r;
      mapColors[ci * 3 + 1] = g;
      mapColors[ci * 3 + 2] = bl;
    }

  // ---------------------------------------------------------------- waterfalls
  const waterfalls: WaterfallInfo[] = [];
  for (let lz = 0; lz < S; lz++)
    for (let lx = 0; lx < S; lx++) {
      const wx = ox + lx, wz = oz + lz;
      const c = col(wx, wz);
      if (c.waterLevel === 0) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = col(wx + dx, wz + dz);
        if (n.waterLevel > 0 && c.waterLevel - n.waterLevel >= 3) {
          waterfalls.push({ x: wx, z: wz, top: c.waterLevel, bottom: n.waterLevel, dx, dz });
        }
      }
    }

  return { cx, cz, blocks, meta, heightmap, biomes, tints, mapColors, waterfalls, landmarks };
}

export function mapColorFor(id: number, y: number, tints: Uint8Array, ci: number): [number, number, number] {
  let r = 120, g = 120, b = 120;
  const shade = 0.75 + Math.min(0.4, (y - SEA_LEVEL) / 120);
  switch (id) {
    case B.WATER: {
      const t = ci * 9 + 6;
      return [tints[t] * 0.8, tints[t + 1] * 0.85, Math.min(255, tints[t + 2] * 1.05)];
    }
    case B.GRASS: case B.TALL_GRASS: case B.FLOWER_SUN: case B.FLOWER_SKY: case B.FLOWER_EMBER: case B.BERRY_BUSH: {
      const t = ci * 9;
      r = tints[t]; g = tints[t + 1]; b = tints[t + 2];
      break;
    }
    case B.LEAVES: case B.PINE_NEEDLES: case B.PALM_FRONDS: case B.LEAF_LITTER: {
      const t = ci * 9 + 3;
      r = tints[t] * 0.8; g = tints[t + 1] * 0.8; b = tints[t + 2] * 0.8;
      break;
    }
    case B.BIRCH_LEAVES: r = 170; g = 200; b = 110; break;
    case B.BLOSSOM_LEAVES: r = 240; g = 170; b = 190; break;
    case B.SAND: case B.SHELL: r = 226; g = 208; b = 150; break;
    case B.AMBERSTONE: case B.AMBER_BANDED: case B.DRY_SHRUB: r = 210; g = 130; b = 70; break;
    case B.SNOW: r = 240; g = 244; b = 250; break;
    case B.CRYSTAL_STONE: case B.CRYSTAL_CLUSTER: r = 150; g = 210; b = 220; break;
    case B.STONE: case B.FIELDSTONE: case B.MOSSY_FIELDSTONE: r = 140; g = 140; b = 135; break;
    case B.LOG: case B.PLANKS: case B.THATCH: r = 150; g = 110; b = 70; break;
    default: break;
  }
  return [Math.min(255, r * shade), Math.min(255, g * shade), Math.min(255, b * shade)];
}
