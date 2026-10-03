import * as THREE from 'three';
import { useGameStore } from '../../stores/gameStore';
import { usePlayerStore } from '../../stores/playerStore';
import { makeStack } from '../systems/InventoryLogic';
import { B, SOLID } from '../world/BlockRegistry';
import { boxCollides, moveBody, type Body } from '../player/VoxelPhysics';
import { part, pivot } from '../rendering/Models';
import type { Game } from '../Game';

export interface BoatSave {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

interface Boat {
  body: Body;
  yaw: number;
  /** Turning speed (rad/s), eased. */
  turn: number;
  group: THREE.Group;
  oarL: THREE.Object3D;
  oarR: THREE.Object3D;
  rowPhase: number;
  bob: number;
  hits: number;
  hitTimer: number;
  floating: boolean;
}

const WATER_TOP = 0.88; // where the water surface sits inside a water block
const HULL_DRAFT = 0.12; // how deep the hull sits in the water
const MAX_SPEED = 7.2;
const MAX_SPEED_FAST = 9.5;
const LAND_SPEED = 1.3;
const TURN_RATE = 2.4;

/**
 * Rowboats: place one on water, climb in (F / ✋ / tap), steer with WASD or the
 * joystick (the boat turns toward where you push, relative to the camera, so it
 * feels the same on keyboard and touch), and hop out with Jump. Boats float on
 * the water surface, glide with gentle drag, bump against banks, crawl slowly
 * on land and can be picked back up with two hits.
 */
export class Boats {
  readonly group = new THREE.Group();
  readonly boats: Boat[] = [];
  riding: Boat | null = null;
  private jumpWasDown = true;
  private splashTimer = 0;

  constructor(private game: Game) {
    this.group.name = 'boats';
  }

  // ---------------------------------------------------------------- spawning

  /** Top of the water at (x, z) near height y, or null when there is no water there. */
  waterSurface(x: number, y: number, z: number): number | null {
    const w = this.game.world;
    const bx = Math.floor(x), bz = Math.floor(z);
    for (let yy = Math.floor(y) + 1; yy >= Math.floor(y) - 3; yy--) {
      if (w.get(bx, yy, bz) === B.WATER && w.get(bx, yy + 1, bz) !== B.WATER) return yy + WATER_TOP;
    }
    return null;
  }

  spawn(x: number, y: number, z: number, yaw: number): Boat {
    const group = buildBoatModel();
    const oarL = group.getObjectByName('oarL')!;
    const oarR = group.getObjectByName('oarR')!;
    const boat: Boat = {
      // collision box is a bit narrower than the hull so boats fit 1-block-wide streams
      body: { pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), halfW: 0.44, height: 0.5, grounded: false },
      yaw, turn: 0, group, oarL, oarR, rowPhase: 0, bob: Math.random() * 6, hits: 0, hitTimer: 0, floating: true,
    };
    this.group.add(group);
    this.boats.push(boat);
    this.sync(boat, 0);
    return boat;
  }

  /** Use the boat item on a block / water hit. Returns true when a boat was placed. */
  placeAt(hitX: number, hitY: number, hitZ: number, isWater: boolean, yaw: number): boolean {
    const x = hitX + 0.5, z = hitZ + 0.5;
    let y: number | null = isWater ? this.waterSurface(x, hitY, z) : null;
    if (y !== null) y -= HULL_DRAFT;
    else {
      // on land: sit on top of the block
      if (!SOLID[this.game.world.get(hitX, hitY, hitZ)]) return false;
      y = hitY + 1;
      if (SOLID[this.game.world.get(hitX, hitY + 1, hitZ)]) return false;
    }
    for (const b of this.boats) if (Math.hypot(b.body.pos.x - x, b.body.pos.z - z) < 1.2) return false;
    this.spawn(x, y, z, yaw);
    this.game.audio.play('place', { material: 'wood', pos: new THREE.Vector3(x, y, z) });
    if (isWater) this.game.particles.emit('splash', x, y + 0.3, z, 14, [0.6, 0.8, 0.95], { spread: 0.9, speed: 2, size: 0.07, life: 0.6 });
    return true;
  }

