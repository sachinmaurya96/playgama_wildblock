import * as THREE from 'three';
import { part } from '../rendering/Models';
import { GUNS, type GunId } from './WeaponDefinitions';
import { buildGun } from './WeaponModels';
import { Spring } from '../core/Spring';

/**
 * First-person firearm: two arms holding the gun, rendered in its own pass on
 * top of the world (like the survival hand in FirstPersonViewModel, which the
 * Deathmatch sword keeps using).
 *
 * Every transform is rebuilt each frame from rest pose + springs + analytic
 * curves (recoil kick, reload, pump / bolt cycle, raise), so nothing drifts.
 */
/** The gun models are built at world scale; in view space they're shrunk to sit naturally in the lower right. */
const VIEW_SCALE = 0.42;
const HIP = new THREE.Vector3(0.19, -0.17, -0.36);
/** Aim position: the sight line (≈0.16 above the grip on every model) on the camera's centre. */
const ADS = new THREE.Vector3(0, -0.16 * VIEW_SCALE, -0.13); // eye just behind the red-dot sight, stock past the camera

export interface GunViewInput {
  dt: number;
  speed: number;
  grounded: boolean;
  sprinting: boolean;
  dYaw: number;
  dPitch: number;
  aspect: number;
  light: number;
  /** 0 = hip, 1 = fully aimed. */
  aim: number;
  /** 0..1 reload progress, or 0 when not reloading. */
  reload: number;
  visible: boolean;
  reducedMotion: boolean;
}

