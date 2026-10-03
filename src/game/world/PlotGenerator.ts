import { archIndex } from '../../data/architecture';
import { BIOMES, type TreeKind } from '../../data/biomes';
import type { PlotType } from '../../persistence/types';
import { hash2, smoothstep } from '../core/random';
import { B } from './BlockRegistry';
import { CHUNK_SIZE, CHUNK_VOLUME, WORLD_HEIGHT } from './constants';
import { localIndex } from './coordinates';
import type { ChunkGenResult } from './Chunk';
import { ChunkWriter, mapColorFor } from './ChunkGenerator';
import { SimplexNoise } from './noise';
import { buildTree } from './TreeGenerator';

/**
 * Build Home world generator: a perfectly flat construction lot surrounded by
 * a paved perimeter path and a hedge, with plot-specific scenery beyond it
 * (rolling meadow, coast & sea, forest, mountains, lake, desert mesas, or a
 * blank white studio). Deterministic per seed, runs in the same workers as
 * survival terrain.
 */
export const PLOT_Y = 40;
/** The buildable lot spans -LOT_HALF .. LOT_HALF-1 on both axes (256 × 256). */
export const LOT_HALF = 128;
const PATH_OUT = 131.5;
const HEDGE_OUT = 132.5;

const S = CHUNK_SIZE;
const PAVERS = archIndex('pavers');
const STUDIO = archIndex('studio_white');
const STUDIO_LINE = archIndex('paint_lightgray');

export interface PlotColumn {
  height: number;
  water: number;
  top: number;
  topMeta: number;
  sub: number;
  biome: number;
  /** 0 = lot, 1 = path, 2 = hedge line, 3 = outside */
  zone: number;
}

const BIOME_IDX = { meadow: 0, forest: 1, pine: 2, coast: 3, canyon: 4 };

export class PlotSampler {
  readonly seed: number;
  readonly plot: PlotType;
  private n1: SimplexNoise;
  private n2: SimplexNoise;
  private n3: SimplexNoise;

  constructor(seed: number, plot: PlotType) {
    this.seed = seed >>> 0;
    this.plot = plot;
    this.n1 = new SimplexNoise(this.seed ^ 0x51a7);
    this.n2 = new SimplexNoise(this.seed ^ 0x7c3e);
    this.n3 = new SimplexNoise(this.seed ^ 0x2b91);
  }

  /** Chebyshev distance from the lot centre in block units. */
  static dist(x: number, z: number): number {
    return Math.max(Math.abs(x + 0.5), Math.abs(z + 0.5));
  }

  static inLot(x: number, z: number): boolean {
    return x >= -LOT_HALF && x < LOT_HALF && z >= -LOT_HALF && z < LOT_HALF;
  }

