import { describe, expect, it } from 'vitest';
import { seedFromString } from '../core/random';
import { B, LIGHT } from './BlockRegistry';
import { generateChunk } from './ChunkGenerator';
import { computeBlockLight, meshChunk, OFF, PAD, padIndex } from './ChunkMesher';
import { WORLD_HEIGHT } from './constants';
import { TerrainSampler } from './TerrainSampler';
import { findSpawn } from '../systems/SpawnFinder';

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('world generation', () => {
  it('is deterministic for the same seed', () => {
    const a = generateChunk(3, -2, new TerrainSampler(seedFromString('fern-42')));
    const b = generateChunk(3, -2, new TerrainSampler(seedFromString('fern-42')));
    expect(sameBytes(a.blocks, b.blocks)).toBe(true);
    expect(sameBytes(a.meta, b.meta)).toBe(true);
  });

  it('differs between seeds', () => {
    const a = generateChunk(0, 0, new TerrainSampler(1));
    const b = generateChunk(0, 0, new TerrainSampler(2));
    expect(sameBytes(a.blocks, b.blocks)).toBe(false);
  });

  it('parses numeric and text seeds', () => {
    expect(seedFromString('12345')).toBe(seedFromString(' 12345 '));
    expect(seedFromString('abc')).not.toBe(seedFromString('abd'));
  });

  it('produces varied biomes, rivers and water across the land', () => {
    const s = new TerrainSampler(seedFromString('meadow-7'));
    const biomes = new Set<number>();
    let river = 0, water = 0;
    for (let x = -1600; x <= 1600; x += 40)
      for (let z = -1600; z <= 1600; z += 40) {
        const c = s.sample(x, z);
        biomes.add(c.biome);
        if (c.river > 0.3) river++;
        if (c.waterLevel > 0) water++;
        expect(c.height).toBeGreaterThanOrEqual(4);
        expect(c.height).toBeLessThan(WORLD_HEIGHT - 10);
      }
    expect(biomes.size).toBeGreaterThanOrEqual(4);
    expect(river).toBeGreaterThan(0);
    expect(water).toBeGreaterThan(0);
  });

  it('keeps a bedrock-like floor and carves some caves', () => {
    const s = new TerrainSampler(99);
    let air = 0;
    for (let cx = 0; cx < 4; cx++) {
      const c = generateChunk(cx, 0, s);
      for (let i = 0; i < 256; i++) expect(c.blocks[i]).toBe(B.DEEPSTONE);
      for (let i = 256 * 5; i < 256 * 30; i++) if (c.blocks[i] === 0) air++;
    }
    expect(air).toBeGreaterThan(0);
  });

  it('caves v2 (new worlds) carve noticeably bigger cave systems; old worlds are unchanged', () => {
    const count = (v: number) => {
      const s = new TerrainSampler(4242, v);
      let air = 0;
      for (let cx = -3; cx < 3; cx++)
        for (let cz = -3; cz < 3; cz++) {
          const c = generateChunk(cx, cz, s);
          for (let i = 256 * 5; i < 256 * 40; i++) if (c.blocks[i] === 0 || c.blocks[i] === B.WATER) air++;
        }
      return air;
    };
    const v1 = count(1), v2 = count(2);
    expect(v2).toBeGreaterThan(v1 * 1.3);
    // determinism: the same seed + version always gives the same chunk
    const a = generateChunk(1, 1, new TerrainSampler(7, 2)), b = generateChunk(1, 1, new TerrainSampler(7, 2));
    expect(a.blocks.every((v, i) => v === b.blocks[i])).toBe(true);
  });

  it('spawns the player on dry, friendly ground', () => {
    const s = new TerrainSampler(seedFromString('spawn-test'));
    const sp = findSpawn(s);
    const col = s.sample(sp.x, sp.z);
    expect(col.waterLevel).toBe(0);
    expect([0, 1]).toContain(col.biome);
  });
});

describe('meshing', () => {
  const vol = () => ({ blocks: new Uint8Array(PAD * WORLD_HEIGHT * PAD), meta: new Uint8Array(PAD * WORLD_HEIGHT * PAD), tints: new Uint8Array(16 * 16 * 9).fill(200) });

  it('emits only exposed faces for a single cube', () => {
    const v = vol();
    v.blocks[padIndex(5, 20, 5)] = B.STONE;
    const m = meshChunk(v);
    expect(m.solid.indices.length / 6).toBe(6);
  });

  it('greedy-merges coplanar faces', () => {
    const v = vol();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) v.blocks[padIndex(x, 10, z)] = B.STONE;
    // neighbours also filled so side faces at borders are culled
    for (let x = -16; x < 32; x++) for (let z = -16; z < 32; z++) v.blocks[padIndex(x, 10, z)] = B.STONE;
    const m = meshChunk(v);
    // one top quad + one bottom quad for the whole 16×16 slab
    expect(m.solid.indices.length / 6).toBe(2);
  });

  it('culls faces between neighbouring chunks', () => {
    const v = vol();
    v.blocks[padIndex(15, 20, 5)] = B.STONE;
    v.blocks[padIndex(16, 20, 5)] = B.STONE; // lives in the +X neighbour
    const m = meshChunk(v);
    expect(m.solid.indices.length / 6).toBe(5);
  });

  it('propagates torch light with falloff and stops at opaque blocks', () => {
    const v = vol();
    v.blocks[padIndex(8, 30, 8)] = B.TORCH;
    v.blocks[padIndex(10, 30, 8)] = B.STONE;
    const light = computeBlockLight(v.blocks);
    const l0 = LIGHT[B.TORCH];
    expect(light[padIndex(8, 30, 8)]).toBe(l0);
    expect(light[padIndex(9, 30, 8)]).toBe(l0 - 1);
    expect(light[padIndex(8, 33, 8)]).toBe(l0 - 3);
    expect(light[padIndex(10, 30, 8)]).toBe(0); // opaque
    expect(light[padIndex(11, 30, 8)]).toBe(l0 - 5); // around the stone
    expect(OFF).toBe(16);
  });
});
