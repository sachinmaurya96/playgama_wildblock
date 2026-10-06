import * as THREE from 'three';
import { archIndex, archMaterial, archMaterialLimit, archMaterialOf, archMeta, withArchMaterial, ARCH_MATERIALS } from '../../data/architecture';
import { BLOCK_DEFS } from '../../data/blocks';
import { BUILD_CATALOG, catalogItem, FARM_CROPS, LIVE_CROP_BIT, variantOf, type BuildCatalogItem, type StampKind, type ToolId } from '../../data/buildCatalog';
import { objectDef, type ObjectDef } from '../../data/furniture';
import { itemDef } from '../../data/items';
import { listBlueprints, saveBlueprint } from '../../persistence/SaveManager';
import type { BlueprintRecord, BuildObjectSave, BuildStateSave } from '../../persistence/types';
import { useBuildStore } from '../../stores/buildStore';
import { useGameStore } from '../../stores/gameStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { Game } from '../Game';
import { raycastBlocks, type BlockHit } from '../player/Raycast';
import { previewGeometry } from '../rendering/BlockGeometry';
import { createGhostMaterials, MAX_POINT_LIGHTS } from '../rendering/TerrainMaterials';
import type { HeldSpec } from '../rendering/FirstPersonViewModel';
import { archPlacementMeta } from '../systems/BuildingSystem';
import { ARCH_KIND, B, blockId, isReplaceable, SHAPE, SOLID, TILE_TOP } from '../world/BlockRegistry';
import { archKindOf, archModelOf } from '../world/ArchShapes';
import { cellBoxes } from '../world/Collision';
import { CHUNK_SIZE } from '../world/constants';
import { localIndex } from '../world/coordinates';
import { LOT_HALF, PLOT_Y } from '../world/PlotGenerator';
import { ckey } from '../world/World';
import { BuildCamera } from './BuildCamera';
import { BuildNavigation } from './BuildNavigation';
import { PastePlacement, type PlacementClip as Clip } from './PastePlacement';
import { BlockChangeCommand, BuildHistory, CompositeCommand, ObjectChangeCommand, type BlockChange, type BuildCommand, type EditTarget } from './BuildHistory';
import { renderCatalogIcons } from './BuildIcons';
import { BuildObjects, localBounds, rotatedAabb, toSave, type ObjectHit, type PlacedObject } from './BuildObjects';
import * as T from './BuildTools';
import { objectMaterials, objectPreview, type ObjectMaterials } from './ObjectGeometry';
import { presetBlueprint } from './Presets';
import { challengeById } from '../../data/buildChallenges';

/**
 * Build Home controller. Owns placed objects, undo/redo history, the free build
 * camera, placement ghosts and every tool. Input is polled from the shared
 * InputManager; UI state lives in useBuildStore (React renders it).
 *
 * All edits go through BuildCommands so undo/redo always works, and area tools
 * are pure functions from BuildTools (unit-tested, also used by the presets).
 */

interface Target {
  block: BlockHit | null;
  obj: ObjectHit | null;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  dist: number;
}

interface Pose {
  x: number;
  y: number;
  z: number;
  rotation: number;
  valid: boolean;
  reason?: string;
  cut: T.P3[];
  support?: number;
}

const EDIT_MARGIN = 3;
const REACH_PLAYER = 12;
const REACH_CAMERA = 220;
const MIN_Y = 2;
const MAX_Y = 120;
const HUGE_DELETE = 1500;

const AREA_TOOLS: ToolId[] = ['wall', 'room', 'floor', 'foundation', 'roof', 'pool', 'water', 'stairs', 'measure', 'copy', 'farm'];
const BRUSH_TOOLS: ToolId[] = ['raise', 'lower', 'flatten', 'paint_ground'];

export function inLot(x: number, z: number): boolean {
  return x >= -LOT_HALF - EDIT_MARGIN && x < LOT_HALF + EDIT_MARGIN && z >= -LOT_HALF - EDIT_MARGIN && z < LOT_HALF + EDIT_MARGIN;
}

const key3 = (x: number, y: number, z: number) => `${x},${y},${z}`;

export class BuildMode implements EditTarget {
  readonly objects: BuildObjects;
  readonly history = new BuildHistory(150);
  readonly cam = new BuildCamera();
  readonly navigation: BuildNavigation;
  readonly pastePlacement: PastePlacement;
  readonly group = new THREE.Group();
  readonly omats: ObjectMaterials;
  private gmats: { valid: THREE.ShaderMaterial; invalid: THREE.ShaderMaterial };

  // ghosts & helpers
  private blockGhost = new THREE.Group();
  private blockGhostKey = '';
  private objGhost: THREE.Group | null = null;
  private objGhostKey = '';
  private objGhostValid = true;
  private areaGhost = new THREE.Group();
  private areaKey = '';
  private pasteGhost = new THREE.Group();
  private pasteGhostKey = '';
  private hover: THREE.LineSegments;
  private hoverMat: THREE.LineBasicMaterial;
  private region: THREE.LineSegments;
  private measureLine: THREE.Line;

  // tool state
  target: Target | null = null;
  rotSteps = 0;
  fineRot = 0;
  private pendingA: T.P3 | null = null;
  private pressCell: string | null = null;
  private stroke: Map<string, BlockChange> | null = null;
  private strokeLabel = '';
  private strokeY = 0;
  private lastStrokeCell = '';
  private drag: { id: number; before: BuildObjectSave; moved: boolean; startNdc: [number, number]; startView: [number, number] } | null = null;
  private clipboard: Clip | null = null;
  private paste: Clip | null = null;
  private pasteSteps = 0;
  private regionBox: { a: T.P3; b: T.P3 } | null = null;
  private lightTimer = 0;
  private saveDebounce = -1;
  private saveTimer = 60;
  private statusTimer = 0;
  private lastStatus = '';
  private flyTap = 0;
  private offs: (() => void)[] = [];
  private seed = 1;

