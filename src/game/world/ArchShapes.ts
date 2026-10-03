import { ARCH_MATERIALS, archMaterialOf, GLASS_VARIANTS, hexRgb, type ArchShapeKind } from '../../data/architecture';
import { BLOCK_DEFS, type ArchModel } from '../../data/blocks';
import { B, OPAQUE, SOLID } from './BlockRegistry';
import { tileIndex } from './tiles';
import type { Builder } from './ChunkMesher';

/**
 * Geometry for architecture blocks (slabs, stairs, roof slopes & corners,
 * columns, beams, panels, trims, railings, fences, garden walls).
 *
 * Everything is authored in a canonical orientation (rotation 0: the "high" or
 * "back" side faces +Z) and rotated in 90° steps around the block centre —
 * the same convention as furniture models in shapes.ts. Material tile + tint
 * come from ARCH_MATERIALS via the meta byte. UVs are world-aligned, so
 * textures (shingle rows, floorboards) continue seamlessly across blocks.
 */

type Vec3 = [number, number, number];
type Get = (x: number, y: number, z: number) => number;

const KIND_OF: ArchShapeKind[] = [];
const MODEL_OF: (ArchModel | undefined)[] = [];
BLOCK_DEFS.forEach((d, i) => {
  if (d.arch) {
    KIND_OF[i] = d.arch.kind;
    MODEL_OF[i] = d.arch.model;
  }
});

/** Pre-resolved material render info: tile layers + tint bytes. */
const MAT_TILE = ARCH_MATERIALS.map((m) => tileIndex(m.tile));
const MAT_TOP = ARCH_MATERIALS.map((m) => tileIndex(m.topTile ?? m.tile));
const MAT_TINT = ARCH_MATERIALS.map((m) => hexRgb(m.tint));
const GLASS_TILE = tileIndex('glass_pane');
const GLASS_TINT = GLASS_VARIANTS.map((g) => hexRgb(g.tint));

export function archKindOf(id: number): ArchShapeKind | undefined {
  return KIND_OF[id];
}

export function archModelOf(id: number): ArchModel | undefined {
  return MODEL_OF[id];
}

/** Material index for an architecture block (0 for non-architecture blocks). */
export function archMaterialIndex(id: number, meta: number): number {
  const k = KIND_OF[id];
  if (!k) return 0;
  const mi = archMaterialOf(k, meta);
  return mi < ARCH_MATERIALS.length ? mi : 0;
}

export function archTile(id: number, meta: number, face: 'top' | 'side'): number {
  const mi = archMaterialIndex(id, meta);
  return face === 'top' ? MAT_TOP[mi] : MAT_TILE[mi];
}

export function archTint(id: number, meta: number): [number, number, number] {
  if (id === B.ARCH_GLASS) return GLASS_TINT[Math.min(meta, GLASS_TINT.length - 1)] ?? GLASS_TINT[0];
  return MAT_TINT[archMaterialIndex(id, meta)];
}

export function glassOpacity(meta: number): number {
  return (GLASS_VARIANTS[meta] ?? GLASS_VARIANTS[0]).opacity;
}

// ---------------------------------------------------------------- low-level emission

interface Ctx {
  b: Builder;
  glass: Builder | null;
  x: number;
  y: number;
  z: number;
  rot: number;
  tile: number;
  topTile: number;
  tint: [number, number, number];
  skyL: number;
  bl: number;
  get: Get;
}

/** Rotate a canonical point (block-local 0..1) by rot × 90° around the centre. */
function rp(p: Vec3, rot: number): Vec3 {
  let x = p[0], z = p[2];
  for (let r = 0; r < (rot & 3); r++) {
    const nx = 1 - z;
    z = x;
    x = nx;
  }
  return [x, p[1], z];
}

