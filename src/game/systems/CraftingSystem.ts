import { BLOCK_DEFS, type StationKind } from '../../data/blocks';
import { itemDef } from '../../data/items';
import { RECIPES, STATION_NAMES, type Recipe } from '../../data/recipes';
import { addStack, cloneSlots, craftableTimes, hasIngredients, makeStack, removeItem, type Slots } from './InventoryLogic';

/** Pure crafting rules (unit tested). */
export function recipeUnlocked(r: Recipe, homesteadLevel: number): boolean {
  return (r.homestead ?? 1) <= homesteadLevel;
}

export function stationAvailable(r: Recipe, stations: Set<StationKind>): boolean {
  return r.station === null || stations.has(r.station);
}

export function canCraft(r: Recipe, slots: Slots, stations: Set<StationKind>, homesteadLevel: number): boolean {
  return recipeUnlocked(r, homesteadLevel) && stationAvailable(r, stations) && hasIngredients(slots, r.inputs) && outputFits(r, slots);
}

export function maxCrafts(r: Recipe, slots: Slots): number {
  return craftableTimes(slots, r.inputs);
}

/**
 * Would crafting `times` copies fit in the backpack? Ingredients are removed
 * first (freeing their slots) before the output is added, like the real craft.
 */
export function outputFits(r: Recipe, slots: Slots, times = 1): boolean {
  const sim = cloneSlots(slots);
  for (let t = 0; t < times; t++) {
    for (const ing of r.inputs) removeItem(sim, ing.item, ing.count);
    if (addStack(sim, makeStack(r.output.item, r.output.count)) > 0) return false;
  }
  return true;
}

export type CraftState = 'ok' | 'locked' | 'station' | 'ingredients' | 'full';

/** Why a recipe can or cannot be crafted right now (recipes are always listed, never hidden). */
export function craftState(r: Recipe, slots: Slots, stations: Set<StationKind>, homesteadLevel: number): CraftState {
  if (!recipeUnlocked(r, homesteadLevel)) return 'locked';
  if (!stationAvailable(r, stations)) return 'station';
  if (!hasIngredients(slots, r.inputs)) return 'ingredients';
  if (!outputFits(r, slots)) return 'full';
  return 'ok';
}

/** How many times the recipe can actually be made (ingredients and backpack space). */
export function maxCraftsFitting(r: Recipe, slots: Slots): number {
  let n = maxCrafts(r, slots);
  while (n > 0 && !outputFits(r, slots, n)) n--;
  return n;
}

/** Text a recipe matches in search: output name, key, category, station and ingredient names. */
export function recipeSearchText(r: Recipe): string {
  const out = itemDef(r.output.item);
  return [out.name, out.key, r.category, r.station ? STATION_NAMES[r.station] : 'anywhere backpack', ...r.inputs.map((i) => itemDef(i.item).name)].join(' ').toLowerCase();
}

export function recipesFor(station: StationKind | null | 'all'): Recipe[] {
  if (station === 'all') return RECIPES;
  return RECIPES.filter((r) => r.station === station);
}

/** Every station block within `radius` blocks of a point. */
export function nearbyStations(get: (x: number, y: number, z: number) => number, px: number, py: number, pz: number, radius = 4): Set<StationKind> {
  const out = new Set<StationKind>();
  const x0 = Math.floor(px), y0 = Math.floor(py), z0 = Math.floor(pz);
  for (let y = y0 - 2; y <= y0 + 3; y++)
    for (let z = z0 - radius; z <= z0 + radius; z++)
      for (let x = x0 - radius; x <= x0 + radius; x++) {
        const d = BLOCK_DEFS[get(x, y, z)];
        if (d?.station) out.add(d.station);
      }
  return out;
}

export function describeOutput(r: Recipe): string {
  const d = itemDef(r.output.item);
  return r.output.count > 1 ? `${d.name} ×${r.output.count}` : d.name;
}
