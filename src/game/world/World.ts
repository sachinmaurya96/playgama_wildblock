import { B, LIGHT, OPAQUE, SOLID, SHAPE } from './BlockRegistry';
import { cellBoxes, cellTop } from './Collision';
import { Chunk } from './Chunk';
import { CHUNK_SIZE, WORLD_HEIGHT } from './constants';
import { blockToChunk, blockToLocal, localIndex } from './coordinates';
import { TerrainSampler } from './TerrainSampler';
import { PlotSampler } from './PlotGenerator';
import type { PlotType } from '../../persistence/types';
import { BLOCK_DEFS } from '../../data/blocks';
import { cityBlueprint, type CityBlueprint } from '../deathmatch/DeathmatchMap';

export type ChunkModMap = Map<number, number>; // local index -> id | meta << 8

/** Numeric chunk key (no string allocation in hot paths). Valid for |c| < 32768. */
export function ckey(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}
export function ckeyX(k: number): number {
  return Math.floor(k / 65536) - 32768;
}
export function ckeyZ(k: number): number {
  return (k % 65536) - 32768;
}

/**
 * Authoritative block storage on the main thread. Generated chunks arrive from
 * workers; player edits are applied here and recorded as compact per-chunk
 * modification lists (the only terrain data that is ever saved).
 */
export class World {
  readonly seed: number;
  readonly sampler: TerrainSampler;
  readonly chunks = new Map<number, Chunk>();
  /** Modifications per chunk, persisted by SaveManager. */
  readonly mods = new Map<number, ChunkModMap>();
  /** Chunks whose mods changed since the last save. */
  readonly dirtyMods = new Set<number>();
  onChunkChanged: ((cx: number, cz: number) => void) | null = null;

  private batchDepth = 0;
  private batchDirty = new Set<number>();
  private lastKey = -1;
  private lastChunk: Chunk | undefined;

  /** Build Home plot type (null for survival worlds). */
  readonly plot: PlotType | null;
  readonly plotSampler: PlotSampler | null;

  /** Deathmatch city blueprint (null everywhere else). */
  readonly city: CityBlueprint | null;

  constructor(seed: number, plot: PlotType | null = null, readonly caveVersion = 1, city = false) {
    this.seed = seed >>> 0;
    this.sampler = new TerrainSampler(this.seed, caveVersion);
    this.plot = city ? null : plot;
    this.plotSampler = this.plot ? new PlotSampler(this.seed, this.plot) : null;
    this.city = city ? cityBlueprint(this.seed) : null;
  }

  chunkAt(cx: number, cz: number): Chunk | undefined {
    const k = ckey(cx, cz);
    if (k === this.lastKey) return this.lastChunk;
    const c = this.chunks.get(k);
    this.lastKey = k;
    this.lastChunk = c;
    return c;
  }

  addChunk(chunk: Chunk): void {
    const k = ckey(chunk.cx, chunk.cz);
    const mods = this.mods.get(k);
    if (mods) {
      for (const [idx, packed] of mods) {
        chunk.blocks[idx] = packed & 255;
        chunk.meta[idx] = packed >> 8;
      }
      for (let z = 0; z < CHUNK_SIZE; z++) for (let x = 0; x < CHUNK_SIZE; x++) chunk.refreshHeight(x, z);
    }
    this.chunks.set(k, chunk);
    this.lastKey = -1;
  }

  removeChunk(cx: number, cz: number): void {
    this.chunks.delete(ckey(cx, cz));
    this.lastKey = -1;
  }

  isLoaded(x: number, z: number): boolean {
    return !!this.chunkAt(blockToChunk(x), blockToChunk(z));
  }

