import * as THREE from 'three';
import { hasItem, itemDef } from '../../data/items';
import { pvpNet, type NetSession, type WelcomeMsg } from '../../net/pvpNet';
import type { NetMsg } from '../../net/transport';
import { VoiceChat } from '../../net/voice';
import { useGameStore } from '../../stores/gameStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { usePvpStore, type PvpPlayerInfo, type PvpSettings } from '../../stores/pvpStore';
import { animateExplorer, buildExplorer, dressExplorer, dressFromItems, type Rig } from '../rendering/Models';
import { makeStack } from '../systems/InventoryLogic';
import type { Game } from '../Game';

/** PvP hits hit harder than creature fights so duels stay short and punchy. */
export const PVP_DAMAGE = 1.35;
const SEND_HZ = 12;
const INTERP_DELAY = 110; // ms behind real time: smooth movement from 12 Hz updates
const RESPAWN_SECONDS = 5;
const MAX_PLAYERS = 8;

interface Snap {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  m: number;
  g: boolean;
}

/** Another player, drawn with the same explorer model as you (in their scarf colour, wearing their armor). */
class RemotePlayer {
  readonly rig: Rig;
  readonly tag: THREE.Sprite;
  readonly pos = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  moving = 0;
  grounded = true;
  hp = 100;
  dead = false;
  swing = 0;
  swingKind: 'chop' | 'place' | 'attack' | 'none' = 'attack';
  lastSwing = -1;
  dressSig = '';
  lastHeard = performance.now();
  private buf: Snap[] = [];
  private hasPos = false;

  constructor(readonly id: string, public name: string, public color: string, parent: THREE.Object3D) {
    this.rig = buildExplorer(color);
    this.rig.root.name = `player-${id}`;
    this.tag = makeNameTag(name, color);
    this.rig.root.add(this.tag);
    this.tag.position.set(0, 2.3, 0);
    parent.add(this.rig.root);
    this.rig.root.visible = false;
  }

  push(s: Snap): void {
    this.lastHeard = performance.now();
    this.buf.push(s);
    if (this.buf.length > 20) this.buf.shift();
    if (!this.hasPos) {
      this.hasPos = true;
      this.pos.set(s.x, s.y, s.z);
      this.yaw = s.yaw;
    }
  }

  rename(name: string, color: string): void {
    if (name === this.name && color === this.color) return;
    this.name = name;
    this.color = color;
    const old = this.tag.material as THREE.SpriteMaterial;
    const fresh = makeNameTag(name, color);
    this.tag.material = fresh.material;
    old.map?.dispose();
    old.dispose();
  }

  update(dt: number, time: number): void {
    const now = performance.now() - INTERP_DELAY;
    const b = this.buf;
    if (b.length) {
      let i = b.length - 1;
      while (i > 0 && b[i - 1].t > now) i--;
      const a = b[Math.max(0, i - 1)], c = b[i];
      let k = c.t === a.t ? 1 : (now - a.t) / (c.t - a.t);
      k = Math.max(0, Math.min(1, k));
      const tx = a.x + (c.x - a.x) * k, ty = a.y + (c.y - a.y) * k, tz = a.z + (c.z - a.z) * k;
      // teleports (respawn) snap instead of sliding across the map
      if (Math.hypot(tx - this.pos.x, tz - this.pos.z) > 8) this.pos.set(tx, ty, tz);
      else this.pos.lerp(new THREE.Vector3(tx, ty, tz), Math.min(1, dt * 18));
      let dy = c.yaw - this.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.yaw += dy * Math.min(1, dt * 14);
      this.pitch += (c.pitch - this.pitch) * Math.min(1, dt * 14);
      this.moving = c.m;
      this.grounded = c.g;
      while (b.length > 2 && b[1].t < now) b.shift();
    }
    this.swing = Math.max(0, this.swing - dt * 3.2);
    const r = this.rig.root;
    r.visible = this.hasPos && !this.dead;
    r.position.copy(this.pos);
    r.rotation.y = this.yaw + Math.PI;
    animateExplorer(this.rig, {
      moving: this.moving, time: time + this.id.length, action: 0, grounded: this.grounded, swimming: false,
      swing: this.swing > 0 ? 1 - this.swing : 0, swingKind: this.swingKind, look: -this.pitch,
    });
  }

  dispose(parent: THREE.Object3D): void {
    parent.remove(this.rig.root);
    const m = this.tag.material as THREE.SpriteMaterial;
    m.map?.dispose();
    m.dispose();
  }
}

