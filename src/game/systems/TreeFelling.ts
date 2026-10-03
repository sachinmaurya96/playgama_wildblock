import * as THREE from 'three';
import { B } from '../world/BlockRegistry';
import { isFoliage, isTrunk } from '../world/TreeGenerator';
import { multiBlockGeometry } from '../rendering/BlockGeometry';
import { makeStack } from './InventoryLogic';
import type { Game } from '../Game';

interface FallingTree {
  group: THREE.Group;
  inner: THREE.Mesh;
  axis: THREE.Vector3;
  t: number;
  angle: number;
  omega: number;
  phase: 'shake' | 'fall' | 'settle';
  logs: THREE.Vector3[]; // relative to pivot
  logItems: string[];
  extra: { item: string; count: number }[];
  landed: boolean;
  tint: THREE.Color;
}

/**
 * WildBlocks' signature "Tree Collapse": chopping the lowest log makes the whole
 * tree shake, lean and topple. It is ONE temporary mesh (no per-block physics);
 * when it lands it turns into collectible logs, sticks and seeds.
 */
export class TreeFelling {
  private falling: FallingTree[] = [];
  readonly group = new THREE.Group();

  constructor(private game: Game) {
    this.group.name = 'fallingTrees';
  }

  /**
   * Called after a trunk block at (x,y,z) is broken. If it was the base of a
   * tree, the tree above falls. Returns true when a fall started.
   */
  tryFell(x: number, y: number, z: number, brokenId: number): boolean {
    const w = this.game.world;
    if (!isTrunk(brokenId) || isTrunk(w.get(x, y - 1, z))) return false;
    // Find a trunk block directly above (or diagonally, palms lean)
    const start: [number, number, number][] = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (isTrunk(w.get(x + dx, y + 1, z + dz))) start.push([x + dx, y + 1, z + dz]);
    if (!start.length) return false;

    // BFS logs (26-neighbourhood, never below the cut)
    const logs = new Map<string, [number, number, number, number]>();
    const q = [...start];
    while (q.length && logs.size < 110) {
      const [cx, cy, cz] = q.shift()!;
      const k = `${cx},${cy},${cz}`;
      if (logs.has(k)) continue;
      const id = w.get(cx, cy, cz);
      if (!isTrunk(id) || cy <= y) continue;
      logs.set(k, [cx, cy, cz, id]);
      for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (dx || dy || dz) q.push([cx + dx, cy + dy, cz + dz]);
    }
    if (logs.size > 100) return false; // giant structure (e.g. hollow tree landmark) — don't fell

    // Foliage attached to those logs (within 4 blocks of a log)
    const leaves = new Map<string, [number, number, number, number]>();
    const lq: [number, number, number][] = [];
    for (const [lx, ly, lz] of logs.values())
      for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) lq.push([lx + dx, ly + dy, lz + dz]);
    const near = (px: number, py: number, pz: number) => {
      for (const [lx, ly, lz] of logs.values()) if (Math.abs(px - lx) <= 4 && Math.abs(py - ly) <= 4 && Math.abs(pz - lz) <= 4) return true;
      return false;
    };
    while (lq.length && leaves.size < 420) {
      const [cx, cy, cz] = lq.pop()!;
      const k = `${cx},${cy},${cz}`;
      if (leaves.has(k) || logs.has(k)) continue;
      const id = w.get(cx, cy, cz);
      if (!isFoliage(id) || !near(cx, cy, cz)) continue;
      leaves.set(k, [cx, cy, cz, id]);
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) lq.push([cx + dx, cy + dy, cz + dz]);
    }

    // Player-built log pillars have no canopy: only real trees collapse.
    if (leaves.size < 4) return false;

    // Remove from the world in one batch (single remesh per chunk)
    w.beginBatch();
    for (const [bx, by, bz] of logs.values()) w.set(bx, by, bz, 0);
    for (const [bx, by, bz] of leaves.values()) w.set(bx, by, bz, 0);
    w.endBatch();

    // Build the temporary falling object
    const pivot = new THREE.Vector3(x + 0.5, y + 1, z + 0.5);
    const blocks = [...logs.values(), ...leaves.values()].map(([bx, by, bz, id]) => ({ x: bx - pivot.x, y: by - pivot.y, z: bz - pivot.z, id }));
    const chunk = w.chunkAt(Math.floor(x / 16), Math.floor(z / 16));
    const ti = chunk ? ((((z % 16) + 16) % 16) * 16 + (((x % 16) + 16) % 16)) * 9 + 3 : -1;
    const tint = chunk ? [chunk.tints[ti], chunk.tints[ti + 1], chunk.tints[ti + 2]] : [110, 170, 80];
    const geo = multiBlockGeometry(blocks, tint);
    const inner = new THREE.Mesh(geo, this.game.assets.materials.cutout);
    const group = new THREE.Group();
    group.position.copy(pivot);
    group.add(inner);
    this.group.add(group);

    // Fall away from the player
    const pp = this.game.player.position;
    let dx = pivot.x - pp.x, dz = pivot.z - pp.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const axis = new THREE.Vector3(dz, 0, -dx).normalize();

    const logItems = [...logs.values()].map(([, , , id]) => (id === B.BIRCH_LOG ? 'birch_log' : 'log'));
    const extra: { item: string; count: number }[] = [];
    const fol = new Map<number, number>();
    for (const [, , , id] of leaves.values()) fol.set(id, (fol.get(id) ?? 0) + 1);
    const n = leaves.size;
    if (n > 0) {
      extra.push({ item: 'stick', count: 1 + Math.floor(Math.random() * 3) });
      extra.push({ item: 'sapling', count: Math.random() < 0.8 ? 1 + (Math.random() < 0.35 ? 1 : 0) : 0 });
      if (fol.has(B.BLOSSOM_LEAVES)) extra.push({ item: 'sunapple', count: 2 + Math.floor(Math.random() * 3) });
      if (fol.has(B.PALM_FRONDS)) extra.push({ item: 'coconut', count: 1 + Math.floor(Math.random() * 2) });
      if (fol.has(B.LEAVES) && Math.random() < 0.3) extra.push({ item: 'sunapple', count: 1 });
    }
    this.falling.push({
      group, inner, axis, t: 0, angle: 0, omega: 0, phase: 'shake',
      logs: [...logs.values()].map(([bx, by, bz]) => new THREE.Vector3(bx + 0.5 - pivot.x, by + 0.5 - pivot.y, bz + 0.5 - pivot.z)),
      logItems, extra, landed: false, tint: new THREE.Color(tint[0] / 255, tint[1] / 255, tint[2] / 255),
    });
    this.game.audio.play('creak', { pos: pivot });
    this.game.bus.emit('treeFelled', { x, y, z, logs: logs.size + 1 });
    return true;
  }

  update(dt: number): void {
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.t += dt;
      if (f.phase === 'shake') {
        const k = f.t / 0.55;
        f.inner.rotation.set(Math.sin(f.t * 60) * 0.02 * k, 0, Math.cos(f.t * 55) * 0.02 * k);
        if (f.t > 0.55) {
          f.phase = 'fall';
          f.inner.rotation.set(0, 0, 0);
          f.t = 0;
        }
      } else if (f.phase === 'fall') {
        f.omega += (1.2 + 6 * Math.sin(Math.max(0.05, f.angle))) * dt;
        f.angle += f.omega * dt;
        if (f.angle >= 1.45) {
          f.angle = 1.45;
          f.phase = 'settle';
          f.t = 0;
          this.land(f);
        }
        f.group.quaternion.setFromAxisAngle(f.axis, f.angle);
      } else {
        // small bounce then sink/fade away
        const bounce = Math.sin(Math.min(1, f.t / 0.35) * Math.PI) * 0.08;
        f.group.quaternion.setFromAxisAngle(f.axis, 1.45 - bounce);
        if (f.t > 0.7) {
          const s = Math.max(0.001, 1 - (f.t - 0.7) / 0.35);
          f.group.scale.setScalar(s);
        }
        if (f.t > 1.05) {
          this.group.remove(f.group);
          f.inner.geometry.dispose();
          this.falling.splice(i, 1);
        }
      }
    }
  }

  private land(f: FallingTree) {
    const g = this.game;
    g.audio.play('thud', { pos: f.group.position });
    g.player.shake = Math.min(1, g.player.shake + 0.35);
    const q = new THREE.Quaternion().setFromAxisAngle(f.axis, 1.45);
    // logs become drops where they landed
    const pts = f.logs.map((v) => v.clone().applyQuaternion(q).add(f.group.position));
    const counts = new Map<string, number>();
    for (const it of f.logItems) counts.set(it, (counts.get(it) ?? 0) + 1);
    let idx = 0;
    for (const [item, count] of counts) {
      let left = count;
      while (left > 0) {
        const n = Math.min(left, 2);
        const p = pts[Math.min(pts.length - 1, idx++ * 2)] ?? f.group.position;
        const gy = g.world.standableY(Math.floor(p.x), Math.floor(p.z)) + 1.2;
        g.drops.spawn(makeStack(item, n), p.x, Math.max(gy, Math.min(p.y, gy + 2)), p.z, 0.5);
        left -= n;
      }
    }
    const tip = pts[pts.length - 1] ?? f.group.position;
    for (const e of f.extra) {
      if (e.count <= 0) continue;
      const gy = g.world.standableY(Math.floor(tip.x), Math.floor(tip.z)) + 1.2;
      g.drops.spawn(makeStack(e.item, e.count), tip.x, gy, tip.z, 0.8);
    }
    // leaf burst + dust along the trunk
    for (let k = 0; k < pts.length; k += 2) g.particles.emit('dust', pts[k].x, pts[k].y, pts[k].z, 3, [0.6, 0.5, 0.4], { spread: 0.8, speed: 1.5, size: 0.18, life: 1 });
    g.particles.emit('leaf', tip.x, tip.y + 1, tip.z, 24, [f.tint.r * 0.9, f.tint.g * 0.9, f.tint.b * 0.8], { spread: 3, speed: 2.5, size: 0.14, life: 2.4 });
  }

  clear(): void {
    for (const f of this.falling) {
      this.group.remove(f.group);
      f.inner.geometry.dispose();
    }
    this.falling = [];
  }
}
