import { archIndex, archMeta } from '../../data/architecture';
import { BLOCK_DEFS } from '../../data/blocks';
import type { TreeKind } from '../../data/biomes';
import { objectDef, type ObjectDef } from '../../data/furniture';
import { ARCH_KIND, B, blockId, OPAQUE, SHAPE, SOLID, isReplaceable } from '../world/BlockRegistry';
import { archModelOf } from '../world/ArchShapes';
import { WORLD_HEIGHT } from '../world/constants';
import { buildTree } from '../world/TreeGenerator';
import type { BlockChange } from './BuildHistory';

/**
 * Pure Build Home construction logic: every area tool (wall, room, floor,
 * foundation, roof, pool, pond, staircase, terrain brushes, tree stamps,
 * wall openings, blueprints) is a function that records voxel changes into an
 * Edits set. Nothing here touches rendering or input, so it is unit-tested,
 * reused by house presets, and turned into ONE undo command by BuildMode.
 */

export interface BlockReader {
  get(x: number, y: number, z: number): number;
  getMeta(x: number, y: number, z: number): number;
}

export interface P3 {
  x: number;
  y: number;
  z: number;
}

/** Accumulates block changes (first "from" wins, last "to" wins, no-ops dropped). */
export class Edits {
  private map = new Map<string, BlockChange>();
  constructor(readonly reader: BlockReader, readonly limit = 200000) {}

  get(x: number, y: number, z: number): [number, number] {
    const c = this.map.get(`${x},${y},${z}`);
    return c ? c.to : [this.reader.get(x, y, z), this.reader.getMeta(x, y, z)];
  }

  set(x: number, y: number, z: number, id: number, meta = 0): void {
    if (y < 1 || y >= WORLD_HEIGHT - 1) return;
    const k = `${x},${y},${z}`;
    let c = this.map.get(k);
    if (!c) {
      if (this.map.size >= this.limit) return;
      c = { x, y, z, from: [this.reader.get(x, y, z), this.reader.getMeta(x, y, z)], to: [id, meta] };
      this.map.set(k, c);
    } else c.to = [id, meta];
  }

  /** Only writes into air / plants / water (never overwrites a structure or terrain). */
  soft(x: number, y: number, z: number, id: number, meta = 0): void {
    const [cur] = this.get(x, y, z);
    if (cur === 0 || isReplaceable(cur) || SHAPE[cur] === 2) this.set(x, y, z, id, meta);
  }

  get size(): number {
    return this.map.size;
  }

  list(): BlockChange[] {
    return [...this.map.values()].filter((c) => c.from[0] !== c.to[0] || c.from[1] !== c.to[1]);
  }
}

const ARCH = () => B.ARCH_BLOCK;

/** Can a build tool overwrite this block (air, plants, water, other architecture)? */
export function overwritable(id: number): boolean {
  return id === 0 || isReplaceable(id) || SHAPE[id] === 2 || ARCH_KIND[id] !== 0 || id === B.WATER;
}

function rect(a: P3, b: P3): { x0: number; x1: number; z0: number; z1: number } {
  return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) };
}

/** Axis-snapped or diagonal line of columns from a to b (Bresenham on XZ). */
export function lineCells(a: P3, b: P3): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  let x = a.x, z = a.z;
  const dx = Math.abs(b.x - a.x), dz = Math.abs(b.z - a.z);
  const sx = a.x < b.x ? 1 : -1, sz = a.z < b.z ? 1 : -1;
  let err = dx - dz;
  for (let i = 0; i < 2048; i++) {
    out.push({ x, z });
    if (x === b.x && z === b.z) break;
    const e2 = 2 * err;
    if (e2 > -dz) {
      err -= dz;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      z += sz;
    }
  }
  return out;
}

// ---------------------------------------------------------------- walls / rooms / floors

/** A wall from a to b standing on top of the clicked blocks (base y = a.y + 1). */
export function buildWall(ed: Edits, a: P3, b: P3, height: number, mat: number): void {
  for (const c of lineCells(a, b))
    for (let h = 1; h <= height; h++) {
      const y = a.y + h;
      if (overwritable(ed.get(c.x, y, c.z)[0])) ed.set(c.x, y, c.z, ARCH(), archMeta.cube(mat));
    }
}