function makeNameTag(name: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 56;
  const g = c.getContext('2d')!;
  g.font = "900 30px Nunito, 'Trebuchet MS', sans-serif";
  const w = Math.min(248, g.measureText(name).width + 34);
  g.fillStyle = 'rgba(25,18,12,0.72)';
  g.beginPath();
  g.roundRect((256 - w) / 2, 6, w, 44, 22);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.arc((256 - w) / 2 + 17, 28, 7, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff8e8';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, 128 + 8, 29, w - 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  s.scale.set(1.6, 0.35, 1);
  s.renderOrder = 5;
  return s;
}

const safeDef = (k: string) => (hasItem(k) ? itemDef(k) : undefined);

export function sanitizeName(n: unknown): string {
  const s = String(n ?? '').replace(/[^\p{L}\p{N} _.\-!?']/gu, '').trim().slice(0, 16);
  return s || 'Explorer';
}

/** Starting gear for each kit (everyone gets the same; refilled on every respawn). */
export function kitItems(kit: PvpSettings['kit'], building: boolean, together = false): { hotbar: [string, number][]; armor: Record<'head' | 'body' | 'legs' | 'feet' | 'offhand', string> } {
  const k = {
    hunter: { sword: 'stone_sword', bow: 'hunter_bow', arrows: 24, pick: 'scrap_pick', set: 'thorn', shield: 'wood_shield' },
    knight: { sword: 'copper_sword', bow: 'hunter_bow', arrows: 32, pick: 'copper_pick', set: 'copper', shield: 'copper_shield' },
    champion: { sword: 'crystal_blade', bow: 'crystal_bow', arrows: 48, pick: 'crystal_pick', set: 'crystal', shield: 'crystal_shield' },
  }[kit];
  const axe = k.pick.replace('_pick', '_axe');
  // build-together: a builder's kit first (tools + blocks), weapons for night creatures at the end
  const hotbar: [string, number][] = together
    ? [[k.pick, 1], [axe, 1], ['planks', 64], ['fieldstone', 64], ['brick', 64], ['glass', 32], ['torch', 16], ['sunbread', 8], [k.sword, 1], ['planks', 64], ['fieldstone', 64], [k.bow, 1], ['arrow', k.arrows]]
    : [[k.sword, 1], [k.bow, 1], ['sunbread', 6], ['arrow', k.arrows]];
  if (building && !together) hotbar.push([k.pick, 1], ['planks', 48], ['torch', 8]);
  return {
    hotbar: hotbar.filter(([i]) => hasItem(i)),
    armor: { head: `${k.set}_helmet`, body: `${k.set}_chestplate`, legs: `${k.set}_leggings`, feet: `${k.set}_boots`, offhand: k.shield },
  };
}

/**
 * In-game PvP: syncs players (position, look, armor, held item, swings),
 * melee & arrow hits, block edits and the match (scores, timer, winner).
 * The host is the referee: it relays messages and keeps the scoreboard.
 */
export class PvpSession {
  readonly net: NetSession;
  readonly group = new THREE.Group();
  readonly remotes = new Map<string, RemotePlayer>();
  /** Free peer-to-peer voice chat (off until the player turns it on in ⚙️). */
  readonly voice: VoiceChat;
  settings: PvpSettings;
  private players = new Map<string, PvpPlayerInfo>();
  private sendTimer = 0;
  private clockTimer = 0;
  private uiTimer = 0;
  private timeLeft: number | null;
  private phase: 'playing' | 'ended' = 'playing';
  private editLog = new Map<string, [number, number, number, number]>();
  private outEdits: [number, number, number, number][] = [];
  private lastHit: { by: string; at: number; how: string } | null = null;
  private swingCount = 0;
  private lastSwingSent = 0;
  respawnIn = 0;
  /** Seconds the local player has been stuck (deep in water, fallen into a cave / ravine). */
  private stuckTime = 0;
  private rescueCooldown = 0;
  private emergency = false;
  center = { x: 0, y: 64, z: 0 };
  private disposed = false;
  private ray = new THREE.Ray();
  private box = new THREE.Box3();
  private hitP = new THREE.Vector3();

  constructor(private game: Game) {
    const net = pvpNet.current;
    if (!net) throw new Error('No PvP connection — start from the PvP menu.');
    this.net = net;
    this.settings = net.settings;
    this.voice = new VoiceChat(net.selfId, (m) => this.net.send(m, this.isHost && typeof m.to === 'string' ? m.to : undefined));
    this.group.name = 'pvp-players';
    game.scene.add(this.group);
    const w = net.welcome;
    this.timeLeft = net.isHost ? (this.settings.minutes > 0 && this.settings.style !== 'together' ? this.settings.minutes * 60 : null) : w?.timeLeft ?? null;
    if (net.isHost) this.players.set(net.selfId, { id: net.selfId, name: net.name, color: net.color, kills: 0, deaths: 0 });
    else if (w) for (const p of w.players) this.players.set(p.id, { ...p });
    usePvpStore.getState().set({
      active: true, code: net.code, online: net.online, isHost: net.isHost, selfId: net.selfId, settings: this.settings,
      timeLeft: this.timeLeft, phase: 'playing', winner: null, respawnIn: 0, feed: [], status: null,
    });
    this.publishRoster();
    // every block this game changes is shared with the others
    game.world.onSet = (x, y, z, id, meta) => {
      if (this.settings.building) this.outEdits.push([x, y, z, id | (meta << 8)]);
    };
    net.onPeerLeave = (id) => this.dropPlayer(id);
    net.onClosed = (reason) => this.connectionLost(reason);
    if (net.closedReason) setTimeout(() => this.connectionLost(net.closedReason!), 0);
  }

  /** Co-op "build together" match: no player damage, no timer or takedown goal. */
  get together(): boolean {
    return this.settings.style === 'together';
  }

  get isHost(): boolean {
    return this.net.isHost;
  }

  get selfId(): string {
    return this.net.selfId;
  }

  /** Called once the local world is ready (terrain streamed, player placed). */
  begin(): void {
    const w = this.net.welcome;
    if (w) {
      for (const [x, y, z, v] of w.edits) this.game.world.applyRemote(x, y, z, v & 255, v >> 8);
      this.game.clock.time = w.time;
    }
    this.net.attach((from, msg) => this.receive(from, msg));
    useGameStore.getState().toast(this.isHost ? `Room ${this.net.code} is open — share the code with friends!` : 'Joined the match. Good luck!', 'quest', '⚔️');
  }

  // ---------------------------------------------------------------- spawning & kit

  /** Generated ground height & wetness (works before chunks are loaded; main map or flat arenas). */
  groundAt(x: number, z: number): { h: number; wet: boolean } {
    const w = this.game.world;
    if (w.plotSampler) {
      const c = w.plotSampler.column(x, z);
      return { h: c.height, wet: c.water > 0 };
    }
    const c = w.sampler.sample(x, z);
    return { h: c.height, wet: c.waterLevel > 0 || c.river > 0 };
  }

  randomSpawn(): { x: number; y: number; z: number } {
    const flat = !!this.game.world.plotSampler;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * (flat ? 44 : 34);
      const x = Math.floor(this.center.x + Math.cos(a) * r), z = Math.floor(this.center.z + Math.sin(a) * r);
      const col = this.groundAt(x, z);
      if (col.wet) continue;
      // keep away from other players
      let near = false;
      for (const rp of this.remotes.values()) if (!rp.dead && Math.hypot(rp.pos.x - x, rp.pos.z - z) < 10) near = true;
      if (near && i < 30) continue;
      const loadedY = this.game.world.isLoaded(x, z) ? this.game.world.standableY(x, z) : col.h;
      return { x: x + 0.5, y: Math.max(col.h, loadedY) + 1.1, z: z + 0.5 };
    }
    return { x: this.center.x + 0.5, y: this.center.y + 1.2, z: this.center.z + 0.5 };
  }

  giveKit(): void {
    const inv = useInventoryStore.getState();
    inv.reset();
    const kit = kitItems(this.settings.kit, this.settings.building || this.together, this.together);
    for (const [item, n] of kit.hotbar) inv.add(item, n);
    const eq = { ...useInventoryStore.getState().equipment };
    for (const [slot, item] of Object.entries(kit.armor)) if (hasItem(item)) eq[slot as keyof typeof eq] = makeStack(item, 1);
    useInventoryStore.setState({ equipment: eq, selected: 0, version: useInventoryStore.getState().version + 1 });
  }

  private respawn(): void {
    const p = this.game.player;
    const sp = this.randomSpawn();
    p.teleport(sp.x, sp.y, sp.z);
    p.dead = false;
    p.vitality = p.maxVitality;
    p.energy = 100;
    p.buffs = [];
    p.invulnerable = 3;
    this.giveKit();
    this.game.ensureSafePosition();
    p.syncHud();
    this.lastHit = null;
    usePvpStore.getState().set({ respawnIn: 0, killedBy: null });
  }

  // ---------------------------------------------------------------- voice

  private voicePos = new Map<string, { x: number; y: number; z: number }>();

  private updateVoice(dt: number): void {
    const v = this.voice;
    if (!v.on) return;
    // push-to-talk: hold T (touch: the 🎤 button); not while typing in a field
    const typing = document.activeElement?.tagName === 'INPUT';
    if (v.mode === 'push' && !this.game.input.touch.active) v.setPush(!typing && this.game.input.keyDown('KeyT'));
    const cam = this.game.camera;
    const f = cam.getWorldDirection(this.hitP);
    this.voicePos.clear();
    for (const r of this.remotes.values()) this.voicePos.set(r.id, r.pos);
    v.update(dt, { x: cam.position.x, y: cam.position.y, z: cam.position.z, fx: f.x, fy: f.y, fz: f.z }, this.voicePos);
  }

  // ---------------------------------------------------------------- emergency respawn

  /** Fell into a cave, a ravine or deep water and can't get out? Shown only then. */
  private updateStuck(dt: number): void {
    const p = this.game.player;
    this.rescueCooldown = Math.max(0, this.rescueCooldown - dt);
    let stuck = false;
    if (!p.dead && this.phase === 'playing' && this.respawnIn <= 0) {
      const pos = p.position;
      const g = this.groundAt(Math.floor(pos.x), Math.floor(pos.z));
      const underground = pos.y < g.h - 3.5;
      stuck = p.inWater || underground;
    }
    this.stuckTime = stuck ? this.stuckTime + dt : Math.max(0, this.stuckTime - dt * 3);
    const recentlyHit = !!this.lastHit && performance.now() - this.lastHit.at < 5000;
    const show = this.stuckTime > (p.inWater ? 5 : 7) && this.rescueCooldown <= 0 && !recentlyHit;
    if (show !== this.emergency) {
      this.emergency = show;
      usePvpStore.getState().set({ emergency: show });
    }
    if (show && this.game.input.keyPressed('KeyR')) this.emergencyRespawn();
  }

  /** 🆘 Teleport next to another player (or a random arena spot). Keeps health & items; no death counted. */
  emergencyRespawn(): void {
    if (!this.emergency) return;
    const p = this.game.player;
    const alive = [...this.remotes.values()].filter((r) => !r.dead && r.rig.root.visible);
    let target: { x: number; y: number; z: number } | null = null;
    if (alive.length) {
      const r = alive[Math.floor(Math.random() * alive.length)];
      for (let i = 0; i < 30 && !target; i++) {
        const a = Math.random() * Math.PI * 2, d = 7 + Math.random() * 9;
        const x = Math.floor(r.pos.x + Math.cos(a) * d), z = Math.floor(r.pos.z + Math.sin(a) * d);
        const g = this.groundAt(x, z);
        if (g.wet) continue;
        const loadedY = this.game.world.isLoaded(x, z) ? this.game.world.standableY(x, z) : g.h;
        if (loadedY < g.h - 2) continue; // not into a hole, cave mouth or ravine
        target = { x: x + 0.5, y: Math.max(g.h, loadedY) + 1.1, z: z + 0.5 };
      }
    }
    target ??= this.randomSpawn();
    p.teleport(target.x, target.y, target.z);
    p.body.vel.set(0, 0, 0);
    p.invulnerable = 2;
    this.game.ensureSafePosition();
    this.stuckTime = 0;
    this.rescueCooldown = 30;
    this.emergency = false;
    usePvpStore.getState().set({ emergency: false });
    this.game.audio.play('chime');
    useGameStore.getState().toast(alive.length ? 'Rescued! You are back near the other players.' : 'Rescued! Back on solid ground.', 'info', '🆘');
    if (useGameStore.getState().overlay === null) this.game.input.requestLock();
  }

  // ---------------------------------------------------------------- local events

  /** The local player swung (shown on everyone else's screen). */
  noteSwing(): void {
    this.swingCount++;
  }

  /** Melee or arrow hit on another player — the victim's game applies it (with their armor & shield). */
  hitPlayer(id: string, dmg: number, how: string, crit = false): void {
    const r = this.remotes.get(id);
    if (!r || r.dead || this.phase !== 'playing' || this.game.player.dead) return;
    if (this.together) return; // build-together: friends can't hurt each other
    const p = this.game.player.position;
    const amount = Math.round(dmg * PVP_DAMAGE * 10) / 10;
    const msg: NetMsg = { t: 'hit', id: this.selfId, to: id, dmg: amount, x: p.x, y: p.y, z: p.z, how, crit };
    this.net.send(msg, this.isHost ? id : undefined);
    this.game.fx.pop(String(Math.round(amount)), r.pos.x, r.pos.y + 1.9, r.pos.z, crit ? '#ffd24a' : '#ffffff', crit);
    this.game.audio.play('enemyHit', { pos: r.pos, pitch: crit ? 1.4 : 1 });
    this.game.particles.emit('spark', r.pos.x, r.pos.y + 1.1, r.pos.z, 8, [1, 0.95, 0.7], { speed: 3, size: 0.07, life: 0.4 });
  }

  sendArrow(origin: THREE.Vector3, vel: THREE.Vector3): void {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    this.net.send({ t: 'a', id: this.selfId, o: [r2(origin.x), r2(origin.y), r2(origin.z)], v: [r2(vel.x), r2(vel.y), r2(vel.z)] });
  }

  /** Nearest other player along a ray (melee targeting). */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): { id: string; dist: number } | null {
    let best: { id: string; dist: number } | null = null;
    this.ray.set(origin, dir);
    for (const r of this.remotes.values()) {
      if (r.dead || !r.rig.root.visible) continue;
      this.box.min.set(r.pos.x - 0.4, r.pos.y, r.pos.z - 0.4);
      this.box.max.set(r.pos.x + 0.4, r.pos.y + 1.85, r.pos.z + 0.4);
      if (!this.ray.intersectBox(this.box, this.hitP)) continue;
      const d = this.hitP.distanceTo(origin);
      if (d <= maxDist && (!best || d < best.dist)) best = { id: r.id, dist: d };
    }
    return best;
  }

  /** Arrow (my own) passing through another player? */
  arrowHit(to: THREE.Vector3, damage: number): boolean {
    for (const r of this.remotes.values()) {
      if (r.dead) continue;
      if (Math.abs(to.x - r.pos.x) < 0.42 && Math.abs(to.z - r.pos.z) < 0.42 && to.y > r.pos.y - 0.05 && to.y < r.pos.y + 1.9) {
        this.hitPlayer(r.id, damage, 'arrow');
        this.game.audio.play('arrowHit', { pos: to });
        return true;
      }
    }
    return false;
  }

  /** Remote players inside a sword sweep in front of you. */
  inSweep(origin: THREE.Vector3, yaw: number, except: string | null): string[] {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const out: string[] = [];
    for (const r of this.remotes.values()) {
      if (r.dead || r.id === except) continue;
      const dx = r.pos.x - origin.x, dz = r.pos.z - origin.z, dy = r.pos.y - origin.y;
      const d = Math.hypot(dx, dz);
      if (d > 3.2 || Math.abs(dy) > 2 || (dx * fx + dz * fz) / (d || 1) < 0.25) continue;
      out.push(r.id);
    }
    return out;
  }

  /** Local player died (any cause). Returns true: PvP handles it (no death screen, no item loss). */
  onLocalDeath(cause: string): boolean {
    const recent = this.lastHit && performance.now() - this.lastHit.at < 12000 ? this.lastHit : null;
    const by = recent?.by ?? null;
    const how = recent?.how ?? cause;
    this.respawnIn = RESPAWN_SECONDS;
    this.game.player.syncHud();
    usePvpStore.getState().set({ respawnIn: RESPAWN_SECONDS, killedBy: by ? this.players.get(by)?.name ?? 'someone' : null });
    if (this.isHost) this.recordKill(this.selfId, by, how);
    else this.net.send({ t: 'died', id: this.selfId, by, how });
    this.sendState(true);
    return true;
  }

  // ---------------------------------------------------------------- network in

  private receive(from: string, msg: NetMsg): void {
    if (this.disposed) return;
    const host = this.isHost;
    if (host) {
      // the host is the referee: stamp the sender, relay, and keep score
      switch (msg.t) {
        case 'hello':
          return this.admit(from, msg);
        case 's':
        case 'a':
        case 'b':
          msg.id = from;
          this.net.sendExcept(from, msg);
          return this.shared(msg);
        case 'hit':
          msg.id = from;
          if (msg.to === this.selfId) this.applyHit(msg);
          else if (typeof msg.to === 'string') this.net.send(msg, msg.to);
          return;
        case 'blk':
          msg.id = from;
          if (msg.to === this.selfId) this.game.fx.pop('Blocked!', ...this.remotePos(from), '#9fd8ff');
          else if (typeof msg.to === 'string') this.net.send(msg, msg.to);
          return;
        case 'v':
          msg.id = from;
          if (msg.to === this.selfId) void this.voice.handleSignal(msg);
          else if (typeof msg.to === 'string') this.net.send(msg, msg.to);
          return;
        case 'vs':
          msg.id = from;
          this.net.sendExcept(from, msg);
          return this.voice.handleState(msg);
        case 'died':
          return this.recordKill(from, typeof msg.by === 'string' && this.players.has(msg.by) ? msg.by : null, String(msg.how ?? ''));
      }
      return;
    }
    switch (msg.t) {
      case 's':
      case 'a':
      case 'b':
        return this.shared(msg);
      case 'hit':
        if (msg.to === this.selfId) this.applyHit(msg);
        return;
      case 'blk':
        if (msg.to === this.selfId) this.game.fx.pop('Blocked!', ...this.remotePos(String(msg.id)), '#9fd8ff');
        return;
      case 'v':
        if (msg.to === this.selfId) void this.voice.handleSignal(msg);
        return;
      case 'vs':
        return this.voice.handleState(msg);
      case 'roster':
        this.players = new Map((msg.players as PvpPlayerInfo[]).map((p) => [p.id, p]));
        for (const r of this.remotes.values()) {
          const info = this.players.get(r.id);
          if (info) r.rename(info.name, info.color);
        }
        for (const id of [...this.remotes.keys()]) if (!this.players.has(id)) this.dropPlayer(id, true);
        return this.publishRoster();
      case 'kill':
        return this.showKill(String(msg.victim), typeof msg.by === 'string' ? msg.by : null, String(msg.how ?? ''));
      case 'clock':
        if (typeof msg.time === 'number' && Math.abs(this.game.clock.time - msg.time) > 4) this.game.clock.time = msg.time;
        this.timeLeft = typeof msg.left === 'number' ? msg.left : null;
        return;
      case 'end':
        return this.endLocal(typeof msg.winner === 'string' ? msg.winner : null);
      case 'restart':
        return this.restartLocal();
      case 'full':
        return this.connectionLost('That match is full.');
    }
  }

  private remotePos(id: string): [number, number, number] {
    const r = this.remotes.get(id);
    const p = r ? r.pos : this.game.player.position;
    return [p.x, p.y + 2, p.z];
  }

  private admit(id: string, msg: NetMsg): void {
    if (this.players.size >= MAX_PLAYERS && !this.players.has(id)) {
      this.net.send({ t: 'full' }, id);
      return;
    }
    const used = new Set([...this.players.values()].map((p) => p.color));
    let color = typeof msg.color === 'string' && /^#[0-9a-f]{6}$/i.test(msg.color) ? msg.color : '#3f8fd9';
    if (used.has(color)) color = ['#3f8fd9', '#e0b23d', '#7fae5a', '#b06ad9', '#3fc4c0', '#e07fb0', '#f0f0e8', '#d9573f'].find((c) => !used.has(c)) ?? color;
    const info: PvpPlayerInfo = { id, name: this.uniqueName(sanitizeName(msg.name), id), color, kills: 0, deaths: 0 };
    this.players.set(id, info);
    const welcome: WelcomeMsg = {
      t: 'welcome', you: id, seedText: this.settings.seedText, settings: this.settings, time: this.game.clock.time,
      players: [...this.players.values()], edits: [], timeLeft: this.timeLeft,
    };
    this.net.send(welcome, id);
    // the map changes so far follow in small packets (WebRTC JSON messages must stay under ~16 KB)
    const edits = [...this.editLog.values()].slice(-12000);
    for (let i = 0; i < edits.length; i += 300) this.net.send({ t: 'b', id: this.selfId, e: edits.slice(i, i + 300) }, id);
    this.broadcastRoster();
    usePvpStore.getState().pushFeed({ killer: null, victim: info.name, victimColor: info.color, how: 'joined' });
    this.game.audio.play('chime');
  }

  private uniqueName(name: string, id: string): string {
    const taken = new Set([...this.players.values()].filter((p) => p.id !== id).map((p) => p.name));
    if (!taken.has(name)) return name;
    for (let i = 2; i < 20; i++) if (!taken.has(`${name} ${i}`)) return `${name} ${i}`;
    return name;
  }

  private shared(msg: NetMsg): void {
    const id = String(msg.id ?? '');
    if (!id || id === this.selfId) return;
    if (msg.t === 's') {
      const info = this.players.get(id);
      let r = this.remotes.get(id);
      if (!r) {
        if (!info && !this.isHost) return;
        r = new RemotePlayer(id, info?.name ?? 'Explorer', info?.color ?? '#3f8fd9', this.group);
        this.remotes.set(id, r);
      }
      const p = msg.p as number[];
      if (!Array.isArray(p) || p.length < 3 || !p.every(Number.isFinite)) return;
      r.push({ t: performance.now(), x: p[0], y: p[1], z: p[2], yaw: Number(msg.yw) || 0, pitch: Number(msg.pt) || 0, m: Number(msg.m) || 0, g: !!msg.g });
      const hp = Number(msg.hp);
      if (Number.isFinite(hp) && hp !== r.hp) {
        if (hp < r.hp) this.game.fx.health(`p:${id}`, hp / 100, r.pos.x, r.pos.y + 1.95, r.pos.z);
        r.hp = hp;
      }
      r.dead = !!msg.dead;
      const sw = Number(msg.sw) || 0;
      if (r.lastSwing >= 0 && sw !== r.lastSwing) {
        r.swing = 1;
        r.swingKind = msg.sk === 'place' ? 'place' : 'attack';
      }
      r.lastSwing = sw;
      if (typeof msg.dr === 'string' && msg.dr !== r.dressSig) {
        r.dressSig = msg.dr;
        const keys = msg.dr.split('|').map((k) => k || null);
        dressExplorer(r.rig, dressFromItems(safeDef, keys));
      }
    } else if (msg.t === 'a') {
      const o = msg.o as number[], v = msg.v as number[];
      if (!Array.isArray(o) || !Array.isArray(v) || ![...o, ...v].every(Number.isFinite)) return;
      const vel = new THREE.Vector3(v[0], v[1], v[2]);
      this.game.arrows.shoot(new THREE.Vector3(o[0], o[1], o[2]), vel, vel.length(), 0, id);
      this.game.audio.play('bow', { pos: new THREE.Vector3(o[0], o[1], o[2]) });
    } else if (msg.t === 'b') {
      if (!this.settings.building) return;
      const list = msg.e as [number, number, number, number][];
      if (!Array.isArray(list)) return;
      for (const e of list.slice(0, 400)) {
        if (!Array.isArray(e) || e.length !== 4 || !e.every(Number.isInteger)) continue;
        this.game.world.applyRemote(e[0], e[1], e[2], e[3] & 255, e[3] >> 8);
        if (this.isHost) this.editLog.set(`${e[0]},${e[1]},${e[2]}`, e);
      }
    }
  }

  private applyHit(msg: NetMsg): void {
    const p = this.game.player;
    if (p.dead || this.phase !== 'playing') return;
    const attacker = String(msg.id ?? '');
    const dmg = Math.min(60, Math.max(0, Number(msg.dmg) || 0));
    const from = new THREE.Vector3(Number(msg.x) || p.position.x, Number(msg.y) || p.position.y, Number(msg.z) || p.position.z);
    const name = this.players.get(attacker)?.name ?? 'another explorer';
    let blocked = false;
    const off = this.game.bus.on('playerBlocked', () => (blocked = true));
    const before = p.invulnerable;
    const done = p.hurt(dmg, name, from);
    off();
    if (blocked) {
      this.net.send({ t: 'blk', id: this.selfId, to: attacker }, this.isHost ? attacker : undefined);
      return;
    }
    if (done > 0 || before <= 0) this.lastHit = { by: attacker, at: performance.now(), how: String(msg.how ?? 'melee') };
    if (done > 0) useGameStore.setState({ hurtFlash: performance.now() });
  }

  // ---------------------------------------------------------------- scores (host is the referee)

  private recordKill(victim: string, by: string | null, how: string): void {
    if (this.phase !== 'playing') return;
    const v = this.players.get(victim);
    if (v) v.deaths++;
    const k = by && by !== victim ? this.players.get(by) : undefined;
    if (k) k.kills++;
    this.net.send({ t: 'kill', victim, by: k ? by : null, how });
    this.showKill(victim, k ? by : null, how);
    this.broadcastRoster();
    if (k && !this.together && this.settings.killLimit > 0 && k.kills >= this.settings.killLimit) this.endMatch(k.id);
  }

  private showKill(victim: string, by: string | null, how: string): void {
    const v = this.players.get(victim), k = by ? this.players.get(by) : undefined;
    const weapon = how === 'arrow' ? '🏹' : how === 'melee' ? '⚔️' : '💀';
    usePvpStore.getState().pushFeed({ killer: k?.name ?? null, killerColor: k?.color, victim: v?.name ?? 'someone', victimColor: v?.color, how: k ? weapon : how || 'fell' });
    if (by === this.selfId && victim !== this.selfId) {
      useGameStore.getState().toast(`You took down ${v?.name ?? 'someone'}!`, 'achievement', '⚔️');
      this.game.audio.play('levelUp');
      const r = this.remotes.get(victim);
      if (r) this.game.fx.pop('Takedown!', r.pos.x, r.pos.y + 2.2, r.pos.z, '#ffd24a', true);
    }
  }

  private endMatch(winner: string | null): void {
    this.net.send({ t: 'end', winner });
    this.endLocal(winner);
  }

  private endLocal(winner: string | null): void {
    this.phase = 'ended';
    const name = winner ? this.players.get(winner)?.name ?? null : null;
    usePvpStore.getState().set({ phase: 'ended', winner: name, scoreboardOpen: true });
    this.game.audio.play(winner === this.selfId ? 'levelUp' : 'chime');
    this.game.releasePointer();
  }

  /** Host: new round on the same map — scores reset, everyone respawns with a fresh kit. */
  restartMatch(): void {
    if (!this.isHost) return;
    for (const p of this.players.values()) {
      p.kills = 0;
      p.deaths = 0;
    }
    this.timeLeft = this.settings.minutes > 0 && !this.together ? this.settings.minutes * 60 : null;
    this.net.send({ t: 'restart' });
    this.broadcastRoster();
    this.restartLocal();
  }

  private restartLocal(): void {
    this.phase = 'playing';
    this.respawnIn = 0;
    usePvpStore.getState().set({ phase: 'playing', winner: null, scoreboardOpen: false, feed: [], timeLeft: this.timeLeft });
    this.respawn();
    useGameStore.getState().toast('New round — fight!', 'quest', '⚔️');
    if (useGameStore.getState().overlay === null) this.game.input.requestLock();
  }

  private broadcastRoster(): void {
    this.net.send({ t: 'roster', players: [...this.players.values()] });
    this.publishRoster();
  }

  private publishRoster(): void {
    const list = [...this.players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    usePvpStore.getState().set({ players: list.map((p) => ({ ...p })) });
  }

  private dropPlayer(id: string, silent = false): void {
    this.voice.drop(id);
    const r = this.remotes.get(id);
    r?.dispose(this.group);
    this.remotes.delete(id);
    this.game.fx.removeBar(`p:${id}`);
    const info = this.players.get(id);
    if (this.isHost && info) {
      this.players.delete(id);
      this.broadcastRoster();
    }
    if (info && !silent) usePvpStore.getState().pushFeed({ killer: null, victim: info.name, victimColor: info.color, how: 'left' });
  }

  private connectionLost(reason: string): void {
    if (this.disposed) return;
    usePvpStore.getState().set({ status: reason });
    useGameStore.getState().toast(reason, 'warn', '📡');
    this.game.releasePointer();
    // back to the PvP menu, which shows the reason
    setTimeout(() => {
      if (this.disposed) return;
      pvpNet.leave();
      usePvpStore.getState().set({ status: reason });
      useGameStore.getState().setScreen('pvp');
    }, 1200);
  }

  // ---------------------------------------------------------------- per frame

  private dressKeys(): string {
    const inv = useInventoryStore.getState();
    const eq = inv.equipment;
    return [eq.head?.item, eq.body?.item, eq.legs?.item, eq.feet?.item, eq.offhand?.item, inv.selectedStack()?.item].map((k) => k ?? '').join('|');
  }

  private sendState(force = false): void {
    const p = this.game.player;
    const b = p.body;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const hs = Math.hypot(b.vel.x, b.vel.z);
    if (p.swing > 0.95 && performance.now() - this.lastSwingSent > 150) {
      this.lastSwingSent = performance.now();
      this.swingCount++;
    }
    this.net.send({
      t: 's', id: this.selfId, p: [r2(b.pos.x), r2(b.pos.y - (p.crouching ? 0.12 : 0)), r2(b.pos.z)], yw: r2(p.yaw), pt: r2(p.pitch), m: r2(Math.min(1, hs / 8)),
      g: b.grounded, hp: Math.round((p.vitality / p.maxVitality) * 100), dead: p.dead, sw: this.swingCount, sk: p.swingKind, dr: this.dressKeys(), f: force ? 1 : 0,
    });
  }

  update(dt: number): void {
    if (this.disposed) return;
    const g = this.game;
    // outgoing
    this.sendTimer -= dt;
    if (this.sendTimer <= 0 && g.ready) {
      this.sendTimer = 1 / SEND_HZ;
      this.sendState();
    }
    if (this.outEdits.length) {
      const e = this.outEdits.splice(0, 300);
      if (this.isHost) for (const x of e) this.editLog.set(`${x[0]},${x[1]},${x[2]}`, x);
      this.net.send({ t: 'b', id: this.selfId, e });
    }
    // remotes
    const now = performance.now();
    for (const r of this.remotes.values()) {
      r.update(dt, g.time);
      g.fx.follow(`p:${r.id}`, r.pos.x, r.pos.y + 1.95, r.pos.z);
      // not heard from for a while (tab in the background, bad connection): hide until they're back
      if (now - r.lastHeard > 6000) r.rig.root.visible = false;
    }
    // match clock
    if (this.phase === 'playing' && this.timeLeft !== null) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.isHost && this.timeLeft <= 0) {
        const top = [...this.players.values()].sort((a, b) => b.kills - a.kills);
        this.endMatch(top.length && (top.length === 1 || top[0].kills > top[1].kills) ? top[0].id : null);
      }
    }
    if (this.isHost) {
      this.clockTimer -= dt;
      if (this.clockTimer <= 0) {
        this.clockTimer = 2;
        this.net.send({ t: 'clock', time: g.clock.time, left: this.timeLeft });
      }
    }
    // respawn
    this.updateStuck(dt);
    this.updateVoice(dt);
    if (this.respawnIn > 0 && this.phase === 'playing') {
      this.respawnIn -= dt;
      if (this.respawnIn <= 0) this.respawn();
    }
    this.uiTimer -= dt;
    if (this.uiTimer <= 0) {
      this.uiTimer = 0.25;
      usePvpStore.getState().set({ timeLeft: this.timeLeft === null ? null : Math.ceil(this.timeLeft), respawnIn: Math.max(0, Math.ceil(this.respawnIn)) });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.game.world.onSet = null;
    this.voice.dispose();
    for (const r of this.remotes.values()) r.dispose(this.group);
    this.remotes.clear();
    this.game.scene.remove(this.group);
    if (pvpNet.current === this.net) pvpNet.leave();
  }
}
