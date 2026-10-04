import { archIndex, archMeta } from '../../data/architecture';
import { BIOMES } from '../../data/biomes';
import { BLOCK_DEFS } from '../../data/blocks';
import { hash2 } from '../core/random';
import { B, blockId, SOLID } from '../world/BlockRegistry';
import type { ChunkGenResult } from '../world/Chunk';
import { mapColorFor } from '../world/ChunkGenerator';
import { CHUNK_SIZE, CHUNK_VOLUME, WORLD_HEIGHT } from '../world/constants';
import { localIndex } from '../world/coordinates';

/**
 * "City Clash" — the Deathmatch battlefield.
 *
 * A compact modern voxel city (152 × 152 playable blocks) designed for 1v1 up
 * to 4v4. It is a fixed, hand-authored blueprint (with seed-driven colour
 * variation): every client generates exactly the same geometry locally in the
 * world workers, so no block data is ever sent over the network, and the host
 * uses the same blueprint for bullet occlusion without needing chunks loaded.
 *
 * Layout (north = -Z, Red spawns west, Blue east; mirror-symmetric in X):
 *
 *        back alley ─────────────────────────────────────────────
 *        NW apartments (roof access) │ WAREHOUSE (D) │ NE apartments
 *        corner store · parking      │ mezzanine     │ corner store · parking
 *        ────────── north street ─────────────────────────────────
 *   RED  gas station                 │ health station│ gas station   BLUE
 *  SPAWN cafe ── connector ── street │ CENTRAL PLAZA │ street ── connector ── cafe  SPAWN
 *   (A)  bank                        │ (C) fountain  │ bank            (B)
 *        bus depot                   │ health station│ bus depot
 *        ────────── south street ─────────────────────────────────
 *        shop strip · container yard │ RESIDENTIAL(E)│ shop strip · container yard
 *        back alley ─────────────────────────────────────────────
 *
 * Elevated positions (F): apartment rooftops, warehouse mezzanine, container tops.
 * Boundary: a ring of tall buildings with road blocks where the streets end.
 */

/** Block y of the street surface (players stand at CITY_G + 1). */
export const CITY_G = 40;
/** Playable area: feet stay inside |x| ≤ PLAY_HALF and |z| ≤ PLAY_HALF. */
export const PLAY_HALF = 76;
const WALL_IN = 76; // first boundary cell on the + side; the - side starts at -77
const WALL_OUT = 80;
const SKYLINE = 136;

export type Team = 'red' | 'blue';
export type LootTier = 'common' | 'uncommon' | 'rare';

export interface MapPoint {
  x: number;
  y: number;
  z: number;
}

export interface SpawnPoint extends MapPoint {
  /** Facing (yaw) — toward the middle of the city. */
  yaw: number;
}

export interface LootPoint extends MapPoint {
  id: string;
  tier: LootTier;
}

// ---------------------------------------------------------------- materials

const A = (key: string): number => B.ARCH_BLOCK | (archIndex(key) << 8);
const ID = {
  glass: blockId('arch_glass'),
  slab: blockId('arch_slab'),
  stairs: blockId('arch_stairs'),
  column: blockId('arch_column'),
  fence: blockId('arch_fence'),
  wallLow: blockId('arch_wall_low'),
  hedge: blockId('hedge'),
  hedgeLow: blockId('hedge_low'),
  lantern: blockId('lantern'),
  railing: blockId('arch_railing_bars'),
};
const GLASS = (variant = 2): number => ID.glass | (variant << 8);
const SLAB = (key: string, top = false): number => ID.slab | (archMeta.slab(archIndex(key), top) << 8);
/** Stairs climbing toward: 0 = +Z (south), 1 = -X (west), 2 = -Z (north), 3 = +X (east). */
const STAIRS = (key: string, rot: number): number => ID.stairs | (archMeta.rotated(archIndex(key), rot) << 8);
const COLUMN = (key: string): number => ID.column | (archMeta.rotated(archIndex(key), 0) << 8);
const WALL_LOW = (key: string): number => ID.wallLow | (archIndex(key) << 8);
const FENCE = (key: string): number => ID.fence | (archIndex(key) << 8);
const RAIL = (key: string, rot: number): number => ID.railing | (archMeta.rotated(archIndex(key), rot) << 8);

const ASPHALT = A('concrete_dark');
const SIDEWALK = A('concrete_light');
const PAINT = A('plaster_white');
const AIR = 0;

const ROTATED = new Set(BLOCK_DEFS.map((d, i) => (d.arch?.kind === 'rotated' ? i : -1)).filter((i) => i >= 0));

/** Rotation bits after mirroring an authored block in X and / or Z. */
function mirrorPacked(v: number, mx: boolean, mz: boolean): number {
  if (v <= 0) return v;
  const id = v & 255;
  if (!ROTATED.has(id)) return v;
  let meta = v >> 8;
  let rot = meta & 3;
  if (mx && rot % 2 === 1) rot ^= 2; // east ↔ west
  if (mz && rot % 2 === 0) rot ^= 2; // north ↔ south
  meta = (meta & ~3) | rot;
  return id | (meta << 8);
}

// ---------------------------------------------------------------- blueprint

/** One box of the blueprint: `at` returns a packed block (id | meta << 8), 0 = air, -1 = leave as is. */
interface Op {
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
  at: (x: number, y: number, z: number) => number;
}

type Fill = number | ((x: number, y: number, z: number) => number);

class Builder {
  readonly ops: Op[] = [];
  mx = false;
  mz = false;

  constructor(readonly seed: number) {}

