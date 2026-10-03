import { BLOCK_DEFS } from '../../data/blocks';
import {
  ARCH_KIND, B, CUTOUT_CUBE, LIGHT, LIQUID, OPAQUE, SHAPE, SKYBLOCK, SOLID, SWAY, TILE_BOTTOM, TILE_SIDE, TILE_TOP, TILE_VARIANTS, TINT,
} from './BlockRegistry';
import { archTile, archTint, emitArch, emitGlassFace } from './ArchShapes';
import { CHUNK_SIZE, WORLD_HEIGHT } from './constants';
import { MODELS, rotateBox, type ModelBox } from './shapes';
import { tileIndex, type TileName } from './tiles';

/**
 * Greedy voxel mesher with per-vertex ambient occlusion, sky exposure and
 * propagated block light (torches, lanterns, crystals).
 *
 * Input is the 3×3 chunk neighbourhood (48 × H × 48) so that border faces are
 * culled correctly and light from a torch in a neighbouring chunk reaches this
 * one. Output is plain typed arrays (transferable from workers):
 *   solid  – opaque cubes (no alpha test → early-z friendly)
 *   cutout – leaves, glass, plants, furniture models (alpha tested)
 *   water  – liquid surface + waterfall sheets (custom shader)
 */

export const PAD = CHUNK_SIZE * 3;
export const OFF = CHUNK_SIZE;
const H = WORLD_HEIGHT;
const S = CHUNK_SIZE;

export interface MeshInput {
  blocks: Uint8Array; // PAD*H*PAD neighbourhood (missing neighbours = air)
  meta: Uint8Array;
  tints: Uint8Array; // 16*16*9 (centre chunk only)
}

export interface MeshArrays {
  positions: Float32Array;
  normals: Int8Array;
  uvs: Float32Array;
  /** Per vertex: tile layer, flags, block light (0..15), ambient occlusion / shade (0..1). */
  data: Float32Array;
  /** rgb = biome tint (applied through the texture's tint mask), a = sky exposure (0..255). */
  colors: Uint8Array;
  indices: Uint32Array;
}

export interface WaterArrays {
  positions: Float32Array;
  colors: Uint8Array;
  /** Per vertex: flow kind (0 surface, 1 falling sheet), block light, depth below surface. */
  flow: Float32Array;
  indices: Uint32Array;
}

export interface ChunkMeshResult {
  solid: MeshArrays;
  cutout: MeshArrays;
  /** Translucent glass walls / panes (sorted after opaque, before water). */
  glass: MeshArrays;
  water: WaterArrays;
}

/** Flags encoded in data[1]. */
export const FLAG_SWAY = 1;
export const FLAG_SWAY_SOFT = 2;
export const FLAG_GLOW = 4;
export const FLAG_VARIANT = 8;

/** Index into the neighbourhood volume for centre-chunk-local coordinates (-16..31). */
export function padIndex(x: number, y: number, z: number): number {
  return (y * PAD + (z + OFF)) * PAD + (x + OFF);
}

class Builder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  dat: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  count = 0;

  quad(
    p: ArrayLike<number>, // 4 vertices × 3
    n: ArrayLike<number>,
    uvs: ArrayLike<number>, // 4 × 2
    tile: number,
    flags: ArrayLike<number> | number,
    colors: ArrayLike<number>, // 4 × 4 (0..255)
    light: ArrayLike<number> | number,
    ao: ArrayLike<number> | number,
    flip: boolean,
  ) {
    const base = this.count;
    for (let i = 0; i < 4; i++) {
      this.pos.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      this.nor.push(n[0], n[1], n[2]);
      this.uv.push(uvs[i * 2], uvs[i * 2 + 1]);
      this.dat.push(
        tile, typeof flags === 'number' ? flags : flags[i], typeof light === 'number' ? light : light[i], typeof ao === 'number' ? ao : ao[i],
      );
      this.col.push(colors[i * 4], colors[i * 4 + 1], colors[i * 4 + 2], colors[i * 4 + 3]);
    }
    if (flip) this.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.count += 4;
  }

  build(): MeshArrays {
    return {
      positions: new Float32Array(this.pos),
      normals: new Int8Array(this.nor),
      uvs: new Float32Array(this.uv),
      data: new Float32Array(this.dat),
      colors: new Uint8Array(this.col),
      indices: new Uint32Array(this.idx),
    };
  }
}

