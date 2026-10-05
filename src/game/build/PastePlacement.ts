import { objectDef } from '../../data/furniture';
import type { BuildObjectSave } from '../../persistence/types';
import { ARCH_KIND, SHAPE, B } from '../world/BlockRegistry';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../world/constants';
import type { Chunk } from '../world/Chunk';
import type { World } from '../world/World';
import { localBounds, rotatedAabb, type BuildObjects } from './BuildObjects';
import { isTerrain, rotateCell, rotateObjectPos, rotatedSize, type P3 } from './BuildTools';

export interface PlacementClip {
  name: string;
  size: [number, number, number];
  blocks: [number, number, number, number, number][];
  objects: Omit<BuildObjectSave, 'id'>[];
}

type Bounds = { min: number[]; max: number[] };
type ChunkStamp = { chunk: Chunk | undefined; version: number };

/** Protect the whole house area, including empty rooms, patios, objects and roof overhangs. */
export class PastePlacement {
  private clip: PlacementClip | null = null;
  private steps = -1;
  private bounds: Bounds | null = null;
  private cache: { key: string; objects: number; chunks: ChunkStamp[]; reason: string | null } | null = null;

  constructor(private world: World, private objects: Pick<BuildObjects, 'query' | 'revision'>, private inLot: (x: number, z: number) => boolean) {}

  validate(clip: PlacementClip, origin: P3, steps: number, fresh = false): string | null {
    if (!Number.isInteger(steps) || ![origin.x, origin.y, origin.z, ...clip.size].every(Number.isFinite) || clip.size.some((v) => !Number.isInteger(v) || v <= 0)) return 'Invalid structure size or position';
    if (this.clip !== clip || this.steps !== steps) {
      this.clip = clip;
      this.steps = steps;
      this.bounds = footprint(clip, steps);
      this.cache = null;
    }
    const bounds = this.bounds;
    if (!bounds || ![...bounds.min, ...bounds.max].every(Number.isFinite)) return 'Invalid structure bounds';
    const x0 = Math.floor(origin.x + bounds.min[0] + 1e-6), x1 = Math.ceil(origin.x + bounds.max[0] - 1e-6) - 1;
    const z0 = Math.floor(origin.z + bounds.min[2] + 1e-6), z1 = Math.ceil(origin.z + bounds.max[2] - 1e-6) - 1;
    if (!this.inLot(x0, z0) || !this.inLot(x1, z1)) return 'It doesn’t fit inside your lot there';
    if (origin.y + bounds.min[1] < 2 || origin.y + bounds.max[1] > 124 || clip.blocks.some((b) => origin.y + b[1] > 120)) return 'Too high or too low';

    const chunks: ChunkStamp[] = [];
    for (let cz = Math.floor(z0 / CHUNK_SIZE); cz <= Math.floor(z1 / CHUNK_SIZE); cz++) {
      for (let cx = Math.floor(x0 / CHUNK_SIZE); cx <= Math.floor(x1 / CHUNK_SIZE); cx++) {
        const chunk = this.world.chunkAt(cx, cz);
        chunks.push({ chunk, version: chunk?.version ?? -1 });
      }
    }
    const key = `${origin.x},${origin.y},${origin.z}`;
    const cached = this.cache;
    if (!fresh && cached?.key === key && cached.objects === this.objects.revision && cached.chunks.length === chunks.length && chunks.every((s, i) => s.chunk === cached.chunks[i].chunk && s.version === cached.chunks[i].version)) return cached.reason;
    const reason = chunks.some((s) => !s.chunk)
      ? 'Area is still loading — move closer and try again'
      : this.occupied(bounds, origin, x0, x1, z0, z1);
    this.cache = { key, objects: this.objects.revision, chunks, reason };
    return reason;
  }

  private occupied(bounds: Bounds, origin: P3, x0: number, x1: number, z0: number, z1: number): string | null {
    // Project onto the whole lot column: aiming at an existing roof must not stack another house there.
    if (this.objects.query(origin.x + bounds.min[0] + 1e-6, 2, origin.z + bounds.min[2] + 1e-6, origin.x + bounds.max[0] - 1e-6, WORLD_HEIGHT, origin.z + bounds.max[2] - 1e-6).length) return 'Area overlaps an existing house or object — choose a clear area';
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const ground = this.world.plotSampler?.column(x, z);
        const top = Math.min(WORLD_HEIGHT - 1, this.world.surfaceY(x, z));
        for (let y = 2; y <= top; y++) {
          const id = this.world.get(x, y, z);
          if (id === 0 || id === B.WATER || SHAPE[id] === 2) continue;
          if (!ARCH_KIND[id] && isTerrain(id, 0) && ground && y <= ground.height) continue;
          // Studio plots and the generated perimeter path use architecture for their original ground.
          // Allow that original surface, but never treat a house's decking/pavers as empty terrain.
          if (ARCH_KIND[id]) {
            if (ground && y === ground.height && id === ground.top && this.world.getMeta(x, y, z) === ground.topMeta) continue;
          }
          return 'Area overlaps an existing house or structure — choose a clear area';
        }
      }
    }
    return null;
  }
}

function footprint(clip: PlacementClip, steps: number): Bounds | null {
  const [sx, sy, sz] = rotatedSize(clip.size, steps);
  const min = [0, 0, 0], max = [sx, sy, sz];
  for (const [x, y, z] of clip.blocks) {
    const [rx, rz] = rotateCell(x, z, clip.size[0], clip.size[2], steps);
    min[0] = Math.min(min[0], rx); min[1] = Math.min(min[1], y); min[2] = Math.min(min[2], rz);
    max[0] = Math.max(max[0], rx + 1); max[1] = Math.max(max[1], y + 1); max[2] = Math.max(max[2], rz + 1);
  }
  for (const o of clip.objects) {
    const def = objectDef(o.itemId);
    if (!def) return null;
    const [x, z] = rotateObjectPos(o.x, o.z, clip.size[0], clip.size[2], steps);
    const [a, b] = localBounds(def);
    const [lo, hi] = rotatedAabb(a, b, { x, y: o.y, z, rotation: o.rotation - steps * Math.PI / 2 });
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], lo[i]); max[i] = Math.max(max[i], hi[i]); }
  }
  return { min, max };
}
