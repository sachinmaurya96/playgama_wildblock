import * as THREE from 'three';
import { dmNet, type DmNet } from '../../net/deathmatchNet';
import { useDeathmatchStore } from '../../stores/deathmatchStore';
import { useGameStore } from '../../stores/gameStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { animateExplorer, buildExplorer, setScarfColor, type Rig } from '../rendering/Models';
import type { Game } from '../Game';
import { CITY_G, HEALTH_STATIONS, PLAY_HALF, clampToArena, type Team } from './DeathmatchMap';
import type { RoomPlayer } from './DeathmatchRules';
import { feedWeapon } from './DmServer';
import { playDm, playGun } from './GunAudio';
import { GunViewModel } from './GunViewModel';
import { effectiveSpread, rayPlayers, shotSeed, spreadDirs, traceVoxels, type Vec } from './HitDetection';
import { lootLabel, PICKUP_RANGE, pickupBlock, type LootKind } from './LootManager';
import type { ServerMsg } from './Protocol';
import { GUNS, MAX_HP, isGun, type GunId, type WeaponId } from './WeaponDefinitions';
import { buildGun, buildPickupModel, PICKUP_GLOW } from './WeaponModels';
import { Arsenal, type Slot } from './WeaponSystem';

/**
 * In-game Deathmatch client (one per Game in mode 'deathmatch').
 *
 * Local player: movement is predicted by the normal Player physics; weapons run
 * on a local Arsenal for instant feedback (muzzle flash, tracer, recoil, ammo),
 * while every shot / swing / pickup / heal is sent to the host referee, whose
 * answers (damage, eliminations, loadout corrections) are authoritative.
 *
 * Remote players: drawn with the explorer model in team colours, interpolated
 * 100 ms behind the host's 15 Hz snapshots, holding their actual weapon.
 */

const SEND_HZ = 15;
const INTERP_MS = 100;
const TEAM_COLOR: Record<Team, string> = { red: '#d83a32', blue: '#2f74d9' };
const TEAM_TAG: Record<Team, string> = { red: '#ff6b5e', blue: '#5ea2ff' };
const nowS = () => performance.now() / 1000;

interface Snap {
  t: number;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  w: WeaponId;
  f: number;
  m: number;
}

class DmRemote {
  readonly rig: Rig;
  readonly tag: THREE.Sprite;
  readonly pos = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  w: WeaponId = 'sword';
  flags = 2;
  move = 0;
  hp = 100;
  alive = true;
  prot = false;
  swing = 0;
  fireKick = 0;
  /** When this player last fired (enemies show on the radar for a moment after a shot). */
  firedAt = 0;
  private buf: Snap[] = [];
  private gunObj: THREE.Group | null = null;
  private gunId: WeaponId | null = null;
  private sword: THREE.Group | null = null;
  private flash: THREE.Mesh;
  private flashT = 0;
  private has = false;

  constructor(readonly id: string, public name: string, public team: Team, readonly mine: boolean, parent: THREE.Object3D, flashMat: THREE.Material) {
    this.rig = buildExplorer(TEAM_COLOR[team]);
    this.tag = makeTag(name, team, mine);
    this.tag.position.set(0, 2.3, 0);
    this.rig.root.add(this.tag);
    this.rig.root.visible = false;
    // team colour on the tunic too, so friend / foe reads at a glance
    this.rig.body.children[0]?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = new THREE.MeshLambertMaterial({ color: team === 'red' ? '#9b3a2e' : '#2f5a9b' });
    });
    this.flash = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), flashMat);
    this.flash.visible = false;
    parent.add(this.rig.root);
  }

  setTeam(team: Team, name: string): void {
    if (team === this.team && name === this.name) return;
    this.team = team;
    this.name = name;
    setScarfColor(this.rig, TEAM_COLOR[team]);
    const old = this.tag.material as THREE.SpriteMaterial;
    this.tag.material = makeTag(name, team, this.mine).material;
    old.map?.dispose();
    old.dispose();
  }

  push(s: Snap): void {
    this.buf.push(s);
    if (this.buf.length > 30) this.buf.shift();
    if (!this.has) {
      this.has = true;
      this.pos.set(s.x, s.y, s.z);
      this.yaw = s.yaw;
    }
  }

  snapTo(x: number, y: number, z: number): void {
    this.buf = [];
    this.pos.set(x, y, z);
  }

  private setWeapon(w: WeaponId): void {
    if (w === this.gunId) return;
    this.gunId = w;
    const hand = this.rig.extra.hand;
    if (this.gunObj) hand.remove(this.gunObj);
    if (this.sword) hand.remove(this.sword);
    this.gunObj = this.sword = null;
    if (isGun(w)) {
      this.gunObj = buildGun(w);
      this.gunObj.scale.setScalar(0.85);
      // hand points down the arm (-Y); aim the barrel forward when the arm is raised
      this.gunObj.rotation.set(Math.PI / 2, 0, 0);
      this.gunObj.position.set(0, -0.02, 0.06);
      this.flash.position.copy(this.gunObj.userData.muzzle as THREE.Vector3);
      this.gunObj.add(this.flash);
      hand.add(this.gunObj);
    } else {
      const s = new THREE.Group();
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.1), new THREE.MeshLambertMaterial({ color: '#d7dde3' }));
      blade.position.y = 0.32;
      const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.06), new THREE.MeshLambertMaterial({ color: '#5a3a22' }));
      hilt.position.y = -0.05;
      s.add(blade, hilt);
      s.rotation.x = Math.PI / 2.2;
      this.sword = s;
      hand.add(s);
    }
  }

  fired(): void {
    this.firedAt = performance.now();
    this.fireKick = 1;
    this.flashT = 0.06;
  }

  update(dt: number, time: number): void {
    const t = performance.now() - INTERP_MS;
    const b = this.buf;
    if (b.length) {
      let i = b.length - 1;
      while (i > 0 && b[i - 1].t > t) i--;
      const a = b[Math.max(0, i - 1)], c = b[i];
      const k = c.t === a.t ? 1 : Math.max(0, Math.min(1, (t - a.t) / (c.t - a.t)));
      const tx = a.x + (c.x - a.x) * k, ty = a.y + (c.y - a.y) * k, tz = a.z + (c.z - a.z) * k;
      if (Math.hypot(tx - this.pos.x, tz - this.pos.z) > 6) this.pos.set(tx, ty, tz);
      else this.pos.lerp(new THREE.Vector3(tx, ty, tz), Math.min(1, dt * 18));
      let dy = c.yaw - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * Math.min(1, dt * 14);
      this.pitch += (c.pitch - this.pitch) * Math.min(1, dt * 14);
      this.w = c.w;
      this.flags = c.f;
      this.move = c.m;
      while (b.length > 2 && b[1].t < t) b.shift();
    }
    this.setWeapon(this.w);
    this.swing = Math.max(0, this.swing - dt * 3.2);
    this.fireKick = Math.max(0, this.fireKick - dt * 10);
    this.flashT = Math.max(0, this.flashT - dt);
    this.flash.visible = this.flashT > 0;
    const r = this.rig.root;
    r.visible = this.has && this.alive;
    r.position.copy(this.pos);
    r.rotation.y = this.yaw + Math.PI;
    const crouch = (this.flags & 1) !== 0;
    const reloading = (this.flags & 8) !== 0;
    animateExplorer(this.rig, {
      moving: this.move, time: time + this.id.length, action: 0, grounded: (this.flags & 2) !== 0, swimming: false,
      swing: this.swing > 0 ? 1 - this.swing : 0, swingKind: 'attack', look: -this.pitch,
    });
    if (isGun(this.w)) {
      // hold the gun up: both arms forward, aimed where they look
      const [armL, armR] = this.rig.arms;
      const aimX = -Math.PI / 2 - this.pitch * 0.9;
      armR.rotation.set(aimX + this.fireKick * 0.15, 0, 0.1);
      armL.rotation.set(aimX + 0.1 + (reloading ? Math.sin(time * 9) * 0.35 : 0), 0, -0.55);
    }
    if (crouch) this.rig.body.position.y -= 0.18;
    (this.tag.material as THREE.SpriteMaterial).opacity = this.prot ? 0.55 + Math.sin(time * 8) * 0.25 : 1;
  }

  dispose(parent: THREE.Object3D): void {
    parent.remove(this.rig.root);
    const m = this.tag.material as THREE.SpriteMaterial;
    m.map?.dispose();
    m.dispose();
  }
}