  column(x: number, z: number): PlotColumn {
    const plot = this.plot;
    const dist = PlotSampler.dist(x, z);
    const lotGround = plot === 'desert' ? B.SAND : B.GRASS;
    const baseBiome = plot === 'forest' ? BIOME_IDX.forest : plot === 'mountain' ? BIOME_IDX.pine : plot === 'coastal' ? BIOME_IDX.meadow : plot === 'desert' ? BIOME_IDX.canyon : BIOME_IDX.meadow;
    if (plot === 'studio') {
      const line = dist > LOT_HALF - 0.5 && dist <= LOT_HALF + 0.5;
      return { height: PLOT_Y, water: 0, top: B.ARCH_BLOCK, topMeta: line ? STUDIO_LINE : STUDIO, sub: B.STONE, biome: BIOME_IDX.meadow, zone: dist <= LOT_HALF - 0.5 ? 0 : 3 };
    }
    if (dist <= LOT_HALF - 0.5) return { height: PLOT_Y, water: 0, top: lotGround, topMeta: 0, sub: plot === 'desert' ? B.SAND : B.DIRT, biome: baseBiome, zone: 0 };
    if (dist <= PATH_OUT) return { height: PLOT_Y, water: 0, top: B.ARCH_BLOCK, topMeta: PAVERS, sub: B.DIRT, biome: baseBiome, zone: 1 };
    if (dist <= HEDGE_OUT) return { height: PLOT_Y, water: 0, top: lotGround, topMeta: 0, sub: B.DIRT, biome: baseBiome, zone: 2 };

    // ---------------------------------------------------------------- scenery
    const d = dist - HEDGE_OUT;
    const rise = smoothstep(0, 42, d);
    const n1 = (this.n1.fbm2D(x / 95, z / 95, 3) + 1) * 0.5;
    const n2 = (this.n2.fbm2D(x / 230, z / 230, 3) + 1) * 0.5;
    let h = PLOT_Y + rise * (2 + 8 * n1) + smoothstep(70, 220, d) * n2 * 26;
    let water = 0;
    let top: number = plot === 'desert' ? B.SAND : B.GRASS;
    let sub: number = plot === 'desert' ? B.SAND : B.DIRT;
    let biome = baseBiome;

    if (plot === 'meadow') {
      // a lazy river crossing the far north
      const rz = -214 + this.n3.noise2D(x / 140, 3.1) * 16;
      const rd = Math.abs(z - rz);
      if (rd < 5) {
        h = PLOT_Y - 3 + rd * 0.3;
        water = PLOT_Y - 1;
        top = rd < 3.5 ? B.GRAVEL : B.SAND;
      } else if (rd < 14) h = Math.min(h, PLOT_Y + (rd - 5) * 0.5);
    } else if (plot === 'forest') {
      h = PLOT_Y + rise * (1.5 + 5 * n1) + smoothstep(80, 220, d) * n2 * 18;
      if (hash2(x, z, this.seed ^ 0x31) < 0.45) top = B.LEAF_LITTER;
    } else if (plot === 'mountain') {
      const north = Math.max(0, -(z + 0.5) - HEDGE_OUT);
      const ridge = 1 - Math.abs(this.n3.fbm2D(x / 160, z / 160, 4));
      const mountain = smoothstep(18, 150, north) * (34 + ridge * 42);
      h += mountain;
      biome = BIOME_IDX.pine;
      if (h > 94 + hash2(x, z, this.seed) * 4) top = B.SNOW;
      else if (h > 70) {
        top = B.STONE;
        sub = B.STONE;
      }
    } else if (plot === 'lakeside') {
      // a lake hugging the east side of the lot
      const lx = x - 190, lz = z * 0.8 + this.n3.noise2D(x / 60, z / 60) * 18;
      const ld = Math.hypot(lx / 58, lz / 110);
      if (ld < 1) {
        const depth = (1 - ld) * 7;
        h = PLOT_Y - 1 - Math.max(1, depth);
        water = PLOT_Y - 1;
        top = depth < 2.5 ? B.SAND : B.CLAY;
        sub = B.SAND;
      } else if (ld < 1.25) {
        h = PLOT_Y + (ld - 1) * 4;
        top = ld < 1.08 ? B.SAND : B.GRASS;
      }
    } else if (plot === 'coastal') {
      const south = (z + 0.5) - HEDGE_OUT;
      if (south > 0) {
        biome = BIOME_IDX.coast;
        const shore = south + this.n3.noise2D(x / 50, 7.7) * 5;
        if (shore < 16) {
          h = PLOT_Y - shore * 0.12;
          top = shore > 2 ? B.SAND : B.GRASS;
          sub = B.SAND;
        } else {
          h = PLOT_Y - 2 - (shore - 16) * 0.35;
          water = PLOT_Y - 2;
          top = B.SAND;
          sub = B.SAND;
        }
      }
    } else if (plot === 'desert') {
      biome = BIOME_IDX.canyon;
      h = PLOT_Y + rise * (1 + 3 * n1);
      const mesa = this.n3.fbm2D(x / 120, z / 120, 3);
      if (mesa > 0.25 && d > 30) {
        const k = smoothstep(0.25, 0.4, mesa);
        h += Math.round(k * (16 + n2 * 14) / 4) * 4;
        top = B.AMBERSTONE;
        sub = B.AMBER_BANDED;
      }
    }
    h = Math.max(4, Math.min(WORLD_HEIGHT - 12, Math.floor(h)));
    return { height: h, water: water > h ? water : 0, top, topMeta: 0, sub, biome, zone: 3 };
  }

  /** Scenery tree kind for a tree-grid anchor (or null). */
  treeAt(x: number, z: number, col: PlotColumn): TreeKind | null {
    if (col.zone !== 3 || col.water) return null;
    if (col.top !== B.GRASS && col.top !== B.LEAF_LITTER && col.top !== B.SAND) return null;
    const d = PlotSampler.dist(x, z) - HEDGE_OUT;
    if (d < 3) return null;
    const grove = (this.n2.noise2D(x / 46 + 500, z / 46 - 300) + 1) * 0.5;
    const r = hash2(x, z, this.seed ^ 0x7103);
    const pick = hash2(z, x, this.seed ^ 0x7104);
    switch (this.plot) {
      case 'meadow': case 'lakeside':
        if (r > 0.09 * (0.2 + grove * grove * 2)) return null;
        return pick < 0.5 ? 'broadleaf' : pick < 0.75 ? 'birch' : pick < 0.9 ? 'orchard' : 'jungle';
      case 'forest':
        if (r > 0.55 * (0.4 + grove)) return null;
        return pick < 0.45 ? 'broadleaf' : pick < 0.7 ? 'birch' : pick < 0.85 ? 'jungle' : 'pine';
      case 'mountain':
        if (col.top === B.SNOW || col.top === B.STONE) return null;
        if (r > 0.3 * (0.3 + grove)) return null;
        return pick < 0.8 ? 'pine' : 'birch';
      case 'coastal':
        if (col.top === B.SAND) return r < 0.05 ? 'palm' : null;
        if (r > 0.06 * (0.2 + grove * 2)) return null;
        return pick < 0.5 ? 'palm' : 'broadleaf';
      case 'desert':
        return r < 0.006 ? 'palm' : null;
      default:
        return null;
    }
  }
}

