import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStore, resetStoreForTests } from './database';
import { createWorld, deleteWorld, listWorlds, loadWorldData, renameWorld, writeSave } from './SaveManager';
import { migrateState } from './migrations';
import { SAVE_VERSION, type WorldStateSave } from './types';
import { World, ckey } from '../game/world/World';
import { Chunk } from '../game/world/Chunk';
import { generateChunk } from '../game/world/ChunkGenerator';
import { B } from '../game/world/BlockRegistry';
import { ContainerSystem } from '../game/systems/ContainerSystem';
import { FarmingSystem } from '../game/systems/FarmingSystem';
import { makeStack } from '../game/systems/InventoryLogic';
import { useInventoryStore } from '../stores/inventoryStore';
import { useWorldStore } from '../stores/worldStore';
import { CHUNK_SIZE } from '../game/world/constants';

function stateFrom(world: World, containers: ContainerSystem, farming: FarmingSystem): WorldStateSave {
  return {
    id: '', saveVersion: SAVE_VERSION,
    player: { x: 1, y: 70, z: 2, yaw: 0.5, pitch: 0, vitality: 88, energy: 70, buffs: [] },
    inventory: useInventoryStore.getState().snapshot(),
    progress: useWorldStore.getState().snapshot(),
    time: 1234,
    containers: [...containers.containers.entries()],
    farming: farming.serialize(),
    drops: [],
    companion: null,
  };
  void world;
}

function loadChunkInto(world: World, cx: number, cz: number) {
  world.addChunk(new Chunk(generateChunk(cx, cz, world.sampler)));
}