/** Fill a rectangle of floor at the clicked surface level. */
export function fillFloor(ed: Edits, a: P3, b: P3, mat: number, id = ARCH(), meta?: number): void {
  const r = rect(a, b);
  for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) ed.set(x, a.y, z, id, meta ?? archMeta.cube(mat));
}

export interface RoomOptions {
  wallHeight: number;
  wallMat: number;
  floorMat: number;
  ceiling: boolean;
  ceilingMat: number;
}

/** Floor at the clicked level, 4 walls on the perimeter, optional ceiling. Doors/windows are not added. */
export function buildRoom(ed: Edits, a: P3, b: P3, o: RoomOptions): void {
  const r = rect(a, b);
  fillFloor(ed, { ...a, x: r.x0, z: r.z0 }, { ...a, x: r.x1, z: r.z1 }, o.floorMat);
  for (let z = r.z0; z <= r.z1; z++)
    for (let x = r.x0; x <= r.x1; x++) {
      const edge = x === r.x0 || x === r.x1 || z === r.z0 || z === r.z1;
      for (let h = 1; h <= o.wallHeight; h++) {
        const y = a.y + h;
        if (edge) {
          if (overwritable(ed.get(x, y, z)[0])) ed.set(x, y, z, ARCH(), archMeta.cube(o.wallMat));
        } else {
          // clear the interior (plants, old blocks)
          const cur = ed.get(x, y, z)[0];
          if (cur !== 0 && overwritable(cur)) ed.set(x, y, z, 0, 0);
        }
      }
      if (o.ceiling) ed.set(x, a.y + o.wallHeight + 1, z, ARCH(), archMeta.cube(edge ? o.wallMat : o.ceilingMat));
    }
}

/** Foundation slab at the clicked level, optionally raised 1–2 blocks. */
export function buildFoundation(ed: Edits, a: P3, b: P3, mat: number, raised: number): void {
  const r = rect(a, b);
  for (let z = r.z0; z <= r.z1; z++)
    for (let x = r.x0; x <= r.x1; x++)
      for (let h = 0; h <= raised; h++) ed.set(x, a.y + h, z, ARCH(), archMeta.cube(mat));
}

// ---------------------------------------------------------------- roofs

export type RoofType = 'flat' | 'gable' | 'shed' | 'hip';

export interface RoofOptions {
  type: RoofType;
  /** steep = 45° slopes; low = half-block rise per block (gable / shed). Defaults: shed low, others steep. */
  pitch?: 'steep' | 'low';
  mat: number;
  overhang: 0 | 1;
  /** Material for gable-end triangles (usually the wall material). */
  gableMat: number;
  /** Flat roofs: add a thin parapet/overhang rim. */
  rim?: boolean;
}

/**
 * Roof over the footprint a–b, starting on the layer above the given wall top
 * (baseY = first empty layer above the walls). Uses dedicated slope and
 * corner meshes, never stair approximations.
 */
