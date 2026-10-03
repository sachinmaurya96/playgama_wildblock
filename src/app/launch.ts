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
 * Start a PvP match world for the current PvP connection (nothing is saved). The map comes from the room
 * seed — or, for a world opened to friends, from that world (`mods` = the host's own block changes).
 */
export function launchPvp(session: NetSession, mods: Map<number, [number, number][]> = new Map()): void {
  audio.init();
  const s = session.settings;
  const src = s.source;
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
