import type { CreatureKind } from '../data/creatures';
import type { Difficulty } from '../stores/gameStore';
import type { InventorySnapshot } from '../stores/inventoryStore';
import type { ProgressSnapshot } from '../stores/worldStore';
import type { Buff } from '../stores/playerStore';
import type { ItemStack, Slots } from '../game/systems/InventoryLogic';
import type { WeatherKind } from '../game/systems/EnvironmentSystem';

/** Bump when the persisted shape changes, and add a migration in migrations/. */
export const SAVE_VERSION = 2;

/** Two kinds of worlds: survival exploration and the Build Home creative sandbox. */
export type GameMode = 'survival' | 'build' | 'pvp' | 'deathmatch';

export type PlotType = 'meadow' | 'coastal' | 'forest' | 'mountain' | 'lakeside' | 'desert' | 'studio';
export type BuildTimeOfDay = 'morning' | 'day' | 'golden' | 'night';
export type BuildWeather = 'clear' | 'cloudy' | 'rain';

/** Build Home project settings (stored on the world meta). */
export interface BuildSettings {
  plot: PlotType;
  timeOfDay: BuildTimeOfDay;
  /** Time stands still unless unlocked. */
  timeLocked: boolean;
  weather: BuildWeather;
  /** Suggested style palette (filters the catalog's "Suggested" view). */
  theme?: string;
}

/** A placed Build Home object (never raw three.js data). */
export interface BuildObjectSave {
  id: number;
  itemId: string;
  x: number;
  y: number;
  z: number;
  /** Yaw in radians. */
  rotation: number;
  variantId: string;
  state?: { open?: boolean; on?: boolean; text?: string };
}

export interface BuildStateSave {
  objects: BuildObjectSave[];
  nextId: number;
  /** Free build camera pose when the project was saved (optional). */
  camera?: { x: number; y: number; z: number; yaw: number; pitch: number };
  favorites?: string[];
  recent?: string[];
}

export interface WorldMeta {
  id: string;
  name: string;
  /** Numeric seed used by the generator. */
  seed: number;
  /** What the player typed (or the generated seed word). */
  seedText: string;
  difficulty: Difficulty;
  peacefulCreatures: boolean;
  createdAt: number;
  lastPlayed: number;
  playTime: number;
  thumbnail?: string;
  saveVersion: number;
  /** survival (default) or build (Build Home project). */
  mode: GameMode;
  build?: BuildSettings;
  /** World generation: 2 = big caves, cave entrances & ravines (new worlds since v1.2). Missing = 1. */
  caves?: number;
  /** PvP: flat arena type (a Build Home lot with scenery); missing = the main wild world. */
  arena?: PlotType;
  /**
   * Build Home opened to friends: everyone builds on it together with the full Build Home tools.
   * 'host' = your own project (keeps saving), 'guest' = a friend's lot (never saved). Not stored.
   */
  coop?: 'host' | 'guest';
}

export interface PlayerSave {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vitality: number;
  energy: number;
  buffs: Buff[];
}

export interface WorldStateSave {
  id: string;
  saveVersion: number;
  player: PlayerSave;
  inventory: InventorySnapshot;
  progress: ProgressSnapshot;
  time: number;
  weather?: { weather: WeatherKind; timer: number };
  containers: [string, Slots][];
  farming: { crops: [string, number][]; bushes: [string, number][] };
  drops: { stack: ItemStack; x: number; y: number; z: number; age: number }[];
  /** Rowboats left in the world (survival). */
  boats?: { x: number; y: number; z: number; yaw: number }[];
  companion: { kind: CreatureKind; x: number; y: number; z: number; sitting: boolean; friendship: number } | null;
  visitedLandmarks?: string[];
  /** Build Home objects (build mode only). */
  build?: BuildStateSave;
}

/** A saved structure that can be placed in any Build Home project. */
export interface BlueprintRecord {
  id: string;
  name: string;
  createdAt: number;
  /** Size in blocks (x, y, z). */
  size: [number, number, number];
  /** [dx, dy, dz, blockId, meta] relative to the min corner. */
  blocks: [number, number, number, number, number][];
  /** Objects relative to the min corner. */
  objects: Omit<BuildObjectSave, 'id'>[];
  /** Stable block keys by id at save time (so ids can be remapped if the registry ever changes). */
  blockKeys: string[];
}

export interface ChunkModsRecord {
  /** `${worldId}|${cx},${cz}` */
  key: string;
  worldId: string;
  cx: number;
  cz: number;
  saveVersion: number;
  /** [localIndex, id | meta << 8] */
  changes: [number, number][];
}

export interface MapTileRecord {
  key: string;
  worldId: string;
  cx: number;
  cz: number;
  colors: Uint8Array;
}
