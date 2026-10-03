import { describe, expect, it } from 'vitest';
import { formatReport, validateData } from './validation';
import './buildCatalog';
import './buildChallenges';
import { RECIPES } from './recipes';
import { craftState, maxCraftsFitting, outputFits, recipeSearchText } from '../game/systems/CraftingSystem';
import { makeStack, type Slots } from '../game/systems/InventoryLogic';
import type { StationKind } from './blocks';

describe('data validation (npm run validate:data)', () => {
  const rep = validateData();
  it('finds no errors in blocks, items, recipes, materials, catalog and models', () => {
    if (rep.errors.length) console.log(formatReport(rep));
    expect(rep.errors).toEqual([]);
  });
  it('every recipe output and ingredient is obtainable in survival', () => {
    for (const r of RECIPES) {
      expect(rep.obtainable.has(r.output.item)).toBe(true);
      for (const i of r.inputs) expect(rep.obtainable.has(i.item)).toBe(true);
    }
  });
  it('covers the core building pieces with survival recipes', () => {
    const outs = new Set(RECIPES.map((r) => r.output.item));
    for (const k of ['planks', 'plaster_wall', 'cut_stone', 'brick', 'glass', 'glass_wall', 'door', 'window', 'plank_stairs', 'stone_stairs',
      'plank_slab', 'fence', 'fence_gate', 'chest', 'workbench', 'bed', 'torch', 'lantern', 'clay_roof', 'shingle_roof', 'table', 'chair']) {
      expect(outs.has(k)).toBe(true);
    }
  });
});

describe('recipe availability rules', () => {
  const planks = RECIPES.find((r) => r.output.item === 'planks')!;
  const chest = RECIPES.find((r) => r.output.item === 'chest')!;
  const none = new Set<StationKind>();
  it('reports missing station / ingredients / lock without hiding the recipe', () => {
    const slots: Slots = new Array(10).fill(null);
    expect(craftState(chest, slots, none, 1)).toBe('station');
    expect(craftState(chest, slots, new Set<StationKind>(['workbench']), 1)).toBe('ingredients');
    const pens = RECIPES.find((r) => (r.homestead ?? 1) > 1)!;
    expect(craftState(pens, slots, new Set<StationKind>([pens.station!]), 1)).toBe('locked');
  });
  it('disables crafting when the output would not fit (never deletes items)', () => {
    // backpack full of unrelated full stacks + one log
    const slots: Slots = new Array(4).fill(null).map(() => makeStack('fieldstone', 64));
    slots[3] = makeStack('log', 1);
    // the log slot frees up when consumed → planks fit
    expect(outputFits(planks, slots)).toBe(true);
    slots[3] = makeStack('log', 2);
    expect(outputFits(planks, slots)).toBe(false);
    expect(craftState(planks, slots, none, 1)).toBe('full');
    expect(maxCraftsFitting(planks, slots)).toBe(0);
  });
  it('searches by ingredient and station names', () => {
    expect(recipeSearchText(chest)).toContain('workbench');
    expect(recipeSearchText(chest)).toContain('boards');
  });
});
