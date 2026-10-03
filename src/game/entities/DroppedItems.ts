import * as THREE from 'three';
import { itemDef } from '../../data/items';
import { HOTBAR_SIZE, useInventoryStore } from '../../stores/inventoryStore';
import { blockId } from '../world/BlockRegistry';
import { blockObject } from '../rendering/BlockGeometry';
import { addStack, cloneSlots, type ItemStack } from '../systems/InventoryLogic';
import type { Game } from '../Game';

interface Drop {
  stack: ItemStack;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  delay: number;
  obj: THREE.Object3D;
  phase: number;
  flying: boolean;
  /** PvP loot: the same id on every player's screen. Picking it up needs the host's OK (no duplicates). */
  netId?: string;
  /** When we last asked the host for it (performance.now()). */
  asked?: number;
}

const MAX_DROPS = 140;
const DESPAWN = 300;
/** PvP loot lies around for 3 minutes. */
const NET_DESPAWN = 180;
const NET_PICKUP_RANGE = 1.9;

/** Would at least part of this stack fit in the backpack? */
function roomFor(stack: ItemStack): boolean {
  const inv = useInventoryStore.getState();
  const slots = cloneSlots(inv.slots);
  return addStack(slots, { ...stack }, 0, HOTBAR_SIZE + inv.packCapacity()) < stack.count;
}

/**
 * Floating item pickups: pop out of broken blocks, bob gently, drift toward the
 * player at short range and auto-collect. Nearby identical stacks merge, the
 * total is capped and old drops despawn.
 */
export class DroppedItems {
  readonly group = new THREE.Group();
  private drops: Drop[] = [];
  private mergeTimer = 0;
  /** PvP: walked onto shared loot — ask the host whether we get it. */
  onNetPickup: ((netId: string) => void) | null = null;

  constructor(private game: Game) {
    this.group.name = 'drops';
  }

  get count(): number {
    return this.drops.length;
  }

