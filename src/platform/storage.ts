import type { Store } from '../persistence/database';
import type { BlueprintRecord, ChunkModsRecord, MapTileRecord, WorldMeta, WorldStateSave } from '../persistence/types';

export const SAVE_KEY = 'wildblocks.bridge.v1';
const LEGACY_PREFS = ['wildblocks.settings.v1', 'wildblocks.build.v1', 'wb-pvp-name', 'wb-pvp-color', 'wb-pvp-settings', 'wb-dm-name', 'wb-dm-color', 'wb-dm-minutes', 'wb-voice', 'wb-voice-scope'];
type Table<T> = Record<string, T>;
export interface SaveDocument {
  schemaVersion: 1;
  preferences: Record<string, string>;
  worlds: Table<WorldMeta>;
  states: Table<WorldStateSave>;
  backups: Table<WorldStateSave>;
  chunks: Table<ChunkModsRecord>;
  maps: Table<MapTileRecord>;
  blueprints: Table<BlueprintRecord>;
}
export interface StorageApi {
  get(keys: string[], tryParseJson?: boolean): Promise<unknown>;
  set(keys: string[], values: string[]): Promise<void>;
}
const empty = (): SaveDocument => ({ schemaVersion: 1, preferences: {}, worlds: {}, states: {}, backups: {}, chunks: {}, maps: {}, blueprints: {} });
export function encodeSave(doc: SaveDocument): string {
  return JSON.stringify(doc, (_key, v) => v instanceof Uint8Array ? { bytes: Array.from(v), type: 'Uint8Array' } : v);
}
export function parseSave(raw: unknown): SaveDocument {
  if (typeof raw !== 'string') throw new Error('Saved data is not a JSON string');
  const doc = JSON.parse(raw, (_key, v) => {
    if (v?.type === 'Uint8Array') {
      if (!Array.isArray(v.bytes) || !v.bytes.every((b: unknown) => Number.isInteger(b) && Number(b) >= 0 && Number(b) <= 255)) throw new Error('Invalid saved map');
      return Uint8Array.from(v.bytes);
    }
    return v;
  }) as SaveDocument;
  if (!doc || doc.schemaVersion !== 1) throw new Error('Unsupported save version');
  for (const key of ['preferences', 'worlds', 'states', 'backups', 'chunks', 'maps', 'blueprints'] as const) {
    const table = doc[key];
    if (!table || typeof table !== 'object' || Array.isArray(table)) throw new Error(`Invalid save table: ${key}`);
    if (Object.keys(table).some((k) => ['__proto__', 'constructor', 'prototype'].includes(k))) throw new Error('Invalid saved key');
  }
  if (Object.values(doc.preferences).some((v) => typeof v !== 'string')) throw new Error('Invalid preferences');
  for (const [id, w] of Object.entries(doc.worlds)) {
    if (!w || w.id !== id || typeof w.name !== 'string' || typeof w.seedText !== 'string' || !Number.isFinite(w.seed) || !Number.isFinite(w.lastPlayed) || !Number.isFinite(w.saveVersion) || w.saveVersion > 2) throw new Error('Invalid world metadata');
  }
  for (const s of [...Object.values(doc.states), ...Object.values(doc.backups)]) {
    if (!s || typeof s.id !== 'string' || !Number.isFinite(s.saveVersion) || s.saveVersion > 2) throw new Error('Invalid world state');
    // Deeper state validation and previous-autosave recovery remain in SaveManager.
  }
  for (const c of Object.values(doc.chunks)) {
    if (!c || typeof c.worldId !== 'string' || !Number.isInteger(c.cx) || !Number.isInteger(c.cz) || !Array.isArray(c.changes) || !c.changes.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isInteger))) throw new Error('Invalid block edits');
  }
  for (const m of Object.values(doc.maps)) if (!m || !(m.colors instanceof Uint8Array) || typeof m.worldId !== 'string') throw new Error('Invalid map tile');
  for (const b of Object.values(doc.blueprints)) if (!b || !Array.isArray(b.blocks) || !Array.isArray(b.objects) || !Array.isArray(b.blockKeys)) throw new Error('Invalid blueprint');
  return doc;
}

