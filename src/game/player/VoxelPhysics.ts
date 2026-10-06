import * as THREE from 'three';
import { STAIRS } from '../world/BlockRegistry';
import type { World } from '../world/World';

/**
 * Axis-separated swept AABB collision against the voxel grid (plus any extra
 * object colliders such as Build Home furniture). Only boxes overlapping the
 * body are gathered — never the whole chunk. Used by the player and all
 * creatures; no physics engine bodies per voxel.
 */
export interface Body {
  pos: THREE.Vector3; // feet centre
  vel: THREE.Vector3;
  halfW: number;
  height: number;
  grounded: boolean;
}

export interface MoveResult {
  grounded: boolean;
  hitX: boolean;
  hitZ: boolean;
  hitCeiling: boolean;
  stepped: number;
}

const EPS = 1e-4;
const scratch: number[] = [];

/** Does an AABB intersect any collider? */
export function boxCollides(world: World, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
  const boxes = world.collectBoxes(minX, minY, minZ, maxX, maxY, maxZ, scratch);
  for (let i = 0; i < boxes.length; i += 6) {
    if (boxes[i + 3] > minX + EPS && boxes[i] < maxX - EPS && boxes[i + 5] > minZ + EPS && boxes[i + 2] < maxZ - EPS &&
      boxes[i + 4] > minY + EPS && boxes[i + 1] < maxY - EPS) return true;
  }
  return false;
}

function sweepY(world: World, b: Body, dy: number): { hit: boolean; up: boolean } {
  const oldY = b.pos.y;
  b.pos.y += dy;
  const minX = b.pos.x - b.halfW, maxX = b.pos.x + b.halfW, minZ = b.pos.z - b.halfW, maxZ = b.pos.z + b.halfW;
  const minY = b.pos.y, maxY = b.pos.y + b.height;
  const boxes = world.collectBoxes(minX, Math.min(minY, oldY), minZ, maxX, Math.max(maxY, oldY + b.height), maxZ, scratch);
  let hit = false;
  let best = dy < 0 ? -Infinity : Infinity;
  for (let i = 0; i < boxes.length; i += 6) {
    if (!(boxes[i + 3] > minX + EPS && boxes[i] < maxX - EPS && boxes[i + 5] > minZ + EPS && boxes[i + 2] < maxZ - EPS)) continue;
    const bottom = boxes[i + 1], top = boxes[i + 4];
    if (!(top > minY + EPS && bottom < maxY - EPS)) continue;
    if (dy < 0 && top <= oldY + 0.05) {
      hit = true;
      best = Math.max(best, top);
    } else if (dy > 0 && bottom >= oldY + b.height - 0.05) {
      hit = true;
      best = Math.min(best, bottom - b.height);
    }
  }
  if (hit) b.pos.y = best;
  return { hit, up: dy > 0 };
}

function sweepH(world: World, b: Body, axis: 'x' | 'z', d: number): boolean {
  b.pos[axis] += d;
  const minX = b.pos.x - b.halfW, maxX = b.pos.x + b.halfW, minZ = b.pos.z - b.halfW, maxZ = b.pos.z + b.halfW;
  const minY = b.pos.y, maxY = b.pos.y + b.height;
  const boxes = world.collectBoxes(minX, minY, minZ, maxX, maxY, maxZ, scratch);
  let hit = false;
  let best = d > 0 ? Infinity : -Infinity;
  for (let i = 0; i < boxes.length; i += 6) {
    if (!(boxes[i + 3] > minX + EPS && boxes[i] < maxX - EPS && boxes[i + 5] > minZ + EPS && boxes[i + 2] < maxZ - EPS)) continue;
    if (!(boxes[i + 4] > minY + EPS && boxes[i + 1] < maxY - EPS)) continue;
    hit = true;
    if (axis === 'x') {
      if (d > 0) best = Math.min(best, boxes[i] - b.halfW - EPS * 2);
      else best = Math.max(best, boxes[i + 3] + b.halfW + EPS * 2);
    } else {
      if (d > 0) best = Math.min(best, boxes[i + 2] - b.halfW - EPS * 2);
      else best = Math.max(best, boxes[i + 5] + b.halfW + EPS * 2);
    }
  }
  if (hit) b.pos[axis] = best;
  return hit;
}