  /** Inclusive cell box, in authored (western / northern) coordinates. */
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, v: Fill): void {
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (z1 < z0) [z0, z1] = [z1, z0];
    const mx = this.mx, mz = this.mz;
    const X0 = mx ? -1 - x1 : x0, X1 = mx ? -1 - x0 : x1;
    const Z0 = mz ? -1 - z1 : z0, Z1 = mz ? -1 - z0 : z1;
    const f = typeof v === 'number' ? null : v;
    const constant = typeof v === 'number' ? mirrorPacked(v, mx, mz) : 0;
    this.ops.push({
      x0: X0, y0, z0: Z0, x1: X1, y1, z1: Z1,
      at: f ? (x, y, z) => mirrorPacked(f(mx ? -1 - x : x, y, mz ? -1 - z : z), mx, mz) : () => constant,
    });
  }

  /** Ground layer (block y = CITY_G). */
  ground(x0: number, z0: number, x1: number, z1: number, v: Fill): void {
    this.fill(x0, CITY_G, z0, x1, CITY_G, z1, v);
  }

  /** Empty a box (doors, windows). */
  clear(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.fill(x0, y0, z0, x1, y1, z1, AIR);
  }

  /** Paved lot with a sidewalk border. */
  lot(x0: number, z0: number, x1: number, z1: number, inner: number, border = SIDEWALK): void {
    this.ground(x0, z0, x1, z1, border);
    this.ground(x0 + 1, z0 + 1, x1 - 1, z1 - 1, inner);
  }

  /**
   * A building shell: walls with window bands every storey, floors, flat roof.
   * `h` = wall height in blocks above the street.
   */
  building(x0: number, z0: number, x1: number, z1: number, h: number, wall: number, opts: { trim?: number; glass?: number; storey?: number; interior?: boolean; roof?: number; windows?: boolean } = {}): void {
    const G = CITY_G;
    const storey = opts.storey ?? 4;
    const trim = opts.trim ?? wall;
    const glass = opts.glass ?? GLASS(2);
    const roof = opts.roof ?? A('concrete_gray');
    const windows = opts.windows ?? true;
    this.fill(x0, G + 1, z0, x1, G + h, z1, (x, y, z) => {
      const edgeX = x === x0 || x === x1, edgeZ = z === z0 || z === z1;
      const level = y - G;
      if (level === h) return roof;
      if (!edgeX && !edgeZ) {
        if (opts.interior) return level % storey === 0 ? A('floor_oak') : AIR;
        return AIR;
      }
      if (edgeX && edgeZ) return trim; // corners
      if (level % storey === 0) return trim; // floor bands
      const u = edgeX ? z - z0 : x - x0;
      const k = level % storey;
      if (windows && (k === 2 || k === 3) && u % 3 !== 0) return glass;
      return wall;
    });
  }

  /** Low parapet around a roof at top height `h`, with optional gaps. */
  parapet(x0: number, z0: number, x1: number, z1: number, h: number, mat: number, gap?: (x: number, z: number) => boolean): void {
    const y = CITY_G + h + 1;
    this.fill(x0, y, z0, x1, y, z1, (x, _y, z) => {
      if (x !== x0 && x !== x1 && z !== z0 && z !== z1) return -1;
      return gap?.(x, z) ? -1 : mat;
    });
  }

  /** A run of stairs climbing `n` blocks from (x, z), 2 wide along the perpendicular axis, solid beneath. */
  stairs(x: number, z: number, n: number, dir: 'north' | 'south' | 'east' | 'west', key: string, width = 2): void {
    const G = CITY_G;
    const rot = { south: 0, west: 1, north: 2, east: 3 }[dir];
    const dx = dir === 'east' ? 1 : dir === 'west' ? -1 : 0;
    const dz = dir === 'south' ? 1 : dir === 'north' ? -1 : 0;
    for (let k = 1; k <= n; k++) {
      const cx = x + dx * (k - 1), cz = z + dz * (k - 1);
      const wx = dz !== 0 ? width - 1 : 0, wz = dx !== 0 ? width - 1 : 0;
      if (k > 1) this.fill(cx, G + 1, cz, cx + wx, G + k - 1, cz + wz, A('concrete_gray'));
      this.fill(cx, G + k, cz, cx + wx, G + k, cz + wz, STAIRS(key, rot));
    }
  }

  car(x: number, z: number, alongX: boolean, color: string): void {
    const G = CITY_G;
    const body = A(color);
    const [lx, lz] = alongX ? [4, 2] : [2, 4];
    this.fill(x, G + 1, z, x + lx - 1, G + 1, z + lz - 1, body);
    // cabin: glass with the colour on the front / back
    const cx0 = alongX ? x + 1 : x, cz0 = alongX ? z : z + 1;
    const cx1 = alongX ? x + 2 : x + 1, cz1 = alongX ? z + 1 : z + 2;
    this.fill(cx0, G + 2, cz0, cx1, G + 2, cz1, GLASS(2));
    this.fill(cx0, G + 3, cz0, cx1, G + 3, cz1, SLAB(color));
  }

  van(x: number, z: number, alongX: boolean, color: string): void {
    const G = CITY_G;
    const [lx, lz] = alongX ? [5, 2] : [2, 5];
    this.fill(x, G + 1, z, x + lx - 1, G + 2, z + lz - 1, A(color));
    // windscreen at the front end
    if (alongX) this.fill(x + lx - 1, G + 2, z, x + lx - 1, G + 2, z + 1, GLASS(2));
    else this.fill(x, G + 2, z + lz - 1, x + 1, G + 2, z + lz - 1, GLASS(2));
  }

  container(x: number, z: number, alongX: boolean, color: string, y = CITY_G + 1, h = 3): void {
    const [lx, lz] = alongX ? [6, 3] : [3, 6];
    this.fill(x, y, z, x + lx - 1, y + h - 1, z + lz - 1, (xx, yy, zz) => {
      // ribbed doors at one end
      const end = alongX ? xx === x + lx - 1 : zz === z + lz - 1;
      return end && yy < y + h - 1 ? A('metal_dark') : A(color);
    });
  }

  lamp(x: number, z: number): void {
    const G = CITY_G;
    this.fill(x, G + 1, z, x, G + 4, z, COLUMN('metal_black'));
    this.fill(x, G + 5, z, x, G + 5, z, ID.lantern);
  }

  tree(x: number, z: number): void {
    const G = CITY_G;
    this.fill(x, G + 1, z, x, G + 3, z, B.LOG);
    this.fill(x - 1, G + 4, z - 1, x + 1, G + 5, z + 1, B.LEAVES);
    this.fill(x, G + 6, z, x, G + 6, z, B.LEAVES);
  }

  barrier(x0: number, z0: number, x1: number, z1: number): void {
    this.fill(x0, CITY_G + 1, z0, x1, CITY_G + 1, z1, WALL_LOW('concrete_light'));
  }

  crates(x0: number, z0: number, x1: number, z1: number, h: number, y = CITY_G + 1): void {
    this.fill(x0, y, z0, x1, y + h - 1, z1, (x, yy, z) => ((x + yy + z) & 1 ? A('wood_cladding') : A('planks')));
  }

  /** Dashed road marking along X or Z. */
  dashes(x0: number, z0: number, x1: number, z1: number): void {
    const alongX = x1 - x0 >= z1 - z0;
    this.ground(x0, z0, x1, z1, (x, _y, z) => ((alongX ? x : z) & 3) < 2 ? PAINT : -1);
  }

  /** Zebra crossing (stripes across the walking direction). */
  crossing(x0: number, z0: number, x1: number, z1: number, stripesAlongX: boolean): void {
    this.ground(x0, z0, x1, z1, (x, _y, z) => (((stripesAlongX ? z : x) & 1) === 0 ? PAINT : -1));
  }

  pick<T>(list: T[], salt: number): T {
    return list[Math.floor(hash2(salt, 7, this.seed) * list.length) % list.length];
  }
}