export function buildRoof(ed: Edits, a: P3, b: P3, baseY: number, o: RoofOptions): void {
  const r = rect(a, b);
  const ov = o.overhang;
  const x0 = r.x0 - ov, x1 = r.x1 + ov, z0 = r.z0 - ov, z1 = r.z1 + ov;
  const slope = B.ARCH_SLOPE, outer = B.ARCH_SLOPE_OUTER, inner = B.ARCH_SLOPE_INNER;
  const put = (x: number, y: number, z: number, id: number, meta: number) => {
    if (overwritable(ed.get(x, y, z)[0])) ed.set(x, y, z, id, meta);
  };
  const rotMeta = (rot: number) => archMeta.rotated(o.mat, rot);
  if (o.type === 'flat') {
    for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) put(x, baseY, z, ARCH(), archMeta.cube(o.mat));
    // thin overhang rim one block out
    if (ov) {
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) continue;
          put(x, baseY, z, B.ARCH_PANEL_H, archMeta.panelH(o.mat, true));
        }
    }
    return;
  }
  // Slope rotation that rises toward +Z is 0; +X → 3; -Z → 2; -X → 1  (rot maps canonical +Z)
  const RISE_PZ = 0, RISE_NX = 1, RISE_NZ = 2, RISE_PX = 3;
  const w = x1 - x0 + 1, d = z1 - z0 + 1;
  const eave = baseY - ov; // with an overhang the eave hangs one layer lower, outside the walls
  const low = (o.pitch ?? (o.type === 'shed' ? 'low' : 'steep')) === 'low' && o.type !== 'hip';
  /** Slope piece + its y for the k-th row counted from the eave (k = 0 at the eave). */
  const rowPiece = (k: number): { id: number; y: number; top: number } => {
    if (!low) return { id: slope, y: eave + k, top: eave + k + 1 };
    const level = Math.floor(k / 2);
    return k % 2 === 0 ? { id: B.ARCH_SLOPE_LOW1, y: eave + level, top: eave + level + 0.5 } : { id: B.ARCH_SLOPE_LOW2, y: eave + level, top: eave + level + 1 };
  };
  if (o.type === 'shed') {
    // single slope rising across the short axis, high side at max z (or max x)
    const alongX = w >= d;
    const n = alongX ? d : w;
    for (let i = 0; i < n; i++) {
      const rp = rowPiece(i);
      for (let j = alongX ? x0 : z0; j <= (alongX ? x1 : z1); j++) {
        if (alongX) put(j, rp.y, z0 + i, rp.id, rotMeta(RISE_PZ));
        else put(x0 + i, rp.y, j, rp.id, rotMeta(RISE_PX));
      }
      // side triangles filled with the gable material (under the slope, above the walls)
      for (let y = baseY; y < rp.y; y++) {
        if (alongX) {
          if (z0 + i >= r.z0 && z0 + i <= r.z1) {
            put(r.x0, y, z0 + i, ARCH(), archMeta.cube(o.gableMat));
            put(r.x1, y, z0 + i, ARCH(), archMeta.cube(o.gableMat));
          }
        } else if (x0 + i >= r.x0 && x0 + i <= r.x1) {
          put(x0 + i, y, r.z0, ARCH(), archMeta.cube(o.gableMat));
          put(x0 + i, y, r.z1, ARCH(), archMeta.cube(o.gableMat));
        }
      }
    }
    // high back wall filled up to the roof
    const backRow = alongX ? r.z1 - z0 : r.x1 - x0;
    const hy = rowPiece(backRow).y;
    for (let i = 0; i < (alongX ? w : d); i++) {
      for (let y = baseY; y < hy; y++) {
        if (alongX) {
          const x = x0 + i;
          if (x >= r.x0 && x <= r.x1) put(x, y, r.z1, ARCH(), archMeta.cube(o.gableMat));
        } else {
          const z = z0 + i;
          if (z >= r.z0 && z <= r.z1) put(r.x1, y, z, ARCH(), archMeta.cube(o.gableMat));
        }
      }
    }
    return;
  }
  if (o.type === 'gable') {
    // ridge along the long axis
    const alongX = w >= d;
    const n = alongX ? d : w;
    const half = Math.floor(n / 2);
    for (let i = 0; i < n; i++) {
      const fromLow = Math.min(i, n - 1 - i);
      const rp = rowPiece(fromLow);
      const isRidge = n % 2 === 1 && i === half;
      const risePos = i < n / 2;
      for (let j = alongX ? x0 : z0; j <= (alongX ? x1 : z1); j++) {
        const x = alongX ? j : x0 + i, z = alongX ? z0 + i : j;
        if (isRidge) {
          if (low && rp.id === B.ARCH_SLOPE_LOW2) put(x, rp.y, z, ARCH(), archMeta.cube(o.mat));
          else put(x, rp.y, z, B.ARCH_SLAB, archMeta.slab(o.mat, false));
        } else if (alongX) put(x, rp.y, z, rp.id, rotMeta(risePos ? RISE_PZ : RISE_NZ));
        else put(x, rp.y, z, rp.id, rotMeta(risePos ? RISE_PX : RISE_NX));
      }
      // gable end walls (triangles) at both ends, inside the wall line
      for (let y2 = baseY; y2 < rp.y; y2++) {
        if (alongX) {
          const z = z0 + i;
          if (z >= r.z0 && z <= r.z1) {
            put(r.x0, y2, z, ARCH(), archMeta.cube(o.gableMat));
            put(r.x1, y2, z, ARCH(), archMeta.cube(o.gableMat));
          }
        } else {
          const x = x0 + i;
          if (x >= r.x0 && x <= r.x1) {
            put(x, y2, r.z0, ARCH(), archMeta.cube(o.gableMat));
            put(x, y2, r.z1, ARCH(), archMeta.cube(o.gableMat));
          }
        }
      }
    }
    return;
  }
  // hip: concentric rings rising inward; corners use outer-corner pieces
  const rings = Math.ceil(Math.min(w, d) / 2);
  for (let k = 0; k < rings; k++) {
    const ax0 = x0 + k, ax1 = x1 - k, az0 = z0 + k, az1 = z1 - k;
    const y = eave + k;
    if (ax0 > ax1 || az0 > az1) break;
    if (ax0 === ax1 || az0 === az1) {
      // final ridge line
      for (let z = az0; z <= az1; z++) for (let x = ax0; x <= ax1; x++) put(x, y, z, B.ARCH_SLAB, archMeta.slab(o.mat, false));
      break;
    }
    for (let x = ax0 + 1; x < ax1; x++) {
      put(x, y, az0, slope, rotMeta(RISE_PZ));
      put(x, y, az1, slope, rotMeta(RISE_NZ));
    }
    for (let z = az0 + 1; z < az1; z++) {
      put(ax0, y, z, slope, rotMeta(RISE_PX));
      put(ax1, y, z, slope, rotMeta(RISE_NX));
    }
    // outer corners: canonical apex at (+x,+z) → rot 0 for the (-x,-z) corner
    put(ax0, y, az0, outer, rotMeta(0));
    put(ax1, y, az0, outer, rotMeta(1));
    put(ax1, y, az1, outer, rotMeta(2));
    put(ax0, y, az1, outer, rotMeta(3));
  }
  void inner;
}

