import * as THREE from 'three';
import { BLOCK_DEFS } from '../../data/blocks';
import { ARCH_KIND, CUTOUT_CUBE, SHAPE, TILE_BOTTOM, TILE_SIDE, TILE_TOP, LIGHT } from '../world/BlockRegistry';
import { archTile, archTint, emitArch, emitGlassFace } from '../world/ArchShapes';
import { createBuilder, emitBox, FLAG_GLOW, modelBoxesFor, type Builder } from '../world/ChunkMesher';
import { MODELS } from '../world/shapes';
import type { TerrainMaterials } from './TerrainMaterials';

/**
 * Stand-alone geometry for a single block (held items, dropped items, falling
 * trees, icons). Uses the same vertex layout as chunk meshes so it renders with
 * the shared terrain materials and looks identical to placed blocks.
 */
const cache = new Map<string, THREE.BufferGeometry>();

const FACES: { n: [number, number, number]; p: number[]; uv: number[]; face: 'top' | 'bottom' | 'side'; ao: number }[] = [
  { n: [0, 1, 0], p: [0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0], uv: [0, 0, 1, 0, 1, 1, 0, 1], face: 'top', ao: 1 },
  { n: [0, -1, 0], p: [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1], uv: [0, 0, 1, 0, 1, 1, 0, 1], face: 'bottom', ao: 0.6 },
  { n: [1, 0, 0], p: [1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1], uv: [0, 0, 1, 0, 1, 1, 0, 1], face: 'side', ao: 0.82 },
  { n: [-1, 0, 0], p: [0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0], uv: [0, 0, 1, 0, 1, 1, 0, 1], face: 'side', ao: 0.82 },
  { n: [0, 0, 1], p: [0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1], uv: [0, 0, 1, 0, 1, 1, 0, 1], face: 'side', ao: 0.92 },
  { n: [0, 0, -1], p: [1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0], uv: [0, 0, 1, 0, 1, 1, 0, 1], face: 'side', ao: 0.92 },
];

const air = () => 0;

export function emitCube(b: Builder, id: number, x: number, y: number, z: number, tint: number[] = [255, 255, 255], skip?: (dx: number, dy: number, dz: number) => boolean, skyL = 255, meta = 0) {
  const glow = LIGHT[id] > 0 ? FLAG_GLOW : 0;
  const arch = ARCH_KIND[id] !== 0;
  if (arch) tint = archTint(id, meta);
  for (const f of FACES) {
    if (skip && skip(f.n[0], f.n[1], f.n[2])) continue;
    const tile = arch ? archTile(id, meta, f.face === 'side' ? 'side' : 'top') : f.face === 'top' ? TILE_TOP[id] : f.face === 'bottom' ? TILE_BOTTOM[id] : TILE_SIDE[id];
    const p = f.p.map((v, i) => v + (i % 3 === 0 ? x : i % 3 === 1 ? y : z));
    const c = [tint[0], tint[1], tint[2], skyL];
    b.quad(p, f.n, f.uv, tile, glow, [...c, ...c, ...c, ...c], 0, f.ao, false);
  }
}

export function toGeometry(b: Builder): THREE.BufferGeometry {
  const m = b.build();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2));
  g.setAttribute('aData', new THREE.BufferAttribute(m.data, 4));
  g.setAttribute('aColor', new THREE.BufferAttribute(m.colors, 4, true));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  return g;
}

const glassCache = new Map<string, THREE.BufferGeometry | null>();

/** Translucent part of a block (glass walls, glass railings / fences), or null. */
export function blockGlassGeometry(id: number, meta = 0): THREE.BufferGeometry | null {
  const key = `${id}:${meta}`;
  if (glassCache.has(key)) return glassCache.get(key)!;
  const shape = SHAPE[id];
  let g: THREE.BufferGeometry | null = null;
  if (shape === 7 || shape === 6) {
    const glass = createBuilder();
    if (shape === 7) for (let d = 0; d < 6; d++) emitGlassFace(glass, d, -0.5, -0.5, -0.5, meta, 255, 0);
    else emitArch(createBuilder(), glass, id, meta, -0.5, -0.5, -0.5, 255, 0, air);
    if (glass.count > 0) g = toGeometry(glass);
  }
  glassCache.set(key, g);
  return g;
}

/**
 * A ready-to-add object for one block (icons, held items, dropped items,
 * placement ghosts): opaque/cutout part plus an optional glass part.
 */
export function blockObject(id: number, meta: number, materials: TerrainMaterials): THREE.Object3D {
  const group = new THREE.Group();
  if (SHAPE[id] !== 7) {
    const mat = (SHAPE[id] === 1 && !CUTOUT_CUBE[id]) || SHAPE[id] === 6 ? materials.solid : materials.cutout;
    group.add(new THREE.Mesh(blockGeometry(id, meta), mat));
  }
  const glass = blockGlassGeometry(id, meta);
  if (glass) {
    const m = new THREE.Mesh(glass, materials.glass);
    m.renderOrder = 2;
    group.add(m);
  }
  return group;
}