const AO_CURVE = [0.52, 0.68, 0.84, 1.0];

/** Directions: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z */
const DIRS: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/**
 * Flood-fill block light from every emitter in the neighbourhood.
 * Light passes through anything that is not an opaque cube, losing 1 per step.
 */
export function computeBlockLight(blocks: Uint8Array): Uint8Array {
  const light = new Uint8Array(blocks.length);
  const queue = new Int32Array(1 << 16);
  let head = 0;
  let tail = 0;
  const mask = queue.length - 1;
  for (let i = 0; i < blocks.length; i++) {
    const l = LIGHT[blocks[i]];
    if (l > 0) {
      light[i] = l;
      queue[tail++ & mask] = i;
    }
  }
  if (tail === 0) return light;
  const layer = PAD * PAD;
  while (head !== tail) {
    const i = queue[head++ & mask];
    const l = light[i];
    if (l <= 1) continue;
    const nl = l - 1;
    const x = i % PAD;
    const z = ((i / PAD) | 0) % PAD;
    const y = (i / layer) | 0;
    // six neighbours
    if (x > 0) tryN(i - 1);
    if (x < PAD - 1) tryN(i + 1);
    if (z > 0) tryN(i - PAD);
    if (z < PAD - 1) tryN(i + PAD);
    if (y > 0) tryN(i - layer);
    if (y < H - 1) tryN(i + layer);
    function tryN(j: number) {
      if (OPAQUE[blocks[j]] || light[j] >= nl) return;
      light[j] = nl;
      if (tail - head < mask) queue[tail++ & mask] = j;
    }
  }
  return light;
}

