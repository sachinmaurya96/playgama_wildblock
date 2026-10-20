import * as THREE from 'three';
import { BIOMES } from '../data/biomes';
import { BLOCK_DEFS, type SoundMaterial, type StationKind } from '../data/blocks';
import { itemDef } from '../data/items';
import { QUESTS, TIPS } from '../data/progression';
import { useGameStore, type Difficulty, type Overlay } from '../stores/gameStore';
import { HOTBAR_SIZE, useInventoryStore } from '../stores/inventoryStore';
import { usePlayerStore } from '../stores/playerStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useWorldStore } from '../stores/worldStore';
import { loadMapTiles, writeSave } from '../persistence/SaveManager';
import { SAVE_VERSION, type MapTileRecord, type WorldMeta, type WorldStateSave } from '../persistence/types';
import { BuildMode } from './build/BuildMode';
import { PlotBackdrop } from './rendering/PlotBackdrop';
import { PLOT_Y } from './world/PlotGenerator';
import { useBuildStore } from '../stores/buildStore';
import { useDeathmatchStore } from '../stores/deathmatchStore';
import { usePvpStore } from '../stores/pvpStore';
import { AssetManager } from './core/AssetManager';
import { LOAD_TIMEOUT_SECONDS } from './deathmatch/DeathmatchRules';
import { audio } from './core/audio';
import type { AudioManager, Mood } from './core/AudioManager';
import { lifecycle } from '../platform/lifecycle';
import { EventBus } from './core/EventBus';
import { GameClock } from './core/GameClock';
import { InputManager } from './core/InputManager';
import { DroppedItems } from './entities/DroppedItems';
import { Boats } from './entities/Boats';
import { EntityManager } from './entities/EntityManager';
import { Projectiles } from './entities/Projectiles';
import { CombatFX } from './rendering/CombatFX';
import { PvpSession } from './pvp/PvpSession';
import { DeathmatchSession } from './deathmatch/DeathmatchSession';
import { CITY_G } from './deathmatch/DeathmatchMap';
import { dmNet } from '../net/deathmatchNet';
import { Player } from './player/Player';
import { PlayerInteraction } from './player/PlayerInteraction';
import { FurnitureInteraction } from './player/FurnitureInteraction';
import { BlockOutline } from './rendering/Overlays';
import { FirstPersonViewModel } from './rendering/FirstPersonViewModel';
import { Particles, Rain } from './rendering/Particles';
import { Clouds, Sky } from './rendering/Sky';
import { comfortAround, isSheltered } from './systems/BuildingSystem';
import { canCraft, craftState, nearbyStations } from './systems/CraftingSystem';
import type { Recipe } from '../data/recipes';
import { ContainerSystem } from './systems/ContainerSystem';
import { EnvironmentSystem } from './systems/EnvironmentSystem';
import { FarmingSystem } from './systems/FarmingSystem';
import { makeStack, type ItemStack } from './systems/InventoryLogic';
import { ProgressSystem } from './systems/ProgressSystem';
import { findSpawn } from './systems/SpawnFinder';
import { TreeFelling } from './systems/TreeFelling';
import { B, blockId, LIGHT, SOLID } from './world/BlockRegistry';
import { CHUNK_SIZE } from './world/constants';
import { ChunkManager } from './world/ChunkManager';
import { localIndex } from './world/coordinates';
import { ckey, World } from './world/World';
import { WorkerPool } from './workers/WorkerPool';
import { effectivePixelRatio, nextQualityReduction } from './core/graphics';
import { gameRegistry } from './registry';
import { touchEnabled } from '../app/mobile';
import type { Chunk } from './world/Chunk';

let sharedAssets: AssetManager | null = null;

export interface GameInit {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  meta: WorldMeta;
  state: WorldStateSave | null;
  mods: Map<number, [number, number][]>;
}

type SaveReason = 'auto' | 'pause' | 'quit' | 'sleep' | 'created' | 'hidden' | 'quiet' | 'death' | 'respawn';

/**
 * Engine root. Owns the voxel world, systems and rendering objects; React only
 * mounts the canvas and reads the zustand stores this class updates.
 */
export class Game {
  static get current(): Game | null { return gameRegistry.current; }
  static set current(game: Game | null) { gameRegistry.current = game; }

  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly assets: AssetManager;
  readonly bus = new EventBus();
  readonly input = new InputManager();
  readonly audio: AudioManager = audio;
  readonly world: World;
  readonly pool: WorkerPool;
  readonly chunks: ChunkManager;
  readonly clock: GameClock;
  readonly particles: Particles;
  readonly rain: Rain;
  readonly sky: Sky;
  readonly clouds: Clouds;
  readonly outline = new BlockOutline();
  readonly viewModel: FirstPersonViewModel;
  readonly player: Player;
  readonly interaction: PlayerInteraction;
  readonly rest: FurnitureInteraction;
  readonly entities: EntityManager;
  readonly drops: DroppedItems;
  readonly boats: Boats;
  readonly arrows: Projectiles;
  readonly fx = new CombatFX();
  /** PvP match (mode 'pvp'): other players, hits, scores. */
  pvp: PvpSession | null = null;
  /** Deathmatch match (mode 'deathmatch'): team battle in City Clash. */
  dm: DeathmatchSession | null = null;
  readonly trees: TreeFelling;
  readonly farming = new FarmingSystem();
  readonly containers = new ContainerSystem();
  readonly env: EnvironmentSystem;
  readonly progress: ProgressSystem;
  meta: WorldMeta;
  /** Build Home controller (null in survival worlds). */
  build: BuildMode | null = null;
  private backdrop: PlotBackdrop | null = null;
  readonly isBuild: boolean;
  difficulty: Difficulty;
  peacefulCreatures: boolean;

  /** Real seconds since the game started (animations). */
  time = 0;
  currentBiome = -1;
  undergroundFactor = 0;
  forestFactor = 0;
  riverLevel = 0;
  waterfallLevel = 0;
  pendingBed: { x: number; y: number; z: number; objectId?: number } | null = null;
  /** Compass target for the current quest (e.g. nearest river), if any. */
  questTarget: { x: number; z: number } | null = null;
  private questTargetFor = '';
  ready = false;
  private discoveryTimer = 0;
  private shelterTimer = 0;
  private saveTimer = 45;
  private debugTimer = 0;
  private lightTimer = 0;
  private ambientFxTimer = 0;
  private savePromise: Promise<boolean> | null = null;
  private suppressPause = false;
  private frameTimeSum = 0;
  private frameSamples = 0;
  private qualityTimer = 0;
  private lowFpsStrikes = 0;
  private captureThumb = false;
  private pointLights: THREE.PointLight[] = [];
  private exploredChunks = new Set<number>();
  private pendingMaps: MapTileRecord[] = [];
  private offs: (() => void)[] = [];
  private disposed = false;

