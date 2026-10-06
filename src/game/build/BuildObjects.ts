import * as THREE from 'three';
import { defaultVariant, objectDef, type ObjAnim, type ObjectDef, type V3 } from '../../data/furniture';
import type { BuildObjectSave } from '../../persistence/types';
import { SKYBLOCK } from '../world/BlockRegistry';
import { WORLD_HEIGHT } from '../world/constants';
import type { World } from '../world/World';
import { objectGeometry, type ObjectMaterials } from './ObjectGeometry';

/**
 * Placed Build Home objects: storage, instanced rendering, collision,
 * animation (doors, drawers, water), lighting data and raycasting.
 *
 * Objects are plain data (BuildObjectSave) — position, rotation, variant and a
 * small state — never three.js objects, so saving, undo and blueprints just
 * copy JSON. Rendering groups identical (model, variant, part) geometry into
 * one InstancedMesh each.
 */

export interface PlacedObject extends BuildObjectSave {
  def: ObjectDef;
  /** Animated open amount 0..1 (eases toward state.open). */
  openAmt: number;
  /** 0..1 sky exposure and block light (sampled from the voxel world). */
  sky: number;
  bl: number;
}

export interface ObjectHit {
  obj: PlacedObject;
  dist: number;
  point: THREE.Vector3;
  /** World-space face normal of the hit. */
  normal: THREE.Vector3;
}

type PartKind = 'solid' | 'glass' | 'emissive';

class Bucket {
  mesh: THREE.InstancedMesh;
  ids: number[] = [];
  index = new Map<number, number>();
  constructor(readonly key: string, readonly geo: THREE.BufferGeometry, readonly mat: THREE.Material, readonly kind: PartKind, readonly anim: string, private parent: THREE.Object3D, cap = 8) {
    this.mesh = this.make(cap);
  }
  private make(cap: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(this.geo, this.mat, cap);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    m.count = 0;
    m.frustumCulled = true;
    if (this.kind === 'glass') m.renderOrder = 2;
    this.parent.add(m);
    return m;
  }
  add(id: number, matrix: THREE.Matrix4, color: THREE.Color): void {
    if (this.ids.length >= this.mesh.instanceMatrix.count) {
      const old = this.mesh;
      const cap = old.instanceMatrix.count * 2;
      this.mesh = this.make(cap);
      (this.mesh.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array as Float32Array);
      (this.mesh.instanceColor!.array as Float32Array).set(old.instanceColor!.array as Float32Array);
      this.parent.remove(old);
      old.dispose();
    }
    const i = this.ids.length;
    this.ids.push(id);
    this.index.set(id, i);
    this.mesh.count = this.ids.length;
    this.mesh.setMatrixAt(i, matrix);
    this.mesh.setColorAt(i, color);
    this.dirty();
  }
  remove(id: number): void {
    const i = this.index.get(id);
    if (i === undefined) return;
    const last = this.ids.length - 1;
    if (i !== last) {
      const lastId = this.ids[last];
      const m = new THREE.Matrix4();
      const c = new THREE.Color();
      this.mesh.getMatrixAt(last, m);
      this.mesh.getColorAt(last, c);
      this.mesh.setMatrixAt(i, m);
      this.mesh.setColorAt(i, c);
      this.ids[i] = lastId;
      this.index.set(lastId, i);
    }
    this.ids.pop();
    this.index.delete(id);
    this.mesh.count = this.ids.length;
    this.dirty();
  }
  setMatrix(id: number, matrix: THREE.Matrix4): void {
    const i = this.index.get(id);
    if (i === undefined) return;
    this.mesh.setMatrixAt(i, matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.boundsDirty = true;
  }
  setColor(id: number, c: THREE.Color): void {
    const i = this.index.get(id);
    if (i === undefined) return;
    this.mesh.setColorAt(i, c);
    this.mesh.instanceColor!.needsUpdate = true;
  }
  boundsDirty = true;
  dirty() {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.boundsDirty = true;
  }
  refreshBounds() {
    if (!this.boundsDirty) return;
    this.boundsDirty = false;
    if (this.mesh.count > 0) this.mesh.computeBoundingSphere();
  }
  dispose() {
    this.parent.remove(this.mesh);
    this.mesh.dispose();
  }
}

const tmpM = new THREE.Matrix4();
const tmpM2 = new THREE.Matrix4();
const tmpC = new THREE.Color();
const CELL = 4;

function cellKey(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}

/** One Build Home object change, as sent to friends building on the same lot. */
export type ObjectOp = { k: 'add'; o: BuildObjectSave } | { k: 'del'; id: number } | { k: 'set'; id: number; p: Partial<BuildObjectSave> };

export class BuildObjects {
  readonly group = new THREE.Group();
  readonly objects = new Map<number, PlacedObject>();
  nextId = 1;
  /** Changes to object occupancy, including remote edits and undo/redo. */
  revision = 0;
  private buckets = new Map<string, Bucket>();
  private objBuckets = new Map<number, Bucket[]>();
  private grid = new Map<number, Set<number>>();
  private objCells = new Map<number, number[]>();
  private animating = new Set<number>();
  private boxCache = new Map<number, number[]>();
  /** Voxel light sources near the player (x, y, z, level) for object block light. */
  voxelLights: { x: number; y: number; z: number; l: number }[] = [];
  private lightTimer = 0;
  private lightIterator: MapIterator<PlacedObject> | null = null;
  labels = new THREE.Group();
  private labelSprites = new Map<number, THREE.Sprite>();
  onChanged: (() => void) | null = null;