export function meshChunk(input: MeshInput): ChunkMeshResult {
  const { blocks, meta, tints } = input;
  const solid = new Builder();
  const cutout = new Builder();
  const glass = new Builder();
  const blockLight = computeBlockLight(blocks);

  // Sky exposure: highest light-blocking block per column (foliage & plants let light through).
  const skyTop = new Int16Array((S + 2) * (S + 2));
  for (let z = -1; z <= S; z++)
    for (let x = -1; x <= S; x++) {
      let top = -1;
      for (let y = H - 1; y >= 0; y--) {
        const id = blocks[padIndex(x, y, z)];
        if (SKYBLOCK[id]) {
          top = y;
          break;
        }
      }
      skyTop[(z + 1) * (S + 2) + (x + 1)] = top;
    }

  const get = (x: number, y: number, z: number): number => (y < 0 ? B.DEEPSTONE : y >= H ? 0 : blocks[padIndex(x, y, z)]);
  const blAt = (x: number, y: number, z: number): number => (y < 0 || y >= H ? 0 : blockLight[padIndex(x, y, z)]);
  const sky = (x: number, y: number, z: number): number => {
    const cx = x < -1 ? -1 : x > S ? S : x;
    const cz = z < -1 ? -1 : z > S ? S : z;
    const top = skyTop[(cz + 1) * (S + 2) + (cx + 1)];
    if (y > top) return 255;
    const depth = top - y;
    return Math.max(18, Math.round(255 * (1 - depth * 0.1)));
  };
  const tintOf = (id: number, face: number, x: number, z: number, out: number[]) => {
    const kind = TINT[id];
    void face;
    if (kind === 0 || x < 0 || z < 0 || x >= S || z >= S) {
      out[0] = 255; out[1] = 255; out[2] = 255;
      return;
    }
    const t = (z * S + x) * 9 + (kind === 1 ? 0 : 3);
    out[0] = tints[t]; out[1] = tints[t + 1]; out[2] = tints[t + 2];
  };

  // ---------------------------------------------------------------- greedy cube faces
  // Hot loop: works directly on flat indices with per-axis strides (no temp arrays).
  const maxDim = Math.max(S, H);
  const mask = new Float64Array(maxDim * maxDim);
  const aoCache = new Uint8Array(maxDim * maxDim * 4);
  const blCache = new Uint8Array(maxDim * maxDim * 4);
  const c = [0, 0, 0];
  const tint = [0, 0, 0];
  const aos = [0, 0, 0, 0];
  const bls = [0, 0, 0, 0];
  const cornerU = [-1, 1, 1, -1];
  const cornerV = [-1, -1, 1, 1];
  const SY = PAD * PAD, SZ = PAD;
  const strides = [1, SY, SZ];
  const origin = padIndex(0, 0, 0);
  // Only scan the vertical band that can contain visible faces.
  // A layer matters if it has cubes and non-opaque cells exist in it or the layer above/below.
  const rowCube = new Uint8Array(H), rowOpen = new Uint8Array(H);
  for (let y = 0; y < H; y++) {
    for (let z = -1; z <= S && !(rowCube[y] && rowOpen[y]); z++)
      for (let x = -1; x <= S; x++) {
        const id = blocks[padIndex(x, y, z)];
        if (!OPAQUE[id]) rowOpen[y] = 1;
        if (SHAPE[id] === 1) rowCube[y] = 1;
      }
  }
  let yLo = H, yHi = 0;
  for (let y = 0; y < H; y++) {
    const open = rowOpen[y] || (y > 0 && rowOpen[y - 1]) || y === H - 1 || rowOpen[y + 1];
    if (rowCube[y] && open) {
      if (y < yLo) yLo = y;
      yHi = y;
    }
  }
  yLo = Math.max(0, yLo - 1);
  yHi = Math.min(H - 1, yHi + 1);
  // opaque test for an index whose y is known
  const opq = (i: number, y: number): number => (y < 0 ? 1 : y >= H ? 0 : OPAQUE[blocks[i]]);
  const blq = (i: number, y: number): number => (y < 0 || y >= H ? 0 : blockLight[i]);

  for (let d = 0; d < 6; d++) {
    const [nx, ny, nz] = DIRS[d];
    const axis = nx !== 0 ? 0 : ny !== 0 ? 1 : 2;
    const uAxis: number = axis === 0 ? 2 : 0;
    const vAxis: number = axis === 1 ? 2 : 1;
    const dims = [S, H, S];
    const uSize = dims[uAxis];
    const vSize = dims[vAxis];
    const aStride = strides[axis], uStride = strides[uAxis], vStride = strides[vAxis];
    const nOff = nx + ny * SY + nz * SZ;
    const sFrom = axis === 1 ? yLo : 0, sTo = axis === 1 ? yHi + 1 : S;
    const vFrom = vAxis === 1 ? yLo : 0, vTo = vAxis === 1 ? yHi + 1 : vSize;

    for (let s = sFrom; s < sTo; s++) {
      let any = false;
      mask.fill(0);
      for (let v = vFrom; v < vTo; v++) {
        const y = axis === 1 ? s : v; // y of the block
        const ay = y + ny;
        for (let u = 0; u < uSize; u++) {
          const idx = origin + s * aStride + u * uStride + v * vStride;
          const id = blocks[idx];
          if (SHAPE[id] !== 1) continue;
          if (ay < 0) continue;
          const aIdx = idx + nOff;
          const nid = ay >= H ? 0 : blocks[aIdx];
          if (OPAQUE[nid]) continue;
          if (CUTOUT_CUBE[id] && nid === id) continue; // leaves-to-leaves / glass-to-glass
          const mi = v * uSize + u;
          let blKey = 0;
          let skyQ = 15;
          if (ay >= H) {
            aos[0] = aos[1] = aos[2] = aos[3] = 3;
            bls[0] = bls[1] = bls[2] = bls[3] = 0;
          } else {
            const faceBL = blockLight[aIdx];
            for (let k = 0; k < 4; k++) {
              const du = cornerU[k], dv = cornerV[k];
              const s1 = aIdx + du * uStride, s2 = aIdx + dv * vStride, cc = s1 + dv * vStride;
              const y1 = uAxis === 1 ? ay + du : ay;
              const y2 = vAxis === 1 ? ay + dv : ay;
              const yc = ay + (uAxis === 1 ? du : 0) + (vAxis === 1 ? dv : 0);
              const o1 = opq(s1, y1), o2 = opq(s2, y2), oc = opq(cc, yc);
              aos[k] = o1 && o2 ? 0 : 3 - (o1 + o2 + oc);
              let sum = faceBL, n = 1;
              if (!o1) { sum += blq(s1, y1); n++; }
              if (!o2) { sum += blq(s2, y2); n++; }
              if (!oc && !(o1 && o2)) { sum += blq(cc, yc); n++; }
              bls[k] = Math.round(sum / n);
              blKey = blKey * 16 + bls[k];
            }
            c[axis] = s; c[uAxis] = u; c[vAxis] = v;
            skyQ = Math.round(sky(c[0] + nx, ay, c[2] + nz) / 17);
          }
          c[axis] = s; c[uAxis] = u; c[vAxis] = v;
          let tq: number;
          if (ARCH_KIND[id]) tq = meta[idx]; // architecture material index (tile + tint)
          else {
            tintOf(id, d, c[0], c[2], tint);
            tq = ((tint[0] >> 3) << 10) | ((tint[1] >> 3) << 5) | (tint[2] >> 3);
          }
          const aoKey = aos[0] | (aos[1] << 2) | (aos[2] << 4) | (aos[3] << 6);
          // id(8) tint(15) ao(8) sky(4) blocklight(16) → 51 bits, exact in a double.
          mask[mi] = ((((id * 32768 + tq) * 256 + aoKey) * 16 + skyQ) * 65536 + blKey) + 1;
          const o = mi * 4;
          aoCache[o] = aos[0]; aoCache[o + 1] = aos[1]; aoCache[o + 2] = aos[2]; aoCache[o + 3] = aos[3];
          blCache[o] = bls[0]; blCache[o + 1] = bls[1]; blCache[o + 2] = bls[2]; blCache[o + 3] = bls[3];
          any = true;
        }
      }
      if (!any) continue;

      for (let v = vFrom; v < vTo; v++) {
        for (let u = 0; u < uSize; ) {
          const mi = v * uSize + u;
          const key = mask[mi];
          if (key === 0) {
            u++;
            continue;
          }
          let w = 1;
          while (u + w < uSize && mask[v * uSize + u + w] === key) w++;
          let h = 1;
          outer: while (v + h < vTo) {
            for (let k = 0; k < w; k++) if (mask[(v + h) * uSize + u + k] !== key) break outer;
            h++;
          }
          c[axis] = s; c[uAxis] = u; c[vAxis] = v;
          const pi = padIndex(c[0], c[1], c[2]);
          const id = blocks[pi];
          const o = mi * 4;
          const skyQ = Math.floor((key - 1) / 65536) % 16;
          let tileOverride = -1;
          if (ARCH_KIND[id]) {
            const mt = meta[pi];
            const at = archTint(id, mt);
            tint[0] = at[0]; tint[1] = at[1]; tint[2] = at[2];
            tileOverride = archTile(id, mt, d === 2 || d === 3 ? 'top' : 'side');
          } else tintOf(id, d, c[0], c[2], tint);
          emitGreedyQuad(
            CUTOUT_CUBE[id] ? cutout : solid,
            id, d, axis, uAxis, vAxis, s, u, v, w, h,
            [aoCache[o], aoCache[o + 1], aoCache[o + 2], aoCache[o + 3]],
            [blCache[o], blCache[o + 1], blCache[o + 2], blCache[o + 3]],
            skyQ * 17, tint, tileOverride,
          );
          for (let hv = 0; hv < h; hv++) for (let k = 0; k < w; k++) mask[(v + hv) * uSize + u + k] = 0;
          u += w;
        }
      }
    }
  }

  // ---------------------------------------------------------------- non-cube shapes
  for (let y = 0; y < H; y++)
    for (let z = 0; z < S; z++)
      for (let x = 0; x < S; x++) {
        const id = blocks[padIndex(x, y, z)];
        const shape = SHAPE[id];
        if (shape < 2 || shape === 3) continue;
        const m = meta[padIndex(x, y, z)];
        if (shape === 7) {
          // glass wall: faces toward anything but the same glass or an opaque cube
          for (let d = 0; d < 6; d++) {
            const [dx, dy, dz] = DIRS[d];
            const n = get(x + dx, y + dy, z + dz);
            if (OPAQUE[n] || (n === id && meta[padIndex(x + dx, Math.max(0, Math.min(H - 1, y + dy)), z + dz)] === m)) continue;
            emitGlassFace(glass, d, x, y, z, m, sky(x + dx, y + dy, z + dz), blAt(x + dx, y + dy, z + dz));
          }
          continue;
        }
        const skyL = sky(x, y, z);
        const bl = blAt(x, y, z);
        if (shape === 2) {
          tintOf(id, 2, x, z, tint);
          emitCross(cutout, id, m, x, y, z, skyL, bl, tint);
        } else if (shape === 4) emitModel(cutout, id, m, x, y, z, skyL, bl, get);
        else if (shape === 5) emitFence(cutout, x, y, z, skyL, bl, get);
        else if (shape === 6) emitArch(solid, glass, id, m, x, y, z, skyL, bl, get);
      }

  return { solid: solid.build(), cutout: cutout.build(), glass: glass.build(), water: meshWater(blocks, tints, sky, blAt) };
}

