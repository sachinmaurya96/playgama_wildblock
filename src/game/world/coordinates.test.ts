import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, CHUNK_VOLUME, WORLD_HEIGHT } from './constants';
import { blockToChunk, blockToLocal, chunkLocalToBlock, indexToLocal, inLocalBounds, localIndex, worldToBlock } from './coordinates';
import { Chunk } from './Chunk';
import { ckey, ckeyX, ckeyZ } from './World';

describe('coordinates', () => {
  it('floors world positions to block coordinates (including negatives)', () => {
    expect(worldToBlock(0.2)).toBe(0);
    expect(worldToBlock(-0.2)).toBe(-1);
    expect(worldToBlock(-1)).toBe(-1);
    expect(worldToBlock(15.999)).toBe(15);
  });

  it('maps blocks to chunks and local coordinates on both sides of zero', () => {
    expect(blockToChunk(0)).toBe(0);
    expect(blockToChunk(15)).toBe(0);
    expect(blockToChunk(16)).toBe(1);
    expect(blockToChunk(-1)).toBe(-1);
    expect(blockToChunk(-16)).toBe(-1);
    expect(blockToChunk(-17)).toBe(-2);
    expect(blockToLocal(-1)).toBe(15);
    expect(blockToLocal(-16)).toBe(0);
    expect(blockToLocal(17)).toBe(1);
    for (let b = -70; b < 70; b++) expect(chunkLocalToBlock(blockToChunk(b), blockToLocal(b))).toBe(b);
  });

  it('round-trips chunk indices', () => {
    for (const [x, y, z] of [[0, 0, 0], [15, 127, 15], [3, 64, 9], [0, 1, 15]]) {
      const i = localIndex(x, y, z);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(CHUNK_VOLUME);
      expect(indexToLocal(i)).toEqual([x, y, z]);
    }
    expect(localIndex(1, 0, 0) - localIndex(0, 0, 0)).toBe(1);
    expect(localIndex(0, 0, 1) - localIndex(0, 0, 0)).toBe(CHUNK_SIZE);
    expect(localIndex(0, 1, 0) - localIndex(0, 0, 0)).toBe(CHUNK_SIZE * CHUNK_SIZE);
    expect(inLocalBounds(16, 0, 0)).toBe(false);
    expect(inLocalBounds(0, WORLD_HEIGHT, 0)).toBe(false);
    expect(inLocalBounds(15, WORLD_HEIGHT - 1, 15)).toBe(true);
  });

  it('packs numeric chunk keys reversibly', () => {
    for (const [x, z] of [[0, 0], [-1, -1], [100, -250], [-3000, 42]]) {
      const k = ckey(x, z);
      expect(ckeyX(k)).toBe(x);
      expect(ckeyZ(k)).toBe(z);
    }
  });

  it('stores blocks compactly in a Chunk', () => {
    const c = Chunk.empty(2, -3);
    expect(c.blocks).toHaveLength(CHUNK_VOLUME);
    c.set(4, 10, 7, 3, 2);
    expect(c.get(4, 10, 7)).toBe(3);
    expect(c.getMeta(4, 10, 7)).toBe(2);
    expect(c.get(4, -1, 7)).toBe(0);
    c.refreshHeight(4, 7);
    expect(c.heightmap[7 * 16 + 4]).toBe(10);
  });
});