// ---------------------------------------------------------------- pools & water

export interface PoolOptions {
  depth: number;
  tile: number;
  coping: number;
  steps: boolean;
}

/**
 * Swimming pool in the ground rectangle a–b (the clicked surface level):
 * excavate, line walls/floor with tile, coping ring, optional steps, fill with water.
 */
export function buildPool(ed: Edits, a: P3, b: P3, o: PoolOptions): void {
  const r = rect(a, b);
  const top = a.y; // surface level: water surface sits here
  const floorY = top - o.depth;
  for (let z = r.z0 - 1; z <= r.z1 + 1; z++)
    for (let x = r.x0 - 1; x <= r.x1 + 1; x++) {
      const inside = x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
      if (!inside) {
        // walls + coping
        for (let y = floorY; y < top; y++) ed.set(x, y, z, ARCH(), archMeta.cube(o.tile));
        ed.set(x, top, z, ARCH(), archMeta.cube(o.coping));
        continue;
      }
      ed.set(x, floorY, z, ARCH(), archMeta.cube(o.tile));
      for (let y = floorY + 1; y <= top; y++) ed.set(x, y, z, B.WATER, 0);
      // clear anything standing on the water surface (grass tufts)
      const above = ed.get(x, top + 1, z)[0];
      if (above && SHAPE[above] === 2) ed.set(x, top + 1, z, 0, 0);
    }
  if (o.steps && r.x1 - r.x0 >= 2) {
    // a flight of underwater steps along the short end
    const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
    for (let i = 0; i < o.depth; i++) {
      const y = top - 1 - i;
      const len = Math.min(3, (alongX ? r.z1 - r.z0 : r.x1 - r.x0) + 1);
      for (let j = 0; j < len; j++) {
        const x = alongX ? r.x0 + i : r.x0 + j, z = alongX ? r.z0 + j : r.z0 + i;
        // stairs rising toward the pool edge (-X or -Z)
        ed.set(x, y, z, B.ARCH_STAIRS, archMeta.rotated(o.tile, alongX ? 1 : 2));
        for (let yy = y - 1; yy > floorY; yy--) ed.set(x, yy, z, ARCH(), archMeta.cube(o.tile));
      }
    }
  }
}