// ---------------------------------------------------------------- the city

const WARM = ['brick_red', 'paint_terracotta', 'plaster_beige', 'barn_red', 'sandstone'];
const COOL = ['brick_gray', 'paint_navy', 'paint_blue', 'paint_sage', 'metal_silver'];
const CAR_COLORS = ['paint_terracotta', 'paint_navy', 'paint_blue', 'paint_olive', 'plaster_cream', 'paint_charcoal', 'barn_red', 'paint_sage'];

/** Everything on one half of the city (authored for the west / Red side, mirrored for Blue). */
function buildSide(b: Builder, red: boolean): void {
  const G = CITY_G;
  const palette = red ? WARM : COOL;
  const accent = red ? 'paint_terracotta' : 'paint_navy';
  const salt = red ? 11 : 97;

  // ---- A / B: team spawn compound (x -76..-61, z -16..15)
  b.lot(-76, -16, -61, 15, A('pavers'), A(accent));
  for (const z of [-12, -5, 4, 11]) b.ground(-73, z - 1, -72, z, A(accent)); // spawn pads
  // side walls (4 high) and the front wall with three exits
  b.fill(-76, G + 1, -17, -61, G + 4, -17, A('concrete_gray'));
  b.fill(-76, G + 1, 16, -61, G + 4, 16, A('concrete_gray'));
  for (const [z0, z1] of [[-16, -14], [-9, -3], [2, 8], [13, 15]]) b.fill(-60, G + 1, z0, -60, G + 3, z1, A('concrete_gray'));
  b.fill(-60, G + 4, -16, -60, G + 4, 15, A(accent)); // painted cap (gaps stay open below)
  b.clear(-60, G + 4, -13, -60, G + 4, -10);
  b.clear(-60, G + 4, -2, -60, G + 4, 1);
  b.clear(-60, G + 4, 9, -60, G + 4, 12);
  // canopy over the back of the compound
  for (const z of [-15, -8, -1, 6, 13]) b.fill(-68, G + 1, z, -68, G + 4, z, COLUMN('metal_black'));
  b.fill(-76, G + 5, -17, -67, G + 5, 16, SLAB(accent));
  b.crates(-64, -15, -63, -14, 1);
  b.crates(-64, 13, -63, 14, 1);
  b.barrier(-63, -6, -63, -4);
  b.barrier(-63, 3, -63, 5);
  b.lamp(-62, -16);
  b.lamp(-62, 15);
  // billboard shielding the middle exit from long sightlines
  b.fill(-56, G + 1, -4, -56, G + 2, 3, A('concrete_gray'));
  b.fill(-56, G + 3, -4, -56, G + 5, 3, (_x, y, z) => (y === G + 5 || z === -4 || z === 3 ? A('metal_black') : A(red ? 'paint_blush' : 'paint_blue')));

  // ---- avenue (x -60..-51): markings, lamps, parked cars
  b.dashes(-56, -76, -55, 75);
  b.crossing(-60, -21, -51, -19, true);
  b.crossing(-60, 18, -51, 20, true);
  for (const z of [-66, -36, 26, 56]) b.lamp(-51, z);
  b.car(-53, -66, false, b.pick(CAR_COLORS, salt + 1));
  b.car(-53, 44, false, b.pick(CAR_COLORS, salt + 2));
  b.van(-59, -48, false, red ? 'plaster_cream' : 'metal_silver');
  b.van(-59, 30, false, red ? 'plaster_beige' : 'paint_sage');
  b.barrier(-58, -30, -54, -30);
  b.barrier(-57, 34, -53, 34);

  // ---- NW block (x -50..-27, z -70..-44)
  b.lot(-50, -70, -27, -44, SIDEWALK);
  // Apartment (F): 9 high, roof reachable by an outside staircase
  const aptWall = A(palette[0]);
  b.building(-48, -68, -37, -55, 9, aptWall, { trim: A('stone_cut'), storey: 3, roof: A('concrete_gray') });
  b.parapet(-48, -68, -37, -55, 9, WALL_LOW('stone_cut'), (x, z) => x === -37 && z >= -64 && z <= -62);
  b.stairs(-36, -55, 9, 'north', 'concrete_gray');
  // railing on the open side of the staircase: one block above each step
  b.fill(-34, G + 2, -63, -34, G + 10, -55, (_x, y, z) => (y === G - 53 - z ? RAIL('metal_black', 3) : -1));
  // rooftop cover: AC units and a water tank
  b.fill(-46, G + 10, -66, -45, G + 11, -65, A('metal_silver'));
  b.fill(-41, G + 10, -60, -40, G + 11, -59, A('metal_silver'));
  b.fill(-46, G + 10, -59, -44, G + 10, -57, A('metal_dark'));
  // corner store (enterable, glass front)
  const store = A(palette[1]);
  b.building(-48, -52, -40, -45, 5, store, { trim: A('metal_black'), glass: GLASS(0), storey: 5, interior: true });
  b.fill(-47, G + 1, -45, -41, G + 3, -45, GLASS(0)); // shop window
  b.clear(-45, G + 1, -45, -44, G + 3, -45); // front door
  b.clear(-40, G + 1, -50, -40, G + 3, -49); // side door
  b.fill(-47, G + 1, -51, -47, G + 2, -47, A('wood_cladding_dark')); // shelf
  b.fill(-43, G + 1, -50, -42, G + 1, -48, A('marble')); // counter
  b.fill(-48, G + 6, -52, -40, G + 6, -52, SLAB(accent)); // awning-ish cap
  // parking strip
  b.ground(-33, -69, -28, -45, A('concrete_gray'));
  for (let z = -68; z <= -46; z += 4) b.ground(-32, z, -29, z, PAINT);
  b.car(-32, -67, true, b.pick(CAR_COLORS, salt + 3));
  b.car(-32, -59, true, b.pick(CAR_COLORS, salt + 4));
  b.car(-32, -51, true, b.pick(CAR_COLORS, salt + 5));
  b.lamp(-28, -57);

  // ---- north approach, west (z -35..-21): gas station
  b.lot(-50, -35, -27, -21, A('concrete_gray'));
  for (const [x, z] of [[-46, -32], [-36, -32], [-46, -24], [-36, -24]]) b.fill(x, G + 1, z, x, G + 4, z, COLUMN('metal_silver'));
  b.fill(-47, G + 5, -33, -35, G + 5, -23, SLAB(red ? 'paint_terracotta' : 'paint_blue'));
  b.fill(-43, G + 1, -29, -43, G + 2, -28, A('metal_silver')); // pumps
  b.fill(-39, G + 1, -29, -39, G + 2, -28, A('metal_silver'));
  b.van(-33, -33, false, b.pick(CAR_COLORS, salt + 6));
  b.barrier(-49, -26, -49, -22);

  // ---- middle row (z -20..19): cafe & bank with the connector street between them
  const cafe = A(palette[2]);
  b.lot(-50, -20, -27, -8, SIDEWALK);
  b.building(-47, -18, -36, -9, 5, cafe, { trim: A('wood_cladding_dark'), glass: GLASS(0), storey: 5, interior: true });
  b.fill(-46, G + 1, -9, -37, G + 3, -9, GLASS(0));
  b.clear(-42, G + 1, -9, -41, G + 3, -9); // street door
  b.clear(-47, G + 1, -14, -47, G + 3, -13); // avenue door
  b.clear(-36, G + 1, -14, -36, G + 3, -13); // plaza-side door
  b.fill(-45, G + 1, -16, -43, G + 1, -15, A('floor_walnut')); // tables
  b.fill(-40, G + 1, -16, -38, G + 1, -15, A('floor_walnut'));
  b.fill(-47, G + 6, -9, -36, G + 6, -9, SLAB(accent));
  const bank = A(palette[3]);
  b.lot(-50, 7, -27, 19, SIDEWALK);
  b.building(-47, 8, -36, 17, 5, bank, { trim: A('stone_cut'), glass: GLASS(3), storey: 5, interior: true });
  b.clear(-42, G + 1, 8, -41, G + 3, 8);
  b.clear(-47, G + 1, 12, -47, G + 3, 13);
  b.clear(-36, G + 1, 12, -36, G + 3, 13);
  b.fill(-45, G + 1, 14, -38, G + 1, 14, A('marble')); // bank counter
  for (const x of [-46, -37]) b.fill(x, G + 1, 7, x, G + 5, 7, COLUMN('stone_cut'));
  // small park between the shops and the street, connector street with a parked van
  b.ground(-34, -19, -28, -10, B.GRASS);
  b.ground(-34, 9, -28, 18, B.GRASS);
  b.tree(-31, -15);
  b.tree(-31, 14);
  b.fill(-33, G + 1, -11, -29, G + 1, -11, B.HEDGE);
  b.fill(-33, G + 1, 10, -29, G + 1, 10, B.HEDGE);
  b.dashes(-50, -1, -27, 0);
  b.van(-42, -5, true, red ? 'paint_charcoal' : 'plaster_cream');
  b.barrier(-32, 3, -30, 3);
  b.lamp(-49, -7);
  b.lamp(-49, 6);

  // ---- south approach, west (z 20..34): bus depot
  b.lot(-50, 20, -27, 34, A('concrete_gray'));
  b.fill(-47, G + 1, 24, -38, G + 3, 26, (x, y, z) => (y === G + 2 && (x - -47) % 2 === 1 && z !== 25 ? GLASS(2) : A(red ? 'paint_terracotta' : 'paint_blue')));
  b.fill(-35, G + 1, 30, -33, G + 4, 30, COLUMN('metal_black'));
  b.fill(-36, G + 5, 28, -30, G + 5, 31, SLAB('roof_metal'));
  b.crates(-31, 22, -30, 23, 2);
  b.barrier(-49, 31, -45, 31);

  // ---- SW block (z 43..69): shop strip and container yard
  b.lot(-50, 43, -27, 69, SIDEWALK);
  const shops: [number, number, string, number][] = [[-49, -43, palette[4], 0], [-41, -35, palette[1], 3], [-33, -27, palette[0], 4]];
  for (const [x0, x1, c, g] of shops) {
    b.building(x0, 45, x1, 52, 5, A(c), { trim: A('metal_black'), glass: GLASS(g), storey: 5, interior: true });
    b.fill(x0 + 1, G + 1, 45, x1 - 1, G + 3, 45, GLASS(0));
    const mid = Math.floor((x0 + x1) / 2);
    b.clear(mid, G + 1, 45, mid + 1, G + 3, 45);
    b.clear(mid, G + 1, 52, mid + 1, G + 3, 52);
    b.fill(x0, G + 4, 44, x1, G + 4, 44, SLAB(accent, true)); // awning
    b.fill(x0 + 1, G + 1, 50, x0 + 2, G + 2, 50, A('wood_cladding_dark')); // shelves
  }
  b.ground(-50, 54, -27, 69, A('gravel'));
  b.container(-49, 56, true, red ? 'paint_terracotta' : 'paint_navy');
  b.container(-49, 56, true, red ? 'barn_red' : 'paint_blue', G + 4);
  b.container(-40, 60, true, red ? 'paint_olive' : 'paint_sage');
  b.crates(-34, 61, -34, 61, 2); // steps up onto the container
  b.crates(-33, 61, -33, 61, 1);
  b.container(-31, 63, false, red ? 'plaster_cream' : 'metal_silver');
  b.crates(-45, 65, -44, 66, 1);
  b.fill(-50, G + 1, 69, -27, G + 2, 69, FENCE('metal_black'));
  b.clear(-40, G + 1, 69, -38, G + 2, 69);
}

