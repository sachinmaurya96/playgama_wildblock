import { describe, expect, it } from 'vitest';
import { BLOCK_DEFS } from '../../data/blocks';
import { B, SHAPE, SOLID } from './BlockRegistry';
import { Chunk } from './Chunk';
import { generateChunk } from './ChunkGenerator';
import { World } from './World';
import { WORLD_HEIGHT } from './constants';

// Reference behavior before caching: intentionally independent of the cache.
function originalStandableY(world: World, x: number, z: number) {
  for (let y = WORLD_HEIGHT - 2; y > 0; y--) {
    const id = world.get(x, y, z);
    if (SOLID[id] && SHAPE[id] === 1 && !BLOCK_DEFS[id].key.includes('leav') && id !== B.PINE_NEEDLES && id !== B.PALM_FRONDS) return y;
    if (id === B.WATER) return y;
  }
  return 0;
}

describe('cached ground queries', () => {
  it('matches the original scan in every column of generated positive and negative chunks', () => {
    const world = new World(4242);
    for (const [cx, cz] of [[0, 0], [-1, -1], [2, -2]]) {
      world.addChunk(new Chunk(generateChunk(cx, cz, world.sampler)));
      for (let z = cz * 16; z < cz * 16 + 16; z++) for (let x = cx * 16; x < cx * 16 + 16; x++) {
        const expected = originalStandableY(world, x, z);
        expect(world.standableY(x, z)).toBe(expected);
        expect(world.standableY(x, z)).toBe(expected);
      }
    }
  });
  it('invalidates after local edits, remote edits, water, undo-style removal and chunk replacement', () => {
    const world = new World(1);
    world.addChunk(Chunk.empty(-1, 0));
    expect(world.standableY(-1, 0)).toBe(0);
    world.set(-1, 20, 0, B.STONE);
    world.set(-1, 30, 0, B.LEAVES);
    expect(world.standableY(-1, 0)).toBe(20);
    world.applyRemote(-1, 25, 0, B.WATER, 0);
    expect(world.standableY(-1, 0)).toBe(25);
    world.set(-1, 25, 0, B.AIR);
    expect(world.standableY(-1, 0)).toBe(20);
    world.removeChunk(-1, 0);
    expect(world.standableY(-1, 0)).toBe(0);
    world.addChunk(Chunk.empty(-1, 0)); // saved modifications re-applied
    expect(world.standableY(-1, 0)).toBe(20);
  });
  it('preserves the original treatment of slabs and the world ceiling', () => {
    const world = new World(1);
    const chunk = Chunk.empty(0, 0);
    world.addChunk(chunk);
    chunk.set(0, 10, 0, B.STONE);
    chunk.set(0, 20, 0, B.PLANK_SLAB);
    chunk.set(0, WORLD_HEIGHT - 1, 0, B.STONE);
    expect(world.standableY(0, 0)).toBe(10);
    chunk.set(0, 10, 0, 0);
    expect(world.standableY(0, 0)).toBe(0);
  });
});
