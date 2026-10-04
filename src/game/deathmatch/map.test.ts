import { describe, expect, it } from 'vitest';
import { B, SOLID } from '../world/BlockRegistry';
import { blockId } from '../world/BlockRegistry';
import { CHUNK_SIZE } from '../world/constants';
import { localIndex } from '../world/coordinates';
import { CITY_G, HEALTH_STATIONS, LOOT_POINTS, PLAY_HALF, cityBlueprint, spawnPoints, type MapPoint } from './DeathmatchMap';

const city = cityBlueprint(12345);
const FENCE = blockId('arch_fence');
const LANTERN = blockId('lantern');
const HEDGE_LOW = blockId('hedge_low');
const RAIL = blockId('arch_railing_bars');
/** Blocks taller than a jump, or too thin to stand on. */
const TALL = new Set([FENCE, LANTERN, HEDGE_LOW, RAIL]);

const solid = (x: number, y: number, z: number) => SOLID[city.blockAt(x, y, z)] === 1;

/** Room for a player (0.6 wide, 1.62 tall) standing with feet at p. */
function standable(p: MapPoint): boolean {
  const y = Math.floor(p.y);
  for (const dx of [-0.3, 0.3])
    for (const dz of [-0.3, 0.3]) {
      const x = Math.floor(p.x + dx), z = Math.floor(p.z + dz);
      if (solid(x, y, z) || solid(x, y + 1, z)) return false;
    }
  return solid(Math.floor(p.x), y - 1, Math.floor(p.z));
}

/**
 * Walkability flood fill over standing cells: move to a 4-neighbour whose floor is
 * at most 1 block higher (step / jump) or up to 4 lower (drop down).
 */
function reachable(start: MapPoint): Set<string> {
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const floorOk = (x: number, y: number, z: number) => {
    const below = city.blockAt(x, y - 1, z);
    return SOLID[below] === 1 && !TALL.has(below) && !solid(x, y, z) && !solid(x, y + 1, z);
  };
  const seen = new Set<string>();
  const q: [number, number, number][] = [[Math.floor(start.x), Math.floor(start.y), Math.floor(start.z)]];
  seen.add(key(...q[0]));
  while (q.length) {
    const [x, y, z] = q.pop()!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (Math.abs(nx + 0.5) > PLAY_HALF || Math.abs(nz + 0.5) > PLAY_HALF) continue;
      for (let ny = y + 1; ny >= y - 4; ny--) {
        if (!floorOk(nx, ny, nz)) continue;
        // jumping up needs head room above the current spot
        if (ny > y && solid(x, y + 2, z)) continue;
        const k = key(nx, ny, nz);
        if (!seen.has(k)) {
          seen.add(k);
          q.push([nx, ny, nz]);
        }
        break;
      }
    }
  }
  return seen;
}

describe('City Clash map', () => {
  it('is deterministic for a seed', () => {
    const a = cityBlueprint(777).generateChunk(-2, 1);
    const b = cityBlueprint(777).generateChunk(-2, 1);
    expect([...a.blocks]).toEqual([...b.blocks]);
    expect([...a.meta]).toEqual([...b.meta]);
  });

  it('chunk voxels match blockAt queries (host occlusion uses blockAt)', () => {
    for (const [cx, cz] of [[-4, -4], [-1, 0], [0, -4], [2, 3], [-5, 0], [4, -1]]) {
      const c = city.generateChunk(cx, cz);
      for (let i = 0; i < 4000; i++) {
        const lx = (i * 7) % CHUNK_SIZE, lz = (i * 13) % CHUNK_SIZE, y = CITY_G - 1 + ((i * 3) % 22);
        expect(c.blocks[localIndex(lx, y, lz)]).toBe(city.blockAt(cx * CHUNK_SIZE + lx, y, cz * CHUNK_SIZE + lz));
      }
    }
  });

  it('has 8 spawn points per team, all standable, mirrored', () => {
    const red = spawnPoints('red'), blue = spawnPoints('blue');
    expect(red.length).toBeGreaterThanOrEqual(8);
    for (const p of [...red, ...blue]) expect(standable(p), `spawn ${p.x},${p.z}`).toBe(true);
    red.forEach((p, i) => expect(blue[i].x).toBe(-p.x));
    expect(red.every((p) => p.x < -60)).toBe(true);
  });

  it('puts every loot point and health station on reachable open ground', () => {
    expect(LOOT_POINTS.length).toBeGreaterThanOrEqual(20);
    expect(LOOT_POINTS.length).toBeLessThanOrEqual(30);
    expect(new Set(LOOT_POINTS.map((p) => p.id)).size).toBe(LOOT_POINTS.length);
    for (const p of LOOT_POINTS) expect(standable(p), `loot ${p.id}`).toBe(true);
    for (const s of HEALTH_STATIONS) expect(standable(s), `station ${s.id}`).toBe(true);
  });

  it('connects both spawns, every loot point and all elevated positions on foot', () => {
    const red = spawnPoints('red')[0];
    const reach = reachable(red);
    const at = (p: MapPoint) => reach.has(`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`);
    for (const p of spawnPoints('blue')) expect(at(p), `blue spawn ${p.x},${p.z}`).toBe(true);
    for (const p of spawnPoints('red')) expect(at(p), `red spawn ${p.x},${p.z}`).toBe(true);
    for (const p of LOOT_POINTS) expect(at(p), `loot ${p.id}`).toBe(true);
    for (const s of HEALTH_STATIONS) expect(at(s), `station ${s.id}`).toBe(true);
  });

  it('balances loot: rare items only in neutral spots, same count per side', () => {
    const west = LOOT_POINTS.filter((p) => p.x < -1), east = LOOT_POINTS.filter((p) => p.x > 1);
    expect(west.length).toBe(east.length);
    for (const p of LOOT_POINTS.filter((q) => q.tier === 'rare')) expect(Math.abs(p.x)).toBeLessThan(2);
  });

  it('closes the arena with a boundary nobody can climb', () => {
    for (let i = -76; i < 76; i += 3) {
      for (const [x, z] of [[i, -77], [i, 76], [-77, i], [76, i]]) {
        for (let y = CITY_G + 1; y <= CITY_G + 15; y++) expect(solid(x, y, z), `wall ${x},${y},${z}`).toBe(true);
      }
    }
  });

  it('keeps the long middle line between the spawns blocked', () => {
    // a bullet flying along z = 0 from the Red spawn exit must hit something before the Blue spawn
    let blocked = false;
    for (let x = -60; x <= 59 && !blocked; x++) for (const y of [CITY_G + 1, CITY_G + 2]) if (solid(x, y, -1) || solid(x, y, 0)) blocked = true;
    expect(blocked).toBe(true);
    expect(city.blockAt(0, CITY_G - 3, 0)).toBe(B.STONE);
  });
});
