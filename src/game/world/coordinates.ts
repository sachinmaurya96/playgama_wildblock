import { CHUNK_SIZE, WORLD_HEIGHT } from './constants';

/**
 * All coordinate math lives here so nothing else re-implements it.
 *
 * Block index layout inside a chunk: index = y * 256 + z * 16 + x
 * (Y-major makes vertical column scans and whole-layer loops cache friendly.)
 */

const LAYER = CHUNK_SIZE * CHUNK_SIZE;

/** World-space position (float) → integer block coordinate. */
export function worldToBlock(v: number): number {
  return Math.floor(v);
}

/** Block coordinate → chunk coordinate (works for negatives). */
export function blockToChunk(b: number): number {
  return Math.floor(b / CHUNK_SIZE);
}

/** Block coordinate → local coordinate inside its chunk, 0..15 (works for negatives). */
export function blockToLocal(b: number): number {
  return ((b % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
}

/** Chunk coordinate + local coordinate → world block coordinate. */
export function chunkLocalToBlock(chunk: number, local: number): number {
  return chunk * CHUNK_SIZE + local;
}

/** Local (x,y,z) → flat array index. No bounds checks — call inBounds first when needed. */
export function localIndex(x: number, y: number, z: number): number {
  return y * LAYER + z * CHUNK_SIZE + x;
}

/** Flat index → local coordinates. */
export function indexToLocal(index: number): [number, number, number] {
  const y = Math.floor(index / LAYER);
  const rem = index - y * LAYER;
  const z = Math.floor(rem / CHUNK_SIZE);
  const x = rem - z * CHUNK_SIZE;
  return [x, y, z];
}

export function inLocalBounds(x: number, y: number, z: number): boolean {
  return x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE && y >= 0 && y < WORLD_HEIGHT;
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export function parseChunkKey(key: string): [number, number] {
  const [a, b] = key.split(',');
  return [Number(a), Number(b)];
}

export function blockKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export function parseBlockKey(key: string): [number, number, number] {
  const p = key.split(',');
  return [Number(p[0]), Number(p[1]), Number(p[2])];
}