function emitGreedyQuad(
  b: Builder, id: number, d: number, axis: number, uAxis: number, vAxis: number,
  s: number, u: number, v: number, w: number, h: number, aos: number[], bls: number[], skyL: number, tint: number[], tileOverride = -1,
) {
  const [nx, ny, nz] = DIRS[d];
  const positive = nx + ny + nz > 0;
  const pos = (du: number, dv: number): number[] => {
    const p = [0, 0, 0];
    p[axis] = s + (positive ? 1 : 0);
    p[uAxis] = u + du;
    p[vAxis] = v + dv;
    return p;
  };
  const p0 = pos(0, 0), p1 = pos(w, 0), p2 = pos(w, h), p3 = pos(0, h);
  const tile = tileOverride >= 0 ? tileOverride : d === 2 ? TILE_TOP[id] : d === 3 ? TILE_BOTTOM[id] : TILE_SIDE[id];
  let flags = TILE_VARIANTS[id] > 1 ? FLAG_VARIANT : 0;
  if (SWAY[id]) flags |= FLAG_SWAY_SOFT;
  if (LIGHT[id] > 0) flags |= FLAG_GLOW;
  const colors: number[] = [];
  const ao: number[] = [];
  for (let k = 0; k < 4; k++) {
    colors.push(tint[0], tint[1], tint[2], skyL);
    ao.push(AO_CURVE[aos[k]]);
  }
  // UVs in block units — the shader repeats the tile per block with fract().
  const uvAt = (p: number[]): number[] => {
    if (axis === 1) return [p[0], p[2]];
    if (axis === 0) return [nx > 0 ? -p[2] : p[2], p[1]];
    return [nz > 0 ? p[0] : -p[0], p[1]];
  };
  const uvs = [...uvAt(p0), ...uvAt(p1), ...uvAt(p2), ...uvAt(p3)];
  const needsReverse = axis === 2 ? !positive : positive;
  const flip = aos[0] + aos[2] > aos[1] + aos[3];
  if (!needsReverse) {
    b.quad([...p0, ...p1, ...p2, ...p3], DIRS[d], uvs, tile, flags, colors, bls, ao, flip);
  } else {
    const rc = [colors.slice(0, 4), colors.slice(12, 16), colors.slice(8, 12), colors.slice(4, 8)].flat();
    const ruv = [uvs[0], uvs[1], uvs[6], uvs[7], uvs[4], uvs[5], uvs[2], uvs[3]];
    const rbl = [bls[0], bls[3], bls[2], bls[1]];
    const rao = [ao[0], ao[3], ao[2], ao[1]];
    b.quad([...p0, ...p3, ...p2, ...p1], DIRS[d], ruv, tile, flags, rc, rbl, rao, flip);
  }
}