function makeTag(name: string, team: Team, mine: boolean): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 56;
  const g = c.getContext('2d')!;
  g.font = "900 30px Nunito, 'Trebuchet MS', sans-serif";
  const w = Math.min(248, g.measureText(name).width + 38);
  g.fillStyle = team === 'red' ? 'rgba(120,22,18,0.82)' : 'rgba(18,42,110,0.82)';
  g.beginPath();
  g.roundRect((256 - w) / 2, 6, w, 44, 22);
  g.fill();
  g.fillStyle = mine ? '#9dff9d' : TEAM_TAG[team];
  g.beginPath();
  g.arc((256 - w) / 2 + 18, 28, 7, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff8e8';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, 128 + 9, 29, w - 36);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // teammates' tags show through walls; enemies' don't
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: !mine, fog: false }));
  s.scale.set(1.6, 0.35, 1);
  s.renderOrder = 5;
  return s;
}

/** Floating name over a ground item; guns also show the key that picks them up. */
function makeItemLabel(text: string, key: string | null): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = "800 28px Nunito, 'Trebuchet MS', sans-serif";
  const kw = key ? g.measureText(key).width + 22 : 0;
  const w = Math.min(312, g.measureText(text).width + 28 + (key ? kw + 8 : 0));
  const x0 = (320 - w) / 2;
  g.fillStyle = 'rgba(20,16,12,0.72)';
  g.beginPath();
  g.roundRect(x0, 8, w, 48, 14);
  g.fill();
  g.textBaseline = 'middle';
  let x = x0 + 14;
  if (key) {
    g.fillStyle = '#ffd24a';
    g.beginPath();
    g.roundRect(x, 15, kw, 34, 8);
    g.fill();
    g.fillStyle = '#2a1a08';
    g.textAlign = 'center';
    g.fillText(key, x + kw / 2, 33);
    x += kw + 8;
  }
  g.fillStyle = '#fff8e8';
  g.textAlign = 'left';
  g.fillText(text, x, 33, 312 - (x - x0));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  s.scale.set(1.5, 0.3, 1);
  s.name = 'label';
  s.renderOrder = 4;
  return s;
}

interface GroundItem {
  lid: string;
  kind: LootKind;
  obj: THREE.Group;
  pos: THREE.Vector3;
  lastAsk: number;
}

interface Tracer {
  mesh: THREE.Mesh;
  life: number;
}

