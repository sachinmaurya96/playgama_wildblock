import { randomSeedString, seedFromString } from '../game/core/random';
import { ckey, ckeyX, ckeyZ, type World } from '../game/world/World';
import type { Difficulty } from '../stores/gameStore';
import { getStore } from './database';
import { migrateChunk, migrateMeta, migrateState } from './migrations';
import { SAVE_VERSION, type BlueprintRecord, type BuildSettings, type ChunkModsRecord, type MapTileRecord, type WorldMeta, type WorldStateSave } from './types';

/**
 * Save format: only *changes* are stored. Terrain is regenerated from the seed,
 * so a world save is: metadata + player/progress state + per-chunk lists of
 * modified block indices. This keeps saves tiny and fast.
 */

function newId(): string {
  return `w_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export async function createWorld(opts: { name: string; seedText: string; difficulty: Difficulty; peacefulCreatures: boolean; mode?: 'survival' | 'build'; build?: BuildSettings }): Promise<WorldMeta> {
  const seedText = opts.seedText.trim() || randomSeedString();
  const meta: WorldMeta = {
    mode: opts.mode ?? 'survival',
    build: opts.build,
    id: newId(),
    name: opts.name.trim() || (opts.mode === 'build' ? 'Dream House' : 'My Wild World'),
    seed: seedFromString(seedText),
    seedText,
    difficulty: opts.difficulty,
    peacefulCreatures: opts.peacefulCreatures,
    createdAt: Date.now(),
    lastPlayed: Date.now(),
    playTime: 0,
    saveVersion: SAVE_VERSION,
    caves: opts.mode === 'build' ? undefined : 2,
  };
  const store = await getStore();
  await store.putWorld(meta);
  return meta;
}

export async function listWorlds(): Promise<WorldMeta[]> {
  const store = await getStore();
  return (await store.listWorlds()).map(migrateMeta);
}

export async function renameWorld(id: string, name: string): Promise<void> {
  const store = await getStore();
  const m = await store.getWorld(id);
  if (!m) return;
  await store.putWorld({ ...m, name: name.trim() || m.name });
}

export async function deleteWorld(id: string): Promise<void> {
  const store = await getStore();
  await store.deleteWorld(id);
}

export async function storageIsPersistent(): Promise<boolean> {
  return (await getStore()).persistent;
}

export interface LoadedWorld {
  meta: WorldMeta;
  state: WorldStateSave | null;
  /** chunk key -> modifications */
  mods: Map<number, [number, number][]>;
}

export async function loadWorldData(id: string): Promise<LoadedWorld | null> {
  const store = await getStore();
  const rawMeta = await store.getWorld(id);
  if (!rawMeta) return null;
  const meta = migrateMeta(rawMeta);
  let state: WorldStateSave | null = null;
  const rawState = await store.getState(id);
  try {
    state = rawState ? migrateState(rawState) : null;
    if (state) assertStateShape(state);
  } catch (e) {
    // Never overwrite a damaged save silently: fall back to the previous autosave and log why.
    console.error(`[WildBlocks] save for "${meta.name}" could not be read — restoring the previous autosave.`, e);
    const backup = await store.getBackup(id);
    try {
      state = backup ? migrateState(backup) : null;
      if (state) assertStateShape(state);
      recoveredWorlds.add(id);
    } catch (e2) {
      console.error('[WildBlocks] backup save is damaged too; starting from the world seed with your block edits.', e2);
      state = null;
      recoveredWorlds.add(id);
    }
  }
  const mods = new Map<number, [number, number][]>();
  for (const rec of await store.getChunks(id)) {
    const r = migrateChunk(rec);
    mods.set(ckey(r.cx, r.cz), r.changes);
  }
  return { meta, state, mods };
}

/** Worlds whose latest save failed to load this session (UI can warn; the next save writes a fresh copy). */
export const recoveredWorlds = new Set<string>();

function assertStateShape(s: WorldStateSave): void {
  const p = s.player;
  if (!p || ![p.x, p.y, p.z, p.yaw, p.pitch].every(Number.isFinite)) throw new Error('player position is invalid');
  if (!s.inventory || !Array.isArray(s.inventory.slots)) throw new Error('inventory is invalid');
  if (s.build && !Array.isArray(s.build.objects)) throw new Error('build objects are invalid');
}

export async function loadMapTiles(worldId: string): Promise<MapTileRecord[]> {
  return (await getStore()).getMaps(worldId);
}

/**
 * Persist everything. Chunk modifications are written incrementally (only
 * chunks changed since the last save). Returns when the transaction commits.
 */
export async function writeSave(meta: WorldMeta, state: WorldStateSave, world: World, maps: MapTileRecord[] = []): Promise<void> {
  // Take the edit snapshot before yielding. New edits made while storage is
  // busy re-add their chunk keys and remain pending for the following save.
  const dirty = [...world.dirtyMods];
  const chunks: ChunkModsRecord[] = [];
  for (const k of dirty) {
    const cx = ckeyX(k), cz = ckeyZ(k);
    chunks.push({ key: `${meta.id}|${cx},${cz}`, worldId: meta.id, cx, cz, saveVersion: SAVE_VERSION, changes: world.serializeMods(k) });
  }
  world.dirtyMods.clear();
  try {
    const store = await getStore();
    await store.commitSave(
      { ...meta, saveVersion: SAVE_VERSION },
      { ...state, id: meta.id, saveVersion: SAVE_VERSION },
      chunks, maps, !recoveredWorlds.has(meta.id),
    );
    recoveredWorlds.delete(meta.id);
  } catch (e) {
    for (const k of dirty) world.dirtyMods.add(k);
    throw e;
  }
}

// ---------------------------------------------------------------- blueprints (shared by all Build Home projects)

export async function listBlueprints(): Promise<BlueprintRecord[]> {
  return (await getStore()).listBlueprints();
}

export async function saveBlueprint(b: Omit<BlueprintRecord, 'id' | 'createdAt'>): Promise<BlueprintRecord> {
  const rec: BlueprintRecord = { ...b, id: `bp_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`, createdAt: Date.now() };
  await (await getStore()).putBlueprint(rec);
  return rec;
}

export async function deleteBlueprint(id: string): Promise<void> {
  await (await getStore()).deleteBlueprint(id);
}
