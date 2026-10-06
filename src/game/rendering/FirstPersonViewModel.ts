import * as THREE from 'three';
import { itemDef } from '../../data/items';
import { blockId, SHAPE } from '../world/BlockRegistry';
import { blockObject } from './BlockGeometry';
import { buildToolMesh, part } from './Models';
import type { AssetManager } from '../core/AssetManager';
import { Spring } from '../core/Spring';

/**
 * First-person arm + held item, rendered in its own pass after the world
 * (depth cleared), so it never clips into walls.
 *
 * Hierarchy (all in view-camera space, the camera never moves):
 *
 *   camera
 *     root          ← bob, look-sway, jump/land offset, equip dip (springs)
 *       shoulder    ← action pose (keyframed rotation/translation about the shoulder)
 *         arm       ← sleeve + fist, oriented once along the shoulder→hand vector
 *           grip    ← per-item-category held transform
 *
 * Nothing is ever accumulated frame to frame: every transform is rebuilt from
 * (rest pose + springs + action curve), and action curves start and end at
 * exactly zero, so the hand always returns to its resting transform.
 */

export type HandAction = 'mine' | 'chop' | 'attack' | 'place' | 'interact' | 'eat';

interface Pose {
  px?: number; py?: number; pz?: number;
  rx?: number; ry?: number; rz?: number;
}

interface ActionDef {
  duration: number;
  keys: [number, Pose][];
  /** Extra per-frame wiggle (chewing). */
  wiggle?: number;
}

/** Keyframes over normalised time 0..1. First and last keys are the rest pose. */
const ACTIONS: Record<HandAction, ActionDef> = {
  // short forward/down arc
  mine: { duration: 0.3, keys: [[0, {}], [0.28, { rx: 0.2, pz: 0.02 }], [0.58, { rx: -0.36, py: -0.02, pz: -0.05 }], [1, {}]] },
  // diagonal swing from upper right to lower left
  chop: { duration: 0.36, keys: [[0, {}], [0.3, { rx: 0.28, rz: -0.22, ry: -0.08 }], [0.62, { rx: -0.34, rz: 0.24, ry: 0.2, pz: -0.05 }], [1, {}]] },
  // quick forward arc
  attack: { duration: 0.3, keys: [[0, {}], [0.2, { ry: -0.14, pz: 0.03 }], [0.46, { ry: 0.42, rx: -0.18, pz: -0.13 }], [1, {}]] },
  // small push
  place: { duration: 0.22, keys: [[0, {}], [0.4, { pz: -0.085, rx: -0.07 }], [1, {}]] },
  // tiny reach
  interact: { duration: 0.26, keys: [[0, {}], [0.42, { pz: -0.05, rx: 0.06, ry: 0.04 }], [1, {}]] },
  // bring food to the mouth and chew
  eat: { duration: 0.9, keys: [[0, {}], [0.22, { px: -0.12, py: 0.07, pz: 0.04, ry: 0.32, rx: 0.2 }], [0.78, { px: -0.12, py: 0.07, pz: 0.04, ry: 0.32, rx: 0.2 }], [1, {}]], wiggle: 0.01 },
};

type HeldCategory = 'none' | 'block' | 'flat' | 'tool' | 'long' | 'light' | 'sprite';

/** Where an item sits in the fist, per category (hand-local space: -Z along the forearm, +Y up). */
const HELD_TRANSFORM: Record<Exclude<HeldCategory, 'none'>, { pos: [number, number, number]; rot: [number, number, number]; scale: number }> = {
  block: { pos: [0.01, 0.09, -0.1], rot: [0.28, 0.72, 0.06], scale: 0.22 },
  flat: { pos: [0, 0.12, -0.08], rot: [0, 0.4, 0], scale: 0.34 },
  tool: { pos: [0, 0.03, -0.05], rot: [-0.78, -1.1, 0.15], scale: 0.5 },
  long: { pos: [0, 0.03, -0.05], rot: [-0.55, -1.2, 0.1], scale: 0.5 },
  light: { pos: [0, 0.1, -0.06], rot: [-0.25, 0.5, 0], scale: 0.42 },
  sprite: { pos: [0, 0.11, -0.08], rot: [0, 0, 0], scale: 0.2 },
};

