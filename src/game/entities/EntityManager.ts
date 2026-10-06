import * as THREE from 'three';
import { BIOMES } from '../../data/biomes';
import { CREATURES, FRIENDLY_KINDS, HOSTILE_KINDS, type CreatureDef, type CreatureKind } from '../../data/creatures';
import { BLOCK_DEFS } from '../../data/blocks';
import { useGameStore } from '../../stores/gameStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useWorldStore } from '../../stores/worldStore';
import { B } from '../world/BlockRegistry';
import { CHUNK_SIZE } from '../world/constants';
import { animateCreature, buildCreature, type Rig } from '../rendering/Models';
import { makeStack } from '../systems/InventoryLogic';
import { moveBody, type Body } from '../player/VoxelPhysics';
import type { Game } from '../Game';

export type AIState =
  | 'idle' | 'wander' | 'graze' | 'flee' | 'follow' | 'eat' | 'sleep' | 'interested' | 'avoid' | 'chase' | 'attack' | 'sit' | 'burrow';

export interface Creature {
  id: number;
  kind: CreatureKind;
  def: CreatureDef;
  rig: Rig;
  body: Body;
  yaw: number;
  state: AIState;
  stateTime: number;
  health: number;
  flash: number;
  action: number;
  cooldown: number;
  target: THREE.Vector3 | null;
  aiTimer: number;
  friendship: number;
  followUntil: number;
  giftReadyAt: number;
  tamed: boolean;
  sitting: boolean;
  soundTimer: number;
  fade: number;
  hover: number;
  seen: boolean;
  shadow: THREE.Mesh;
  knock: THREE.Vector3;
}

const SHADOW_GEO = new THREE.CircleGeometry(0.5, 16).rotateX(-Math.PI / 2);
const SHADOW_MAT = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.25, depthWrite: false });
const FLASH_MAT = new THREE.MeshBasicMaterial({ color: '#ffffff' });
const DIRS8 = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/**
 * Plain-TypeScript entity system (no React per creature). AI runs as small
 * state machines with distance tiers: near = every frame + 10 Hz decisions,
 * medium = 3 Hz decisions, far = asleep and hidden.
 */
export class EntityManager {
  readonly group = new THREE.Group();
  readonly creatures: Creature[] = [];
  private nextId = 1;
  private spawnTimer = 2;
  private warnTimer = 0;
  private sniffTimer = 120;
  private tmp = new THREE.Vector3();

  constructor(private game: Game) {
    this.group.name = 'creatures';
  }

  get companion(): Creature | undefined {
    return this.creatures.find((c) => c.tamed);
  }

  hostileNear(radius: number): number {
    const p = this.game.player.position;
    let n = 0;
    for (const c of this.creatures) if (c.def.hostile && c.fade === 0 && c.body.pos.distanceTo(p) < radius) n++;
    return n;
  }