  constructor(private world: World, private mats: ObjectMaterials) {
    this.group.name = 'build-objects';
    this.group.add(this.labels);
    world.objectColliders = (minX, minY, minZ, maxX, maxY, maxZ, out) => this.collect(minX, minY, minZ, maxX, maxY, maxZ, out);
  }

  // ---------------------------------------------------------------- CRUD

  /** Build Home with friends: told about every change made here (not the ones applied while `remote` is set). */
  onOp: ((op: ObjectOp) => void) | null = null;
  /** Applying a friend's change: don't report it back. */
  remote = false;

  add(save: Omit<BuildObjectSave, 'id'> & { id?: number }): PlacedObject | null {
    const def = objectDef(save.itemId);
    if (!def) {
      console.error(`[BuildObjects] unknown object model "${save.itemId}" — not placed`);
      return null;
    }
    const id = save.id ?? this.nextId++;
    if (id >= this.nextId) this.nextId = id + 1;
    const o: PlacedObject = {
      id, itemId: save.itemId, x: save.x, y: save.y, z: save.z, rotation: save.rotation,
      variantId: def.variants?.some((v) => v.id === save.variantId) ? save.variantId : defaultVariant(def),
      state: save.state ? { ...save.state } : defaultState(def), def, openAmt: save.state?.open ? 1 : 0, sky: 1, bl: 0,
    };
    this.objects.set(id, o);
    this.sampleLight(o);
    this.attach(o);
    this.index(o);
    if (def.interaction === 'label') this.updateLabel(o);
    this.revision++;
    this.onChanged?.();
    if (!this.remote) this.onOp?.({ k: 'add', o: toSave(o) });
    return o;
  }

  remove(id: number): PlacedObject | null {
    const o = this.objects.get(id);
    if (!o) return null;
    this.detach(o);
    this.unindex(o);
    this.objects.delete(id);
    this.animating.delete(id);
    const s = this.labelSprites.get(id);
    if (s) {
      this.labels.remove(s);
      (s.material as THREE.SpriteMaterial).map?.dispose();
      s.material.dispose();
      this.labelSprites.delete(id);
    }
    this.revision++;
    this.onChanged?.();
    if (!this.remote) this.onOp?.({ k: 'del', id });
    return o;
  }

  /** Update position / rotation / variant / state (re-instances when the variant changes). */
  patch(id: number, patch: Partial<BuildObjectSave>): PlacedObject | null {
    const o = this.objects.get(id);
    if (!o) return null;
    const variantChanged = patch.variantId !== undefined && patch.variantId !== o.variantId;
    const moved = patch.x !== undefined || patch.y !== undefined || patch.z !== undefined || patch.rotation !== undefined;
    if (variantChanged) this.detach(o);
    if (moved) this.unindex(o);
    Object.assign(o, patch);
    if (patch.state) o.state = { ...patch.state };
    if (variantChanged) this.attach(o);
    if (moved) {
      this.index(o);
      this.sampleLight(o);
      this.writeMatrices(o);
      this.writeColors(o);
    }
    if (patch.state) {
      this.animating.add(o.id);
      this.writeColors(o);
    }
    this.boxCache.delete(id);
    if (o.def.interaction === 'label') this.updateLabel(o);
    this.revision++;
    this.onChanged?.();
    if (!this.remote) this.onOp?.({ k: 'set', id, p: { ...patch } });
    return o;
  }