/** A shallow natural pond / stream bed with sandy edges. */
export function buildPond(ed: Edits, a: P3, b: P3): void {
  const r = rect(a, b);
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  const rx = (r.x1 - r.x0) / 2 + 0.5, rz = (r.z1 - r.z0) / 2 + 0.5;
  const top = a.y;
  for (let z = r.z0 - 1; z <= r.z1 + 1; z++)
    for (let x = r.x0 - 1; x <= r.x1 + 1; x++) {
      const d = Math.hypot((x + 0.5 - cx - 0.5) / rx, (z + 0.5 - cz - 0.5) / rz);
      if (d > 1.15) continue;
      if (d > 0.92) {
        ed.set(x, top, z, B.SAND, 0);
        continue;
      }
      const depth = d < 0.55 ? 2 : 1;
      ed.set(x, top - depth, z, d < 0.55 ? B.CLAY : B.SAND, 0);
      for (let y = top - depth + 1; y <= top; y++) ed.set(x, y, z, B.WATER, 0);
      const above = ed.get(x, top + 1, z)[0];
      if (above && SHAPE[above] === 2) ed.set(x, top + 1, z, 0, 0);
    }
}

// ---------------------------------------------------------------- farm plots

export interface FarmOptions {
  /** Crop block key, or 'mixed' for alternating rows. */
  crop: string;
  /** 0-3 fixed growth stage, or 'grow' for live seedlings. */
  stage: 0 | 1 | 2 | 3 | 'grow';
  irrigation: boolean;
  fence: boolean;
}

export const MIXED_CROPS = ['crop_wheat', 'crop_corn', 'crop_tomato', 'crop_root', 'crop_gourd', 'crop_mint'];

/**
 * A field on the clicked ground: tilled (or watered) soil, crop rows along the
 * longer side, a water channel every 4th row when irrigated (crops next to water
 * stay watered and grow at full speed) and an optional picket fence with a gate
 * gap in the middle of the near side. Returns the cells where crops were planted.
 */
export function buildFarmPlot(ed: Edits, a: P3, b: P3, o: FarmOptions, liveBit = 1): P3[] {
  const r = rect(a, b);
  const y = a.y;
  const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
  const planted: P3[] = [];
  const meta = o.stage === 'grow' ? liveBit : (o.stage << 3);
  const tilled = blockId('tilled'), moist = blockId('tilled_moist');
  for (let z = r.z0; z <= r.z1; z++)
    for (let x = r.x0; x <= r.x1; x++) {
      const row = alongX ? z - r.z0 : x - r.x0;
      const rows = alongX ? r.z1 - r.z0 + 1 : r.x1 - r.x0 + 1;
      const channel = o.irrigation && rows >= 4 && row % 4 === 2 && row !== rows - 1;
      // clear whatever stands on the field (grass, flowers…), never structures
      const above = ed.get(x, y + 1, z)[0];
      if (above && (isReplaceable(above) || SHAPE[above] === 2)) ed.set(x, y + 1, z, 0, 0);
      if (channel) {
        ed.set(x, y, z, B.WATER, 0);
        continue;
      }
      ed.set(x, y, z, o.irrigation ? moist : tilled, 0);
      const crop = o.crop === 'mixed' ? MIXED_CROPS[Math.floor(row / (o.irrigation ? 4 : 1)) % MIXED_CROPS.length] : o.crop;
      if (crop && ed.get(x, y + 1, z)[0] === 0) {
        ed.set(x, y + 1, z, blockId(crop), meta);
        planted.push({ x, y: y + 1, z });
      }
    }
  if (o.fence) {
    const fence = blockId('fence');
    const gateX = Math.floor((r.x0 + r.x1) / 2);
    for (let x = r.x0 - 1; x <= r.x1 + 1; x++)
      for (let z = r.z0 - 1; z <= r.z1 + 1; z++) {
        const edge = x === r.x0 - 1 || x === r.x1 + 1 || z === r.z0 - 1 || z === r.z1 + 1;
        if (!edge) continue;
        if (z === r.z1 + 1 && (x === gateX || x === gateX + 1)) continue; // gate gap
        const cur = ed.get(x, y + 1, z)[0];
        if (cur === 0 || isReplaceable(cur) || SHAPE[cur] === 2) ed.set(x, y + 1, z, fence, 0);
      }
  }
  return planted;
}