/** The neutral middle column (x -18..17): warehouse, plaza, residential streets. */
function buildCenter(b: Builder): void {
  const G = CITY_G;
  // ---- D: warehouse (x -18..17, z -70..-48)
  b.lot(-18, -70, 17, -44, A('concrete_gray'));
  b.fill(-18, G + 1, -70, 17, G + 7, -48, (x, y, z) => {
    const edge = x === -18 || x === 17 || z === -70 || z === -48;
    if (!edge) return AIR;
    if (y === G + 7 || x === -18 && (z === -70 || z === -48) || x === 17 && (z === -70 || z === -48)) return A('metal_dark');
    return y === G + 5 && (x + z) % 4 === 0 ? GLASS(1) : A('metal_silver');
  });
  // roof with skylight gaps (light in, nobody up there)
  b.fill(-18, G + 8, -70, 17, G + 8, -48, (_x, _y, z) => ((z + 70) % 6 === 3 ? -1 : A('roof_metal')));
  b.ground(-17, -69, 16, -49, A('concrete_light'));
  // doors
  b.clear(-14, G + 1, -48, -11, G + 4, -48);
  b.clear(10, G + 1, -48, 13, G + 4, -48);
  b.clear(-2, G + 1, -70, 1, G + 4, -70);
  b.clear(-18, G + 1, -59, -18, G + 4, -56);
  b.clear(17, G + 1, -59, 17, G + 4, -56);
  // shelving rows, crate stacks
  b.fill(-12, G + 1, -62, -9, G + 3, -61, A('wood_cladding'));
  b.fill(8, G + 1, -62, 11, G + 3, -61, A('wood_cladding'));
  b.fill(-12, G + 1, -55, -9, G + 3, -54, A('wood_cladding'));
  b.fill(8, G + 1, -55, 11, G + 3, -54, A('wood_cladding'));
  b.crates(-4, -58, -3, -57, 2);
  b.crates(2, -58, 3, -57, 2);
  b.crates(-1, -53, 0, -52, 1);
  // mezzanine along the north wall with two staircases
  b.fill(-17, G + 4, -69, 16, G + 4, -64, A('metal_dark'));
  b.fill(-17, G + 5, -64, 16, G + 5, -64, (x) => (x >= -14 && x <= -13) || (x >= 12 && x <= 13) ? -1 : RAIL('metal_black', 0));
  b.stairs(-14, -60, 4, 'north', 'concrete_gray');
  b.stairs(12, -60, 4, 'north', 'concrete_gray');
  b.crates(-8, -68, -7, -67, 1, G + 5);
  b.crates(6, -68, 7, -67, 1, G + 5);
  b.fill(-17, G + 5, -69, -17, G + 5, -69, ID.lantern);
  b.fill(16, G + 5, -69, 16, G + 5, -69, ID.lantern);
  b.fill(-4, G + 3, -58, -4, G + 3, -58, ID.lantern);
  b.fill(3, G + 3, -58, 3, G + 3, -58, ID.lantern);
  // loading bay
  b.container(-9, -46, true, 'paint_olive');
  b.container(3, -46, true, 'paint_charcoal');
  // back alley dumpsters
  b.fill(-12, G + 1, -75, -10, G + 2, -74, A('paint_sage'));
  b.fill(9, G + 1, -75, 11, G + 2, -74, A('paint_sage'));

  // ---- north & south approaches: health stations, cover
  for (const [z0, z1] of [[-35, -21], [20, 34]]) {
    b.lot(-18, z0, 17, z1, A('pavers'));
    b.fill(-9, G + 1, z0 + 5, -7, G + 1, z0 + 5, WALL_LOW('concrete_light'));
    b.fill(6, G + 1, z0 + 5, 8, G + 1, z0 + 5, WALL_LOW('concrete_light'));
    b.fill(-14, G + 1, z0 + 9, -13, G + 2, z0 + 10, B.HEDGE);
    b.fill(12, G + 1, z0 + 9, 13, G + 2, z0 + 10, B.HEDGE);
    b.lamp(-17, z0 + 7);
    b.lamp(16, z0 + 7);
  }
  for (const zc of [-28, 28]) {
    b.ground(-2, zc - 2, 1, zc + 1, A('tile_white'));
    b.ground(-1, zc - 2, 0, zc + 1, A('paint_sage'));
    b.ground(-2, zc - 1, 1, zc, A('paint_sage'));
    b.fill(-3, G + 1, zc - 3, -3, G + 3, zc - 3, COLUMN('plaster_white'));
    b.fill(2, G + 1, zc + 2, 2, G + 3, zc + 2, COLUMN('plaster_white'));
    b.fill(-3, G + 4, zc - 3, -3, G + 4, zc - 3, ID.lantern);
    b.fill(2, G + 4, zc + 2, 2, G + 4, zc + 2, ID.lantern);
  }

  // ---- C: central plaza (x, z -17..16)
  b.lot(-17, -17, 16, 16, A('pavers'));
  b.ground(-12, -12, 11, 11, (x, _y, z) => ((Math.max(Math.abs(x + 0.5), Math.abs(z + 0.5)) | 0) % 4 === 1 ? A('pavers_dark') : -1));
  // fountain + statue (blocks the long east-west line through the middle)
  b.fill(-5, G + 1, -5, 4, G + 1, 4, (x, _y, z) => (x === -5 || x === 4 || z === -5 || z === 4 ? WALL_LOW('stone_cut') : B.WATER));
  b.fill(-4, G, -4, 3, G, 3, A('pool_tile'));
  b.fill(-1, G + 1, -1, 0, G + 2, 0, A('stone_cut'));
  b.fill(-1, G + 3, -1, 0, G + 6, 0, A('sandstone'));
  b.fill(-1, G + 7, -1, 0, G + 7, 0, SLAB('sandstone'));
  // L-shaped planters at the corners
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const cx = sx < 0 ? -12 : 11, cz = sz < 0 ? -12 : 11;
    const ex = sx < 0 ? -9 : 8, ez = sz < 0 ? -9 : 8;
    b.fill(Math.min(cx, ex), G + 1, cz, Math.max(cx, ex), G + 2, cz, B.HEDGE);
    b.fill(cx, G + 1, Math.min(cz, ez), cx, G + 2, Math.max(cz, ez), B.HEDGE);
    b.tree(sx < 0 ? -14 : 13, sz < 0 ? -14 : 13);
  }
  // low cover walls east & west of the fountain, benches north & south
  b.fill(-10, G + 1, -3, -10, G + 1, 2, WALL_LOW('stone_cut'));
  b.fill(9, G + 1, -3, 9, G + 1, 2, WALL_LOW('stone_cut'));
  b.fill(-3, G + 1, -11, 2, G + 1, -11, SLAB('decking'));
  b.fill(-3, G + 1, 10, 2, G + 1, 10, SLAB('decking'));
  // kiosks (west & east edges)
  for (const x0 of [-16, 14]) {
    b.fill(x0, G + 1, -2, x0 + 1, G + 2, 1, (_x, y, z) => (y === G + 2 && (z === -1 || z === 0) ? GLASS(0) : A(x0 < 0 ? 'paint_terracotta' : 'paint_navy')));
    b.fill(x0, G + 3, -3, x0 + 1, G + 3, 2, SLAB('roof_metal'));
  }
  for (const [x, z] of [[-17, -17], [16, -17], [-17, 16], [16, 16]]) b.lamp(x, z);

  // ---- E: residential streets (z 43..69)
  b.lot(-18, 43, 17, 69, A('pavers'));
  b.ground(-17, 63, 16, 68, B.GRASS);
  const houseColors = ['plaster_cream', 'paint_sage', 'paint_blush', 'paint_blue', 'plaster_white', 'paint_terracotta', 'brick_white', 'wood_cladding'];
  const xs: [number, number][] = [[-17, -12], [-9, -4], [3, 8], [11, 16]];
  let n = 0;
  for (const [z0, z1] of [[45, 51], [56, 62]]) {
    for (const [x0, x1] of xs) {
      const c = houseColors[(n + Math.floor(hash2(n, 3, b.seed) * 3)) % houseColors.length];
      n++;
      b.building(x0, z0, x1, z1, 4, A(c), { trim: A('wood_white'), glass: GLASS(0), storey: 4, interior: true, roof: A('shingles_dark') });
      b.fill(x0, G + 5, z0, x1, G + 5, z1, SLAB('roof_terracotta'));
      const mid = x0 + 2;
      b.clear(mid, G + 1, z0, mid + 1, G + 2, z0); // front door
      b.clear(mid, G + 1, z1, mid + 1, G + 2, z1); // back door
      b.fill(x0 + 1, G + 1, z0 + 3, x0 + 1, G + 1, z0 + 4, A('floor_walnut'));
    }
  }
  b.fill(-3, G + 1, 52, -3, G + 1, 55, ID.hedgeLow);
  b.fill(2, G + 1, 52, 2, G + 1, 55, ID.hedgeLow);
  b.tree(-14, 66);
  b.tree(13, 66);
  b.fill(-9, G + 1, 64, -9, G + 2, 68, FENCE('wood_white'));
  b.fill(8, G + 1, 64, 8, G + 2, 68, FENCE('wood_white'));
  b.fill(-18, G + 1, 69, 17, G + 2, 69, FENCE('wood_white'));
  b.clear(-2, G + 1, 69, 1, G + 2, 69);
  b.lamp(-1, 44);
  b.lamp(0, 63);
}