  get(id: number): PlacedObject | undefined {
    return this.objects.get(id);
  }

  clear(): void {
    for (const id of [...this.objects.keys()]) this.remove(id);
    for (const b of this.buckets.values()) b.dispose();
    this.buckets.clear();
  }

  serialize(): BuildObjectSave[] {
    return [...this.objects.values()].map(toSave);
  }

  load(list: BuildObjectSave[], nextId: number): void {
    this.clear();
    for (const s of list) this.add(s);
    this.nextId = Math.max(this.nextId, nextId);
  }

  // ---------------------------------------------------------------- rendering

  private bucketFor(key: string, geo: THREE.BufferGeometry, kind: PartKind, anim: string): Bucket {
    let b = this.buckets.get(key);
    if (!b) {
      const mat = kind === 'glass' ? this.mats.glass : kind === 'emissive' ? this.mats.emissive : this.mats.solid;
      b = new Bucket(key, geo, mat, kind, anim, this.group);
      this.buckets.set(key, b);
    }
    return b;
  }

  private attach(o: PlacedObject) {
    const geo = objectGeometry(o.def, o.variantId);
    const list: Bucket[] = [];
    for (const [anim, grp] of geo.groups) {
      for (const kind of ['solid', 'glass', 'emissive'] as PartKind[]) {
        const g = grp[kind];
        if (!g) continue;
        const b = this.bucketFor(`${o.def.id}|${o.variantId}|${anim}|${kind}`, g, kind, anim);
        b.add(o.id, this.partMatrix(o, anim, tmpM2), this.instColor(o, kind));
        list.push(b);
      }
    }
    this.objBuckets.set(o.id, list);
  }

  private detach(o: PlacedObject) {
    for (const b of this.objBuckets.get(o.id) ?? []) b.remove(o.id);
    this.objBuckets.delete(o.id);
  }

  objectMatrix(o: { x: number; y: number; z: number; rotation: number }, out = new THREE.Matrix4()): THREE.Matrix4 {
    return out.makeRotationY(o.rotation).setPosition(o.x, o.y, o.z);
  }

  private partMatrix(o: PlacedObject, anim: string, out: THREE.Matrix4): THREE.Matrix4 {
    this.objectMatrix(o, out);
    if (!anim) return out;
    const a = o.def.anims?.find((x) => x.name === anim);
    if (!a) return out;
    if (anim === 'water') {
      // running water only exists while switched on
      if (!o.state?.on) out.multiply(tmpM.makeScale(0.0001, 0.0001, 0.0001));
      return out;
    }
    return out.multiply(animMatrix(a, o.openAmt, tmpM));
  }

  private instColor(o: PlacedObject, kind: PartKind): THREE.Color {
    const on = o.state?.on ? 1 : 0;
    return tmpC.setRGB(o.sky, o.bl, kind === 'emissive' ? on : 0);
  }

  private writeMatrices(o: PlacedObject) {
    for (const b of this.objBuckets.get(o.id) ?? []) b.setMatrix(o.id, this.partMatrix(o, b.anim, tmpM2));
  }

  private writeColors(o: PlacedObject) {
    for (const b of this.objBuckets.get(o.id) ?? []) b.setColor(o.id, this.instColor(o, b.kind));
  }

  // ---------------------------------------------------------------- spatial index / collision

  private cellsOf(o: PlacedObject): number[] {
    const [a, b] = this.bounds(o);
    const out: number[] = [];
    for (let cz = Math.floor(a[2] / CELL); cz <= Math.floor(b[2] / CELL); cz++)
      for (let cx = Math.floor(a[0] / CELL); cx <= Math.floor(b[0] / CELL); cx++) out.push(cellKey(cx, cz));
    return out;
  }

  private index(o: PlacedObject) {
    const cells = this.cellsOf(o);
    this.objCells.set(o.id, cells);
    for (const k of cells) {
      let s = this.grid.get(k);
      if (!s) {
        s = new Set();
        this.grid.set(k, s);
      }
      s.add(o.id);
    }
  }

