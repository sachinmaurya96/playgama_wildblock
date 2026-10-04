import { BLOCK_DEFS } from '../../data/blocks';
import { mulberry32 } from '../core/random';
import { SOLID } from '../world/BlockRegistry';

/**
 * Bullet / melee hit resolution. Pure maths: works on plain vectors so the
 * host referee, the shooter's local effects and the tests share it.
 *
 * Bullets stop at solid blocks (walls, cars, cover). Glass, leaves, fences,
 * railings and lanterns let bullets through — you can see through them, so
 * you can shoot through them.
 */

export type Vec = [number, number, number];

const PASS = new Set<number>();
BLOCK_DEFS.forEach((d, i) => {
  if (d.layer === 'glass' || d.key.includes('leav') || d.key.includes('fence') || d.key.includes('railing') || d.key === 'lantern' || d.key.includes('fronds') || d.key.includes('needles')) PASS.add(i);
});

export function blocksBullets(id: number): boolean {
  return SOLID[id] === 1 && !PASS.has(id);
}

/**
 * Distance along a normalised ray to the first bullet-stopping voxel (≤ maxDist),
 * Amanatides–Woo voxel traversal.
 */
export function traceVoxels(o: Vec, d: Vec, maxDist: number, blockAt: (x: number, y: number, z: number) => number): { dist: number; hit: boolean; cell: Vec | null; normal: Vec } {
  let x = Math.floor(o[0]), y = Math.floor(o[1]), z = Math.floor(o[2]);
  const step: Vec = [Math.sign(d[0]), Math.sign(d[1]), Math.sign(d[2])];
  const tDelta: Vec = [Math.abs(1 / (d[0] || 1e-12)), Math.abs(1 / (d[1] || 1e-12)), Math.abs(1 / (d[2] || 1e-12))];
  const frac = (v: number, s: number) => (s > 0 ? Math.floor(v) + 1 - v : v - Math.floor(v));
  const tMax: Vec = [tDelta[0] * frac(o[0], step[0]), tDelta[1] * frac(o[1], step[1]), tDelta[2] * frac(o[2], step[2])];
  let t = 0;
  const normal: Vec = [0, 0, 0];
  if (blocksBullets(blockAt(x, y, z))) return { dist: 0, hit: true, cell: [x, y, z], normal };
  for (let i = 0; i < 1024 && t <= maxDist; i++) {
    let axis = 0;
    if (tMax[1] < tMax[axis]) axis = 1;
    if (tMax[2] < tMax[axis]) axis = 2;
    t = tMax[axis];
    tMax[axis] += tDelta[axis];
    if (axis === 0) x += step[0];
    else if (axis === 1) y += step[1];
    else z += step[2];
    if (t > maxDist) break;
    if (blocksBullets(blockAt(x, y, z))) {
      normal[0] = normal[1] = normal[2] = 0;
      normal[axis] = -step[axis];
      return { dist: t, hit: true, cell: [x, y, z], normal };
    }
  }
  return { dist: maxDist, hit: false, cell: null, normal };
}

/** Slab test: distance to an axis-aligned box along the ray, or -1. */
export function rayBox(o: Vec, d: Vec, min: Vec, max: Vec): number {
  let t0 = 0, t1 = Infinity;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) {
      if (o[a] < min[a] || o[a] > max[a]) return -1;
      continue;
    }
    let ta = (min[a] - o[a]) / d[a], tb = (max[a] - o[a]) / d[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return -1;
  }
  return t0;
}

export interface Target {
  id: string;
  /** Feet position. */
  x: number;
  y: number;
  z: number;
  crouch: boolean;
}

/** Player hitboxes: head on top, body below (crouching lowers both). */
export function hitboxes(t: Target): { head: [Vec, Vec]; body: [Vec, Vec] } {
  const c = t.crouch ? 0.25 : 0;
  const top = t.y + 1.75 - c, neck = t.y + 1.2 - c;
  return {
    head: [[t.x - 0.26, neck, t.z - 0.26], [t.x + 0.26, top, t.z + 0.26]],
    body: [[t.x - 0.34, t.y, t.z - 0.34], [t.x + 0.34, neck, t.z + 0.34]],
  };
}

export interface RayHit {
  id: string;
  dist: number;
  head: boolean;
}

/** First player hit by a ray before `wallDist` (the closest blocking voxel). */
export function rayPlayers(o: Vec, d: Vec, maxDist: number, targets: Target[]): RayHit | null {
  let best: RayHit | null = null;
  for (const t of targets) {
    const hb = hitboxes(t);
    const th = rayBox(o, d, hb.head[0], hb.head[1]);
    const tb = rayBox(o, d, hb.body[0], hb.body[1]);
    let dist = -1, head = false;
    if (th >= 0 && (tb < 0 || th <= tb)) {
      dist = th;
      head = true;
    } else if (tb >= 0) dist = tb;
    if (dist < 0 || dist > maxDist) continue;
    if (!best || dist < best.dist) best = { id: t.id, dist, head };
  }
  return best;
}

export function normalize(v: Vec): Vec {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Hash a string id to a 32-bit seed. */
export function idSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Deterministic spread: the same (shooter, shot number) gives the same pellet
 * directions on the shooter's screen and on the host.
 */
export function spreadDirs(dir: Vec, spreadDeg: number, count: number, seed: number): Vec[] {
  const d = normalize(dir);
  if (spreadDeg <= 0 && count === 1) return [d];
  const rnd = mulberry32(seed);
  // orthonormal basis around d
  const up: Vec = Math.abs(d[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const r = normalize([d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]]);
  const u: Vec = [r[1] * d[2] - r[2] * d[1], r[2] * d[0] - r[0] * d[2], r[0] * d[1] - r[1] * d[0]];
  const tan = Math.tan((spreadDeg * Math.PI) / 180);
  const out: Vec[] = [];
  for (let i = 0; i < count; i++) {
    // uniform in a disc (sqrt for even density)
    const a = rnd() * Math.PI * 2, m = Math.sqrt(rnd()) * tan;
    const ox = Math.cos(a) * m, oy = Math.sin(a) * m;
    out.push(normalize([d[0] + r[0] * ox + u[0] * oy, d[1] + r[1] * ox + u[1] * oy, d[2] + r[2] * ox + u[2] * oy]));
  }
  return out;
}

/** Spread for the shooter's state (aiming tightens, moving / jumping widens, crouching helps). */
export function effectiveSpread(hip: number, ads: number, state: { aiming: boolean; speed: number; airborne: boolean; crouch: boolean }): number {
  let s = state.aiming ? ads : hip;
  if (state.speed > 1) s *= 1 + Math.min(0.6, state.speed / 14);
  if (state.airborne) s *= 1.8;
  if (state.crouch) s *= 0.75;
  return s;
}

export function shotSeed(shooter: string, round: number, seq: number): number {
  return (idSeed(shooter) ^ Math.imul(round + 1, 0x9e3779b1) ^ Math.imul(seq + 7, 0x85ebca6b)) >>> 0;
}