/** Height of the obstacle directly ahead (for auto-step), relative to feet. */
function obstacleStep(world: World, b: Body, axis: 'x' | 'z', d: number): number {
  const s = Math.sign(d);
  const minX = axis === 'x' ? (s > 0 ? b.pos.x + b.halfW : b.pos.x - b.halfW - 0.06) : b.pos.x - b.halfW + EPS;
  const maxX = axis === 'x' ? (s > 0 ? b.pos.x + b.halfW + 0.06 : b.pos.x - b.halfW) : b.pos.x + b.halfW - EPS;
  const minZ = axis === 'z' ? (s > 0 ? b.pos.z + b.halfW : b.pos.z - b.halfW - 0.06) : b.pos.z - b.halfW + EPS;
  const maxZ = axis === 'z' ? (s > 0 ? b.pos.z + b.halfW + 0.06 : b.pos.z - b.halfW) : b.pos.z + b.halfW - EPS;
  const boxes = world.collectBoxes(minX, b.pos.y, minZ, maxX, b.pos.y + 1.6, maxZ, scratch);
  let top = -1;
  for (let i = 0; i < boxes.length; i += 6) {
    if (!(boxes[i + 3] > minX && boxes[i] < maxX && boxes[i + 5] > minZ && boxes[i + 2] < maxZ)) continue;
    if (boxes[i + 4] <= b.pos.y + EPS || boxes[i + 1] > b.pos.y + 1.2) continue;
    top = Math.max(top, boxes[i + 4]);
  }
  return top < 0 ? 0 : top - b.pos.y;
}

export function isStairs(world: World, x: number, y: number, z: number): boolean {
  return STAIRS[world.get(x, y, z)] === 1;
}

/**
 * Move a body by vel*dt with collisions. stepHeight lets bodies walk up slabs
 * (0.55) or stairs (1.05 when the obstacle is a stair block).
 */
export function moveBody(world: World, b: Body, dt: number, stepHeight = 0.55, edgeSafe = false): MoveResult {
  const res: MoveResult = { grounded: false, hitX: false, hitZ: false, hitCeiling: false, stepped: 0 };
  const dx = b.vel.x * dt, dy = b.vel.y * dt, dz = b.vel.z * dt;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.4));
  const sx = dx / steps, sy = dy / steps, sz = dz / steps;
  for (let i = 0; i < steps; i++) {
    const y = sweepY(world, b, sy);
    if (y.hit) {
      if (y.up) {
        res.hitCeiling = true;
        if (b.vel.y > 0) b.vel.y = 0;
      } else {
        res.grounded = true;
        if (b.vel.y < 0) b.vel.y = 0;
      }
    }
    for (const axis of ['x', 'z'] as const) {
      const d = axis === 'x' ? sx : sz;
      if (d === 0) continue;
      const before = b.pos[axis];
      const beforeY = b.pos.y;
      if (sweepH(world, b, axis, d)) {
        // try auto-step
        const wasGrounded = b.grounded || res.grounded;
        const need = obstacleStep(world, b, axis, d);
        const fx = Math.floor(axis === 'x' ? b.pos.x + Math.sign(d) * (b.halfW + 0.05) : b.pos.x);
        const fz = Math.floor(axis === 'z' ? b.pos.z + Math.sign(d) * (b.halfW + 0.05) : b.pos.z);
        const stair = isStairs(world, fx, Math.floor(b.pos.y + 0.01), fz);
        const limit = stair ? 1.05 : stepHeight;
        if (wasGrounded && need > 0.01 && need <= limit) {
          b.pos[axis] = before;
          b.pos.y = beforeY + need + 0.001;
          if (!boxCollides(world, b.pos.x - b.halfW + (axis === 'x' ? d : 0), b.pos.y, b.pos.z - b.halfW + (axis === 'z' ? d : 0), b.pos.x + b.halfW + (axis === 'x' ? d : 0), b.pos.y + b.height, b.pos.z + b.halfW + (axis === 'z' ? d : 0))) {
            b.pos[axis] += d;
            res.stepped += need;
            continue;
          }
          b.pos.y = beforeY;
          sweepH(world, b, axis, d);
        }
        if (axis === 'x') res.hitX = true;
        else res.hitZ = true;
      } else if (edgeSafe && (b.grounded || res.grounded)) {
        // crouching: don't walk off an edge higher than ~0.6
        if (!supported(world, b)) b.pos[axis] = before;
      }
    }
  }
  if (!res.grounded && b.vel.y <= 0) {
    // resting contact check
    res.grounded = boxCollides(world, b.pos.x - b.halfW, b.pos.y - 0.04, b.pos.z - b.halfW, b.pos.x + b.halfW, b.pos.y, b.pos.z + b.halfW);
  }
  b.grounded = res.grounded;
  return res;
}

function supported(world: World, b: Body): boolean {
  return boxCollides(world, b.pos.x - b.halfW + 0.05, b.pos.y - 0.6, b.pos.z - b.halfW + 0.05, b.pos.x + b.halfW - 0.05, b.pos.y, b.pos.z + b.halfW - 0.05);
}
