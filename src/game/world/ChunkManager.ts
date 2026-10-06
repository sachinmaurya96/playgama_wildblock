import * as THREE from 'three';
import { Chunk, type ChunkGenResult } from './Chunk';
import { CHUNK_SIZE, WORLD_HEIGHT } from './constants';
import type { ChunkMeshResult, MeshArrays, WaterArrays } from './ChunkMesher';
import { OFF, PAD } from './ChunkMesher';
import { ckey, ckeyX, ckeyZ, type World } from './World';
import type { WorkerPool } from '../workers/WorkerPool';
import type { TerrainMaterials } from '../rendering/TerrainMaterials';

interface ChunkRecord {
  cx: number;
  cz: number;
  gen: 'none' | 'pending' | 'ready';
  mesh: 'none' | 'pending' | 'ready';
  /** chunk.version the current/pending mesh was built from */
  meshVersion: number;
  needsMesh: boolean;
  group: THREE.Group | null;
  cancelGen?: () => void;
  cancelMesh?: () => void;
  triangles: number;
}

/**
 * Streams chunks around the player: prioritised generation (nearest and
 * in-view first), meshing once all 8 neighbours exist, rate-limited GPU
 * uploads, and unloading of far chunks with geometry disposal.
 */
export class ChunkManager {
  readonly records = new Map<number, ChunkRecord>();
  readonly root = new THREE.Group();
  renderRadius: number;
  private centerX = 0;
  private centerZ = 0;
  private viewX = 0;
  private viewZ = 1;
  private moveX = 0;
  private moveZ = 0;
  private refreshTimer = 0;
  private uploads: { key: number; record: ChunkRecord; version: number; result: ChunkMeshResult }[] = [];
  private inflightMeshes = 0;
  private disposed = false;
  onChunkReady: ((chunk: Chunk) => void) | null = null;
  onChunkUnloaded: ((cx: number, cz: number) => void) | null = null;

  constructor(
    private world: World,
    private pool: WorkerPool,
    private materials: TerrainMaterials,
    renderRadius: number,
  ) {
    this.renderRadius = renderRadius;
    this.root.name = 'terrain';
    world.onChunkChanged = (cx, cz) => this.markDirty(cx, cz);
  }

  markDirty(cx: number, cz: number): void {
    const r = this.records.get(ckey(cx, cz));
    if (r && r.gen === 'ready') r.needsMesh = true;
  }

  /** Chunk distance metric used for priorities: distance, minus a bonus for chunks in view / ahead of movement. */
  private priority(cx: number, cz: number): number {
    const dx = cx + 0.5 - this.centerX / CHUNK_SIZE;
    const dz = cz + 0.5 - this.centerZ / CHUNK_SIZE;
    const d = Math.hypot(dx, dz);
    if (d < 1.6) return d - 10; // the ground under the player always first
    const inv = 1 / Math.max(d, 1e-3);
    const view = (dx * this.viewX + dz * this.viewZ) * inv;
    const move = (dx * this.moveX + dz * this.moveZ) * inv;
    return d - view * 1.8 - move * 1.2;
  }

  update(dt: number, px: number, pz: number, viewDir: THREE.Vector3, velocity: THREE.Vector3): void {
    if (this.disposed) return;
    this.centerX = px;
    this.centerZ = pz;
    const vl = Math.hypot(viewDir.x, viewDir.z) || 1;
    this.viewX = viewDir.x / vl;
    this.viewZ = viewDir.z / vl;
    const ml = Math.hypot(velocity.x, velocity.z);
    this.moveX = ml > 0.5 ? velocity.x / ml : 0;
    this.moveZ = ml > 0.5 ? velocity.z / ml : 0;

    this.refreshTimer -= dt;
    if (this.refreshTimer <= 0) {
      this.refreshTimer = 0.25;
      this.refreshDesired();
    }
    this.scheduleMeshes();
    this.pool.pump();
    this.processUploads();
  }