function emitCross(b: Builder, id: number, m: number, x: number, y: number, z: number, skyL: number, bl: number, tint: number[]) {
  let tile = TILE_SIDE[id];
  const def = BLOCK_DEFS[id];
  if (def.growth) tile += Math.min(def.growth.stages - 1, (m >> 3) & 7);
  if (id === B.BERRY_BUSH && ((m >> 3) & 1)) tile += 1;
  // Deterministic jitter so fields of grass don't look like a grid.
  const hx = ((((x * 73856093) ^ (z * 19349663) ^ (y * 83492791)) >>> 0) % 1000) / 1000;
  const hz = ((((x * 19349663) ^ (z * 73856093) ^ (y * 5)) >>> 0) % 1000) / 1000;
  const grass = id === B.TALL_GRASS;
  const jx = grass ? (hx - 0.5) * 0.3 : 0;
  const jz = grass ? (hz - 0.5) * 0.3 : 0;
  const height = grass ? 0.75 + hx * 0.35 : 1;
  const x0 = x + 0.15 + jx, x1 = x + 0.85 + jx, z0 = z + 0.15 + jz, z1 = z + 0.85 + jz;
  const y0 = y, y1 = y + height;
  const glow = LIGHT[id] > 0 ? FLAG_GLOW : 0;
  const top = (SWAY[id] ? FLAG_SWAY : 0) | glow;
  const fl = [glow, glow, top, top];
  const col: number[] = [];
  for (let k = 0; k < 4; k++) col.push(tint[0], tint[1], tint[2], skyL);
  // Slight darkening at the base of plants reads as contact shadow.
  const ao = [0.7, 0.7, 1, 1];
  const uv = [0.001, 0.001, 0.999, 0.001, 0.999, 0.999, 0.001, 0.999];
  const uvr = [0.999, 0.001, 0.001, 0.001, 0.001, 0.999, 0.999, 0.999];
  const quads: [number[], number[]][] = [
    [[x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0], [1, 0, -1]],
    [[x1, y0, z0, x0, y0, z1, x0, y1, z1, x1, y1, z0], [-1, 0, -1]],
  ];
  // The cutout material is double-sided, so one quad per plane is enough.
  for (const [p] of quads) b.quad(p, [0, 1, 0], uv, tile, fl, col, bl, ao, false);
  void uvr;
}

