import { create } from 'zustand';
import type { BuildCategory, ToolId } from '../data/buildCatalog';
import type { RoofType } from '../game/build/BuildTools';
import type { BlueprintRecord } from '../persistence/types';

/**
 * UI state for Build Home (catalog, active tool + options, selection, hints).
 * The engine (BuildMode) reads and writes this; React renders it.
 */
export type CatalogView = BuildCategory | 'All' | 'Favorites' | 'Recent' | 'Suggested';

export interface ToolOptions {
  wallHeight: number;
  ceiling: boolean;
  roofType: RoofType;
  roofPitch: 'steep' | 'low';
  overhang: 0 | 1;
  poolDepth: number;
  poolSteps: boolean;
  brush: 1 | 3 | 5 | 9;
  stairWidth: number;
  foundationRaise: number;
  /** Paint Ground surface: natural block key or 'pavers' / 'decking'. */
  ground: 'grass' | 'dirt' | 'sand' | 'gravel' | 'stone' | 'pavers' | 'decking';
  floatingStairs: boolean;
  /** Materials used by the area tools (architecture material keys). */
  wallMat: string;
  floorMat: string;
  roofMat: string;
  ceilingMat: string;
  foundationMat: string;
  stairMat: string;
  /** Farm Plot tool: crop block key (or 'mixed' rows), growth stage (0-3) or 'grow' (plant seedlings that grow live). */
  farmCrop: string;
  farmStage: 0 | 1 | 2 | 3 | 'grow';
  /** Water channel between every few rows (keeps the soil watered). */
  farmIrrigation: boolean;
  /** Picket fence around the plot (with a gate). */
  farmFence: boolean;
}

export interface SelectionInfo {
  id: number;
  name: string;
  itemId: string;
  variant: string;
  variants: { id: string; name: string; swatch: string }[];
  interactive: boolean;
  freeRotate: boolean;
}

export type CameraMode = 'player' | 'build';

interface BuildState {
  active: boolean;
  catalogOpen: boolean;
  view: CatalogView;
  query: string;
  selectedItem: string | null;
  variantByItem: Record<string, string>;
  tool: ToolId;
  options: ToolOptions;
  favorites: string[];
  recent: string[];
  hintsCollapsed: boolean;
  grid: boolean;
  camera: CameraMode;
  cursorMode: boolean;
  walkthrough: boolean;
  photo: boolean;
  selection: SelectionInfo | null;
  /** Live tool feedback ("Wall · 12 blocks · 3 high"). */
  status: string;
  /** Second click pending for two-point tools. */
  pending: boolean;
  measure: string | null;
  undoLabel: string | null;
  redoLabel: string | null;
  theme: string | null;
  tutorialOpen: boolean;
  clipboard: { size: [number, number, number]; name: string } | null;
  pasting: boolean;
  regionSelected: { size: [number, number, number]; blocks: number } | null;
  blueprints: BlueprintRecord[];
  labelEdit: { id: number; text: string } | null;
  blueprintNaming: boolean;
  confirm: { text: string; onYes: () => void } | null;
  rotationDeg: number;
  dirty: boolean;
  /** Bumped when catalog icons finish rendering. */
  iconsVersion: number;
  lights: { active: number; total: number };
  lastSaved: number;
  /** Name of what is being pasted (clipboard / blueprint / preset). */
  pasteName: string | null;
  /** Current floor level shown to the player (0 = ground). */
  level: number;
  /** Locked time of day (fraction 0..1) and whether it is frozen. */
  timeLocked: boolean;
  dayFraction: number;
  weather: 'clear' | 'cloudy' | 'rain';
  labelsVisible: boolean;
  touchAction: 'place' | 'remove' | null;
  /** Active optional design challenge id. */
  challenge: string | null;
  /** Player flight (Build Home): mirrors Player.flying for the HUD / touch buttons. */
  flying: boolean;
  /** Crops harvested in this project (just for fun). */
  harvested: number;

  set(p: Partial<BuildState>): void;
  setOption<K extends keyof ToolOptions>(k: K, v: ToolOptions[K]): void;
  selectItem(id: string | null, variant?: string): void;
  toggleFavorite(id: string): void;
  pushRecent(id: string): void;
  reset(): void;
}

const LS_KEY = 'wildblocks.build.v1';

