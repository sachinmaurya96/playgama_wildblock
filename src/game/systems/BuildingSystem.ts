import { BLOCK_DEFS } from '../../data/blocks';
import { B, blockId, isReplaceable, OPAQUE, SOLID, SHAPE } from '../world/BlockRegistry';
import type { World } from '../world/World';

/**
 * Placement rules: orientation toward the player, two-block doors, support for
 * plants/torches, no placing inside the player, and door toggling.
 */
export interface PlaceRequest {
  x: number;
  y: number;
  z: number;
  block: string;
  /** Player yaw (radians) for orientation. */
  yaw: number;
  /** Face that was clicked (for torches etc.). */
  ny: number;
  /** Base meta from the item (architecture material). */
  meta?: number;
}

/** Orientation bits for an architecture block placed while looking along `yaw`. */
export function archPlacementMeta(block: string, baseMeta: number, yaw: number): number {
  const def = BLOCK_DEFS[blockId(block)];
  const arch = def.arch;
  if (!arch || arch.kind !== 'rotated') return baseMeta;
  const facing = rotationFromYaw(yaw);
  const away = (facing + 2) % 4;
  switch (arch.model) {
    case 'beam': {
      // beams run along the direction you face
      const alongX = facing === 1 || facing === 3;
      return (baseMeta & ~1) | (alongX ? 0 : 1);
    }
    case 'column': case 'column_round': return baseMeta & ~3;
    case 'railing_glass': case 'railing_bars': return (baseMeta & ~3) | facing;
    default: return (baseMeta & ~3) | away;
  }
}

/** meta rotation so the block's front (+Z in model space) faces the player. */
export function rotationFromYaw(yaw: number): number {
  // Player looking along -Z (yaw 0) wants the front facing +Z (toward them): rot 0.
  const a = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const q = Math.round(a / (Math.PI / 2)) % 4;
  // yaw 90° (looking -X) → front should face +X → rot 3
  return [0, 3, 2, 1][q];
}

export function canPlaceAt(world: World, x: number, y: number, z: number, id: number): { ok: boolean; reason?: string } {
  if (y < 1 || y >= 127) return { ok: false, reason: 'Out of bounds' };
  const cur = world.get(x, y, z);
  if (!isReplaceable(cur) && cur !== B.WATER) return { ok: false, reason: 'Occupied' };
  const def = BLOCK_DEFS[id];
  if (def.needsSupport) {
    const below = world.get(x, y - 1, z);
    if (!SOLID[below] || (def.key !== 'torch' && def.key !== 'rug' && !OPAQUE[below] && SHAPE[below] !== 4)) return { ok: false, reason: 'Needs solid ground' };
    if (def.key === 'sapling' && ![B.GRASS, B.DIRT, B.LEAF_LITTER, B.TILLED, B.TILLED_MOIST, B.SNOW].includes(below)) return { ok: false, reason: 'Saplings need soil' };
  }
  return { ok: true };
}

/** Intersects the player's box? */
export function blocksPlayer(x: number, y: number, z: number, px: number, py: number, pz: number, halfW: number, height: number, id: number): boolean {
  if (!SOLID[id]) return false;
  return x + 1 > px - halfW && x < px + halfW && z + 1 > pz - halfW && z < pz + halfW && y + 1 > py && y < py + height;
}

/** Perform placement; returns the list of cells written (door = 2). */
export function placeBlock(world: World, req: PlaceRequest): { x: number; y: number; z: number; id: number }[] | null {
  const id = blockId(req.block);
  const def = BLOCK_DEFS[id];
  const check = canPlaceAt(world, req.x, req.y, req.z, id);
  if (!check.ok) return null;
  const rot = def.rotates ? rotationFromYaw(req.yaw) : 0;
  if (id === B.DOOR_LOWER) {
    if (!isReplaceable(world.get(req.x, req.y + 1, req.z))) return null;
    world.beginBatch();
    world.set(req.x, req.y, req.z, B.DOOR_LOWER, rot);
    world.set(req.x, req.y + 1, req.z, B.DOOR_UPPER, rot);
    world.endBatch();
    return [{ x: req.x, y: req.y, z: req.z, id }, { x: req.x, y: req.y + 1, z: req.z, id: B.DOOR_UPPER }];
  }
  let meta = rot;
  if (id === B.PLANK_STAIRS || id === B.ROOF_STAIRS) meta = (rotationFromYaw(req.yaw) + 2) % 4; // high side away from player
  if (def.arch) meta = archPlacementMeta(req.block, req.meta ?? 0, req.yaw);
  world.set(req.x, req.y, req.z, id, meta);
  return [{ x: req.x, y: req.y, z: req.z, id }];
}

/** Toggle a door (both halves). */
export function toggleDoor(world: World, x: number, y: number, z: number): boolean {
  const id = world.get(x, y, z);
  if (id !== B.DOOR_LOWER && id !== B.DOOR_UPPER) return false;
  const baseY = id === B.DOOR_UPPER ? y - 1 : y;
  const m = world.getMeta(x, baseY, z) ^ 4;
  world.beginBatch();
  world.set(x, baseY, z, B.DOOR_LOWER, m);
  if (world.get(x, baseY + 1, z) === B.DOOR_UPPER) world.set(x, baseY + 1, z, B.DOOR_UPPER, m);
  world.endBatch();
  return (m & 4) !== 0;
}

/**
 * Cheap shelter test (no flood fill): a roof within 5 blocks overhead, walls in
 * at least 3 of 4 directions within 6 blocks, and a door within 8 blocks.
 */
export function isSheltered(world: World, px: number, py: number, pz: number): boolean {
  const x = Math.floor(px), y = Math.floor(py + 0.2), z = Math.floor(pz);
  let roof = false;
  for (let dy = 2; dy <= 6; dy++) {
    const id = world.get(x, y + dy, z);
    if (SOLID[id] && id !== B.LEAVES && id !== B.PINE_NEEDLES && id !== B.BIRCH_LEAVES && id !== B.PALM_FRONDS && id !== B.BLOSSOM_LEAVES) {
      roof = true;
      break;
    }
  }
  if (!roof) return false;
  let walls = 0;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let d = 1; d <= 6; d++) {
      const a = world.get(x + dx * d, y, z + dz * d), b = world.get(x + dx * d, y + 1, z + dz * d);
      if ((SOLID[a] && a !== B.LEAVES) || (SOLID[b] && b !== B.LEAVES) || a === B.DOOR_LOWER || b === B.DOOR_UPPER) {
        walls++;
        break;
      }
    }
  }
  if (walls < 3) return false;
  for (let dy = -1; dy <= 2; dy++)
    for (let dz = -8; dz <= 8; dz++)
      for (let dx = -8; dx <= 8; dx++) {
        const id = world.get(x + dx, y + dy, z + dz);
        if (id === B.DOOR_LOWER) return true;
      }
  return false;
}

/** Comfort score around a bed: sum of distinct furniture comfort values (capped). */
export function comfortAround(world: World, x: number, y: number, z: number): number {
  const seen = new Set<number>();
  let score = 0;
  for (let dy = -2; dy <= 3; dy++)
    for (let dz = -7; dz <= 7; dz++)
      for (let dx = -7; dx <= 7; dx++) {
        const id = world.get(x + dx, y + dy, z + dz);
        const c = BLOCK_DEFS[id]?.comfort;
        if (!c || seen.has(id)) continue;
        seen.add(id);
        score += c;
      }
  return Math.min(12, score);
}
