import { createWorld, loadWorldData, type LoadedWorld } from '../persistence/SaveManager';
import { SAVE_VERSION, type BuildSettings, type WorldMeta } from '../persistence/types';
import type { NetSession } from '../net/pvpNet';
import { seedFromString } from '../game/core/random';
import { useGameStore, type Difficulty } from '../stores/gameStore';
import { audio } from '../game/core/audio';

/** The world the GameCanvas should boot next (set by menus, read once by the canvas). */
let pending: LoadedWorld | null = null;

export function takePendingLaunch(): LoadedWorld | null {
  return pending;
}

const launchKeys = new WeakMap<LoadedWorld, number>();
let launchSeq = 0;
/** A fresh key per launch: reopening the same project (e.g. to share it with friends) restarts the game. */
export function launchKey(l: LoadedWorld): string {
  let k = launchKeys.get(l);
  if (k === undefined) launchKeys.set(l, (k = ++launchSeq));
  return `${l.meta.id}#${k}`;
}

export async function launchWorld(id: string): Promise<void> {
  audio.init();
  const data = await loadWorldData(id);
  if (!data) {
    useGameStore.getState().toast('That world could not be found.', 'warn');
    return;
  }
  pending = data;
  const gs = useGameStore.getState();
  gs.setWorld({ id: data.meta.id, name: data.meta.name, seed: data.meta.seedText, difficulty: data.meta.difficulty, mode: data.meta.mode ?? 'survival' });
  useGameStore.setState({ loading: { progress: 0, stage: data.meta.mode === 'build' ? 'Preparing your lot...' : 'Growing your world...', tipIndex: Math.floor(Math.random() * 1000) }, death: null, hudHidden: false });
  gs.setScreen('loading');
}

export async function createAndLaunch(opts: { name: string; seedText: string; difficulty: Difficulty; peacefulCreatures: boolean; mode?: 'survival' | 'build'; build?: BuildSettings }): Promise<void> {
  audio.init();
  const meta = await createWorld(opts);
  await launchWorld(meta.id);
}

/**
 * Build Home with friends, host side: reopen your own project (it keeps saving) with the room attached,
 * so everyone builds on it with the full Build Home tools.
 */
export async function launchCoopHost(worldId: string): Promise<void> {
  audio.init();
  const data = await loadWorldData(worldId);
  if (!data) throw new Error('Could not open your Build Home project.');
  pending = { ...data, meta: { ...data.meta, coop: 'host' } };
  const gs = useGameStore.getState();
  gs.setWorld({ id: data.meta.id, name: data.meta.name, seed: data.meta.seedText, difficulty: data.meta.difficulty, mode: 'build' });
  useGameStore.setState({ loading: { progress: 0, stage: 'Opening your lot to friends...', tipIndex: Math.floor(Math.random() * 1000) }, death: null, hudHidden: false, overlay: null });
  gs.setScreen('loading');
}

/** Build Home with friends, friend side: the host's lot in Build Home mode (not saved on this device). */
function launchCoopGuest(session: NetSession): void {
  const src = session.settings.source!;
  const meta: WorldMeta = {
    id: `coop-${session.code}-${Date.now().toString(36)}`, name: `🏡 ${src.name}`, seed: src.seed, seedText: session.settings.seedText,
    difficulty: 'peaceful', peacefulCreatures: true, createdAt: Date.now(), lastPlayed: Date.now(), playTime: 0, saveVersion: SAVE_VERSION,
    mode: 'build', caves: src.caves, build: { plot: src.arena ?? 'meadow', timeOfDay: 'day', timeLocked: true, weather: 'clear' }, coop: 'guest',
  };
  pending = { meta, state: null, mods: new Map() };
  const gs = useGameStore.getState();
  gs.setWorld({ id: meta.id, name: meta.name, seed: meta.seedText, difficulty: 'peaceful', mode: 'build' });
  useGameStore.setState({ loading: { progress: 0, stage: 'Walking over to your friend\'s lot...', tipIndex: Math.floor(Math.random() * 1000) }, death: null, hudHidden: false, overlay: null });
  gs.setScreen('loading');
}

/**
 * Start a PvP match world for the current PvP connection (nothing is saved). The map comes from the room
 * seed — or, for a world opened to friends, from that world (`mods` = the host's own block changes).
 */
export function launchPvp(session: NetSession, mods: Map<number, [number, number][]> = new Map()): void {
  audio.init();
  const s = session.settings;
  const src = s.source;
  if (src?.kind === 'build' && !session.isHost) return launchCoopGuest(session);
  const meta: WorldMeta = {
    id: `pvp-${session.code}-${Date.now().toString(36)}`, name: src ? `🎮 ${src.name}` : `PvP · ${session.code}`, seed: src ? src.seed : seedFromString(s.seedText), seedText: s.seedText,
    difficulty: 'explorer', peacefulCreatures: !s.creatures, createdAt: Date.now(), lastPlayed: Date.now(), playTime: 0, saveVersion: SAVE_VERSION,
    mode: 'pvp', caves: src ? src.caves : 2, arena: src ? src.arena : s.map && s.map !== 'wild' ? s.map : undefined,
  };
  pending = { meta, state: null, mods };
  const gs = useGameStore.getState();
  gs.setWorld({ id: meta.id, name: meta.name, seed: meta.seedText, difficulty: 'explorer', mode: 'pvp' });
  useGameStore.setState({ loading: { progress: 0, stage: 'Entering the arena...', tipIndex: Math.floor(Math.random() * 1000) }, death: null, hudHidden: false, overlay: null });
  gs.setScreen('loading');
}

/**
 * Deathmatch: load City Clash for the current room round (nothing is saved).
 * Called by net/deathmatchNet when the host starts the match.
 */
export function launchDeathmatch(info: { round: number; seed: number }): void {
  audio.init();
  const meta: WorldMeta = {
    id: `dm-${info.round}-${Date.now().toString(36)}`, name: 'City Clash', seed: info.seed >>> 0, seedText: `city-${info.seed}`,
    difficulty: 'explorer', peacefulCreatures: true, createdAt: Date.now(), lastPlayed: Date.now(), playTime: 0, saveVersion: SAVE_VERSION,
    mode: 'deathmatch', caves: 1,
  };
  pending = { meta, state: null, mods: new Map() };
  const gs = useGameStore.getState();
  gs.setWorld({ id: meta.id, name: meta.name, seed: meta.seedText, difficulty: 'explorer', mode: 'deathmatch' });
  useGameStore.setState({ loading: { progress: 0, stage: 'Loading City Clash...', tipIndex: Math.floor(Math.random() * 1000) }, death: null, hudHidden: false, overlay: null });
  gs.setScreen('loading');
}