// ---------------------------------------------------------------- stairs

/**
 * Straight staircase from the step cell `a` toward `b`. The rise is b.y − a.y
 * (or the horizontal distance when b is level). Cuts headroom through
 * ceilings so multi-story stairwells just work.
 */
export function buildStaircase(ed: Edits, a: P3, b: P3, width: number, mat: number, floating: boolean): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const alongX = Math.abs(dx) >= Math.abs(dz);
  const sx = alongX ? Math.sign(dx) || 1 : 0, sz = alongX ? 0 : Math.sign(dz) || 1;
  let n = b.y - a.y;
  if (n <= 0) n = Math.max(1, Math.abs(alongX ? dx : dz));
  n = Math.min(n, 48);
  // stairs rise toward the direction of travel: +Z → 0, -X → 1, -Z → 2, +X → 3
  const rot = sz > 0 ? 0 : sx < 0 ? 1 : sz < 0 ? 2 : 3;
  const id = floating ? B.ARCH_STAIRS_FLOAT : B.ARCH_STAIRS;
  // width extends to the right of the travel direction
  const px = alongX ? 0 : -sz, pz = alongX ? sx : 0;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < width; k++) {
      const x = a.x + sx * i + px * k, z = a.z + sz * i + pz * k, y = a.y + i;
      ed.set(x, y, z, id, archMeta.rotated(mat, rot));
      for (let h = 1; h <= 3; h++) {
        const cur = ed.get(x, y + h, z)[0];
        if (cur && overwritable(cur) && cur !== B.WATER) ed.set(x, y + h, z, 0, 0);
      }
    }
  }
  return n;
}

// ---------------------------------------------------------------- terrain brushes

const TERRAIN = new Set<number>();
for (const k of ['grass', 'dirt', 'sand', 'gravel', 'stone', 'snow', 'clay', 'leaf_litter', 'amberstone', 'amber_banded', 'tilled', 'tilled_moist']) TERRAIN.add(blockId(k));

export function isTerrain(id: number, meta: number): boolean {
  if (TERRAIN.has(id)) return true;
  if (id === B.ARCH_BLOCK) {
    const g = [archIndex('pavers'), archIndex('pavers_dark'), archIndex('decking'), archIndex('decking_gray'), archIndex('gravel'), archIndex('studio_white'), archIndex('paint_lightgray')];
    return g.includes(meta);
  }
  return false;
}

/** Highest terrain surface in a column at or below `startY` (skips plants/leaves), or -1. */
export function terrainTop(r: BlockReader | Edits, x: number, z: number, startY: number): number {
  for (let y = Math.min(startY, WORLD_HEIGHT - 2); y > 0; y--) {
    const [id, meta] = r instanceof Edits ? r.get(x, y, z) : [r.get(x, y, z), r.getMeta(x, y, z)];
    if (id === 0 || SHAPE[id] === 2 || id === B.WATER) continue;
    if (isTerrain(id, meta)) return y;
    if (SOLID[id] && OPAQUE[id]) return -1; // hit a structure: don't dig into buildings
  }
  return -1;
}

export function brushCells(cx: number, cz: number, size: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const r = (size - 1) / 2;
  for (let dz = -Math.floor(r); dz <= Math.ceil(r); dz++)
    for (let dx = -Math.floor(r); dx <= Math.ceil(r); dx++) {
      if (size > 3 && dx * dx + dz * dz > (r + 0.5) * (r + 0.5)) continue;
      out.push({ x: cx + dx, z: cz + dz });
    }
  return out;
}