  remove(boat: Boat): void {
    if (this.riding === boat) this.dismount();
    this.group.remove(boat.group);
    boat.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.userData.own) (m.material as THREE.Material).dispose();
    });
    const i = this.boats.indexOf(boat);
    if (i >= 0) this.boats.splice(i, 1);
  }

  // ---------------------------------------------------------------- aiming

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): { boat: Boat; dist: number; point: THREE.Vector3 } | null {
    const ray = new THREE.Ray(origin, dir);
    const box = new THREE.Box3();
    const hit = new THREE.Vector3();
    let best: { boat: Boat; dist: number; point: THREE.Vector3 } | null = null;
    for (const b of this.boats) {
      if (b === this.riding) continue;
      const p = b.body.pos;
      box.min.set(p.x - 0.8, p.y - 0.05, p.z - 0.8);
      box.max.set(p.x + 0.8, p.y + 0.6, p.z + 0.8);
      if (!ray.intersectBox(box, hit)) continue;
      const d = hit.distanceTo(origin);
      if (d <= maxDist && (!best || d < best.dist)) best = { boat: b, dist: d, point: hit.clone() };
    }
    return best;
  }

  // ---------------------------------------------------------------- riding

  board(boat: Boat): void {
    const p = this.game.player;
    if (this.riding) return;
    this.riding = boat;
    p.seated = true;
    p.flying = false;
    this.jumpWasDown = true; // don't hop straight back out if Space is held
    p.body.vel.set(0, 0, 0);
    this.game.audio.play('place', { material: 'wood', pos: boat.body.pos });
    usePlayerStore.getState().sync({ boating: true });
    const touch = this.game.input.touch.active;
    useGameStore.getState().toast(touch ? 'Row with the joystick · ⛵ to step out' : 'Row with WASD (turns toward where you steer) · Space to step out', 'info', '⛵');
  }

  dismount(): void {
    const boat = this.riding;
    if (!boat) return;
    const g = this.game;
    const p = g.player;
    this.riding = null;
    p.seated = false;
    usePlayerStore.getState().sync({ boating: false });
    // step onto the nearest dry spot beside the boat (preferring where you look)
    const w = g.world;
    const bp = boat.body.pos;
    const look = p.lookDirection();
    let best: { x: number; y: number; z: number; score: number } | null = null;
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        if (!dx && !dz) continue;
        const x = Math.floor(bp.x) + dx, z = Math.floor(bp.z) + dz;
        for (let y = Math.floor(bp.y) + 1; y >= Math.floor(bp.y) - 1; y--) {
          const id = w.get(x, y, z);
          if (!SOLID[id] || id === B.WATER) continue;
          if (SOLID[w.get(x, y + 1, z)] || SOLID[w.get(x, y + 2, z)] || w.get(x, y + 1, z) === B.WATER) break;
          const cx = x + 0.5 - bp.x, cz = z + 0.5 - bp.z;
          const d = Math.hypot(cx, cz);
          const score = d - ((cx * look.x + cz * look.z) / (d || 1)) * 0.8;
          if (!best || score < best.score) best = { x: x + 0.5, y: y + 1, z: z + 0.5, score };
          break;
        }
      }
    if (best) p.teleport(best.x, best.y + 0.02, best.z);
    else {
      p.teleport(bp.x, bp.y + 0.6, bp.z);
      p.body.vel.y = 6;
    }
    g.audio.play('jump');
  }

  /** Two quick hits pick a boat back up as an item. */
  hit(boat: Boat): void {
    const g = this.game;
    boat.hits++;
    boat.hitTimer = 1.2;
    boat.turn += 1.5;
    g.audio.play('hit', { material: 'wood', pos: boat.body.pos });
    if (boat.hits >= 2) {
      const p = boat.body.pos;
      g.drops.spawn(makeStack('boat'), p.x, p.y + 0.5, p.z, 0.5);
      g.particles.emit('chip', p.x, p.y + 0.3, p.z, 12, [0.6, 0.45, 0.3], { spread: 0.8, speed: 2.5, size: 0.08 });
      this.remove(boat);
    }
  }

  // ---------------------------------------------------------------- per frame

  update(dt: number, simulate: boolean): void {
    const g = this.game;
    const input = g.input;
    const rider = this.riding;
    // leave the boat: Jump (rising edge) — F / ✋ is handled by PlayerInteraction
    const jumpDown = input.isDown('jump') || input.touch.jump;
    if (rider && simulate && jumpDown && !this.jumpWasDown) this.dismount();
    this.jumpWasDown = jumpDown;
    this.splashTimer -= dt;

    for (const b of [...this.boats]) {
      const body = b.body;
      b.hitTimer -= dt;
      if (b.hitTimer <= 0) b.hits = 0;
      if (!simulate) {
        this.sync(b, dt);
        continue;
      }
      // keep far-away boats still (their chunk may not even be loaded)
      if (!g.chunks.isReady(body.pos.x, body.pos.z)) continue;
      const surface = this.waterSurface(body.pos.x, body.pos.y + 0.3, body.pos.z);
      b.floating = surface !== null;
      let thrust = 0;
      if (b === this.riding) {
        const mv = input.moveVector();
        const mag = Math.min(1, Math.hypot(mv.x, mv.y));
        if (mag > 0.08) {
          // steer toward the pushed direction, relative to where the camera looks
          const py = g.player.yaw;
          const sin = Math.sin(py), cos = Math.cos(py);
          const wx = -sin * mv.y + cos * mv.x, wz = -cos * mv.y - sin * mv.x;
          const want = Math.atan2(-wx, -wz);
          let d = want - b.yaw;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          b.turn += (THREE.MathUtils.clamp(d * 3, -TURN_RATE, TURN_RATE) - b.turn) * Math.min(1, dt * 6);
          // row forward once roughly facing the way you want (reverse when pulling straight back)
          const align = Math.cos(d);
          thrust = align > -0.6 ? mag * Math.max(0.15, align) : -mag * 0.5;
        } else b.turn *= Math.pow(0.02, dt);
      } else b.turn *= Math.pow(0.05, dt);
      b.yaw += b.turn * dt;

      const fast = b === this.riding && (input.isDown('sprint') || input.touch.sprint);
      const maxV = b.floating ? (fast ? MAX_SPEED_FAST : MAX_SPEED) : LAND_SPEED;
      const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
      if (thrust !== 0) {
        const accel = b.floating ? 6 : 3;
        body.vel.x += fx * thrust * accel * dt;
        body.vel.z += fz * thrust * accel * dt;
      }
      // water drag (keeps gliding), strong friction on land; sideways slip is damped hard (keel)
      const along = body.vel.x * fx + body.vel.z * fz;
      const sideX = body.vel.x - fx * along, sideZ = body.vel.z - fz * along;
      const keep = Math.pow(b.floating ? 0.55 : 0.02, dt);
      const keepSide = Math.pow(b.floating ? 0.04 : 0.01, dt);
      body.vel.x = fx * along * keep + sideX * keepSide;
      body.vel.z = fz * along * keep + sideZ * keepSide;
      const hs = Math.hypot(body.vel.x, body.vel.z);
      if (hs > maxV) {
        body.vel.x *= maxV / hs;
        body.vel.z *= maxV / hs;
      }
      // float on the surface / fall on land
      if (b.floating) {
        const target = surface! - HULL_DRAFT + Math.sin(g.time * 1.6 + b.bob) * 0.03;
        body.vel.y = (target - body.pos.y) * 6;
      } else body.vel.y = Math.max(-30, body.vel.y - 24 * dt);
      const before = hs;
      const P = body.pos, hw = body.halfW;
      let res: ReturnType<typeof moveBody>;
      if (boxCollides(g.world, P.x - hw, P.y + 0.02, P.z - hw, P.x + hw, P.y + body.height, P.z + hw)) {
        // wedged against a bank (e.g. a block was placed into it): ease free instead of letting
        // the collision solver shove the boat out sideways at high speed
        const cx = Math.floor(P.x) + 0.5, cz = Math.floor(P.z) + 0.5;
        P.x += (cx - P.x) * Math.min(1, dt * 3) + body.vel.x * dt * 0.3;
        P.z += (cz - P.z) * Math.min(1, dt * 3) + body.vel.z * dt * 0.3;
        P.y += body.vel.y * dt;
        body.vel.multiplyScalar(0.5);
        res = { grounded: false, hitX: false, hitZ: false, hitCeiling: false, stepped: 0 };
      } else res = moveBody(g.world, body, dt, 0.1, false);
      if (res.hitX) body.vel.x *= -0.15;
      if (res.hitZ) body.vel.z *= -0.15;
      if ((res.hitX || res.hitZ) && before > 3.5 && b === this.riding) {
        g.audio.play('thud', { pos: body.pos });
        g.player.shake = Math.min(1, g.player.shake + 0.2);
      }
      // wake & rowing
      const speed = Math.hypot(body.vel.x, body.vel.z);
      b.rowPhase += dt * (b === this.riding ? 2 + speed * 0.9 : 0) * (Math.abs(thrust) > 0.05 ? 1 : 0.15);
      if (b.floating && speed > 2 && this.splashTimer <= 0) {
        this.splashTimer = 0.12;
        g.particles.emit('splash', body.pos.x - fx * 0.9, body.pos.y + 0.12, body.pos.z - fz * 0.9, 2, [0.75, 0.88, 1], { spread: 0.4, speed: 1.2, size: 0.06, life: 0.5 });
        if (b === this.riding && Math.random() < 0.08) g.audio.play('swim');
      }
      this.sync(b, dt);
    }

    // carry the rider
    if (this.riding) {
      const b = this.riding;
      const p = g.player;
      p.body.pos.set(b.body.pos.x, b.body.pos.y + 0.18, b.body.pos.z);
      p.body.vel.copy(b.body.vel);
      p.body.grounded = true;
      if (!this.boats.includes(b)) this.riding = null;
    }
  }

  private sync(b: Boat, _dt: number) {
    const p = b.body.pos;
    b.group.position.set(p.x, p.y, p.z);
    b.group.rotation.set(Math.sin(this.game.time * 1.3 + b.bob) * 0.03 * (b.floating ? 1 : 0), b.yaw, Math.sin(this.game.time * 1.1 + b.bob) * 0.04 * (b.floating ? 1 : 0) + (b.hitTimer > 0 ? Math.sin(this.game.time * 30) * 0.06 * b.hitTimer : 0));
    const a = Math.sin(b.rowPhase * 2.4);
    const lift = Math.cos(b.rowPhase * 2.4);
    b.oarL.rotation.set(lift * 0.25, a * 0.7, 0.35);
    b.oarR.rotation.set(lift * 0.25, -a * 0.7, -0.35);
  }

  // ---------------------------------------------------------------- saving

  serialize(): BoatSave[] {
    return this.boats.map((b) => ({ x: b.body.pos.x, y: b.body.pos.y, z: b.body.pos.z, yaw: b.yaw }));
  }

  load(list: BoatSave[] | undefined): void {
    for (const b of [...this.boats]) this.remove(b);
    for (const s of list ?? []) this.spawn(s.x, s.y, s.z, s.yaw);
  }

  clear(): void {
    for (const b of [...this.boats]) this.remove(b);
  }
}

