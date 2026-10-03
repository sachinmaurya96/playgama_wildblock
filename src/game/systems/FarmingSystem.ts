import { BLOCK_DEFS } from '../../data/blocks';
import { B, blockId } from '../world/BlockRegistry';
import type { World } from '../world/World';

export interface CropRecord {
  planted: number;
}

/**
 * Crops store only a planting timestamp (game time). Growth stage is derived
 * from elapsed time, so crops keep growing while their chunk is unloaded and
 * across sessions — nothing is simulated per frame. Dry soil grows at half
 * speed; soil near water, rain-soaked or watered soil grows at full speed.
 */
export class FarmingSystem {
  readonly crops = new Map<string, CropRecord>();
  /** Harvested berry bushes: key -> game time when ripe again. */
  readonly bushes = new Map<string, number>();
  private timer = 0;

  static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  static stageFor(world: World, x: number, y: number, z: number, cropId: number, rec: CropRecord, now: number): number {
    const g = BLOCK_DEFS[cropId].growth!;
    const moist = world.get(x, y - 1, z) === B.TILLED_MOIST;
    const elapsed = Math.max(0, now - rec.planted) * (moist ? 1 : 0.5);
    return Math.min(g.stages - 1, Math.floor(elapsed / g.secondsPerStage));
  }

  plant(world: World, x: number, y: number, z: number, crop: string, now: number): boolean {
    const id = blockId(crop);
    const soil = world.get(x, y - 1, z);
    if (soil !== B.TILLED && soil !== B.TILLED_MOIST) return false;
    if (world.get(x, y, z) !== 0) return false;
    world.set(x, y, z, id, 0);
    this.crops.set(FarmingSystem.key(x, y, z), { planted: now });
    this.moistenIfNearWater(world, x, y - 1, z);
    return true;
  }

  moistenIfNearWater(world: World, x: number, y: number, z: number): boolean {
    if (world.get(x, y, z) !== B.TILLED) return false;
    for (let dz = -3; dz <= 3; dz++)
      for (let dx = -3; dx <= 3; dx++)
        for (let dy = -1; dy <= 0; dy++)
          if (world.get(x + dx, y + dy, z + dz) === B.WATER) {
            world.set(x, y, z, B.TILLED_MOIST, 0);
            return true;
          }
    return false;
  }

  /** Is the crop at this cell fully grown? (wild crops without a record are mature) */
  isRipe(world: World, x: number, y: number, z: number): boolean {
    const id = world.get(x, y, z);
    const g = BLOCK_DEFS[id]?.growth;
    if (!g) return false;
    return ((world.getMeta(x, y, z) >> 3) & 7) >= g.stages - 1;
  }

  removed(x: number, y: number, z: number): void {
    const k = FarmingSystem.key(x, y, z);
    this.crops.delete(k);
    this.bushes.delete(k);
  }

  replant(x: number, y: number, z: number, now: number, world: World): void {
    const id = world.get(x, y, z);
    world.set(x, y, z, id, 0);
    this.crops.set(FarmingSystem.key(x, y, z), { planted: now });
  }

  harvestBush(world: World, x: number, y: number, z: number, now: number): boolean {
    if (world.get(x, y, z) !== B.BERRY_BUSH) return false;
    if (!((world.getMeta(x, y, z) >> 3) & 1)) return false;
    world.set(x, y, z, B.BERRY_BUSH, 0);
    this.bushes.set(FarmingSystem.key(x, y, z), now + 300);
    return true;
  }

  /** Periodic update: advance visible growth stages (batched remesh). */
  update(dt: number, world: World, now: number, raining: boolean): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 2;
    world.beginBatch();
    for (const [k, rec] of this.crops) {
      const [x, y, z] = k.split(',').map(Number);
      if (!world.isLoaded(x, z)) continue;
      const id = world.get(x, y, z);
      if (!BLOCK_DEFS[id]?.growth) {
        this.crops.delete(k);
        continue;
      }
      if (raining) this.rainSoak(world, x, y - 1, z);
      else this.moistenIfNearWater(world, x, y - 1, z);
      const stage = FarmingSystem.stageFor(world, x, y, z, id, rec, now);
      const meta = world.getMeta(x, y, z);
      const cur = (meta >> 3) & 7;
      // keep the low bits (Build Home marks live crops there)
      if (stage !== cur) world.set(x, y, z, id, (stage << 3) | (meta & 7));
    }
    for (const [k, readyAt] of this.bushes) {
      if (now < readyAt) continue;
      const [x, y, z] = k.split(',').map(Number);
      if (!world.isLoaded(x, z)) continue;
      if (world.get(x, y, z) === B.BERRY_BUSH) world.set(x, y, z, B.BERRY_BUSH, 1 << 3);
      this.bushes.delete(k);
    }
    world.endBatch();
  }

  private rainSoak(world: World, x: number, y: number, z: number) {
    if (world.get(x, y, z) !== B.TILLED) return;
    if (world.surfaceY(x, z) <= y + 1) world.set(x, y, z, B.TILLED_MOIST, 0);
  }

  serialize(): { crops: [string, number][]; bushes: [string, number][] } {
    return { crops: [...this.crops].map(([k, r]) => [k, r.planted]), bushes: [...this.bushes] };
  }

  load(data: { crops: [string, number][]; bushes: [string, number][] } | undefined): void {
    this.crops.clear();
    this.bushes.clear();
    if (!data) return;
    for (const [k, t] of data.crops) this.crops.set(k, { planted: t });
    for (const [k, t] of data.bushes) this.bushes.set(k, t);
  }
}