export class DeathmatchSession {
  readonly net: DmNet;
  readonly group = new THREE.Group();
  readonly gunView = new GunViewModel();
  readonly arsenal = new Arsenal({ equipDelay: 0.3 });
  private remotes = new Map<string, DmRemote>();
  private roster = new Map<string, RoomPlayer>();
  private items = new Map<string, GroundItem>();
  private tracers: Tracer[] = [];
  private tracerGeo = new THREE.BoxGeometry(1, 1, 1);
  private tracerMat = new THREE.MeshBasicMaterial({ color: '#ffe7a0', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  private flashMat = new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  private ringGeo = new THREE.RingGeometry(0.35, 0.55, 24);
  private boundary: THREE.Mesh[] = [];
  private stationMeshes: THREE.Group[] = [];
  private stationReady = new Map<string, number>();
  private stationAsk = 0;
  team: Team = 'red';
  round = 0;
  private phase: 'loading' | 'preparing' | 'playing' | 'ended' = 'loading';
  private prepEndsAt = 0;
  private endAt = 0;
  hp = MAX_HP;
  alive = true;
  private protUntil = 0;
  private respawnAt = 0;
  private healUntil = 0;
  private healSize: 'small' | 'large' | null = null;
  private healStart = 0;
  private seq = 0;
  private sendTimer = 0;
  private uiTimer = 0;
  private aim = 0;
  /** Mobile aim toggle. */
  touchAim = false;
  private lastSlot: Slot = 0;
  private lastTick = -1;
  private lastDry = 0;
  private pickAsk = 0;
  private wasHeld = false;
  private warned30 = false;
  private lastYaw = 0;
  private lastPitch = 0;
  private disposed = false;
  private scoreHeld = false;

  constructor(private game: Game) {
    const net = dmNet.current;
    if (!net) throw new Error('No Deathmatch room — start from the Deathmatch menu.');
    this.net = net;
    this.round = net.round;
    this.group.name = 'dm-players';
    game.scene.add(this.group);
    const lobby = useDeathmatchStore.getState().lobby;
    for (const p of lobby?.players ?? []) this.roster.set(p.id, p);
    this.team = this.roster.get(net.selfId)?.team ?? 'red';
    this.buildBoundary();
    this.buildStations();
    useDeathmatchStore.getState().set({ phase: 'loading', hp: MAX_HP, alive: true, respawnPending: false, weapon: 'sword', loadout: this.arsenal.snapshot() });
  }

  get selfId(): string {
    return this.net.selfId;
  }

  get weapon(): WeaponId {
    return this.arsenal.weapon;
  }

  /** Movement & look allowed? (frozen in the countdown, after the final whistle, and while dead). */
  get canMove(): boolean {
    return this.phase === 'playing' && this.alive;
  }

  /** The world is loaded and the player placed: tell the host we're ready. */
  begin(): void {
    this.net.attach((m) => this.receive(m));
    this.net.send({ t: 'ready', r: this.round });
    if (this.net.launch?.late) useDeathmatchStore.getState().set({ notice: 'Reconnected — back into the match!' });
  }

  // ---------------------------------------------------------------- scenery helpers

  private buildBoundary(): void {
    // a faint shimmering wall just inside the boundary buildings
    const mat = new THREE.MeshBasicMaterial({ color: '#ff5a3c', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const len = PLAY_HALF * 2;
    for (const [x, z, ry] of [[0, -PLAY_HALF, 0], [0, PLAY_HALF, 0], [-PLAY_HALF, 0, Math.PI / 2], [PLAY_HALF, 0, Math.PI / 2]] as const) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 14), mat.clone());
      m.position.set(x, CITY_G + 7, z);
      m.rotation.y = ry;
      m.renderOrder = 3;
      this.boundary.push(m);
      this.group.add(m);
    }
  }

  private buildStations(): void {
    for (const s of HEALTH_STATIONS) {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: '#4dff88', transparent: true, opacity: 0.85 });
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.16), mat);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), mat);
      g.add(a, b);
      const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: '#4dff88', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.scale.setScalar(3);
      ring.position.y = -1.15;
      g.add(ring);
      g.position.set(s.x, s.y + 1.2, s.z);
      g.userData.id = s.id;
      this.stationMeshes.push(g);
      this.group.add(g);
    }
  }

  // ---------------------------------------------------------------- network in

  private receive(m: ServerMsg): void {
    if (this.disposed) return;
    const st = useDeathmatchStore.getState();
    const me = this.selfId;
    switch (m.t) {
      case 'prep':
        this.phase = 'preparing';
        this.prepEndsAt = m.endsAt;
        st.set({ phase: 'preparing' });
        return;
      case 'go':
        this.phase = 'playing';
        this.endAt = m.endAt;
        this.protUntil = Math.max(this.protUntil, this.net.hostNow() + 3);
        st.set({ phase: 'playing', notice: 'FIGHT!' });
        playDm('fight');
        setTimeout(() => useDeathmatchStore.getState().notice === 'FIGHT!' && useDeathmatchStore.getState().set({ notice: null }), 1400);
        if (this.alive && useGameStore.getState().overlay === null && !useDeathmatchStore.getState().optionsOpen) this.game.input.requestLock();
        return;
      case 'ss': {
        const t = performance.now();
        const seen = new Set<string>();
        const stats: Record<string, { kills: number; deaths: number }> = {};
        let changed = false;
        for (const e of m.l) {
          const [id, x, y, z, yaw, pitch, w, f, mv, hp, alive, prot, kills, deaths] = e as [string, number, number, number, number, number, WeaponId, number, number, number, number, number, number, number];
          seen.add(id);
          stats[id] = { kills: kills | 0, deaths: deaths | 0 };
          const prev = st.stats[id];
          if (!prev || prev.kills !== stats[id].kills || prev.deaths !== stats[id].deaths) changed = true;
          if (id === me) {
            if (Math.abs(hp - this.hp) >= 1 && !(this.healUntil > 0)) this.hp = hp;
            continue;
          }
          let r = this.remotes.get(id);
          const info = this.roster.get(id) ?? useDeathmatchStore.getState().lobby?.players.find((p) => p.id === id);
          if (!r) {
            r = new DmRemote(id, info?.name ?? 'Player', info?.team ?? 'red', (info?.team ?? 'red') === this.team, this.group, this.flashMat);
            this.remotes.set(id, r);
          } else if (info) r.setTeam(info.team, info.name);
          r.push({ t, x, y, z, yaw, pitch, w, f, m: mv });
          r.hp = hp;
          r.alive = alive === 1;
          r.prot = prot === 1;
        }
        if (changed || Object.keys(stats).length !== Object.keys(st.stats).length) st.set({ stats });
        for (const [id, r] of this.remotes) if (!seen.has(id)) {
          r.dispose(this.group);
          this.remotes.delete(id);
        }
        return;
      }
      case 'shot': {
        const r = this.remotes.get(m.id);
        r?.fired();
        const o = new THREE.Vector3(...m.o);
        playGun(m.w, o, false);
        m.ends.forEach((e, i) => this.tracer(o, new THREE.Vector3(...e), !m.hits[i]));
        return;
      }
      case 'swing': {
        const r = this.remotes.get(m.id);
        if (r) {
          r.swing = 1;
          playDm('swordSwing', r.pos);
        }
        return;
      }
      case 'dmg': {
        if (m.v === me) {
          this.hp = m.hp;
          const from = new THREE.Vector3(...m.from);
          const p = this.game.player;
          const ang = Math.atan2(-(from.x - p.position.x), -(from.z - p.position.z)) - p.yaw;
          st.set({ hp: m.hp, hurtAt: performance.now(), hurtDir: ang });
          p.shake = Math.min(1, p.shake + 0.35);
          useGameStore.setState({ hurtFlash: performance.now() });
          this.game.audio.play('hurt');
        } else {
          const r = this.remotes.get(m.v);
          if (r) {
            r.hp = m.hp;
            this.game.particles.emit('spark', r.pos.x, r.pos.y + (m.head ? 1.55 : 1.0), r.pos.z, 8, [0.85, 0.15, 0.12], { speed: 2.5, size: 0.07, life: 0.35 });
          }
          if (m.a === me && r) {
            this.game.fx.pop(String(Math.round(m.n)), r.pos.x, r.pos.y + 2, r.pos.z, m.head ? '#ffd24a' : '#ffffff', m.head);
            st.set({ hitAt: performance.now(), hitHead: m.head });
            playDm(m.head ? 'headshot' : 'hit');
          }
        }
        return;
      }
      case 'kill': {
        const name = (id: string | null) => (id ? (id === me ? 'You' : this.roster.get(id)?.name ?? 'Someone') : null);
        st.pushFeed({ killer: name(m.k), killerTeam: m.k ? this.roster.get(m.k)?.team : undefined, victim: name(m.v) ?? 'Someone', victimTeam: this.roster.get(m.v)?.team, weapon: feedWeapon(m.w), head: m.head });
        st.set({ red: m.red, blue: m.blue });
        if (m.v === me) {
          this.alive = false;
          this.hp = 0;
          this.respawnAt = m.respawnAt;
          this.game.player.dead = true;
          this.game.player.body.vel.set(0, 0, 0);
          this.game.releasePointer();
          this.game.input.endFrame();
          this.healUntil = 0;
          this.healSize = null;
          this.arsenal.reset();
          st.set({ alive: false, hp: 0, respawnIn: Math.max(0, m.respawnAt - this.net.hostNow()), respawnPending: false, killedBy: m.k ? { name: this.roster.get(m.k)?.name ?? 'Someone', weapon: feedWeapon(m.w), team: this.roster.get(m.k)?.team } : { name: m.w === 'fall' ? 'a fall' : 'the city', weapon: feedWeapon(m.w) }, healing: null });
          playDm('eliminated');
        } else {
          const r = this.remotes.get(m.v);
          if (r) {
            r.alive = false;
            this.game.particles.emit('poof', r.pos.x, r.pos.y + 0.9, r.pos.z, 18, [0.85, 0.85, 0.85], { speed: 2, size: 0.18, life: 0.8 });
          }
          if (m.k === me) {
            st.set({ killAt: performance.now() });
            playDm('kill');
          }
        }
        return;
      }
      case 'spawn': {
        if (m.id === me) {
          const p = this.game.player;
          p.teleport(m.p[0], m.p[1] + 0.05, m.p[2]);
          p.yaw = m.yw;
          p.pitch = 0;
          p.dead = false;
          p.vitality = p.maxVitality;
          this.alive = true;
          this.hp = MAX_HP;
          this.protUntil = m.protUntil;
          this.arsenal.reset();
          this.gunView.setGun(null);
          this.game.ensureSafePosition();
          st.set({ alive: true, hp: MAX_HP, killedBy: null, respawnIn: 0, respawnPending: false });
          if (useGameStore.getState().overlay === null && !useDeathmatchStore.getState().optionsOpen) this.game.input.requestLock();
        } else {
          const r = this.remotes.get(m.id);
          if (r) {
            r.snapTo(m.p[0], m.p[1], m.p[2]);
            r.alive = true;
          }
        }
        return;
      }
      case 'respawnWait': {
        this.respawnAt = m.until;
        st.set({ respawnPending: false, respawnIn: Math.max(0, m.until - this.net.hostNow()) });
        return;
      }
      case 'inv': {
        const before = this.arsenal.weapon;
        this.arsenal.load(m.inv, nowS());
        // the host is mid-reload: keep our animation in step
        if (m.reload > 0 && !this.arsenal.reloading && this.arsenal.gun) {
          const left = Math.max(0, m.reload - this.net.hostNow());
          if (left > 0) this.arsenal.reloading = { gun: this.arsenal.gun, startedAt: nowS() - (GUNS[this.arsenal.gun].reloadSeconds * 0.85 - left), endsAt: nowS() + left };
        }
        if (this.arsenal.weapon !== before) this.gunView.equip();
        return;
      }
      case 'hp':
        if (m.id === me) {
          if (m.hp > this.hp) {
            playDm('heal');
            this.game.particles.emit('sparkle', this.game.player.position.x, this.game.player.position.y + 1, this.game.player.position.z, 12, [0.4, 1, 0.5], { speed: 1.5, size: 0.08, life: 0.7, up: 1.5 });
          }
          this.hp = m.hp;
        } else {
          const r = this.remotes.get(m.id);
          if (r) r.hp = m.hp;
        }
        return;
      case 'heal':
        if (m.ok && m.until > 0) {
          this.healSize = m.size;
          this.healUntil = m.until;
          this.healStart = this.net.hostNow();
        } else {
          this.healUntil = 0;
          this.healSize = null;
          if (!m.ok && m.reason) this.toast(m.reason, '🩹');
        }
        return;
      case 'loot':
        if (m.reset) for (const lid of [...this.items.keys()]) this.removeItem(lid);
        for (const [lid, kind, x, y, z] of m.items) this.addItem(lid, kind, x, y, z);
        return;
      case 'lootGone': {
        const it = this.items.get(m.lid);
        if (it && m.by === me) {
          playDm('pickup');
          this.toast(`Picked up ${lootLabel(it.kind)}`, it.kind.k === 'med' ? '🩹' : it.kind.k === 'gun' ? '🔫' : '📦');
        }
        this.removeItem(m.lid);
        return;
      }
      case 'pickRej':
        if (performance.now() - this.pickAsk > 600) this.toast(m.reason, '🎒');
        this.pickAsk = performance.now();
        return;
      case 'station':
        this.stationReady.set(m.sid, m.readyAt);
        return;
      case 'correct':
        this.game.player.teleport(m.p[0], m.p[1], m.p[2]);
        return;
      case 'end':
        this.phase = 'ended';
        st.set({ phase: 'ended', result: m.result, red: m.result.red, blue: m.result.blue, scoreboardOpen: false, aiming: false, scoped: false });
        playDm(m.result.winner === this.team ? 'victory' : m.result.winner === 'draw' ? 'team' : 'defeat');
        this.game.releasePointer();
        return;
    }
  }

  private toast(text: string, icon: string): void {
    useGameStore.getState().toast(text, 'info', icon);
  }

  // ---------------------------------------------------------------- ground items

  private addItem(lid: string, kind: LootKind, x: number, y: number, z: number): void {
    if (this.items.has(lid)) return;
    const g = new THREE.Group();
    const key = kind.k === 'gun' ? kind.gun : kind.k === 'ammo' ? kind.ammo : kind.k === 'pack' ? 'pack' : kind.size;
    const color = PICKUP_GLOW[key] ?? '#ffffff';
    const model = kind.k === 'gun' ? buildGun(kind.gun) : buildPickupModel(kind.k === 'med' ? kind.size : kind.k === 'pack' ? 'pack' : 'ammo', color);
    if (kind.k === 'gun') {
      model.scale.setScalar(1.05);
      model.rotation.set(0, Math.PI / 2, 0.15);
      model.position.y = 0.45;
    } else model.position.y = 0.2;
    const spin = new THREE.Group();
    spin.add(model);
    spin.name = 'spin';
    g.add(spin);
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    ring.scale.setScalar(kind.k === 'gun' ? 1.4 : 1);
    g.add(ring);
    const label = makeItemLabel(lootLabel(kind), kind.k === 'gun' ? (this.game.input.touch.active ? '✋' : 'E') : null);
    label.position.y = kind.k === 'gun' ? 1.25 : 0.95;
    g.add(label);
    g.position.set(x, y, z);
    this.group.add(g);
    this.items.set(lid, { lid, kind, obj: g, pos: new THREE.Vector3(x, y, z), lastAsk: 0 });
  }

  private removeItem(lid: string): void {
    const it = this.items.get(lid);
    if (!it) return;
    this.group.remove(it.obj);
    it.obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry === this.ringGeo) (m.material as THREE.Material).dispose();
      if ((o as THREE.Sprite).isSprite) {
        const sm = (o as THREE.Sprite).material;
        sm.map?.dispose();
        sm.dispose();
      }
    });
    this.items.delete(lid);
  }

  // ---------------------------------------------------------------- effects

  private tracer(from: THREE.Vector3, to: THREE.Vector3, impact: boolean): void {
    const len = from.distanceTo(to);
    if (len > 0.5) {
      const m = new THREE.Mesh(this.tracerGeo, this.tracerMat);
      m.scale.set(0.025, 0.025, len);
      m.position.copy(from).add(to).multiplyScalar(0.5);
      m.lookAt(to);
      this.group.add(m);
      this.tracers.push({ mesh: m, life: 0.06 });
      if (this.tracers.length > 40) {
        const t = this.tracers.shift()!;
        this.group.remove(t.mesh);
      }
    }
    if (impact && this.game.particles.density > 0) {
      this.game.particles.emit('spark', to.x, to.y, to.z, 4, [1, 0.85, 0.5], { speed: 2.5, size: 0.05, life: 0.25 });
      this.game.particles.emit('mist', to.x, to.y, to.z, 2, [0.7, 0.68, 0.64], { spread: 0.15, speed: 0.6, size: 0.18, life: 0.5 });
    }
  }

  // ---------------------------------------------------------------- local actions (also used by touch buttons)

  equip(slot: Slot): void {
    if (!this.canMove) return;
    if (slot !== this.arsenal.sel && this.arsenal.equip(slot, nowS())) {
      this.lastSlot = slot;
      this.net.send({ t: 'equip', r: this.round, slot });
      this.gunView.equip();
      this.game.audio.play('click');
      this.healCancelLocal();
    }
  }

  cycleWeapon(dir: 1 | -1 = 1): void {
    this.equip(this.arsenal.cycle(dir));
  }

  reload(): void {
    if (!this.canMove) return;
    if (this.arsenal.startReload(nowS())) {
      this.net.send({ t: 'reload', r: this.round });
      playDm(this.arsenal.gun === 'shotgun' ? 'pump' : 'reload');
    }
  }

  heal(size?: 'small' | 'large'): void {
    if (!this.canMove || this.healUntil > 0) return;
    const s = size ?? (this.arsenal.small > 0 ? 'small' : this.arsenal.large > 0 ? 'large' : null);
    if (!s) return this.toast('No medkits — find them around the city', '🩹');
    if (this.hp >= MAX_HP) return this.toast('Health is already full', '❤️');
    this.net.send({ t: 'heal', r: this.round, size: s });
  }

  private healCancelLocal(): void {
    if (this.healSize === 'large') {
      this.healUntil = 0;
      this.healSize = null;
    }
  }

  /** Radar: every living player, near or far — teammates green, opponents red. */
  radarBlips(): { name: string; color: string; x: number; y: number; z: number }[] {
    const out: { name: string; color: string; x: number; y: number; z: number }[] = [];
    for (const r of this.remotes.values()) {
      if (!r.alive) continue;
      const mate = r.team === this.team;
      out.push({ name: r.name, color: mate ? '#3ddc5a' : '#ff3b30', x: r.pos.x, y: r.pos.y, z: r.pos.z });
    }
    return out;
  }

  toggleScoreboard(): void {
    const st = useDeathmatchStore.getState();
    st.set({ scoreboardOpen: !st.scoreboardOpen });
  }

  /** Nearest ground item in pickup range (and why it can't be taken, if so). */
  private nearestItem(): GroundItem | null {
    const p = this.game.player.position;
    let best: GroundItem | null = null, bd = PICKUP_RANGE - 0.4;
    for (const it of this.items.values()) {
      const d = Math.hypot(it.pos.x - p.x, it.pos.z - p.z);
      if (d < bd && Math.abs(it.pos.y - p.y) < 1.8) {
        bd = d;
        best = it;
      }
    }
    return best;
  }

  pickUp(): void {
    const it = this.nearestItem();
    if (!it || !this.canMove) return;
    this.askPick(it);
  }

  private askPick(it: GroundItem): void {
    const t = performance.now();
    if (t - it.lastAsk < 500) return;
    it.lastAsk = t;
    this.net.send({ t: 'pick', r: this.round, lid: it.lid });
  }

  /** Camera ray → aim direction from the eye (third person: through the crosshair). */
  private aimRay(): { o: Vec; d: Vec } {
    const p = this.game.player;
    const eye = p.eyePosition();
    const cam = this.game.camera;
    const cd = cam.getWorldDirection(new THREE.Vector3());
    if (p.cameraMode === 'first') return { o: [eye.x, eye.y, eye.z], d: [cd.x, cd.y, cd.z] };
    const co: Vec = [cam.position.x, cam.position.y, cam.position.z];
    const tr = traceVoxels(co, [cd.x, cd.y, cd.z], 150, (x, y, z) => this.game.world.get(x, y, z));
    const target = new THREE.Vector3(...co).addScaledVector(cd, Math.max(4, tr.dist));
    const d = target.sub(eye).normalize();
    return { o: [eye.x, eye.y, eye.z], d: [d.x, d.y, d.z] };
  }

  private shoot(gun: GunId): void {
    const t = nowS();
    const p = this.game.player;
    this.arsenal.fire(t);
    this.seq++;
    const def = GUNS[gun];
    const { o, d } = this.aimRay();
    const speed = Math.hypot(p.body.vel.x, p.body.vel.z);
    const aiming = this.aim > 0.6;
    const spread = effectiveSpread(def.spreadHip, def.spreadAds, { aiming, speed, airborne: !p.body.grounded, crouch: p.crouching });
    const dirs = spreadDirs(d, spread, def.pellets, shotSeed(this.selfId, this.round, this.seq));
    // local prediction of where the bullets land (visual only — the host decides damage)
    const muzzle = new THREE.Vector3(...o).addScaledVector(new THREE.Vector3(...d), 0.6);
    if (p.cameraMode === 'first') muzzle.add(new THREE.Vector3(0, -0.15, 0));
    const targets = [...this.remotes.values()].filter((r) => r.alive && r.team !== this.team).map((r) => ({ id: r.id, x: r.pos.x, y: r.pos.y, z: r.pos.z, crouch: (r.flags & 1) !== 0 }));
    for (const dir of dirs) {
      const wall = traceVoxels(o, dir, def.maxRange, (x, y, z) => this.game.world.get(x, y, z));
      const hit = rayPlayers(o, dir, wall.dist, targets);
      const dist = hit ? hit.dist : wall.dist;
      const end = new THREE.Vector3(o[0] + dir[0] * dist, o[1] + dir[1] * dist, o[2] + dir[2] * dist);
      this.tracer(muzzle, end, !hit && wall.hit);
    }
    this.net.send({ t: 'fire', r: this.round, s: this.seq, w: gun, o, d, at: this.net.hostNow(), ads: aiming });
    // recoil: permanent climb + random sideways kick
    const rk = aiming ? 0.7 : 1;
    p.pitch = Math.min(1.5, p.pitch + def.recoilV * rk * (0.8 + Math.random() * 0.4));
    p.yaw += (Math.random() - 0.5) * 2 * def.recoilH * rk;
    p.shake = Math.min(1, p.shake + (gun === 'shotgun' || gun === 'm24' ? 0.25 : 0.06));
    this.gunView.fire(gun);
    playGun(gun);
    if (gun === 'shotgun') this.game.defer(() => playDm('pump'), 300);
    if (gun === 'm24') this.game.defer(() => playDm('bolt'), 250);
    this.protUntil = 0;
    this.healCancelLocal();
    if (this.arsenal.mag(gun) === 0 && this.arsenal.reserveFor(gun) > 0) this.game.defer(() => this.reload(), 250);
  }

  private swingSword(): void {
    const t = nowS();
    if (!this.arsenal.melee(t)) return;
    this.seq++;
    const { o, d } = this.aimRay();
    this.net.send({ t: 'melee', r: this.round, s: this.seq, o, d, at: this.net.hostNow() });
    this.game.viewModel.trigger('attack');
    this.game.player.swing = 1;
    this.game.player.swingKind = 'attack';
    playDm('swordSwing');
    this.protUntil = 0;
  }

  /** Local fall damage → reported to the host, which owns health. */
  envDamage(amount: number, cause: string): number {
    if (this.phase !== 'playing' || !this.alive || amount < 1) return 0;
    this.net.send({ t: 'env', r: this.round, amt: Math.round(amount), cause });
    return amount;
  }

  requestRespawn(): boolean {
    const st = useDeathmatchStore.getState();
    if (this.disposed || this.phase !== 'playing' || this.alive || st.respawnPending || this.net.hostNow() < this.respawnAt) return false;
    st.set({ respawnPending: true });
    this.net.send({ t: 'respawn', r: this.round });
    return true;
  }

  // ---------------------------------------------------------------- per frame

  update(dt: number, simulate: boolean): void {
    if (this.disposed) return;
    const g = this.game;
    const p = g.player;
    const inp = g.input;
    const st = useDeathmatchStore.getState();
    const hostNow = this.net.hostNow();
    const t = nowS();
    p.frozen = !this.canMove;
    p.vitality = Math.max(0, this.hp);

    // weapon timers
    const reloaded = this.arsenal.update(t);
    if (reloaded) playDm('magIn');
    const gun = this.arsenal.gun;
    this.gunView.setGun(gun);

    // team voice: hold T to talk (or tap, in open-mic mode), H = listen on / off
    const v = this.net.voice;
    if (v) {
      if (useGameStore.getState().overlay === null) {
        if (inp.wasPressed('listen')) void v.toggleListen();
        if (v.mode === 'push') v.setPush('key', inp.isDown('talk'));
        else if (inp.wasPressed('talk')) void v.toggleTalk();
      } else v.setPush('key', false);
    }

    // keyboard / mouse / touch
    const active = simulate && !inp.cursorFree && this.canMove;
    const wantAim = active && !!gun && (inp.mouseRight || this.touchAim) && !this.arsenal.reloading && !p.sprinting;
    this.aim += ((wantAim ? 1 : 0) - this.aim) * Math.min(1, dt * (gun === 'm24' ? 9 : 14));
    if (simulate && this.phase === 'playing') {
      // Tab holds the scoreboard open
      const tab = inp.keyDown('Tab');
      if (tab !== this.scoreHeld) {
        this.scoreHeld = tab;
        st.set({ scoreboardOpen: tab });
      }
    }
    if (active) {
      for (let i = 0; i < 3; i++) if (inp.keyPressed(`Digit${i + 1}`)) this.equip(i as Slot);
      if (inp.keyPressed('KeyQ')) this.equip(this.lastSlot !== this.arsenal.sel ? this.lastSlot : this.arsenal.cycle(1));
      if (inp.wheel) this.cycleWeapon(inp.wheel > 0 ? 1 : -1);
      if (inp.keyPressed('KeyR')) this.reload();
      if (inp.keyPressed('Digit4')) this.heal('small');
      if (inp.keyPressed('Digit5')) this.heal('large');
      if (inp.keyPressed('KeyE') || inp.touch.interactPressed) this.pickUp();
      // desktop: left click or F fires
      const held = inp.mouseLeft || inp.keyDown('KeyF') || inp.touch.breakHeld;
      const pressed = held && !this.wasHeld;
      this.wasHeld = held;
      if (gun) {
        const def = GUNS[gun];
        if (held && (def.automatic || pressed)) {
          const block = this.arsenal.canFire(t);
          if (!block) this.shoot(gun);
          else if (block === 'empty' && pressed && t - this.lastDry > 0.25) {
            this.lastDry = t;
            playDm('dry');
            if (this.arsenal.reserveFor(gun) > 0) this.reload();
            else this.toast(`Out of ${gun === 'shotgun' ? 'shells' : 'ammo'} — find ammo or switch weapons`, '📦');
          }
        }
      } else if (held) this.swingSword();
    } else this.wasHeld = inp.mouseLeft || inp.keyDown('KeyF') || inp.touch.breakHeld;

    // pickups: ammo & medkits are collected by walking over them, guns with E / ✋
    let prompt: string | null = null;
    if (this.canMove) {
      const it = this.nearestItem();
      if (it) {
        const why = pickupBlock(it.kind, this.arsenal);
        if (it.kind.k === 'gun') prompt = why ? `${lootLabel(it.kind)} — ${why}` : `${inp.touch.active ? '✋' : 'E'}  Pick up ${lootLabel(it.kind)}`;
        else if (!why) this.askPick(it);
        else prompt = `${lootLabel(it.kind)} — ${why}`;
      }
      // health stations heal when you step on them
      for (const s of HEALTH_STATIONS) {
        if (Math.hypot(p.position.x - s.x, p.position.z - s.z) > 1.8 || this.hp >= MAX_HP) continue;
        if ((this.stationReady.get(s.id) ?? 0) > hostNow) prompt = `Health station recharging (${Math.ceil((this.stationReady.get(s.id) ?? 0) - hostNow)} s)`;
        else if (performance.now() - this.stationAsk > 1000) {
          this.stationAsk = performance.now();
          this.net.send({ t: 'station', r: this.round, sid: s.id });
        }
      }
    }

    // keep inside the arena (physical walls do the work; this is the safety net)
    const c = clampToArena(p.position.x, p.position.z);
    if (c.x !== p.position.x || c.z !== p.position.z) {
      p.position.x = c.x;
      p.position.z = c.z;
    }

    // scope & aim zoom, slower movement while aimed
    const baseFov = useSettingsStore.getState().graphics.fov;
    const zoom = gun ? 1 + (GUNS[gun].adsZoom - 1) * this.aim : 1;
    const scoped = gun === 'm24' && this.aim > 0.85;
    p.fovOverride = zoom > 1.01 ? (2 * Math.atan(Math.tan((baseFov * Math.PI) / 360) / zoom) * 180) / Math.PI : null;
    p.lookScale = 1 / zoom;
    p.speedScale = gun ? 1 + (GUNS[gun].adsMove - 1) * this.aim : 1;

    // outgoing state
    this.sendTimer -= dt;
    if (this.sendTimer <= 0 && g.ready && this.phase !== 'loading') {
      this.sendTimer = 1 / SEND_HZ;
      const b = p.body;
      const r2 = (v: number) => Math.round(v * 100) / 100;
      const flags = (p.crouching ? 1 : 0) | (b.grounded ? 2 : 0) | (this.aim > 0.5 ? 4 : 0) | (this.arsenal.reloading ? 8 : 0) | (p.sprinting ? 16 : 0) | (this.healUntil > 0 ? 32 : 0);
      this.net.send({ t: 'st', r: this.round, p: [r2(b.pos.x), r2(b.pos.y), r2(b.pos.z)], yw: r2(p.yaw), pt: r2(p.pitch), w: this.arsenal.weapon, f: flags, m: r2(Math.min(1, Math.hypot(b.vel.x, b.vel.z) / 8)) });
    }

    // remotes, items, tracers, boundary glow, stations
    for (const r of this.remotes.values()) r.update(dt, g.time);
    for (const it of this.items.values()) {
      const s = it.obj.getObjectByName('spin');
      if (s) {
        s.rotation.y += dt * 1.4;
        s.position.y = 0.15 + Math.sin(g.time * 2.4 + it.pos.x) * 0.08;
      }
      const label = it.obj.getObjectByName('label');
      if (label) label.visible = it.pos.distanceToSquared(p.position) < 16 * 16;
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life -= dt;
      if (tr.life <= 0) {
        this.group.remove(tr.mesh);
        this.tracers.splice(i, 1);
      }
    }
    const edge = PLAY_HALF - Math.max(Math.abs(p.position.x), Math.abs(p.position.z));
    for (const m of this.boundary) (m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - edge / 8) * (0.16 + Math.sin(g.time * 3) * 0.04);
    for (const s of this.stationMeshes) {
      s.rotation.y += dt;
      const ready = (this.stationReady.get(s.userData.id) ?? 0) <= hostNow;
      s.children.forEach((ch) => ((((ch as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = ready ? 0.85 : 0.2)));
    }

    // first-person gun
    let dYaw = p.yaw - this.lastYaw;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
    const dPitch = p.pitch - this.lastPitch;
    this.lastYaw = p.yaw;
    this.lastPitch = p.pitch;
    this.gunView.update({
      dt, speed: Math.hypot(p.body.vel.x, p.body.vel.z), grounded: p.body.grounded, sprinting: p.sprinting, dYaw, dPitch, aspect: g.camera.aspect,
      light: 1, aim: this.aim, reload: this.arsenal.reloadProgress(t), visible: p.cameraMode === 'first' && this.alive && !scoped && !useGameStore.getState().hudHidden,
      reducedMotion: useSettingsStore.getState().accessibility.reducedShake,
    });
    this.updateThirdPersonGun();

    // countdown & clock sounds
    if (this.phase === 'preparing') {
      const left = Math.ceil(this.prepEndsAt - hostNow);
      if (left !== this.lastTick && left >= 1 && left <= 10) {
        this.lastTick = left;
        playDm(left <= 3 ? 'tickFinal' : 'tick');
      }
    }
    if (this.phase === 'playing' && !this.warned30 && this.endAt - hostNow <= 30) {
      this.warned30 = true;
      playDm('warn');
    }

    // HUD store (~12 Hz)
    this.uiTimer -= dt;
    if (this.uiTimer <= 0) {
      this.uiTimer = 0.08;
      const healing = this.healUntil > 0 && this.healSize ? { size: this.healSize, progress: Math.min(1, (hostNow - this.healStart) / Math.max(0.1, this.healUntil - this.healStart)) } : null;
      if (this.healUntil > 0 && hostNow > this.healUntil + 0.6) this.healUntil = 0; // safety: never stuck
      st.set({
        countdown: this.phase === 'preparing' ? Math.max(0, this.prepEndsAt - hostNow) : 0,
        timeLeft: this.phase === 'playing' ? Math.max(0, this.endAt - hostNow) : this.phase === 'ended' ? 0 : st.timeLeft,
        hp: Math.max(0, Math.ceil(this.hp)), alive: this.alive, protectedFor: Math.max(0, this.protUntil - hostNow), respawnIn: this.alive ? 0 : Math.max(0, this.respawnAt - hostNow),
        loadout: this.arsenal.snapshot(), weapon: this.arsenal.weapon, reloading: this.arsenal.reloadProgress(t), healing, aiming: this.aim > 0.5, scoped,
        prompt, spread: gun ? effectiveSpread(GUNS[gun].spreadHip, GUNS[gun].spreadAds, { aiming: this.aim > 0.6, speed: Math.hypot(p.body.vel.x, p.body.vel.z), airborne: !p.body.grounded, crouch: p.crouching }) : 0,
      });
    }
  }

  private tpGun: THREE.Group | null = null;
  private tpGunId: GunId | null = null;

  /** Third person: the local explorer holds the actual gun. */
  private updateThirdPersonGun(): void {
    const p = this.game.player;
    const gun = this.arsenal.gun;
    if (gun !== this.tpGunId) {
      const hand = p.rig.extra.hand;
      if (this.tpGun) hand.remove(this.tpGun);
      this.tpGun = null;
      this.tpGunId = gun;
      if (gun) {
        this.tpGun = buildGun(gun);
        this.tpGun.scale.setScalar(0.85);
        this.tpGun.rotation.set(Math.PI / 2, 0, 0);
        this.tpGun.position.set(0, -0.02, 0.06);
        hand.add(this.tpGun);
      }
    }
    if (gun && p.rig.root.visible) {
      const [armL, armR] = p.rig.arms;
      const aimX = -Math.PI / 2 - p.pitch * 0.9;
      armR.rotation.set(aimX, 0, 0.1);
      armL.rotation.set(aimX + 0.1, 0, -0.55);
      p.bodyYaw = p.yaw;
    }
  }

  /** The team panel order for the HUD / scoreboard. */
  rosterTeam(id: string): Team | undefined {
    return this.roster.get(id)?.team;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.net.attach(null);
    for (const r of this.remotes.values()) r.dispose(this.group);
    this.remotes.clear();
    for (const lid of [...this.items.keys()]) this.removeItem(lid);
    this.game.scene.remove(this.group);
    this.tracerGeo.dispose();
    this.tracerMat.dispose();
    this.flashMat.dispose();
    this.ringGeo.dispose();
    this.gunView.dispose();
    for (const m of this.boundary) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    const p = this.game.player;
    p.fovOverride = null;
    p.lookScale = 1;
    p.speedScale = 1;
    p.frozen = false;
  }
}
