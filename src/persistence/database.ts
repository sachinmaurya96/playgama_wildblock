import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { BlueprintRecord, ChunkModsRecord, MapTileRecord, WorldMeta, WorldStateSave } from './types';

interface WildDB extends DBSchema {
  worlds: { key: string; value: WorldMeta };
  states: { key: string; value: WorldStateSave };
  chunks: { key: string; value: ChunkModsRecord; indexes: { byWorld: string } };
  maps: { key: string; value: MapTileRecord; indexes: { byWorld: string } };
  /** Previous state per world (one-deep autosave backup, restored if the latest fails to load). */
  backups: { key: string; value: WorldStateSave };
  blueprints: { key: string; value: BlueprintRecord };
}

/**
 * Storage backend. IndexedDB via `idb`; if IndexedDB is unavailable (private
 * mode in some browsers, sandboxed iframes) an in-memory store is used so the
 * game still runs — the UI warns that progress won't persist.
 */
export interface Store {
  persistent: boolean;
  /** Commit one complete save, including its previous-state backup. */
  commitSave(meta: WorldMeta, state: WorldStateSave, chunks: ChunkModsRecord[], maps: MapTileRecord[], backup: boolean): Promise<void>;
  listWorlds(): Promise<WorldMeta[]>;
  getWorld(id: string): Promise<WorldMeta | undefined>;
  putWorld(m: WorldMeta): Promise<void>;
  getState(id: string): Promise<WorldStateSave | undefined>;
  putState(s: WorldStateSave): Promise<void>;
  getChunks(worldId: string): Promise<ChunkModsRecord[]>;
  putChunks(list: ChunkModsRecord[]): Promise<void>;
  getMaps(worldId: string): Promise<MapTileRecord[]>;
  putMaps(list: MapTileRecord[]): Promise<void>;
  deleteWorld(id: string): Promise<void>;
  getBackup(id: string): Promise<WorldStateSave | undefined>;
  putBackup(s: WorldStateSave): Promise<void>;
  listBlueprints(): Promise<BlueprintRecord[]>;
  putBlueprint(b: BlueprintRecord): Promise<void>;
  deleteBlueprint(id: string): Promise<void>;
}

class IdbStore implements Store {
  persistent = true;
  constructor(private db: IDBPDatabase<WildDB>) {}
  async commitSave(meta: WorldMeta, state: WorldStateSave, chunks: ChunkModsRecord[], maps: MapTileRecord[], backup: boolean) {
    const tx = this.db.transaction(['worlds', 'states', 'chunks', 'maps', 'backups'], 'readwrite');
    const writes: Promise<unknown>[] = [];
    try {
      const states = tx.objectStore('states');
      if (backup) {
        const prev = await states.get(meta.id);
        if (prev) await tx.objectStore('backups').put(prev);
      }
      for (const c of chunks) writes.push(tx.objectStore('chunks').put(c));
      for (const m of maps) writes.push(tx.objectStore('maps').put(m));
      writes.push(states.put(state));
      writes.push(tx.objectStore('worlds').put(meta));
      await Promise.all(writes);
      await tx.done;
    } catch (e) {
      try { tx.abort(); } catch { /* already aborted */ }
      // A synchronous clone error can happen after earlier requests were
      // queued. Observe their abort rejections too, not just the transaction.
      await Promise.allSettled([...writes, tx.done]);
      throw e;
    }
  }
  async listWorlds() {
    return (await this.db.getAll('worlds')).sort((a, b) => b.lastPlayed - a.lastPlayed);
  }
  getWorld(id: string) {
    return this.db.get('worlds', id);
  }
  async putWorld(m: WorldMeta) {
    await this.db.put('worlds', m);
  }
  getState(id: string) {
    return this.db.get('states', id);
  }
  async putState(s: WorldStateSave) {
    await this.db.put('states', s);
  }
  getChunks(worldId: string) {
    return this.db.getAllFromIndex('chunks', 'byWorld', worldId);
  }
  async putChunks(list: ChunkModsRecord[]) {
    if (!list.length) return;
    const tx = this.db.transaction('chunks', 'readwrite');
    await Promise.all([...list.map((r) => tx.store.put(r)), tx.done]);
  }
  getMaps(worldId: string) {
    return this.db.getAllFromIndex('maps', 'byWorld', worldId);
  }
  async putMaps(list: MapTileRecord[]) {
    if (!list.length) return;
    const tx = this.db.transaction('maps', 'readwrite');
    await Promise.all([...list.map((r) => tx.store.put(r)), tx.done]);
  }
  getBackup(id: string) {
    return this.db.get('backups', id);
  }
  async putBackup(s: WorldStateSave) {
    await this.db.put('backups', s);
  }
  async listBlueprints() {
    return (await this.db.getAll('blueprints')).sort((a, b) => b.createdAt - a.createdAt);
  }
  async putBlueprint(b: BlueprintRecord) {
    await this.db.put('blueprints', b);
  }
  async deleteBlueprint(id: string) {
    await this.db.delete('blueprints', id);
  }
  async deleteWorld(id: string) {
    const tx = this.db.transaction(['worlds', 'states', 'chunks', 'maps', 'backups'], 'readwrite');
    await tx.objectStore('worlds').delete(id);
    await tx.objectStore('states').delete(id);
    await tx.objectStore('backups').delete(id);
    for (const store of ['chunks', 'maps'] as const) {
      const idx = tx.objectStore(store).index('byWorld');
      let cursor = await idx.openCursor(id);
      while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
      }
    }
    await tx.done;
  }
}