function faceTile(box: ModelBox, face: 'top' | 'bottom' | 'side' | 'front', override?: TileName): number {
  if (override) return tileIndex(override);
  if (typeof box.tiles === 'string') return tileIndex(box.tiles);
  const t = box.tiles;
  const name = face === 'front' ? t.front ?? t.side : face === 'top' ? t.top ?? t.side : face === 'bottom' ? t.bottom ?? t.side : t.side;
  return tileIndex((name ?? 'planks') as TileName);
}

export function modelBoxesFor(id: number, m: number): ModelBox[] {
  const def = BLOCK_DEFS[id];
  if (def.model === 'door') {
    if (id === B.DOOR_UPPER) return (m & 4) ? MODELS.door_open_upper : MODELS.door_closed_upper;
    return (m & 4) ? MODELS.door_open : MODELS.door_closed;
  }
  if (def.model === 'gate') return (m & 4) ? MODELS.gate_open : MODELS.gate_closed;
  return (def.model && MODELS[def.model]) || [];
}

export function emitBox(
  b: Builder, box: ModelBox, rot: number, x: number, y: number, z: number, skyL: number, bl: number,
  override: TileName | undefined, get: (x: number, y: number, z: number) => number,
) {
  const [from, to] = rotateBox(box.from, box.to, rot);
  const x0 = x + from[0] / 16, y0 = y + from[1] / 16, z0 = z + from[2] / 16;
  const x1 = x + to[0] / 16, y1 = y + to[1] / 16, z1 = z + to[2] / 16;
  const flags = box.glow ? FLAG_GLOW : 0;
  const lit = box.glow ? 255 : skyL;
  const white = [255, 255, 255, lit, 255, 255, 255, lit, 255, 255, 255, lit, 255, 255, 255, lit];
  if (box.cross) {
    const tile = faceTile(box, 'side', override);
    const cxm = (x0 + x1) / 2, czm = (z0 + z1) / 2;
    const r = Math.max(x1 - x0, z1 - z0) / 2;
    const quads = [
      [cxm - r * 0.7, y0, czm - r * 0.7, cxm + r * 0.7, y0, czm + r * 0.7, cxm + r * 0.7, y1, czm + r * 0.7, cxm - r * 0.7, y1, czm - r * 0.7],
      [cxm + r * 0.7, y0, czm - r * 0.7, cxm - r * 0.7, y0, czm + r * 0.7, cxm - r * 0.7, y1, czm + r * 0.7, cxm + r * 0.7, y1, czm - r * 0.7],
    ];
    const uv = [0.001, 0.001, 0.999, 0.001, 0.999, 0.999, 0.001, 0.999];
    const uvr = [0.999, 0.001, 0.001, 0.001, 0.001, 0.999, 0.999, 0.999];
    for (const p of quads) b.quad(p, [0, 1, 0], uv, tile, flags, white, bl, 1, false);
    void uvr;
    return;
  }
  // After r rotations the unrotated front (+Z) points to: r0 +Z, r1 -X, r2 -Z, r3 +X.
  const frontDir = [4, 1, 5, 0][rot & 3];
  const u = (a: number) => Math.min(0.999, Math.max(0.001, a));
  const fx0 = from[0] / 16, fx1 = to[0] / 16, fy0 = from[1] / 16, fy1 = to[1] / 16, fz0 = from[2] / 16, fz1 = to[2] / 16;
  const faces: { d: number; p: number[]; uv: number[]; shade: number }[] = [
    { d: 2, p: [x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0], uv: [u(fx0), u(1 - fz1), u(fx1), u(1 - fz1), u(fx1), u(1 - fz0), u(fx0), u(1 - fz0)], shade: 1 },
    { d: 3, p: [x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1], uv: [u(fx0), u(fz0), u(fx1), u(fz0), u(fx1), u(fz1), u(fx0), u(fz1)], shade: 0.55 },
    { d: 0, p: [x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1], uv: [u(1 - fz1), u(fy0), u(1 - fz0), u(fy0), u(1 - fz0), u(fy1), u(1 - fz1), u(fy1)], shade: 0.8 },
    { d: 1, p: [x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0], uv: [u(fz0), u(fy0), u(fz1), u(fy0), u(fz1), u(fy1), u(fz0), u(fy1)], shade: 0.8 },
    { d: 4, p: [x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1], uv: [u(fx0), u(fy0), u(fx1), u(fy0), u(fx1), u(fy1), u(fx0), u(fy1)], shade: 0.9 },
    { d: 5, p: [x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0], uv: [u(1 - fx1), u(fy0), u(1 - fx0), u(fy0), u(1 - fx0), u(fy1), u(1 - fx1), u(fy1)], shade: 0.9 },
  ];
  for (const f of faces) {
    const [nx, ny, nz] = DIRS[f.d];
    const flush =
      (f.d === 0 && to[0] >= 16) || (f.d === 1 && from[0] <= 0) || (f.d === 2 && to[1] >= 16) ||
      (f.d === 3 && from[1] <= 0) || (f.d === 4 && to[2] >= 16) || (f.d === 5 && from[2] <= 0);
    if (flush && OPAQUE[get(x + nx, y + ny, z + nz)]) continue;
    const kind = f.d === 2 ? 'top' : f.d === 3 ? 'bottom' : f.d === frontDir ? 'front' : 'side';
    b.quad(f.p, DIRS[f.d], f.uv, faceTile(box, kind, override), flags, white, bl, f.shade, false);
  }
}