/** The ring of tall buildings that closes the arena, plus the skyline beyond it. */
function buildBoundary(b: Builder): void {
  const G = CITY_G;
  const tones = ['brick_gray', 'concrete_gray', 'stone_dark', 'brick_red', 'paint_charcoal', 'plaster_beige', 'brick_white', 'paint_navy'];
  // inner ring: 4 deep, 16+ high, window grids facing the arena
  const seg = 12;
  for (let i = -80; i < 80; i += seg) {
    for (const side of ['n', 's', 'w', 'e'] as const) {
      const tone = tones[Math.floor(hash2(i, side.charCodeAt(0), b.seed) * tones.length)];
      const h = 16 + Math.floor(hash2(i, side.charCodeAt(0) + 3, b.seed) * 8);
      const a = i, c = Math.min(79, i + seg - 1);
      if (side === 'n') b.building(a, -80, c, -77, h, A(tone), { trim: A('stone_dark'), storey: 4 });
      if (side === 's') b.building(a, 76, c, 79, h, A(tone), { trim: A('stone_dark'), storey: 4 });
      if (side === 'w') b.building(-80, a, -77, c, h, A(tone), { trim: A('stone_dark'), storey: 4 });
      if (side === 'e') b.building(76, a, 79, c, h, A(tone), { trim: A('stone_dark'), storey: 4 });
    }
  }
  // road blocks where the avenues meet the boundary (looks deliberate, adds cover)
  for (const x of [-60, 50]) {
    for (const z of [-76, 74]) {
      b.fill(x, G + 1, z, x + 9, G + 1, z + 1, (xx) => ((xx & 1) === 0 ? A('paint_terracotta') : A('plaster_white')));
    }
  }
  // skyline beyond the ring (never reachable)
  for (let bx = -SKYLINE; bx < SKYLINE; bx += 16) {
    for (let bz = -SKYLINE; bz < SKYLINE; bz += 16) {
      if (bx + 16 > -WALL_OUT && bx < WALL_OUT && bz + 16 > -WALL_OUT && bz < WALL_OUT) continue;
      const r = hash2(bx, bz, b.seed ^ 0x5151);
      const h = 10 + Math.floor(r * 26);
      const tone = tones[Math.floor(hash2(bz, bx, b.seed) * tones.length)];
      b.building(bx + 3, bz + 3, bx + 12, bz + 12, h, A(tone), { trim: A('stone_dark'), storey: 4 });
    }
  }
}