function loadPrefs(): { favorites: string[]; recent: string[]; tutorialSeen: boolean; hintsCollapsed: boolean } {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { favorites: p.favorites ?? [], recent: p.recent ?? [], tutorialSeen: !!p.tutorialSeen, hintsCollapsed: !!p.hintsCollapsed };
    }
  } catch {
    /* storage unavailable */
  }
  return { favorites: [], recent: [], tutorialSeen: false, hintsCollapsed: false };
}

function savePrefs(s: { favorites: string[]; recent: string[]; hintsCollapsed: boolean }, tutorialSeen?: boolean) {
  try {
    const prev = loadPrefs();
    localStorage.setItem(LS_KEY, JSON.stringify({ favorites: s.favorites, recent: s.recent, hintsCollapsed: s.hintsCollapsed, tutorialSeen: tutorialSeen ?? prev.tutorialSeen }));
  } catch {
    /* ignore */
  }
}

export function tutorialSeen(): boolean {
  return loadPrefs().tutorialSeen;
}

export function markTutorialSeen(seen = true): void {
  const s = useBuildStore.getState();
  savePrefs(s, seen);
}

export const DEFAULT_OPTIONS: ToolOptions = {
  wallHeight: 3, ceiling: false, roofType: 'gable', roofPitch: 'steep', overhang: 1, poolDepth: 2, poolSteps: true, brush: 3, stairWidth: 1,
  foundationRaise: 0, ground: 'pavers', floatingStairs: false,
  wallMat: 'plaster_white', floorMat: 'floor_oak', roofMat: 'shingles_dark', ceilingMat: 'plaster_white', foundationMat: 'concrete_gray', stairMat: 'floor_oak',
  farmCrop: 'crop_wheat', farmStage: 'grow', farmIrrigation: true, farmFence: false,
};

const prefs = loadPrefs();

export const useBuildStore = create<BuildState>((set, get) => ({
  active: false,
  catalogOpen: false,
  view: 'Structure',
  query: '',
  selectedItem: null,
  variantByItem: {},
  tool: 'place',
  options: { ...DEFAULT_OPTIONS },
  favorites: prefs.favorites,
  recent: prefs.recent,
  hintsCollapsed: prefs.hintsCollapsed,
  grid: true,
  camera: 'player',
  cursorMode: false,
  walkthrough: false,
  photo: false,
  selection: null,
  status: '',
  pending: false,
  measure: null,
  undoLabel: null,
  redoLabel: null,
  theme: null,
  tutorialOpen: false,
  clipboard: null,
  pasting: false,
  regionSelected: null,
  blueprints: [],
  labelEdit: null,
  blueprintNaming: false,
  confirm: null,
  rotationDeg: 0,
  dirty: false,
  iconsVersion: 0,
  lights: { active: 0, total: 0 },
  lastSaved: 0,
  pasteName: null,
  level: 0,
  timeLocked: true,
  dayFraction: 0.45,
  weather: 'clear',
  labelsVisible: true,
  touchAction: null,
  challenge: null,
  flying: false,
  harvested: 0,

  set(p) {
    set(p);
    if ('hintsCollapsed' in p) savePrefs(get());
  },
  setOption(k, v) {
    set({ options: { ...get().options, [k]: v } });
  },
  selectItem(id, variant) {
    const vb = { ...get().variantByItem };
    if (id && variant) vb[id] = variant;
    set({ selectedItem: id, variantByItem: vb });
  },
  toggleFavorite(id) {
    const f = get().favorites;
    set({ favorites: f.includes(id) ? f.filter((x) => x !== id) : [...f, id] });
    savePrefs(get());
  },
  pushRecent(id) {
    const r = [id, ...get().recent.filter((x) => x !== id)].slice(0, 18);
    set({ recent: r });
    savePrefs(get());
  },
  reset() {
    set({
      active: false, catalogOpen: false, selection: null, status: '', pending: false, measure: null, camera: 'player', cursorMode: false,
      walkthrough: false, photo: false, tool: 'place', pasting: false, regionSelected: null, labelEdit: null, blueprintNaming: false, confirm: null,
      tutorialOpen: false, dirty: false, pasteName: null, clipboard: null, selectedItem: null, touchAction: null, undoLabel: null, redoLabel: null,
      flying: false, harvested: 0,
    });
  },
}));