/** Geometry for one block centred on the origin (x/z) with its base at y = -0.5. */
export function blockGeometry(id: number, meta = 0, tint: number[] = [110, 190, 80]): THREE.BufferGeometry {
  const key = `${id}:${meta}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const b = createBuilder();
  const shape = SHAPE[id];
  const def = BLOCK_DEFS[id];
  const tintFor = def.tint ? tint : [255, 255, 255];
  if (shape === 1) emitCube(b, id, -0.5, -0.5, -0.5, tintFor, undefined, 255, meta);
  else if (shape === 6) emitArch(b, createBuilder(), id, meta, -0.5, -0.5, -0.5, 255, 0, air);
  else if (shape === 2) {
    const tile = TILE_SIDE[id] + (def.growth ? def.growth.stages - 1 : 0);
    const c = [tintFor[0], tintFor[1], tintFor[2], 255];
    const quads = [
      [-0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, -0.5],
      [0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5],
    ];
    for (const p of quads) {
      b.quad(p, [0, 1, 0], [0.001, 0.001, 0.999, 0.001, 0.999, 0.999, 0.001, 0.999], tile, LIGHT[id] ? FLAG_GLOW : 0, [...c, ...c, ...c, ...c], 0, 1, false);
    }
  } else if (shape === 4) {
    for (const box of modelBoxesFor(id, meta)) emitBox(b, box, meta & 3, -0.5, -0.5, -0.5, 255, 0, def.modelTile, air);
  } else if (shape === 5) {
    for (const box of MODELS.fence_post) emitBox(b, box, 0, -0.5, -0.5, -0.5, 255, 0, undefined, air);
    for (const r of [1, 3]) for (const box of MODELS.fence_arm_n) emitBox(b, box, r, -0.5, -0.5, -0.5, 255, 0, undefined, air);
  }
  const g = toGeometry(b);
  cache.set(key, g);
  return g;
}

/** Merge many blocks (world positions relative to an origin) into one geometry — used for falling trees. */
export function multiBlockGeometry(blocks: { x: number; y: number; z: number; id: number }[], tint: number[]): THREE.BufferGeometry {
  const b = createBuilder();
  const set = new Set(blocks.map((q) => `${q.x},${q.y},${q.z}`));
  for (const q of blocks) {
    const def = BLOCK_DEFS[q.id];
    emitCube(b, q.id, q.x, q.y, q.z, def.tint ? tint : [255, 255, 255], (dx, dy, dz) => set.has(`${q.x + dx},${q.y + dy},${q.z + dz}`));
  }
  return toGeometry(b);
}

/**
 * Merged preview geometry for many blocks (build ghosts: walls, rooms, roofs,
 * pools, pasted blueprints). Faces between neighbouring preview cubes are culled.
 */
export function previewGeometry(blocks: [number, number, number, number, number][], limit = 12000): { main: THREE.BufferGeometry | null; glass: THREE.BufferGeometry | null } {
  const b = createBuilder();
  const glass = createBuilder();
  const set = new Map<string, number>();
  const list = blocks.length > limit ? blocks.slice(0, limit) : blocks;
  for (const q of list) set.set(`${q[0]},${q[1]},${q[2]}`, q[3]);
  const get = (x: number, y: number, z: number) => set.get(`${x},${y},${z}`) ?? 0;
  for (const [x, y, z, id, meta] of list) {
    const shape = SHAPE[id];
    if (shape === 1) {
      emitCube(b, id, x, y, z, BLOCK_DEFS[id].tint ? [110, 190, 80] : [255, 255, 255], (dx, dy, dz) => {
        const n = get(x + dx, y + dy, z + dz);
        return n !== 0 && SHAPE[n] === 1 && !CUTOUT_CUBE[n];
      }, 255, meta);
    } else if (shape === 6) emitArch(b, glass, id, meta, x, y, z, 255, 0, get);
    else if (shape === 7) {
      for (let d = 0; d < 6; d++) emitGlassFace(glass, d, x, y, z, meta, 255, 0);
    } else if (shape === 4) {
      for (const box of modelBoxesFor(id, meta)) emitBox(b, box, BLOCK_DEFS[id].rotates ? meta & 3 : 0, x, y, z, 255, 0, BLOCK_DEFS[id].modelTile, get);
    } else if (shape === 5) {
      for (const box of MODELS.fence_post) emitBox(b, box, 0, x, y, z, 255, 0, undefined, get);
    } else if (shape === 2 || shape === 3) {
      emitCube(b, id === 0 ? 1 : id, x, y, z, [120, 170, 230], undefined, 255, 0);
    }
  }
  return { main: b.count ? toGeometry(b) : null, glass: glass.count ? toGeometry(glass) : null };
}