/** Street furniture shared by the whole city. */
function buildStreets(b: Builder): void {
  // dashed centre lines on the long streets
  b.dashes(-50, -40, 49, -39);
  b.dashes(-50, 38, 49, 39);
  b.dashes(-23, -70, -22, 69);
  b.dashes(21, -70, 22, 69);
  // crossings onto the plaza
  b.crossing(-26, -6, -19, 5, false);
  b.crossing(18, -6, 25, 5, false);
  b.lamp(-27, -44);
  b.lamp(26, -44);
  b.lamp(-27, 43);
  b.lamp(26, 43);
  // parked cars on the side streets
  b.car(-21, -30, false, 'paint_olive');
  b.car(18, 27, false, 'paint_terracotta');
  b.car(-20, 47, false, 'plaster_cream');
  b.car(18, -52, false, 'paint_navy');
  b.barrier(-24, -62, -24, -60);
  b.barrier(23, 59, 23, 61);
}

// ---------------------------------------------------------------- points of interest

/** Red spawn points (Blue = mirrored in X). Feet positions. */
const RED_SPAWNS: [number, number][] = [[-72, -11], [-72, -4], [-72, 4], [-72, 11], [-65, -8], [-65, 8], [-69, 0], [-64, 0]];

const LOOT_SIDE: [string, number, number, number, LootTier][] = [
  // id, x, y offset above street, z, tier — authored for the west side, mirrored for the east
  ['avenue-n', -55.5, 0, -12.5, 'common'],
  ['avenue-s', -55.5, 0, 12.5, 'common'],
  ['apt-roof', -42.5, 9, -60.5, 'uncommon'],
  ['store', -44.5, 0, -48.5, 'common'],
  ['parking', -29.5, 0, -55.5, 'common'],
  ['cafe', -41.5, 0, -12.5, 'uncommon'],
  ['bank', -41.5, 0, 11.5, 'uncommon'],
  ['gas', -41.5, 0, -27.5, 'common'],
  ['depot', -41.5, 0, 29.5, 'common'],
  ['shop', -37.5, 0, 48.5, 'common'],
  ['container-top', -37.5, 3, 61.5, 'uncommon'],
];