class MemoryStore implements Store {
  persistent = false;
  private worlds = new Map<string, WorldMeta>();
  private states = new Map<string, WorldStateSave>();
  private chunks = new Map<string, ChunkModsRecord>();
  private maps = new Map<string, MapTileRecord>();
  private backups = new Map<string, WorldStateSave>();
  private blueprints = new Map<string, BlueprintRecord>();
  async commitSave(meta: WorldMeta, state: WorldStateSave, chunks: ChunkModsRecord[], maps: MapTileRecord[], backup: boolean) {
    // Clone before changing anything so a failed snapshot cannot partially save.
    const snapshot = structuredClone({ meta, state, chunks, maps });
    const prev = this.states.get(meta.id);
    if (backup && prev) this.backups.set(meta.id, prev);
    for (const c of snapshot.chunks) this.chunks.set(c.key, c);
    for (const m of snapshot.maps) this.maps.set(m.key, m);
    this.states.set(meta.id, snapshot.state);
    this.worlds.set(meta.id, snapshot.meta);
  }
  async getBackup(id: string) {
    const s = this.backups.get(id);
    return s ? structuredClone(s) : undefined;
  }
  async putBackup(s: WorldStateSave) {
    this.backups.set(s.id, structuredClone(s));
  }
  async listBlueprints() {
    return [...this.blueprints.values()].sort((a, b) => b.createdAt - a.createdAt).map((b) => structuredClone(b));
  }
  async putBlueprint(b: BlueprintRecord) {
    this.blueprints.set(b.id, structuredClone(b));
  }
  async deleteBlueprint(id: string) {
    this.blueprints.delete(id);
  }
  async listWorlds() {
    return [...this.worlds.values()].sort((a, b) => b.lastPlayed - a.lastPlayed);
  }
  async getWorld(id: string) {
    return this.worlds.get(id);
  }
  async putWorld(m: WorldMeta) {
    this.worlds.set(m.id, structuredClone(m));
  }
  async getState(id: string) {
    const s = this.states.get(id);
    return s ? structuredClone(s) : undefined;
  }
  async putState(s: WorldStateSave) {
    this.states.set(s.id, structuredClone(s));
  }
  async getChunks(worldId: string) {
    return [...this.chunks.values()].filter((c) => c.worldId === worldId).map((c) => structuredClone(c));
  }
  async putChunks(list: ChunkModsRecord[]) {
    for (const r of list) this.chunks.set(r.key, structuredClone(r));
  }
  async getMaps(worldId: string) {
    return [...this.maps.values()].filter((c) => c.worldId === worldId);
  }
  async putMaps(list: MapTileRecord[]) {
    for (const r of list) this.maps.set(r.key, r);
  }
  async deleteWorld(id: string) {
    this.worlds.delete(id);
    this.states.delete(id);
    this.backups.delete(id);
    for (const [k, v] of this.chunks) if (v.worldId === id) this.chunks.delete(k);
    for (const [k, v] of this.maps) if (v.worldId === id) this.maps.delete(k);
  }
}

let storePromise: Promise<Store> | null = null;
let openDb: IDBPDatabase<WildDB> | null = null;

export const DB_NAME = 'wildblocks';
export const DB_VERSION = 2;

export function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = (async () => {
      try {
        if (typeof indexedDB === 'undefined') throw new Error('IndexedDB unavailable');
        const db = await openDB<WildDB>(DB_NAME, DB_VERSION, {
          upgrade(db) {
            if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('states')) db.createObjectStore('states', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: 'key' }).createIndex('byWorld', 'worldId');
            if (!db.objectStoreNames.contains('maps')) db.createObjectStore('maps', { keyPath: 'key' }).createIndex('byWorld', 'worldId');
            // v2: Build Home blueprints + autosave backups
            if (!db.objectStoreNames.contains('backups')) db.createObjectStore('backups', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('blueprints')) db.createObjectStore('blueprints', { keyPath: 'id' });
          },
          blocked() {
            console.warn('[WildBlocks] database upgrade blocked by another tab');
          },
        });
        openDb = db;
        return new IdbStore(db);
      } catch (e) {
        console.warn('[WildBlocks] IndexedDB not available — progress will not be saved this session.', e);
        return new MemoryStore();
      }
    })();
  }
  return storePromise;
}

/** Test helper: close the connection and wipe the database so each test starts fresh. */
export async function resetStoreForTests(): Promise<void> {
  if (storePromise) await storePromise;
  openDb?.close();
  openDb = null;
  storePromise = null;
  if (typeof indexedDB !== 'undefined') {
    await new Promise<void>((resolve) => {
      const r = indexedDB.deleteDatabase(DB_NAME);
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    });
  }
}
