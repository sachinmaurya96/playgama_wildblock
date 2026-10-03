import type { TileName } from './tiles';

/**
 * Box-model shapes for non-cube blocks (furniture, stations, stairs, doors...).
 * Coordinates are in 1/16 block units. Models are emitted directly into the chunk
 * mesh, so furniture costs zero extra draw calls. Each model can be swapped for a
 * GLB later by giving the block a `modelUrl` and rendering it in the prop layer.
 */

export interface FaceTiles {
  top?: TileName;
  bottom?: TileName;
  side?: TileName;
  /** +Z face in unrotated model space (the side that faces the player when placed). */
  front?: TileName;
}

export interface ModelBox {
  from: [number, number, number];
  to: [number, number, number];
  tiles: TileName | FaceTiles;
  /** Render as two crossed quads inside the box instead of a box (flames, plants). */
  cross?: boolean;
  /** Emissive (unaffected by darkness). */
  glow?: boolean;
}

const b = (
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
  tiles: TileName | FaceTiles, extra: Partial<ModelBox> = {},
): ModelBox => ({ from: [x0, y0, z0], to: [x1, y1, z1], tiles, ...extra });

const legs = (h: number, tile: TileName, inset = 1, size = 2): ModelBox[] => [
  b(inset, 0, inset, inset + size, h, inset + size, tile),
  b(16 - inset - size, 0, inset, 16 - inset, h, inset + size, tile),
  b(inset, 0, 16 - inset - size, inset + size, h, 16 - inset, tile),
  b(16 - inset - size, 0, 16 - inset - size, 16 - inset, h, 16 - inset, tile),
];