const LOOT_CENTER: [string, number, number, number, LootTier][] = [
  ['plaza-n', 0, 0, -8, 'rare'],
  ['plaza-s', 0, 0, 8, 'rare'],
  ['mezzanine', 0, 4, -66.5, 'rare'],
  ['warehouse', 0, 0, -60.5, 'uncommon'],
  ['lane', 0, 0, 53.5, 'uncommon'],
  ['yard', 0, 0, 65.5, 'common'],
];

export const HEALTH_STATIONS: (MapPoint & { id: string })[] = [
  { id: 'hs-n', x: 0, y: CITY_G + 1, z: -28 },
  { id: 'hs-s', x: 0, y: CITY_G + 1, z: 28 },
];

export function spawnPoints(team: Team): SpawnPoint[] {
  const s = team === 'red' ? 1 : -1;
  return RED_SPAWNS.map(([x, z]) => ({ x: x * s, y: CITY_G + 1, z, yaw: team === 'red' ? -Math.PI / 2 : Math.PI / 2 }));
}

export const LOOT_POINTS: LootPoint[] = [
  ...LOOT_SIDE.flatMap(([id, x, dy, z, tier]) => [
    { id: `w-${id}`, x, y: CITY_G + 1 + dy, z, tier },
    { id: `e-${id}`, x: -x, y: CITY_G + 1 + dy, z, tier },
  ]),
  ...LOOT_CENTER.map(([id, x, dy, z, tier]) => ({ id: `c-${id}`, x, y: CITY_G + 1 + dy, z, tier })),
];

// ---------------------------------------------------------------- blueprint queries & chunk generation

const GRID = 16;

/**
 * The finished blueprint: ordered ops with a coarse spatial index. `blockAt`
 * answers "what block is here" without any chunk being loaded (host bullet
 * occlusion, spawn checks); `generateChunk` voxelises one chunk in a worker.
 */
export class CityBlueprint {
  readonly seed: number;
  private readonly ops: Op[];
  private readonly cells = new Map<number, number[]>();

  constructor(seed: number) {
    this.seed = seed >>> 0;
    const b = new Builder(this.seed);
    buildBoundary(b);
    buildStreets(b);
    b.mx = false;
    buildSide(b, true);
    b.mx = true;
    buildSide(b, false);
    b.mx = false;
    buildCenter(b);
    this.ops = b.ops;
    this.ops.forEach((op, i) => {
      for (let gx = Math.floor(op.x0 / GRID); gx <= Math.floor(op.x1 / GRID); gx++)
        for (let gz = Math.floor(op.z0 / GRID); gz <= Math.floor(op.z1 / GRID); gz++) {
          const k = (gx + 512) * 1024 + (gz + 512);
          let list = this.cells.get(k);
          if (!list) this.cells.set(k, (list = []));
          list.push(i);
        }
    });
  }