function rn(n: Vec3, rot: number): Vec3 {
  let x = n[0], z = n[2];
  for (let r = 0; r < (rot & 3); r++) {
    const nx = -z;
    z = x;
    x = nx;
  }
  return [x, n[1], z];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/**
 * Emit a planar polygon (3 or 4 canonical-space vertices) with an outward
 * normal hint. Winding is fixed up automatically; UVs are world aligned.
 */
function poly(c: Ctx, verts: Vec3[], outward: Vec3, builder: Builder, tile: number, alphaOrAo = 1, flags = 0) {
  const w = verts.map((v) => rp(v, c.rot));
  const out = rn(outward, c.rot);
  let n = norm(cross(sub(w[1], w[0]), sub(w[2], w[0])));
  if (dot(n, out) < 0) {
    w.reverse();
    n = [-n[0], -n[1], -n[2]];
  }
  if (w.length === 3) w.push(w[2]);
  const pos: number[] = [];
  const uv: number[] = [];
  // world-aligned UVs
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  let tu: Vec3, tv: Vec3;
  if (ay > 0.99) {
    tu = [1, 0, 0];
    tv = [0, 0, 1];
  } else if (ax > 0.99) {
    tu = [0, 0, n[0] > 0 ? -1 : 1];
    tv = [0, 1, 0];
  } else if (az > 0.99) {
    tu = [n[2] > 0 ? 1 : -1, 0, 0];
    tv = [0, 1, 0];
  } else {
    // sloped: u along the horizontal edge, v up the slope
    tu = norm(cross([0, 1, 0], n));
    if (Math.hypot(tu[0], tu[2]) < 0.1) tu = [1, 0, 0];
    tv = cross(n, tu);
    if (tv[1] < 0) tv = [-tv[0], -tv[1], -tv[2]];
  }
  for (const v of w) {
    const px = c.x + v[0], py = c.y + v[1], pz = c.z + v[2];
    pos.push(px, py, pz);
    uv.push(dot([px, py, pz], tu), dot([px, py, pz], tv));
  }
  const col = [c.tint[0], c.tint[1], c.tint[2], c.skyL];
  const nn = [Math.round(n[0] * 100), Math.round(n[1] * 100), Math.round(n[2] * 100)];
  builder.quad(pos, nn, uv, tile, flags, [...col, ...col, ...col, ...col], c.bl, alphaOrAo, false);
}

const FACE_DIRS: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** Canonical-space cuboid (0..16 units). Faces flush with an opaque neighbour are culled. */
function box(c: Ctx, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, builder: Builder = c.b, glassAlpha = 0) {
  const a = [x0 / 16, y0 / 16, z0 / 16], e = [x1 / 16, y1 / 16, z1 / 16];
  const faces: [number, Vec3[]][] = [
    [0, [[e[0], a[1], a[2]], [e[0], e[1], a[2]], [e[0], e[1], e[2]], [e[0], a[1], e[2]]]],
    [1, [[a[0], a[1], a[2]], [a[0], a[1], e[2]], [a[0], e[1], e[2]], [a[0], e[1], a[2]]]],
    [2, [[a[0], e[1], a[2]], [a[0], e[1], e[2]], [e[0], e[1], e[2]], [e[0], e[1], a[2]]]],
    [3, [[a[0], a[1], a[2]], [e[0], a[1], a[2]], [e[0], a[1], e[2]], [a[0], a[1], e[2]]]],
    [4, [[a[0], a[1], e[2]], [e[0], a[1], e[2]], [e[0], e[1], e[2]], [a[0], e[1], e[2]]]],
    [5, [[a[0], a[1], a[2]], [a[0], e[1], a[2]], [e[0], e[1], a[2]], [e[0], a[1], a[2]]]],
  ];
  for (const [d, verts] of faces) {
    const dir = FACE_DIRS[d];
    const flush = (d === 0 && x1 >= 16) || (d === 1 && x0 <= 0) || (d === 2 && y1 >= 16) || (d === 3 && y0 <= 0) || (d === 4 && z1 >= 16) || (d === 5 && z0 <= 0);
    if (flush) {
      const w = rn(dir, c.rot);
      if (OPAQUE[c.get(c.x + w[0], c.y + w[1], c.z + w[2])]) continue;
    }
    const tile = builder === c.glass ? GLASS_TILE : d === 2 || d === 3 ? c.topTile : c.tile;
    poly(c, verts, dir, builder, tile, builder === c.glass ? glassAlpha : 1);
  }
}

/** Is the (rotated) neighbour in canonical direction `dir` an opaque full cube? */
function opaqueAt(c: Ctx, dir: Vec3): boolean {
  const w = rn(dir, c.rot);
  return OPAQUE[c.get(c.x + w[0], c.y + w[1], c.z + w[2])] === 1;
}

// ---------------------------------------------------------------- models

function slope(c: Ctx) {
  // low edge z=0 (y=0), high edge z=1 (y=1)
  if (!opaqueAt(c, [0, -1, 0])) poly(c, [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], [0, -1, 0], c.b, c.topTile);
  if (!opaqueAt(c, [0, 0, 1])) poly(c, [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], [0, 0, 1], c.b, c.tile);
  poly(c, [[0, 0, 0], [1, 0, 0], [1, 1, 1], [0, 1, 1]], [0, 1, -1], c.b, c.topTile);
  if (!opaqueAt(c, [-1, 0, 0])) poly(c, [[0, 0, 0], [0, 0, 1], [0, 1, 1]], [-1, 0, 0], c.b, c.tile);
  if (!opaqueAt(c, [1, 0, 0])) poly(c, [[1, 0, 0], [1, 0, 1], [1, 1, 1]], [1, 0, 0], c.b, c.tile);
}

/** Low-pitch roof: rises half a block per block (low1: 0 → ½, low2: ½ → 1). */
function slopeLow(c: Ctx, y0: number, y1: number) {
  if (!opaqueAt(c, [0, -1, 0])) poly(c, [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], [0, -1, 0], c.b, c.topTile);
  poly(c, [[0, 0, 1], [1, 0, 1], [1, y1, 1], [0, y1, 1]], [0, 0, 1], c.b, c.tile);
  if (y0 > 0) poly(c, [[0, 0, 0], [0, y0, 0], [1, y0, 0], [1, 0, 0]], [0, 0, -1], c.b, c.tile);
  poly(c, [[0, y0, 0], [1, y0, 0], [1, y1, 1], [0, y1, 1]], [0, 1, -0.5], c.b, c.topTile);
  for (const x of [0, 1]) {
    const verts: Vec3[] = y0 > 0 ? [[x, 0, 0], [x, 0, 1], [x, y1, 1], [x, y0, 0]] : [[x, 0, 0], [x, 0, 1], [x, y1, 1]];
    if (!opaqueAt(c, [x === 0 ? -1 : 1, 0, 0])) poly(c, verts, [x === 0 ? -1 : 1, 0, 0], c.b, c.tile);
  }
}

function slopeOuter(c: Ctx) {
  // low edges along z=0 and x=0, apex at (1,1,1)
  const A: Vec3 = [0, 0, 0], Bp: Vec3 = [1, 0, 0], C: Vec3 = [1, 0, 1], D: Vec3 = [0, 0, 1], E: Vec3 = [1, 1, 1];
  if (!opaqueAt(c, [0, -1, 0])) poly(c, [A, Bp, C, D], [0, -1, 0], c.b, c.topTile);
  poly(c, [A, Bp, E], [0, 1, -1], c.b, c.topTile);
  poly(c, [A, E, D], [-1, 1, 0], c.b, c.topTile);
  if (!opaqueAt(c, [1, 0, 0])) poly(c, [Bp, C, E], [1, 0, 0], c.b, c.tile);
  if (!opaqueAt(c, [0, 0, 1])) poly(c, [D, C, E], [0, 0, 1], c.b, c.tile);
}

function slopeInner(c: Ctx) {
  // low only at (0,0,0); edges x=1 and z=1 full height
  if (!opaqueAt(c, [0, -1, 0])) poly(c, [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], [0, -1, 0], c.b, c.topTile);
  if (!opaqueAt(c, [1, 0, 0])) poly(c, [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], [1, 0, 0], c.b, c.tile);
  if (!opaqueAt(c, [0, 0, 1])) poly(c, [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], [0, 0, 1], c.b, c.tile);
  if (!opaqueAt(c, [-1, 0, 0])) poly(c, [[0, 0, 0], [0, 0, 1], [0, 1, 1]], [-1, 0, 0], c.b, c.tile);
  if (!opaqueAt(c, [0, 0, -1])) poly(c, [[0, 0, 0], [1, 0, 0], [1, 1, 0]], [0, 0, -1], c.b, c.tile);
  poly(c, [[0, 0, 0], [1, 1, 0], [1, 1, 1]], [-1, 1, 0], c.b, c.topTile);
  poly(c, [[0, 0, 0], [1, 1, 1], [0, 1, 1]], [0, 1, -1], c.b, c.topTile);
}

function roundColumn(c: Ctx) {
  const seg = 12, r = 5.5 / 16, cx = 0.5, cz = 0.5;
  const same = (dy: number) => {
    const id = c.get(c.x, c.y + dy, c.z);
    return id === B.ARCH_COLUMN_ROUND || OPAQUE[id] === 1;
  };
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p0: Vec3 = [cx + Math.cos(a0) * r, 0, cz + Math.sin(a0) * r];
    const p1: Vec3 = [cx + Math.cos(a1) * r, 0, cz + Math.sin(a1) * r];
    const am = (a0 + a1) / 2;
    poly(c, [p0, p1, [p1[0], 1, p1[2]], [p0[0], 1, p0[2]]], [Math.cos(am), 0, Math.sin(am)], c.b, c.tile);
    if (!same(1)) poly(c, [[cx, 1, cz], [p0[0], 1, p0[2]], [p1[0], 1, p1[2]]], [0, 1, 0], c.b, c.topTile);
    if (!same(-1)) poly(c, [[cx, 0, cz], [p0[0], 0, p0[2]], [p1[0], 0, p1[2]]], [0, -1, 0], c.b, c.topTile);
  }
}

