import { BLOCK_DEFS } from '../../data/blocks';
import { archCollision, type Box } from './ArchShapes';
import { ARCH_KIND, COLLISION_H, SOLID } from './BlockRegistry';

/**
 * Collision shapes of voxel cells as lists of block-local AABBs. Most blocks
 * are a single box of their collision height; architecture shapes (slabs,
 * stairs, beams, panels, railings) and open doors/gates depend on meta.
 * Results are cached per (id, meta).
 */
const cache = new Map<number, Box[]>();
const EMPTY: Box[] = [];

export function cellBoxes(id: number, meta: number): Box[] {
  if (!SOLID[id]) return EMPTY;
  const key = id * 256 + meta;
  let boxes = cache.get(key);
  if (boxes) return boxes;
  const def = BLOCK_DEFS[id];
  if (def.interact === 'door' && (meta & 4)) boxes = EMPTY;
  else if (ARCH_KIND[id]) boxes = archCollision(id, meta);
  else boxes = [[0, 0, 0, 1, COLLISION_H[id] / 16, 1]];
  cache.set(key, boxes);
  return boxes;
}

/** Highest collision top inside a cell (0 = passable), used for simple height checks. */
export function cellTop(id: number, meta: number): number {
  let top = 0;
  for (const b of cellBoxes(id, meta)) top = Math.max(top, b[4]);
  return top;
}