export function terrainRaise(ed: Edits, cells: { x: number; z: number }[], fromY: number): void {
  for (const c of cells) {
    const t = terrainTop(ed, c.x, c.z, fromY + 4);
    if (t < 0 || t >= WORLD_HEIGHT - 3) continue;
    const [id, meta] = ed.get(c.x, t, c.z);
    const above = ed.get(c.x, t + 1, c.z)[0];
    if (above && !overwritable(above)) continue;
    ed.set(c.x, t + 1, c.z, id, meta);
    if (id === B.GRASS || id === B.LEAF_LITTER || id === B.SNOW) ed.set(c.x, t, c.z, B.DIRT, 0);
    const plant = ed.get(c.x, t + 2, c.z)[0];
    if (plant && SHAPE[plant] === 2) ed.set(c.x, t + 2, c.z, 0, 0);
  }
}

export function terrainLower(ed: Edits, cells: { x: number; z: number }[], fromY: number): void {
  for (const c of cells) {
    const t = terrainTop(ed, c.x, c.z, fromY + 4);
    if (t <= 2) continue;
    const [id, meta] = ed.get(c.x, t, c.z);
    const plant = ed.get(c.x, t + 1, c.z)[0];
    if (plant && SHAPE[plant] === 2) ed.set(c.x, t + 1, c.z, 0, 0);
    ed.set(c.x, t, c.z, 0, 0);
    const below = ed.get(c.x, t - 1, c.z)[0];
    if (isTerrain(below, 0) && (id === B.GRASS || id === B.SNOW || id === B.ARCH_BLOCK)) ed.set(c.x, t - 1, c.z, id, meta);
  }
}

export function terrainFlatten(ed: Edits, cells: { x: number; z: number }[], targetY: number, surface: [number, number]): void {
  for (const c of cells) {
    const t = terrainTop(ed, c.x, c.z, targetY + 12);
    if (t < 0) continue;
    if (t > targetY) {
      for (let y = t; y > targetY; y--) ed.set(c.x, y, c.z, 0, 0);
      const plant = ed.get(c.x, t + 1, c.z)[0];
      if (plant && SHAPE[plant] === 2) ed.set(c.x, t + 1, c.z, 0, 0);
      ed.set(c.x, targetY, c.z, surface[0], surface[1]);
    } else if (t < targetY) {
      const [id, meta] = ed.get(c.x, t, c.z);
      for (let y = t; y < targetY; y++) ed.set(c.x, y, c.z, B.DIRT, 0);
      ed.set(c.x, targetY, c.z, id, meta);
    }
  }
}

export function paintGround(ed: Edits, cells: { x: number; z: number }[], fromY: number, id: number, meta: number): void {
  for (const c of cells) {
    const t = terrainTop(ed, c.x, c.z, fromY + 4);
    if (t < 0) continue;
    ed.set(c.x, t, c.z, id, meta);
    // grass tufts don't grow on paving
    const plant = ed.get(c.x, t + 1, c.z)[0];
    if (plant && SHAPE[plant] === 2 && id !== B.GRASS) ed.set(c.x, t + 1, c.z, 0, 0);
  }
}

// ---------------------------------------------------------------- stamps (trees / bushes)

export function stampTree(ed: Edits, kind: TreeKind | 'bush_small', x: number, y: number, z: number, seed: number): void {
  if (kind === 'bush_small') {
    for (let dy = 0; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (dy === 1 && (Math.abs(dx) + Math.abs(dz) > 1)) continue;
          ed.soft(x + dx, y + dy, z + dz, B.LEAVES, 0);
        }
    return;
  }
  const writer = {
    put: (px: number, py: number, pz: number, id: number, hard = false, meta = 0) => {
      if (hard) {
        if (overwritable(ed.get(px, py, pz)[0])) ed.set(px, py, pz, id, meta);
      } else ed.soft(px, py, pz, id, meta);
    },
  };
  buildTree(kind, x, y, z, seed, writer);
}

// ---------------------------------------------------------------- wall openings (doors / windows)