export const MODELS: Record<string, ModelBox[]> = {
  torch: [b(7, 0, 7, 9, 9, 9, 'torch'), b(6.5, 9, 6.5, 9.5, 12, 9.5, 'fire', { glow: true })],
  lantern: [b(5, 0, 5, 11, 8, 11, 'lantern', { glow: true }), b(7, 8, 7, 9, 10, 9, 'metal')],
  workbench: [b(0, 12, 0, 16, 16, 16, { top: 'bench_top', side: 'bench_side', bottom: 'planks' }), ...legs(12, 'log_side')],
  stonecutter: [b(1, 0, 1, 15, 10, 15, 'fieldstone'), b(7, 10, 2, 9, 15, 14, 'metal')],
  forge: [
    b(0, 0, 0, 16, 12, 16, { side: 'brick', top: 'soot', bottom: 'brick', front: 'oven' }),
    b(4, 12, 4, 12, 16, 12, 'brick'),
  ],
  cooking_fire: [
    b(2, 0, 6, 14, 3, 10, 'log_side'),
    b(6, 0, 2, 10, 3, 14, 'log_side'),
    b(3, 2, 3, 13, 12, 13, 'fire', { cross: true, glow: true }),
  ],
  stone_oven: [b(1, 0, 1, 15, 14, 15, { side: 'fieldstone', top: 'brick', bottom: 'fieldstone', front: 'oven' }), b(10, 14, 10, 13, 16, 13, 'brick')],
  carpentry_bench: [b(0, 10, 2, 16, 13, 14, { top: 'birch_planks', side: 'planks' }), ...legs(10, 'planks', 1, 2), b(3, 13, 6, 9, 14, 10, 'metal')],
  crystal_bench: [b(1, 0, 1, 15, 9, 15, { side: 'amber_banded', top: 'amberstone' }), b(5, 9, 5, 11, 15, 11, 'crystal', { cross: true, glow: true })],
  chest: [b(1, 0, 1, 15, 13, 15, { side: 'chest_side', top: 'chest_side', front: 'chest_front' })],
  bed: [
    b(0, 2, 0, 16, 5, 16, 'dark_wood'),
    b(1, 5, 1, 15, 8, 15, 'fabric_cream'),
    b(1, 8, 5, 15, 9, 15, 'fabric_red'),
    b(3, 8, 1, 13, 10, 4.5, 'fabric_cream'),
    ...legs(2, 'dark_wood', 0, 2),
  ],
  table: [b(0, 13, 0, 16, 16, 16, 'planks'), ...legs(13, 'planks', 1.5, 2)],
  kitchen_table: [
    b(0, 12, 0, 16, 16, 16, { top: 'bench_top', side: 'planks' }),
    ...legs(12, 'planks', 1, 2),
    b(4, 16, 4, 9, 16.01, 9, 'metal'),
  ],
  chair: [b(3, 7, 3, 13, 9, 13, 'planks'), b(3, 9, 11, 13, 16, 13, 'planks'), ...legs(7, 'planks', 3, 2)],
  shelf: [b(0, 0, 13, 16, 16, 16, 'planks'), b(0, 5, 8, 16, 6, 13, 'planks'), b(0, 11, 8, 16, 12, 13, 'planks'), b(2, 6, 9, 5, 9, 12, 'clay'), b(9, 12, 9, 13, 15, 12, 'chest_side')],
  cabinet: [b(1, 0, 2, 15, 16, 16, { side: 'dark_wood', top: 'planks', front: 'chest_front' })],
  rug: [b(0, 0, 0, 16, 0.6, 16, 'rug')],
  fireplace: [
    b(0, 0, 0, 16, 3, 16, 'brick'),
    b(0, 3, 0, 3, 13, 16, 'brick'),
    b(13, 3, 0, 16, 13, 16, 'brick'),
    b(0, 13, 0, 16, 16, 16, 'brick'),
    b(3, 3, 0, 13, 13, 3, 'soot'),
    b(4, 3, 5, 12, 10, 13, 'fire', { cross: true, glow: true }),
  ],
  flower_pot: [b(5, 0, 5, 11, 6, 11, 'clay'), b(4, 6, 4, 12, 14, 12, 'flower_sun', { cross: true })],
  ice_box: [b(2, 0, 2, 14, 15, 14, { side: 'ice', top: 'metal', front: 'metal' })],
  water_barrel: [b(2, 0, 2, 14, 14, 14, { side: 'barrel', top: 'water', bottom: 'barrel' })],
  wind_lamp: [b(7, 0, 7, 9, 10, 9, 'dark_wood'), b(5, 10, 5, 11, 16, 11, 'lantern', { glow: true })],
  grinder: [b(2, 0, 2, 14, 6, 14, 'fieldstone'), b(4, 6, 4, 12, 10, 12, 'stone'), b(7.5, 10, 7.5, 8.5, 15, 8.5, 'dark_wood')],
  crystal_lantern: [b(5, 0, 5, 11, 2, 11, 'metal'), b(5.5, 2, 5.5, 10.5, 11, 10.5, 'crystal', { glow: true })],
  lore_stone: [b(3, 0, 5, 13, 15, 11, 'lore_stone'), b(2, 0, 4, 14, 2, 12, 'mossy_fieldstone')],
  shell: [b(5, 0, 5, 11, 2, 10, 'shell')],
  slab: [b(0, 0, 0, 16, 8, 16, 'planks')],
  stairs: [b(0, 0, 0, 16, 8, 16, 'planks'), b(0, 8, 8, 16, 16, 16, 'planks')],
  pane: [b(0, 0, 7, 16, 16, 9, 'window')],
  door_closed: [b(0, 0, 13, 16, 16, 16, 'door')],
  door_open: [b(0, 0, 0, 3, 16, 16, 'door')],
  door_closed_upper: [b(0, 0, 13, 16, 16, 16, 'door')],
  door_open_upper: [b(0, 0, 0, 3, 16, 16, 'door')],
  fence_post: [b(6, 0, 6, 10, 16, 10, 'planks')],
  hedge_low: [b(1, 0, 1, 15, 10, 15, 'hedge')],
  gate_closed: [b(0, 0, 7, 16, 16, 9, 'gate')],
  gate_open: [b(0, 0, 0, 2, 16, 16, 'gate')],
  fence_arm_n: [b(7, 6, 0, 9, 9, 6, 'planks'), b(7, 11, 0, 9, 14, 6, 'planks')],
};

/** Axis-aligned collision boxes (in block units, 0..1) for a model shape. */
export type AABB = [number, number, number, number, number, number];

/** Rotate a 1/16-unit box around the block's vertical center by 90° steps. */
export function rotateBox(from: number[], to: number[], rot: number): [number[], number[]] {
  let x0 = from[0], z0 = from[2], x1 = to[0], z1 = to[2];
  for (let r = 0; r < (rot & 3); r++) {
    // (x, z) → (16 - z, x)
    const nx0 = 16 - z1, nx1 = 16 - z0, nz0 = x0, nz1 = x1;
    x0 = nx0; x1 = nx1; z0 = nz0; z1 = nz1;
  }
  return [[x0, from[1], z0], [x1, to[1], z1]];
}
