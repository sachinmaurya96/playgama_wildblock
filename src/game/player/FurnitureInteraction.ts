import * as THREE from 'three';
import type { Game } from '../Game';
import type { PlacedObject } from '../build/BuildObjects';
import { BLOCK_DEFS } from '../../data/blocks';
import { useBuildStore } from '../../stores/buildStore';
import { useGameStore } from '../../stores/gameStore';
import { useRestStore } from '../../stores/restStore';
import { raycastBlocks } from './Raycast';

type Action = 'sleep' | 'sit';
interface Furniture {
  action: Action; name: string; x: number; y: number; z: number;
  yaw: number; height: number; object?: PlacedObject;
}
const REACH = 2.8;

/** Shared proximity actions for voxel furniture and Build Home objects. */
export class FurnitureInteraction {
  consumed = false;
  private nearby: Partial<Record<Action, Furniture>> = {};
  private seat: Furniture | null = null;
  private exit = new THREE.Vector3();
  private scanIn = 0;
  private eye = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private boxes: number[] = [];

  constructor(private game: Game) { this.publish(); }
  get seated(): boolean { return this.seat !== null; }

  update(dt: number, simulate: boolean): void {
    this.consumed = false;
    const g = this.game;
    if (this.seat && simulate) {
      const i = g.input, mv = i.moveVector();
      if (g.player.dead) this.release();
      else if (!this.valid(this.seat)) this.stand();
      else if (i.isDown('jump') || i.touch.jump || Math.hypot(mv.x, mv.y) > 0.2 || i.wasPressed('interact') || i.touch.interactPressed) {
        this.consumed = true;
        this.stand();
      }
    }
    if (!simulate || g.player.dead || g.dm || g.boats.riding || g.player.waitingForGround || g.build?.usesFreeCamera()) {
      this.nearby = {};
      this.publish();
      return;
    }
    this.scanIn -= dt;
    if (this.scanIn <= 0) { this.scanIn = 0.25; this.scan(); }
  }

  private valid(t: Furniture): boolean {
    if (t.object) return this.game.build?.objects.get(t.object.id) === t.object &&
      t.object.x === t.x && t.object.y === t.y && t.object.z === t.z && t.object.rotation === t.yaw;
    return BLOCK_DEFS[this.game.world.get(Math.floor(t.x), t.y, Math.floor(t.z))]?.interact === (t.action === 'sleep' ? 'bed' : 'sit');
  }

  private reachable(t: Furniture): boolean {
    const g = this.game, p = g.player.position;
    if (!this.valid(t) || !g.chunks.isReady(t.x, t.z) || Math.abs(p.y - t.y) > 1.5) return false;
    const dx = p.x - t.x, dz = p.z - t.z;
    if (dx * dx + dz * dz > REACH * REACH) return false;
    g.player.eyePosition(this.eye);
    this.dir.set(t.x, t.y + 0.55, t.z).sub(this.eye);
    const dist = this.dir.length();
    const hit = raycastBlocks(g.world, this.eye, this.dir.normalize(), dist);
    if (hit && (t.object || hit.x !== Math.floor(t.x) || hit.y !== t.y || hit.z !== Math.floor(t.z))) return false;
    // Build Home furniture can obstruct access too (for example a closed door).
    const obj = g.build?.objects.raycast(this.eye, this.dir, dist, (o) => o.id !== t.object?.id);
    return !obj;
  }

  private scan(): void {
    this.nearby = {};
    const g = this.game, p = g.player.position;
    const consider = (t: Furniture) => {
      const current = this.nearby[t.action];
      const distance = (p.x - t.x) ** 2 + (p.z - t.z) ** 2;
      if (current && distance >= (p.x - current.x) ** 2 + (p.z - current.z) ** 2) return;
      if (this.reachable(t)) this.nearby[t.action] = t;
    };
    if (g.build) {
      for (const o of g.build.objects.query(p.x - REACH, p.y - 1.5, p.z - REACH, p.x + REACH, p.y + 2, p.z + REACH)) {
        if (o.def.interaction === 'bed' || o.def.interaction === 'sit') consider(this.fromObject(o));
      }
    }
    for (let y = Math.floor(p.y) - 1; y <= Math.floor(p.y) + 1; y++) {
      for (let x = Math.floor(p.x) - 3; x <= Math.floor(p.x) + 3; x++) {
        for (let z = Math.floor(p.z) - 3; z <= Math.floor(p.z) + 3; z++) {
          const def = BLOCK_DEFS[g.world.get(x, y, z)];
          if (def?.interact === 'bed' || def?.interact === 'sit') consider({
            action: def.interact === 'bed' ? 'sleep' : 'sit', name: def.name, x: x + 0.5, y, z: z + 0.5,
            // Voxel models rotate in the opposite direction to THREE object models.
            yaw: -(g.world.getMeta(x, y, z) & 3) * Math.PI / 2, height: 9 / 16,
          });
        }
      }
    }
    this.publish();
  }

  private fromObject(o: PlacedObject): Furniture {
    return { action: o.def.interaction === 'bed' ? 'sleep' : 'sit', name: o.def.name,
      x: o.x, y: o.y, z: o.z, yaw: o.rotation, height: o.def.seatHeight ?? 0.5, object: o };
  }

