import { CHUNK_SIZE, CHUNK_VOLUME, WORLD_HEIGHT } from './constants';
import { localIndex } from './coordinates';

export interface WaterfallInfo {
  x: number;
  z: number;
  top: number;
  bottom: number;
  dx: number;
  dz: number;
}

export interface LandmarkInfo {
  type: string;
  x: number;
  y: number;
  z: number;
}

/** Everything a worker produces for one chunk (transferable typed arrays). */
export interface ChunkGenResult {
  cx: number;
  cz: number;
  blocks: Uint8Array;
  meta: Uint8Array;
  heightmap: Uint8Array;
  biomes: Uint8Array;
  /** Tints per column: grass rgb, foliage rgb, water rgb as 0..255 (9 bytes per column). */
  tints: Uint8Array;
  mapColors: Uint8Array;
  waterfalls: WaterfallInfo[];
  landmarks: LandmarkInfo[];
}

/**
 * Compact voxel storage: one byte block id + one byte metadata per voxel.
 * meta bits: 0-1 rotation, 2 open/active flag, 3-5 growth stage / variant.
 */
export class Chunk {
  readonly cx: number;
  readonly cz: number;
  readonly blocks: Uint8Array;
  readonly meta: Uint8Array;
  readonly heightmap: Uint8Array;
  readonly biomes: Uint8Array;
  readonly tints: Uint8Array;
  readonly mapColors: Uint8Array;
  readonly waterfalls: WaterfallInfo[];
  readonly landmarks: LandmarkInfo[];
  /** Mesh needs rebuilding. */
  dirty = true;
  /** Incremented on every change; used to discard stale mesh results. */
  version = 0;

  constructor(data: ChunkGenResult) {
    this.cx = data.cx;
    this.cz = data.cz;
    this.blocks = data.blocks;
    this.meta = data.meta;
    this.heightmap = data.heightmap;
    this.biomes = data.biomes;
    this.tints = data.tints;
    this.mapColors = data.mapColors;
    this.waterfalls = data.waterfalls;
    this.landmarks = data.landmarks;
  }

  static empty(cx: number, cz: number): Chunk {
    return new Chunk({
      cx, cz,
      blocks: new Uint8Array(CHUNK_VOLUME),
      meta: new Uint8Array(CHUNK_VOLUME),
      heightmap: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE),
      biomes: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE),
      tints: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * 9).fill(160),
      mapColors: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * 3),
      waterfalls: [],
      landmarks: [],
    });
  }

  get(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    return this.blocks[localIndex(x, y, z)];
  }

  getMeta(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    return this.meta[localIndex(x, y, z)];
  }

  set(x: number, y: number, z: number, id: number, meta = 0): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const i = localIndex(x, y, z);
    this.blocks[i] = id;
    this.meta[i] = meta;
    this.version++;
    this.dirty = true;
  }

  /** Recompute the topmost non-air height for one column (after edits). */
  refreshHeight(x: number, z: number): void {
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      if (this.blocks[localIndex(x, y, z)] !== 0) {
        this.heightmap[z * CHUNK_SIZE + x] = y;
        return;
      }
    }
    this.heightmap[z * CHUNK_SIZE + x] = 0;
  }
}
