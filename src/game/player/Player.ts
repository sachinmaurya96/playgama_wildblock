import * as THREE from 'three';
import { itemDef, SET_BONUS_DEFENSE, type BuffId } from '../../data/items';
import { useInventoryStore } from '../../stores/inventoryStore';
import { usePlayerStore, type Buff } from '../../stores/playerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { B } from '../world/BlockRegistry';
import { VOID_Y } from '../world/constants';
import type { Game } from '../Game';
import { animateExplorer, buildExplorer, dressExplorer, dressFromItems, setScarfColor, type Rig } from '../rendering/Models';
import { cameraClearance } from './Raycast';
import { moveBody, type Body } from './VoxelPhysics';

export const PLAYER_HALF_W = 0.3;
export const PLAYER_HEIGHT = 1.62;
const EYE = 1.5;
const EYE_CROUCH = 1.25;
const GRAVITY = 27;
const JUMP_V = 8.4;
const WALK = 5.0;
const SPRINT = 7.6;
const CROUCH = 2.2;
const SWIM = 3.4;
/** PvP mode: everyone moves at exactly the same, brisker pace (no armor / buff / energy differences). */
const PVP_WALK = 5.6;
const PVP_SPRINT = 8.2;
/** Damage reduction cap (full Crystal armor + shield reaches it). */
export const MAX_DEFENSE = 0.75;

/** Total armor numbers for a set of equipped items (shared by the HUD, armory screen and PvP). */
export function armorStats(eq: Partial<Record<string, { item: string } | null>>): { speed: number; defense: number; block: number; fullSet: string | null } {
  let speed = 0, defense = 0, block = 0;
  const sets = new Map<string, number>();
  for (const s of Object.values(eq)) {
    if (!s) continue;
    const e = itemDef(s.item).equip;
    speed += e?.speed ?? 0;
    defense += e?.defense ?? 0;
    block = Math.max(block, e?.block ?? 0);
    if (e?.set) sets.set(e.set, (sets.get(e.set) ?? 0) + 1);
  }
  let fullSet: string | null = null;
  for (const [k, n] of sets) if (n >= 4) fullSet = k;
  if (fullSet) defense += SET_BONUS_DEFENSE;
  return { speed, defense: Math.min(MAX_DEFENSE, defense), block, fullSet };
}

/**
 * Player movement, vitals and camera. Physics is custom voxel AABB collision
 * (see VoxelPhysics) rather than per-voxel rigid bodies.
 */