/** Grip point along the tool handle (tool-local Y). */
const GRIP_Y = -0.18;

const REST_SHOULDER = new THREE.Vector3(0.46, -0.56, -0.1);
const REST_HAND = new THREE.Vector3(0.36, -0.28, -0.6);

function smooth01(t: number): number {
  return t * t * (3 - 2 * t);
}

function sampleAction(def: ActionDef, t: number, out: Required<Pose>): void {
  out.px = out.py = out.pz = out.rx = out.ry = out.rz = 0;
  const keys = def.keys;
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const [t0, a] = keys[i];
  const [t1, b] = keys[i + 1];
  const k = smooth01(Math.min(1, Math.max(0, (t - t0) / Math.max(1e-6, t1 - t0))));
  for (const f of ['px', 'py', 'pz', 'rx', 'ry', 'rz'] as const) out[f] = (a[f] ?? 0) + ((b[f] ?? 0) - (a[f] ?? 0)) * k;
}

export interface HeldSpec {
  /** Inventory item key. */
  item?: string;
  /** Explicit block (build catalog) with meta. */
  block?: { id: number; meta: number };
  /** A texture to show as a flat card (build objects). */
  texture?: THREE.Texture;
  key: string;
}

export interface ViewModelInput {
  dt: number;
  /** Horizontal speed (blocks/second). */
  speed: number;
  grounded: boolean;
  sprinting: boolean;
  verticalVelocity: number;
  /** Look deltas this frame (radians). */
  dYaw: number;
  dPitch: number;
  aspect: number;
  /** 0..1 brightness at the player. */
  light: number;
  visible: boolean;
  reducedMotion: boolean;
}

