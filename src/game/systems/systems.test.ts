import { describe, expect, it } from 'vitest';
import { B } from '../world/BlockRegistry';
import { Chunk } from '../world/Chunk';
import { World } from '../world/World';
import { canPlaceAt, isSheltered, placeBlock, rotationFromYaw, toggleDoor } from './BuildingSystem';
import { FarmingSystem } from './FarmingSystem';
import { GameClock } from '../core/GameClock';

/** A flat test world: stone up to y=9, grass at y=10, air above. */
function flatWorld(): World {
  const w = new World(1);
  for (let cz = -1; cz <= 1; cz++)
    for (let cx = -1; cx <= 1; cx++) {
      const c = Chunk.empty(cx, cz);
      for (let z = 0; z < 16; z++)
        for (let x = 0; x < 16; x++) {
          for (let y = 0; y < 10; y++) c.set(x, y, z, B.STONE);
          c.set(x, 10, z, B.GRASS);
          c.refreshHeight(x, z);
        }
      w.addChunk(c);
    }
  return w;
}

describe('building', () => {
  it('orients blocks toward the player', () => {
    expect(rotationFromYaw(0)).toBe(0);
    expect(rotationFromYaw(Math.PI / 2)).toBe(3);
    expect(rotationFromYaw(Math.PI)).toBe(2);
    expect(rotationFromYaw(-Math.PI / 2)).toBe(1);
  });

  it('places two-block doors and toggles them', () => {
    const w = flatWorld();
    const cells = placeBlock(w, { x: 2, y: 11, z: 2, block: 'door_lower', yaw: 0, ny: 1 });
    expect(cells).toHaveLength(2);
    expect(w.get(2, 12, 2)).toBe(B.DOOR_UPPER);
    expect(w.isSolid(2, 11, 2)).toBe(true);
    expect(toggleDoor(w, 2, 12, 2)).toBe(true);
    expect(w.isSolid(2, 11, 2)).toBe(false);
    expect(w.isSolid(2, 12, 2)).toBe(false);
  });

  it('plants need soil and cannot replace solid blocks', () => {
    const w = flatWorld();
    expect(canPlaceAt(w, 3, 11, 3, B.SAPLING).ok).toBe(true);
    expect(canPlaceAt(w, 3, 12, 3, B.SAPLING).ok).toBe(false); // floating
    expect(canPlaceAt(w, 3, 10, 3, B.PLANKS).ok).toBe(false); // occupied
  });

  it('detects a simple shelter', () => {
    const w = flatWorld();
    expect(isSheltered(w, 0.5, 11, 0.5)).toBe(false);
    for (let y = 11; y <= 13; y++)
      for (let i = -3; i <= 3; i++) {
        w.set(i, y, -3, B.PLANKS);
        w.set(i, y, 3, B.PLANKS);
        w.set(-3, y, i, B.PLANKS);
        w.set(3, y, i, B.PLANKS);
      }
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) w.set(x, 14, z, B.PLANKS);
    w.set(0, 11, 3, B.DOOR_LOWER);
    w.set(0, 12, 3, B.DOOR_UPPER);
    expect(isSheltered(w, 0.5, 11, 0.5)).toBe(true);
  });
});

describe('farming', () => {
  it('grows from timestamps (twice as fast on watered soil)', () => {
    const w = flatWorld();
    const f = new FarmingSystem();
    w.set(4, 10, 4, B.TILLED);
    w.set(6, 10, 4, B.TILLED_MOIST);
    expect(f.plant(w, 4, 11, 4, 'crop_wheat', 0)).toBe(true);
    expect(f.plant(w, 6, 11, 4, 'crop_wheat', 0)).toBe(true);
    expect(f.plant(w, 5, 11, 4, 'crop_wheat', 0)).toBe(false); // not tilled
    const dry = f.crops.get('4,11,4')!, wet = f.crops.get('6,11,4')!;
    expect(FarmingSystem.stageFor(w, 4, 11, 4, B.CROP_WHEAT, dry, 180)).toBe(1);
    expect(FarmingSystem.stageFor(w, 6, 11, 4, B.CROP_WHEAT, wet, 180)).toBe(2);
    expect(FarmingSystem.stageFor(w, 6, 11, 4, B.CROP_WHEAT, wet, 10000)).toBe(3);
    f.update(5, w, 10000, false);
    expect(f.isRipe(w, 6, 11, 4)).toBe(true);
  });
});

describe('game clock', () => {
  it('starts in the morning and skips to the next morning when sleeping', () => {
    const c = new GameClock(0, 20);
    expect(c.dayFraction).toBeCloseTo(0.3);
    expect(c.isNight).toBe(false);
    c.time += c.dayLength * 0.6; // evening → night
    expect(c.isNight).toBe(true);
    const day = c.day;
    c.skipToMorning();
    expect(c.isNight).toBe(false);
    expect(c.day).toBe(day + 1);
  });
});