  constructor(private game: Game, save: BuildStateSave | undefined) {
    this.navigation = new BuildNavigation(game, () => {
      this.cancelPending();
      this.endStroke();
      this.target = null;
      // Move both cameras so teleport works in build camera, photo mode and walkthrough.
      this.cam.position.copy(game.player.eyePosition());
      if (this.usesFreeCamera()) this.cam.apply(game.camera);
      else game.player.updateCamera(game.camera, 1);
      game.camera.updateMatrixWorld();
    });
    this.omats = objectMaterials(game.assets.uniforms);
    this.gmats = createGhostMaterials(game.assets.uniforms);
    this.objects = new BuildObjects(game.world, this.omats);
    this.pastePlacement = new PastePlacement(game.world, this.objects, inLot);
    this.group.name = 'build-mode';
    this.group.add(this.objects.group, this.blockGhost, this.areaGhost, this.pasteGhost);
    this.hoverMat = new THREE.LineBasicMaterial({ color: '#fff4c8', transparent: true, opacity: 0.85, depthTest: true });
    this.hover = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), this.hoverMat);
    this.hover.renderOrder = 6;
    this.hover.visible = false;
    this.region = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: '#7fd3ff', transparent: true, opacity: 0.9 }));
    this.region.visible = false;
    this.measureLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: '#ffd24a', depthTest: false }));
    this.measureLine.renderOrder = 9;
    this.measureLine.visible = false;
    this.group.add(this.hover, this.region, this.measureLine);
    game.scene.add(this.group);
    this.seed = game.meta.seed;
    if (save) this.objects.load(save.objects ?? [], save.nextId ?? 1);
    this.history.onChange = () => {
      const st = useBuildStore.getState();
      st.set({ undoLabel: this.history.peekUndo(), redoLabel: this.history.peekRedo(), dirty: true });
      this.saveDebounce = 5;
    };
    this.objects.onChanged = () => {
      if (this.selectedId !== null && !this.objects.get(this.selectedId)) this.select(null);
    };
    const st = useBuildStore.getState();
    st.reset();
    game.player.onLanded = () => useBuildStore.getState().set({ flying: false });
    const bs = game.meta.build;
    st.set({
      active: true, timeLocked: bs?.timeLocked ?? true, weather: bs?.weather ?? 'clear', theme: bs?.theme ?? null, labelsVisible: true,
      dayFraction: game.clock.dayFraction, grid: true, tool: 'place',
    });
    if (save?.camera) {
      const c = save.camera;
      this.cam.position.set(c.x, c.y, c.z);
      this.cam.yaw = c.yaw;
      this.cam.pitch = c.pitch;
    }
    void listBlueprints().then((b) => useBuildStore.getState().set({ blueprints: b })).catch(() => { /* no storage */ });
    // keep the ghost in sync with UI changes (catalog picks, variants)
    this.offs.push(useBuildStore.subscribe((s, p) => {
      if (s.selectedItem !== p.selectedItem || s.variantByItem !== p.variantByItem || s.tool !== p.tool) {
        this.cancelPending();
        if (s.tool !== p.tool && p.tool === 'copy') this.clearRegion();
      }
      if (s.labelsVisible !== p.labelsVisible || s.photo !== p.photo || s.walkthrough !== p.walkthrough) this.objects.setLabelsVisible(s.labelsVisible && !s.photo && !s.walkthrough);
      if (s.grid !== p.grid || s.photo !== p.photo || s.walkthrough !== p.walkthrough) this.updateGrid();
    }));
    this.updateGrid();
  }

  // ---------------------------------------------------------------- setup

  async prepare(onProgress: (f: number) => void): Promise<void> {
    await renderCatalogIcons(this.game.renderer, this.game.assets, this.omats, onProgress);
    useBuildStore.setState((s) => ({ iconsVersion: s.iconsVersion + 1 }));
  }

  serialize(): BuildStateSave {
    const st = useBuildStore.getState();
    return {
      objects: this.objects.serialize(),
      nextId: this.objects.nextId,
      camera: { x: this.cam.position.x, y: this.cam.position.y, z: this.cam.position.z, yaw: this.cam.yaw, pitch: this.cam.pitch },
      favorites: st.favorites,
      recent: st.recent,
    };
  }

  dispose(): void {
    this.navigation.dispose();
    for (const o of this.offs) o();
    this.clearGhosts();
    this.objects.dispose();
    this.gmats.valid.dispose();
    this.gmats.invalid.dispose();
    for (const helper of [this.hover, this.region, this.measureLine]) {
      helper.geometry.dispose();
      (helper.material as THREE.Material).dispose();
    }
    this.game.scene.remove(this.group);
    const u = this.game.assets.uniforms;
    for (const p of u.uPointPos.value) p.set(0, -1000, 0, 0);
    u.uGrid.value.x = 0;
    useBuildStore.getState().reset();
  }

  /** What the first-person hand holds: the selected block, nothing for furniture / tools. */
  heldSpec(): HeldSpec | null {
    const st = useBuildStore.getState();
    if (st.tool !== 'place' || st.pasting || st.walkthrough) return null;
    const item = st.selectedItem ? catalogItem(st.selectedItem) : null;
    if (!item || item.placementType !== 'block' || !item.block) return null;
    const v = variantOf(item, st.variantByItem[item.id]);
    const m = v?.meta ?? 0;
    const meta = item.metaKind === 'rotated' ? (m << 2) | 2 : item.metaKind === 'panel_h' ? m << 1 : m;
    return { block: { id: blockId(item.block), meta }, key: `b:${item.block}:${meta}` };
  }

  // ---------------------------------------------------------------- EditTarget

  applyBlocks(changes: BlockChange[], dir: 'to' | 'from'): void {
    const w = this.game.world;
    w.beginBatch();
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const farm = this.game.farming;
    for (const c of changes) {
      const [id, meta] = c[dir];
      this.setBlock(c.x, c.y, c.z, id, meta);
      // live crops start growing from now (undo/redo re-plants them as seedlings)
      const k = `${c.x},${c.y},${c.z}`;
      if (BLOCK_DEFS[id]?.growth && meta & LIVE_CROP_BIT) {
        if (!farm.crops.has(k)) farm.crops.set(k, { planted: this.game.growthNow() - ((meta >> 3) & 7) * (BLOCK_DEFS[id].growth!.secondsPerStage) });
      } else farm.crops.delete(k);
      if (c.x < x0) x0 = c.x;
      if (c.x > x1) x1 = c.x;
      if (c.z < z0) z0 = c.z;
      if (c.z > z1) z1 = c.z;
    }
    w.endBatch();
    if (changes.length) this.objects.relightNear((x0 + x1) / 2, (z0 + z1) / 2, Math.max(x1 - x0, z1 - z0) / 2 + 12);
  }

  addObject(o: BuildObjectSave): void {
    this.objects.add(o);
  }

  removeObject(id: number): void {
    this.objects.remove(id);
    if (this.selectedId === id) this.select(null);
  }

  updateObject(o: BuildObjectSave): void {
    this.objects.patch(o.id, { x: o.x, y: o.y, z: o.z, rotation: o.rotation, variantId: o.variantId, state: o.state ?? {} });
    if (this.selectedId === o.id) this.select(o.id);
  }

  /** Write a block even where the chunk isn't loaded (stored as a pending modification). */
  private setBlock(x: number, y: number, z: number, id: number, meta: number) {
    const w = this.game.world;
    if (w.set(x, y, z, id, meta)) return;
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    const k = ckey(cx, cz);
    let m = w.mods.get(k);
    if (!m) {
      m = new Map();
      w.mods.set(k, m);
    }
    m.set(localIndex(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE), id | (meta << 8));
    w.dirtyMods.add(k);
  }

  private reader(): T.BlockReader {
    const w = this.game.world;
    return { get: (x, y, z) => w.get(x, y, z), getMeta: (x, y, z) => w.getMeta(x, y, z) };
  }

  // ---------------------------------------------------------------- camera

  get cameraMode(): 'player' | 'build' {
    return useBuildStore.getState().camera;
  }

  /** Free build camera (C / photo mode) — Game calls this instead of the player camera. */
  usesFreeCamera(): boolean {
    const st = useBuildStore.getState();
    return st.camera === 'build' || st.photo;
  }

  updateCamera(dt: number, camera: THREE.PerspectiveCamera, active: boolean): void {
    if (active && !this.game.input.cursorFree) {
      this.cam.update(dt, this.game.input, () => this.target?.point.clone() ?? null);
      const p = this.cam.position;
      // keep the camera out of solid blocks and near the lot
      p.x = THREE.MathUtils.clamp(p.x, -LOT_HALF - 60, LOT_HALF + 60);
      p.z = THREE.MathUtils.clamp(p.z, -LOT_HALF - 60, LOT_HALF + 60);
    }
    this.cam.apply(camera);
    camera.updateMatrixWorld();
  }

  focus(): THREE.Vector3 {
    return this.navigation.target ?? (this.usesFreeCamera() ? this.cam.position : this.game.player.position);
  }

  setCamera(mode: 'player' | 'build'): void {
    const st = useBuildStore.getState();
    if (st.camera === mode) return;
    const g = this.game;
    this.cancelPending();
    if (mode === 'build') {
      this.cam.enter(g.player.eyePosition(), g.player.yaw, g.player.pitch);
      g.releasePointer();
      st.set({ camera: 'build', cursorMode: false });
      g.audio.play('click');
    } else {
      // back to the player where they stood
      st.set({ camera: 'player', cursorMode: g.input.cursorFree && !st.photo });
      if (useGameStore.getState().overlay === null) g.input.requestLock();
      g.audio.play('click');
    }
  }

  setCursorMode(on: boolean): void {
    const st = useBuildStore.getState();
    if (st.camera === 'build') return;
    if (on) {
      st.set({ cursorMode: true });
      this.game.input.setCursorFree(true);
      this.game.releasePointer();
    } else this.game.input.requestLock(true);
  }

  /** Player perspective, available from the toolbar and its own shortcut (V selects objects). */
  setPlayerView(mode: 'first' | 'third'): void {
    const st = useBuildStore.getState();
    if (st.photo) this.togglePhoto();
    if (st.camera === 'build') this.setCamera('player');
    this.game.player.cameraMode = mode;
    useSettingsStore.getState().update('gameplay', { cameraMode: mode });
  }

  togglePlayerView(): void {
    this.setPlayerView(this.game.player.cameraMode === 'first' ? 'third' : 'first');
  }

  /** Whether the canvas is aimed with the mouse cursor (free pointer) instead of the screen centre. */
  private freeCursor(): boolean {
    const st = useBuildStore.getState();
    return !this.game.input.pointerLocked && (st.camera === 'build' || st.cursorMode || this.game.input.touch.active);
  }

  private viewYaw(): number {
    return this.usesFreeCamera() ? this.cam.yaw : this.game.player.yaw;
  }

  private viewPitch(): number {
    return this.usesFreeCamera() ? this.cam.pitch : this.game.player.pitch;
  }

  private levelTimer = 0;

  /** The build grid follows the floor you're working on (multi-story). */
  private followLevel(dt: number, st: ReturnType<typeof useBuildStore.getState>) {
    this.levelTimer -= dt;
    if (this.levelTimer > 0) return;
    this.levelTimer = 0.3;
    let y = this.gridY;
    if (st.camera === 'player') {
      const b = this.game.player.body;
      if (b.grounded && !this.game.player.flying) y = Math.round(b.pos.y);
    } else if (this.target?.block && this.target.block.ny === 1) y = this.target.block.y + 1;
    if (y !== this.gridY) {
      this.gridY = y;
      this.updateGrid();
      st.set({ level: y - (PLOT_Y + 1) });
    }
  }

  // ---------------------------------------------------------------- time / weather / grid

  setDayFraction(f: number): void {
    const c = this.game.clock;
    const cur = c.dayFraction;
    let d = f - cur;
    d -= Math.floor(d);
    c.time += d * c.dayLength;
    useBuildStore.getState().set({ dayFraction: c.dayFraction });
  }

  /** Something changed that isn't in the undo history (a friend built here): save soon. */
  markDirty(): void {
    useBuildStore.getState().set({ dirty: true });
    this.saveDebounce = 5;
  }

  setWeather(w: 'clear' | 'cloudy' | 'rain'): void {
    this.game.env.setWeather(w, 1e9);
    useBuildStore.getState().set({ weather: w });
    this.game.meta = { ...this.game.meta, build: { ...(this.game.meta.build ?? { plot: 'meadow', timeOfDay: 'day', timeLocked: true, weather: 'clear' }), weather: w } };
    this.saveDebounce = 3;
  }

  setTimeLocked(locked: boolean): void {
    useBuildStore.getState().set({ timeLocked: locked });
    this.game.meta = { ...this.game.meta, build: { ...(this.game.meta.build ?? { plot: 'meadow', timeOfDay: 'day', timeLocked: true, weather: 'clear' }), timeLocked: locked } };
    this.saveDebounce = 3;
  }

  private gridY = PLOT_Y + 1;

  private updateGrid() {
    const st = useBuildStore.getState();
    const g = this.game.assets.uniforms.uGrid.value;
    g.set(st.grid && !st.photo && !st.walkthrough ? 1 : 0, this.gridY, LOT_HALF, LOT_HALF);
  }

  // ---------------------------------------------------------------- per frame

  update(dt: number, simulate: boolean): void {
    this.navigation.update();
    const st = useBuildStore.getState();
    const gs = useGameStore.getState();
    const inp = this.game.input;
    this.handleKeys(st, gs.overlay);
    const p = this.focus();
    this.objects.tick(dt, p.x, p.z);
    this.updateLights(dt);
    this.autosave(dt, simulate);
    if (st.timeLocked === false) {
      this.statusTimer -= dt;
      if (this.statusTimer <= 0) {
        this.statusTimer = 1;
        st.set({ dayFraction: this.game.clock.dayFraction });
      }
    }
    const canAct = simulate && gs.overlay === null && !inp.cursorFree && !st.photo && !this.game.player.waitingForGround && !this.game.rest.seated && !this.game.rest.consumed;
    if (!canAct) {
      this.target = null;
      this.hideTransient();
      this.endStroke();
      if (this.drag) this.endDrag(false);
      return;
    }
    // aim
    this.target = this.pick();
    if (st.walkthrough) {
      this.hideTransient();
      if (inp.wasPressed('interact') || inp.mouseRightPressed || inp.touch.interactPressed || this.primaryPressed()) this.interact();
      return;
    }
    if (inp.wasPressed('interact') || inp.touch.interactPressed) this.interact();
    // Clicking / tapping a door, gate or curtain with the Place tool opens it (nobody wants to
    // stick a lamp onto a door leaf). Lights & taps still need F / ✋ so you can place next to them.
    const tobj = this.target?.obj?.obj;
    const ripe = !tobj && st.tool === 'place' && !st.pasting && this.aimedCrop()?.ripe;
    if (ripe && this.primaryPressed()) {
      this.harvest();
      inp.mouseLeftPressed = false;
      inp.touch.placePressed = false;
    }
    if (tobj && this.primaryPressed() && st.tool === 'place' && !st.pasting && (tobj.def.interaction === 'door' || tobj.def.interaction === 'curtain')) {
      this.interact();
      inp.mouseLeftPressed = false;
      inp.touch.placePressed = false;
      inp.mouseLeft = false;
      inp.touch.placeHeld = false;
    }
    // middle mouse = pick material (in the free camera middle-drag pans instead)
    if (inp.mouseMiddlePressed && st.camera !== 'build') this.pickMaterial();
    this.followLevel(dt, st);
    const tool = st.pasting ? 'paste' : st.tool;
    this.hover.visible = false;
    this.measureLine.visible = st.tool === 'measure' && !!this.pendingA;
    if (tool !== 'paste') this.pasteGhost.visible = false;
    if (!AREA_TOOLS.includes(st.tool) || st.pasting) this.areaGhost.visible = false;
    if (st.tool !== 'place' || st.pasting) this.hideItemGhosts();
    switch (tool) {
      case 'paste': this.updatePaste(dt); break;
      case 'place': this.updatePlace(dt, st); break;
      case 'select': this.updateSelect(); break;
      case 'remove': this.updateRemove(dt); break;
      case 'paint': this.updatePaint(dt); break;
      case 'pick':
        this.showHover();
        if (this.primaryPressed()) this.pickMaterial();
        break;
      default:
        if (AREA_TOOLS.includes(st.tool)) this.updateArea(st.tool);
        else if (BRUSH_TOOLS.includes(st.tool)) this.updateBrush(dt, st.tool);
    }
    // right click cancels a pending two-point tool / paste / selection (not in the free camera, where it looks around)
    // (nothing to cancel → right-click opens doors / switches lights like F)
    if (inp.mouseRightPressed && st.camera !== 'build' && !this.cancelOrDeselect(true) && this.target?.obj?.obj.def.interaction) this.interact();
    this.updateStatus();
  }

  private primaryPressed(): boolean {
    const inp = this.game.input;
    return inp.mouseLeftPressed || inp.touch.placePressed;
  }

  private primaryHeld(): boolean {
    const inp = this.game.input;
    return inp.mouseLeft || inp.touch.placeHeld;
  }

  private hideTransient() {
    this.hideItemGhosts();
    this.areaGhost.visible = false;
    this.pasteGhost.visible = false;
    this.hover.visible = false;
    this.measureLine.visible = false;
  }

  private hideItemGhosts() {
    this.blockGhost.visible = false;
    if (this.objGhost) this.objGhost.visible = false;
  }

  private clearGhosts() {
    this.setBlockGhost(null);
    this.setObjGhost(null, '');
    this.setAreaGhost([]);
    this.setPasteGhost(null);
  }

  // ---------------------------------------------------------------- keys

  private handleKeys(st: ReturnType<typeof useBuildStore.getState>, overlay: string | null) {
    const inp = this.game.input;
    const g = this.game;
    const ctrl = inp.ctrl;
    // catalog toggle works while the catalog is open
    if (inp.keyPressed('KeyB') && !inp.ctrlPressed('KeyB')) {
      if (overlay === 'catalog') this.closeCatalog();
      else if (overlay === null && !st.photo) this.openCatalog();
      return;
    }
    if (inp.keyPressed('F10')) {
      if (overlay === null || st.photo) this.togglePhoto();
      return;
    }
    if (overlay !== null) return;
    if (inp.wasPressed('buildView') && !ctrl && !inp.alt) {
      this.togglePlayerView();
      return;
    }
    if (st.photo) {
      if (inp.keyPressed('Escape')) this.togglePhoto();
      return;
    }
    // With the UI cursor, only menus and view controls accept keyboard input.
    if (inp.cursorFree) {
      if (inp.keyPressed('Escape')) g.openOverlay('pause');
      else if (inp.keyPressed('Tab')) this.setCursorMode(false);
      else if (!ctrl && !inp.alt && inp.keyPressed('KeyC')) this.setCamera(st.camera === 'build' ? 'player' : 'build');
      else if (!ctrl && !inp.alt && inp.keyPressed('F9')) this.setWalkthrough(!st.walkthrough);
      return;
    }
    // undo / redo & clipboard (modifier state captured at key-press time)
    const cp = (c: string) => inp.ctrlPressed(c);
    if (cp('KeyZ')) {
      if (inp.shiftPressed('KeyZ')) this.redo();
      else this.undo();
      return;
    }
    if (cp('KeyY')) {
      this.redo();
      return;
    }
    if (cp('KeyD')) {
      this.duplicateSelected();
      return;
    }
    if (cp('KeyC')) {
      if (this.regionBox) this.copyRegion();
      else {
        st.set({ tool: 'copy' });
        g.notify('Copy: click two corners of the area to copy.', '📋');
      }
      return;
    }
    if (cp('KeyV')) {
      this.startPaste();
      return;
    }
    if (cp('KeyS')) {
      void g.saveNow('pause');
      return;
    }
    if (ctrl || ['KeyZ', 'KeyY', 'KeyD', 'KeyC', 'KeyV', 'KeyS'].some(cp)) return;
    if (inp.keyPressed('Escape')) {
      // (with pointer lock the browser releases the lock → pause menu instead)
      if (!this.cancelOrDeselect(true)) {
        if (st.walkthrough) this.setWalkthrough(false);
        else g.openOverlay('pause');
      }
      return;
    }
    if (inp.keyPressed('F9')) {
      this.setWalkthrough(!st.walkthrough);
      return;
    }
    if (st.walkthrough) return;
    if (inp.keyPressed('KeyC')) this.setCamera(st.camera === 'build' ? 'player' : 'build');
    if (inp.keyPressed('Tab')) this.setCursorMode(!st.cursorMode);
    if (inp.keyPressed('KeyG')) st.set({ grid: !st.grid });
    if (inp.keyPressed('KeyH')) st.set({ hintsCollapsed: !st.hintsCollapsed });
    if (inp.keyPressed('KeyR')) this.rotate(inp.shiftPressed('KeyR'));
    if (inp.keyPressed('Delete') || inp.keyPressed('Backspace')) {
      if (this.selectedId !== null) this.deleteSelected();
      else if (this.regionBox) this.deleteRegion();
    }
    // tool hotkeys
    const toolKeys: [string, ToolId][] = [['KeyX', 'remove'], ['KeyV', 'select'], ['KeyT', 'paint'], ['KeyY', 'wall'], ['KeyU', 'room'], ['KeyI', 'floor'], ['KeyO', 'roof'], ['KeyK', 'pool'], ['KeyJ', 'stairs'], ['KeyN', 'measure']];
    const camFly = st.camera === 'build';
    for (const [code, tool] of toolKeys) if (inp.keyPressed(code)) this.setTool(tool);
    if (inp.keyPressed('KeyP')) {
      if (st.tool === 'pick') this.pickMaterial();
      else this.setTool('pick');
    }
    if (inp.keyPressed('KeyL')) {
      const cycle: ToolId[] = ['raise', 'lower', 'flatten', 'paint_ground'];
      const i = cycle.indexOf(st.tool);
      this.setTool(cycle[(i + 1) % cycle.length]);
    }
    if (!camFly && inp.keyPressed('KeyQ')) this.setTool('place');
    // option tweaks: [ ] wall height / brush size, , . depth / width
    if (inp.keyPressed('BracketLeft') || inp.keyPressed('BracketRight')) {
      const up = inp.keyPressed('BracketRight');
      if (BRUSH_TOOLS.includes(st.tool)) {
        const sizes = [1, 3, 5, 9] as const;
        const i = sizes.indexOf(st.options.brush);
        st.setOption('brush', sizes[Math.max(0, Math.min(3, i + (up ? 1 : -1)))]);
      } else if (st.tool === 'pool') st.setOption('poolDepth', Math.max(1, Math.min(4, st.options.poolDepth + (up ? 1 : -1))));
      else if (st.tool === 'stairs') st.setOption('stairWidth', Math.max(1, Math.min(3, st.options.stairWidth + (up ? 1 : -1))));
      else st.setOption('wallHeight', Math.max(1, Math.min(4, st.options.wallHeight + (up ? 1 : -1))));
      this.areaKey = '';
    }
    // quick slots: recent items 1-9
    for (let i = 1; i <= 9; i++) {
      if (inp.keyPressed(`Digit${i}`)) {
        const id = st.recent[i - 1];
        if (id) this.chooseItem(id);
      }
    }
    // double-tap Space = fly (player camera)
    if (!camFly && inp.keyPressed('Space')) {
      const now = performance.now();
      if (now - this.flyTap < 320) {
        this.toggleFly();
        this.flyTap = 0;
      } else this.flyTap = now;
    }
  }

  // ---------------------------------------------------------------- UI actions (called by React too)

  openCatalog(): void {
    this.cancelPending();
    useBuildStore.getState().set({ catalogOpen: true });
    this.game.openOverlay('catalog');
    this.game.audio.play('open');
  }

  closeCatalog(): void {
    useBuildStore.getState().set({ catalogOpen: false });
    if (useGameStore.getState().overlay === 'catalog') this.game.closeOverlay();
    this.game.audio.play('close');
  }

  /** Pick an item from the catalog / quickbar (tools switch the tool, presets start placing). */
  chooseItem(id: string, variant?: string): void {
    const item = catalogItem(id);
    const st = useBuildStore.getState();
    if (!item) return;
    this.cancelPending();
    st.selectItem(id, variant);
    st.pushRecent(id);
    this.rotSteps = 0;
    this.fineRot = 0;
    st.set({ rotationDeg: 0 });
    if (item.placementType === 'tool' && item.tool) {
      this.setTool(item.tool);
      return;
    }
    if (item.placementType === 'preset' && item.preset) {
      const bp = presetBlueprint(item.preset);
      if (bp) this.beginPaste({ name: bp.name, size: bp.size, blocks: bp.blocks, objects: bp.objects });
      return;
    }
    st.set({ tool: 'place', pasting: false, pasteName: null });
    this.paste = null;
    // remember the material for the area tools
    if (item.placementType === 'block') {
      const v = variantOf(item, st.variantByItem[id] ?? variant);
      const mk = v?.meta !== undefined && item.metaKind !== 'glass' && item.metaKind !== 'fixed' ? ARCH_MATERIALS[v.meta]?.key : undefined;
      if (mk) {
        if (item.sub === 'Walls' || item.id.includes('wall')) st.setOption('wallMat', mk);
        else if (item.sub === 'Floors' || item.id === 'floor' || item.id.includes('deck') || item.id.includes('patio')) st.setOption('floorMat', mk);
        else if (item.sub === 'Roofs' || item.sub === 'Roof') st.setOption('roofMat', mk);
        else if (item.sub === 'Foundation') st.setOption('foundationMat', mk);
        else if (item.sub === 'Ceilings') st.setOption('ceilingMat', mk);
        else if (item.sub === 'Stairs') st.setOption('stairMat', mk);
      }
    }
  }

  setTool(tool: ToolId): void {
    const st = useBuildStore.getState();
    this.cancelPending();
    this.paste = null;
    st.set({ tool, pasting: false, pasteName: null });
    if (tool !== 'select') this.select(null);
    this.game.audio.play('click');
  }

  /** Fly / walk (double-tap Space, the 🕊️ button, or double-tap ⤒ on touch). */
  toggleFly(force?: boolean): void {
    const g = this.game;
    if (useBuildStore.getState().camera === 'build') return;
    const on = force ?? !g.player.flying;
    if (on === g.player.flying) return;
    g.player.flying = on;
    if (on) {
      // a little hop so you leave the ground immediately
      g.player.body.vel.y = Math.max(g.player.body.vel.y, 5);
      g.player.body.grounded = false;
    }
    useBuildStore.getState().set({ flying: on });
    const touch = g.input.touch.active;
    g.notify(
      on ? (touch ? 'Flying — ⏫ up, ⏬ down, push the stick fully to go fast.' : 'Flying — Space up, Shift down, Ctrl faster. Double-tap Space to land.') : 'Walking',
      on ? '🕊️' : '🚶',
    );
    g.audio.play(on ? 'jump' : 'land', { material: 'dirt' });
  }

  setWalkthrough(on: boolean): void {
    const st = useBuildStore.getState();
    this.cancelPending();
    this.select(null);
    if (on && st.camera === 'build') this.setCamera('player');
    st.set({ walkthrough: on, cursorMode: this.game.input.cursorFree && !this.usesFreeCamera() });
    this.game.notify(on ? 'Walkthrough — explore your home. F opens doors & switches lights. F9 to keep building.' : 'Back to building', on ? '🚶' : '🛠️');
  }

  togglePhoto(): void {
    const st = useBuildStore.getState();
    const on = !st.photo;
    this.cancelPending();
    if (on) {
      if (st.camera !== 'build') this.cam.enter(this.game.player.eyePosition(), this.game.player.yaw, this.game.player.pitch);
      this.game.releasePointer();
      st.set({ photo: true, dayFraction: this.game.clock.dayFraction });
      useGameStore.setState({ hudHidden: false });
    } else {
      st.set({ photo: false, cursorMode: this.game.input.cursorFree && st.camera === 'player' });
      if (st.camera === 'player' && useGameStore.getState().overlay === null) this.game.input.requestLock();
    }
  }

  undo(): void {
    const c = this.history.undo();
    this.game.audio.play(c ? 'click' : 'error');
    if (c) this.flash(`Undo: ${c.label}`);
  }

  redo(): void {
    const c = this.history.redo();
    this.game.audio.play(c ? 'click' : 'error');
    if (c) this.flash(`Redo: ${c.label}`);
  }

  private flash(text: string) {
    useBuildStore.getState().set({ status: text });
    this.lastStatus = text;
    this.statusHold = 1.6;
  }
  private statusHold = 0;

  rotate(reverse = false): void {
    const st = useBuildStore.getState();
    const sel = this.selectedId !== null ? this.objects.get(this.selectedId) : null;
    if (st.tool === 'select' && sel && !this.drag) {
      const fine = reverse && sel.def.freeRotate;
      let step = fine ? Math.PI / 12 : Math.PI / 2;
      if (sel.def.placement === 'opening' || sel.def.placement === 'wall') step = Math.PI;
      if (sel.def.placement === 'wall') return;
      const before = toSave(sel);
      const after = { ...before, rotation: normAngle(before.rotation + step) };
      if (sel.def.placement !== 'opening') {
        const pose: Pose = { x: after.x, y: after.y, z: after.z, rotation: after.rotation, valid: true, cut: [] };
        const why = this.objectBlocked(sel.def, pose, sel.id);
        if (why) {
          this.flash(`Can't rotate: ${why}`);
          this.game.audio.play('error');
          return;
        }
      }
      this.history.run(new ObjectChangeCommand(this, [{ before, after }], 'Rotate object'));
      this.game.audio.play('click');
      return;
    }
    if (st.pasting) {
      this.pasteSteps = (this.pasteSteps + (reverse ? 3 : 1)) % 4;
      st.set({ rotationDeg: this.pasteSteps * 90 });
      return;
    }
    const item = st.selectedItem ? catalogItem(st.selectedItem) : null;
    const def = item?.object ? objectDef(item.object) : null;
    if (reverse && def?.freeRotate) this.fineRot = normAngle(this.fineRot + Math.PI / 12);
    else this.rotSteps = (this.rotSteps + (reverse ? 3 : 1)) % 4;
    st.set({ rotationDeg: Math.round(((this.rotSteps * 90 + (this.fineRot * 180) / Math.PI) % 360 + 360) % 360) });
    this.game.audio.play('click');
  }

  cancelPending(): void {
    this.pendingA = null;
    this.pressCell = null;
    this.areaKey = '';
    this.setAreaGhost([]);
    this.measureLine.visible = false;
    useBuildStore.getState().set({ pending: false, measure: null });
  }

  /** Esc / right click: cancel the innermost thing. Returns false when there was nothing to cancel. */
  cancelOrDeselect(keepView = false): boolean {
    const st = useBuildStore.getState();
    if (this.drag) {
      this.endDrag(true);
      return true;
    }
    if (this.pendingA) {
      this.cancelPending();
      return true;
    }
    if (st.pasting) {
      this.paste = null;
      st.set({ pasting: false, pasteName: null });
      this.setPasteGhost(null);
      return true;
    }
    if (this.selectedId !== null) {
      this.select(null);
      return true;
    }
    if (this.regionBox) {
      this.clearRegion();
      return true;
    }
    if (keepView) return false;
    if (st.cursorMode) {
      this.setCursorMode(false);
      return true;
    }
    if (st.camera === 'build') {
      this.setCamera('player');
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- targeting

  private raycaster = new THREE.Raycaster();

  private aimRay(): { origin: THREE.Vector3; dir: THREE.Vector3; reach: number } | null {
    const cam = this.game.camera;
    const inp = this.game.input;
    const free = this.freeCursor();
    if (free) {
      if (inp.touch.active && !useBuildStore.getState().cursorMode) {
        // touch: aim from the screen centre (crosshair), in the walking view and the build camera
        return { origin: cam.position.clone(), dir: cam.getWorldDirection(new THREE.Vector3()), reach: this.usesFreeCamera() ? REACH_CAMERA : REACH_PLAYER * 1.6 };
      }
      this.raycaster.setFromCamera(new THREE.Vector2(inp.ndcX, inp.ndcY), cam);
      return { origin: this.raycaster.ray.origin.clone(), dir: this.raycaster.ray.direction.clone(), reach: this.usesFreeCamera() ? REACH_CAMERA : REACH_PLAYER * 2 };
    }
    if (!inp.pointerLocked) return null;
    return { origin: cam.position.clone(), dir: cam.getWorldDirection(new THREE.Vector3()), reach: REACH_PLAYER };
  }

  private pick(exclude = -1): Target | null {
    const ray = this.aimRay();
    if (!ray) return null;
    const bh = raycastBlocks(this.game.world, ray.origin, ray.dir, ray.reach, false);
    const walk = useBuildStore.getState().walkthrough;
    const oh = this.objects.raycast(ray.origin, ray.dir, ray.reach, (o) => o.id !== exclude && (!walk || o.def.interaction !== 'label'));
    if (!bh && !oh) return null;
    if (oh && (!bh || oh.dist < bh.dist)) return { block: null, obj: oh, point: oh.point, normal: oh.normal, dist: oh.dist };
    return { block: bh!, obj: null, point: bh!.point, normal: new THREE.Vector3(bh!.nx, bh!.ny, bh!.nz), dist: bh!.dist };
  }

  /** The ground/floor cell a click refers to (the block a floor or wall stands on). */
  private groundCell(t: Target): T.P3 | null {
    const w = this.game.world;
    if (t.block) {
      const b = t.block;
      if (b.ny === 1 && !isReplaceable(b.id)) return { x: b.x, y: b.y, z: b.z };
      if (isReplaceable(b.id)) return { x: b.x, y: b.y - 1, z: b.z };
      // a side / bottom face: the floor in front of it
      const x = b.x + b.nx, z = b.z + b.nz;
      for (let y = b.y + Math.min(0, b.ny); y > 1; y--) if (SOLID[w.get(x, y, z)] && !isReplaceable(w.get(x, y, z))) return { x, y, z };
      return null;
    }
    const p = t.point;
    const x = Math.floor(p.x), z = Math.floor(p.z);
    for (let y = Math.floor(p.y); y > 1; y--) if (SOLID[w.get(x, y, z)]) return { x, y, z };
    return null;
  }

  private showHover() {
    const t = this.target;
    if (!t) {
      this.hover.visible = false;
      return;
    }
    if (t.obj) {
      const [a, b] = this.objects.bounds(t.obj.obj);
      this.hover.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      this.hover.scale.set(b[0] - a[0] + 0.02, b[1] - a[1] + 0.02, b[2] - a[2] + 0.02);
    } else if (t.block) {
      this.hover.position.set(t.block.x + 0.5, t.block.y + 0.5, t.block.z + 0.5);
      this.hover.scale.set(1.01, 1.01, 1.01);
    }
    this.hover.visible = true;
  }

  // ---------------------------------------------------------------- place tool

  private placeRepeat = 0;

  private updatePlace(dt: number, st: ReturnType<typeof useBuildStore.getState>) {
    const item = st.selectedItem ? catalogItem(st.selectedItem) : null;
    const t = this.target;
    if (!item) {
      this.hideItemGhosts();
      this.showHover();
      if (this.primaryPressed()) this.flash('Choose something to place: press B for the catalog.');
      return;
    }
    const variant = variantOf(item, st.variantByItem[item.id]);
    if (item.placementType === 'block') {
      if (this.objGhost) this.objGhost.visible = false;
      const pl = t ? this.blockPlacement(t, item, variant?.meta ?? 0) : null;
      if (!pl) {
        this.blockGhost.visible = false;
        this.endStroke();
        return;
      }
      this.setBlockGhost([pl.id, pl.meta]);
      this.blockGhost.position.set(pl.x, pl.y, pl.z);
      this.blockGhost.visible = true;
      this.setGhostTint(this.blockGhost, pl.valid);
      if (this.primaryPressed()) {
        if (!pl.valid) {
          this.flash(pl.reason ?? 'Can’t place here');
          this.game.audio.play('error');
        } else {
          this.beginStroke(`Place ${item.name}`);
          this.strokeSet(pl.x, pl.y, pl.z, pl.id, pl.meta);
          this.game.audio.play('place', { material: BLOCK_DEFS[pl.id].sound });
          this.placeRepeat = 0.32;
          this.lastStrokeCell = key3(pl.x, pl.y, pl.z);
        }
      } else if (this.primaryHeld() && this.stroke) {
        this.placeRepeat -= dt;
        const k = key3(pl.x, pl.y, pl.z);
        if (this.placeRepeat <= 0 && pl.valid && k !== this.lastStrokeCell) {
          this.placeRepeat = 0.14;
          this.strokeSet(pl.x, pl.y, pl.z, pl.id, pl.meta);
          this.lastStrokeCell = k;
          this.game.audio.play('place', { material: BLOCK_DEFS[pl.id].sound, volume: 0.6 });
        }
      } else this.endStroke();
      return;
    }
    this.blockGhost.visible = false;
    if (item.placementType === 'object' && item.object) {
      const def = objectDef(item.object)!;
      const vid = variant?.objectVariant ?? 'default';
      const pose = t ? this.objectPose(def, t) : null;
      if (!pose) {
        if (this.objGhost) this.objGhost.visible = false;
        if (this.primaryPressed()) this.flash(placementHint(def));
        return;
      }
      this.setObjGhost(def, vid);
      const gh = this.objGhost!;
      gh.visible = true;
      gh.position.set(pose.x, pose.y, pose.z);
      gh.rotation.set(0, pose.rotation, 0);
      this.setObjGhostValid(pose.valid);
      // preview the wall cells a door / window will open up
      if (pose.cut.length) {
        let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
        for (const c of pose.cut) {
          x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); z0 = Math.min(z0, c.z);
          x1 = Math.max(x1, c.x + 1); y1 = Math.max(y1, c.y + 1); z1 = Math.max(z1, c.z + 1);
        }
        this.hover.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        this.hover.scale.set(x1 - x0 + 0.03, y1 - y0 + 0.03, z1 - z0 + 0.03);
        this.hoverMat.color.set(pose.valid ? '#ffb36b' : '#ff5a4a');
        this.hover.visible = true;
      }
      if (this.primaryPressed()) {
        if (!pose.valid) {
          this.flash(pose.reason ?? 'Can’t place here');
          this.game.audio.play('error');
        } else this.placeObject(def, vid, pose);
      }
      return;
    }
    if (item.placementType === 'stamp' && item.stamp) {
      if (this.objGhost) this.objGhost.visible = false;
      const g = t ? this.groundCell(t) : null;
      if (!g) {
        this.hover.visible = false;
        return;
      }
      this.hover.position.set(g.x + 0.5, g.y + 1.5, g.z + 0.5);
      this.hover.scale.set(item.stamp === 'bush_small' ? 3 : 5, 1, item.stamp === 'bush_small' ? 3 : 5);
      this.hover.visible = true;
      if (this.primaryPressed()) this.placeStamp(item.stamp, g, item.name);
    }
  }

  private blockPlacement(t: Target, item: BuildCatalogItem, vmeta: number): { x: number; y: number; z: number; id: number; meta: number; valid: boolean; reason?: string } | null {
    const id = blockId(item.block!);
    let x: number, y: number, z: number;
    let frac = 0.25;
    if (t.block) {
      const b = t.block;
      if (isReplaceable(b.id) && b.id !== 0) {
        x = b.x; y = b.y; z = b.z;
      } else {
        x = b.x + b.nx; y = b.y + b.ny; z = b.z + b.nz;
      }
      frac = t.point.y - b.y;
      if (b.ny === 0) frac = t.point.y - Math.floor(t.point.y);
    } else {
      const p = t.point.clone().addScaledVector(t.normal, 0.02);
      x = Math.floor(p.x); y = Math.floor(p.y); z = Math.floor(p.z);
      frac = p.y - y;
    }
    const n = t.normal;
    const inp = this.game.input;
    let meta = vmeta;
    switch (item.metaKind) {
      case 'slab': {
        const top = n.y < -0.5 || (Math.abs(n.y) < 0.5 && frac > 0.5);
        meta = archMeta.slab(vmeta, top);
        break;
      }
      case 'panel_h': {
        const top = n.y < -0.5 || (Math.abs(n.y) < 0.5 && frac > 0.5) || (item.id === 'ceiling' && n.y < 0.5);
        meta = archMeta.panelH(vmeta, top);
        break;
      }
      case 'rotated': {
        const model = archModelOf(id);
        if ((model === 'panel_v' || model === 'baseboard' || model === 'crown') && Math.abs(n.y) < 0.5) {
          // stick to the clicked wall face
          const rot = n.z < -0.5 ? 0 : n.x > 0.5 ? 1 : n.z > 0.5 ? 2 : 3;
          meta = archMeta.rotated(vmeta, (rot + this.rotSteps) & 3);
        } else if (model === 'beam') {
          const base = archMeta.rotated(vmeta, 0) | (inp.shift ? 0 : 2);
          meta = archPlacementMeta(item.block!, base, this.viewYaw() + this.rotSteps * (Math.PI / 2));
        } else meta = archPlacementMeta(item.block!, archMeta.rotated(vmeta, 0), this.viewYaw() + this.rotSteps * (Math.PI / 2));
        break;
      }
      default:
        meta = vmeta;
    }
    let reason: string | undefined;
    const w = this.game.world;
    const cur = w.get(x, y, z);
    if (!inLot(x, z)) reason = 'Outside your lot';
    else if (y < MIN_Y || y > MAX_Y) reason = 'Too high or too low';
    else if (cur !== 0 && !isReplaceable(cur) && cur !== B.WATER) reason = 'Something is already here';
    else if (SOLID[id]) {
      const p = this.game.player.body;
      if (!this.usesFreeCamera() && x + 1 > p.pos.x - p.halfW && x < p.pos.x + p.halfW && z + 1 > p.pos.z - p.halfW && z < p.pos.z + p.halfW && y + 1 > p.pos.y && y < p.pos.y + p.height) reason = 'You are standing there';
      else {
        const blocking = this.objects.query(x + 0.02, y + 0.02, z + 0.02, x + 0.98, y + 0.98, z + 0.98).find((o) => o.def.collision !== 'none');
        if (blocking) reason = `${blocking.def.name} is in the way`;
      }
    }
    return { x, y, z, id, meta, valid: !reason, reason };
  }

  // ---------------------------------------------------------------- object placement

  /** Where an object would go for the current aim (and whether it fits). */
  objectPose(def: ObjectDef, t: Target, exclude = -1): Pose | null {
    const w = this.game.world;
    const inp = this.game.input;
    const free = inp.alt;
    const snap = (v: number) => (free ? v : Math.round(v * 4) / 4);
    const n = t.normal, p = t.point;
    const face = Math.abs(n.y) < 0.5 ? (Math.abs(n.x) > Math.abs(n.z) ? 'x' : 'z') : 'y';
    const facingYaw = Math.round(this.viewYaw() / (Math.PI / 2)) * (Math.PI / 2);
    const userYaw = this.rotSteps * (Math.PI / 2) + (def.freeRotate ? this.fineRot : 0);
    const [la, lb] = localBounds(def);
    const depth = lb[2] - la[2];
    let x = 0, y = 0, z = 0, rotation = 0;
    let cut: T.P3[] = [];
    let support: number | undefined;
    const floorBelow = (cx: number, cy: number, cz: number): number | null => {
      for (let yy = cy; yy > 1; yy--) {
        const id = w.get(cx, yy, cz);
        if (SOLID[id] && !isReplaceable(id)) {
          const boxes = cellBoxes(id, w.getMeta(cx, yy, cz));
          let top = 0;
          for (const bx of boxes) top = Math.max(top, bx[4]);
          return yy + top;
        }
      }
      return null;
    };
    switch (def.placement) {
      case 'opening': {
        if (t.block && face !== 'y' && !isReplaceable(t.block.id)) {
          const b = t.block;
          rotation = Math.atan2(n.x, n.z) + (this.rotSteps & 1 ? Math.PI : 0);
          const ow = def.opening?.w ?? 1;
          const along = (v: number) => (ow % 2 === 1 ? Math.floor(v) + 0.5 : Math.round(v));
          if (face === 'x') {
            x = b.x + 0.5;
            z = along(p.z);
          } else {
            z = b.z + 0.5;
            x = along(p.x);
          }
          // the storey this wall belongs to: the highest floor at or below the aim, on either side of the wall
          const f1 = floorBelow(b.x + Math.round(n.x), b.y, b.z + Math.round(n.z));
          const f2 = floorBelow(b.x - Math.round(n.x), b.y, b.z - Math.round(n.z));
          const fl = Math.max(f1 ?? -1, f2 ?? -1);
          if (fl < 0) return null;
          y = Math.round(fl);
          cut = T.openingCells(def, x, y, z, rotation);
        } else if (t.block && n.y > 0.5) {
          rotation = facingYaw + userYaw;
          const ow = def.opening?.w ?? 1;
          const al = (v: number) => (ow % 2 === 1 ? Math.floor(v) + 0.5 : Math.round(v));
          x = al(p.x);
          z = Math.floor(p.z) + 0.5;
          if (Math.abs(Math.sin(rotation)) > 0.5) {
            x = Math.floor(p.x) + 0.5;
            z = al(p.z);
          }
          y = p.y;
        } else return null;
        break;
      }
      case 'skylight': {
        if (!t.block || face !== 'y' || isReplaceable(t.block.id)) return null;
        x = t.block.x + 0.5;
        z = t.block.z + 0.5;
        y = t.block.y + 0.9;
        rotation = 0;
        cut = T.openingCells(def, x, y, z, rotation);
        break;
      }
      case 'wall': {
        if (face === 'y') return null;
        if (!t.block && !(t.obj && t.obj.obj.def.placement === 'opening')) return null;
        rotation = Math.atan2(n.x, n.z);
        const off = depth / 2 + 0.002;
        if (face === 'x') {
          x = p.x + n.x * off;
          z = snap(p.z);
        } else {
          z = p.z + n.z * off;
          x = snap(p.x);
        }
        const fx = Math.floor(p.x + n.x * 0.5), fz = Math.floor(p.z + n.z * 0.5);
        const fl = floorBelow(fx, Math.floor(p.y), fz);
        // (mounted items use the floor in front of the wall they hang on)
        if (def.mount !== undefined && fl !== null) y = fl + def.mount;
        else y = snap(p.y - def.size[1] / 2);
        if (fl !== null && y < fl) y = fl;
        break;
      }
      case 'ceiling': {
        if (n.y > -0.5) return null;
        y = p.y - def.size[1];
        x = snap(p.x);
        z = snap(p.z);
        rotation = facingYaw + userYaw;
        break;
      }
      case 'surface':
      case 'floor': {
        if (t.obj && n.y > 0.5 && t.obj.obj.def.surface && def.placement === 'surface') {
          support = t.obj.obj.id;
          y = t.obj.obj.y + t.obj.obj.def.surface;
          x = snap(p.x);
          z = snap(p.z);
        } else if (t.block && n.y > 0.5) {
          y = p.y;
          x = snap(p.x);
          z = snap(p.z);
        } else if (t.block && face !== 'y' && def.placement === 'floor') {
          // aiming at a wall: stand in front of it
          const fx = t.block.x + Math.round(n.x), fz = t.block.z + Math.round(n.z);
          const fl = floorBelow(fx, t.block.y, fz);
          if (fl === null) return null;
          y = fl;
          x = snap(p.x + n.x * (depth / 2 + 0.05));
          z = snap(p.z + n.z * (depth / 2 + 0.05));
        } else if (t.obj && t.obj.obj.def.placement !== 'wall' && t.obj.obj.def.placement !== 'ceiling') {
          // aiming at furniture: use the floor it stands on (rugs slide under tables; others show red if they collide)
          const base = t.obj.obj;
          y = base.y;
          if (base.def.placement === 'surface') {
            const fl = floorBelow(Math.floor(p.x), Math.floor(base.y - 0.01), Math.floor(p.z));
            if (fl === null) return null;
            y = fl;
          }
          x = snap(p.x);
          z = snap(p.z);
        } else return null;
        rotation = facingYaw + userYaw;
        if (def.againstWall && !free) {
          const r = this.pushAgainstWall(def, x, y, z, rotation);
          x = r[0];
          z = r[1];
        }
        if (!free) {
          const s = this.snapToNeighbours(def, x, y, z, rotation, exclude);
          x = s[0];
          z = s[1];
        }
        break;
      }
    }
    rotation = normAngle(rotation);
    const pose: Pose = { x, y, z, rotation, valid: true, cut, support };
    const why = this.objectBlocked(def, pose, exclude);
    if (why) {
      pose.valid = false;
      pose.reason = why;
    }
    return pose;
  }

  /** Slide a cabinet / bed back until it touches the wall behind it. */
  private pushAgainstWall(def: ObjectDef, x: number, y: number, z: number, rotation: number): [number, number] {
    const bx = -Math.sin(rotation), bz = -Math.cos(rotation);
    if (Math.abs(bx) > 0.01 && Math.abs(bz) > 0.01) return [x, z];
    const [la, lb] = localBounds(def);
    const half = (lb[2] - la[2]) / 2;
    const w = this.game.world;
    const hy = Math.floor(y + 0.3);
    for (let d = 0; d <= 1.2; d += 0.05) {
      const px = x + bx * (half + d), pz = z + bz * (half + d);
      const cx = Math.floor(px), cz = Math.floor(pz);
      const id = w.get(cx, hy, cz);
      if (SOLID[id] && !isReplaceable(id)) {
        if (Math.abs(bx) > 0.5) {
          const faceX = bx > 0 ? cx : cx + 1;
          return [faceX - bx * half, z];
        }
        const faceZ = bz > 0 ? cz : cz + 1;
        return [x, faceZ - bz * half];
      }
    }
    return [x, z];
  }

  /** Counter snap: line up with an adjacent object of the same rotation (kitchen runs, desks). */
  private snapToNeighbours(def: ObjectDef, x: number, y: number, z: number, rotation: number, exclude: number): [number, number] {
    const [la, lb] = localBounds(def);
    const hw = (lb[0] - la[0]) / 2, hd = (lb[2] - la[2]) / 2;
    const ax = Math.cos(rotation), az = -Math.sin(rotation); // local +x in world
    const near = this.objects.query(x - hw - 0.4, y + 0.05, z - hw - 0.4, x + hw + 0.4, y + 0.5, z + hw + 0.4);
    for (const o of near) {
      if (o.id === exclude || Math.abs(normAngle(o.rotation - rotation)) > 0.01 || Math.abs(o.y - y) > 0.05) continue;
      if (!o.def.againstWall && o.def.surface === undefined) continue;
      const [oa, ob] = localBounds(o.def);
      const ohw = (ob[0] - oa[0]) / 2, ohd = (ob[2] - oa[2]) / 2;
      const dx = x - o.x, dz = z - o.z;
      const along = dx * ax + dz * az;
      const across = dx * -az + dz * ax; // local z
      const gap = Math.abs(along) - (hw + ohw);
      if (gap > -0.3 && gap < 0.3 && Math.abs(across) < 0.3) {
        const s = Math.sign(along) || 1;
        const newAlong = s * (hw + ohw);
        // align backs (depth) too
        const newAcross = o.def.againstWall && def.againstWall ? hd - ohd : across;
        return [o.x + ax * newAlong + -az * newAcross, o.z + az * newAlong + ax * newAcross];
      }
    }
    return [x, z];
  }

  /** Why an object can't go at a pose (null = it fits). */
  private objectBlocked(def: ObjectDef, pose: Pose, exclude: number): string | null {
    const [la, lb] = localBounds(def);
    const [a, b] = rotatedAabb(la, lb, pose);
    const sh = 0.04;
    if (!inLot(Math.floor(a[0]), Math.floor(a[2])) || !inLot(Math.floor(b[0]), Math.floor(b[2]))) return 'Outside your lot';
    if (a[1] < MIN_Y || b[1] > MAX_Y + 4) return 'Too high or too low';
    const w = this.game.world;
    const cutSet = new Set(pose.cut.map((c) => key3(c.x, c.y, c.z)));
    const min = [a[0] + sh, a[1] + sh, a[2] + sh], max = [b[0] - sh, Math.max(a[1] + sh * 2, b[1] - sh), b[2] - sh];
    // voxels
    for (let yy = Math.floor(min[1]); yy <= Math.floor(max[1]); yy++)
      for (let zz = Math.floor(min[2]); zz <= Math.floor(max[2]); zz++)
        for (let xx = Math.floor(min[0]); xx <= Math.floor(max[0]); xx++) {
          const id = w.get(xx, yy, zz);
          if (!SOLID[id] || cutSet.has(key3(xx, yy, zz))) continue;
          for (const bx of cellBoxes(id, w.getMeta(xx, yy, zz))) {
            if (xx + bx[3] > min[0] && xx + bx[0] < max[0] && yy + bx[4] > min[1] && yy + bx[1] < max[1] && zz + bx[5] > min[2] && zz + bx[2] < max[2]) {
              return ARCH_KIND[id] || OPAQUE_WALL(id) ? 'Blocked by a wall or block' : 'Blocked';
            }
          }
        }
    // other objects
    for (const o of this.objects.query(min[0], min[1], min[2], max[0], max[1], max[2])) {
      if (o.id === exclude || o.id === pose.support) continue;
      if (overlapAllowed(def, o.def)) continue;
      return `Overlaps the ${o.def.name.toLowerCase()}`;
    }
    // the player
    if (def.collision !== 'none' && !this.usesFreeCamera()) {
      const pb = this.game.player.body;
      if (pb.pos.x + pb.halfW > min[0] && pb.pos.x - pb.halfW < max[0] && pb.pos.z + pb.halfW > min[2] && pb.pos.z - pb.halfW < max[2] && pb.pos.y + pb.height > min[1] && pb.pos.y < max[1]) return 'You are standing there';
    }
    return null;
  }

  private placeObject(def: ObjectDef, variant: string, pose: Pose) {
    const id = this.objects.nextId++;
    const save: BuildObjectSave = { id, itemId: def.id, x: round4(pose.x), y: round4(pose.y), z: round4(pose.z), rotation: pose.rotation, variantId: variant };
    if (def.interaction === 'light') save.state = { on: true };
    if (def.interaction === 'label') save.state = { text: 'Living Room' };
    const objCmd = new ObjectChangeCommand(this, [{ before: null, after: save }], `Place ${def.name}`);
    let cmd: BuildCommand = objCmd;
    if (pose.cut.length) {
      const ed = new T.Edits(this.reader());
      for (const c of pose.cut) {
        const [cid] = ed.get(c.x, c.y, c.z);
        if (cid !== 0 && cid !== B.WATER) ed.set(c.x, c.y, c.z, 0, 0);
      }
      const changes = ed.list();
      if (changes.length) cmd = new CompositeCommand([new BlockChangeCommand(this, changes, 'Cut opening'), objCmd], `Place ${def.name}`);
    }
    this.history.run(cmd);
    this.game.audio.play('place', { material: def.tags.includes('glass') || def.placement === 'opening' ? 'wood' : 'cloth' });
    if (def.interaction === 'label') {
      useBuildStore.getState().set({ labelEdit: { id, text: 'Living Room' } });
      this.game.openOverlay('buildDialog');
    }
  }

  private placeStamp(kind: StampKind, g: T.P3, name: string) {
    if (!inLot(g.x, g.z)) {
      this.flash('Outside your lot');
      return;
    }
    const ed = new T.Edits(this.reader());
    if (kind === 'hedge_row') {
      for (let i = -2; i <= 2; i++) ed.soft(g.x + i, g.y + 1, g.z, B.HEDGE, 0);
    } else T.stampTree(ed, kind as Parameters<typeof T.stampTree>[1], g.x, g.y + 1, g.z, (this.seed + g.x * 73856093 + g.z * 19349663 + Math.floor(Math.random() * 1e6)) >>> 0);
    if (this.history.run(new BlockChangeCommand(this, ed.list(), `Plant ${name}`))) this.game.audio.play('place', { material: 'plant' });
  }

  // ---------------------------------------------------------------- select / move

  selectedId: number | null = null;

  select(id: number | null): void {
    this.selectedId = id;
    const st = useBuildStore.getState();
    const o = id !== null ? this.objects.get(id) : undefined;
    if (!o) {
      this.selectedId = null;
      if (st.selection) st.set({ selection: null });
      return;
    }
    const def = o.def;
    st.set({
      selection: {
        id: o.id, name: o.state?.text && def.interaction === 'label' ? `${def.name}: ${o.state.text}` : def.name, itemId: def.id, variant: o.variantId,
        variants: (def.variants ?? []).map((v) => ({ id: v.id, name: v.name, swatch: Object.values(v.colors)[0] ?? '#ccc' })),
        interactive: !!def.interaction, freeRotate: !!def.freeRotate,
      },
    });
  }

  private updateSelect() {
    const inp = this.game.input;
    const t = this.target;
    if (this.drag) {
      const o = this.objects.get(this.drag.id);
      if (!o) {
        this.drag = null;
        return;
      }
      const [vy, vp] = this.drag.startView;
      if (!this.drag.moved && (Math.abs(inp.ndcX - this.drag.startNdc[0]) > 0.012 || Math.abs(inp.ndcY - this.drag.startNdc[1]) > 0.012 || Math.abs(this.viewYaw() - vy) > 0.03 || Math.abs(this.viewPitch() - vp) > 0.03)) this.drag.moved = true;
      if (this.drag.moved) {
        const tt = this.pick(o.id);
        const pose = tt ? this.objectPose(o.def, tt, o.id) : null;
        if (pose && pose.valid && o.def.placement !== 'opening' && o.def.placement !== 'skylight') {
          this.objects.patch(o.id, { x: round4(pose.x), y: round4(pose.y), z: round4(pose.z), rotation: o.def.placement === 'wall' ? pose.rotation : o.rotation });
        }
      }
      this.showSelectionBox(o);
      if (!this.primaryHeld()) this.endDrag(false);
      return;
    }
    if (this.selectedId !== null) {
      const o = this.objects.get(this.selectedId);
      if (o) this.showSelectionBox(o);
    } else this.showHover();
    if (this.primaryPressed()) {
      if (t?.obj) {
        const o = t.obj.obj;
        this.select(o.id);
        if (o.def.placement !== 'opening' && o.def.placement !== 'skylight') this.drag = { id: o.id, before: toSave(o), moved: false, startNdc: [inp.ndcX, inp.ndcY], startView: [this.viewYaw(), this.viewPitch()] };
        this.game.audio.play('click');
      } else this.select(null);
    }
  }

  private endDrag(cancel: boolean) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const o = this.objects.get(d.id);
    if (!o) return;
    const after = toSave(o);
    const same = after.x === d.before.x && after.y === d.before.y && after.z === d.before.z && after.rotation === d.before.rotation;
    if (cancel || same) {
      if (!same) this.objects.patch(o.id, { x: d.before.x, y: d.before.y, z: d.before.z, rotation: d.before.rotation });
      return;
    }
    this.history.push(new ObjectChangeCommand(this, [{ before: d.before, after }], `Move ${o.def.name}`));
    this.game.audio.play('place', { material: 'wood', volume: 0.5 });
  }

  private showSelectionBox(o: PlacedObject) {
    const [a, b] = this.objects.bounds(o);
    this.hover.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    this.hover.scale.set(b[0] - a[0] + 0.04, Math.max(0.05, b[1] - a[1]) + 0.04, b[2] - a[2] + 0.04);
    this.hoverMat.color.set('#7fd3ff');
    this.hover.visible = true;
  }

  deleteSelected(): void {
    if (this.selectedId === null) return;
    const o = this.objects.get(this.selectedId);
    if (!o) return;
    this.removeObjectWithRefill(o);
    this.select(null);
  }

  /** Removing a door/window closes the wall again with the neighbouring material (one undo step). */
  private removeObjectWithRefill(o: PlacedObject) {
    const objCmd = new ObjectChangeCommand(this, [{ before: toSave(o), after: null }], `Remove ${o.def.name}`);
    let cmd: BuildCommand = objCmd;
    if (o.def.opening && o.def.placement === 'opening') {
      const w = this.game.world;
      const cells = T.openingCells(o.def, o.x, o.y, o.z, o.rotation);
      const set = new Set(cells.map((c) => key3(c.x, c.y, c.z)));
      const ed = new T.Edits(this.reader());
      const ax = Math.round(Math.cos(o.rotation)), az = Math.round(-Math.sin(o.rotation));
      for (const c of cells) {
        if (w.get(c.x, c.y, c.z) !== 0) continue;
        let mat: [number, number] | null = null;
        for (let k = 1; k <= 3 && !mat; k++) {
          for (const s of [1, -1]) {
            const nx = c.x + ax * k * s, nz = c.z + az * k * s;
            if (set.has(key3(nx, c.y, nz))) continue;
            const id = w.get(nx, c.y, nz);
            if (id === B.ARCH_BLOCK || (SOLID[id] && SHAPE[id] === 1)) {
              mat = [id, w.getMeta(nx, c.y, nz)];
              break;
            }
          }
        }
        if (mat) ed.set(c.x, c.y, c.z, mat[0], mat[1]);
      }
      const ch = ed.list();
      if (ch.length) cmd = new CompositeCommand([objCmd, new BlockChangeCommand(this, ch, 'Close wall')], `Remove ${o.def.name}`);
    }
    this.history.run(cmd);
    this.game.audio.play('break', { material: 'wood' });
  }

  duplicateSelected(): void {
    const o = this.selectedId !== null ? this.objects.get(this.selectedId) : null;
    if (!o) {
      this.flash('Select an object first (V), then Ctrl+D to duplicate it.');
      return;
    }
    const item = BUILD_CATALOG.find((i) => i.object === o.def.id);
    if (!item) return;
    const st = useBuildStore.getState();
    st.selectItem(item.id, item.variants.find((v) => v.objectVariant === o.variantId)?.id);
    this.select(null);
    st.set({ tool: 'place' });
    // keep its orientation relative to the view
    const facing = Math.round(this.viewYaw() / (Math.PI / 2)) * (Math.PI / 2);
    const diff = normAngle(o.rotation - facing);
    this.rotSteps = ((Math.round(diff / (Math.PI / 2)) % 4) + 4) % 4;
    this.fineRot = o.def.freeRotate ? normAngle(diff - this.rotSteps * (Math.PI / 2)) : 0;
    this.flash(`Duplicating ${o.def.name} — click to place the copy`);
  }

  setSelectedVariant(variant: string): void {
    const o = this.selectedId !== null ? this.objects.get(this.selectedId) : null;
    if (!o || o.variantId === variant) return;
    const before = toSave(o);
    this.history.run(new ObjectChangeCommand(this, [{ before, after: { ...before, variantId: variant } }], `Recolour ${o.def.name}`));
    this.select(o.id);
  }

  setLabelText(id: number, text: string): void {
    const o = this.objects.get(id);
    if (!o) return;
    const before = toSave(o);
    this.history.run(new ObjectChangeCommand(this, [{ before, after: { ...before, state: { ...(before.state ?? {}), text: text.slice(0, 18) || 'Room' } } }], 'Rename room'));
  }

  // ---------------------------------------------------------------- remove / paint / pick

  private removeRepeat = 0;

  private updateRemove(dt: number) {
    this.showHover();
    this.hoverMat.color.set('#ff8a7a');
    const t = this.target;
    const go = this.primaryPressed() || (this.primaryHeld() && (this.removeRepeat -= dt) <= 0);
    if (!this.primaryHeld()) this.endStroke();
    if (!go || !t) return;
    this.removeRepeat = this.primaryPressed() ? 0.32 : 0.12;
    if (t.obj) {
      this.endStroke();
      this.removeObjectWithRefill(t.obj.obj);
      return;
    }
    const b = t.block!;
    if (!inLot(b.x, b.z) || b.y < MIN_Y) {
      this.flash(b.y < MIN_Y ? 'That’s the bedrock of your lot' : 'Outside your lot');
      return;
    }
    if (!this.stroke) this.beginStroke('Remove blocks');
    this.strokeSet(b.x, b.y, b.z, 0, 0);
    // a plant on top goes with the block
    const above = this.game.world.get(b.x, b.y + 1, b.z);
    if (above && SHAPE[above] === 2) this.strokeSet(b.x, b.y + 1, b.z, 0, 0);
    this.game.audio.play('break', { material: BLOCK_DEFS[b.id].sound });
  }

  private paintMaterial(): { mat: number; glass?: number; name: string } | null {
    const st = useBuildStore.getState();
    const item = st.selectedItem ? catalogItem(st.selectedItem) : null;
    if (item?.placementType === 'block' && item.metaKind !== 'fixed') {
      const v = variantOf(item, st.variantByItem[item.id]);
      if (v?.meta !== undefined) return item.metaKind === 'glass' ? { mat: -1, glass: v.meta, name: v.name } : { mat: v.meta, name: v.name };
    }
    const k = archIndex(st.options.wallMat);
    return k >= 0 ? { mat: k, name: archMaterial(k).name } : null;
  }

  private paintRepeat = 0;

  private updatePaint(dt: number) {
    this.showHover();
    this.hoverMat.color.set('#ffd24a');
    const t = this.target;
    if (!this.primaryHeld()) this.endStroke();
    const go = this.primaryPressed() || (this.primaryHeld() && (this.paintRepeat -= dt) <= 0);
    if (!go || !t) return;
    this.paintRepeat = 0.08;
    const pm = this.paintMaterial();
    if (t.obj) {
      if (!this.primaryPressed()) return;
      const o = t.obj.obj;
      const st = useBuildStore.getState();
      const item = st.selectedItem ? catalogItem(st.selectedItem) : null;
      let variant: string | undefined;
      if (item?.object === o.def.id) variant = variantOf(item, st.variantByItem[item.id])?.objectVariant;
      if (!variant || variant === o.variantId) {
        const vs = o.def.variants ?? [];
        if (vs.length < 2) {
          this.flash(`${o.def.name} has one colour`);
          return;
        }
        const i = vs.findIndex((v) => v.id === o.variantId);
        variant = vs[(i + 1) % vs.length].id;
      }
      const before = toSave(o);
      this.history.run(new ObjectChangeCommand(this, [{ before, after: { ...before, variantId: variant } }], `Paint ${o.def.name}`));
      this.game.audio.play('place', { material: 'cloth', volume: 0.5 });
      return;
    }
    const b = t.block!;
    if (!pm || !inLot(b.x, b.z)) return;
    const kind = archKindOf(b.id);
    let meta = b.meta;
    let id = b.id;
    if (b.id === B.ARCH_GLASS) {
      if (pm.glass === undefined) return;
      meta = pm.glass;
    } else if (kind) {
      if (pm.mat < 0) return;
      if (pm.mat > archMaterialLimit(kind)) {
        if (this.primaryPressed()) this.flash(`${pm.name} can't be used on this shape`);
        return;
      }
      meta = withArchMaterial(kind, b.meta, pm.mat);
    } else if (SHAPE[b.id] === 1 && SOLID[b.id] && pm.mat >= 0) {
      id = B.ARCH_BLOCK;
      meta = archMeta.cube(pm.mat);
    } else return;
    if (id === b.id && meta === b.meta) return;
    if (!this.stroke) this.beginStroke('Paint');
    this.strokeSet(b.x, b.y, b.z, id, meta);
    if (this.primaryPressed()) this.game.audio.play('place', { material: 'cloth', volume: 0.5 });
  }

  /** Eyedropper: select the catalog item + variant matching what's under the cursor. */
  pickMaterial(): void {
    const t = this.target;
    const st = useBuildStore.getState();
    if (!t) return;
    if (t.obj) {
      const o = t.obj.obj;
      const item = BUILD_CATALOG.find((i) => i.object === o.def.id);
      if (!item) return;
      const v = item.variants.find((x) => x.objectVariant === o.variantId);
      this.chooseItem(item.id, v?.id);
      this.flash(`Picked ${o.def.name}${v ? ` · ${v.name}` : ''}`);
      this.game.audio.play('click');
      return;
    }
    const b = t.block!;
    const key = BLOCK_DEFS[b.id].key;
    const kind = archKindOf(b.id);
    const mat = b.id === B.ARCH_GLASS ? b.meta : kind ? archMaterialOf(kind, b.meta) : 0;
    const cands = BUILD_CATALOG.filter((i) => i.block === key);
    let best: BuildCatalogItem | undefined;
    let bestV: string | undefined;
    for (const c of cands) {
      const v = c.variants.find((x) => x.meta === mat) ?? (c.metaKind === 'fixed' ? c.variants[0] : undefined);
      if (!v) continue;
      if (!best || (c.category === 'Structure' && best.category !== 'Structure')) {
        best = c;
        bestV = v.id;
      }
    }
    if (!best) {
      this.flash(`${BLOCK_DEFS[b.id].name} isn't in the catalog`);
      this.game.audio.play('error');
      return;
    }
    this.chooseItem(best.id, bestV);
    if (kind === 'cube' && mat < ARCH_MATERIALS.length) st.setOption('wallMat', ARCH_MATERIALS[mat].key);
    this.flash(`Picked ${best.name} · ${best.variants.find((v) => v.id === bestV)?.name ?? ''}`);
    this.game.audio.play('click');
  }

  // ---------------------------------------------------------------- strokes (drag place / remove / paint / terrain)

  private beginStroke(label: string) {
    this.endStroke();
    this.stroke = new Map();
    this.strokeLabel = label;
  }

  private strokeSet(x: number, y: number, z: number, id: number, meta: number) {
    if (!this.stroke) return;
    const w = this.game.world;
    const k = key3(x, y, z);
    const from: [number, number] = [w.get(x, y, z), w.getMeta(x, y, z)];
    const c = this.stroke.get(k);
    if (c) c.to = [id, meta];
    else this.stroke.set(k, { x, y, z, from, to: [id, meta] });
    this.applyBlocks([{ x, y, z, from, to: [id, meta] }], 'to');
  }

  private strokeApply(changes: BlockChange[]) {
    if (!this.stroke) return;
    for (const ch of changes) {
      const k = key3(ch.x, ch.y, ch.z);
      const c = this.stroke.get(k);
      if (c) c.to = ch.to;
      else this.stroke.set(k, { ...ch });
    }
    this.applyBlocks(changes, 'to');
  }

  private endStroke() {
    const s = this.stroke;
    this.stroke = null;
    if (!s) return;
    const list = [...s.values()].filter((c) => c.from[0] !== c.to[0] || c.from[1] !== c.to[1]);
    if (list.length) this.history.push(new BlockChangeCommand(this, list, list.length > 1 ? `${this.strokeLabel} (${list.length})` : this.strokeLabel));
  }

  // ---------------------------------------------------------------- terrain brushes

  private brushTimer = 0;

  private updateBrush(dt: number, tool: ToolId) {
    const st = useBuildStore.getState();
    const t = this.target;
    const g = t ? this.groundCell(t) : null;
    const size = st.options.brush;
    if (g) {
      this.hover.position.set(g.x + 0.5, g.y + 1.02, g.z + 0.5);
      this.hover.scale.set(size, 0.04, size);
      this.hoverMat.color.set(tool === 'lower' ? '#ffb07a' : tool === 'paint_ground' ? '#a8e67a' : '#fff4c8');
      this.hover.visible = true;
    }
    if (!this.primaryHeld()) {
      this.endStroke();
      return;
    }
    if (!g) return;
    if (this.primaryPressed()) {
      const labels: Record<string, string> = { raise: 'Raise terrain', lower: 'Lower terrain', flatten: 'Flatten terrain', paint_ground: 'Paint ground' };
      this.beginStroke(labels[tool]);
      this.strokeY = g.y;
      this.brushTimer = 0;
    }
    this.brushTimer -= dt;
    if (this.brushTimer > 0 || !this.stroke) return;
    this.brushTimer = tool === 'paint_ground' || tool === 'flatten' ? 0.06 : 0.18;
    const cells = T.brushCells(g.x, g.z, size).filter((c) => inLot(c.x, c.z));
    const ed = new T.Edits(this.reader());
    if (tool === 'raise') T.terrainRaise(ed, cells, g.y);
    else if (tool === 'lower') T.terrainLower(ed, cells, g.y);
    else if (tool === 'flatten') T.terrainFlatten(ed, cells, this.strokeY, [B.GRASS, 0]);
    else {
      const gk = st.options.ground;
      const surf: [number, number] = gk === 'pavers' ? [B.ARCH_BLOCK, archIndex('pavers')] : gk === 'decking' ? [B.ARCH_BLOCK, archIndex('decking')] : [blockId(gk), 0];
      T.paintGround(ed, cells, g.y, surf[0], surf[1]);
    }
    const ch = ed.list().filter((c) => c.y >= MIN_Y);
    if (ch.length) {
      this.strokeApply(ch);
      this.game.audio.play(tool === 'paint_ground' ? 'till' : 'break', { material: 'dirt', volume: 0.5 });
    }
  }

  // ---------------------------------------------------------------- area tools (two clicks)

  private areaCell(tool: ToolId, t: Target): T.P3 | null {
    if (tool === 'measure') {
      if (t.block) return { x: t.block.x, y: t.block.y, z: t.block.z };
      return { x: Math.floor(t.point.x), y: Math.floor(t.point.y), z: Math.floor(t.point.z) };
    }
    if (tool === 'roof') {
      if (!t.block) return null;
      return { x: t.block.x, y: t.block.y, z: t.block.z };
    }
    // stairs: aiming at the underside of an upper floor means "arrive on top of that floor"
    if (tool === 'stairs' && t.block && t.block.ny === -1) return { x: t.block.x, y: t.block.y + 1, z: t.block.z };
    const g = this.groundCell(t);
    if (!g) return null;
    if (tool === 'stairs') return { x: g.x, y: g.y + 1, z: g.z };
    if (tool === 'floor' || tool === 'foundation') {
      // on the lot's ground: replace the surface; on top of walls / structures: build one layer up (upper floors)
      const w = this.game.world;
      if (!T.isTerrain(w.get(g.x, g.y, g.z), w.getMeta(g.x, g.y, g.z))) return { x: g.x, y: g.y + 1, z: g.z };
    }
    return g;
  }

  private updateArea(tool: ToolId) {
    const st = useBuildStore.getState();
    const t = this.target;
    const cell = t ? this.areaCell(tool, t) : null;
    if (cell && !this.pendingA) {
      // first point marker
      this.hover.position.set(cell.x + 0.5, cell.y + (tool === 'stairs' || tool === 'measure' || tool === 'roof' ? 0.5 : 1.02), cell.z + 0.5);
      this.hover.scale.set(1.02, tool === 'stairs' || tool === 'measure' || tool === 'roof' ? 1.02 : 0.04, 1.02);
      this.hoverMat.color.set('#fff4c8');
      this.hover.visible = true;
    }
    if (this.pendingA && cell) this.updateAreaPreview(tool, this.pendingA, cell);
    if (this.primaryPressed() && cell) {
      if (!inLot(cell.x, cell.z)) {
        this.flash('Outside your lot');
        this.game.audio.play('error');
        return;
      }
      if (!this.pendingA) {
        this.pendingA = cell;
        this.pressCell = key3(cell.x, cell.y, cell.z);
        st.set({ pending: true });
        this.game.audio.play('click');
      } else this.commitArea(tool, this.pendingA, cell);
    } else if (!this.primaryHeld() && this.pressCell && this.pendingA && cell) {
      // drag-and-release also works
      const k = key3(cell.x, cell.y, cell.z);
      if (k !== this.pressCell && (cell.x !== this.pendingA.x || cell.z !== this.pendingA.z)) this.commitArea(tool, this.pendingA, cell);
      this.pressCell = null;
    }
  }

  private roofBase(a: T.P3, b: T.P3): number {
    const w = this.game.world;
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
    const y0 = Math.min(a.y, b.y);
    let top = Math.max(a.y, b.y);
    const col = (x: number, z: number) => {
      let y = y0;
      while (y < MAX_Y && SOLID[w.get(x, y + 1, z)] && !isReplaceable(w.get(x, y + 1, z))) y++;
      top = Math.max(top, y);
    };
    for (let x = x0; x <= x1; x++) {
      col(x, z0);
      col(x, z1);
    }
    for (let z = z0; z <= z1; z++) {
      col(x0, z);
      col(x1, z);
    }
    return top + 1;
  }

  private buildAreaEdits(tool: ToolId, a: T.P3, b: T.P3): { ed: T.Edits; label: string; info: string } | null {
    const st = useBuildStore.getState();
    const o = st.options;
    const ed = new T.Edits(this.reader(), 80000);
    const w = Math.abs(b.x - a.x) + 1, d = Math.abs(b.z - a.z) + 1;
    const flatB = { x: b.x, y: a.y, z: b.z };
    const M = (k: string) => Math.max(0, archIndex(k));
    switch (tool) {
      case 'wall':
        T.buildWall(ed, a, b, o.wallHeight, M(o.wallMat));
        return { ed, label: 'Build wall', info: `Wall · ${T.lineCells(a, b).length} long × ${o.wallHeight} high` };
      case 'room':
        if (w < 3 || d < 3) return { ed, label: '', info: 'Rooms need at least 3 × 3' };
        T.buildRoom(ed, a, flatB, { wallHeight: o.wallHeight, wallMat: M(o.wallMat), floorMat: M(o.floorMat), ceiling: o.ceiling, ceilingMat: M(o.ceilingMat) });
        return { ed, label: 'Build room', info: `Room · ${w} × ${d} · walls ${o.wallHeight} high${o.ceiling ? ' · ceiling' : ''}` };
      case 'floor':
        T.fillFloor(ed, a, flatB, M(o.floorMat));
        return { ed, label: 'Lay floor', info: `Floor · ${w} × ${d} = ${w * d} m²` };
      case 'foundation':
        T.buildFoundation(ed, a, flatB, M(o.foundationMat), o.foundationRaise);
        return { ed, label: 'Pour foundation', info: `Foundation · ${w} × ${d}${o.foundationRaise ? ` · raised ${o.foundationRaise}` : ''}` };
      case 'roof': {
        const base = this.roofBase(a, b);
        T.buildRoof(ed, a, b, base, { type: o.roofType, pitch: o.roofPitch, mat: M(o.roofMat), overhang: o.overhang, gableMat: M(o.wallMat) });
        return { ed, label: `Build ${o.roofType} roof`, info: `${cap(o.roofType)} roof · ${w} × ${d}${o.overhang ? ' + overhang' : ''}` };
      }
      case 'pool':
        if (w < 2 || d < 2) return { ed, label: '', info: 'Pools need at least 2 × 2' };
        T.buildPool(ed, a, flatB, { depth: o.poolDepth, tile: M('pool_tile'), coping: M('stone_cut'), steps: o.poolSteps });
        return { ed, label: 'Build pool', info: `Pool · ${w} × ${d} · ${o.poolDepth} deep` };
      case 'water':
        T.buildPond(ed, a, flatB);
        return { ed, label: 'Dig pond', info: `Pond · ${w} × ${d}` };
      case 'farm': {
        if (w < 2 || d < 2) return { ed, label: '', info: 'Fields need at least 2 × 2' };
        const planted = T.buildFarmPlot(ed, a, flatB, { crop: o.farmCrop, stage: o.farmStage, irrigation: o.farmIrrigation, fence: o.farmFence }, LIVE_CROP_BIT);
        const crop = o.farmCrop === 'mixed' ? 'mixed crops' : FARM_CROPS.find((c) => c.key === o.farmCrop)?.name ?? 'crops';
        return { ed, label: 'Plant field', info: `Field · ${w} × ${d} · ${planted.length} ${crop}${o.farmIrrigation ? ' · irrigated' : ''}${o.farmFence ? ' · fenced' : ''}` };
      }
      case 'stairs': {
        const n = T.buildStaircase(ed, a, b, o.stairWidth, M(o.stairMat), o.floatingStairs);
        return { ed, label: 'Build staircase', info: `Stairs · ${n} steps × ${o.stairWidth} wide` };
      }
      default:
        return null;
    }
  }

  private updateAreaPreview(tool: ToolId, a: T.P3, b: T.P3) {
    const st = useBuildStore.getState();
    const key = `${tool}|${key3(a.x, a.y, a.z)}|${key3(b.x, b.y, b.z)}|${JSON.stringify(st.options)}`;
    if (tool === 'measure') {
      const pa = new THREE.Vector3(a.x + 0.5, a.y + 0.5, a.z + 0.5), pb = new THREE.Vector3(b.x + 0.5, b.y + 0.5, b.z + 0.5);
      (this.measureLine.geometry as THREE.BufferGeometry).setFromPoints([pa, pb]);
      this.measureLine.visible = true;
      const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y), dz = Math.abs(b.z - a.z);
      st.set({ measure: `${pa.distanceTo(pb).toFixed(1)} m  ·  ${dx + 1} × ${dy + 1} × ${dz + 1} blocks` });
      return;
    }
    if (tool === 'copy') {
      if (key === this.areaKey) return;
      this.areaKey = key;
      const r = this.copyBounds(a, b);
      this.region.position.set((r.x0 + r.x1 + 1) / 2, (r.y0 + r.y1 + 1) / 2, (r.z0 + r.z1 + 1) / 2);
      this.region.scale.set(r.x1 - r.x0 + 1.04, r.y1 - r.y0 + 1.04, r.z1 - r.z0 + 1.04);
      this.region.visible = true;
      st.set({ measure: `Copy area ${r.x1 - r.x0 + 1} × ${r.y1 - r.y0 + 1} × ${r.z1 - r.z0 + 1}` });
      return;
    }
    if (key === this.areaKey) return;
    this.areaKey = key;
    const res = this.buildAreaEdits(tool, a, b);
    if (!res) return;
    const list = res.ed.list();
    const blocks: [number, number, number, number, number][] = [];
    for (const c of list) if (c.to[0] !== 0) blocks.push([c.x, c.y, c.z, c.to[0], c.to[1]]);
    this.setAreaGhost(blocks);
    this.areaGhost.visible = true;
    st.set({ measure: res.info });
  }

  private commitArea(tool: ToolId, a: T.P3, b: T.P3) {
    const st = useBuildStore.getState();
    if (tool === 'measure') {
      this.flash(st.measure ?? '');
      this.pendingA = null;
      this.pressCell = null;
      st.set({ pending: false });
      this.game.audio.play('click');
      return;
    }
    if (tool === 'copy') {
      this.regionBox = { a, b };
      this.pendingA = null;
      this.pressCell = null;
      st.set({ pending: false });
      this.copyRegion();
      return;
    }
    if (!inLot(b.x, b.z)) {
      this.flash('Outside your lot');
      this.game.audio.play('error');
      return;
    }
    const res = this.buildAreaEdits(tool, a, b);
    this.cancelPending();
    if (!res || !res.label) {
      if (res?.info) this.flash(res.info);
      this.game.audio.play('error');
      return;
    }
    const changes = res.ed.list().filter((c) => inLot(c.x, c.z) && c.y >= MIN_Y && c.y <= MAX_Y + 8);
    if (!changes.length) {
      this.flash('Nothing to build there');
      return;
    }
    // walls never swallow furniture: skip cells that intersect object colliders
    const safe = changes.filter((c) => c.to[0] === 0 || !SOLID[c.to[0]] || !this.objects.query(c.x + 0.05, c.y + 0.05, c.z + 0.05, c.x + 0.95, c.y + 0.95, c.z + 0.95).some((o) => o.def.collision !== 'none'));
    this.history.run(new BlockChangeCommand(this, safe, res.label));
    this.game.audio.play('place', { material: tool === 'pool' || tool === 'water' ? 'stone' : 'stone', volume: 1 });
    if (tool === 'pool' || tool === 'water') this.game.audio.play('water');
    this.flash(`${res.label} ✓ (${safe.length} blocks) — Ctrl+Z to undo`);
    if (tool === 'room' || tool === 'floor' || tool === 'foundation') {
      this.gridY = a.y + (tool === 'foundation' ? st.options.foundationRaise : 0) + 1;
      this.updateGrid();
    }
  }

  // ---------------------------------------------------------------- copy / paste / blueprints

  private copyBounds(a: T.P3, b: T.P3) {
    const w = this.game.world;
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
    const y0 = Math.min(a.y, b.y);
    let y1 = Math.max(a.y, b.y);
    // auto height: include everything built above the footprint
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++)
        for (let y = y1 + 1; y < Math.min(MAX_Y, y0 + 40); y++) if (w.get(x, y, z) !== 0 && SHAPE[w.get(x, y, z)] !== 2) y1 = Math.max(y1, y);
    for (const o of this.objects.query(x0, y0, z0, x1 + 1, y0 + 40, z1 + 1)) {
      const [, ob] = this.objects.bounds(o);
      y1 = Math.max(y1, Math.ceil(ob[1]) - 1);
    }
    return { x0, x1, y0, y1, z0, z1 };
  }

  copyRegion(): void {
    const rb = this.regionBox;
    if (!rb) return;
    const r = this.copyBounds(rb.a, rb.b);
    const cap = T.captureRegion(this.reader(), { x: r.x0, y: r.y0, z: r.z0 }, { x: r.x1, y: r.y1, z: r.z1 });
    const objs = this.objects.query(r.x0 + 0.01, r.y0 + 0.01, r.z0 + 0.01, r.x1 + 0.99, r.y1 + 0.99, r.z1 + 0.99)
      .filter((o) => o.x >= r.x0 && o.x <= r.x1 + 1 && o.z >= r.z0 && o.z <= r.z1 + 1)
      .map((o) => ({ itemId: o.itemId, x: o.x - r.x0, y: o.y - r.y0, z: o.z - r.z0, rotation: o.rotation, variantId: o.variantId, state: o.state ? { ...o.state } : undefined }));
    this.clipboard = { name: 'Copied area', size: cap.size, blocks: cap.blocks, objects: objs };
    this.region.position.set((r.x0 + r.x1 + 1) / 2, (r.y0 + r.y1 + 1) / 2, (r.z0 + r.z1 + 1) / 2);
    this.region.scale.set(r.x1 - r.x0 + 1.04, r.y1 - r.y0 + 1.04, r.z1 - r.z0 + 1.04);
    this.region.visible = true;
    this.regionBox = { a: { x: r.x0, y: r.y0, z: r.z0 }, b: { x: r.x1, y: r.y1, z: r.z1 } };
    useBuildStore.getState().set({ clipboard: { size: cap.size, name: 'Copied area' }, regionSelected: { size: cap.size, blocks: cap.blocks.length }, measure: null });
    this.flash(`Copied ${cap.size.join(' × ')} (${cap.blocks.length} blocks, ${objs.length} objects) — Ctrl+V to paste`);
    this.game.audio.play('chime');
  }

  clearRegion(): void {
    this.regionBox = null;
    this.region.visible = false;
    useBuildStore.getState().set({ regionSelected: null });
  }

  deleteRegion(): void {
    const rb = this.regionBox;
    if (!rb) return;
    const doIt = () => {
      const ed = new T.Edits(this.reader(), 400000);
      const x0 = Math.min(rb.a.x, rb.b.x), x1 = Math.max(rb.a.x, rb.b.x), z0 = Math.min(rb.a.z, rb.b.z), z1 = Math.max(rb.a.z, rb.b.z);
      const y0 = Math.min(rb.a.y, rb.b.y), y1 = Math.max(rb.a.y, rb.b.y);
      const w = this.game.world;
      for (let y = y0 + 1; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (w.get(x, y, z) !== 0) ed.set(x, y, z, 0, 0);
      const objs = this.objects.query(x0 + 0.01, y0 + 0.5, z0 + 0.01, x1 + 0.99, y1 + 1, z1 + 0.99);
      const parts: BuildCommand[] = [];
      if (objs.length) parts.push(new ObjectChangeCommand(this, objs.map((o) => ({ before: toSave(o), after: null })), 'Remove objects'));
      const ch = ed.list();
      if (ch.length) parts.push(new BlockChangeCommand(this, ch, 'Remove blocks'));
      if (parts.length) this.history.run(new CompositeCommand(parts, `Delete area (${ch.length} blocks, ${objs.length} objects)`));
      this.clearRegion();
      this.game.audio.play('break', { material: 'stone' });
    };
    const count = (Math.abs(rb.a.x - rb.b.x) + 1) * (Math.abs(rb.a.z - rb.b.z) + 1) * Math.abs(rb.a.y - rb.b.y);
    if (count > HUGE_DELETE) this.confirm(`Delete everything in this ${Math.abs(rb.a.x - rb.b.x) + 1} × ${Math.abs(rb.a.z - rb.b.z) + 1} area (above the floor)? You can undo with Ctrl+Z.`, doIt);
    else doIt();
  }

  confirm(text: string, onYes: () => void): void {
    useBuildStore.getState().set({ confirm: { text, onYes } });
    this.game.openOverlay('buildDialog');
  }

  startPaste(): void {
    if (!this.clipboard) {
      this.flash('Nothing copied yet — use the Copy tool (Ctrl+C) first.');
      this.game.audio.play('error');
      return;
    }
    this.beginPaste(this.clipboard);
  }

  beginPaste(c: Clip): void {
    const st = useBuildStore.getState();
    this.cancelPending();
    this.select(null);
    this.paste = c;
    this.pasteSteps = 0;
    this.pasteGhostKey = '';
    st.set({ pasting: true, pasteName: c.name, rotationDeg: 0 });
    this.flash(`Placing ${c.name} — R to rotate, click to confirm, right-click / Esc to cancel`);
  }

  placeBlueprint(bp: BlueprintRecord): void {
    // remap block ids through the saved keys (safe if the registry ever grows)
    const idMap = bp.blockKeys.map((k) => {
      const i = BLOCK_DEFS.findIndex((d) => d.key === k);
      return i < 0 ? 0 : i;
    });
    const blocks = bp.blocks.map(([x, y, z, id, m]) => [x, y, z, idMap[id] ?? 0, m] as [number, number, number, number, number]).filter((q) => q[3] !== 0);
    this.beginPaste({ name: bp.name, size: bp.size, blocks, objects: bp.objects.filter((o) => !!objectDef(o.itemId)) });
  }

  async saveRegionAsBlueprint(name: string): Promise<void> {
    if (!this.clipboard) {
      if (this.regionBox) this.copyRegion();
      if (!this.clipboard) return;
    }
    const c = this.clipboard!;
    try {
      const rec = await saveBlueprint({ name: name.trim() || 'My Blueprint', size: c.size, blocks: c.blocks, objects: c.objects, blockKeys: BLOCK_DEFS.map((d) => d.key) });
      const st = useBuildStore.getState();
      st.set({ blueprints: [rec, ...st.blueprints.filter((b) => b.id !== rec.id)] });
      this.game.notify(`Blueprint "${rec.name}" saved — find it in the catalog under Presets.`, '📐');
    } catch (e) {
      console.error('[BuildMode] blueprint save failed', e);
      this.game.notify('Could not save the blueprint.', '⚠️');
    }
  }

  private pasteOrigin(t: Target): T.P3 | null {
    const g = this.groundCell(t);
    if (!g || !this.paste) return null;
    const [sx, , sz] = T.rotatedSize(this.paste.size, this.pasteSteps);
    return { x: g.x - Math.floor(sx / 2), y: g.y, z: g.z - Math.floor(sz / 2) };
  }

  private updatePaste(_dt: number) {
    const c = this.paste;
    const t = this.target;
    if (!c) return;
    const origin = t ? this.pasteOrigin(t) : null;
    if (!origin) {
      this.pasteGhost.visible = false;
      return;
    }
    this.setPasteGhost(c);
    this.pasteGhost.position.set(origin.x, origin.y, origin.z);
    this.pasteGhost.visible = true;
    const [sx, , sz] = T.rotatedSize(c.size, this.pasteSteps);
    const reason = this.pastePlacement.validate(c, origin, this.pasteSteps);
    const valid = reason === null;
    this.setGhostTint(this.pasteGhost, valid);
    useBuildStore.getState().set({ measure: `${c.name} · ${sx} × ${sz}${reason ? ` · ${reason}` : ''}` });
    if (this.primaryPressed()) {
      if (!valid) {
        this.flash(reason!);
        this.game.audio.play('error');
        return;
      }
      this.commitPaste(c, origin);
    }
  }

  private commitPaste(c: Clip, origin: T.P3) {
    // Recheck at the actual click, including changes received since the preview was shown.
    const reason = this.pastePlacement.validate(c, origin, this.pasteSteps, true);
    if (reason) {
      this.flash(reason);
      this.game.audio.play('error');
      return;
    }
    const ed = new T.Edits(this.reader(), 400000);
    T.pasteBlocks(ed, { size: c.size, blocks: c.blocks }, origin, this.pasteSteps);
    // clear furniture-sized space above the pasted floor (plants / grass tufts)
    const blocks = ed.list();
    const objs: { before: null; after: BuildObjectSave }[] = [];
    for (const o of c.objects) {
      const [rx, rz] = T.rotateObjectPos(o.x, o.z, c.size[0], c.size[2], this.pasteSteps);
      const id = this.objects.nextId++;
      objs.push({ before: null, after: { id, itemId: o.itemId, x: round4(origin.x + rx), y: round4(origin.y + o.y), z: round4(origin.z + rz), rotation: normAngle(o.rotation - this.pasteSteps * (Math.PI / 2)), variantId: o.variantId, state: o.state ? { ...o.state } : undefined } });
    }
    const parts: BuildCommand[] = [];
    parts.push(new BlockChangeCommand(this, blocks, 'Paste blocks'));
    if (objs.length) parts.push(new ObjectChangeCommand(this, objs, 'Paste objects'));
    this.history.run(new CompositeCommand(parts, `Place ${c.name}`));
    this.game.audio.play('chime');
    this.flash(`${c.name} placed ✓ — Ctrl+Z to undo`);
    const st = useBuildStore.getState();
    const preset = st.selectedItem && catalogItem(st.selectedItem)?.placementType === 'preset';
    if (preset) {
      this.paste = null;
      st.set({ pasting: false, pasteName: null });
      this.setPasteGhost(null);
    }
  }

  // ---------------------------------------------------------------- interaction (doors, lights, TV, taps, labels)

  /** Crop or berry bush under the aim (Build Home farming). */
  private aimedCrop(): { x: number; y: number; z: number; id: number; ripe: boolean; stage: number; stages: number; bush: boolean } | null {
    const b = this.target?.block;
    if (!b || this.target?.obj) return null;
    const def = BLOCK_DEFS[b.id];
    if (def?.growth) {
      const stage = (b.meta >> 3) & 7;
      return { x: b.x, y: b.y, z: b.z, id: b.id, ripe: stage >= def.growth.stages - 1, stage, stages: def.growth.stages, bush: false };
    }
    if (b.id === B.BERRY_BUSH) return { x: b.x, y: b.y, z: b.z, id: b.id, ripe: ((b.meta >> 3) & 1) === 1, stage: 0, stages: 1, bush: true };
    return null;
  }

  /** Harvest a ripe crop / berry bush: a little burst of produce, then it replants itself and grows again. */
  harvest(): boolean {
    const c = this.aimedCrop();
    if (!c) return false;
    const g = this.game;
    const def = BLOCK_DEFS[c.id];
    if (!c.ripe) {
      this.flash(c.bush ? `${def.name} · berries are regrowing` : `${def.name} · growing (${c.stage + 1}/${c.stages})${(g.world.getMeta(c.x, c.y, c.z) & LIVE_CROP_BIT) ? '' : ' — use "Growing 🌱" crops to watch them grow'}`);
      return true;
    }
    const now = g.growthNow();
    let item: string, n: number;
    if (c.bush) {
      g.farming.harvestBush(g.world, c.x, c.y, c.z, now);
      g.farming.bushes.set(`${c.x},${c.y},${c.z}`, now + 240);
      item = 'bramble_berries';
      n = 2 + Math.floor(Math.random() * 3);
    } else {
      const gr = def.growth!;
      g.world.set(c.x, c.y, c.z, c.id, LIVE_CROP_BIT);
      g.farming.crops.set(`${c.x},${c.y},${c.z}`, { planted: now });
      item = gr.harvest;
      n = gr.harvestCount[0] + Math.floor(Math.random() * (gr.harvestCount[1] - gr.harvestCount[0] + 1));
    }
    const col = g.assets.tileColors[TILE_TOP[c.id] + (c.bush ? 0 : c.stages - 1)] ?? [0.8, 0.7, 0.3];
    g.particles.emit('chip', c.x + 0.5, c.y + 0.6, c.z + 0.5, 12, col, { spread: 0.5, speed: 2.4, size: 0.08, life: 0.7 });
    g.particles.emit('sparkle', c.x + 0.5, c.y + 1, c.z + 0.5, 6, [1, 0.9, 0.5], { spread: 0.4, speed: 1.2, size: 0.07, life: 0.6, glow: true });
    g.audio.play('break', { material: 'plant', pos: new THREE.Vector3(c.x + 0.5, c.y + 0.5, c.z + 0.5) });
    g.audio.play('pickup');
    const st = useBuildStore.getState();
    const total = st.harvested + n;
    st.set({ harvested: total });
    this.flash(`+${n} ${itemDef(item).name} · ${total} harvested 🧺`);
    this.saveDebounce = 5;
    return true;
  }

  interact(id?: number): void {
    if (id === undefined && !this.target?.obj && this.harvest()) return;
    const o = id !== undefined ? this.objects.get(id) : this.target?.obj?.obj;
    if (!o) { this.game.rest.interactNearby(); return; }
    const def = o.def;
    if (!def.interaction) return;
    const s = { ...(o.state ?? {}) };
    switch (def.interaction) {
      case 'bed':
      case 'sit':
        this.game.rest.useObject(o);
        return;
      case 'door':
      case 'curtain':
        s.open = !s.open;
        this.game.audio.play(def.interaction === 'door' ? 'door' : 'close', { pos: new THREE.Vector3(o.x, o.y + 1, o.z) });
        break;
      case 'light':
      case 'tv':
      case 'appliance':
      case 'shower':
        s.on = !s.on;
        this.game.audio.play(def.interaction === 'appliance' || def.interaction === 'shower' ? 'water' : 'click', { pos: new THREE.Vector3(o.x, o.y + 1, o.z) });
        break;
      case 'switch': {
        // toggles every light in the room around the switch
        const lights = this.objects.query(o.x - 8, o.y - 3, o.z - 8, o.x + 8, o.y + 4, o.z + 8).filter((x) => x.def.interaction === 'light');
        const on = !lights.some((l) => l.state?.on);
        for (const l of lights) this.objects.patch(l.id, { state: { ...(l.state ?? {}), on } });
        this.game.audio.play('click');
        this.flash(on ? `Lights on (${lights.length})` : 'Lights off');
        this.saveDebounce = 5;
        return;
      }
      case 'label':
        useBuildStore.getState().set({ labelEdit: { id: o.id, text: o.state?.text ?? '' } });
        this.game.openOverlay('buildDialog');
        return;
    }
    this.objects.patch(o.id, { state: s });
    this.saveDebounce = 5;
  }

  // ---------------------------------------------------------------- lights (budget)

  private updateLights(dt: number) {
    this.lightTimer -= dt;
    if (this.lightTimer > 0) return;
    this.lightTimer = 0.25;
    const f = this.focus();
    const cam = this.game.camera.position;
    const cands: { x: number; y: number; z: number; r: number; c: THREE.Color; score: number }[] = [];
    let total = 0;
    for (const o of this.objects.objects.values()) {
      const L = o.def.light;
      if (!L || !o.state?.on) continue;
      total++;
      const c = Math.cos(o.rotation), s = Math.sin(o.rotation);
      const [ox, oy, oz] = L.offset;
      const x = o.x + ox * c + oz * s, y = o.y + oy, z = o.z - ox * s + oz * c;
      const d2 = (x - f.x) ** 2 + (y - f.y) ** 2 + (z - f.z) ** 2;
      const dc = (x - cam.x) ** 2 + (z - cam.z) ** 2;
      if (d2 > 60 * 60 && dc > 60 * 60) continue;
      cands.push({ x, y, z, r: L.range, c: new THREE.Color(L.color).multiplyScalar(L.intensity), score: L.intensity * L.range / (1 + Math.min(d2, dc) / 64) });
    }
    cands.sort((a, b) => b.score - a.score);
    const u = this.game.assets.uniforms;
    const day = this.game.clock.daylight;
    for (let i = 0; i < MAX_POINT_LIGHTS; i++) {
      const L = cands[i];
      if (!L) {
        u.uPointPos.value[i].set(0, -1000, 0, 0);
        u.uPointCol.value[i].setRGB(0, 0, 0);
        continue;
      }
      u.uPointPos.value[i].set(L.x, L.y, L.z, L.r);
      u.uPointCol.value[i].copy(L.c).multiplyScalar(0.6 + 0.9 * (1 - day));
    }
    const st = useBuildStore.getState();
    const active = Math.min(MAX_POINT_LIGHTS, cands.length);
    if (st.lights.active !== active || st.lights.total !== total) st.set({ lights: { active, total } });
  }

  // ---------------------------------------------------------------- saving

  private autosave(dt: number, simulate: boolean) {
    if (!simulate) return;
    if (this.saveDebounce > 0) {
      this.saveDebounce -= dt;
      if (this.saveDebounce <= 0) {
        this.saveDebounce = -1;
        void this.game.saveNow('quiet');
      }
    }
    this.saveTimer -= dt;
    if (this.saveTimer <= 0) {
      this.saveTimer = 60;
      void this.game.saveNow('quiet');
    }
  }

  // ---------------------------------------------------------------- status line

  private updateStatus() {
    const st = useBuildStore.getState();
    if (this.statusHold > 0) {
      this.statusHold -= 1 / 60;
      return;
    }
    let s = '';
    const tool = st.tool;
    const io = this.target?.obj?.obj;
    const touch = this.game.input.touch.active;
    const crop = (tool === 'place' || st.walkthrough) && !st.pasting ? this.aimedCrop() : null;
    if (crop) {
      const name = BLOCK_DEFS[crop.id].name;
      s = crop.ripe ? `${name} · ripe! ${touch ? 'Tap' : 'Click'} to harvest` : crop.bush ? `${name} · regrowing` : `${name} · growing ${crop.stage + 1}/${crop.stages}`;
    } else if (io?.def.interaction && io.def.interaction !== 'label' && (tool === 'place' || tool === 'select') && !st.pasting) {
      const open = io.def.interaction === 'door' || io.def.interaction === 'curtain';
      const verb = io.def.interaction === 'bed' ? 'Sleep' : io.def.interaction === 'sit' ? 'Sit' : open ? (io.state?.open ? 'Close' : 'Open') : io.state?.on ? 'Turn off' : 'Turn on';
      s = `${io.def.name} · ${open ? (touch ? 'tap' : 'click') : touch ? '✋' : 'F / right-click'} to ${verb.toLowerCase()}`;
    } else if (st.pasting) s = `Placing ${st.pasteName ?? ''} · R rotate · click to confirm · right-click cancel`;
    else if (AREA_TOOLS.includes(tool)) {
      const name = catalogItem(`tool:${tool}`)?.name ?? tool;
      s = this.pendingA ? `${st.measure ?? name} · click the second point` : `${name} · click the first point`;
    } else if (tool === 'place') {
      const item = st.selectedItem ? catalogItem(st.selectedItem) : null;
      s = item ? `${item.name}${item.variants.length > 1 ? ` · ${variantOf(item, st.variantByItem[item.id])?.name ?? ''}` : ''}` : 'Press B to open the Build Catalog';
    } else if (tool === 'select') s = this.selectedId !== null ? 'Drag to move · R rotate · Delete remove · Ctrl+D duplicate' : 'Click an object to select it';
    else if (tool === 'remove') s = 'Remove · click (hold to keep removing)';
    else if (tool === 'paint') s = `Paint · ${this.paintMaterial()?.name ?? ''}`;
    else if (tool === 'pick') s = 'Pick material · click anything';
    else if (BRUSH_TOOLS.includes(tool)) s = `${catalogItem(`tool:${tool}`)?.name ?? tool} · brush ${st.options.brush} · hold to apply`;
    if (touch) {
      s = s
        .replace('Press B to open the Build Catalog', 'Tap 📚 to open the Build Catalog')
        .replace(' · right-click cancel', ' · ↶ cancels')
        .replace('Drag to move · R rotate · Delete remove · Ctrl+D duplicate', 'Use the panel to move, rotate or delete')
        .replace(/R rotate/g, '⟳ rotate')
        .replace(/Click/g, 'Tap')
        .replace(/click/g, 'tap');
    }
    if (s !== this.lastStatus) {
      this.lastStatus = s;
      st.set({ status: s });
    }
  }

  // ---------------------------------------------------------------- design challenge

  /** Progress for each goal of the active design challenge (counts are capped at the goal). */
  challengeProgress(id: string): { label: string; have: number; need: number }[] {
    const c = challengeById(id);
    if (!c) return [];
    let water = -1;
    return c.goals.map((g) => {
      let have = 0;
      if (g.water) {
        if (water < 0) water = this.countLotWater();
        have = water;
      } else {
        for (const o of this.objects.objects.values()) {
          if (g.items ? g.items.includes(o.def.id) : g.tag ? o.def.tags.includes(g.tag) || (g.tag === 'light' && !!o.def.light) : false) have++;
        }
      }
      return { label: g.label, have: Math.min(have, g.count), need: g.count };
    });
  }

  private countLotWater(): number {
    const w = this.game.world;
    let n = 0;
    // pools live just below the lot surface
    for (const c of w.chunks.values()) {
      const x0 = c.cx * CHUNK_SIZE, z0 = c.cz * CHUNK_SIZE;
      if (!inLot(x0, z0) && !inLot(x0 + CHUNK_SIZE - 1, z0 + CHUNK_SIZE - 1)) continue;
      for (let y = PLOT_Y - 5; y <= PLOT_Y + 2; y++)
        for (let z = 0; z < CHUNK_SIZE; z++)
          for (let x = 0; x < CHUNK_SIZE; x++) if (c.blocks[localIndex(x, y, z)] === B.WATER) n++;
    }
    return n;
  }

  // ---------------------------------------------------------------- ghost meshes

  private setBlockGhost(spec: [number, number] | null) {
    const key = spec ? `${spec[0]}:${spec[1]}` : '';
    if (key === this.blockGhostKey) return;
    this.blockGhostKey = key;
    disposeChildren(this.blockGhost);
    if (!spec) return;
    const { main, glass } = previewGeometry([[0, 0, 0, spec[0], spec[1]]]);
    for (const g of [main, glass]) if (g) this.blockGhost.add(new THREE.Mesh(g, this.gmats.valid));
    this.blockGhost.userData.valid = true;
  }

  private setGhostTint(group: THREE.Object3D, valid: boolean) {
    if (group.userData.valid === valid) return;
    group.userData.valid = valid;
    group.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.userData.obj) m.material = valid ? this.omats.ghostValid : this.omats.ghostInvalid;
      else m.material = valid ? this.gmats.valid : this.gmats.invalid;
    });
  }

  private setObjGhost(def: ObjectDef | null, variant: string) {
    const key = def ? `${def.id}|${variant}` : '';
    if (key === this.objGhostKey && this.objGhost) return;
    this.objGhostKey = key;
    if (this.objGhost) {
      this.group.remove(this.objGhost);
      this.objGhost = null;
    }
    if (!def) return;
    const g = objectPreview(def, variant, { solid: this.omats.ghostValid, glass: this.omats.ghostValid, emissive: this.omats.ghostValid });
    g.traverse((c) => {
      c.userData.obj = true;
      (c as THREE.Mesh).renderOrder = 7;
    });
    this.objGhost = g;
    this.objGhostValid = true;
    this.group.add(g);
  }

  private setObjGhostValid(valid: boolean) {
    if (!this.objGhost || this.objGhostValid === valid) return;
    this.objGhostValid = valid;
    const m = valid ? this.omats.ghostValid : this.omats.ghostInvalid;
    this.objGhost.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (mesh.isMesh) mesh.material = m;
    });
  }

  private setAreaGhost(blocks: [number, number, number, number, number][]) {
    disposeChildren(this.areaGhost);
    this.areaGhost.userData.valid = true;
    if (!blocks.length) return;
    const { main, glass } = previewGeometry(blocks, 20000);
    for (const g of [main, glass]) if (g) this.areaGhost.add(new THREE.Mesh(g, this.gmats.valid));
  }

  private setPasteGhost(c: Clip | null) {
    const key = c ? `${c.name}|${c.blocks.length}|${c.size.join(',')}|${this.pasteSteps}` : '';
    if (key === this.pasteGhostKey) return;
    this.pasteGhostKey = key;
    disposeChildren(this.pasteGhost);
    this.pasteGhost.userData.valid = true;
    if (!c) return;
    const blocks: [number, number, number, number, number][] = c.blocks.map(([x, y, z, id, m]) => {
      const [rx, rz] = T.rotateCell(x, z, c.size[0], c.size[2], this.pasteSteps);
      return [rx, y, rz, id, T.rotateMeta(id, m, this.pasteSteps)];
    });
    const { main, glass } = previewGeometry(blocks, 20000);
    for (const g of [main, glass]) if (g) this.pasteGhost.add(new THREE.Mesh(g, this.gmats.valid));
    for (const o of c.objects.slice(0, 120)) {
      const def = objectDef(o.itemId);
      if (!def) continue;
      const [rx, rz] = T.rotateObjectPos(o.x, o.z, c.size[0], c.size[2], this.pasteSteps);
      const g = objectPreview(def, o.variantId, { solid: this.omats.ghostValid, glass: this.omats.ghostValid, emissive: this.omats.ghostValid });
      g.position.set(rx, o.y, rz);
      g.rotation.y = o.rotation - this.pasteSteps * (Math.PI / 2);
      g.traverse((ch) => (ch.userData.obj = true));
      this.pasteGhost.add(g);
    }
  }
}