  /** Aimed furniture keeps its existing F / touch interaction. */
  useObject(o: PlacedObject): void {
    const t = this.fromObject(o);
    if (this.game.build?.usesFreeCamera() || !this.reachable(t)) {
      useGameStore.getState().toast('Walk close to the furniture to use it.', 'info');
      return;
    }
    this.use(t);
  }

  activate(action: Action): void {
    if (this.seated) { this.stand(); return; }
    if (useGameStore.getState().overlay !== null || this.game.player.dead) return;
    this.scan(); // Revalidate after movement, deletion or edits by a friend.
    const t = this.nearby[action];
    if (t) this.use(t);
  }

  /** F / ✋ also works without having to aim precisely at nearby furniture. */
  interactNearby(): void {
    this.scan();
    const p = this.game.player.position;
    const list = Object.values(this.nearby).sort((a, b) =>
      (p.x - a.x) ** 2 + (p.z - a.z) ** 2 - (p.x - b.x) ** 2 - (p.z - b.z) ** 2);
    if (list[0]) this.use(list[0]);
  }

  private use(t: Furniture): void {
    const g = this.game;
    if (t.action === 'sleep') {
      g.pendingBed = { x: Math.floor(t.x), y: t.y, z: Math.floor(t.z), objectId: t.object?.id };
      g.openOverlay('sleep');
      return;
    }
    if (this.seat || g.boats.riding || !this.reachable(t)) return;
    // Check the space above the seat; ignore this chair's own collider.
    const pos = new THREE.Vector3(t.x, t.y + t.height + 0.12, t.z);
    if (!this.fits(pos, 1.1, t.object?.id)) {
      useGameStore.getState().toast('There is not enough room above this chair.', 'warn');
      return;
    }
    this.exit.copy(g.player.position);
    g.player.flying = false;
    if (g.build) useBuildStore.getState().set({ flying: false });
    g.player.teleport(t.x, t.y + t.height - 0.3, t.z);
    // teleport releases old seating before moving, so assign afterwards.
    this.seat = t;
    g.player.seated = true;
    g.player.body.grounded = true;
    g.player.yaw = g.player.bodyYaw = t.yaw + (t.object ? Math.PI : 0);
    g.audio.play('click');
    this.publish();
  }

  private fits(p: THREE.Vector3, height = 1.62, ignoreObject?: number): boolean {
    const g = this.game, r = 0.3, eps = 0.01;
    if (!g.chunks.isReady(p.x, p.z)) return false;
    const boxes = g.world.collectBoxes(p.x - r, p.y + eps, p.z - r, p.x + r, p.y + height, p.z + r, this.boxes, ignoreObject === undefined);
    if (ignoreObject !== undefined && g.build) {
      for (const o of g.build.objects.query(p.x - r, p.y, p.z - r, p.x + r, p.y + height, p.z + r)) {
        if (o.id !== ignoreObject) boxes.push(...g.build.objects.collisionBoxes(o));
      }
    }
    for (let i = 0; i < boxes.length; i += 6) {
      if (boxes[i] < p.x + r && boxes[i + 3] > p.x - r && boxes[i + 1] < p.y + height && boxes[i + 4] > p.y + eps && boxes[i + 2] < p.z + r && boxes[i + 5] > p.z - r) return false;
    }
    return true;
  }

  private findExit(): THREE.Vector3 | null {
    if (!this.seat) return null;
    const t = this.seat;
    let pos: THREE.Vector3 | null = this.fits(this.exit) ? this.exit : null;
    const radius = t.object ? Math.hypot(t.object.def.size[0], t.object.def.size[2]) / 2 + 0.65 : 1.2;
    for (let i = 0; !pos && i < 8; i++) {
      const a = t.yaw + i * Math.PI / 4;
      const candidate = new THREE.Vector3(t.x + Math.sin(a) * radius, this.exit.y, t.z + Math.cos(a) * radius);
      if (this.fits(candidate)) pos = candidate;
    }
    return pos;
  }

  /** Saves resume beside the chair, so a seated body is never saved inside furniture. */
  savePosition(): THREE.Vector3 { return this.seat ? this.findExit() ?? this.exit : this.game.player.position; }

  stand(): void {
    if (!this.seat) return;
    const pos = this.findExit();
    if (!pos) { useGameStore.getState().toast('The chair exit is blocked. Clear some space nearby.', 'warn'); return; }
    this.release();
    this.game.player.teleport(pos.x, pos.y, pos.z);
  }

  release(): void {
    if (this.seat) this.game.player.seated = false;
    this.seat = null;
    this.scanIn = 0;
    this.publish();
  }

  private publish(): void {
    const next = { bed: this.nearby.sleep?.name ?? null, chair: this.nearby.sit?.name ?? null, seated: this.seated };
    const old = useRestStore.getState();
    if (old.bed !== next.bed || old.chair !== next.chair || old.seated !== next.seated) useRestStore.setState(next);
  }

  dispose(): void { this.release(); this.nearby = {}; this.publish(); }
}