  private unindex(o: PlacedObject) {
    for (const k of this.objCells.get(o.id) ?? []) {
      const cell = this.grid.get(k);
      if (cell) {
        cell.delete(o.id);
        if (!cell.size) this.grid.delete(k);
      }
    }
    this.objCells.delete(o.id);
    this.boxCache.delete(o.id);
  }

  /** World-space AABB of an object (rotated footprint). */
  bounds(o: { def: ObjectDef; x: number; y: number; z: number; rotation: number }): [V3, V3] {
    const [a, b] = localBounds(o.def);
    return rotatedAabb(a, b, o);
  }

  /** Objects whose bounds overlap a world AABB. */
  query(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): PlacedObject[] {
    const seen = new Set<number>();
    const out: PlacedObject[] = [];
    for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++)
      for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
        const s = this.grid.get(cellKey(cx, cz));
        if (!s) continue;
        for (const id of s) {
          if (seen.has(id)) continue;
          seen.add(id);
          const o = this.objects.get(id)!;
          const [a, b] = this.bounds(o);
          if (b[0] > minX && a[0] < maxX && b[1] > minY && a[1] < maxY && b[2] > minZ && a[2] < maxZ) out.push(o);
        }
      }
    return out;
  }

  /** Collision boxes (world space, 6 numbers each) for an object. */
  collisionBoxes(o: PlacedObject): number[] {
    const hit = this.boxCache.get(o.id);
    if (hit) return hit;
    const def = o.def;
    const out: number[] = [];
    const push = (a: V3, b: V3) => {
      const [p, q] = rotatedAabb(a, b, o);
      out.push(p[0], p[1], p[2], q[0], q[1], q[2]);
    };
    const [w, h] = def.size;
    const [la, lb] = localBounds(def);
    if (def.collision === 'none') { /* decor */ } else if (Array.isArray(def.collision)) {
      for (const [a, b] of def.collision) push(a, b);
    } else push(la, [lb[0], Math.max(lb[1], 0.1), lb[2]]);
    // closed doors / gates block the doorway
    if (def.interaction === 'door' && !o.state?.open && (def.placement === 'opening' || def.id === 'garden_gate')) push([-w / 2, 0, -0.05], [w / 2, h, 0.05]);
    this.boxCache.set(o.id, out);
    return out;
  }

  private collect(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, out: number[]) {
    if (!this.objects.size) return;
    for (const o of this.query(minX - 0.01, minY - 0.01, minZ - 0.01, maxX + 0.01, maxY + 0.01, maxZ + 0.01)) {
      const boxes = this.collisionBoxes(o);
      for (let i = 0; i < boxes.length; i += 6) {
        if (boxes[i + 3] > minX && boxes[i] < maxX && boxes[i + 4] > minY && boxes[i + 1] < maxY && boxes[i + 5] > minZ && boxes[i + 2] < maxZ) {
          out.push(boxes[i], boxes[i + 1], boxes[i + 2], boxes[i + 3], boxes[i + 4], boxes[i + 5]);
        }
      }
    }
  }

  /** Nearest object along a ray (oriented-box test in object space). */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, filter?: (o: PlacedObject) => boolean): ObjectHit | null {
    let best: ObjectHit | null = null;
    const end = origin.clone().addScaledVector(dir, maxDist);
    const cand = this.query(Math.min(origin.x, end.x) - 3, Math.min(origin.y, end.y) - 3, Math.min(origin.z, end.z) - 3, Math.max(origin.x, end.x) + 3, Math.max(origin.y, end.y) + 3, Math.max(origin.z, end.z) + 3);
    for (const o of cand) {
      if (filter && !filter(o)) continue;
      const [la, lb] = localBounds(o.def);
      const c = Math.cos(-o.rotation), s = Math.sin(-o.rotation);
      const ox = origin.x - o.x, oy = origin.y - o.y, oz = origin.z - o.z;
      const lo = [ox * c + oz * s, oy, -ox * s + oz * c];
      const ld = [dir.x * c + dir.z * s, dir.y, -dir.x * s + dir.z * c];
      const minB = [la[0], la[1], la[2]], maxB = [lb[0], Math.max(lb[1], la[1] + 0.08), lb[2]];
      // thin things (rugs, frames) stay clickable
      for (let k = 0; k < 3; k++) if (maxB[k] - minB[k] < 0.08) {
        const mid = (maxB[k] + minB[k]) / 2;
        minB[k] = mid - 0.04;
        maxB[k] = mid + 0.04;
      }
      let t0 = -Infinity, t1 = Infinity, axis = 0, sign = 0;
      let miss = false;
      for (let k = 0; k < 3; k++) {
        if (Math.abs(ld[k]) < 1e-9) {
          if (lo[k] < minB[k] || lo[k] > maxB[k]) miss = true;
          continue;
        }
        let a = (minB[k] - lo[k]) / ld[k], b = (maxB[k] - lo[k]) / ld[k];
        let sg = -1;
        if (a > b) {
          const t = a; a = b; b = t; sg = 1;
        }
        if (a > t0) {
          t0 = a;
          axis = k;
          sign = sg;
        }
        t1 = Math.min(t1, b);
      }
      if (miss || t0 > t1 || t1 < 0 || t0 > maxDist) continue;
      const t = Math.max(0, t0);
      if (best && best.dist <= t) continue;
      const ln = [0, 0, 0];
      ln[axis] = sign;
      // local normal → world
      const cw = Math.cos(o.rotation), sw = Math.sin(o.rotation);
      const normal = new THREE.Vector3(ln[0] * cw + ln[2] * sw, ln[1], -ln[0] * sw + ln[2] * cw);
      best = { obj: o, dist: t, point: origin.clone().addScaledVector(dir, t), normal };
    }
    return best;
  }

  // ---------------------------------------------------------------- lighting & animation

  /** Sky exposure (same curve as the terrain mesher) + nearby voxel light. */
  sampleLight(o: PlacedObject) {
    const x = Math.floor(o.x), z = Math.floor(o.z);
    const y = Math.floor(o.y + Math.min(1, o.def.size[1] * 0.5));
    let top = -1;
    for (let yy = Math.min(WORLD_HEIGHT - 1, this.world.surfaceY(x, z) + 1); yy >= 0; yy--) {
      if (SKYBLOCK[this.world.get(x, yy, z)]) {
        top = yy;
        break;
      }
    }
    const sky = y > top ? 1 : Math.max(18, 255 * (1 - (top - y) * 0.1)) / 255;
    let bl = 0;
    for (const l of this.voxelLights) {
      const v = l.l - (Math.abs(l.x - x) + Math.abs(l.y - y) + Math.abs(l.z - z));
      if (v > bl) bl = v;
    }
    o.sky = sky;
    o.bl = bl / 15;
  }

  /** Re-sample lighting after edits near a position (roofs added / removed). */
  relightNear(x: number, z: number, radius = 18) {
    for (const o of this.query(x - radius, -1, z - radius, x + radius, 200, z + radius)) {
      this.sampleLight(o);
      this.writeColors(o);
    }
  }

  tick(dt: number, px: number, pz: number) {
    // eased open/close animation
    for (const id of this.animating) {
      const o = this.objects.get(id);
      if (!o) {
        this.animating.delete(id);
        continue;
      }
      const target = o.state?.open ? 1 : 0;
      const step = dt * (o.def.id === 'garage_door' ? 0.9 : 3.2);
      o.openAmt = o.openAmt < target ? Math.min(target, o.openAmt + step) : Math.max(target, o.openAmt - step);
      this.writeMatrices(o);
      if (o.openAmt === target) this.animating.delete(id);
    }
    // relight a few objects per frame near the player
    this.lightTimer -= dt;
    if (this.lightTimer <= 0 && this.objects.size) {
      this.lightTimer = 0.05;
      for (let k = 0; k < 24 && k < this.objects.size; k++) {
        this.lightIterator ??= this.objects.values();
        let next = this.lightIterator.next();
        if (next.done) {
          this.lightIterator = this.objects.values();
          next = this.lightIterator.next();
        }
        if (next.done) break;
        const o = next.value;
        if (Math.abs(o.x - px) > 64 || Math.abs(o.z - pz) > 64) continue;
        const sky = o.sky, bl = o.bl;
        this.sampleLight(o);
        if (sky !== o.sky || bl !== o.bl) this.writeColors(o);
      }
    }
    for (const b of this.buckets.values()) b.refreshBounds();
  }

  // ---------------------------------------------------------------- labels

  private updateLabel(o: PlacedObject) {
    let s = this.labelSprites.get(o.id);
    const text = o.state?.text || 'Room';
    if (!s) {
      s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: true, depthWrite: false }));
      s.renderOrder = 8;
      this.labels.add(s);
      this.labelSprites.set(o.id, s);
    }
    const mat = s.material as THREE.SpriteMaterial;
    mat.map?.dispose();
    mat.map = labelTexture(text);
    mat.needsUpdate = true;
    s.position.set(o.x, o.y + 1.6, o.z);
    s.scale.set(Math.max(1.2, text.length * 0.22), 0.45, 1);
  }

  setLabelsVisible(v: boolean) {
    this.labels.visible = v;
  }

  stats(): { objects: number; buckets: number; triangles: number } {
    let tris = 0;
    for (const b of this.buckets.values()) tris += ((b.geo.index?.count ?? 0) / 3) * b.mesh.count;
    return { objects: this.objects.size, buckets: this.buckets.size, triangles: tris };
  }

  dispose() {
    this.clear();
    this.world.objectColliders = null;
  }
}