// ---------------------------------------------------------------- helpers

function normAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r <= -Math.PI) r += Math.PI * 2;
  return Math.round(r * 1e6) / 1e6;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function cap(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}

function OPAQUE_WALL(id: number): boolean {
  return SHAPE[id] === 1;
}

/** Pairs of objects that may overlap (rugs under furniture, curtains over windows, labels). */
function overlapAllowed(a: ObjectDef, b: ObjectDef): boolean {
  const thin = (d: ObjectDef) => d.tags.includes('rug') || d.interaction === 'label' || d.id === 'led_strip' || d.id === 'flower_bed';
  if (thin(a) || thin(b)) return true;
  if ((a.id === 'curtains' && b.placement === 'opening') || (b.id === 'curtains' && a.placement === 'opening')) return true;
  if ((a.placement === 'wall' && b.placement === 'opening') || (b.placement === 'wall' && a.placement === 'opening')) return a.collision === 'none' || b.collision === 'none' || a.id === 'curtains' || b.id === 'curtains';
  return false;
}

function placementHint(def: ObjectDef): string {
  switch (def.placement) {
    case 'wall': return `${def.name}: aim at a wall`;
    case 'ceiling': return `${def.name}: aim at a ceiling`;
    case 'opening': return `${def.name}: aim at a wall (the opening is cut for you)`;
    case 'skylight': return `${def.name}: aim at a roof or ceiling block`;
    case 'surface': return `${def.name}: aim at a table, counter or the floor`;
    default: return `${def.name}: aim at the floor`;
  }
}

function disposeChildren(g: THREE.Group) {
  for (const c of [...g.children]) {
    g.remove(c);
    const m = c as THREE.Mesh;
    if (m.isMesh && !m.userData.obj) m.geometry.dispose();
  }
}