/** Generate one chunk of a Build Home plot. */
export function generatePlotChunk(cx: number, cz: number, sampler: PlotSampler): ChunkGenResult {
  const seed = sampler.seed;
  const blocks = new Uint8Array(CHUNK_VOLUME);
  const meta = new Uint8Array(CHUNK_VOLUME);
  const heightmap = new Uint8Array(S * S);
  const biomes = new Uint8Array(S * S);
  const tints = new Uint8Array(S * S * 9);
  const mapColors = new Uint8Array(S * S * 3);
  const ox = cx * S, oz = cz * S;
  const cols: PlotColumn[] = [];

  for (let lz = 0; lz < S; lz++)
    for (let lx = 0; lx < S; lx++) {
      const wx = ox + lx, wz = oz + lz;
      const c = sampler.column(wx, wz);
      cols.push(c);
      const ci = lz * S + lx;
      biomes[ci] = c.biome;
      blocks[localIndex(lx, 0, lz)] = B.DEEPSTONE;
      for (let y = 1; y <= c.height; y++) {
        const depth = c.height - y;
        blocks[localIndex(lx, y, lz)] = depth === 0 ? c.top : depth < 4 ? c.sub : B.STONE;
      }
      if (c.topMeta) meta[localIndex(lx, c.height, lz)] = c.topMeta;
      for (let y = c.height + 1; y <= c.water; y++) blocks[localIndex(lx, y, lz)] = B.WATER;
      // hedge ring with openings in the middle of each side
      if (c.zone === 2 && sampler.plot !== 'studio') {
        const along = Math.min(Math.abs(wx + 0.5), Math.abs(wz + 0.5));
        if (along > 3) {
          blocks[localIndex(lx, c.height + 1, lz)] = B.HEDGE;
          blocks[localIndex(lx, c.height + 2, lz)] = B.HEDGE;
        }
      }
      // tints from the biome palette
      const bd = BIOMES[c.biome];
      const t = ci * 9;
      for (let k = 0; k < 3; k++) {
        tints[t + k] = Math.round(bd.grassTint[k] * 255);
        tints[t + 3 + k] = Math.round(bd.foliageTint[k] * 255);
        tints[t + 6 + k] = Math.round(bd.waterTint[k] * 255);
      }
      // scenery decoration
      if (c.zone === 3 && !c.water && c.height + 1 < WORLD_HEIGHT) {
        const r = hash2(wx, wz, seed ^ 0x3131);
        const above = localIndex(lx, c.height + 1, lz);
        if (c.top === B.GRASS && sampler.plot !== 'desert') {
          if (r < 0.018) blocks[above] = r < 0.006 ? B.FLOWER_SUN : r < 0.012 ? B.FLOWER_SKY : B.FLOWER_EMBER;
          else if (r < (sampler.plot === 'forest' ? 0.12 : 0.22)) blocks[above] = B.TALL_GRASS;
        } else if (sampler.plot === 'desert' && r < 0.01) blocks[above] = B.DRY_SHRUB;
      }
    }

  // scenery trees (with neighbour overlap so canopies cross chunk borders)
  if (sampler.plot !== 'studio') {
    const writer = new ChunkWriter(blocks, meta, ox, oz);
    const CELL = 3;
    for (let gz = Math.floor((oz - 5) / CELL); gz <= Math.floor((oz + S + 5) / CELL); gz++)
      for (let gx = Math.floor((ox - 5) / CELL); gx <= Math.floor((ox + S + 5) / CELL); gx++) {
        const tx = gx * CELL + Math.floor(hash2(gx, gz, seed ^ 0x7101) * CELL);
        const tz = gz * CELL + Math.floor(hash2(gz, gx, seed ^ 0x7102) * CELL);
        const c = sampler.column(tx, tz);
        const kind = sampler.treeAt(tx, tz, c);
        if (kind) buildTree(kind, tx, c.height + 1, tz, seed, writer);
      }
  }

  for (let lz = 0; lz < S; lz++)
    for (let lx = 0; lx < S; lx++) {
      let top = 0, topId = 0;
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
      let col = mapColorFor(topId, top, tints, ci);
      if (topId === B.ARCH_BLOCK) col = cols[ci].topMeta === PAVERS ? [196, 190, 180] : [236, 236, 232];
      else if (topId === B.HEDGE) col = [70, 110, 55];
      mapColors[ci * 3] = col[0];
      mapColors[ci * 3 + 1] = col[1];
      mapColors[ci * 3 + 2] = col[2];
    }

  return { cx, cz, blocks, meta, heightmap, biomes, tints, mapColors, waterfalls: [], landmarks: [] };
}