  get opCount(): number {
    return this.ops.length;
  }

  private base(y: number): number {
    if (y <= 0) return B.DEEPSTONE;
    if (y < CITY_G) return B.STONE;
    if (y === CITY_G) return ASPHALT;
    return AIR;
  }

  /** Packed block (id | meta << 8) at a cell. */
  packedAt(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const list = this.cells.get((Math.floor(x / GRID) + 512) * 1024 + (Math.floor(z / GRID) + 512));
    if (list) {
      for (let i = list.length - 1; i >= 0; i--) {
        const op = this.ops[list[i]];
        if (x < op.x0 || x > op.x1 || y < op.y0 || y > op.y1 || z < op.z0 || z > op.z1) continue;
        const v = op.at(x, y, z);
        if (v >= 0) return v;
      }
    }
    return this.base(y);
  }

  blockAt(x: number, y: number, z: number): number {
    return this.packedAt(x, y, z) & 255;
  }

  isSolid(x: number, y: number, z: number): boolean {
    return SOLID[this.blockAt(x, y, z)] === 1;
  }

  /** Top solid block y of a column (spawn / pickup placement). */
  surfaceY(x: number, z: number, from = CITY_G + 24): number {
    for (let y = from; y > 0; y--) if (this.isSolid(x, y, z)) return y;
    return CITY_G;
  }

  generateChunk(cx: number, cz: number): ChunkGenResult {
    const S = CHUNK_SIZE;
    const blocks = new Uint8Array(CHUNK_VOLUME);
    const meta = new Uint8Array(CHUNK_VOLUME);
    const heightmap = new Uint8Array(S * S);
    const biomes = new Uint8Array(S * S);
    const tints = new Uint8Array(S * S * 9);
    const mapColors = new Uint8Array(S * S * 3);
    const ox = cx * S, oz = cz * S;
    const bd = BIOMES[0];
    for (let lz = 0; lz < S; lz++)
      for (let lx = 0; lx < S; lx++) {
        blocks[localIndex(lx, 0, lz)] = B.DEEPSTONE;
        for (let y = 1; y < CITY_G; y++) blocks[localIndex(lx, y, lz)] = B.STONE;
        blocks[localIndex(lx, CITY_G, lz)] = ASPHALT & 255;
        meta[localIndex(lx, CITY_G, lz)] = ASPHALT >> 8;
        const t = (lz * S + lx) * 9;
        for (let k = 0; k < 3; k++) {
          tints[t + k] = Math.round(bd.grassTint[k] * 255);
          tints[t + 3 + k] = Math.round(bd.foliageTint[k] * 255);
          tints[t + 6 + k] = Math.round(bd.waterTint[k] * 255);
        }
      }
    // apply ops in authoring order (later ops overwrite earlier ones, exactly like packedAt)
    const seen = new Set<number>();
    const order: number[] = [];
    for (let gx = Math.floor(ox / GRID); gx <= Math.floor((ox + S - 1) / GRID); gx++)
      for (let gz = Math.floor(oz / GRID); gz <= Math.floor((oz + S - 1) / GRID); gz++)
        for (const i of this.cells.get((gx + 512) * 1024 + (gz + 512)) ?? []) if (!seen.has(i)) {
          seen.add(i);
          order.push(i);
        }
    order.sort((a, b) => a - b);
    for (const i of order) {
      const op = this.ops[i];
      const x0 = Math.max(op.x0, ox), x1 = Math.min(op.x1, ox + S - 1);
      const z0 = Math.max(op.z0, oz), z1 = Math.min(op.z1, oz + S - 1);
      if (x0 > x1 || z0 > z1) continue;
      const y0 = Math.max(1, op.y0), y1 = Math.min(WORLD_HEIGHT - 1, op.y1);
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++)
          for (let x = x0; x <= x1; x++) {
            const v = op.at(x, y, z);
            if (v < 0) continue;
            const idx = localIndex(x - ox, y, z - oz);
            blocks[idx] = v & 255;
            meta[idx] = v >> 8;
          }
    }
    for (let lz = 0; lz < S; lz++)
      for (let lx = 0; lx < S; lx++) {
        let top = 0, topId = 0;
        for (let y = WORLD_HEIGHT - 1; y > 0; y--) {
          const id = blocks[localIndex(lx, y, lz)];
          if (id !== 0) {
            top = y;
            topId = id;
            break;
          }
        }
        const ci = lz * S + lx;
        heightmap[ci] = top;
        const col = topId === B.ARCH_BLOCK ? [150, 150, 152] : mapColorFor(topId, top, tints, ci);
        mapColors[ci * 3] = col[0];
        mapColors[ci * 3 + 1] = col[1];
        mapColors[ci * 3 + 2] = col[2];
      }
    return { cx, cz, blocks, meta, heightmap, biomes, tints, mapColors, waterfalls: [], landmarks: [] };
  }
}

const cache = new Map<number, CityBlueprint>();

/** Shared, cached blueprint per seed (main thread, workers and tests). */
export function cityBlueprint(seed: number): CityBlueprint {
  const s = seed >>> 0;
  let c = cache.get(s);
  if (!c) {
    if (cache.size > 2) cache.clear();
    cache.set(s, (c = new CityBlueprint(s)));
  }
  return c;
}

/** Keep a position inside the arena (a safety net behind the physical boundary). */
export function clampToArena(x: number, z: number, margin = 0.35): { x: number; z: number } {
  const m = PLAY_HALF - margin;
  return { x: Math.max(-m, Math.min(m, x)), z: Math.max(-m, Math.min(m, z)) };
}

export function inArena(x: number, z: number, slack = 0): boolean {
  return Math.abs(x) <= PLAY_HALF + slack && Math.abs(z) <= PLAY_HALF + slack;
}

export { WALL_IN };