  spawn(stack: ItemStack, x: number, y: number, z: number, burst = 1, delay = 0.35): void {
    if (stack.count <= 0) return;
    if (this.drops.length >= MAX_DROPS) this.remove(this.drops.find((d) => !d.netId) ?? this.drops[0]);
    const def = itemDef(stack.item);
    let obj: THREE.Object3D;
    if (def.placeBlock) {
      obj = blockObject(blockId(def.placeBlock), def.placeMeta ?? 0, this.game.assets.materials);
      obj.scale.setScalar(0.28);
    } else {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.game.assets.spriteTexture(stack.item), alphaTest: 0.4, fog: true }));
      sprite.scale.setScalar(0.42);
      obj = sprite;
    }
    const a = Math.random() * Math.PI * 2;
    const d: Drop = {
      stack: { ...stack }, pos: new THREE.Vector3(x, y, z),
      vel: new THREE.Vector3(Math.cos(a) * 1.6 * burst, 3.2 * burst + Math.random(), Math.sin(a) * 1.6 * burst),
      age: 0, delay, obj, phase: Math.random() * 6, flying: false,
    };
    obj.position.copy(d.pos);
    this.group.add(obj);
    this.drops.push(d);
  }

  /** PvP loot from a defeated player: identical position & motion on every screen. */
  spawnNet(netId: string, stack: ItemStack, x: number, y: number, z: number, vx: number, vz: number): void {
    if (this.drops.some((d) => d.netId === netId)) return;
    this.spawn(stack, x, y, z, 0, 0.8);
    const d = this.drops[this.drops.length - 1];
    d.netId = netId;
    d.vel.set(vx, 4.2, vz);
  }

  /** Someone else picked it up (or it's gone): remove it here too. */
  removeNet(netId: string): void {
    const d = this.drops.find((x) => x.netId === netId);
    if (d) this.remove(d);
  }

  /** The host gave us this loot: into the backpack (whatever doesn't fit pops back out as a normal drop). */
  takeNet(netId: string): ItemStack | null {
    const d = this.drops.find((x) => x.netId === netId);
    if (!d) return null;
    const stack = { ...d.stack };
    this.remove(d);
    const left = useInventoryStore.getState().addStackObj(stack);
    const got = stack.count - left;
    if (got > 0) {
      this.game.audio.play('pickup', { pitch: 1 + Math.random() * 0.2 });
      this.game.bus.emit('itemCollected', { item: stack.item, count: got });
    }
    if (left > 0) this.throwFromPlayer({ ...stack, count: left });
    return stack;
  }

  /** New PvP round: all shared loot vanishes. */
  clearNet(): void {
    for (const d of this.drops.filter((x) => x.netId)) this.remove(d);
  }

  /** Drop from the player toward where they look (Q key / death). */
  throwFromPlayer(stack: ItemStack): void {
    const p = this.game.player;
    const eye = p.eyePosition();
    const dir = p.lookDirection();
    this.spawn(stack, eye.x + dir.x * 0.6, eye.y - 0.3, eye.z + dir.z * 0.6, 0, 1.4);
    const d = this.drops[this.drops.length - 1];
    d.vel.set(dir.x * 4, dir.y * 3 + 2, dir.z * 4);
  }

  private remove(d: Drop) {
    this.group.remove(d.obj);
    if ((d.obj as THREE.Sprite).isSprite) ((d.obj as THREE.Sprite).material as THREE.Material).dispose();
    const i = this.drops.indexOf(d);
    if (i >= 0) this.drops.splice(i, 1);
  }

  update(dt: number): void {
    const world = this.game.world;
    const player = this.game.player;
    const pp = player.position;
    const inv = useInventoryStore.getState();
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      d.delay -= dt;
      if (d.age > (d.netId ? NET_DESPAWN : DESPAWN)) {
        this.remove(d);
        continue;
      }
      const dx = pp.x - d.pos.x, dy = pp.y + 0.8 - d.pos.y, dz = pp.z - d.pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d.netId) {
        // shared loot: no magnet (two players may be reaching for it) — ask the host, at most every 1.2 s
        const now = performance.now();
        if (d.delay <= 0 && dist < NET_PICKUP_RANGE && !player.dead && now - (d.asked ?? 0) > 1200 && roomFor(d.stack)) {
          d.asked = now;
          this.onNetPickup?.(d.netId);
        }
      }
      if (!d.netId && d.delay <= 0 && dist < 2.4 && !player.dead) {
        // magnet toward the player
        d.flying = true;
        const k = Math.min(1, dt * 10);
        d.vel.set(dx * 7, dy * 7, dz * 7).multiplyScalar(k * 1.4 + 0.2);
        d.pos.addScaledVector(d.vel, dt);
        if (dist < 0.7) {
          const left = inv.addStackObj(d.stack);
          const got = d.stack.count - left;
          if (got > 0) {
            this.game.audio.play('pickup', { pitch: 1 + Math.random() * 0.2 });
            this.game.bus.emit('itemCollected', { item: d.stack.item, count: got });
          }
          if (left <= 0) {
            this.remove(d);
            continue;
          }
          d.stack.count = left;
          d.delay = 2; // backpack full — wait a bit
          d.flying = false;
        }
      } else {
        d.flying = false;
        d.vel.y -= 18 * dt;
        d.vel.x *= Math.pow(0.1, dt);
        d.vel.z *= Math.pow(0.1, dt);
        const nx = d.pos.x + d.vel.x * dt, ny = d.pos.y + d.vel.y * dt, nz = d.pos.z + d.vel.z * dt;
        if (world.isSolid(Math.floor(nx), Math.floor(d.pos.y), Math.floor(nz))) {
          d.vel.x = d.vel.z = 0;
        } else {
          d.pos.x = nx;
          d.pos.z = nz;
        }
        const floorY = Math.floor(ny - 0.15);
        const h = world.collisionHeight(Math.floor(d.pos.x), floorY, Math.floor(d.pos.z));
        if (d.vel.y < 0 && h > 0 && ny - 0.15 < floorY + h) {
          d.pos.y = floorY + h + 0.15;
          d.vel.y = 0;
        } else d.pos.y = ny;
        // inside a block (e.g. placed on top): pop up
        if (world.isOpaque(Math.floor(d.pos.x), Math.floor(d.pos.y), Math.floor(d.pos.z))) d.pos.y += dt * 4;
        if (d.pos.y < -20) {
          this.remove(d);
          continue;
        }
      }
      d.obj.position.set(d.pos.x, d.pos.y + (d.flying ? 0 : 0.1 + Math.sin(this.game.time * 2.4 + d.phase) * 0.06), d.pos.z);
      d.obj.rotation.y += dt * 1.4;
    }
    this.mergeTimer -= dt;
    if (this.mergeTimer <= 0) {
      this.mergeTimer = 0.6;
      this.merge();
    }
  }

  private merge() {
    for (let i = 0; i < this.drops.length; i++) {
      const a = this.drops[i];
      if (a.stack.durability !== undefined || a.netId) continue;
      const max = itemDef(a.stack.item).maxStack;
      for (let j = this.drops.length - 1; j > i; j--) {
        const b = this.drops[j];
        if (b.stack.item !== a.stack.item || b.stack.durability !== undefined || b.netId) continue;
        if (a.pos.distanceToSquared(b.pos) > 1.3 || a.stack.count + b.stack.count > max) continue;
        a.stack.count += b.stack.count;
        a.age = Math.min(a.age, b.age);
        this.remove(b);
      }
    }
  }

  serialize(): { stack: ItemStack; x: number; y: number; z: number; age: number }[] {
    return this.drops.filter((d) => !d.netId).map((d) => ({ stack: d.stack, x: d.pos.x, y: d.pos.y, z: d.pos.z, age: d.age }));
  }

  load(list: { stack: ItemStack; x: number; y: number; z: number; age: number }[]): void {
    for (const d of list) {
      this.spawn(d.stack, d.x, d.y, d.z, 0, 0);
      this.drops[this.drops.length - 1].age = d.age;
    }
  }

  clear(): void {
    for (const d of [...this.drops]) this.remove(d);
  }
}
