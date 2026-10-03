import { SAVE_VERSION, type ChunkModsRecord, type WorldMeta, type WorldStateSave } from '../types';

/**
 * Save migrations. Each entry upgrades data saved with `from` to `from + 1`.
 * Old saves are migrated on load, never discarded. Example for a future v2:
 *
 *   { from: 1, state: (s) => ({ ...s, newField: defaultValue }) }
 */
interface Migration {
  from: number;
  meta?: (m: WorldMeta) => WorldMeta;
  state?: (s: WorldStateSave) => WorldStateSave;
  chunk?: (c: ChunkModsRecord) => ChunkModsRecord;
}

export const MIGRATIONS: Migration[] = [
  // v0 → v1: very early saves had no saveVersion and no farming/containers fields.
  {
    from: 0,
    meta: (m) => ({ ...m, peacefulCreatures: m.peacefulCreatures ?? false, saveVersion: 1 }),
    state: (s) => ({
      ...s,
      containers: s.containers ?? [],
      farming: s.farming ?? { crops: [], bushes: [] },
      drops: s.drops ?? [],
      companion: s.companion ?? null,
      saveVersion: 1,
    }),
    chunk: (c) => ({ ...c, saveVersion: 1 }),
  },
  // v1 → v2: Build Home. Every existing world is a survival world; block ids were only appended.
  {
    from: 1,
    meta: (m) => ({ ...m, mode: m.mode ?? 'survival', saveVersion: 2 }),
    state: (s) => ({ ...s, saveVersion: 2 }),
    chunk: (c) => ({ ...c, saveVersion: 2 }),
  },
];

function run<T extends { saveVersion?: number }>(data: T, pick: (m: Migration) => ((d: T) => T) | undefined): T {
  let d = data;
  let v = d.saveVersion ?? 0;
  if (v > SAVE_VERSION) {
    console.warn(`[WildBlocks] save is from a newer version (${v}); loading best-effort.`);
    return d;
  }
  while (v < SAVE_VERSION) {
    const m = MIGRATIONS.find((x) => x.from === v);
    const fn = m ? pick(m) : undefined;
    d = fn ? fn(d) : { ...d, saveVersion: v + 1 };
    v = d.saveVersion ?? v + 1;
  }
  return d;
}

export function migrateMeta(m: WorldMeta): WorldMeta {
  return run(m, (x) => x.meta);
}

export function migrateState(s: WorldStateSave): WorldStateSave {
  return run(s, (x) => x.state);
}

export function migrateChunk(c: ChunkModsRecord): ChunkModsRecord {
  return run(c, (x) => x.chunk);
}