  private refreshDesired(): void {
    const pcx = Math.floor(this.centerX / CHUNK_SIZE);
    const pcz = Math.floor(this.centerZ / CHUNK_SIZE);
    const genR = this.renderRadius + 1;
    // request generation
    for (let dz = -genR; dz <= genR; dz++)
      for (let dx = -genR; dx <= genR; dx++) {
        if (dx * dx + dz * dz > (genR + 0.5) * (genR + 0.5)) continue;
        const cx = pcx + dx, cz = pcz + dz;
        const k = ckey(cx, cz);
        let r = this.records.get(k);
        if (!r) {
          r = { cx, cz, gen: 'none', mesh: 'none', meshVersion: -1, needsMesh: false, group: null, triangles: 0 };
          this.records.set(k, r);
        }
        if (r.gen === 'none') this.requestGen(r);
      }
    // unload far chunks
    const unloadR = this.renderRadius + 3;
    for (const [k, r] of this.records) {
      const dx = r.cx - pcx, dz = r.cz - pcz;
      if (dx * dx + dz * dz <= unloadR * unloadR) continue;
      this.unload(k, r);
    }
  }

  private requestGen(r: ChunkRecord) {
    r.gen = 'pending';
    const job = this.pool.run<ChunkGenResult>({ type: 'gen', seed: this.world.seed, cx: r.cx, cz: r.cz, plot: this.world.plot ?? undefined, city: this.world.city ? true : undefined, caves: this.world.caveVersion }, [], () => this.priority(r.cx, r.cz));
    r.cancelGen = job.cancel;
    job.promise.then(
      (res) => {
        if (this.disposed || this.records.get(ckey(r.cx, r.cz)) !== r) return;
        const chunk = new Chunk(res);
        this.world.addChunk(chunk);
        r.gen = 'ready';
        r.needsMesh = true;
        // neighbours' borders may now be meshable/changed
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dz) continue;
            const n = this.records.get(ckey(r.cx + dx, r.cz + dz));
            if (n && n.gen === 'ready') n.needsMesh = true;
          }
        this.onChunkReady?.(chunk);
      },
      () => {
        if (this.records.get(ckey(r.cx, r.cz)) === r && r.gen === 'pending') r.gen = 'none';
      },
    );
  }

  private neighboursReady(cx: number, cz: number): boolean {
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.records.get(ckey(cx + dx, cz + dz));
        if (!n || n.gen !== 'ready') return false;
      }
    return true;
  }

  private scheduleMeshes(): void {
    const maxInflight = Math.max(2, this.pool.size * 2);
    if (this.inflightMeshes >= maxInflight) return;
    const pcx = Math.floor(this.centerX / CHUNK_SIZE);
    const pcz = Math.floor(this.centerZ / CHUNK_SIZE);
    const R = this.renderRadius;
    const candidates: ChunkRecord[] = [];
    for (const r of this.records.values()) {
      if (r.gen !== 'ready' || !r.needsMesh || r.mesh === 'pending') continue;
      const dx = r.cx - pcx, dz = r.cz - pcz;
      if (dx * dx + dz * dz > (R + 0.5) * (R + 0.5)) continue;
      if (!this.neighboursReady(r.cx, r.cz)) continue;
      candidates.push(r);
    }
    candidates.sort((a, b) => this.priority(a.cx, a.cz) - this.priority(b.cx, b.cz));
    const start = performance.now();
    let n = 0;
    for (const r of candidates) {
      if (this.inflightMeshes >= maxInflight || (n > 0 && (n >= 2 || performance.now() - start >= 4))) break;
      this.requestMesh(r);
      n++;
    }
  }

  /** Copy the 3×3 neighbourhood into the padded volume the mesher expects. */
  buildVolume(cx: number, cz: number): { blocks: Uint8Array; meta: Uint8Array; tints: Uint8Array } {
    const blocks = new Uint8Array(PAD * WORLD_HEIGHT * PAD);
    const meta = new Uint8Array(PAD * WORLD_HEIGHT * PAD);
    const S = CHUNK_SIZE;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.world.chunkAt(cx + dx, cz + dz);
        if (!c) continue;
        const ox = OFF + dx * S, oz = OFF + dz * S;
        for (let y = 0; y < WORLD_HEIGHT; y++)
          for (let z = 0; z < S; z++) {
            const src = y * S * S + z * S;
            const dst = (y * PAD + (oz + z)) * PAD + ox;
            blocks.set(c.blocks.subarray(src, src + S), dst);
            meta.set(c.meta.subarray(src, src + S), dst);
          }
      }
    const center = this.world.chunkAt(cx, cz)!;
    return { blocks, meta, tints: center.tints.slice() };
  }

  private requestMesh(r: ChunkRecord) {
    const chunk = this.world.chunkAt(r.cx, r.cz);
    if (!chunk) return;
    r.needsMesh = false;
    r.mesh = 'pending';
    const version = chunk.version;
    const vol = this.buildVolume(r.cx, r.cz);
    this.inflightMeshes++;
    const job = this.pool.run<ChunkMeshResult>(
      { type: 'mesh', blocks: vol.blocks, meta: vol.meta, tints: vol.tints },
      [vol.blocks.buffer, vol.meta.buffer, vol.tints.buffer],
      () => this.priority(r.cx, r.cz) - 2,
    );
    r.cancelMesh = job.cancel;
    job.promise.then(
      (result) => {
        this.inflightMeshes--;
        if (this.disposed || this.records.get(ckey(r.cx, r.cz)) !== r) return;
        this.uploads.push({ key: ckey(r.cx, r.cz), record: r, version, result });
      },
      () => {
        this.inflightMeshes--;
        if (this.records.get(ckey(r.cx, r.cz)) === r) {
          r.mesh = r.group ? 'ready' : 'none';
          r.needsMesh = true;
        }
      },
    );
  }

  /** Upload a few finished meshes per frame to avoid GPU hitches. */
  private processUploads(): void {
    if (!this.uploads.length) return;
    this.uploads.sort((a, b) => this.priority(ckeyX(a.key), ckeyZ(a.key)) - this.priority(ckeyX(b.key), ckeyZ(b.key)));
    const start = performance.now();
    let n = 0;
    while (this.uploads.length && (n === 0 || (n < 2 && performance.now() - start < 4))) {
      const u = this.uploads.shift()!;
      n++;
      const r = this.records.get(u.key);
      if (!r || r !== u.record || r.gen !== 'ready') continue;
      const chunk = this.world.chunkAt(r.cx, r.cz);
      if (!chunk) continue;
      if (chunk.version !== u.version) {
        r.mesh = r.group ? 'ready' : 'none';
        r.needsMesh = true;
        continue;
      }
      this.installMesh(r, u.result);
      r.mesh = 'ready';
      r.meshVersion = u.version;
    }
  }

  private installMesh(r: ChunkRecord, res: ChunkMeshResult) {
    this.disposeGroup(r);
    const g = new THREE.Group();
    g.position.set(r.cx * CHUNK_SIZE, 0, r.cz * CHUNK_SIZE);
    g.name = `chunk ${r.cx},${r.cz}`;
    let tris = 0;
    const solid = terrainGeometry(res.solid);
    if (solid) {
      const m = new THREE.Mesh(solid, this.materials.solid);
      m.matrixAutoUpdate = false;
      g.add(m);
      tris += res.solid.indices.length / 3;
    }
    const cut = terrainGeometry(res.cutout);
    if (cut) {
      const m = new THREE.Mesh(cut, this.materials.cutout);
      m.matrixAutoUpdate = false;
      g.add(m);
      tris += res.cutout.indices.length / 3;
    }
    const glass = terrainGeometry(res.glass);
    if (glass) {
      const m = new THREE.Mesh(glass, this.materials.glass);
      m.matrixAutoUpdate = false;
      m.renderOrder = 1;
      g.add(m);
      tris += res.glass.indices.length / 3;
    }
    const water = waterGeometry(res.water);
    if (water) {
      const m = new THREE.Mesh(water, this.materials.water);
      m.matrixAutoUpdate = false;
      m.renderOrder = 2;
      g.add(m);
      tris += res.water.indices.length / 3;
    }
    g.updateMatrixWorld(true);
    r.group = g;
    r.triangles = tris;
    this.root.add(g);
  }

  private disposeGroup(r: ChunkRecord) {
    if (!r.group) return;
    for (const child of r.group.children) (child as THREE.Mesh).geometry.dispose();
    this.root.remove(r.group);
    r.group = null;
  }

  private unload(k: number, r: ChunkRecord) {
    if (r.gen === 'pending') r.cancelGen?.();
    r.cancelMesh?.();
    this.disposeGroup(r);
    this.records.delete(k);
    this.world.removeChunk(r.cx, r.cz);
    this.onChunkUnloaded?.(r.cx, r.cz);
  }

  /** Is the chunk under (x,z) generated? (physics waits otherwise). */
  isReady(x: number, z: number): boolean {
    const r = this.records.get(ckey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)));
    return !!r && r.gen === 'ready';
  }

  isMeshed(x: number, z: number): boolean {
    const r = this.records.get(ckey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)));
    return !!r && r.mesh === 'ready' && !!r.group;
  }

  /** Fraction of chunks within `radius` of the player that are generated + meshed. */
  readiness(radius: number): number {
    const pcx = Math.floor(this.centerX / CHUNK_SIZE);
    const pcz = Math.floor(this.centerZ / CHUNK_SIZE);
    let total = 0, ready = 0;
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > radius * radius + 0.5) continue;
        total++;
        const r = this.records.get(ckey(pcx + dx, pcz + dz));
        if (r && r.gen === 'ready' && r.mesh === 'ready') ready++;
      }
    return total ? ready / total : 1;
  }

  stats(): { loaded: number; meshed: number; triangles: number; pending: number } {
    let meshed = 0, triangles = 0;
    for (const r of this.records.values()) {
      if (r.group) {
        meshed++;
        triangles += r.triangles;
      }
    }
    return { loaded: this.world.chunks.size, meshed, triangles, pending: this.pool.pending };
  }

  setRenderRadius(r: number): void {
    this.renderRadius = r;
    this.refreshTimer = 0;
  }

  dispose(): void {
    this.disposed = true;
    for (const [k, r] of this.records) {
      r.cancelGen?.();
      r.cancelMesh?.();
      this.disposeGroup(r);
      this.records.delete(k);
    }
    this.uploads = [];
    this.world.onChunkChanged = null;
  }
}

function terrainGeometry(m: MeshArrays): THREE.BufferGeometry | null {
  if (!m.indices.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2));
  g.setAttribute('aData', new THREE.BufferAttribute(m.data, 4));
  g.setAttribute('aColor', new THREE.BufferAttribute(m.colors, 4, true));
  const vcount = m.positions.length / 3;
  g.setIndex(new THREE.BufferAttribute(vcount < 65536 ? new Uint16Array(m.indices) : m.indices, 1));
  g.computeBoundingSphere();
  return g;
}

function waterGeometry(w: WaterArrays): THREE.BufferGeometry | null {
  if (!w.indices.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(w.positions, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(w.colors, 4, true));
  g.setAttribute('aFlow', new THREE.BufferAttribute(w.flow, 3));
  const vcount = w.positions.length / 3;
  g.setIndex(new THREE.BufferAttribute(vcount < 65536 ? new Uint16Array(w.indices) : w.indices, 1));
  g.computeBoundingSphere();
  return g;
}