export class GunViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
  private readonly root = new THREE.Group();
  private readonly holder = new THREE.Group();
  private gun: THREE.Group | null = null;
  private gunId: GunId | null = null;
  private readonly flash: THREE.Mesh;
  private readonly flashLight: THREE.PointLight;
  private readonly ambient: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private leftArm = new THREE.Group();
  private rightArm = new THREE.Group();
  private kick = new Spring(22);
  private kickRot = new Spring(18);
  private swayX = new Spring(12);
  private swayY = new Spring(12);
  private moveAmt = new Spring(9);
  private raise = new Spring(13);
  private bob = 0;
  private time = 0;
  private flashT = 0;
  private cycleT = 1;
  private cycleLen = 0.5;
  private base = new THREE.Vector3();

  constructor() {
    this.scene.add(this.camera);
    this.camera.add(this.root);
    this.root.add(this.holder);
    this.holder.scale.setScalar(VIEW_SCALE);
    this.ambient = new THREE.HemisphereLight('#ffffff', '#806e5a', 1.3);
    this.sun = new THREE.DirectionalLight('#ffffff', 1.3);
    this.sun.position.set(0.5, 1, 0.8);
    this.scene.add(this.ambient, this.sun);
    // arms: sleeve + glove (same palette as the explorer)
    for (const [arm, x] of [[this.rightArm, 0.05], [this.leftArm, -0.06]] as const) {
      part(arm, 0.08, 0.08, 0.42, '#4f7a4a', 0, 0, 0.21);
      part(arm, 0.075, 0.075, 0.09, '#8a5a32', 0, 0, -0.02);
      arm.position.x = x;
      this.holder.add(arm);
      arm.traverse((o) => (o.castShadow = false));
    }
    const fm = new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    this.flash = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), fm);
    this.flash.visible = false;
    this.flashLight = new THREE.PointLight('#ffc070', 0, 2);
    this.holder.add(this.flash, this.flashLight);
  }

  setGun(id: GunId | null): void {
    if (id === this.gunId) return;
    this.gunId = id;
    if (this.gun) this.holder.remove(this.gun);
    this.gun = null;
    if (!id) return;
    this.gun = buildGun(id);
    this.holder.add(this.gun);
    const muzzle = this.gun.userData.muzzle as THREE.Vector3;
    this.flash.position.copy(muzzle);
    this.flashLight.position.copy(muzzle);
    // left hand under the handguard, right hand on the grip
    this.rightArm.position.set(0.0, -0.08, 0.06);
    this.leftArm.position.set(-0.01, -0.0, id === 'mp5' ? -0.3 : id === 'm24' ? -0.42 : -0.38);
    this.rightArm.rotation.set(0.15, -0.2, 0);
    this.leftArm.rotation.set(0.35, 0.35, 0);
    this.raise.x = -0.35;
    this.raise.v = 0;
  }

  /** A shot: recoil kick + muzzle flash (+ pump / bolt for the shotgun and sniper). */
  fire(gun: GunId): void {
    const d = GUNS[gun];
    this.kick.v += 1.4 + d.recoilV * 30;
    this.kickRot.v += 2 + d.recoilV * 60;
    this.flashT = 0.05;
    this.flash.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    if (gun === 'shotgun' || gun === 'm24') {
      this.cycleT = 0;
      this.cycleLen = gun === 'shotgun' ? 0.55 : 0.85;
    }
  }

  /** Weapon came out (switch / pickup). */
  equip(): void {
    this.raise.x = -0.35;
    this.raise.v = 0;
  }

  update(i: GunViewInput): void {
    const dt = Math.min(0.1, i.dt);
    this.time += dt;
    this.scene.visible = i.visible && !!this.gun;
    if (this.camera.aspect !== i.aspect) {
      this.camera.aspect = i.aspect;
      this.camera.updateProjectionMatrix();
    }
    if (!this.gun) return;
    const aim = i.aim;
    const m = this.moveAmt.step(i.grounded ? Math.min(1, i.speed / 5) : 0, dt);
    this.bob += i.speed * dt * 1.8 * (i.grounded ? 1 : 0);
    const amp = (i.reducedMotion ? 0.003 : i.sprinting ? 0.02 : 0.011) * (1 - aim * 0.85);
    const bx = Math.sin(this.bob) * amp * m;
    const by = -Math.abs(Math.cos(this.bob)) * amp * m + Math.sin(this.time * 1.5) * 0.002 * (1 - m) * (1 - aim);
    const sx = this.swayX.step(THREE.MathUtils.clamp((i.dYaw / Math.max(dt, 1e-3)) * 0.005, -0.03, 0.03) * (1 - aim * 0.7), dt);
    const sy = this.swayY.step(THREE.MathUtils.clamp((-i.dPitch / Math.max(dt, 1e-3)) * 0.004, -0.025, 0.025) * (1 - aim * 0.7), dt);
    const k = this.kick.step(0, dt);
    const kr = this.kickRot.step(0, dt);
    const r = this.raise.step(0, dt);
    // reload: tilt the gun, magazine drops out and back in
    const rl = i.reload;
    const tilt = rl > 0 ? Math.sin(Math.min(1, rl) * Math.PI) : 0;
    const magGroup = this.gun.userData.mag as THREE.Object3D | undefined;
    if (magGroup && this.gunId !== 'shotgun') {
      const out = rl > 0 && rl < 0.85 ? Math.sin(Math.min(1, rl / 0.85) * Math.PI) : 0;
      magGroup.position.y = (magGroup.userData.restY ??= magGroup.position.y) - out * 0.22;
    }
    // pump / bolt cycle
    this.cycleT = Math.min(1, this.cycleT + dt / this.cycleLen);
    const action = this.gun.userData.action as THREE.Object3D | undefined;
    if (action) {
      const c = this.cycleT < 1 ? Math.sin(this.cycleT * Math.PI) : 0;
      const restZ = (action.userData.restZ ??= action.position.z);
      action.position.z = restZ + c * (this.gunId === 'shotgun' ? 0.12 : 0.08);
      if (this.gunId === 'shotgun' && rl > 0) action.position.z = restZ + Math.abs(Math.sin(rl * Math.PI * 6)) * 0.08;
    }
    const base = this.base.copy(HIP).lerp(ADS, aim);
    if (i.sprinting && aim < 0.1) { base.x -= 0.04; base.y -= 0.04; base.z += 0.02; }
    this.holder.position.set(base.x + bx + sx, base.y + by + sy + r - tilt * 0.05, base.z + k * 0.04);
    this.holder.rotation.set(kr * 0.06 + tilt * 0.5 + (i.sprinting && aim < 0.1 ? -0.25 : 0), (1 - aim) * 0.04 + sx * 1.5, tilt * 0.6 + sx * 1.2);
    this.root.rotation.z = sx * 0.8;
    // flash
    this.flashT = Math.max(0, this.flashT - dt);
    this.flash.visible = this.flashT > 0;
    this.flash.scale.setScalar(this.flashT > 0 ? 0.8 + Math.random() * 0.8 : 1);
    this.flashLight.intensity = this.flashT > 0 ? 3 : 0;
    const l = 0.35 + i.light * 0.9;
    this.ambient.intensity = l * 1.2;
    this.sun.intensity = l * 1.2;
  }

  dispose(): void {
    this.flash.geometry.dispose();
    (this.flash.material as THREE.Material).dispose();
    this.setGun(null);
    this.scene.clear();
  }
}