  constructor(init: GameInit) {
    this.renderer = init.renderer;
    this.scene = init.scene;
    this.camera = init.camera;
    this.meta = init.meta;
    this.isBuild = init.meta.mode === 'build';
    this.difficulty = this.isBuild ? 'peaceful' : init.meta.mode === 'pvp' || init.meta.mode === 'deathmatch' ? 'explorer' : init.meta.difficulty;
    this.peacefulCreatures = init.meta.peacefulCreatures;
    if (!sharedAssets) sharedAssets = new AssetManager();
    this.assets = sharedAssets;
    const settings = useSettingsStore.getState();

    this.scene.fog = new THREE.Fog('#bcd8f0', 40, 120);
    this.camera.near = 0.08;
    this.camera.far = 420;
    this.camera.fov = settings.graphics.fov;
    this.camera.updateProjectionMatrix();

    this.world = new World(init.meta.seed, this.isBuild ? init.meta.build?.plot ?? 'meadow' : init.meta.mode === 'pvp' ? init.meta.arena ?? null : null, init.meta.caves ?? 1, init.meta.mode === 'deathmatch');
    for (const [k, list] of init.mods) this.world.loadMods(k, list);
    this.pool = new WorkerPool();
    this.chunks = new ChunkManager(this.world, this.pool, this.assets.materials, settings.graphics.renderDistance);
    this.scene.add(this.chunks.root);
    this.chunks.onChunkReady = (c) => this.onChunkReady(c);

    this.clock = new GameClock(init.state?.time ?? 0, settings.gameplay.dayLengthMinutes);
    this.sky = new Sky();
    this.clouds = new Clouds(init.meta.seed);
    this.particles = new Particles(700, this.assets.uniforms as unknown as Record<string, THREE.IUniform>);
    this.particles.solidAt = (x, y, z) => this.world.isSolid(Math.floor(x), Math.floor(y), Math.floor(z));
    this.rain = new Rain();
    this.scene.add(this.sky.mesh, this.clouds.mesh, this.particles.mesh, this.rain.mesh, this.outline.group);
    this.viewModel = new FirstPersonViewModel(this.assets);
    this.player = new Player(this);
    this.interaction = new PlayerInteraction(this);
    this.rest = new FurnitureInteraction(this);
    this.entities = new EntityManager(this);
    this.drops = new DroppedItems(this);
    this.trees = new TreeFelling(this);
    this.boats = new Boats(this);
    this.arrows = new Projectiles(this);
    this.scene.add(this.entities.group, this.drops.group, this.trees.group, this.boats.group, this.arrows.group, this.fx.group);
    this.wireCombatFx();
    this.env = new EnvironmentSystem(this);
    this.progress = new ProgressSystem(this);
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight('#ffb566', 0, 11, 1.6);
      this.pointLights.push(l);
      this.scene.add(l);
    }
    // touch mode is known before the first frame (not when the touch UI happens to mount)
    this.input.touch.active = touchEnabled(settings.controls.touch);
    this.applyGraphicsSettings();
    this.offs.push(
      useSettingsStore.subscribe((s, prev) => {
        if (s.graphics !== prev.graphics) this.applyGraphicsSettings();
        if (s.audio !== prev.audio) this.audio.applyVolumes(s.audio);
        if (s.gameplay.dayLengthMinutes !== prev.gameplay.dayLengthMinutes) this.clock.dayLength = s.gameplay.dayLengthMinutes * 60;
        if (s.gameplay.scarf !== prev.gameplay.scarf) this.player.refreshScarf();
        if (s.gameplay.cameraMode !== prev.gameplay.cameraMode) this.player.cameraMode = s.gameplay.cameraMode;
      }),
    );
    this.audio.applyVolumes(settings.audio);
    if (this.isBuild) {
      this.player.creative = true;
      this.build = new BuildMode(this, init.state?.build);
      this.backdrop = new PlotBackdrop(init.meta.build?.plot ?? 'meadow', init.meta.seed, PLOT_Y, this.assets.uniforms);
      if (this.backdrop.mesh) this.scene.add(this.backdrop.mesh);
      this.input.allowUnlocked = true;
      this.input.captureShortcuts = true;
    }
    // Build Home opened to friends: the full Build Home, plus the shared room (players, voice, edits)
    if (init.meta.coop) this.pvp = new PvpSession(this);
    if (init.meta.mode === 'pvp') {
      if (init.meta.arena) {
        // flat arenas get the same distant scenery as Build Home lots
        this.backdrop = new PlotBackdrop(init.meta.arena, init.meta.seed, PLOT_Y, this.assets.uniforms);
        if (this.backdrop.mesh) this.scene.add(this.backdrop.mesh);
      }
      this.progress.dispose(); // no quests / journal / achievements in a match
      this.pvp = new PvpSession(this);
      this.arrows.hitRemote = (_from, to, a) => this.pvp!.arrowHit(to, a.damage);
    }
    if (init.meta.mode === 'deathmatch') {
      this.progress.dispose(); // no quests / journal in a match
      this.dm = new DeathmatchSession(this);
    }
    Game.current = this;
    useGameStore.setState({ cursorFree: false });
    this.input.onCursorToggle = () => this.toggleCursor();
    this.input.onCursorChange = (free) => {
      useGameStore.setState({ cursorFree: free });
      if (this.build) useBuildStore.getState().set({ cursorMode: free && !this.build.usesFreeCamera() });
    };
    // Handy for debugging / automated play-tests: window.wildblocks.game
    if (import.meta.env.DEV) (window as unknown as { wildblocks?: unknown }).wildblocks = {
      game: this,
      stores: { inventory: useInventoryStore, world: useWorldStore, game: useGameStore, player: usePlayerStore, settings: useSettingsStore, build: useBuildStore },
      blockKeys: BLOCK_DEFS.map((d) => d.key),
    };
  }

  applyGraphicsSettings(): void {
    const g = useSettingsStore.getState().graphics;
    this.chunks.setRenderRadius(g.renderDistance);
    this.renderer.setPixelRatio(effectivePixelRatio(g, window.devicePixelRatio));
    this.particles.density = g.particles === 'off' ? 0 : g.particles === 'low' ? 0.35 : 1;
    if (this.camera.fov !== g.fov) {
      this.camera.fov = g.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  // ---------------------------------------------------------------- loading

  async start(state: WorldStateSave | null, onProgress: (p: number, stage: string) => void): Promise<void> {
    if (this.disposed) return;
    // City Clash uses its own weapon HUD/models, with no survival item icons.
    if (this.dm) return this.startDeathmatch(onProgress);
    onProgress(0.02, 'Packing backpack');
    await this.assets.generateIcons(this.renderer, (f) => onProgress(0.02 + f * 0.18, 'Packing backpack'));
    if (this.disposed) return;
    if (this.build) {
      await this.startBuild(state, onProgress);
      if (this.pvp && !this.disposed) {
        // a friend's lot: start where the host is standing
        const sp = this.pvp.settings.source?.spawn;
        if (this.meta.coop === 'guest' && sp) {
          this.player.teleport(sp.x + (Math.random() - 0.5) * 6, PLOT_Y + 1.05, sp.z + 2 + Math.random() * 3);
          this.ensureSafePosition();
        }
        this.pvp.begin();
      }
      return;
    }
    if (this.pvp) return this.startPvp(onProgress);
    const ws = useWorldStore.getState();
    const inv = useInventoryStore.getState();
    let spawn: { x: number; y: number; z: number };
    if (state) {
      ws.load(state.progress);
      inv.load(state.inventory);
      this.containers.load(state.containers);
      this.farming.load(state.farming);
      this.env.load(state.weather);
      const p = state.player;
      spawn = { x: p.x, y: p.y, z: p.z };
      this.player.yaw = p.yaw;
      this.player.pitch = p.pitch;
      this.player.vitality = p.vitality;
      this.player.dead = p.vitality <= 0;
      this.player.energy = p.energy;
      this.player.buffs = p.buffs ?? [];
      this.clock.playTime = this.meta.playTime;
    } else {
      onProgress(0.22, 'Finding a cozy place to begin');
      await new Promise((r) => setTimeout(r, 0));
      const s = findSpawn(this.world.sampler);
      spawn = { x: s.x + 0.5, y: s.y + 0.2, z: s.z + 0.5 };
      ws.reset({ x: s.x, y: s.y, z: s.z });
      inv.reset();
      this.setupStartingCamp(s.x, s.y, s.z);
      this.env.setWeather('clear', 400);
      this.player.yaw = Math.PI * 0.25;
    }
    this.player.teleport(spawn.x, spawn.y, spawn.z);
    // stream terrain around the spawn
    const needed = Math.min(3, this.chunks.renderRadius);
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const tick = () => {
        if (this.disposed) return resolve();
        this.chunks.update(0.05, this.player.position.x, this.player.position.z, this.player.lookDirection(), new THREE.Vector3());
        const r = this.chunks.readiness(needed);
        onProgress(0.25 + r * 0.6, 'Loading terrain');
        if (r >= 1 || performance.now() - t0 > 30000) resolve();
        else setTimeout(tick, 30);
      };
      tick();
    });
    if (this.disposed) return;
    onProgress(0.88, 'Preparing creatures');
    this.ensureSafePosition();
    if (state) {
      this.entities.loadCompanion(state.companion);
      this.drops.load(state.drops ?? []);
      this.boats.load(state.boats);
    }
    for (let i = 0; i < 6; i++) this.entities.trySpawn();
    this.player.syncHud();
    onProgress(1, 'Ready');
    this.ready = true;
    this.input.onLockLost = () => {
      if (this.suppressPause) {
        this.suppressPause = false;
        return;
      }
      const gs = useGameStore.getState();
      if (gs.screen === 'playing' && gs.overlay === null && !this.player.dead) this.openOverlay('pause');
    };
    if (!state) {
      useGameStore.getState().toast('Welcome to the wilds! Gather wood from a tree to begin.', 'quest', '🌲');
      void this.saveNow('created');
    }
  }

  /** PvP start: shared map from the room's seed, a kit instead of a save, spawn somewhere around the arena centre. */
  private async startPvp(onProgress: (p: number, stage: string) => void): Promise<void> {
    const pvp = this.pvp!;
    onProgress(0.22, 'Finding the arena');
    await new Promise((r) => setTimeout(r, 0));
    // a world opened to friends: everyone starts around the spot where the host was standing
    const src = pvp.settings.source;
    const s = src ? { x: Math.floor(src.spawn.x), y: Math.floor(src.spawn.y), z: Math.floor(src.spawn.z) } : this.world.plotSampler ? { x: 0, y: PLOT_Y, z: 0 } : findSpawn(this.world.sampler);
    pvp.center = { x: s.x, y: s.y, z: s.z };
    useWorldStore.getState().reset({ x: s.x, y: s.y, z: s.z });
    pvp.giveKit();
    const sp = pvp.randomSpawn();
    this.player.teleport(sp.x, sp.y, sp.z);
    this.player.yaw = Math.atan2(sp.x - s.x, sp.z - s.z);
    const needed = Math.min(3, this.chunks.renderRadius);
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const tick = () => {
        if (this.disposed) return resolve();
        this.chunks.update(0.05, this.player.position.x, this.player.position.z, this.player.lookDirection(), new THREE.Vector3());
        const r = this.chunks.readiness(needed);
        onProgress(0.25 + r * 0.7, 'Loading the arena');
        if (r >= 1 || performance.now() - t0 > 30000) resolve();
        else setTimeout(tick, 30);
      };
      tick();
    });
    if (this.disposed) return;
    this.ensureSafePosition();
    this.player.invulnerable = 3;
    this.player.syncHud();
    onProgress(1, 'Ready');
    this.ready = true;
    pvp.begin();
    this.input.onLockLost = () => {
      if (this.suppressPause) {
        this.suppressPause = false;
        return;
      }
      const gs = useGameStore.getState();
      if (gs.screen === 'playing' && gs.overlay === null && !this.player.dead) this.openOverlay('pause');
    };
  }

  /** Deathmatch start: City Clash from the room seed, fixed daylight, the host-assigned spawn point. */
  private async startDeathmatch(onProgress: (p: number, stage: string) => void): Promise<void> {
    const dm = this.dm!;
    onProgress(0.22, 'Entering City Clash');
    useWorldStore.getState().reset({ x: 0, y: CITY_G + 1, z: 0 });
    useInventoryStore.getState().reset();
    this.env.setWeather('clear', 1e9);
    this.env.cover = 0.25;
    this.env.rain = 0;
    // late morning light, locked for the whole match
    const c = this.clock;
    let d = 0.4 - c.dayFraction;
    d -= Math.floor(d);
    c.time += d * c.dayLength;
    const sp = dmNet.current?.launch?.spawn;
    const [x, y, z, yaw] = sp ?? [dm.team === 'red' ? -70 : 70, CITY_G + 1, 0, dm.team === 'red' ? -Math.PI / 2 : Math.PI / 2];
    this.player.teleport(x, y + 0.05, z);
    this.player.yaw = yaw;
    this.player.pitch = 0;
    this.player.cameraMode = 'first';
    // Load a safe neighbourhood first; the rest streams during the countdown
    // and match at the player's configured render distance.
    const needed = Math.min(2, this.chunks.renderRadius);
    const t0 = performance.now();
    const loadingMotion = new THREE.Vector3();
    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (this.disposed) return resolve();
        this.chunks.update(0.05, this.player.position.x, this.player.position.z, this.player.lookDirection(), loadingMotion);
        const r = this.chunks.readiness(needed);
        onProgress(0.25 + r * 0.7, 'Building the city');
        if (r >= 1) resolve();
        else if (performance.now() - t0 > LOAD_TIMEOUT_SECONDS * 1000) reject(new Error('The city could not finish loading. Choose Low graphics and rejoin the room.'));
        else setTimeout(tick, 30);
      };
      tick();
    });
    if (this.disposed) return;
    this.ensureSafePosition();
    onProgress(1, 'Ready');
    this.ready = true;
    dm.begin();
    this.input.onLockLost = () => {
      if (this.suppressPause) {
        this.suppressPause = false;
        return;
      }
      const gs = useGameStore.getState();
      if (gs.screen === 'playing' && gs.overlay === null && !this.player.dead) this.openOverlay('pause');
    };
  }

  /** Floating damage numbers, health bars over hurt enemies, "Blocked!" — shared by survival and PvP. */
  private wireCombatFx() {
    this.offs.push(
      this.bus.on('creatureHit', (e) => {
        const c = this.entities.creatures.find((x) => x.id === e.id);
        const color = e.crit ? '#ffd24a' : '#ffffff';
        this.fx.pop(String(Math.max(1, Math.round(e.amount))), e.x, e.y, e.z, color, e.crit);
        if (e.killed) {
          this.fx.removeBar(`c:${e.id}`);
          this.fx.pop('Defeated!', e.x, e.y + 0.35, e.z, '#ffb84a', true);
        } else if (c && c.def.hostile) this.fx.health(`c:${e.id}`, c.health / c.def.health, e.x, e.y, e.z);
      }),
      this.bus.on('playerBlocked', () => {
        const e = this.player.eyePosition();
        const d = this.player.lookDirection();
        this.fx.pop('Blocked!', e.x + d.x * 1.6, e.y - 0.2, e.z + d.z * 1.6, '#9fd8ff');
      }),
      this.bus.on('creatureDefeated', () => {
        const n = useWorldStore.getState().stats.defeated ?? 0;
        if ([1, 10, 25, 50, 100, 250, 500].includes(n)) useGameStore.getState().toast(n === 1 ? 'First creature driven off! Hostile creatures drop useful loot.' : `${n} creatures driven off!`, 'achievement', '⚔️');
      }),
    );
  }

  /** Build Home start: flat lot, locked time & weather, placed objects, no survival systems. */
  private async startBuild(state: WorldStateSave | null, onProgress: (p: number, stage: string) => void): Promise<void> {
    const b = this.build!;
    onProgress(0.2, 'Setting out the catalog');
    await b.prepare((f) => onProgress(0.2 + f * 0.12, 'Setting out the catalog'));
    if (this.disposed) return;
    useWorldStore.getState().reset({ x: 0, y: PLOT_Y + 1, z: 0 });
    useInventoryStore.getState().reset();
    const bs = this.meta.build;
    if (state) {
      this.farming.load(state.farming);
      const p = state.player;
      this.player.teleport(p.x, p.y, p.z);
      this.player.yaw = p.yaw;
      this.player.pitch = p.pitch;
      this.clock.playTime = this.meta.playTime;
    } else {
      this.player.teleport(0.5, PLOT_Y + 1.05, 6.5);
      this.player.yaw = 0;
      this.player.pitch = -0.25;
      const frac = { morning: 0.28, day: 0.45, golden: 0.73, night: 0.92 }[bs?.timeOfDay ?? 'day'];
      b.setDayFraction(frac);
    }
    this.env.setWeather(bs?.weather ?? 'clear', 1e9);
    this.env.cover = bs?.weather === 'cloudy' ? 0.85 : bs?.weather === 'rain' ? 1 : 0.3;
    this.env.rain = bs?.weather === 'rain' ? 0.7 : 0;
    useBuildStore.getState().set({ dayFraction: this.clock.dayFraction });
    const needed = Math.min(3, this.chunks.renderRadius);
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const tick = () => {
        if (this.disposed) return resolve();
        this.chunks.update(0.05, this.player.position.x, this.player.position.z, this.player.lookDirection(), new THREE.Vector3());
        const r = this.chunks.readiness(needed);
        onProgress(0.34 + r * 0.6, 'Preparing your lot');
        if (r >= 1 || performance.now() - t0 > 30000) resolve();
        else setTimeout(tick, 30);
      };
      tick();
    });
    if (this.disposed) return;
    this.ensureSafePosition();
    onProgress(1, 'Ready');
    this.ready = true;
    this.input.onLockLost = () => {
      if (this.suppressPause) {
        this.suppressPause = false;
        return;
      }
      const gs = useGameStore.getState();
      const bst = useBuildStore.getState();
      if (gs.screen === 'playing' && gs.overlay === null && bst.camera === 'player' && !bst.cursorMode && !bst.photo) this.openOverlay('pause');
    };
    if (!state) {
      this.notify(`Welcome to your lot, ${this.meta.name}! Press B for the Build Catalog.`, '🏡');
      void this.saveNow('created');
    }
  }

  /** Clock that crops grow by: game time in survival; play time ×4 in Build Home (time of day is usually locked there). */
  growthNow(): number {
    return this.build ? this.clock.playTime * 4 : this.clock.time;
  }

  /** Short toast helper. */
  notify(text: string, icon?: string): void {
    useGameStore.getState().toast(text, 'info', icon);
  }

  private setupStartingCamp(x: number, _y: number, z: number) {
    // Written as pending modifications — applied as the chunks generate.
    const put = (bx: number, by: number, bz: number, key: string, meta = 0) => {
      const cx = Math.floor(bx / CHUNK_SIZE), cz = Math.floor(bz / CHUNK_SIZE);
      const k = ckey(cx, cz);
      let m = this.world.mods.get(k);
      if (!m) {
        m = new Map();
        this.world.mods.set(k, m);
      }
      m.set(localIndex(bx - cx * CHUNK_SIZE, by, bz - cz * CHUNK_SIZE), blockId(key) | (meta << 8));
      this.world.dirtyMods.add(k);
    };
    const gy = (bx: number, bz: number) => this.world.sampler.sample(bx, bz).height;
    for (const [dx, dz] of [[3, 0], [-2, 2], [0, -3], [3, 1]]) for (let k = 1; k <= 5; k++) put(x + dx, gy(x + dx, z + dz) + k, z + dz, 'air');
    put(x + 3, gy(x + 3, z) + 1, z, 'cooking_fire');
    put(x - 2, gy(x - 2, z + 2) + 1, z + 2, 'chest', 1);
    put(x, gy(x, z - 3) + 1, z - 3, 'lore_stone', 0);
    put(x + 3, gy(x + 3, z + 1) + 1, z + 1, 'torch');
    const chestKey = ContainerSystem.key(x - 2, gy(x - 2, z + 2) + 1, z + 2);
    const slots = new Array(18).fill(null) as (ItemStack | null)[];
    slots[0] = makeStack('sunapple', 3);
    slots[1] = makeStack('bramble_berries', 4);
    slots[2] = makeStack('torch', 4);
    slots[3] = makeStack('rope', 2);
    slots[4] = makeStack('grass_seeds', 3);
    this.containers.set(chestKey, slots);
  }

  /** After loading or respawning: never stand inside terrain. */
  ensureSafePosition(): void {
    const p = this.player.position;
    const x = Math.floor(p.x), z = Math.floor(p.z);
    let y = Math.floor(p.y);
    const blocked = (yy: number) => SOLID[this.world.get(x, yy, z)] || SOLID[this.world.get(x, yy + 1, z)];
    if (y < 1 || blocked(y)) {
      y = this.world.standableY(x, z) + 1;
      while (blocked(y) && y < 125) y++;
      this.player.teleport(p.x, y + 0.05, p.z);
    }
  }

  private onChunkReady(c: Chunk) {
    const k = ckey(c.cx, c.cz);
    if (!this.exploredChunks.has(k)) {
      this.exploredChunks.add(k);
      this.pendingMaps.push({ key: `${this.meta.id}|${c.cx},${c.cz}`, worldId: this.meta.id, cx: c.cx, cz: c.cz, colors: c.mapColors.slice() });
    }
  }

  // ---------------------------------------------------------------- overlays / pointer

  releasePointer(): void {
    if (this.input.pointerLocked) {
      this.suppressPause = true;
      this.input.releaseLock();
    }
    this.input.clearHeld();
  }

  /** Desktop shortcut: release without pausing, or recapture from the same key gesture. */
  toggleCursor(): boolean {
    const gs = useGameStore.getState();
    if (!this.ready || this.disposed || this.player.dead || this.input.touch.active || gs.screen !== 'playing' || gs.overlay !== null) return false;
    if (!this.input.cursorFree) {
      this.input.setCursorFree(true);
      this.releasePointer();
    } else {
      // Closing a quick-options panel must not immediately release the recaptured pointer.
      if (this.pvp) usePvpStore.getState().set({ gearOpen: false });
      if (this.dm) useDeathmatchStore.getState().set({ optionsOpen: false });
      this.input.clearHeld();
      this.input.endFrame();
      this.input.requestLock(true);
    }
    return true;
  }

  openOverlay(o: Overlay, station: StationKind | null = null): void {
    if (this.player.dead && useGameStore.getState().overlay === 'death' && o !== 'death') return;
    this.releasePointer();
    useGameStore.getState().setOverlay(o, station);
    if (o === 'pause') void this.saveNow('pause');
  }

  closeOverlay(): void {
    if (this.player.dead && useGameStore.getState().overlay === 'death') return;
    const inv = useInventoryStore.getState();
    const c = inv.closeContainer();
    if (c) {
      this.containers.set(c.key, c.slots);
      this.audio.play('close');
    }
    // held cursor stack returns to the backpack (or drops)
    const cur = inv.takeCursor();
    if (cur) {
      const left = inv.addStackObj(cur);
      if (left > 0) this.drops.throwFromPlayer({ ...cur, count: left });
    }
    useGameStore.getState().setOverlay(null);
    if (this.build) {
      const bs = useBuildStore.getState();
      if (bs.catalogOpen) bs.set({ catalogOpen: false });
      if (bs.camera === 'build' || bs.cursorMode || bs.photo) return;
    }
    this.input.requestLock();
  }

  /** Global hotkeys handled while playing (inventory, journal, map, debug, photo mode). */
  private handleKeys() {
    const gs = useGameStore.getState();
    if (gs.screen !== 'playing') return;
    const inp = this.input;
    const o = gs.overlay;
    if (!this.build && o === null && inp.keyPressed('Escape') && !(this.pvp && usePvpStore.getState().gearOpen) && !(this.dm && useDeathmatchStore.getState().optionsOpen)) {
      this.openOverlay('pause');
      return;
    }
    if (this.build) {
      if (inp.keyPressed('Escape') && o !== null && o !== 'pause' && o !== 'death') {
        if (o === 'catalog') this.build.closeCatalog();
        else {
          useBuildStore.getState().set({ labelEdit: null, confirm: null, blueprintNaming: false });
          this.closeOverlay();
        }
      }
      if (inp.keyPressed('F3')) useSettingsStore.getState().update('gameplay', { showDebug: !useSettingsStore.getState().gameplay.showDebug });
      if (inp.wasPressed('hideHud') && o === null) useGameStore.setState({ hudHidden: !gs.hudHidden });
      // Build Home with friends: Esc closes the ⚙️ options (opened from its button — O is the roof tool here)
      if (this.pvp && o === null && usePvpStore.getState().gearOpen && inp.keyPressed('Escape')) this.setPvpOptions(false);
      return;
    }
    if (this.dm) {
      // Deathmatch: no backpack / journal / map — Esc pauses, F3 debug, hide HUD
      if (inp.keyPressed('F3')) useSettingsStore.getState().update('gameplay', { showDebug: !useSettingsStore.getState().gameplay.showDebug });
      if (inp.wasPressed('hideHud') && o === null) useGameStore.setState({ hudHidden: !gs.hudHidden });
      if (inp.keyPressed('Escape') && o !== null && o !== 'pause') this.closeOverlay();
      // O opens / closes the ⚙️ options (camera, voice, controls, exit) — Esc closes it too
      if (o === null) {
        const open = useDeathmatchStore.getState().optionsOpen;
        if (inp.wasPressed('options')) this.setDmOptions(!open);
        else if (open && inp.keyPressed('Escape')) this.setDmOptions(false);
      }
      return;
    }
    if (inp.wasPressed('inventory')) {
      if (o === null) {
        this.audio.play('open');
        this.openOverlay('inventory');
      } else if (o === 'inventory' || o === 'container') this.closeOverlay();
    }
    if (inp.wasPressed('journal')) {
      if (o === null) this.openOverlay('journal');
      else if (o === 'journal') this.closeOverlay();
    }
    if (inp.wasPressed('map')) {
      if (o === null) this.openOverlay('map');
      else if (o === 'map') this.closeOverlay();
    }
    if (inp.keyPressed('Escape') && o !== null && o !== 'pause' && o !== 'death') this.closeOverlay();
    if (inp.keyPressed('F3')) useSettingsStore.getState().update('gameplay', { showDebug: !useSettingsStore.getState().gameplay.showDebug });
    if (inp.wasPressed('hideHud') && o === null) useGameStore.setState({ hudHidden: !gs.hudHidden });
    // PvP: O opens / closes the ⚙️ quick options (camera, voice, controls, exit) — Esc closes it too
    if (this.pvp && o === null) {
      const gearOpen = usePvpStore.getState().gearOpen;
      if (inp.wasPressed('options')) this.setPvpOptions(!gearOpen);
      else if (gearOpen && inp.keyPressed('Escape')) this.setPvpOptions(false);
    }
  }

  /** PvP ⚙️ quick options panel: frees the mouse while open, recaptures it when closed. */
  setPvpOptions(open: boolean): void {
    if (open) {
      this.releasePointer();
      usePvpStore.getState().set({ gearOpen: true, scoreboardOpen: false });
    } else {
      usePvpStore.getState().set({ gearOpen: false });
      if (useGameStore.getState().overlay === null) this.input.requestLock();
    }
  }

  /** Deathmatch ⚙️ options panel: frees the mouse while open (the match keeps running), recaptures it when closed. */
  setDmOptions(open: boolean): void {
    if (open) {
      this.releasePointer();
      useDeathmatchStore.getState().set({ optionsOpen: true, scoreboardOpen: false });
    } else {
      useDeathmatchStore.getState().set({ optionsOpen: false });
      if (useGameStore.getState().overlay === null) this.input.requestLock();
    }
  }

  // ---------------------------------------------------------------- main loop

  /** Automated play-tests freeze the loop and step it manually (see T.step in the harness). */
  debugFreeze = false;
  private wasPlatformPaused = false;
  private delayedActions = new Set<() => void>();
  defer(action: () => void, milliseconds: number): void {
    const cancel = lifecycle.delay(() => {
      this.delayedActions.delete(cancel);
      if (!this.disposed) action();
    }, milliseconds);
    this.delayedActions.add(cancel);
  }

  update(rawDt: number, force = false): void {
    if (this.disposed) return;
    if (this.debugFreeze && !force) return;
    if (lifecycle.interrupted) {
      this.wasPlatformPaused = true;
      this.input.clearHeld(); this.input.endFrame();
      return;
    }
    // Interrupted input was already cleared while paused. Preserve fresh events
    // received after the host resumes, even if they arrive before this frame.
    if (this.wasPlatformPaused) { rawDt = 0; this.wasPlatformPaused = false; }
    this.handleKeys();
    if (lifecycle.has('user')) { this.input.clearHeld(); this.input.endFrame(); return; }
    const dt = Math.min(rawDt, 0.1);
    this.time += dt;
    const gs = useGameStore.getState();
    const simulate = this.ready && gs.screen === 'playing' && gs.overlay === null;

    if (simulate) {
      if (this.build && useBuildStore.getState().timeLocked) this.clock.playTime += dt;
      else this.clock.advance(dt);
    }
    const freeCam = !!this.build?.usesFreeCamera();
    this.player.update(dt, simulate && !freeCam);
    this.rest.update(dt, simulate);
    if (this.build) {
      const focus = this.build.focus();
      this.env.update(dt, false);
      this.chunks.update(dt, focus.x, focus.z, this.player.lookDirection(), this.player.body.vel);
      if (freeCam) this.build.updateCamera(dt, this.camera, simulate || useBuildStore.getState().photo);
      else this.player.updateCamera(this.camera, dt);
      this.camera.updateMatrixWorld();
      this.build.update(dt, simulate);
      this.pvp?.update(dt);
      this.fx.update(dt);
      if (simulate) this.farming.update(dt, this.world, this.growthNow(), this.env.rain > 0.3);
      this.finishFrame(dt, rawDt, simulate, gs.hudHidden);
      return;
    }
    if (this.dm) {
      // Deathmatch: no block editing, creatures, crops or saving — the session runs the match
      this.dm.update(dt, simulate && !this.player.waitingForGround);
      this.fx.update(dt);
      this.env.update(dt, false);
      this.chunks.update(dt, this.player.position.x, this.player.position.z, this.player.lookDirection(), this.player.body.vel);
      this.player.updateCamera(this.camera, dt);
      this.finishFrame(dt, rawDt, simulate, gs.hudHidden);
      return;
    }
    this.boats.update(dt, simulate && !this.player.waitingForGround);
    this.interaction.update(dt, simulate && !this.player.waitingForGround && !this.rest.consumed);
    this.arrows.update(dt);
    this.pvp?.update(dt);
    for (const c of this.entities.creatures) this.fx.follow(`c:${c.id}`, c.body.pos.x, c.body.pos.y + c.def.height, c.body.pos.z);
    this.fx.update(dt);
    if (simulate) {
      this.entities.update(dt);
      this.drops.update(dt);
      this.trees.update(dt);
      this.farming.update(dt, this.world, this.clock.time, this.env.rain > 0.3);
      this.periodicChecks(dt);
      if (!this.pvp) this.autosave(dt);
    }
    this.env.update(dt, simulate);
    const look = this.player.lookDirection();
    this.chunks.update(dt, this.player.position.x, this.player.position.z, look, this.player.body.vel);
    this.player.updateCamera(this.camera, dt);
    this.finishFrame(dt, rawDt, simulate, gs.hudHidden);
  }

  /** Shared visual and input bookkeeping, after each mode has simulated. */
  private finishFrame(dt: number, rawDt: number, simulate: boolean, hudHidden: boolean) {
    this.sky.follow(this.camera);
    this.backdrop?.follow(this.camera);
    this.clouds.update(dt, this.camera, this.dm ? this.env.cover : this.env.cover + this.env.rain);
    this.particles.update(dt, this.time);
    this.updateAmbience(dt, !simulate);
    if (!this.build && !this.dm) this.updateLights(dt);
    this.updateViewModel(dt, hudHidden);
    this.monitorPerformance(rawDt);
    this.updateDebug(dt);
    this.input.endFrame();
  }

  private lastYaw = 0;
  private lastPitch = 0;

  /** Feed the first-person hand with this frame's motion (see FirstPersonViewModel). */
  private updateViewModel(dt: number, hudHidden: boolean) {
    let hideHand = false;
    if (this.build) {
      const bs = useBuildStore.getState();
      hideHand = bs.camera === 'build' || bs.photo || bs.cursorMode;
      this.viewModel.setHeld(this.build.heldSpec());
    } else if (this.dm) {
      // the sword uses the classic first-person hand; guns have their own view model
      hideHand = this.dm.weapon !== 'sword';
      this.viewModel.setHeld(hideHand ? null : { item: 'copper_sword', key: 'dm-sword' });
    } else {
      const held = useInventoryStore.getState().selectedStack();
      this.viewModel.setHeld(held ? { item: held.item, key: held.item } : null);
    }
    const p = this.player;
    const hs = Math.hypot(p.body.vel.x, p.body.vel.z);
    const skyAt = this.undergroundFactor > 0.5 ? 0.25 : this.env.hemi.intensity * 0.5;
    let dYaw = p.yaw - this.lastYaw;
    if (dYaw > Math.PI) dYaw -= Math.PI * 2;
    if (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const dPitch = p.pitch - this.lastPitch;
    this.lastYaw = p.yaw;
    this.lastPitch = p.pitch;
    this.viewModel.update({
      dt, speed: hs, grounded: p.body.grounded, sprinting: p.sprinting, verticalVelocity: p.body.vel.y, dYaw, dPitch,
      aspect: this.camera.aspect, light: skyAt, visible: p.cameraMode === 'first' && !hudHidden && !p.dead && !hideHand,
      reducedMotion: useSettingsStore.getState().accessibility.reducedShake,
    });
  }

  render(): void {
    const r = this.renderer;
    r.autoClear = true;
    r.render(this.scene, this.camera);
    if (this.viewModel.scene.visible) {
      r.autoClear = false;
      r.clearDepth();
      r.render(this.viewModel.scene, this.viewModel.camera);
      r.autoClear = true;
    }
    const gv = this.dm?.gunView;
    if (gv && gv.scene.visible) {
      r.autoClear = false;
      r.clearDepth();
      r.render(gv.scene, gv.camera);
      r.autoClear = true;
    }
    if (this.captureThumb) {
      this.captureThumb = false;
      try {
        const c = document.createElement('canvas');
        c.width = 192;
        c.height = 108;
        const src = r.domElement;
        const ar = src.width / src.height;
        const sw = ar > 16 / 9 ? src.height * (16 / 9) : src.width;
        const sh = ar > 16 / 9 ? src.height : src.width / (16 / 9);
        c.getContext('2d')!.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, 192, 108);
        this.meta.thumbnail = c.toDataURL('image/jpeg', 0.7);
      } catch {
        /* ignore */
      }
    }
  }

  private periodicChecks(dt: number) {
    const p = this.player.position;
    const x = Math.floor(p.x), z = Math.floor(p.z);
    this.discoveryTimer -= dt;
    if (this.discoveryTimer <= 0) {
      this.discoveryTimer = 0.5;
      const chunk = this.world.chunkAt(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
      if (chunk) {
        const lx = ((x % 16) + 16) % 16, lz = ((z % 16) + 16) % 16;
        const b = chunk.biomes[lz * 16 + lx];
        if (b !== this.currentBiome) {
          this.currentBiome = b;
          this.bus.emit('biomeEntered', { biome: b });
        }
        // forest density for ambience
        this.forestFactor += ((BIOMES[b].treeDensity > 0.06 ? 1 : BIOMES[b].treeDensity * 12) - this.forestFactor) * 0.2;
        // landmarks & waterfalls nearby
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            const c = this.world.chunkAt(chunk.cx + dx, chunk.cz + dz);
            if (!c) continue;
            for (const l of c.landmarks) if (Math.hypot(l.x - p.x, l.z - p.z) < 14) this.bus.emit('landmarkFound', { type: l.type, x: l.x, z: l.z });
          }
      }
      // underground?
      const surface = this.world.surfaceY(x, z);
      const covered = surface > p.y + 3;
      const deep = surface - p.y;
      this.undergroundFactor += ((covered && deep > 6 ? 1 : 0) - this.undergroundFactor) * 0.3;
      if (covered && deep > 8 && !this.player.inWater) this.bus.emit('caveEntered', {});
      // river?
      const col = this.world.sampler.sample(x, z);
      if (col.river > 0.2 && Math.abs(p.y - col.waterLevel) < 6) this.bus.emit('riverFound', {});
      // audio levels for water
      let river = 0, fall = 0;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        for (const d of [3, 7, 12]) {
          const id = this.world.get(Math.floor(p.x + Math.cos(a) * d), Math.floor(p.y), Math.floor(p.z + Math.sin(a) * d));
          const below = this.world.get(Math.floor(p.x + Math.cos(a) * d), Math.floor(p.y) - 1, Math.floor(p.z + Math.sin(a) * d));
          if (id === B.WATER || below === B.WATER) {
            river = Math.max(river, 1 - d / 14);
            break;
          }
        }
      }
      for (let dz = -3; dz <= 3; dz++)
        for (let dx = -3; dx <= 3; dx++) {
          const c = this.world.chunkAt(Math.floor(x / 16) + dx, Math.floor(z / 16) + dz);
          if (!c) continue;
          for (const w of c.waterfalls) {
            const d = Math.hypot(w.x - p.x, (w.top + w.bottom) / 2 - p.y, w.z - p.z);
            fall = Math.max(fall, 1 - d / 36);
            if (d < 20) this.bus.emit('landmarkFound', { type: 'waterfall', x: Math.round(w.x / 48) * 48, z: Math.round(w.z / 48) * 48 });
          }
        }
      this.riverLevel = river * (col.river > 0 ? 1 : 0.5);
      this.waterfallLevel = fall;
    }
    this.updateQuestTarget();
    this.shelterTimer -= dt;
    if (this.shelterTimer <= 0) {
      this.shelterTimer = 1;
      const was = this.player.sheltered;
      this.player.sheltered = isSheltered(this.world, p.x, p.y, p.z);
      if (this.player.sheltered !== was) this.bus.emit('sheltered', { value: this.player.sheltered });
    }
    // waterfall mist / fireflies / butterflies
    this.ambientFxTimer -= dt;
    if (this.ambientFxTimer <= 0) {
      this.ambientFxTimer = 0.15;
      for (let dz = -2; dz <= 2; dz++)
        for (let dx = -2; dx <= 2; dx++) {
          const c = this.world.chunkAt(Math.floor(x / 16) + dx, Math.floor(z / 16) + dz);
          if (!c) continue;
          for (const w of c.waterfalls) {
            if (Math.random() > 0.35) continue;
            const bx = w.x + w.dx + 0.5, bz = w.z + w.dz + 0.5;
            if (Math.hypot(bx - p.x, bz - p.z) > 40) continue;
            this.particles.emit('mist', bx, w.bottom + 0.9, bz, 2, [0.9, 0.95, 1], { spread: 1.2, speed: 0.8, size: 0.35, life: 1.8 });
            this.particles.emit('splash', bx, w.bottom + 0.9, bz, 1, [0.75, 0.88, 1], { spread: 0.8, speed: 2.2, size: 0.07, life: 0.6 });
          }
        }
      const night = this.clock.daylight < 0.3;
      if (this.undergroundFactor < 0.5 && Math.random() < 0.25) {
        const a = Math.random() * Math.PI * 2, d = 4 + Math.random() * 10;
        const fx = p.x + Math.cos(a) * d, fz = p.z + Math.sin(a) * d;
        const fy = this.world.standableY(Math.floor(fx), Math.floor(fz)) + 1.5 + Math.random();
        const biome = this.currentBiome >= 0 ? BIOMES[this.currentBiome].id : 'meadow';
        if (night && (biome === 'meadow' || biome === 'forest') && this.env.rain < 0.3) {
          this.particles.emit('firefly', fx, fy, fz, 1, [1.7, 1.6, 0.6], { spread: 0.5, speed: 0, size: 0.07, life: 6, glow: true });
        } else if (!night && useWorldStore.getState().harmony > 25 && biome === 'meadow' && this.env.rain < 0.1 && Math.random() < 0.3) {
          const cols: [number, number, number][] = [[1, 0.8, 0.3], [0.6, 0.8, 1], [1, 0.6, 0.8]];
          this.particles.emit('butterfly', fx, fy, fz, 1, cols[Math.floor(Math.random() * 3)], { spread: 0.5, speed: 0, size: 0.14, life: 8 });
        }
      }
    }
  }

  private updateQuestTarget() {
    const q = QUESTS[useWorldStore.getState().questIndex];
    const id = q?.id ?? '';
    if (id === this.questTargetFor) return;
    this.questTargetFor = id;
    this.questTarget = null;
    if (id !== 'river') return;
    const p = this.player.position;
    let best: { x: number; z: number; d: number } | null = null;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      for (let d = 16; d <= 240; d += 12) {
        const x = Math.round(p.x + Math.cos(a) * d), z = Math.round(p.z + Math.sin(a) * d);
        const c = this.world.sampler.sample(x, z);
        if (c.river > 0.3 || c.lake > 0.5) {
          if (!best || d < best.d) best = { x, z, d };
          break;
        }
      }
    }
    if (best) this.questTarget = { x: best.x, z: best.z };
  }

  private updateAmbience(dt: number, paused: boolean) {
    this.audio.setListener(this.camera.position, this.player.yaw);
    const hostile = !this.build && this.entities.hostileNear(14) > 0;
    const w = useWorldStore.getState();
    const home = w.home;
    const p = this.player.position;
    let mood: Mood = 'explore';
    if (this.player.dead) mood = 'silent';
    else if (hostile) mood = 'combat';
    else if (this.undergroundFactor > 0.6) mood = 'cave';
    else if (home && Math.hypot(home.x - p.x, home.z - p.z) < 18 && this.player.sheltered) mood = 'home';
    else if (this.clock.isNight) mood = 'night';
    this.audio.updateAmbience(dt, {
      daylight: this.clock.daylight, forest: this.forestFactor, underground: this.undergroundFactor, rain: this.env.rain,
      wind: this.env.cover, river: this.riverLevel, waterfall: this.waterfallLevel, paused, mood,
    });
  }

  /** A few real point lights near the player so creatures and items pick up torchlight. */
  private updateLights(dt: number) {
    // held light source (torch / lantern) lights up caves around the player
    const held = useInventoryStore.getState().selectedStack();
    const hid = held ? itemDef(held.item).placeBlock : undefined;
    const lightLevel = hid ? LIGHT[blockId(hid)] : 0;
    const hl = this.assets.uniforms.uHeldLight.value;
    const target = lightLevel >= 10 ? 0.75 + (lightLevel - 10) * 0.05 : 0;
    hl.w += (target * (0.95 + Math.sin(this.time * 9) * 0.03) - hl.w) * Math.min(1, dt * 8);
    const e = this.player.eyePosition();
    hl.x = e.x;
    hl.y = e.y - 0.3;
    hl.z = e.z;
    this.lightTimer -= dt;
    if (this.lightTimer > 0) return;
    this.lightTimer = 0.8;
    const p = this.player.position;
    const found: { x: number; y: number; z: number; d: number; id: number }[] = [];
    const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
    for (let dy = -4; dy <= 5; dy++)
      for (let dz = -10; dz <= 10; dz++)
        for (let dx = -10; dx <= 10; dx++) {
          const id = this.world.get(px + dx, py + dy, pz + dz);
          if (LIGHT[id] >= 9) found.push({ x: px + dx, y: py + dy, z: pz + dz, d: dx * dx + dy * dy + dz * dz, id });
        }
    found.sort((a, b) => a.d - b.d);
    this.pointLights.forEach((l, i) => {
      const f = found[i];
      if (!f) {
        l.intensity = 0;
        return;
      }
      l.position.set(f.x + 0.5, f.y + 0.7, f.z + 0.5);
      l.color.set(BLOCK_DEFS[f.id].lightColor ?? '#ffb566');
      l.intensity = 2.2 * (1 - this.clock.daylight * 0.6);
    });
  }

  nearbyStations(): Set<StationKind> {
    const p = this.player.position;
    return nearbyStations((x, y, z) => this.world.get(x, y, z), p.x, p.y + 0.5, p.z, 4);
  }

  /** Craft a recipe up to `times` times. Returns how many were made. */
  craft(recipe: Recipe, times: number): number {
    const stations = this.nearbyStations();
    const level = useWorldStore.getState().homesteadLevel();
    let made = 0;
    let full = false;
    for (let i = 0; i < times; i++) {
      const inv = useInventoryStore.getState();
      if (!canCraft(recipe, inv.slots, stations, level)) {
        full = craftState(recipe, inv.slots, stations, level) === 'full';
        break;
      }
      for (const ing of recipe.inputs) inv.remove(ing.item, ing.count);
      const left = useInventoryStore.getState().add(recipe.output.item, recipe.output.count);
      // outputFits() guarantees space; never silently delete an item if that ever changes
      if (left > 0) this.drops.throwFromPlayer(makeStack(recipe.output.item, left));
      made++;
    }
    if (made) {
      this.audio.play('craft');
      this.bus.emit('itemCrafted', { item: recipe.output.item, count: made * recipe.output.count, station: recipe.station });
    } else this.audio.play('error');
    if (full) useGameStore.getState().toast('Inventory full — make some room first.', 'warn', '🎒');
    return made;
  }

  materialUnder(pos: THREE.Vector3): SoundMaterial {
    const id = this.world.get(Math.floor(pos.x), Math.floor(pos.y - 0.2), Math.floor(pos.z));
    return BLOCK_DEFS[id]?.sound ?? 'dirt';
  }

  // ---------------------------------------------------------------- sleep / death

  /** Recheck the bed after an overlay or a network request; furniture may have moved. */
  bedAvailable(bed: NonNullable<Game['pendingBed']>, pos = this.player.position): boolean {
    const obj = bed.objectId === undefined ? null : this.build?.objects.get(bed.objectId);
    if (bed.objectId !== undefined ? obj?.def.interaction !== 'bed' : BLOCK_DEFS[this.world.get(bed.x, bed.y, bed.z)]?.interact !== 'bed') return false;
    const x = obj?.x ?? bed.x + 0.5, y = obj?.y ?? bed.y, z = obj?.z ?? bed.z + 0.5;
    return this.chunks.isReady(x, z) && Math.hypot(pos.x - x, pos.z - z) <= 6 && Math.abs(pos.y - y) <= 3;
  }

  sleepAtBed(action: 'home' | 'sleep'): void {
    const bed = this.pendingBed;
    const gs = useGameStore.getState();
    if (!bed || this.player.dead) return;
    if (!this.bedAvailable(bed)) {
      gs.toast('Walk close to an available bed to rest.', 'info', '🛏️');
      this.closeOverlay();
      return;
    }
    useWorldStore.getState().setHome({ x: bed.x, y: bed.y + 1, z: bed.z });
    if (action === 'home') {
      gs.toast('Home set! You will wake up here.', 'info', '🏡');
      this.closeOverlay();
      return;
    }
    if (this.entities.hostileNear(12) > 0) {
      gs.toast("You can't rest now — something is prowling nearby.", 'warn', '👀');
      this.closeOverlay();
      return;
    }
    const f = this.clock.dayFraction;
    if (!this.isBuild && f > 0.26 && f < 0.72) {
      gs.toast('It is too bright to sleep. Your home is set, though!', 'info', '☀️');
      this.closeOverlay();
      return;
    }
    if (this.pvp && !this.pvp.isHost) {
      this.pvp.requestSleep(bed);
      this.closeOverlay();
      return;
    }
    this.completeBedSleep();
  }

  /** Apply rest after the host has accepted a shared-world sleep request. */
  completeBedSleep(advanceClock = true): void {
    const bed = this.pendingBed;
    if (!bed || this.player.dead || !this.bedAvailable(bed)) return;
    const gs = useGameStore.getState();
    const comfort = comfortAround(this.world, bed.x, Math.floor(bed.y), bed.z);
    if (advanceClock) this.clock.skipToMorning();
    if (this.build) useBuildStore.getState().set({ dayFraction: this.clock.dayFraction });
    this.pvp?.syncWorldClock();
    this.player.comfort = comfort;
    this.player.heal(40, 20);
    this.player.addBuff('well_rested', 240 + comfort * 45);
    this.audio.play('sleep');
    this.bus.emit('slept', { comfort });
    // hostile night creatures flee at dawn
    for (const c of this.entities.creatures) if (c.def.hostile && c.def.shy) this.entities.poof(c);
    useGameStore.setState({ overlay: null });
    gs.toast(comfort > 0 ? `Good morning! Comfort ${comfort}: you feel well rested.` : 'Good morning! Furniture near your bed adds comfort.', 'info', '🌅');
    this.input.requestLock();
    void this.saveNow('sleep');
  }

  onPlayerDeath(cause: string): void {
    this.rest.release();
    if (this.boats.riding) this.boats.dismount();
    if (this.dm) return; // the host referee owns Deathmatch deaths
    if (this.pvp?.onLocalDeath(cause)) return;
    const inv = useInventoryStore.getState();
    const p = this.player.position;
    let lost = 0;
    if (this.difficulty !== 'peaceful') {
      const snap = inv.snapshot();
      const slots = snap.slots.map((s) => (s ? { ...s } : null));
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (!s) continue;
        const def = itemDef(s.item);
        const gathered = def.category === 'material' || def.category === 'block' || def.category === 'seed' || def.category === 'food';
        if (this.difficulty === 'adventurer' ? true : gathered && i >= HOTBAR_SIZE) {
          const n = this.difficulty === 'adventurer' ? s.count : Math.ceil(s.count / 2);
          this.drops.spawn({ ...s, count: n }, p.x, p.y + 0.5, p.z, 0.7, 1);
          s.count -= n;
          lost += n;
          if (s.count <= 0) slots[i] = null;
        }
      }
      inv.load({ ...snap, slots });
    }
    useWorldStore.setState({ deathMarker: { x: Math.floor(p.x), z: Math.floor(p.z) } });
    useGameStore.setState({ death: { cause, lost } });
    this.bus.emit('playerDied', { cause });
    this.player.body.vel.set(0, 0, 0);
    this.player.syncHud();
    this.openOverlay('death');
    void this.saveNow('death');
  }

  /** Pause-menu rescue for a living player. Keeps inventory, health and progress. */
  async quickRespawn(): Promise<string | null> {
    if (this.disposed || !this.ready) return 'The world is not ready yet.';
    if (this.dm) return 'Quick Respawn is unavailable in Deathmatch.';
    if (this.player.dead) return 'Choose Respawn on the death screen when you are ready.';
    if (this.build) {
      // Existing navigation checks furniture as well as terrain and moves both cameras.
      const why = await this.build.navigation.teleportTo(0, 6);
      if (why) return why;
      if (this.disposed) return 'This project is closed.';
      this.closeOverlay();
      return null;
    }
    if (this.pvp) {
      const why = this.pvp.quickRespawn();
      if (why) return why;
      this.closeOverlay();
      return null;
    }
    if (this.boats.riding) this.boats.dismount();
    const atHome = !!useWorldStore.getState().home;
    this.respawn(atHome ? 'home' : 'camp');
    this.player.invulnerable = Math.max(this.player.invulnerable, 2);
    this.audio.play('chime');
    useGameStore.getState().toast(`Rescued! Back at ${atHome ? 'home' : 'starting camp'}. Health and items kept.`, 'info', '🆘');
    return null;
  }

  respawn(where: 'home' | 'camp' | 'safe'): void {
    const ws = useWorldStore.getState();
    const target = where === 'home' && ws.home ? ws.home : where === 'safe' ? null : ws.camp;
    const p = this.player;
    const wasDead = p.dead;
    if (target) p.teleport(target.x + 0.5, target.y + 0.1, target.z + 0.5);
    else {
      const x = Math.floor(p.position.x), z = Math.floor(p.position.z);
      p.teleport(x + 0.5, this.world.standableY(x, z) + 1.2, z + 0.5);
    }
    if (p.dead) {
      p.dead = false;
      p.vitality = p.maxVitality * 0.75;
      p.energy = Math.max(p.energy, 60);
      p.invulnerable = 3;
    }
    this.ensureSafePosition();
    p.waitingForGround = !this.chunks.isReady(p.position.x, p.position.z);
    p.syncHud();
    if (where !== 'safe') {
      useGameStore.setState({ death: null });
      this.closeOverlay();
    }
    if (wasDead) void this.saveNow('respawn');
  }

  // ---------------------------------------------------------------- saving

  private autosave(dt: number) {
    this.saveTimer -= dt;
    if (this.saveTimer <= 0) {
      this.saveTimer = 45;
      void this.saveNow('auto');
    }
  }

  buildState(): WorldStateSave {
    const p = this.player;
    const pos = this.rest?.savePosition() ?? p.position;
    return {
      id: this.meta.id,
      saveVersion: SAVE_VERSION,
      player: { x: pos.x, y: pos.y, z: pos.z, yaw: p.yaw, pitch: p.pitch, vitality: p.vitality, energy: p.energy, buffs: p.buffs.map((b) => ({ ...b })) },
      inventory: useInventoryStore.getState().snapshot(),
      progress: useWorldStore.getState().snapshot(),
      time: this.clock.time,
      weather: this.env.serialize(),
      containers: [...this.containers.containers.entries()],
      farming: this.farming.serialize(),
      drops: this.drops.serialize(),
      boats: this.build ? undefined : this.boats.serialize(),
      companion: this.build ? null : this.entities.serializeCompanion(),
      build: this.build?.serialize(),
    };
  }

  async saveNow(reason: SaveReason): Promise<boolean> {
    // matches aren't saved; a Build Home you opened to friends keeps saving (your own project)
    if (!this.ready || this.disposed) return false;
    if (this.dm || (this.pvp && this.meta.coop !== 'host')) return true;
    if (this.savePromise) {
      const saved = await this.savePromise;
      if (reason === 'auto' || reason === 'quiet') return saved;
      // Explicit checkpoints must also persist changes made during the older save.
      return this.saveNow(reason);
    }
    const pending = this.persistSnapshot(reason);
    this.savePromise = pending;
    try { return await pending; }
    finally { if (this.savePromise === pending) this.savePromise = null; }
  }

  private async persistSnapshot(reason: SaveReason): Promise<boolean> {
    let maps: MapTileRecord[] = [];
    try {
      // keep an open chest's live contents
      const open = useInventoryStore.getState().container;
      if (open) this.containers.set(open.key, open.slots);
      this.captureThumb = reason === 'quit' || reason === 'pause' || !this.meta.thumbnail;
      if (this.captureThumb) this.render();
      this.meta = { ...this.meta, lastPlayed: Date.now(), playTime: this.clock.playTime };
      maps = this.pendingMaps;
      this.pendingMaps = [];
      const objectRevision = this.build?.objects.revision;
      await writeSave(this.meta, this.buildState(), this.world, maps);
      if (this.build) useBuildStore.getState().set({
        lastSaved: Date.now(),
        ...(this.world.dirtyMods.size === 0 && this.build.objects.revision === objectRevision ? { dirty: false } : {}),
      });
      if (!['created', 'hidden', 'quiet', 'death', 'respawn'].includes(reason)) useGameStore.getState().toast(this.build ? 'Project saved' : 'World saved', 'save', '💾');
      return true;
    } catch (e) {
      this.pendingMaps.unshift(...maps);
      console.error('[WildBlocks] save failed', e);
      useGameStore.getState().toast('Saving failed — check browser storage settings.', 'warn', '⚠️');
      return false;
    }
  }

  async mapTiles(): Promise<MapTileRecord[]> {
    const stored = await loadMapTiles(this.meta.id);
    const byKey = new Map(stored.map((t) => [t.key, t]));
    for (const t of this.pendingMaps) byKey.set(t.key, t);
    for (const c of this.world.chunks.values()) {
      const key = `${this.meta.id}|${c.cx},${c.cz}`;
      byKey.set(key, { key, worldId: this.meta.id, cx: c.cx, cz: c.cz, colors: c.mapColors });
    }
    return [...byKey.values()];
  }

  // ---------------------------------------------------------------- perf / debug

  private monitorPerformance(rawDt: number) {
    const settings = useSettingsStore.getState();
    if (!this.ready || useGameStore.getState().overlay !== null || document.hidden || !settings.graphics.autoQuality || rawDt <= 0 || rawDt > 1) {
      this.frameTimeSum = this.frameSamples = this.qualityTimer = this.lowFpsStrikes = 0;
      return;
    }
    this.frameTimeSum += rawDt;
    this.frameSamples++;
    this.qualityTimer += rawDt;
    if (this.qualityTimer < 5) return;
    const avg = this.frameTimeSum / this.frameSamples;
    this.frameTimeSum = this.frameSamples = 0;
    this.qualityTimer = 0;
    if (avg > 1 / 40) this.lowFpsStrikes++;
    else this.lowFpsStrikes = Math.max(0, this.lowFpsStrikes - 1);
    if (this.lowFpsStrikes >= 2) {
      this.lowFpsStrikes = 0;
      const patch = nextQualityReduction(settings.graphics, this.input.touch.active, window.devicePixelRatio || 1);
      if (!patch) return;
      settings.update('graphics', patch);
      useGameStore.getState().toast(patch.renderDistance !== undefined
        ? `Lowered render distance to ${patch.renderDistance} to keep things smooth.`
        : 'Adjusted graphics a little to keep things smooth.', 'info', '⚙️');
    }
  }

  private updateDebug(dt: number) {
    const show = useSettingsStore.getState().gameplay.showDebug;
    this.debugTimer -= dt;
    if (!show) {
      if (useGameStore.getState().debug) useGameStore.getState().setDebug(null);
      return;
    }
    if (this.debugTimer > 0) return;
    this.debugTimer = 0.25;
    const p = this.player.position;
    const st = this.chunks.stats();
    const info = this.renderer.info;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    useGameStore.getState().setDebug({
      fps: Math.round(1 / Math.max(1e-3, dt)),
      pos: `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`,
      chunk: `${Math.floor(p.x / 16)}, ${Math.floor(p.z / 16)}`,
      biome: this.currentBiome >= 0 ? BIOMES[this.currentBiome].name : '-',
      chunks: st.loaded,
      meshed: st.meshed,
      queue: st.pending,
      triangles: info.render.triangles,
      calls: info.render.calls,
      entities: this.entities.creatures.length + this.drops.count,
      seed: `${this.meta.seedText} (${this.meta.seed})`,
      time: this.clock.label(),
      light: `${this.world.lightAt(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z), this.clock.daylight)}`,
      memory: mem ? `${Math.round(mem.usedJSHeapSize / 1048576)} MB · geo ${info.memory.geometries} · tex ${info.memory.textures}` : `geo ${info.memory.geometries} · tex ${info.memory.textures}`,
    });
  }

  randomTip(): string {
    return TIPS[Math.floor(Math.random() * TIPS.length)];
  }

  dispose(): void {
    for (const cancel of this.delayedActions) cancel();
    this.delayedActions.clear();
    this.disposed = true;
    this.rest.dispose();
    for (const o of this.offs) o();
    this.build?.dispose();
    this.build = null;
    this.backdrop?.dispose();
    this.backdrop = null;
    this.progress.dispose();
    this.bus.clear();
    this.input.detach();
    this.pool.dispose();
    this.chunks.dispose();
    this.entities.clear();
    this.drops.clear();
    this.boats.clear();
    this.arrows.clear();
    this.fx.clear();
    this.viewModel.dispose();
    this.outline.dispose();
    this.pvp?.dispose();
    this.pvp = null;
    this.dm?.dispose();
    this.dm = null;
    this.trees.clear();
    this.particles.dispose();
    this.rain.dispose();
    this.sky.dispose();
    this.clouds.dispose();
    this.scene.clear();
    this.audio.setMood('silent');
    usePlayerStore.getState().sync({ vitality: 100, energy: 100, buffs: [] });
    if (Game.current === this) Game.current = null;
    useGameStore.setState({ cursorFree: false });
  }
}