describe('save system (IndexedDB)', () => {
  beforeEach(async () => {
    await resetStoreForTests();
    useInventoryStore.getState().reset();
  });

  it('creates, lists, renames and deletes worlds', async () => {
    const a = await createWorld({ name: 'Alpha', seedText: 'seed-a', difficulty: 'explorer', peacefulCreatures: false });
    await createWorld({ name: 'Beta', seedText: '', difficulty: 'peaceful', peacefulCreatures: true });
    let list = await listWorlds();
    expect(list.map((w) => w.name).sort()).toEqual(['Alpha', 'Beta']);
    expect(list.find((w) => w.name === 'Beta')!.seedText.length).toBeGreaterThan(0); // random seed chosen
    await renameWorld(a.id, 'Alpha Prime');
    list = await listWorlds();
    expect(list.some((w) => w.name === 'Alpha Prime')).toBe(true);
    await deleteWorld(a.id);
    list = await listWorlds();
    expect(list.map((w) => w.name)).toEqual(['Beta']);
  });

  it('block edits survive save → reload (only modifications are stored)', async () => {
    const meta = await createWorld({ name: 'Builder', seedText: 'house', difficulty: 'explorer', peacefulCreatures: false });
    const world = new World(meta.seed);
    loadChunkInto(world, 0, 0);
    loadChunkInto(world, -1, 0);
    const y = world.surfaceY(3, 3) + 1;
    world.set(3, y, 3, B.PLANKS);
    world.set(3, y + 1, 3, B.PLANKS);
    world.set(-2, 5, 4, 0); // dig a hole in the negative chunk
    const dug = world.get(-2, 5, 4);
    const containers = new ContainerSystem();
    const farming = new FarmingSystem();
    await writeSave(meta, stateFrom(world, containers, farming), world);

    const loaded = await loadWorldData(meta.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.mods.size).toBe(2);
    // a fresh world regenerates terrain from the seed and re-applies the edits
    const world2 = new World(loaded!.meta.seed);
    for (const [k, list] of loaded!.mods) world2.loadMods(k, list);
    loadChunkInto(world2, 0, 0);
    loadChunkInto(world2, -1, 0);
    expect(world2.get(3, y, 3)).toBe(B.PLANKS);
    expect(world2.get(3, y + 1, 3)).toBe(B.PLANKS);
    expect(world2.get(-2, 5, 4)).toBe(dug);
    expect(world2.get(-2, 5, 4)).toBe(0);
    // the save is small: a handful of entries, not whole chunks
    const total = [...loaded!.mods.values()].reduce((n, l) => n + l.length, 0);
    expect(total).toBe(3);
    expect(ckey(0, 0)).toBe(ckey(Math.floor(3 / CHUNK_SIZE), 0));
  });

  it('crafted items and chest contents persist', async () => {
    const meta = await createWorld({ name: 'Crafter', seedText: 'c', difficulty: 'explorer', peacefulCreatures: false });
    const world = new World(meta.seed);
    const inv = useInventoryStore.getState();
    inv.add('scrap_axe', 1);
    inv.add('planks', 12);
    const containers = new ContainerSystem();
    const slots = containers.get('5,60,5', meta.seed, false);
    slots[0] = makeStack('sunapple', 3);
    containers.set('5,60,5', slots);
    const farming = new FarmingSystem();
    farming.crops.set('1,60,1', { planted: 50 });
    await writeSave(meta, stateFrom(world, containers, farming), world);

    useInventoryStore.getState().reset();
    const loaded = await loadWorldData(meta.id);
    const st = loaded!.state!;
    useInventoryStore.getState().load(st.inventory);
    const counts = useInventoryStore.getState().slots.filter(Boolean).map((s) => `${s!.item}:${s!.count}`);
    expect(counts).toContain('scrap_axe:1');
    expect(counts).toContain('planks:12');
    const c2 = new ContainerSystem();
    c2.load(st.containers);
    expect(c2.containers.get('5,60,5')![0]).toEqual({ item: 'sunapple', count: 3 });
    const f2 = new FarmingSystem();
    f2.load(st.farming);
    expect(f2.crops.get('1,60,1')!.planted).toBe(50);
    expect(st.player.vitality).toBe(88);
    expect(st.saveVersion).toBe(SAVE_VERSION);
  });

  it('migrates old saves instead of discarding them', () => {
    const old = { id: 'x', player: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vitality: 50, energy: 50, buffs: [] }, inventory: { slots: [], equipment: {}, selected: 0 }, progress: {}, time: 5 } as unknown as WorldStateSave;
    const m = migrateState(old);
    expect(m.saveVersion).toBe(SAVE_VERSION);
    expect(m.containers).toEqual([]);
    expect(m.farming).toEqual({ crops: [], bushes: [] });
    expect(m.time).toBe(5);
  });

  it('keeps Build Home projects separate and round-trips placed objects', async () => {
    const surv = await createWorld({ name: 'Wilds', seedText: 's', difficulty: 'explorer', peacefulCreatures: false });
    const meta = await createWorld({
      name: 'Dream House', seedText: '', difficulty: 'peaceful', peacefulCreatures: true, mode: 'build',
      build: { plot: 'lakeside', timeOfDay: 'golden', timeLocked: true, weather: 'clear', theme: 'scandinavian' },
    });
    const list = await listWorlds();
    expect(list.find((w) => w.id === surv.id)!.mode).toBe('survival');
    const bm = list.find((w) => w.id === meta.id)!;
    expect(bm.mode).toBe('build');
    expect(bm.build?.plot).toBe('lakeside');
    const world = new World(meta.seed, 'lakeside');
    const state = stateFrom(world, new ContainerSystem(), new FarmingSystem());
    state.build = {
      objects: [
        { id: 1, itemId: 'sofa_3', x: 1.5, y: 41, z: 2, rotation: Math.PI, variantId: 'sage' },
        { id: 7, itemId: 'ceiling_light', x: 0.5, y: 43.9, z: 0.5, rotation: 0, variantId: 'default', state: { on: false } },
      ],
      nextId: 8,
    };
    await writeSave(bm, state, world);
    const loaded = (await loadWorldData(meta.id))!;
    expect(loaded.meta.mode).toBe('build');
    expect(loaded.state!.build!.objects).toHaveLength(2);
    expect(loaded.state!.build!.objects[1].state).toEqual({ on: false });
    expect(loaded.state!.build!.nextId).toBe(8);
    // the survival world has no build data
    const sl = await loadWorldData(surv.id);
    expect(sl!.state?.build).toBeUndefined();
  });

  it('restores the previous autosave when the latest save is damaged (never silently discards)', async () => {
    const meta = await createWorld({ name: 'Fragile', seedText: 'f', difficulty: 'explorer', peacefulCreatures: false });
    const world = new World(meta.seed);
    const good = stateFrom(world, new ContainerSystem(), new FarmingSystem());
    good.player.x = 11;
    await writeSave(meta, good, world);
    const newer = stateFrom(world, new ContainerSystem(), new FarmingSystem());
    newer.player.x = 22;
    await writeSave(meta, newer, world); // the first save becomes the backup
    const store = await getStore();
    await store.putState({ ...newer, id: meta.id, player: { ...newer.player, x: Number.NaN } } as WorldStateSave);
    const origError = console.error;
    console.error = () => {};
    try {
      const loaded = await loadWorldData(meta.id);
      expect(loaded!.state!.player.x).toBe(11);
    } finally {
      console.error = origError;
    }
  });

  it('retains failed block writes for retry instead of silently marking them saved', async () => {
    const meta = await createWorld({ name: 'Retry', seedText: 'retry', difficulty: 'explorer', peacefulCreatures: false });
    const world = new World(meta.seed);
    world.addChunk(Chunk.empty(0, 0));
    world.set(2, 20, 2, B.PLANKS);
    const state = stateFrom(world, new ContainerSystem(), new FarmingSystem());
    const store = await getStore();
    const failure = vi.spyOn(store, 'commitSave').mockRejectedValueOnce(new Error('storage full'));
    try {
      await expect(writeSave(meta, state, world)).rejects.toThrow('storage full');
      expect(world.dirtyMods.has(ckey(0, 0))).toBe(true);
      await writeSave(meta, state, world);
      expect(world.dirtyMods.size).toBe(0);
      expect((await loadWorldData(meta.id))!.mods.get(ckey(0, 0))).toHaveLength(1);
    } finally { failure.mockRestore(); }
  });

  it('keeps edits made during a save pending for the next save, including the same chunk', async () => {
    const meta = await createWorld({ name: 'Concurrent', seedText: 'concurrent', difficulty: 'explorer', peacefulCreatures: false });
    const world = new World(meta.seed);
    world.addChunk(Chunk.empty(0, 0));
    world.set(2, 20, 2, B.PLANKS);
    const state = stateFrom(world, new ContainerSystem(), new FarmingSystem());
    const store = await getStore();
    const original = store.commitSave.bind(store);
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const delayed = vi.spyOn(store, 'commitSave').mockImplementationOnce(async (...args) => {
      started(); await gate; return original(...args);
    });
    try {
      const pending = writeSave(meta, state, world);
      await entered;
      world.set(2, 20, 2, B.STONE);
      world.set(3, 20, 2, B.PLANKS);
      release(); await pending;
      expect(world.dirtyMods.has(ckey(0, 0))).toBe(true);
      expect((await loadWorldData(meta.id))!.mods.get(ckey(0, 0))).toHaveLength(1);
      await writeSave(meta, state, world);
      const loaded = (await loadWorldData(meta.id))!;
      const restored = new World(meta.seed);
      for (const [k, changes] of loaded.mods) restored.loadMods(k, changes);
      restored.addChunk(Chunk.empty(0, 0));
      expect(restored.get(2, 20, 2)).toBe(B.STONE);
      expect(restored.get(3, 20, 2)).toBe(B.PLANKS);
      expect(world.dirtyMods.size).toBe(0);
    } finally { release(); delayed.mockRestore(); }
  });

  it('rolls back state, edits and metadata together if a later write cannot be cloned', async () => {
    const meta = await createWorld({ name: 'Atomic', seedText: 'atomic', difficulty: 'explorer', peacefulCreatures: false });
    const world = new World(meta.seed);
    world.addChunk(Chunk.empty(0, 0));
    world.set(2, 20, 2, B.PLANKS);
    const state = stateFrom(world, new ContainerSystem(), new FarmingSystem());
    await writeSave(meta, state, world);
    world.set(2, 20, 2, B.STONE);
    const invalidMeta = Object.assign({}, meta, { name: 'Must not commit', uncloneable: () => {} });
    await expect(writeSave(invalidMeta, { ...state, time: 9999 }, world)).rejects.toThrow();
    const loaded = (await loadWorldData(meta.id))!;
    expect(loaded.meta.name).toBe('Atomic');
    expect(loaded.state!.time).toBe(state.time);
    expect(loaded.mods.get(ckey(0, 0))![0][1] & 255).toBe(B.PLANKS);
    expect(world.dirtyMods.has(ckey(0, 0))).toBe(true);
    expect(await (await getStore()).getBackup(meta.id)).toBeUndefined();
  });

  it('keeps the temporary-memory backend atomic and recoverable when browser storage is blocked', async () => {
    await resetStoreForTests();
    vi.stubGlobal('indexedDB', undefined);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const meta = await createWorld({ name: 'Temporary', seedText: 'temporary', difficulty: 'explorer', peacefulCreatures: false });
      const store = await getStore();
      expect(store.persistent).toBe(false);
      const world = new World(meta.seed);
      world.addChunk(Chunk.empty(0, 0));
      world.set(2, 20, 2, B.PLANKS);
      const state = stateFrom(world, new ContainerSystem(), new FarmingSystem());
      await writeSave(meta, state, world);
      world.set(2, 20, 2, B.STONE);
      const invalidMeta = Object.assign({}, meta, { name: 'Must not commit', uncloneable: () => {} });
      await expect(writeSave(invalidMeta, { ...state, time: 9999 }, world)).rejects.toThrow();
      const loaded = (await loadWorldData(meta.id))!;
      expect(loaded.meta.name).toBe('Temporary');
      expect(loaded.state!.time).toBe(state.time);
      expect(loaded.mods.get(ckey(0, 0))![0][1] & 255).toBe(B.PLANKS);
      expect(world.dirtyMods.has(ckey(0, 0))).toBe(true);
      await writeSave(meta, { ...state, time: 100 }, world);
      expect((await store.getBackup(meta.id))!.time).toBe(state.time);
      expect((await loadWorldData(meta.id))!.state!.time).toBe(100);
    } finally {
      warning.mockRestore();
      vi.unstubAllGlobals();
      await resetStoreForTests();
    }
  });
});