function defaultState(def: ObjectDef): BuildObjectSave['state'] {
  if (def.interaction === 'light') return { on: true };
  if (def.interaction === 'label') return { text: 'Living Room' };
  return undefined;
}

/** Local-space bounds of a model (footprint box unless the model overrides it). */
export function localBounds(def: ObjectDef): [V3, V3] {
  if (def.bounds) return def.bounds;
  const [w, h, d] = def.size;
  return [[-w / 2, 0, -d / 2], [w / 2, h, d / 2]];
}

export function toSave(o: PlacedObject): BuildObjectSave {
  const s: BuildObjectSave = { id: o.id, itemId: o.itemId, x: o.x, y: o.y, z: o.z, rotation: o.rotation, variantId: o.variantId };
  if (o.state && Object.keys(o.state).length) s.state = { ...o.state };
  return s;
}

// Scratch matrices private to animMatrix. (It used to borrow tmpM2 — the very matrix
// partMatrix() passes in as the object's world transform — so every swinging door
// leaf lost its position and rendered at the world origin, under the ground.)
const animRot = new THREE.Matrix4();
const animBack = new THREE.Matrix4();

export function animMatrix(a: ObjAnim, t: number, out: THREE.Matrix4): THREE.Matrix4 {
  const [px, py, pz] = a.pivot;
  switch (a.type) {
    case 'swing':
      return out.makeTranslation(px, py, pz).multiply(animRot.makeRotationY(a.amount * t)).multiply(animBack.makeTranslation(-px, -py, -pz));
    case 'tilt':
      return out.makeTranslation(px, py, pz).multiply(animRot.makeRotationX(a.amount * t)).multiply(animBack.makeTranslation(-px, -py, -pz));
    case 'slide':
      return out.makeTranslation(a.amount * t, 0, 0);
    case 'lift':
      return out.makeTranslation(0, a.amount * t, 0);
  }
}