/** One ordered JSON checkpoint preserves the existing world schema and atomic save semantics. */
export class BridgeStore implements Store {
  persistent = true;
  document = empty();
  loaded = false;
  error: string | null = null;
  private api: StorageApi | null = null;
  private writes: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private changed() { for (const fn of this.listeners) fn(); }
  async load(api: StorageApi, legacy?: () => Promise<Store | undefined>, local?: Pick<Storage, 'getItem'>, session?: Pick<Storage, 'key' | 'length' | 'getItem'>) {
    this.api = api;
    const values = await api.get([SAVE_KEY], false);
    if (!Array.isArray(values) || values.length !== 1) throw new Error('Storage returned an invalid response');
    const raw = values[0];
    // A read failure/malformed save throws; it never becomes a missing save.
    const next = raw == null ? empty() : parseSave(raw);
    if (raw == null) {
      if (local) for (const key of LEGACY_PREFS) {
        try { const v = local.getItem(key); if (v != null) { JSON.parse(v); next.preferences[key] = v; } } catch { /* retain original legacy data */ }
      }
      if (session) for (let i = 0; i < session.length; i++) {
        const key = session.key(i);
        if (key?.startsWith('wb-dm-token-')) {
          const value = session.getItem(key);
          if (value) next.preferences[key] = value;
        }
      }
      if (legacy) {
        const old = await legacy();
        if (old && !old.persistent) throw new Error('Legacy worlds could not be read. Retry to preserve them.');
        for (const w of old ? await old.listWorlds() : []) {
          next.worlds[w.id] = w;
          const s = await old!.getState(w.id), b = await old!.getBackup(w.id);
          if (s) next.states[w.id] = s;
          if (b) next.backups[w.id] = b;
          for (const c of await old!.getChunks(w.id)) next.chunks[c.key] = c;
          for (const m of await old!.getMaps(w.id)) next.maps[m.key] = m;
        }
        for (const b of old ? await old.listBlueprints() : []) next.blueprints[b.id] = b;
      }
    }
    this.document = next;
    this.loaded = true;
    if (raw == null && (Object.keys(next.worlds).length || Object.keys(next.preferences).length || Object.keys(next.blueprints).length)) await this.flush();
    this.error = null;
    this.changed();
  }
  getItem(key: string): string | null { return this.document.preferences[key] ?? null; }
  setItem(key: string, value: string) {
    if (!this.loaded) return; // UI is gated until hydration; tests can still use defaults.
    this.document.preferences[key] = value;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.flush().catch(() => {}); }, 250);
    this.changed();
  }
  flush(): Promise<void> {
    if (!this.loaded || !this.api) return Promise.reject(new Error('Storage has not loaded'));
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const snapshot = encodeSave(this.document);
    const api = this.api;
    const pending = this.writes.catch(() => {}).then(() => api.set([SAVE_KEY], [snapshot]));
    this.writes = pending;
    return pending.then(() => { this.error = null; this.changed(); }, (e: unknown) => {
      this.error = 'Saving failed. Your changes are kept here; retry saving before leaving.';
      this.changed();
      throw e;
    });
  }
  async commitSave(meta: WorldMeta, state: WorldStateSave, chunks: ChunkModsRecord[], maps: MapTileRecord[], backup: boolean) {
    const snapshot = structuredClone({ meta, state, chunks, maps });
    if (backup && this.document.states[meta.id]) this.document.backups[meta.id] = this.document.states[meta.id];
    this.document.worlds[meta.id] = snapshot.meta;
    this.document.states[meta.id] = snapshot.state;
    for (const c of snapshot.chunks) this.document.chunks[c.key] = c;
    for (const m of snapshot.maps) this.document.maps[m.key] = m;
    await this.flush();
  }
  async listWorlds() { return structuredClone(Object.values(this.document.worlds).sort((a, b) => b.lastPlayed - a.lastPlayed)); }
  async getWorld(id: string) { return structuredClone(this.document.worlds[id]); }
  async putWorld(w: WorldMeta) { this.document.worlds[w.id] = structuredClone(w); await this.flush(); }
  async getState(id: string) { return structuredClone(this.document.states[id]); }
  async putState(s: WorldStateSave) { this.document.states[s.id] = structuredClone(s); await this.flush(); }
  async getBackup(id: string) { return structuredClone(this.document.backups[id]); }
  async putBackup(s: WorldStateSave) { this.document.backups[s.id] = structuredClone(s); await this.flush(); }
  async getChunks(id: string) { return structuredClone(Object.values(this.document.chunks).filter((c) => c.worldId === id)); }
  async putChunks(list: ChunkModsRecord[]) { for (const c of list) this.document.chunks[c.key] = structuredClone(c); await this.flush(); }
  async getMaps(id: string) { return structuredClone(Object.values(this.document.maps).filter((m) => m.worldId === id)); }
  async putMaps(list: MapTileRecord[]) { for (const m of list) this.document.maps[m.key] = structuredClone(m); await this.flush(); }
  async deleteWorld(id: string) {
    delete this.document.worlds[id]; delete this.document.states[id]; delete this.document.backups[id];
    for (const table of [this.document.chunks, this.document.maps]) for (const [k, v] of Object.entries(table)) if (v.worldId === id) delete table[k];
    await this.flush();
  }
  async listBlueprints() { return structuredClone(Object.values(this.document.blueprints).sort((a, b) => b.createdAt - a.createdAt)); }
  async putBlueprint(b: BlueprintRecord) { this.document.blueprints[b.id] = structuredClone(b); await this.flush(); }
  async deleteBlueprint(id: string) { delete this.document.blueprints[id]; await this.flush(); }
}
export const bridgeStorage = new BridgeStore();
export const preferences = bridgeStorage;
