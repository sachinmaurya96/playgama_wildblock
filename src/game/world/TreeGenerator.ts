import type { TreeKind } from '../../data/biomes';
import { hash3, mulberry32 } from '../core/random';
import { B } from './BlockRegistry';

/** Receives block writes in world coordinates. Implementations clip to their chunk. */
export interface BlockWriter {
  /** Writes when the target cell is air / replaceable (soft) or always (hard). */
  put(x: number, y: number, z: number, id: number, hard?: boolean, meta?: number): void;
}

function blob(w: BlockWriter, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, id: number, rng: () => number, holes = 0.12) {
  for (let dy = -ry; dy <= ry; dy++)
    for (let dz = -rz; dz <= rz; dz++)
      for (let dx = -rx; dx <= rx; dx++) {
        const d = (dx * dx) / (rx * rx + 0.5) + (dy * dy) / (ry * ry + 0.5) + (dz * dz) / (rz * rz + 0.5);
        if (d > 1.05) continue;
        if (d > 0.7 && rng() < holes) continue;
        w.put(cx + dx, cy + dy, cz + dz, id);
      }
}

/**
 * Deterministic tree builder. Each tree is seeded by its world position so the
 * part that lands in a neighbouring chunk is identical when that chunk generates.
 */
export function buildTree(kind: TreeKind, x: number, y: number, z: number, seed: number, w: BlockWriter): void {
  const rng = mulberry32(Math.floor(hash3(x, y, z, seed) * 4294967295));
  switch (kind) {
    case 'broadleaf': {
      const h = 4 + Math.floor(rng() * 3);
      for (let i = 0; i < h; i++) w.put(x, y + i, z, B.LOG, true);
      blob(w, x, y + h, z, 2 + (rng() < 0.4 ? 1 : 0), 2, 2 + (rng() < 0.4 ? 1 : 0), B.LEAVES, rng);
      // A side branch with its own tuft gives silhouettes character.
      if (rng() < 0.55) {
        const dir = Math.floor(rng() * 4);
        const dx = [1, -1, 0, 0][dir], dz = [0, 0, 1, -1][dir];
        const by = y + h - 2;
        w.put(x + dx, by, z + dz, B.LOG, true);
        w.put(x + dx * 2, by + 1, z + dz * 2, B.LOG, true);
        blob(w, x + dx * 2, by + 2, z + dz * 2, 1, 1, 1, B.LEAVES, rng, 0.05);
      }
      break;
    }
    case 'orchard': {
      const h = 3 + Math.floor(rng() * 2);
      for (let i = 0; i < h; i++) w.put(x, y + i, z, B.LOG, true);
      blob(w, x, y + h, z, 2, 2, 2, B.BLOSSOM_LEAVES, rng, 0.2);
      break;
    }
    case 'birch': {
      const h = 5 + Math.floor(rng() * 3);
      for (let i = 0; i < h; i++) w.put(x, y + i, z, B.BIRCH_LOG, true);
      blob(w, x, y + h - 1, z, 1, 3, 1, B.BIRCH_LEAVES, rng, 0.05);
      blob(w, x, y + h - 2, z, 2, 1, 2, B.BIRCH_LEAVES, rng, 0.3);
      break;
    }
    case 'pine': {
      const h = 7 + Math.floor(rng() * 5);
      for (let i = 0; i < h; i++) w.put(x, y + i, z, B.PINE_LOG, true);
      let r = 3;
      for (let ly = y + 2; ly <= y + h; ly++) {
        const layer = ly - (y + 2);
        const rad = Math.max(0, r - Math.floor(layer / 2));
        if (layer % 2 === 1 && rad > 0) continue;
        for (let dz = -rad; dz <= rad; dz++)
          for (let dx = -rad; dx <= rad; dx++) {
            if (Math.abs(dx) + Math.abs(dz) > rad + (rad > 1 ? 1 : 0)) continue;
            w.put(x + dx, ly, z + dz, B.PINE_NEEDLES);
          }
        if (layer > 5) r = Math.max(1, r);
      }
      w.put(x, y + h, z, B.PINE_NEEDLES);
      w.put(x, y + h + 1, z, B.PINE_NEEDLES);
      break;
    }
    case 'palm': {
      const h = 5 + Math.floor(rng() * 3);
      const lean = Math.floor(rng() * 4);
      const ldx = [1, -1, 0, 0][lean], ldz = [0, 0, 1, -1][lean];
      let px = x, pz = z;
      for (let i = 0; i < h; i++) {
        if (i === Math.floor(h * 0.6)) { px += ldx; pz += ldz; }
        w.put(px, y + i, pz, B.PALM_LOG, true);
      }
      const top = y + h;
      w.put(px, top, pz, B.PALM_FRONDS);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        w.put(px + dx, top, pz + dz, B.PALM_FRONDS);
        w.put(px + dx * 2, top - 1, pz + dz * 2, B.PALM_FRONDS);
        if (dx === 0 || dz === 0) w.put(px + dx * 3, top - 2, pz + dz * 3, B.PALM_FRONDS);
      }
      break;
    }
    case 'jungle': {
      const h = 9 + Math.floor(rng() * 5);
      for (let i = 0; i < h; i++) w.put(x, y + i, z, B.LOG, true);
      blob(w, x, y + h, z, 3, 2, 3, B.LEAVES, rng, 0.15);
      blob(w, x, y + h - 4, z, 2, 1, 2, B.LEAVES, rng, 0.4);
      // Hanging vines of leaves
      for (let i = 0; i < 6; i++) {
        const vx = x + Math.floor(rng() * 7) - 3;
        const vz = z + Math.floor(rng() * 7) - 3;
        const len = 1 + Math.floor(rng() * 3);
        for (let k = 1; k <= len; k++) w.put(vx, y + h - 2 - k, vz, B.LEAVES);
      }
      break;
    }
    default:
      break;
  }
}

/** Is this block part of any tree (for collapse logic)? */
export function isTrunk(id: number): boolean {
  return id === B.LOG || id === B.PINE_LOG || id === B.BIRCH_LOG || id === B.PALM_LOG;
}

export function isFoliage(id: number): boolean {
  return id === B.LEAVES || id === B.PINE_NEEDLES || id === B.BIRCH_LEAVES || id === B.PALM_FRONDS || id === B.BLOSSOM_LEAVES;
}