/** AABB of a local box after yaw rotation + translation. */
export function rotatedAabb(a: V3, b: V3, o: { x: number; y: number; z: number; rotation: number }): [V3, V3] {
  const c = Math.cos(o.rotation), s = Math.sin(o.rotation);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const lx of [a[0], b[0]])
    for (const lz of [a[2], b[2]]) {
      const wx = lx * c + lz * s, wz = -lx * s + lz * c;
      x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); z0 = Math.min(z0, wz); z1 = Math.max(z1, wz);
    }
  const r = (v: number) => Math.round(v * 1e5) / 1e5;
  return [[r(o.x + x0), o.y + a[1], r(o.z + z0)], [r(o.x + x1), o.y + b[1], r(o.z + z1)]];
}

function labelTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(40,30,20,0.72)';
  const r = 18;
  g.beginPath();
  g.moveTo(r, 4); g.lineTo(252 - r, 4); g.quadraticCurveTo(252, 4, 252, 4 + r); g.lineTo(252, 60 - r); g.quadraticCurveTo(252, 60, 252 - r, 60);
  g.lineTo(r, 60); g.quadraticCurveTo(4, 60, 4, 60 - r); g.lineTo(4, 4 + r); g.quadraticCurveTo(4, 4, r, 4);
  g.fill();
  g.fillStyle = '#fff6e0';
  g.font = 'bold 30px Trebuchet MS, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text.slice(0, 18), 128, 33);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