export class FirstPersonViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
  private readonly root = new THREE.Group();
  private readonly shoulder = new THREE.Group();
  private readonly arm = new THREE.Group();
  private readonly grip = new THREE.Group();
  private itemObj: THREE.Object3D | null = null;
  private currentKey = '';
  private readonly ambient: THREE.HemisphereLight;
  private readonly light: THREE.DirectionalLight;

  // action state
  private action: HandAction | null = null;
  private actionT = 0;
  private queued: HandAction | null = null;
  private pose: Required<Pose> = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 };

  // procedural motion
  private bobPhase = 0;
  private time = 0;
  private moveAmt = new Spring(10);
  private swayX = new Spring(12);
  private swayY = new Spring(12);
  private vertical = new Spring(9);
  private equip = new Spring(14);
  private wasGrounded = true;
  private armQuat = new THREE.Quaternion();

  constructor(private assets: AssetManager) {
    this.scene.add(this.camera);
    this.camera.add(this.root);
    this.root.add(this.shoulder);
    this.shoulder.position.copy(REST_SHOULDER);
    this.shoulder.add(this.arm);
    this.ambient = new THREE.HemisphereLight('#ffffff', '#806e5a', 1.3);
    this.light = new THREE.DirectionalLight('#ffffff', 1.4);
    this.light.position.set(0.5, 1, 0.8);
    this.scene.add(this.ambient, this.light);

    // Orient the arm once along shoulder → hand (its local -Z axis).
    const v = REST_HAND.clone().sub(REST_SHOULDER);
    const len = v.length();
    this.armQuat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), v.clone().normalize());
    // A slight inward roll so the back of the hand faces the camera.
    this.armQuat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.35));
    this.arm.quaternion.copy(this.armQuat);
    const sleeve = part(this.arm, 0.16, 0.16, len * 0.78, '#4f7a4a', 0, 0, -len * 0.36);
    const cuff = part(this.arm, 0.175, 0.175, 0.05, '#3f6a3a', 0, 0, -len * 0.76);
    const fist = part(this.arm, 0.125, 0.12, 0.14, '#8a5a32', 0, -0.005, -len - 0.02);
    const thumb = part(this.arm, 0.05, 0.05, 0.08, '#7a4e2a', -0.075, 0.02, -len - 0.03);
    for (const m of [sleeve, cuff, fist, thumb]) m.castShadow = false;
    this.grip.position.set(0, 0, -len - 0.02);
    this.arm.add(this.grip);
  }

  /** Start a hand action. Repeated triggers of a running swing queue one follow-up (no restarts mid-swing). */
  trigger(kind: HandAction): void {
    if (this.action === kind && this.actionT < 0.72 && kind !== 'eat') {
      this.queued = kind;
      return;
    }
    if (this.action === 'eat' && kind !== 'eat' && this.actionT < 0.8) return;
    this.action = kind;
    this.actionT = 0;
    this.queued = null;
  }

  get busy(): boolean {
    return this.action !== null;
  }

  setHeld(spec: HeldSpec | null): void {
    const key = spec?.key ?? '';
    if (key === this.currentKey) return;
    this.currentKey = key;
    // lower-then-raise without a pop: jump the spring down, it eases back up
    this.equip.x = -0.22;
    this.equip.v = 0;
    if (this.itemObj) {
      this.grip.remove(this.itemObj);
      this.itemObj.traverse((o) => {
        const s = o as THREE.Mesh;
        if ((s as unknown as THREE.Sprite).isSprite || s.userData.ownMaterial) (s.material as THREE.Material).dispose();
        if (s.userData.ownGeometry) s.geometry.dispose();
      });
      this.itemObj = null;
    }
    if (!spec) return;
    const { obj, category } = this.buildHeld(spec);
    if (!obj || category === 'none') return;
    const tr = HELD_TRANSFORM[category];
    const holder = new THREE.Group();
    holder.add(obj);
    holder.position.set(...tr.pos);
    holder.rotation.set(...tr.rot);
    holder.scale.setScalar(tr.scale);
    if (category === 'tool' || category === 'long') {
      // put the handle's grip point in the fist
      obj.position.set(0, -GRIP_Y, 0);
    }
    this.itemObj = holder;
    this.grip.add(holder);
  }

  private buildHeld(spec: HeldSpec): { obj: THREE.Object3D | null; category: HeldCategory } {
    const blockMesh = (id: number, meta: number) => blockObject(id, meta, this.assets.materials);
    if (spec.block) {
      const flat = SHAPE[spec.block.id] === 2;
      return { obj: blockMesh(spec.block.id, spec.block.meta), category: flat ? 'flat' : 'block' };
    }
    if (spec.texture) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: spec.texture, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }));
      m.userData.ownMaterial = true;
      m.userData.ownGeometry = true;
      return { obj: m, category: 'sprite' };
    }
    if (!spec.item) return { obj: null, category: 'none' };
    const def = itemDef(spec.item);
    if (def.placeBlock) {
      const id = blockId(def.placeBlock);
      const light = def.placeBlock === 'torch' || def.placeBlock === 'lantern' || def.placeBlock === 'crystal_lantern' || def.placeBlock === 'wind_lamp';
      const flat = SHAPE[id] === 2;
      return { obj: blockMesh(id, def.placeMeta ?? 0), category: light ? 'light' : flat ? 'flat' : 'block' };
    }
    if (def.tool && 'shape' in def.icon && def.icon.shape !== 'can') {
      const long = def.icon.shape === 'spear' || def.icon.shape === 'blade' || def.icon.shape === 'sword';
      return { obj: buildToolMesh(def.icon.shape, def.icon.colors), category: long ? 'long' : 'tool' };
    }
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.assets.spriteTexture(spec.item), alphaTest: 0.4 }));
    return { obj: sprite, category: 'sprite' };
  }

  update(i: ViewModelInput): void {
    const dt = Math.min(i.dt, 0.1);
    this.scene.visible = i.visible;
    if (this.camera.aspect !== i.aspect) {
      this.camera.aspect = i.aspect;
      this.camera.updateProjectionMatrix();
    }
    this.time += dt;

    // ---- action curve (analytic; ends exactly at rest)
    if (this.action) {
      const def = ACTIONS[this.action];
      this.actionT += dt / def.duration;
      if (this.actionT >= 1) {
        if (this.queued) {
          this.action = this.queued;
          this.queued = null;
          this.actionT = 0;
        } else {
          this.action = null;
          this.actionT = 0;
        }
      }
    }
    const p = this.pose;
    if (this.action) {
      const def = ACTIONS[this.action];
      sampleAction(def, this.actionT, p);
      if (def.wiggle && this.actionT > 0.22 && this.actionT < 0.78) p.py += Math.sin(this.time * 26) * def.wiggle;
    } else p.px = p.py = p.pz = p.rx = p.ry = p.rz = 0;

    // ---- bob: phase advances with distance walked (not time) → FPS independent
    const moving = i.grounded ? Math.min(1, i.speed / 4.3) : 0;
    const m = this.moveAmt.step(moving, dt);
    this.bobPhase += i.speed * dt * 1.9 * (i.grounded ? 1 : 0);
    const amp = i.reducedMotion ? 0.003 : i.sprinting ? 0.016 : 0.011;
    const bobX = Math.sin(this.bobPhase) * amp * m;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * amp * 1.2 * m + Math.sin(this.time * 1.6) * 0.0022 * (1 - m);

    // ---- look sway: angular velocity → small lag, clamped
    const yawVel = dt > 0 ? i.dYaw / dt : 0;
    const pitchVel = dt > 0 ? i.dPitch / dt : 0;
    const sx = this.swayX.step(THREE.MathUtils.clamp(yawVel * 0.006, -0.035, 0.035), dt);
    const sy = this.swayY.step(THREE.MathUtils.clamp(-pitchVel * 0.005, -0.03, 0.03), dt);

    // ---- jump / land
    if (i.grounded && !this.wasGrounded) this.vertical.v -= 0.35; // landing dip
    this.wasGrounded = i.grounded;
    const vy = this.vertical.step(i.grounded ? 0 : THREE.MathUtils.clamp(-i.verticalVelocity * 0.004, -0.035, 0.035), dt);
    const eq = this.equip.step(0, dt);

    this.root.position.set(bobX + sx, bobY + sy + vy + eq, 0);
    this.root.rotation.set(0, 0, sx * 1.4);

    this.shoulder.position.set(REST_SHOULDER.x + p.px, REST_SHOULDER.y + p.py, REST_SHOULDER.z + p.pz);
    this.shoulder.rotation.set(p.rx, p.ry, p.rz);

    const lightLevel = 0.35 + i.light * 0.9;
    this.ambient.intensity = lightLevel * 1.2;
    this.light.intensity = lightLevel * 1.2;
  }

  /** Current world-space-free debug snapshot (for tests): offsets from rest. */
  debugState(): { root: number[]; shoulder: number[]; action: string | null } {
    return {
      root: [this.root.position.x, this.root.position.y, this.root.position.z, this.root.rotation.z],
      shoulder: [
        this.shoulder.position.x - REST_SHOULDER.x, this.shoulder.position.y - REST_SHOULDER.y, this.shoulder.position.z - REST_SHOULDER.z,
        this.shoulder.rotation.x, this.shoulder.rotation.y, this.shoulder.rotation.z,
      ],
      action: this.action,
    };
  }

  dispose(): void {
    this.setHeld(null);
    this.scene.clear();
  }
}