function emitModel(b: Builder, id: number, m: number, x: number, y: number, z: number, skyL: number, bl: number, get: (x: number, y: number, z: number) => number) {
  const def = BLOCK_DEFS[id];
  const boxes = modelBoxesFor(id, m);
  for (const box of boxes) emitBox(b, box, def.rotates ? m & 3 : 0, x, y, z, skyL, bl, def.modelTile, get);
}

export function fenceConnects(id: number): boolean {
  return id === B.FENCE || id === B.FENCE_GATE || id === B.ARCH_FENCE || id === B.ARCH_WALL_LOW || (SOLID[id] === 1 && OPAQUE[id] === 1);
}

function emitFence(b: Builder, x: number, y: number, z: number, skyL: number, bl: number, get: (x: number, y: number, z: number) => number) {
  for (const box of MODELS.fence_post) emitBox(b, box, 0, x, y, z, skyL, bl, undefined, get);
  // rot 0: -Z, rot 1: +X, rot 2: +Z, rot 3: -X
  const offs: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (let r = 0; r < 4; r++) {
    const [dx, dz] = offs[r];
    if (!fenceConnects(get(x + dx, y, z + dz))) continue;
    for (const box of MODELS.fence_arm_n) emitBox(b, box, r, x, y, z, skyL, bl, undefined, get);
  }
}

// ---------------------------------------------------------------- water
const SURF = 0.88;