  /** Block id at world coords; 0 (air) above/below the world or in unloaded chunks. */
  get(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return y < 0 ? B.DEEPSTONE : 0;
    const c = this.chunkAt(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
    if (!c) return 0;
    return c.blocks[localIndex(x - c.cx * CHUNK_SIZE, y, z - c.cz * CHUNK_SIZE)];
  }

  getMeta(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const c = this.chunkAt(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
    if (!c) return 0;
    return c.meta[localIndex(x - c.cx * CHUNK_SIZE, y, z - c.cz * CHUNK_SIZE)];
  }

  /**
   * Collision height (0..1.5) of a block cell (top of its highest box), honouring
   * doors and partial blocks. Unloaded chunks are treated as solid so nothing falls through.
   */
  collisionHeight(x: number, y: number, z: number): number {
    if (y < 0) return 1;
    if (y >= WORLD_HEIGHT) return 0;
    const c = this.chunkAt(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
    if (!c) return 1;
    const i = localIndex(x - c.cx * CHUNK_SIZE, y, z - c.cz * CHUNK_SIZE);
    const id = c.blocks[i];
    if (!SOLID[id]) return 0;
    return cellTop(id, c.meta[i]);
  }

  isSolid(x: number, y: number, z: number): boolean {
    return this.collisionHeight(x, y, z) > 0;
  }

  /**
   * Extra colliders that are not voxels (Build Home furniture, doors...).
   * Appends world-space boxes (6 numbers each) overlapping the query box.
   */
  objectColliders: ((minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, out: number[]) => void) | null = null;

  /**
   * Every collision box (world space, 6 numbers per box) overlapping the query
   * region. Includes one cell below for tall shapes (fences are 1.5 high).
   */
  collectBoxes(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, out: number[]): number[] {
    out.length = 0;
    const E = 1e-4;
    const x0 = Math.floor(minX), x1 = Math.floor(maxX - E);
    const y0 = Math.floor(minY) - 1, y1 = Math.floor(maxY - E);
    const z0 = Math.floor(minZ), z1 = Math.floor(maxZ - E);
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          if (y < 0) {
            out.push(x, y, z, x + 1, y + 1, z + 1);
            continue;
          }
          if (y >= WORLD_HEIGHT) continue;
          const c = this.chunkAt(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
          if (!c) {
            out.push(x, y, z, x + 1, y + 1, z + 1);
            continue;
          }
          const i = localIndex(x - c.cx * CHUNK_SIZE, y, z - c.cz * CHUNK_SIZE);
          const id = c.blocks[i];
          if (!SOLID[id]) continue;
          for (const b of cellBoxes(id, c.meta[i])) out.push(x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]);
        }
    this.objectColliders?.(minX, minY - 1, minZ, maxX, maxY, maxZ, out);
    return out;
  }

  isOpaque(x: number, y: number, z: number): boolean {
    return OPAQUE[this.get(x, y, z)] === 1;
  }

  /** Surface height (top non-air block) from loaded data, or the generator estimate. */
  surfaceY(x: number, z: number): number {
    const c = this.chunkAt(blockToChunk(x), blockToChunk(z));
    if (c) return c.heightmap[blockToLocal(z) * CHUNK_SIZE + blockToLocal(x)];
    if (this.city) return this.city.surfaceY(x, z);
    if (this.plotSampler) return this.plotSampler.column(x, z).height;
    return this.sampler.sample(x, z).height;
  }

  /** Highest block the player could stand on (skips leaves & plants). */
  standableY(x: number, z: number): number {
    for (let y = WORLD_HEIGHT - 2; y > 0; y--) {
      const id = this.get(x, y, z);
      if (SOLID[id] && SHAPE[id] === 1 && !BLOCK_DEFS[id].key.includes('leav') && id !== B.PINE_NEEDLES && id !== B.PALM_FRONDS) return y;
      if (id === B.WATER) return y;
    }
    return 0;
  }

  beginBatch(): void {
    this.batchDepth++;
  }

  endBatch(): void {
    this.batchDepth = Math.max(0, this.batchDepth - 1);
    if (this.batchDepth === 0 && this.batchDirty.size) {
      const list = [...this.batchDirty];
      this.batchDirty.clear();
      for (const k of list) this.onChunkChanged?.(ckeyX(k), ckeyZ(k));
    }
  }

  private markDirty(cx: number, cz: number) {
    if (this.batchDepth > 0) this.batchDirty.add(ckey(cx, cz));
    else this.onChunkChanged?.(cx, cz);
  }

  /** PvP: told about every block change made by this game (not about remote ones applied with `applyRemote`). */
  onSet: ((x: number, y: number, z: number, id: number, meta: number) => void) | null = null;
  private applyingRemote = false;

  /** Apply a block change that came from another player: loaded chunks update now, others when they generate. */
  applyRemote(x: number, y: number, z: number, id: number, meta: number): void {
    if (y < 1 || y >= WORLD_HEIGHT) return;
    this.applyingRemote = true;
    try {
      if (this.set(x, y, z, id, meta)) return;
    } finally {
      this.applyingRemote = false;
    }
    const cx = blockToChunk(x), cz = blockToChunk(z);
    const k = ckey(cx, cz);
    let m = this.mods.get(k);
    if (!m) {
      m = new Map();
      this.mods.set(k, m);
    }
    m.set(localIndex(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE), id | (meta << 8));
  }

  /** Set a block (records a modification). Returns false if the chunk isn't loaded. */
  set(x: number, y: number, z: number, id: number, meta = 0): boolean {
    if (y < 1 || y >= WORLD_HEIGHT) return false;
    const cx = blockToChunk(x), cz = blockToChunk(z);
    const c = this.chunkAt(cx, cz);
    if (!c) return false;
    const lx = x - cx * CHUNK_SIZE, lz = z - cz * CHUNK_SIZE;
    const i = localIndex(lx, y, lz);
    const old = c.blocks[i];
    if (old === id && c.meta[i] === meta) return true;
    c.blocks[i] = id;
    c.meta[i] = meta;
    c.version++;
    const hi = lz * CHUNK_SIZE + lx;
    if (id !== 0 && y > c.heightmap[hi]) c.heightmap[hi] = y;
    else if (id === 0 && y >= c.heightmap[hi]) c.refreshHeight(lx, lz);
    const k = ckey(cx, cz);
    let m = this.mods.get(k);
    if (!m) {
      m = new Map();
      this.mods.set(k, m);
    }
    m.set(i, id | (meta << 8));
    this.dirtyMods.add(k);
    if (this.onSet && !this.applyingRemote) this.onSet(x, y, z, id, meta);

    this.markDirty(cx, cz);
    const lightChange = LIGHT[old] > 0 || LIGHT[id] > 0;
    if (lightChange) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (dx || dz) this.markDirty(cx + dx, cz + dz);
    } else {
      if (lx === 0) this.markDirty(cx - 1, cz);
      if (lx === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz);
      if (lz === 0) this.markDirty(cx, cz - 1);
      if (lz === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1);
      if ((lx === 0 || lx === CHUNK_SIZE - 1) && (lz === 0 || lz === CHUNK_SIZE - 1)) {
        this.markDirty(cx + (lx === 0 ? -1 : 1), cz + (lz === 0 ? -1 : 1));
      }
    }
    return true;
  }

  setMeta(x: number, y: number, z: number, meta: number): boolean {
    return this.set(x, y, z, this.get(x, y, z), meta);
  }

  /**
   * Local light estimate at a position (0..15) for spawn rules & entity shading:
   * max of sky exposure (if daylight) and nearby emitters.
   */
  lightAt(x: number, y: number, z: number, daylight: number): number {
    let sky = 0;
    const top = this.surfaceY(x, z);
    if (y > top) sky = 15;
    else {
      // Under a roof or overhang: dim with depth.
      let covered = 0;
      for (let yy = y + 1; yy <= Math.min(top, y + 12); yy++) if (OPAQUE[this.get(x, yy, z)]) covered++;
      sky = covered === 0 ? 13 : Math.max(0, 11 - (top - y));
    }
    let block = 0;
    for (let dy = -4; dy <= 4; dy++)
      for (let dz = -7; dz <= 7; dz++)
        for (let dx = -7; dx <= 7; dx++) {
          const l = LIGHT[this.get(x + dx, y + dy, z + dz)];
          if (!l) continue;
          const v = l - (Math.abs(dx) + Math.abs(dy) + Math.abs(dz));
          if (v > block) block = v;
        }
    return Math.max(Math.round(sky * daylight), block);
  }

  serializeMods(k: number): [number, number][] {
    const m = this.mods.get(k);
    return m ? [...m.entries()] : [];
  }

  loadMods(k: number, list: [number, number][]): void {
    this.mods.set(k, new Map(list));
  }
}