/** A chunky little rowboat built from boxes (front = -Z). */
function buildBoatModel(): THREE.Group {
  const g = new THREE.Group();
  const wood = '#b0804a', dark = '#7a5230', rim = '#8a5e3c', bench = '#c49563';
  part(g, 0.9, 0.08, 1.7, dark, 0, 0.06, 0); // keel / floor
  part(g, 0.08, 0.36, 1.6, wood, -0.48, 0.24, 0); // sides
  part(g, 0.08, 0.36, 1.6, wood, 0.48, 0.24, 0);
  part(g, 1.04, 0.36, 0.08, wood, 0, 0.24, 0.82); // stern
  part(g, 0.7, 0.32, 0.08, wood, 0, 0.26, -0.86); // bow
  part(g, 0.36, 0.28, 0.08, wood, 0, 0.3, -0.98);
  part(g, 0.1, 0.06, 1.7, rim, -0.48, 0.44, 0); // gunwales
  part(g, 0.1, 0.06, 1.7, rim, 0.48, 0.44, 0);
  part(g, 0.88, 0.06, 0.28, bench, 0, 0.3, 0.18); // seat
  part(g, 0.88, 0.06, 0.2, bench, 0, 0.3, -0.5);
  part(g, 0.12, 0.04, 0.9, '#a4744a', 0, 0.11, 0); // floorboard stripe
  for (const side of [-1, 1] as const) {
    const lock = pivot(g, side * 0.5, 0.46, -0.05, side < 0 ? 'oarL' : 'oarR');
    part(lock, 0.05, 0.05, 0.05, '#5a3a22', 0, 0, 0);
    const oar = new THREE.Group();
    oar.rotation.z = side * 0.25;
    lock.add(oar);
    part(oar, 1.1, 0.05, 0.05, '#c9a66b', side * 0.45, -0.1, 0);
    part(oar, 0.32, 0.03, 0.16, '#a4744a', side * 1.0, -0.14, 0);
  }
  return g;
}
