import * as THREE from 'three';
import { makeStack } from '../systems/InventoryLogic';
import { mat } from '../rendering/Models';
import { SHAPE } from '../world/BlockRegistry';
import type { Game } from '../Game';
import type { Creature } from './EntityManager';

/**
 * Arrows. Simple ballistic flight with gravity, swept against blocks,
 * creatures and (in PvP) other players. The shooter's game decides hits — in
 * PvP the hit is then sent to the victim, whose armor & shield apply.
 */
export interface Arrow {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  damage: number;
  /** 'me' = shot by the local player (it can hit things); otherwise a remote player's id (visual only). */
  owner: string;
  stuck: number;
  life: number;
}

const GRAVITY = 14;
const SHAFT = mat('#c49563');
const HEAD = mat('#8a8f96');
const FLETCH = mat('#f2ead8');

function arrowMesh(): THREE.Group {
  const g = new THREE.Group();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const shaft = new THREE.Mesh(box, SHAFT);
  shaft.scale.set(0.035, 0.035, 0.7);
  const head = new THREE.Mesh(box, HEAD);
  head.scale.set(0.07, 0.07, 0.12);
  head.position.z = 0.38;
  const f1 = new THREE.Mesh(box, FLETCH);
  f1.scale.set(0.12, 0.01, 0.14);
  f1.position.z = -0.3;
  const f2 = f1.clone();
  f2.rotation.z = Math.PI / 2;
  g.add(shaft, head, f1, f2);
  return g;
}

export class Projectiles {
  readonly group = new THREE.Group();
  readonly arrows: Arrow[] = [];
  private tmp = new THREE.Vector3();
  private look = new THREE.Vector3();
  /** PvP hook: test an arrow segment against remote players; returns true when it hit someone. */
  hitRemote: ((from: THREE.Vector3, to: THREE.Vector3, arrow: Arrow) => boolean) | null = null;

  constructor(private game: Game) {
    this.group.name = 'arrows';
  }

  shoot(origin: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number, owner = 'me'): Arrow {
    const mesh = arrowMesh();
    this.group.add(mesh);
    const a: Arrow = { mesh, pos: origin.clone(), vel: dir.clone().normalize().multiplyScalar(speed), damage, owner, stuck: 0, life: 0 };
    this.orient(a);
    this.arrows.push(a);
    if (this.arrows.length > 60) this.remove(this.arrows[0]);
    return a;
  }

  private orient(a: Arrow) {
    a.mesh.position.copy(a.pos);
    this.look.copy(a.pos).add(a.vel);
    a.mesh.lookAt(this.look);
  }

  remove(a: Arrow): void {
    this.group.remove(a.mesh);
    const i = this.arrows.indexOf(a);
    if (i >= 0) this.arrows.splice(i, 1);
  }

  clear(): void {
    for (const a of [...this.arrows]) this.remove(a);
  }

  update(dt: number): void {
    const g = this.game;
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.life += dt;
      if (a.stuck > 0) {
        a.stuck -= dt;
        if (a.stuck <= 0) this.remove(a);
        continue;
      }
      if (a.life > 6 || a.pos.y < -10) {
        this.remove(a);
        continue;
      }
      a.vel.y -= GRAVITY * dt;
      const steps = Math.max(1, Math.ceil((a.vel.length() * dt) / 0.25));
      const sdt = dt / steps;
      let done = false;
      for (let s = 0; s < steps && !done; s++) {
        const from = this.tmp.copy(a.pos);
        a.pos.addScaledVector(a.vel, sdt);
        // creatures (local arrows only)
        if (a.owner === 'me') {
          const c = this.creatureAt(a.pos);
          if (c) {
            g.entities.damage(c, a.damage, from, false);
            g.audio.play('arrowHit', { pos: a.pos });
            this.remove(a);
            done = true;
            break;
          }
          if (this.hitRemote?.(from, a.pos, a)) {
            this.remove(a);
            done = true;
            break;
          }
        }
        const x = Math.floor(a.pos.x), y = Math.floor(a.pos.y), z = Math.floor(a.pos.z);
        const id = g.world.get(x, y, z);
        if (g.world.isSolid(x, y, z) && SHAPE[id] !== 2) {
          a.pos.copy(from);
          a.stuck = 8;
          g.audio.play('arrowHit', { pos: a.pos, pitch: 1.3 });
          // sometimes you can pick your arrow back up
          if (a.owner === 'me' && Math.random() < 0.45 && !g.pvp) g.drops.spawn(makeStack('arrow', 1), a.pos.x, a.pos.y + 0.2, a.pos.z, 0.1, 0.6);
          done = true;
        }
      }
      if (!done || a.stuck > 0) this.orient(a);
    }
  }

  private creatureAt(p: THREE.Vector3): Creature | null {
    for (const c of this.game.entities.creatures) {
      if (c.fade || c.tamed) continue;
      const r = c.def.radius + 0.15;
      const b = c.body.pos;
      if (p.x > b.x - r && p.x < b.x + r && p.z > b.z - r && p.z < b.z + r && p.y > b.y - 0.1 && p.y < b.y + c.def.height + 0.15) return c;
    }
    return null;
  }
}