  spawn(kind: CreatureKind, x: number, y: number, z: number): Creature {
    const def = CREATURES[kind];
    const rig = buildCreature(kind);
    const shadow = new THREE.Mesh(SHADOW_GEO, SHADOW_MAT);
    shadow.scale.setScalar(def.radius * 2.2);
    shadow.renderOrder = 1;
    const c: Creature = {
      id: this.nextId++, kind, def, rig,
      body: { pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), halfW: Math.min(0.45, def.radius), height: def.height, grounded: false },
      yaw: Math.random() * Math.PI * 2, state: 'idle', stateTime: 0, health: def.health, flash: 0, action: 0, cooldown: 0, target: null,
      aiTimer: Math.random(), friendship: 0, followUntil: 0, giftReadyAt: 0, tamed: false, sitting: false, soundTimer: 4 + Math.random() * 10,
      fade: 0, hover: def.flies ? 1 + Math.random() * 1.5 : 0, seen: false, shadow, knock: new THREE.Vector3(),
    };
    rig.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.userData.mat = m.material;
    });
    this.group.add(rig.root);
    this.group.add(shadow);
    this.creatures.push(c);
    return c;
  }

  remove(c: Creature): void {
    this.group.remove(c.rig.root);
    this.group.remove(c.shadow);
    const i = this.creatures.indexOf(c);
    if (i >= 0) this.creatures.splice(i, 1);
  }

  clear(): void {
    for (const c of [...this.creatures]) this.remove(c);
  }

  // ---------------------------------------------------------------- spawning

  trySpawn(): void {
    const g = this.game;
    const p = g.player.position;
    const harmony = useWorldStore.getState().harmony;
    let friendly = 0, hostile = 0;
    for (const c of this.creatures) {
      if (c.body.pos.distanceTo(p) > 72) continue;
      if (c.def.hostile) hostile++;
      else if (!c.tamed) friendly++;
    }
    const friendlyCap = 9 + (harmony > 40 ? 4 : harmony > 15 ? 2 : 0) - (harmony < -20 ? 4 : 0);
    const daylight = g.clock.daylight;
    const peaceful = g.difficulty === 'peaceful' || g.peacefulCreatures;
    const firstNight = g.clock.day <= 1;
    // nights are dangerous: many more hunters roam in the dark (lit / roofed places stay safe)
    const night = g.clock.daylight < 0.3;
    const hostileCap = peaceful ? 0 : !night ? (g.difficulty === 'adventurer' ? 6 : 3) : g.difficulty === 'adventurer' ? 18 : firstNight ? 5 : 12;

    const look = g.player.lookDirection(this.tmp);
    for (let attempt = 0; attempt < 3; attempt++) {
      const wantHostile = hostile < hostileCap && Math.random() < 0.55;
      if (!wantHostile && friendly >= friendlyCap) continue;
      const a = Math.random() * Math.PI * 2;
      const minD = wantHostile ? (firstNight ? 26 : night ? 18 : 22) : 22;
      const d = minD + Math.random() * (wantHostile && night ? 16 : 20);
      const x = Math.floor(p.x + Math.cos(a) * d), z = Math.floor(p.z + Math.sin(a) * d);
      // never pop into existence in front of the player
      if (Math.cos(a) * look.x + Math.sin(a) * look.z > 0.55) continue;
      if (!g.chunks.isReady(x, z)) continue;
      const chunk = g.world.chunkAt(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
      if (!chunk) continue;
      const biome = BIOMES[chunk.biomes[(((z % 16) + 16) % 16) * 16 + (((x % 16) + 16) % 16)]].id;
      const surface = g.world.standableY(x, z);
      const topId = g.world.get(x, surface, z);

      let y = surface + 1;
      let habitat: 'surface' | 'cave' | 'water' = 'surface';
      if (wantHostile && p.y < surface - 8) {
        // cave spawn near the player's depth
        habitat = 'cave';
        y = -1;
        for (let yy = Math.floor(p.y) + 6; yy > Math.floor(p.y) - 8; yy--) {
          if (g.world.isSolid(x, yy - 1, z) && !g.world.isSolid(x, yy, z) && !g.world.isSolid(x, yy + 1, z) && g.world.get(x, yy, z) !== B.WATER) {
            y = yy;
            break;
          }
        }
        if (y < 0) continue;
      } else if (topId === B.WATER) {
        if (!wantHostile) continue;
        habitat = 'water';
        // find shore next to water
        let found = false;
        for (let k = 0; k < 8 && !found; k++) {
          const sx = x + Math.round(Math.cos(k) * 3), sz = z + Math.round(Math.sin(k) * 3);
          const sy = g.world.standableY(sx, sz);
          if (g.world.get(sx, sy, sz) !== B.WATER && g.world.isSolid(sx, sy, sz)) {
            y = sy + 1;
            found = true;
          }
        }
        if (!found) continue;
      } else if (!g.world.isSolid(x, surface, z) || BLOCK_DEFS[topId].key.includes('leav')) continue;

      const light = g.world.lightAt(x, y, z, daylight);
      const kinds = (wantHostile ? HOSTILE_KINDS : FRIENDLY_KINDS).filter((k) => {
        const def = CREATURES[k];
        if (def.habitat !== habitat && !(habitat === 'surface' && def.habitat === 'water' && Math.random() < 0.3)) return false;
        if (def.biomes !== 'any' && !def.biomes.includes(biome)) return false;
        if (def.time === 'day' && daylight < 0.4) return false;
        if (def.time === 'night' && daylight > 0.35 && habitat !== 'cave') return false;
        if (k === 'fenn' && (this.creatures.some((c) => c.kind === 'fenn') || Math.random() > 0.35)) return false;
        return true;
      });
      if (!kinds.length) continue;
      if (wantHostile) {
        if (light >= 7) continue; // lit areas (torches, homes, daylight) are safe
        if (habitat === 'surface' && g.world.surfaceY(x, z) > y + 1) continue; // under a roof
      }
      let total = 0;
      for (const k of kinds) total += CREATURES[k].weight;
      let pick = Math.random() * total;
      let kind = kinds[0];
      for (const k of kinds) {
        pick -= CREATURES[k].weight;
        if (pick <= 0) {
          kind = k;
          break;
        }
      }
      const def = CREATURES[kind];
      const n = Math.min(wantHostile ? hostileCap - hostile : friendlyCap - friendly,
        def.groupSize[0] + Math.floor(Math.random() * (def.groupSize[1] - def.groupSize[0] + 1)));
      for (let i = 0; i < n; i++) {
        const ox = x + (i ? Math.round((Math.random() - 0.5) * 4) : 0), oz = z + (i ? Math.round((Math.random() - 0.5) * 4) : 0);
        const oy = habitat === 'cave' ? y : g.world.standableY(ox, oz) + 1;
        if (habitat !== 'cave' && g.world.get(ox, oy - 1, oz) === B.WATER && habitat !== 'water') continue;
        this.spawn(kind, ox + 0.5, oy + (def.flies ? 1 : 0), oz + 0.5);
      }
      if (wantHostile) hostile += n;
      else friendly += n;
    }
  }

  // ---------------------------------------------------------------- update

  update(dt: number): void {
    const g = this.game;
    const p = g.player.position;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = g.clock.daylight < 0.3 ? 1.1 : 1.6;
      this.trySpawn();
    }
    this.nightDirector(dt);
    const heldItem = useInventoryStore.getState().selectedStack()?.item;
    const shadowsOn = useSettingsStore.getState().graphics.shadows;
    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i];
      const dist = c.body.pos.distanceTo(p);
      // despawn far creatures (companions follow you instead)
      if (dist > 88 && !c.tamed) {
        this.remove(c);
        continue;
      }
      if (c.tamed && dist > 48 && !c.sitting) {
        const ty = g.world.standableY(Math.floor(p.x + 1), Math.floor(p.z + 1)) + 1;
        c.body.pos.set(p.x + 1, ty, p.z + 1);
      }
      const far = dist > 56;
      c.rig.root.visible = !far;
      c.shadow.visible = !far && shadowsOn;
      if (far) continue;
      if (!g.chunks.isReady(c.body.pos.x, c.body.pos.z)) continue;

      if (c.fade > 0) {
        c.fade += dt * 2;
        c.rig.root.scale.setScalar(Math.max(0.01, 1 - (c.fade - 1)));
        if (c.fade >= 2) {
          this.remove(c);
          continue;
        }
        continue;
      }

      // AI decisions (tiered rate)
      c.aiTimer -= dt;
      if (c.aiTimer <= 0) {
        c.aiTimer = dist < 24 ? 0.1 : 0.33;
        this.think(c, dist, heldItem);
      }
      c.stateTime += dt;
      this.move(c, dt, dist);

      // idle sounds
      c.soundTimer -= dt;
      if (c.soundTimer <= 0) {
        c.soundTimer = 6 + Math.random() * 14;
        if (dist < 28 && c.state !== 'sleep') {
          g.audio.creature(c.kind, 'idle', c.body.pos);
          if (c.def.hostile && c.def.subtitle && useSettingsStore.getState().accessibility.subtitles && dist < 18) {
            useGameStore.getState().setSubtitle(c.def.subtitle, this.direction(c.body.pos));
          }
        }
      }
      if (!c.seen && dist < 12) {
        c.seen = true;
        g.bus.emit('creatureSeen', { kind: c.kind });
      }
      // visuals
      c.flash = Math.max(0, c.flash - dt);
      c.action = Math.max(0, c.action - dt * 2.5);
      this.render(c, dt);
    }
    this.companionDuties(dt);
  }

  private direction(pos: THREE.Vector3): string {
    const p = this.game.player.position;
    const a = Math.atan2(pos.x - p.x, -(pos.z - p.z));
    const i = Math.round(((a / (Math.PI * 2)) * 8 + 8) % 8) % 8;
    return DIRS8[i];
  }

  private setState(c: Creature, s: AIState) {
    if (c.state !== s) {
      c.state = s;
      c.stateTime = 0;
    }
  }

  private pickWanderTarget(c: Creature, radius = 8): THREE.Vector3 | null {
    const w = this.game.world;
    for (let k = 0; k < 6; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * radius;
      const x = Math.floor(c.body.pos.x + Math.cos(a) * r), z = Math.floor(c.body.pos.z + Math.sin(a) * r);
      if (!w.isLoaded(x, z)) continue;
      const y = w.standableY(x, z);
      if (Math.abs(y + 1 - c.body.pos.y) > 3) continue;
      if (w.get(x, y, z) === B.WATER && c.def.habitat !== 'water') continue;
      return new THREE.Vector3(x + 0.5, y + 1, z + 0.5);
    }
    return null;
  }

  private think(c: Creature, dist: number, held: string | undefined) {
    const g = this.game;
    const p = g.player.position;
    const def = c.def;
    const night = g.clock.daylight < 0.3;
    if (def.hostile) {
      // shy creatures retreat at dawn
      if (def.shy && g.clock.daylight > 0.55 && g.world.surfaceY(Math.floor(c.body.pos.x), Math.floor(c.body.pos.z)) <= c.body.pos.y) {
        this.poof(c);
        return;
      }
      if (c.kind === 'nightling' && c.stateTime > 0.5 && Math.random() < 0.3) {
        const light = g.world.lightAt(Math.floor(c.body.pos.x), Math.floor(c.body.pos.y), Math.floor(c.body.pos.z), g.clock.daylight);
        if (light >= 8) {
          this.setState(c, 'flee');
          c.target = c.body.pos.clone().add(c.body.pos.clone().sub(p).setY(0).normalize().multiplyScalar(10));
          return;
        }
      }
      if (c.state === 'flee' && c.stateTime < 3) return;
      const canSee = !g.player.dead && dist < (def.aggroRange ?? 12) && Math.abs(p.y - c.body.pos.y) < 6;
      if (canSee) {
        this.setState(c, dist < (def.attackRange ?? 1.3) + 0.4 ? 'attack' : 'chase');
        c.target = p.clone();
        return;
      }
      // night hunters track you down from far away (they can smell you), but never into light
      if (night && def.shy && !g.player.dead && dist < 44 && !this.playerSafe()) {
        if (c.state !== 'wander' || c.stateTime > 2.5 || !c.target) {
          this.setState(c, 'wander');
          c.target = p.clone().add(this.tmp.set(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(3));
        }
        return;
      }
      if (c.state === 'chase' || c.state === 'attack') this.setState(c, 'idle');
    } else {
      // hurt recently → flee
      if (c.state === 'flee' && c.stateTime < 4) return;
      if (c.state === 'sit') return;
      // danger nearby → avoid
      for (const o of this.creatures) {
        if (!o.def.hostile || o.fade) continue;
        if (o.body.pos.distanceToSquared(c.body.pos) < 36) {
          this.setState(c, 'avoid');
          c.target = c.body.pos.clone().add(c.body.pos.clone().sub(o.body.pos).setY(0).normalize().multiplyScalar(8));
          return;
        }
      }
      if (c.tamed || c.followUntil > g.time) {
        if (dist > 3.2) {
          this.setState(c, 'follow');
          c.target = p.clone();
        } else if (c.state === 'follow') this.setState(c, 'idle');
        return;
      }
      if (held && def.favoriteFood?.includes(held) && dist < 7 && !g.player.dead) {
        this.setState(c, 'interested');
        c.target = dist > 2 ? p.clone() : null;
        return;
      }
      if (c.state === 'interested') this.setState(c, 'idle');
      const sleeper = def.time === 'day' && !def.flies;
      if (sleeper && night) {
        if (c.state !== 'sleep') this.setState(c, 'sleep');
        return;
      }
      if (c.state === 'sleep' && !night) this.setState(c, 'idle');
    }
    // idle / wander / graze cycle
    if (c.state === 'idle' && c.stateTime > 1.5 + Math.random() * 3) {
      const r = Math.random();
      if (!def.hostile && (c.kind === 'mossback' || c.kind === 'mudsnout' || c.kind === 'pufftail') && r < 0.35) this.setState(c, 'graze');
      else {
        c.target = this.pickWanderTarget(c);
        if (c.target) this.setState(c, 'wander');
      }
    } else if ((c.state === 'wander' && (!c.target || c.stateTime > 8)) || (c.state === 'graze' && c.stateTime > 3 + Math.random() * 3)) {
      this.setState(c, 'idle');
      c.target = null;
    }
  }

  private move(c: Creature, dt: number, dist: number) {
    const g = this.game;
    const b = c.body;
    const def = c.def;
    let speed = 0;
    let tgt: THREE.Vector3 | null = null;
    switch (c.state) {
      case 'wander': speed = def.hostile && def.shy && g.clock.daylight < 0.3 ? def.speed * 1.25 : def.speed; tgt = c.target; break;
      case 'follow': speed = def.speed * (dist > 8 ? 2 : 1.3); tgt = c.target; break;
      case 'interested': speed = def.speed * 0.8; tgt = c.target; break;
      case 'flee':
      case 'avoid': speed = def.speed * 1.9; tgt = c.target; break;
      case 'chase': speed = def.speed * 1.5; tgt = g.player.position; break;
      case 'attack': speed = 0.3; tgt = g.player.position; break;
      default: speed = 0;
    }
    let wantX = 0, wantZ = 0;
    if (tgt) {
      const dx = tgt.x - b.pos.x, dz = tgt.z - b.pos.z;
      const l = Math.hypot(dx, dz);
      if (l > 0.4) {
        wantX = (dx / l) * speed;
        wantZ = (dz / l) * speed;
        const targetYaw = Math.atan2(dx, dz);
        let d = targetYaw - c.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        c.yaw += d * Math.min(1, dt * 6);
      } else if (c.state === 'wander') {
        this.setState(c, 'idle');
        c.target = null;
      }
    }
    if (c.state === 'interested' || c.state === 'attack') {
      const dx = g.player.position.x - b.pos.x, dz = g.player.position.z - b.pos.z;
      c.yaw += (Math.atan2(dx, dz) - c.yaw) * Math.min(1, dt * 5);
    }
    // don't walk into deep water or off cliffs (unless fleeing or flying)
    if ((wantX || wantZ) && !def.flies && def.habitat !== 'water') {
      const ax = Math.floor(b.pos.x + Math.sign(wantX) * 0.8), az = Math.floor(b.pos.z + Math.sign(wantZ) * 0.8);
      const fy = Math.floor(b.pos.y);
      if (g.world.get(ax, fy, az) === B.WATER || g.world.get(ax, fy - 1, az) === B.WATER) {
        wantX = wantZ = 0;
        if (c.state === 'wander') this.setState(c, 'idle');
      } else if (!g.world.isSolid(ax, fy - 1, az) && !g.world.isSolid(ax, fy - 2, az) && !g.world.isSolid(ax, fy - 3, az) && c.state !== 'flee') {
        wantX = wantZ = 0;
        if (c.state === 'wander') this.setState(c, 'idle');
      }
    }
    b.vel.x += (wantX + c.knock.x - b.vel.x) * Math.min(1, dt * 8);
    b.vel.z += (wantZ + c.knock.z - b.vel.z) * Math.min(1, dt * 8);
    c.knock.multiplyScalar(Math.pow(0.02, dt));
    const inWater = g.world.get(Math.floor(b.pos.x), Math.floor(b.pos.y + 0.3), Math.floor(b.pos.z)) === B.WATER;
    if (def.flies) {
      const ground = g.world.standableY(Math.floor(b.pos.x), Math.floor(b.pos.z)) + 1;
      const want = ground + c.hover + Math.sin(g.time * 1.3 + c.id) * 0.3;
      b.vel.y += (want - b.pos.y) * dt * 3 - b.vel.y * dt * 2;
    } else if (inWater) {
      b.vel.y = Math.min(b.vel.y + 14 * dt, 1.5);
    } else b.vel.y -= 24 * dt;
    const res = moveBody(g.world, b, dt, 0.55);
    if ((res.hitX || res.hitZ) && b.grounded && (wantX || wantZ)) b.vel.y = 7.2; // hop over 1-block steps
    // attacking
    c.cooldown = Math.max(0, c.cooldown - dt);
    if (c.state === 'attack' && c.cooldown <= 0 && dist < (def.attackRange ?? 1.3) + 0.5) {
      c.cooldown = 1.3;
      c.action = 1;
      const mult = g.difficulty === 'adventurer' ? 1.5 : 1;
      g.audio.creature(c.kind, 'attack', b.pos);
      g.player.hurt((def.damage ?? 5) * mult, def.name, b.pos);
      useGameStore.setState({ hurtFlash: performance.now() });
    }
  }

  private render(c: Creature, dt: number) {
    const r = c.rig.root;
    r.position.copy(c.body.pos);
    r.rotation.y = c.yaw;
    const moving = Math.min(1, Math.hypot(c.body.vel.x, c.body.vel.z) / (c.def.speed * 1.9));
    animateCreature(c.kind, c.rig, {
      moving, time: this.game.time + c.id, action: c.action > 0 ? 1 - c.action : 0, grounded: c.body.grounded,
      sleeping: c.state === 'sleep', eating: c.state === 'graze', sitting: c.sitting,
    });
    // hit flash: swap to white briefly
    const flashing = c.flash > 0;
    if (flashing !== !!c.rig.root.userData.flashing) {
      c.rig.root.userData.flashing = flashing;
      c.rig.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.material = flashing ? FLASH_MAT : m.userData.mat;
      });
    }
    if (c.shadow.visible) {
      const gy = this.game.world.standableY(Math.floor(c.body.pos.x), Math.floor(c.body.pos.z)) + 1.02;
      c.shadow.position.set(c.body.pos.x, Math.min(gy, c.body.pos.y + 0.02), c.body.pos.z);
      const h = Math.max(0, c.body.pos.y - gy);
      (c.shadow.material as THREE.MeshBasicMaterial).opacity = 0.25;
      c.shadow.scale.setScalar(c.def.radius * 2.2 * Math.max(0.3, 1 - h * 0.2));
    }
    void dt;
  }

  // ---------------------------------------------------------------- interactions

  /** Ray vs creature boxes; returns nearest hit within maxDist. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): { c: Creature; dist: number } | null {
    let best: { c: Creature; dist: number } | null = null;
    const box = new THREE.Box3();
    const ray = new THREE.Ray(origin, dir);
    const hit = new THREE.Vector3();
    for (const c of this.creatures) {
      if (c.fade || !c.rig.root.visible) continue;
      const r = c.def.radius + 0.1;
      box.min.set(c.body.pos.x - r, c.body.pos.y, c.body.pos.z - r);
      box.max.set(c.body.pos.x + r, c.body.pos.y + c.def.height + 0.1, c.body.pos.z + r);
      if (!ray.intersectBox(box, hit)) continue;
      const d = hit.distanceTo(origin);
      if (d <= maxDist && (!best || d < best.dist)) best = { c, dist: d };
    }
    return best;
  }

  damage(c: Creature, amount: number, from: THREE.Vector3, crit = false): void {
    const g = this.game;
    if (c.fade) return;
    c.health -= amount;
    g.bus.emit('creatureHit', { id: c.id, kind: c.kind, amount, x: c.body.pos.x, y: c.body.pos.y + c.def.height, z: c.body.pos.z, crit, killed: !c.tamed && c.health <= 0 });
    c.flash = 0.14;
    const dx = c.body.pos.x - from.x, dz = c.body.pos.z - from.z;
    const l = Math.hypot(dx, dz) || 1;
    c.knock.set((dx / l) * 7, 0, (dz / l) * 7);
    c.body.vel.y = 4.5;
    g.audio.play('enemyHit', { pos: c.body.pos });
    g.audio.creature(c.kind, 'hurt', c.body.pos);
    g.particles.emit('spark', c.body.pos.x, c.body.pos.y + c.def.height * 0.6, c.body.pos.z, 8, [1, 0.95, 0.7], { speed: 3, size: 0.07, life: 0.4 });
    if (!c.def.hostile) {
      // Wildlife flees when hurt; the saved companion retains its protection.
      c.friendship = Math.max(-5, c.friendship - 2);
      c.followUntil = 0;
      useWorldStore.getState().addHarmony(-1.5);
      this.setState(c, 'flee');
      c.target = c.body.pos.clone().add(new THREE.Vector3(dx / l, 0, dz / l).multiplyScalar(12));
      if (c.tamed) c.health = Math.max(1, c.health);
      if (c.health > 0) return;
    } else this.setState(c, 'chase');
    if (c.health <= 0) {
      // "driven off": family-friendly poof, no gore
      for (const d of c.def.drops ?? []) {
        if (Math.random() < d.chance) {
          const n = d.count ? d.count[0] + Math.floor(Math.random() * (d.count[1] - d.count[0] + 1)) : 1;
          g.drops.spawn(makeStack(d.item, n), c.body.pos.x, c.body.pos.y + 0.5, c.body.pos.z, 0.8);
        }
      }
      if (c.def.hostile) g.bus.emit('creatureDefeated', { kind: c.kind });
      if (c.def.hostile && g.clock.daylight < 0.3) this.nightKills++;
      this.poof(c);
    }
  }

  poof(c: Creature): void {
    if (c.fade) return;
    c.fade = 1;
    this.game.particles.emit('poof', c.body.pos.x, c.body.pos.y + c.def.height * 0.5, c.body.pos.z, 12, c.def.hostile ? [0.4, 0.35, 0.5] : [0.95, 0.95, 0.9], { spread: c.def.radius * 2, speed: 1.2, size: 0.22, life: 0.8 });
    this.game.audio.play('poof', { pos: c.body.pos });
  }

  /** F on a creature: feed (holding its favourite food), sit/stand (companion) or pet. */
  interact(c: Creature): string | null {
    const g = this.game;
    const inv = useInventoryStore.getState();
    const held = inv.selectedStack();
    const def = c.def;
    if (def.hostile) return null;
    const hearts = () => g.particles.emit('heart', c.body.pos.x, c.body.pos.y + def.height + 0.2, c.body.pos.z, 3, [1.6, 0.4, 0.6], { spread: 0.4, speed: 0.1, size: 0.12, life: 1.2, glow: true });
    if (held && def.favoriteFood?.includes(held.item)) {
      inv.consumeSelected(1);
      c.friendship += 1;
      c.followUntil = g.time + 60;
      hearts();
      g.audio.creature(c.kind, 'happy', c.body.pos);
      g.audio.play('eat', { pos: c.body.pos, volume: 0.5 });
      g.bus.emit('creatureFed', { kind: c.kind, id: c.id });
      if (c.kind === 'fenn' && c.friendship >= 3 && !c.tamed && !this.companion) {
        c.tamed = true;
        useGameStore.getState().toast('Fenn has chosen to travel with you! Press F on Fenn to make it sit or follow.', 'discovery', '🦊');
        g.audio.discoveryStinger();
      }
      this.maybeGift(c);
      return `${def.name} loved the ${held.item.replace(/_/g, ' ')}!`;
    }
    if (c.tamed) {
      c.sitting = !c.sitting;
      this.setState(c, c.sitting ? 'sit' : 'idle');
      hearts();
      g.audio.creature(c.kind, 'happy', c.body.pos);
      return c.sitting ? `${def.name} sits and waits.` : `${def.name} is ready to explore!`;
    }
    hearts();
    c.friendship += 0.25;
    g.audio.creature(c.kind, 'happy', c.body.pos);
    g.bus.emit('creaturePetted', { kind: c.kind, id: c.id });
    if (c.friendship >= 1) this.maybeGift(c);
    if (c.state === 'sleep') return `${def.name} snuggles sleepily.`;
    return `You pet the ${def.name}.`;
  }

  private maybeGift(c: Creature) {
    const gift = c.def.gift;
    if (!gift || this.game.time < c.giftReadyAt) return;
    c.giftReadyAt = this.game.time + gift.cooldown;
    const n = gift.count ? gift.count[0] + Math.floor(Math.random() * (gift.count[1] - gift.count[0] + 1)) : 1;
    this.game.drops.spawn(makeStack(gift.item, n), c.body.pos.x, c.body.pos.y + c.def.height, c.body.pos.z, 0.6);
    this.game.particles.emit('sparkle', c.body.pos.x, c.body.pos.y + c.def.height, c.body.pos.z, 10, [1.5, 1.4, 0.8], { spread: 0.6, speed: 1, size: 0.06, life: 0.8, glow: true });
  }

  // ---------------------------------------------------------------- dangerous nights

  private nightPhase: 'day' | 'dusk' | 'night' = 'day';
  private waveDay = -1;
  /** Creatures driven off since dusk (shown at dawn). */
  nightKills = 0;

  /** Standing in a lit spot or under a roof: night hunters lose your scent. */
  playerSafe(): boolean {
    const g = this.game;
    const p = g.player.position;
    const x = Math.floor(p.x), y = Math.floor(p.y + 0.5), z = Math.floor(p.z);
    return g.world.lightAt(x, y, z, g.clock.daylight) >= 9 || (g.world.surfaceY(x, z) > y + 2 && g.world.lightAt(x, y, z, 1) < 13);
  }

  /** Dusk warning, a hunting wave around midnight and a dawn retreat. */
  private nightDirector(_dt: number) {
    const g = this.game;
    if (g.difficulty === 'peaceful' || g.peacefulCreatures || g.player.creative) return;
    const f = g.clock.dayFraction;
    const phase: typeof this.nightPhase = f > 0.7 && f < 0.77 ? 'dusk' : g.clock.daylight < 0.3 ? 'night' : 'day';
    if (phase === this.nightPhase) {
      // the hunt: once per night, a pack comes for you
      const nightIndex = f > 0.5 ? g.clock.day : g.clock.day - 1;
      if (phase === 'night' && (f > 0.9 || f < 0.1) && this.waveDay !== nightIndex) {
        this.waveDay = nightIndex;
        this.spawnWave(nightIndex);
      }
      return;
    }
    const prev = this.nightPhase;
    this.nightPhase = phase;
    const gs = useGameStore.getState();
    if (phase === 'dusk') {
      gs.toast('Night is coming — dangerous creatures will hunt you. Get inside or light torches!', 'warn', '🌙');
    } else if (phase === 'night' && prev === 'day') {
      gs.toast('Night has fallen. Stay in the light!', 'warn', '🌑');
    } else if (phase === 'day' && prev === 'night') {
      for (const c of this.creatures) if (c.def.shy && !c.fade && g.world.surfaceY(Math.floor(c.body.pos.x), Math.floor(c.body.pos.z)) <= c.body.pos.y) this.poof(c);
      if (!g.player.dead) gs.toast(this.nightKills > 0 ? `Dawn! You survived the night and drove off ${this.nightKills} creature${this.nightKills === 1 ? '' : 's'}.` : 'Dawn! The night creatures retreat.', 'achievement', '🌅');
      this.nightKills = 0;
    }
  }

  private spawnWave(nightIndex: number) {
    const g = this.game;
    if (g.player.dead || this.playerSafe()) return;
    const p = g.player.position;
    const a = Math.random() * Math.PI * 2;
    const adventurer = g.difficulty === 'adventurer';
    // Hunting waves share the normal hostile cap rather than adding unbounded mobs.
    const cap = adventurer ? 18 : g.clock.day <= 1 ? 5 : 12;
    const nearby = this.creatures.filter((c) => c.def.hostile && !c.fade && c.body.pos.distanceToSquared(p) < 72 * 72).length;
    const size = Math.max(0, Math.min(cap - nearby, adventurer ? 7 : 5, 2 + Math.floor(nightIndex / 2) + (adventurer ? 2 : 0)));
    const hunters: CreatureKind[] = ['duskfang', 'gloomstalker', 'zombie', 'skeleton'];
    const kind = hunters[Math.floor(Math.random() * hunters.length)];
    let spawned = 0;
    for (let i = 0; i < size * 3 && spawned < size; i++) {
      const aa = a + (Math.random() - 0.5) * 0.6, d = 24 + Math.random() * 6;
      const x = Math.floor(p.x + Math.cos(aa) * d), z = Math.floor(p.z + Math.sin(aa) * d);
      if (!g.chunks.isReady(x, z)) continue;
      const y = g.world.standableY(x, z);
      if (!g.world.isSolid(x, y, z) || g.world.get(x, y, z) === B.WATER || g.world.lightAt(x, y + 1, z, g.clock.daylight) >= 7) continue;
      const c = this.spawn(kind, x + 0.5, y + 1, z + 0.5);
      c.state = 'wander';
      c.target = p.clone();
      spawned++;
    }
    if (spawned) {
      const name = CREATURES[kind].name;
      useGameStore.getState().toast(`${spawned > 1 ? `A ${name} pack` : `A ${name}`} is hunting you from the ${this.direction(this.tmp.set(p.x + Math.cos(a) * 20, p.y, p.z + Math.sin(a) * 20))}!`, 'warn', kind === 'duskfang' ? '🐺' : '👁️');
      g.audio.creature(kind, 'idle', this.tmp);
    }
  }

  /** Companion: warns about enemies and sometimes sniffs out ore. */
  private companionDuties(dt: number) {
    const comp = this.companion;
    if (!comp) return;
    const g = this.game;
    this.warnTimer -= dt;
    if (this.warnTimer <= 0) {
      for (const c of this.creatures) {
        if (!c.def.hostile || c.fade) continue;
        if (c.body.pos.distanceTo(comp.body.pos) < 16) {
          this.warnTimer = 25;
          g.audio.creature('fenn', 'attack', comp.body.pos);
          useGameStore.getState().setSubtitle(`Fenn growls toward the ${this.direction(c.body.pos)}`, '');
          break;
        }
      }
    }
    this.sniffTimer -= dt;
    if (this.sniffTimer <= 0 && !comp.sitting) {
      this.sniffTimer = 150 + Math.random() * 90;
      const p = g.player.position;
      const ores = [B.COPPER_ORE, B.FERRA_ORE, B.GLOW_ORE, B.MOON_ORE, B.EMBER_ORE];
      for (let k = 0; k < 400; k++) {
        const x = Math.floor(p.x + (Math.random() - 0.5) * 20), y = Math.floor(p.y + (Math.random() - 0.5) * 12), z = Math.floor(p.z + (Math.random() - 0.5) * 20);
        const id = g.world.get(x, y, z);
        if (ores.includes(id as never)) {
          for (let i = 0; i < 6; i++) g.particles.emit('sparkle', x + 0.5, y + 0.5, z + 0.5, 6, [1.6, 1.5, 0.6], { spread: 1.2, speed: 0.6, size: 0.08, life: 1.6, glow: true });
          useGameStore.getState().toast(`Fenn sniffed out ${BLOCK_DEFS[id].name} nearby!`, 'discovery', '🦊');
          g.audio.creature('fenn', 'happy', comp.body.pos);
          break;
        }
      }
    }
  }

  serializeCompanion(): { kind: CreatureKind; x: number; y: number; z: number; sitting: boolean; friendship: number } | null {
    const c = this.companion;
    return c ? { kind: c.kind, x: c.body.pos.x, y: c.body.pos.y, z: c.body.pos.z, sitting: c.sitting, friendship: c.friendship } : null;
  }

  loadCompanion(d: { kind: CreatureKind; x: number; y: number; z: number; sitting: boolean; friendship: number } | null): void {
    if (!d) return;
    const c = this.spawn(d.kind, d.x, d.y, d.z);
    c.tamed = true;
    c.sitting = d.sitting;
    c.friendship = d.friendship;
    if (c.sitting) c.state = 'sit';
  }
}