/** Neighbour connection test for fences / garden walls (canonical dir). */
function connects(c: Ctx, dx: number, dz: number, self: number): boolean {
  const id = c.get(c.x + dx, c.y, c.z + dz);
  if (id === self) return true;
  if (id === B.ARCH_FENCE || id === B.ARCH_FENCE_GLASS || id === B.ARCH_WALL_LOW || id === B.FENCE || id === B.FENCE_GATE) return true;
  return SOLID[id] === 1 && OPAQUE[id] === 1;
}

const CONNECT_DIRS: [number, number, number][] = [[0, -1, 0], [1, 0, 1], [0, 1, 2], [-1, 0, 3]];

function fence(c: Ctx, id: number) {
  // post
  box(c, 6, 0, 6, 10, 16, 10);
  for (const [dx, dz, r] of CONNECT_DIRS) {
    if (!connects(c, dx, dz, id)) continue;
    const saved = c.rot;
    c.rot = r;
    // arm toward canonical -Z (rot rotates it into place)
    if (id === B.ARCH_FENCE_GLASS) {
      box(c, 7.4, 1, 0, 8.6, 13, 6, c.glass ?? c.b, 0.35);
      box(c, 7, 13, 0, 9, 14.5, 6);
      box(c, 7, 0, 0, 9, 1, 6);
    } else {
      box(c, 7, 4, 0, 9, 7, 6);
      box(c, 7, 10, 0, 9, 13, 6);
    }
    c.rot = saved;
  }
}

