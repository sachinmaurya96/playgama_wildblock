import * as THREE from 'three';
import { BLOCK_DEFS } from '../../data/blocks';
import { LIQUID, SHAPE } from '../world/BlockRegistry';
import { modelBoxesFor } from '../world/ChunkMesher';
import { archSelection } from '../world/ArchShapes';
import { rotateBox } from '../world/shapes';
import type { World } from '../world/World';

export interface BlockHit {
  x: number;
  y: number;
  z: number;
  id: number;
  meta: number;
  /** face normal (the side that was hit) */
  nx: number;
  ny: number;
  nz: number;
  dist: number;
  point: THREE.Vector3;
}

type Box6 = [number, number, number, number, number, number];
const boxCache = new Map<number, Box6>();

/** Selection box (0..1 local) for a block + meta: cube, plant or model bounds. */
export function selectionBox(id: number, meta: number): Box6 {
  const d = BLOCK_DEFS[id];
  const key = id * 256 + (d.rotates || d.model === 'door' || d.model === 'gate' || d.arch ? meta : 0);
  const hit = boxCache.get(key);
  if (hit) return hit;
  let box: Box6 = [0, 0, 0, 1, 1, 1];
  const shape = SHAPE[id];
  if (shape === 2) box = [0.15, 0, 0.15, 0.85, 0.85, 0.85];
  else if (shape === 6) box = archSelection(id, meta);
  else if (shape === 4) {
    const boxes = modelBoxesFor(id, meta);
    if (boxes.length) {
      const b: Box6 = [16, 16, 16, 0, 0, 0];
      const rot = BLOCK_DEFS[id].rotates ? meta & 3 : 0;
      for (const m of boxes) {
        const [f, t] = rotateBox(m.from, m.to, rot);
        b[0] = Math.min(b[0], f[0]); b[1] = Math.min(b[1], f[1]); b[2] = Math.min(b[2], f[2]);
        b[3] = Math.max(b[3], t[0]); b[4] = Math.max(b[4], t[1]); b[5] = Math.max(b[5], t[2]);
      }
      box = [b[0] / 16, b[1] / 16, b[2] / 16, Math.min(1, b[3] / 16), Math.min(1, b[4] / 16), Math.min(1, b[5] / 16)];
      // keep thin things clickable
      if (box[4] - box[1] < 0.12) box[4] = box[1] + 0.12;
    }
  } else if (shape === 5) box = [0.3, 0, 0.3, 0.7, 1, 0.7];
  boxCache.set(key, box);
  return box;
}

function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: Box6, out: { t: number; axis: number; sign: number }): boolean {
  let tmin = -Infinity, tmax = Infinity, axis = 0, sign = 0;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    const lo = b[i], hi = b[i + 3];
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo || o[i] > hi) return false;
      continue;
    }
    let t1 = (lo - o[i]) / d[i], t2 = (hi - o[i]) / d[i];
    let s = -1;
    if (t1 > t2) {
      const tmp = t1; t1 = t2; t2 = tmp; s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = i;
      sign = s;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (tmax < 0) return false;
  out.t = Math.max(0, tmin);
  out.axis = axis;
  out.sign = sign;
  return true;
}

/** Amanatides–Woo voxel traversal with precise shape tests. */
export function raycastBlocks(world: World, origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, includeLiquid = false): BlockHit | null {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
  const tdx = Math.abs(1 / (dir.x || 1e-9)), tdy = Math.abs(1 / (dir.y || 1e-9)), tdz = Math.abs(1 / (dir.z || 1e-9));
  let tmx = (dir.x > 0 ? x + 1 - origin.x : origin.x - x) * tdx;
  let tmy = (dir.y > 0 ? y + 1 - origin.y : origin.y - y) * tdy;
  let tmz = (dir.z > 0 ? z + 1 - origin.z : origin.z - z) * tdz;
  const out = { t: 0, axis: 0, sign: 0 };
  const steps = Math.max(64, Math.ceil(maxDist * 3) + 8);
  for (let i = 0; i < steps; i++) {
    const id = world.get(x, y, z);
    if (id !== 0 && (includeLiquid || !LIQUID[id])) {
      const meta = world.getMeta(x, y, z);
      const box = LIQUID[id] ? ([0, 0, 0, 1, 0.9, 1] as Box6) : selectionBox(id, meta);
      if (rayBox(origin.x - x, origin.y - y, origin.z - z, dir.x, dir.y, dir.z, box, out) && out.t <= maxDist) {
        const n = [0, 0, 0];
        n[out.axis] = out.sign;
        return {
          x, y, z, id, meta, nx: n[0], ny: n[1], nz: n[2], dist: out.t,
          point: new THREE.Vector3().copy(dir).multiplyScalar(out.t).add(origin),
        };
      }
    }
    if (Math.min(tmx, tmy, tmz) > maxDist) break;
    if (tmx < tmy && tmx < tmz) {
      x += stepX;
      tmx += tdx;
    } else if (tmy < tmz) {
      y += stepY;
      tmy += tdy;
    } else {
      z += stepZ;
      tmz += tdz;
    }
  }
  return null;
}

/** Distance the camera can pull back from `origin` along `dir` before hitting an opaque block. */
export function cameraClearance(world: World, origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number {
  let best = maxDist;
  const tmp = new THREE.Vector3();
  const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(0.2);
  for (const o of [0, 1, -1]) {
    tmp.copy(origin).addScaledVector(side, o);
    let t = 0;
    while (t < best) {
      const px = tmp.x + dir.x * t, py = tmp.y + dir.y * t, pz = tmp.z + dir.z * t;
      if (world.isOpaque(Math.floor(px), Math.floor(py), Math.floor(pz))) {
        best = Math.max(0.3, t - 0.25);
        break;
      }
      t += 0.2;
    }
  }
  return best;
}
