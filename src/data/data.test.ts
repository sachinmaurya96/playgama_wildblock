import { describe, expect, it } from 'vitest';
import { BIOMES } from './biomes';
import { BLOCK_DEFS } from './blocks';
import { CREATURES } from './creatures';
import { hasItem, ITEM_DEFS } from './items';
import { QUESTS } from './progression';
import { RECIPES } from './recipes';
import { hasBlock } from '../game/world/BlockRegistry';
import { TILE_NAMES } from '../game/world/tiles';
import { MODELS } from '../game/world/shapes';
import { canCraft, nearbyStations, recipeUnlocked } from '../game/systems/CraftingSystem';
import { addStack, makeStack, type Slots } from '../game/systems/InventoryLogic';

describe('content integrity', () => {
  it('uses at most 255 block ids (Uint8 storage)', () => {
    expect(BLOCK_DEFS.length).toBeLessThan(256);
    expect(BLOCK_DEFS[0].key).toBe('air');
  });

  it('every block drop / bonus drop is a real item', () => {
    for (const b of BLOCK_DEFS) {
      if (b.key === 'air' || b.key === 'water' || b.hardness === Infinity) continue;
      const drop = b.drop === undefined ? b.key : b.drop;
      if (drop) expect(hasItem(drop)).toBe(true);
      for (const x of b.bonusDrops ?? []) expect(hasItem(x.item)).toBe(true);
      if (b.growth) {
        expect(hasItem(b.growth.harvest)).toBe(true);
        expect(hasItem(b.growth.seed)).toBe(true);
      }
    }
  });

  it('every placeable item and crop points at a real block', () => {
    for (const i of ITEM_DEFS) {
      if (i.placeBlock) expect(hasBlock(i.placeBlock)).toBe(true);
      if (i.plantsCrop) expect(hasBlock(i.plantsCrop)).toBe(true);
    }
  });

  it('every tile and model referenced exists', () => {
    const tiles = new Set<string>(TILE_NAMES);
    for (const b of BLOCK_DEFS) {
      if (b.tiles) for (const t of [b.tiles.top, b.tiles.side, b.tiles.bottom]) expect(tiles.has(t)).toBe(true);
      if (b.model && b.model !== 'door' && b.model !== 'gate') expect(MODELS[b.model]).toBeDefined();
      if (b.model === 'gate') expect(MODELS.gate_open && MODELS.gate_closed).toBeDefined();
      if (b.modelTile) expect(tiles.has(b.modelTile)).toBe(true);
    }
  });

  it('recipes only use real items and have unique ids', () => {
    const ids = new Set<string>();
    for (const r of RECIPES) {
      expect(ids.has(r.id)).toBe(false);
      ids.add(r.id);
      expect(hasItem(r.output.item)).toBe(true);
      for (const i of r.inputs) expect(hasItem(i.item)).toBe(true);
    }
    expect(RECIPES.length).toBeGreaterThan(50);
  });

  it('meets the MVP content targets', () => {
    expect(BIOMES.length).toBe(6);
    expect(BLOCK_DEFS.length).toBeGreaterThanOrEqual(35);
    const creatures = Object.values(CREATURES);
    expect(creatures.filter((c) => !c.hostile).length).toBeGreaterThanOrEqual(4);
    expect(creatures.filter((c) => c.hostile).length).toBeGreaterThanOrEqual(4);
    expect(ITEM_DEFS.filter((i) => i.tool).length).toBeGreaterThanOrEqual(10);
    expect(BLOCK_DEFS.filter((b) => b.growth).length).toBeGreaterThanOrEqual(4);
    expect(BLOCK_DEFS.filter((b) => b.category === 'Furniture' || b.category === 'Decoration' || b.category === 'Storage' || b.category === 'Lighting').length).toBeGreaterThanOrEqual(15);
  });

  it('creature foods, gifts and drops and quest rewards exist', () => {
    for (const c of Object.values(CREATURES)) {
      for (const f of c.favoriteFood ?? []) expect(hasItem(f)).toBe(true);
      if (c.gift) expect(hasItem(c.gift.item)).toBe(true);
      for (const d of c.drops ?? []) expect(hasItem(d.item)).toBe(true);
    }
    for (const q of QUESTS) for (const r of q.reward) expect(hasItem(r.item)).toBe(true);
  });
});

describe('crafting rules', () => {
  const slots = (): Slots => {
    const s: Slots = new Array(10).fill(null);
    addStack(s, makeStack('planks', 20));
    addStack(s, makeStack('log', 3));
    addStack(s, makeStack('rope', 2));
    addStack(s, makeStack('stick', 4));
    return s;
  };
  const byOut = (item: string) => RECIPES.find((r) => r.output.item === item)!;

  it('backpack recipes need no station', () => {
    expect(canCraft(byOut('scrap_axe'), slots(), new Set(), 1)).toBe(true);
    expect(canCraft(byOut('workbench'), slots(), new Set(), 1)).toBe(true);
  });

  it('station recipes need the station nearby', () => {
    const chest = byOut('chest');
    expect(canCraft(chest, slots(), new Set(), 1)).toBe(false);
    expect(canCraft(chest, slots(), new Set(['workbench']), 1)).toBe(true);
  });

  it('homestead level gates advanced recipes', () => {
    const shelf = byOut('shelf');
    expect(recipeUnlocked(shelf, 1)).toBe(false);
    expect(recipeUnlocked(shelf, 2)).toBe(true);
  });

  it('finds stations placed around a point', () => {
    const wb = BLOCK_DEFS.findIndex((b) => b.key === 'workbench');
    const forge = BLOCK_DEFS.findIndex((b) => b.key === 'forge');
    const get = (x: number, y: number, z: number) => (x === 2 && y === 10 && z === 1 ? wb : x === -3 && y === 11 && z === 0 ? forge : 0);
    const st = nearbyStations(get, 0, 10, 0, 4);
    expect(st.has('workbench')).toBe(true);
    expect(st.has('forge')).toBe(true);
    expect(st.has('cooking_fire')).toBe(false);
  });
});