function lowWall(c: Ctx) {
  box(c, 4, 0, 4, 12, 13, 12);
  for (const [dx, dz, r] of CONNECT_DIRS) {
    if (!connects(c, dx, dz, B.ARCH_WALL_LOW)) continue;
    const saved = c.rot;
    c.rot = r;
    box(c, 5, 0, 0, 11, 12, 4);
    c.rot = saved;
  }
}

export function emitArch(
  b: Builder, glass: Builder | null, id: number, meta: number, x: number, y: number, z: number, skyL: number, bl: number, get: Get,
): void {
  const model = MODEL_OF[id];
  if (!model) return;
  const kind = KIND_OF[id];
  const rot = kind === 'rotated' ? meta & 3 : 0;
  const mi = archMaterialIndex(id, meta);
  const c: Ctx = { b, glass, x, y, z, rot, tile: MAT_TILE[mi], topTile: MAT_TOP[mi], tint: MAT_TINT[mi], skyL, bl, get };
  switch (model) {
    case 'slab':
      if (meta & 64) box(c, 0, 8, 0, 16, 16, 16);
      else box(c, 0, 0, 0, 16, 8, 16);
      break;
    case 'stairs':
      box(c, 0, 0, 0, 16, 8, 16);
      box(c, 0, 8, 8, 16, 16, 16);
      break;
    case 'stairs_float':
      box(c, 0, 6, 0.5, 16, 8, 8);
      box(c, 0, 14, 8.5, 16, 16, 16);
      break;
    case 'slope': slope(c); break;
    case 'slope_outer': slopeOuter(c); break;
    case 'slope_inner': slopeInner(c); break;
    case 'slope_low1': slopeLow(c, 0, 0.5); break;
    case 'slope_low2': slopeLow(c, 0.5, 1); break;
    case 'column': box(c, 3, 0, 3, 13, 16, 13); break;
    case 'column_round': roundColumn(c); break;
    case 'beam': {
      c.rot = 0;
      const high = (meta & 2) !== 0;
      const y0 = high ? 10 : 0, y1 = high ? 16 : 6;
      if (meta & 1) box(c, 5, y0, 0, 11, y1, 16);
      else box(c, 0, y0, 5, 16, y1, 11);
      break;
    }
    case 'panel_h':
      if (meta & 1) box(c, 0, 14, 0, 16, 16, 16);
      else box(c, 0, 0, 0, 16, 2, 16);
      break;
    case 'panel_v': box(c, 0, 0, 14, 16, 16, 16); break;
    case 'baseboard': box(c, 0, 0, 15, 16, 2.5, 16); break;
    case 'crown':
      box(c, 0, 14.5, 15, 16, 16, 16);
      box(c, 0, 15.2, 14.2, 16, 16, 15);
      break;
    case 'railing_glass':
      box(c, 0, 15, 7, 16, 16, 9);
      box(c, 0, 0, 7, 16, 1, 9);
      box(c, 0, 1, 7.6, 16, 15, 8.4, glass ?? b, 0.3);
      break;
    case 'railing_bars':
      box(c, 0, 15, 7, 16, 16, 9);
      box(c, 0, 1.5, 7.5, 16, 2.5, 8.5);
      for (const bx of [1.5, 5.5, 9.5, 13.5]) box(c, bx, 0, 7.5, bx + 1, 15, 8.5);
      break;
    case 'fence_rail':
    case 'fence_glass':
      fence(c, id);
      break;
    case 'wall_low': lowWall(c); break;
    default:
      break;
  }
}

