import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chunk } from './Chunk';
import { ChunkManager } from './ChunkManager';
import { createBuilder, type ChunkMeshResult } from './ChunkMesher';
import { World, ckey } from './World';
import type { WorkerPool } from '../workers/WorkerPool';
import type { TerrainMaterials } from '../rendering/TerrainMaterials';

function emptyMesh(): ChunkMeshResult {
  return {
    solid: createBuilder().build(), cutout: createBuilder().build(), glass: createBuilder().build(),
    water: { positions: new Float32Array(), colors: new Uint8Array(), flow: new Float32Array(), indices: new Uint32Array() },
  };
}

function setup() {
  const jobs: { resolve: (result: ChunkMeshResult) => void; cancel: ReturnType<typeof vi.fn> }[] = [];
  const pool = { size: 6, pending: 0, pump() {}, run: vi.fn(() => {
    let resolve!: (r: ChunkMeshResult) => void;
    const promise = new Promise<ChunkMeshResult>((r) => { resolve = r; });
    const cancel = vi.fn(); jobs.push({ resolve, cancel });
    return { promise, cancel };
  }) };
  const world = new World(1);
  const manager = new ChunkManager(world, pool as unknown as WorkerPool, {} as TerrainMaterials, 4);
  const add = (cx: number, cz: number, needsMesh = false) => {
    world.addChunk(Chunk.empty(cx, cz));
    const record = { cx, cz, gen: 'ready' as 'none' | 'pending' | 'ready', mesh: 'none' as 'none' | 'pending' | 'ready', meshVersion: -1, needsMesh, group: null as THREE.Group | null, triangles: 0 };
    manager.records.set(ckey(cx, cz), record);
    return record;
  };
  for (let z = -2; z <= 2; z++) for (let x = -2; x <= 2; x++) add(x, z);
  const internal = manager as unknown as {
    requestMesh(r: ReturnType<typeof add>): void;
    scheduleMeshes(): void;
    processUploads(): void;
    unload(k: number, r: ReturnType<typeof add>): void;
  };
  return { jobs, pool, world, manager, internal, add };
}

afterEach(() => vi.restoreAllMocks());
describe('streaming result ownership and frame budgets', () => {
  it('discards a completed mesh if its chunk has been edited since the job started', async () => {
    const { jobs, world, manager, internal } = setup();
    const record = manager.records.get(ckey(0, 0))!;
    internal.requestMesh(record);
    world.set(1, 20, 1, 1);
    jobs[0].resolve(emptyMesh()); await Promise.resolve();
    internal.processUploads();
    expect(record.group).toBeNull();
    expect(record.needsMesh).toBe(true);
    expect(record.mesh).toBe('none');
    manager.dispose();
  });
  it('never installs an old job into a chunk unloaded and reloaded at the same coordinates', async () => {
    const { jobs, manager, internal, add } = setup();
    const old = manager.records.get(ckey(0, 0))!;
    internal.requestMesh(old);
    jobs[0].resolve(emptyMesh()); await Promise.resolve(); // already queued for upload
    internal.unload(ckey(0, 0), old);
    const fresh = add(0, 0);
    internal.processUploads();
    expect(fresh.group).toBeNull();
    expect(fresh.mesh).toBe('none');
    expect(jobs[0].cancel).toHaveBeenCalledOnce();
    manager.dispose();
  });
  it('limits CPU mesh preparation and GPU installation to two jobs per frame', async () => {
    const { jobs, manager, internal } = setup();
    // This verifies the count cap independently of machine load. An actual
    // volume copy may exceed the time budget and correctly stop after one.
    vi.spyOn(performance, 'now').mockReturnValue(0);
    for (const record of manager.records.values()) record.needsMesh = true;
    internal.scheduleMeshes();
    expect(jobs).toHaveLength(2);
    internal.scheduleMeshes();
    expect(jobs).toHaveLength(4);
    for (const job of jobs) job.resolve(emptyMesh());
    await Promise.resolve();
    internal.processUploads();
    expect(manager.root.children).toHaveLength(2);
    internal.processUploads();
    expect(manager.root.children).toHaveLength(4);
    manager.dispose();
  });
  it('stops mesh preparation after one job uses the frame budget', () => {
    const { jobs, manager, internal } = setup();
    for (const record of manager.records.values()) record.needsMesh = true;
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(5);
    internal.scheduleMeshes();
    expect(jobs).toHaveLength(1);
    manager.dispose();
  });
  it('stops after one expensive upload instead of forcing a second hitch', async () => {
    const { jobs, manager, internal } = setup();
    internal.requestMesh(manager.records.get(ckey(0, 0))!);
    internal.requestMesh(manager.records.get(ckey(1, 0))!);
    for (const job of jobs) job.resolve(emptyMesh());
    await Promise.resolve();
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(5);
    internal.processUploads();
    expect(manager.root.children).toHaveLength(1);
    manager.dispose();
  });
});