function meshWater(
  blocks: Uint8Array, tints: Uint8Array, sky: (x: number, y: number, z: number) => number, blAt: (x: number, y: number, z: number) => number,
): WaterArrays {
  const pos: number[] = [];
  const col: number[] = [];
  const flow: number[] = [];
  const idx: number[] = [];
  let count = 0;
  const getB = (x: number, y: number, z: number) => (y < 0 || y >= H ? 0 : blocks[padIndex(x, y, z)]);
  const isWater = (x: number, y: number, z: number) => LIQUID[getB(x, y, z)] === 1;
  const waterTint = (x: number, z: number): number[] => {
    const cx = Math.min(S - 1, Math.max(0, x));
    const cz = Math.min(S - 1, Math.max(0, z));
    const t = (cz * S + cx) * 9 + 6;
    return [tints[t], tints[t + 1], tints[t + 2]];
  };
  const depthBelow = (x: number, y: number, z: number): number => {
    let d = 0;
    while (d < 8 && isWater(x, y - d, z)) d++;
    return d;
  };
  const push = (p: number[], c: number[], kind: number, light: number, depths: number[]) => {
    for (let i = 0; i < 4; i++) {
      pos.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      col.push(c[0], c[1], c[2], c[3]);
      flow.push(kind, light, depths[i]);
    }
    idx.push(count, count + 1, count + 2, count, count + 2, count + 3);
    count += 4;
  };

  // Top surfaces: one quad per block so depth can vary per vertex (cheap: water tops are sparse).
  for (let y = 0; y < H; y++)
    for (let z = 0; z < S; z++)
      for (let x = 0; x < S; x++) {
        if (!isWater(x, y, z) || isWater(x, y + 1, z)) continue;
        if (OPAQUE[getB(x, y + 1, z)]) continue;
        const t = waterTint(x, z);
        const light = sky(x, y + 1, z);
        const bl = blAt(x, y + 1, z);
        const yy = y + SURF;
        // Depth sampled at the 4 corners (average of adjoining columns) for smooth shore gradients.
        const dAt = (cx: number, cz: number) => {
          let sum = 0, n = 0;
          for (const [ox, oz] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
            const wx = cx + ox, wz = cz + oz;
            if (isWater(wx, y, wz)) { sum += depthBelow(wx, y, wz); n++; }
          }
          return n ? sum / n : 0;
        };
        push(
          [x, yy, z + 1, x + 1, yy, z + 1, x + 1, yy, z, x, yy, z],
          [t[0], t[1], t[2], light], 0, bl,
          [dAt(x, z + 1), dAt(x + 1, z + 1), dAt(x + 1, z), dAt(x, z)],
        );
      }

  // Side faces (waterfall sheets & exposed edges).
  for (let y = 0; y < H; y++)
    for (let z = 0; z < S; z++)
      for (let x = 0; x < S; x++) {
        if (!isWater(x, y, z)) continue;
        const top = isWater(x, y + 1, z) ? 1 : SURF;
        const t = waterTint(x, z);
        const light = sky(x, y, z);
        const sides: [number, number, number[]][] = [
          [1, 0, [x + 1, y, z + 1, x + 1, y, z, x + 1, y + top, z, x + 1, y + top, z + 1]],
          [-1, 0, [x, y, z, x, y, z + 1, x, y + top, z + 1, x, y + top, z]],
          [0, 1, [x, y, z + 1, x + 1, y, z + 1, x + 1, y + top, z + 1, x, y + top, z + 1]],
          [0, -1, [x + 1, y, z, x, y, z, x, y + top, z, x + 1, y + top, z]],
        ];
        for (const [dx, dz, p] of sides) {
          const n = getB(x + dx, y, z + dz);
          if (LIQUID[n] || OPAQUE[n]) continue;
          push(p, [t[0], t[1], t[2], light], 1, blAt(x + dx, y, z + dz), [2, 2, 2, 2]);
        }
        if (y > 0 && !isWater(x, y - 1, z) && !OPAQUE[getB(x, y - 1, z)]) {
          push([x, y, z, x + 1, y, z, x + 1, y, z + 1, x, y, z + 1], [t[0], t[1], t[2], light], 1, blAt(x, y - 1, z), [2, 2, 2, 2]);
        }
      }

  return { positions: new Float32Array(pos), colors: new Uint8Array(col), flow: new Float32Array(flow), indices: new Uint32Array(idx) };
}

/** Transferable buffers of a mesh result (for postMessage). */
export function meshTransferables(r: ChunkMeshResult): ArrayBuffer[] {
  const list: ArrayBuffer[] = [];
  for (const m of [r.solid, r.cutout, r.glass]) {
    list.push(m.positions.buffer as ArrayBuffer, m.normals.buffer as ArrayBuffer, m.uvs.buffer as ArrayBuffer, m.data.buffer as ArrayBuffer, m.colors.buffer as ArrayBuffer, m.indices.buffer as ArrayBuffer);
  }
  list.push(r.water.positions.buffer as ArrayBuffer, r.water.colors.buffer as ArrayBuffer, r.water.flow.buffer as ArrayBuffer, r.water.indices.buffer as ArrayBuffer);
  return list;
}

/** A standalone Builder for tiny meshes on the main thread (falling trees, held blocks, icons). */
export function createBuilder(): Builder {
  return new Builder();
}
export type { Builder };