/** Emit one face of a glass cube into the translucent builder (neighbour culling done by the caller). */
export function emitGlassFace(glass: Builder, d: number, x: number, y: number, z: number, meta: number, skyL: number, bl: number) {
  const tint = archTint(B.ARCH_GLASS, meta);
  const c: Ctx = { b: glass, glass, x, y, z, rot: 0, tile: GLASS_TILE, topTile: GLASS_TILE, tint, skyL, bl, get: () => 0 };
  const quads: Vec3[][] = [
    [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
    [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
    [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
  ];
  poly(c, quads[d], FACE_DIRS[d], glass, GLASS_TILE, glassOpacity(meta));
}

// ---------------------------------------------------------------- collision / selection boxes

export type Box = [number, number, number, number, number, number];

function rotBox(bx: Box, rot: number): Box {
  const a = rp([bx[0], bx[1], bx[2]], rot), e = rp([bx[3], bx[4], bx[5]], rot);
  return [Math.min(a[0], e[0]), bx[1], Math.min(a[2], e[2]), Math.max(a[0], e[0]), bx[4], Math.max(a[2], e[2])];
}

const U = (v: number) => v / 16;

/** Collision boxes (block-local 0..1, y may exceed 1 for fences) of an architecture block. */
export function archCollision(id: number, meta: number): Box[] {
  const model = MODEL_OF[id];
  const rot = KIND_OF[id] === 'rotated' ? meta & 3 : 0;
  const R = (b: Box) => rotBox(b, rot);
  switch (model) {
    case 'cube': case 'glass': return [[0, 0, 0, 1, 1, 1]];
    case 'slab': return meta & 64 ? [[0, 0.5, 0, 1, 1, 1]] : [[0, 0, 0, 1, 0.5, 1]];
    case 'stairs': case 'stairs_float': case 'slope': case 'slope_inner':
      return [[0, 0, 0, 1, 0.5, 1], R([0, 0.5, 0.5, 1, 1, 1])];
    case 'slope_outer': return [[0, 0, 0, 1, 0.5, 1], R([0.5, 0.5, 0.5, 1, 1, 1])];
    case 'slope_low1': return [[0, 0, 0, 1, 0.25, 1], R([0, 0.25, 0.5, 1, 0.5, 1])];
    case 'slope_low2': return [[0, 0, 0, 1, 0.75, 1], R([0, 0.75, 0.5, 1, 1, 1])];
    case 'column': return [[U(3), 0, U(3), U(13), 1, U(13)]];
    case 'column_round': return [[U(2.5), 0, U(2.5), U(13.5), 1, U(13.5)]];
    case 'beam': {
      const high = (meta & 2) !== 0;
      const y0 = high ? U(10) : 0, y1 = high ? 1 : U(6);
      return meta & 1 ? [[U(5), y0, 0, U(11), y1, 1]] : [[0, y0, U(5), 1, y1, U(11)]];
    }
    case 'panel_h': return meta & 1 ? [[0, U(14), 0, 1, 1, 1]] : [[0, 0, 0, 1, U(2), 1]];
    case 'panel_v': return [R([0, 0, U(14), 1, 1, 1])];
    case 'baseboard': case 'crown': return [];
    case 'railing_glass': case 'railing_bars': return [R([0, 0, U(7), 1, 1, U(9)])];
    case 'fence_rail': case 'fence_glass': return [[0, 0, 0, 1, 1.5, 1]];
    case 'wall_low': return [[0, 0, 0, 1, U(13), 1]];
    default: return [[0, 0, 0, 1, 1, 1]];
  }
}

/** Selection (outline / raycast) box for an architecture block. */
export function archSelection(id: number, meta: number): Box {
  const model = MODEL_OF[id];
  const rot = KIND_OF[id] === 'rotated' ? meta & 3 : 0;
  switch (model) {
    case 'baseboard': return rotBox([0, 0, U(14), 1, U(3.5), 1], rot);
    case 'crown': return rotBox([0, U(13), U(13), 1, 1, 1], rot);
    case 'fence_rail': case 'fence_glass': return [U(5), 0, U(5), U(11), 1, U(11)];
    case 'wall_low': return [U(3), 0, U(3), U(13), U(13), U(13)];
    default: {
      const boxes = archCollision(id, meta);
      if (!boxes.length) return [0, 0, 0, 1, 1, 1];
      const o: Box = [1, 1, 1, 0, 0, 0];
      for (const bx of boxes) {
        o[0] = Math.min(o[0], bx[0]); o[1] = Math.min(o[1], bx[1]); o[2] = Math.min(o[2], bx[2]);
        o[3] = Math.max(o[3], bx[3]); o[4] = Math.min(1, Math.max(o[4], bx[4])); o[5] = Math.max(o[5], bx[5]);
      }
      return o;
    }
  }
}