/** World cells a door/window replaces, for an object placed at (x, y, z) with yaw `rotation`. */
export function openingCells(def: ObjectDef, x: number, y: number, z: number, rotation: number): P3[] {
  if (!def.opening) return [];
  const out: P3[] = [];
  const { w, h } = def.opening;
  const y0 = def.opening.y0 ?? 0;
  const c = Math.cos(rotation), s = Math.sin(rotation);
  if (def.placement === 'skylight') {
    for (let i = 0; i < w; i++)
      for (let k = 0; k < h; k++) {
        const lx = -w / 2 + 0.5 + i, lz = -h / 2 + 0.5 + k;
        out.push({ x: Math.floor(x + lx * c + lz * s), y: Math.floor(y - 0.5), z: Math.floor(z - lx * s + lz * c) });
      }
    return out;
  }
  const local: [number, number][] = [];
  for (let i = 0; i < w; i++) local.push([-w / 2 + 0.5 + i, 0]);
  if (def.id === 'window_corner') local.push([1.5, 0], [1.5, 1]);
  for (const [lx, lz] of local)
    for (let j = 0; j < h; j++) out.push({ x: Math.floor(x + lx * c + lz * s), y: Math.floor(y) + y0 + j, z: Math.floor(z - lx * s + lz * c) });
  return out;
}

/** Clear the wall cells under an opening (records into ed so undo restores the wall). */
export function cutOpening(ed: Edits, def: ObjectDef, x: number, y: number, z: number, rotation: number): number {
  let n = 0;
  for (const c of openingCells(def, x, y, z, rotation)) {
    const [id] = ed.get(c.x, c.y, c.z);
    if (id !== 0 && id !== B.WATER) {
      ed.set(c.x, c.y, c.z, 0, 0);
      n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------- blueprints (copy / paste)

export interface CapturedBlocks {
  size: [number, number, number];
  blocks: [number, number, number, number, number][];
}

export function captureRegion(r: BlockReader, a: P3, b: P3): CapturedBlocks {
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), z0 = Math.min(a.z, b.z);
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y), z1 = Math.max(a.z, b.z);
  const blocks: [number, number, number, number, number][] = [];
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const id = r.get(x, y, z);
        if (id) blocks.push([x - x0, y - y0, z - z0, id, r.getMeta(x, y, z)]);
      }
  return { size: [x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1], blocks };
}

/** Rotate a block's meta by `steps` × 90° (orientation bits only). */
export function rotateMeta(id: number, meta: number, steps: number): number {
  const s = ((steps % 4) + 4) % 4;
  if (!s) return meta;
  const def = BLOCK_DEFS[id];
  const model = archModelOf(id);
  if (model === 'beam') return s % 2 ? meta ^ 1 : meta;
  if (def.arch?.kind === 'rotated' || def.rotates) return (meta & ~3) | (((meta & 3) + s) & 3);
  return meta;
}

/** Rotate a local cell (lx, lz) inside a sx × sz footprint by `steps` × 90° (same direction as block rotation). */
export function rotateCell(lx: number, lz: number, sx: number, sz: number, steps: number): [number, number] {
  let x = lx, z = lz, w = sx, d = sz;
  for (let i = 0; i < (((steps % 4) + 4) % 4); i++) {
    // (x, z) → (d - 1 - z, x), footprint swaps
    const nx = d - 1 - z, nz = x;
    x = nx;
    z = nz;
    const t = w;
    w = d;
    d = t;
  }
  return [x, z];
}

export function pasteBlocks(ed: Edits, cap: CapturedBlocks, origin: P3, steps: number, includeAir = false): void {
  const [sx, , sz] = cap.size;
  for (const [lx, ly, lz, id, meta] of cap.blocks) {
    const [rx, rz] = rotateCell(lx, lz, sx, sz, steps);
    const x = origin.x + rx, y = origin.y + ly, z = origin.z + rz;
    if (!includeAir && overwritable(id) && id === 0) continue;
    ed.set(x, y, z, id, rotateMeta(id, meta, steps));
  }
}

/** Footprint of a rotated capture. */
export function rotatedSize(size: [number, number, number], steps: number): [number, number, number] {
  return steps % 2 ? [size[2], size[1], size[0]] : size;
}

/** Transform an object position (relative to a capture's min corner) under the same rotation as pasteBlocks. */
export function rotateObjectPos(lx: number, lz: number, sx: number, sz: number, steps: number): [number, number] {
  let x = lx, z = lz, w = sx, d = sz;
  for (let i = 0; i < (((steps % 4) + 4) % 4); i++) {
    const nx = d - z, nz = x;
    x = nx;
    z = nz;
    const t = w;
    w = d;
    d = t;
  }
  return [x, z];
}

export { objectDef };