export class Player {
  readonly body: Body = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), halfW: PLAYER_HALF_W, height: PLAYER_HEIGHT, grounded: false };
  yaw = 0;
  pitch = 0;
  crouching = false;
  sprinting = false;
  inWater = false;
  headInWater = false;
  private fallPeak = 0;
  private wasGrounded = true;
  private eyeHeight = EYE;
  private bob = 0;
  private stepTimer = 0;
  cameraMode: 'first' | 'third' = 'first';
  private camDist = 4;
  shake = 0;
  private shakeSeed = 0;

  // vitals
  vitality = 100;
  maxVitality = 100;
  energy = 100;
  buffs: Buff[] = [];
  dead = false;
  invulnerable = 0;
  private regenTimer = 0;
  private syncTimer = 0;
  comfort = 0;
  sheltered = false;

  readonly rig: Rig;
  private dressSig = '';
  swing = 0;
  swingKind: 'chop' | 'place' | 'attack' | 'none' = 'none';
  /** True while physics is frozen waiting for terrain under the player. */
  waitingForGround = false;
  /** Build Home: no damage, no vitals, optional flying. */
  creative = false;
  flying = false;
  /** Sitting in a boat: the boat moves the body (see entities/Boats.ts). */
  seated = false;
  /** Called when flight ends by touching down (Build Home updates its HUD). */
  onLanded: (() => void) | null = null;

  constructor(private game: Game) {
    this.rig = buildExplorer(scarfHex());
    this.rig.root.visible = false;
    game.scene.add(this.rig.root);
    this.cameraMode = useSettingsStore.getState().gameplay.cameraMode;
  }

  get position(): THREE.Vector3 {
    return this.body.pos;
  }

  eyePosition(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.body.pos.x, this.body.pos.y + this.eyeHeight, this.body.pos.z);
  }

  lookDirection(out = new THREE.Vector3()): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  teleport(x: number, y: number, z: number): void {
    this.body.pos.set(x, y, z);
    this.body.vel.set(0, 0, 0);
    this.fallPeak = y;
  }

  hasBuff(id: BuffId): boolean {
    return this.buffs.some((b) => b.id === id);
  }

  addBuff(id: BuffId, seconds: number): void {
    const b = this.buffs.find((x) => x.id === id);
    if (b) b.remaining = Math.max(b.remaining, seconds);
    else this.buffs.push({ id, remaining: seconds });
  }

  equipBonus(): { speed: number; defense: number; block: number; fullSet: string | null } {
    return armorStats(useInventoryStore.getState().equipment);
  }

  /** Apply damage (after defense). Returns actual damage. */
  hurt(amount: number, cause: string, from?: THREE.Vector3): number {
    if (this.creative) return 0;
    if (this.dead || this.invulnerable > 0 || this.game.difficulty === 'peaceful' && cause !== 'fall' && cause !== 'void') return 0;
    let dmg = amount;
    const eq = this.equipBonus();
    // shields block hits that come from in front of you
    if (from && eq.block > 0) {
      const dx = from.x - this.body.pos.x, dz = from.z - this.body.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      const facing = (-Math.sin(this.yaw) * dx - Math.cos(this.yaw) * dz) / l;
      if (facing > 0.35 && Math.random() < eq.block) {
        this.invulnerable = 0.35;
        this.game.audio.play('block', { pos: this.body.pos });
        this.game.particles.emit('spark', this.body.pos.x + (dx / l) * 0.5, this.body.pos.y + 1.1, this.body.pos.z + (dz / l) * 0.5, 10, [1, 0.95, 0.75], { speed: 3, size: 0.06, life: 0.35 });
        this.game.bus.emit('playerBlocked', { cause });
        return 0;
      }
    }
    let def = eq.defense;
    if (this.hasBuff('sturdy')) def += 0.15;
    dmg *= 1 - Math.min(MAX_DEFENSE, def);
    this.vitality -= dmg;
    this.invulnerable = 0.45;
    this.shake = Math.min(1, this.shake + 0.6);
    if (from) {
      const dx = this.body.pos.x - from.x, dz = this.body.pos.z - from.z;
      const l = Math.hypot(dx, dz) || 1;
      this.body.vel.x += (dx / l) * 5;
      this.body.vel.z += (dz / l) * 5;
      this.body.vel.y = Math.max(this.body.vel.y, 4);
    }
    this.game.bus.emit('playerHurt', { amount: dmg, cause });
    this.game.audio.play('hurt');
    if (this.vitality <= 0) {
      this.vitality = 0;
      this.dead = true;
      this.game.onPlayerDeath(cause);
    }
    this.syncTimer = 0;
    return dmg;
  }

  heal(v: number, e: number): void {
    this.vitality = Math.min(this.maxVitality, this.vitality + v);
    this.energy = Math.min(100, this.energy + e);
    this.syncTimer = 0;
  }

  update(dt: number, simulate: boolean): void {
    const input = this.game.input;
    const settings = useSettingsStore.getState();
    // ---- look (also works while paused for smooth camera return, but only with pointer lock)
    if (simulate) {
      const sens = 0.0022 * settings.controls.sensitivity;
      this.yaw -= input.lookX * sens;
      this.pitch -= input.lookY * sens * (settings.controls.invertY ? -1 : 1);
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
      if (input.wasPressed('camera') && !this.creative) {
        this.cameraMode = this.cameraMode === 'first' ? 'third' : 'first';
        useSettingsStore.getState().update('gameplay', { cameraMode: this.cameraMode });
      }
    }

    const b = this.body;
    const world = this.game.world;
    // Freeze until the chunk under us exists — never fall through missing terrain.
    this.waitingForGround = !this.game.chunks.isReady(b.pos.x, b.pos.z);
    if (!simulate || this.dead || this.waitingForGround) {
      this.updateAvatar(dt, 0);
      return;
    }

    if (this.seated) {
      this.inWater = this.headInWater = false;
      this.crouching = this.sprinting = false;
      this.fallPeak = b.pos.y;
      this.wasGrounded = true;
      if (!this.creative) this.updateVitals(dt, 0);
      this.updateAvatar(dt, 0);
      return;
    }

    // ---- environment
    const feetId = world.get(Math.floor(b.pos.x), Math.floor(b.pos.y + 0.2), Math.floor(b.pos.z));
    const waistId = world.get(Math.floor(b.pos.x), Math.floor(b.pos.y + 0.8), Math.floor(b.pos.z));
    const headId = world.get(Math.floor(b.pos.x), Math.floor(b.pos.y + this.eyeHeight + 0.1), Math.floor(b.pos.z));
    this.inWater = feetId === B.WATER || waistId === B.WATER;
    this.headInWater = headId === B.WATER;

    // ---- movement input
    const mv = input.moveVector();
    this.crouching = (input.isDown('crouch') || input.touch.crouch) && !this.inWater && !this.flying;
    const wantsSprint = (input.isDown('sprint') || input.touch.sprint) && mv.y > 0.3 && !this.crouching;
    const pvp = !!this.game.pvp;
    this.sprinting = wantsSprint && (pvp || this.energy > 12);
    let speed: number;
    if (pvp) {
      speed = this.inWater ? SWIM : this.crouching ? CROUCH : this.sprinting ? PVP_SPRINT : PVP_WALK;
    } else {
      const eq = this.equipBonus();
      speed = this.inWater ? SWIM : this.crouching ? CROUCH : this.sprinting ? SPRINT : WALK;
      speed *= 1 + eq.speed + (this.hasBuff('swift') ? 0.15 : 0);
      if (this.energy < 8) speed *= 0.85;
    }
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = (-sin * mv.y + cos * mv.x) * speed;
    const wz = (-cos * mv.y - sin * mv.x) * speed;
    const accel = b.grounded ? 14 : this.inWater ? 5 : 3.2;
    b.vel.x += (wx - b.vel.x) * Math.min(1, accel * dt);
    b.vel.z += (wz - b.vel.z) * Math.min(1, accel * dt);

    const jump = input.isDown('jump') || input.touch.jump;
    if (this.flying) {
      // Space / ⏫ up, Shift / ⏬ down; pushing the stick to the rim (or Ctrl) flies faster
      const up = (jump ? 1 : 0) - (input.isDown('sprint') || input.touch.crouch ? 1 : 0);
      const boost = input.ctrl ? 2.6 : input.touch.sprint ? 2.2 : 1.8;
      b.vel.x += (wx * boost - b.vel.x) * Math.min(1, 8 * dt);
      b.vel.z += (wz * boost - b.vel.z) * Math.min(1, 8 * dt);
      b.vel.y += (up * 8 - b.vel.y) * Math.min(1, 10 * dt);
      // gentle ceiling so nobody drifts off into the sky (the build camera can still go higher)
      const ceiling = 118;
      if (b.pos.y > ceiling - 6 && b.vel.y > 0) b.vel.y *= Math.max(0, (ceiling - b.pos.y) / 6);
      this.sprinting = false;
      this.fallPeak = b.pos.y;
    } else if (this.inWater) {
      b.vel.y -= 7 * dt;
      b.vel.y *= Math.pow(0.35, dt);
      if (jump) b.vel.y = Math.min(b.vel.y + 22 * dt, 3.6);
      b.vel.y = Math.max(b.vel.y, -3);
      // hop out onto a bank
      if (jump && !this.headInWater && (b.vel.x !== 0 || b.vel.z !== 0)) {
        const ax = Math.floor(b.pos.x + Math.sign(wx) * 0.5), az = Math.floor(b.pos.z + Math.sign(wz) * 0.5);
        if (world.isSolid(ax, Math.floor(b.pos.y + 0.5), az) && !world.isSolid(ax, Math.floor(b.pos.y + 1.5), az)) b.vel.y = 5.5;
      }
      this.fallPeak = b.pos.y;
    } else {
      b.vel.y -= GRAVITY * dt;
      b.vel.y = Math.max(b.vel.y, -45);
      if (jump && b.grounded) {
        b.vel.y = JUMP_V;
        b.grounded = false;
        this.energy -= 0.25;
        this.game.audio.play('jump');
      }
    }

    const vyBefore = b.vel.y;
    const res = moveBody(world, b, dt, 0.55, this.crouching);
    // flying down onto the ground lands you (check the speed *before* the collision zeroed it)
    if (this.flying && b.grounded && vyBefore < -0.5) {
      this.flying = false;
      this.onLanded?.();
    }
    if (res.stepped > 0) this.eyeHeight -= res.stepped * 0.6; // smooth step-up camera

    // ---- fall damage
    if (!b.grounded && !this.inWater) this.fallPeak = Math.max(this.fallPeak, b.pos.y);
    if (b.grounded && !this.wasGrounded) {
      const fall = this.fallPeak - b.pos.y;
      if (fall > 4.2 && !this.creative) this.hurt((fall - 3.5) * 7, 'fall');
      if (fall > 1.2) {
        this.game.audio.play('land', { material: this.game.materialUnder(b.pos) });
        this.shake = Math.min(1, this.shake + Math.min(0.5, fall * 0.05));
      }
    }
    if (b.grounded || this.inWater) this.fallPeak = b.pos.y;
    this.wasGrounded = b.grounded;

    // ---- void rescue
    if (b.pos.y < VOID_Y) {
      if (this.creative) this.teleport(0.5, this.game.world.standableY(0, 0) + 1.2, 0.5);
      else {
        this.hurt(10, 'void');
        this.game.respawn('safe');
      }
    }

    // ---- footsteps
    const hs = Math.hypot(b.vel.x, b.vel.z);
    if (b.grounded && hs > 0.8) {
      this.stepTimer -= dt * hs;
      if (this.stepTimer <= 0) {
        this.stepTimer = this.sprinting ? 2.6 : 2.2;
        this.game.audio.play('step', { material: this.game.materialUnder(b.pos), volume: this.crouching ? 0.3 : 0.7 });
      }
    } else if (this.inWater && hs > 0.5) {
      this.stepTimer -= dt * hs;
      if (this.stepTimer <= 0) {
        this.stepTimer = 3;
        this.game.audio.play('swim');
      }
    }

    if (!this.creative) this.updateVitals(dt, hs);
    this.updateAvatar(dt, hs);
  }

  private updateVitals(dt: number, hs: number) {
    // energy: gentle drain, faster when sprinting/working, never lethal
    let drain = 0.035;
    if (this.sprinting && hs > 1) drain += 0.6;
    if (this.inWater) drain += 0.08;
    if (this.hasBuff('well_fed')) drain *= 0.5;
    this.energy = Math.max(0, this.energy - drain * dt);
    if (this.hasBuff('well_rested')) this.energy = Math.min(100, this.energy + (0.06 + this.comfort * 0.01) * dt);
    // vitality regen when not starving
    this.regenTimer += dt;
    if (this.regenTimer > 1) {
      this.regenTimer = 0;
      if (this.energy > 30 && this.vitality < this.maxVitality) {
        const r = (this.hasBuff('hearty') ? 1.4 : 0.6) * (this.sheltered ? 1.5 : 1);
        this.vitality = Math.min(this.maxVitality, this.vitality + r);
        this.energy = Math.max(0, this.energy - 0.08);
      }
    }
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    for (const buf of this.buffs) buf.remaining -= dt;
    this.buffs = this.buffs.filter((x) => x.remaining > 0);
    this.syncTimer -= dt;
    if (this.syncTimer <= 0) {
      this.syncTimer = 0.2;
      this.syncHud();
    }
  }

  syncHud(): void {
    usePlayerStore.getState().sync({
      vitality: this.vitality, energy: this.energy, buffs: this.buffs.map((b) => ({ ...b })), sheltered: this.sheltered,
      underwater: this.headInWater, comfort: this.comfort, maxVitality: this.maxVitality,
    });
  }

  private updateAvatar(dt: number, hs: number) {
    const target = this.seated ? 1.05 : this.crouching ? EYE_CROUCH : EYE;
    this.eyeHeight += (target - this.eyeHeight) * Math.min(1, dt * 12);
    this.swing = Math.max(0, this.swing - dt * 3.2);
    const r = this.rig.root;
    r.visible = this.cameraMode === 'third';
    if (!r.visible) return;
    r.position.copy(this.body.pos);
    r.rotation.y = this.yaw + Math.PI;
    r.scale.setScalar(1);
    const inv = useInventoryStore.getState();
    const eq = inv.equipment;
    const keys = [eq.head?.item, eq.body?.item, eq.legs?.item, eq.feet?.item, eq.offhand?.item, inv.selectedStack()?.item];
    const sig = keys.join('|');
    if (sig !== this.dressSig) {
      this.dressSig = sig;
      dressExplorer(this.rig, dressFromItems(itemDef, keys));
    }
    animateExplorer(this.rig, {
      moving: Math.min(1, hs / SPRINT), time: this.game.time, action: 0, grounded: this.body.grounded, swimming: this.inWater && !this.body.grounded,
      swing: this.swing > 0 ? 1 - this.swing : 0, swingKind: this.swingKind, look: -this.pitch,
    });
    if (this.crouching) this.rig.body.position.y -= 0.12;
    if (this.seated) this.rig.body.position.y -= 0.32;
  }

  refreshScarf(): void {
    setScarfColor(this.rig, scarfHex());
  }

  /** Position the camera (first or third person) with obstacle avoidance. */
  updateCamera(camera: THREE.PerspectiveCamera, dt: number): void {
    const settings = useSettingsStore.getState();
    const b = this.body;
    const hs = Math.hypot(b.vel.x, b.vel.z);
    const reduced = settings.accessibility.reducedShake;
    if (b.grounded && hs > 1 && !reduced) this.bob += dt * hs * 1.9;
    else this.bob *= 0.9;
    const bobY = reduced ? 0 : Math.sin(this.bob * 2) * 0.035 * Math.min(1, hs / 5);
    const eye = this.eyePosition(new THREE.Vector3());
    eye.y += bobY;
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch, this.yaw, 0);
    if (this.cameraMode === 'first') {
      camera.position.copy(eye);
    } else {
      const back = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
      const pivotPt = eye.clone().add(new THREE.Vector3(0, 0.25, 0));
      const want = cameraClearance(this.game.world, pivotPt, back, 4.2);
      this.camDist += (want - this.camDist) * Math.min(1, dt * (want < this.camDist ? 20 : 4));
      camera.position.copy(pivotPt).addScaledVector(back, this.camDist);
      // side offset (over the shoulder)
      camera.position.x += Math.cos(this.yaw) * 0.45;
      camera.position.z -= Math.sin(this.yaw) * 0.45;
    }
    // hit / landing shake (small, disabled by the accessibility option)
    if (this.shake > 0.001) {
      const amt = reduced ? 0 : this.shake * 0.05;
      this.shakeSeed += dt * 40;
      camera.rotation.x += Math.sin(this.shakeSeed * 1.3) * amt;
      camera.rotation.z += Math.sin(this.shakeSeed * 1.7) * amt;
      this.shake = Math.max(0, this.shake - dt * 3);
    }
    const fovTarget = settings.graphics.fov + (this.sprinting && hs > 5 ? 6 : 0);
    if (Math.abs(camera.fov - fovTarget) > 0.05) {
      camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 8);
      camera.updateProjectionMatrix();
    }
  }
}

function scarfHex(): string {
  const id = useSettingsStore.getState().gameplay.scarf;
  const colors: Record<string, string> = { ember: '#d9573f', meadow: '#e0b23d', river: '#3f8fd9', sunset: '#f07a5a', moss: '#5f9a4a', starlight: '#9b8cff' };
  return colors[id] ?? '#d9573f';
}
