import { ARCH_MATERIALS } from './architecture';
import { BLOCK_DEFS } from './blocks';
import { CREATURES } from './creatures';
import { hasItem, ITEM_DEFS, itemDef } from './items';
import { HOMESTEAD_LEVELS, QUESTS } from './progression';
import { RECIPES, STATION_BLOCKS, STATION_NAMES, type Recipe } from './recipes';
import { MODELS } from '../game/world/shapes';
import { TILE_NAMES } from '../game/world/tiles';
import { LOOT_TABLE, LOOT_TOOLS } from '../game/systems/ContainerSystem';

/**
 * Content validator (run by `npm run validate:data` and the unit tests).
 *
 * Checks every block, item and recipe for broken references, then builds the
 * crafting dependency graph and computes what a survival player can actually
 * obtain, starting from world-generated blocks, creature drops/gifts, ruin
 * loot and quest rewards. Anything used by a recipe that can never be
 * obtained is an error, as are unobtainable stations, self-consuming recipes
 * and dependency deadlocks.
 */
export interface ValidationReport {
  errors: string[];
  warnings: string[];
  stats: Record<string, number>;
  /** Items reachable in survival and how (first source found). */
  obtainable: Map<string, string>;
}

type Extra = (r: ValidationReport) => void;
const extraValidators: { name: string; fn: Extra }[] = [];

/** Other modules (build catalog, furniture) register their own checks. */
export function registerValidator(name: string, fn: Extra): void {
  if (!extraValidators.some((v) => v.name === name)) extraValidators.push({ name, fn });
}

export function validateData(): ValidationReport {
  const rep: ValidationReport = { errors: [], warnings: [], stats: {}, obtainable: new Map() };
  const err = (m: string) => rep.errors.push(m);
  const warn = (m: string) => rep.warnings.push(m);
  const tiles = new Set<string>(TILE_NAMES);

  // ---------------------------------------------------------------- blocks
  const blockKeys = new Set<string>();
  if (BLOCK_DEFS.length > 255) err(`block ids overflow Uint8 storage (${BLOCK_DEFS.length})`);
  BLOCK_DEFS.forEach((b, id) => {
    if (blockKeys.has(b.key)) err(`block ${b.key}: duplicate key`);
    blockKeys.add(b.key);
    if (!b.name) err(`block ${b.key}: missing display name`);
    if (b.tiles) for (const t of [b.tiles.top, b.tiles.side, b.tiles.bottom]) if (!tiles.has(t)) err(`block ${b.key}: missing texture tile ${t}`);
    if (b.shape === 'cube' && !b.tiles) err(`block ${b.key}: cube without tiles`);
    if (b.shape === 'cross' && !b.tiles) err(`block ${b.key}: plant without tile`);
    if (b.model) {
      const ok = b.model === 'door' ? !!(MODELS.door_open && MODELS.door_closed) : b.model === 'gate' ? !!(MODELS.gate_open && MODELS.gate_closed) : !!MODELS[b.model];
      if (!ok) err(`block ${b.key}: missing model ${b.model}`);
    }
    if (b.shape === 'model' && !b.model) err(`block ${b.key}: model shape without model`);
    if (b.shape === 'arch' && !b.arch) err(`block ${b.key}: arch shape without arch definition`);
    if (b.modelTile && !tiles.has(b.modelTile)) err(`block ${b.key}: missing model tile ${b.modelTile}`);
    if (id === 0) return;
    const drops = b.drop === undefined ? [b.key] : b.drop ? [b.drop] : [];
    for (const d of drops) if (b.hardness !== Infinity && b.key !== 'water' && !hasItem(d)) err(`block ${b.key}: drops unknown item ${d}`);
    for (const x of b.bonusDrops ?? []) if (!hasItem(x.item)) err(`block ${b.key}: bonus drop unknown item ${x.item}`);
    if (b.growth) {
      if (!hasItem(b.growth.harvest)) err(`block ${b.key}: harvest item ${b.growth.harvest} missing`);
      if (!hasItem(b.growth.seed)) err(`block ${b.key}: seed item ${b.growth.seed} missing`);
    }
    if (b.station && !STATION_NAMES[b.station]) err(`block ${b.key}: unknown station ${b.station}`);
  });
  rep.stats.blocks = BLOCK_DEFS.length;

  // ---------------------------------------------------------------- architecture materials
  const matKeys = new Set<string>();
  ARCH_MATERIALS.forEach((m) => {
    if (matKeys.has(m.key)) err(`material ${m.key}: duplicate key`);
    matKeys.add(m.key);
    if (!tiles.has(m.tile)) err(`material ${m.key}: missing tile ${m.tile}`);
    if (m.topTile && !tiles.has(m.topTile)) err(`material ${m.key}: missing top tile ${m.topTile}`);
    if (!/^#[0-9a-f]{6}$/i.test(m.tint)) err(`material ${m.key}: bad tint ${m.tint}`);
  });
  if (ARCH_MATERIALS.length > 64) warn(`only the first 64 materials fit rotated shapes (have ${ARCH_MATERIALS.length})`);
  rep.stats.materials = ARCH_MATERIALS.length;

  // ---------------------------------------------------------------- items
  const itemKeys = new Set<string>();
  for (const it of ITEM_DEFS) {
    if (itemKeys.has(it.key)) err(`item ${it.key}: duplicate key`);
    itemKeys.add(it.key);
    if (!it.name) err(`item ${it.key}: missing display name`);
    if (it.maxStack < 1) err(`item ${it.key}: maxStack must be ≥ 1`);
    if ((it.tool || it.equip) && it.maxStack !== 1) err(`item ${it.key}: tools/equipment must not stack (maxStack ${it.maxStack})`);
    if (it.tool && Number.isFinite(it.tool.durability) && it.tool.durability <= 0) err(`item ${it.key}: tool durability must be > 0`);
    if (it.placeBlock && !blockKeys.has(it.placeBlock)) err(`item ${it.key}: places unknown block ${it.placeBlock}`);
    if (it.placeMeta !== undefined && it.placeBlock) {
      const b = BLOCK_DEFS.find((x) => x.key === it.placeBlock);
      if (!b?.arch && it.placeMeta !== 0) warn(`item ${it.key}: placeMeta on a non-architecture block`);
    }
    if (it.plantsCrop && !blockKeys.has(it.plantsCrop)) err(`item ${it.key}: plants unknown crop ${it.plantsCrop}`);
    if ('block' in it.icon) {
      if (!blockKeys.has(it.icon.block)) err(`item ${it.key}: icon references unknown block ${it.icon.block}`);
    } else if (!it.icon.shape || !it.icon.colors?.length) err(`item ${it.key}: icon has no shape/colours`);
    if (it.food && (it.food.vitality < 0 || it.food.energy < 0)) err(`item ${it.key}: negative food values`);
  }
  rep.stats.items = ITEM_DEFS.length;

  // placeable blocks with a build category should be obtainable as an item or be placed by the catalog
  // (checked in the build catalog validator)

  // ---------------------------------------------------------------- recipes
  const recipeIds = new Set<string>();
  const maxLevel = HOMESTEAD_LEVELS.length;
  for (const r of RECIPES) {
    const tag = `recipe ${r.id}`;
    if (!r.id) err(`recipe for ${r.output.item}: missing id`);
    if (recipeIds.has(r.id)) err(`${tag}: duplicate id`);
    recipeIds.add(r.id);
    if (!hasItem(r.output.item)) err(`${tag}: output item ${r.output.item} does not exist`);
    if (!(r.output.count > 0)) err(`${tag}: output amount must be > 0`);
    if (!r.inputs.length) err(`${tag}: no ingredients`);
    const seen = new Set<string>();
    for (const ing of r.inputs) {
      if (!hasItem(ing.item)) err(`${tag}: missing ingredient ${ing.item}`);
      if (!(ing.count > 0)) err(`${tag}: ingredient ${ing.item} count must be > 0`);
      if (seen.has(ing.item)) warn(`${tag}: ingredient ${ing.item} listed twice`);
      seen.add(ing.item);
      if (ing.item === r.output.item) err(`${tag}: requires its own output`);
    }
    if (r.station !== null && !STATION_NAMES[r.station]) err(`${tag}: unknown workstation ${r.station}`);
    if ((r.homestead ?? 1) > maxLevel) err(`${tag}: homestead level ${r.homestead} is unreachable (max ${maxLevel})`);
    if (hasItem(r.output.item) && !itemDef(r.output.item).name) err(`${tag}: output has no display name`);
  }
  rep.stats.recipes = RECIPES.length;

  // stations → blocks must exist and have items
  for (const [st, blocks] of Object.entries(STATION_BLOCKS)) {
    for (const b of blocks) {
      if (!blockKeys.has(b)) err(`station ${st}: provided by unknown block ${b}`);
      const def = BLOCK_DEFS.find((x) => x.key === b);
      if (def && def.station !== st) err(`station ${st}: block ${b} does not declare station ${st}`);
    }
  }
  for (const b of BLOCK_DEFS) if (b.station && !(STATION_BLOCKS[b.station] ?? []).includes(b.key)) err(`block ${b.key}: station ${b.station} missing from STATION_BLOCKS`);

  // ---------------------------------------------------------------- obtainability graph
  const got = rep.obtainable;
  const add = (item: string, how: string) => {
    if (!got.has(item) && hasItem(item)) got.set(item, how);
  };
  for (const b of BLOCK_DEFS) {
    if (!b.natural) continue;
    if (b.hardness !== Infinity && b.key !== 'water') {
      const drop = b.drop === undefined ? b.key : b.drop;
      if (drop) add(drop, `mined from ${b.key}`);
    }
    for (const x of b.bonusDrops ?? []) add(x.item, `bonus drop from ${b.key}`);
    if (b.growth) {
      add(b.growth.harvest, `harvested from wild ${b.key}`);
      add(b.growth.seed, `harvested from wild ${b.key}`);
    }
    if (b.key === 'berry_bush') add('bramble_berries', 'picked from bramble bushes');
  }
  for (const c of Object.values(CREATURES)) {
    for (const d of c.drops ?? []) add(d.item, `dropped by ${c.kind}`);
    if (c.gift) add(c.gift.item, `gift from ${c.kind}`);
  }
  for (const [item] of LOOT_TABLE) add(item, 'ruin chest loot');
  for (const t of LOOT_TOOLS) add(t, 'ruin chest loot');
  for (const q of QUESTS) for (const rw of q.reward) add(rw.item, `quest reward (${q.id})`);

  const stationObtainable = (r: Recipe) => r.station === null || (STATION_BLOCKS[r.station] ?? []).some((b) => got.has(b));
  let changed = true;
  let rounds = 0;
  while (changed && rounds < 64) {
    changed = false;
    rounds++;
    for (const r of RECIPES) {
      if (got.has(r.output.item)) continue;
      if (!stationObtainable(r)) continue;
      if (r.inputs.every((i) => got.has(i.item))) {
        add(r.output.item, `crafted (${r.station ?? 'backpack'})`);
        changed = true;
      }
    }
  }
  // Items whose only sources are loot/quests are fine but noted once; unreachable recipes are errors.
  for (const r of RECIPES) {
    const missing = r.inputs.filter((i) => !got.has(i.item)).map((i) => i.item);
    if (missing.length) err(`recipe ${r.id}: dependency deadlock — unobtainable ingredient(s) ${missing.join(', ')}`);
    if (!stationObtainable(r)) err(`recipe ${r.id}: workstation ${r.station} can never be built`);
  }
  for (const st of Object.keys(STATION_BLOCKS) as (keyof typeof STATION_BLOCKS)[]) {
    if (!STATION_BLOCKS[st].some((b) => got.has(b))) err(`station ${st}: not obtainable in survival`);
  }
  for (const it of ITEM_DEFS) {
    if (!got.has(it.key)) warn(`item ${it.key}: not obtainable in survival (catalog-only or unused)`);
  }

  // cycles in the recipe graph (only a problem when nothing outside the cycle supplies it — covered above)
  const producers = new Map<string, Recipe[]>();
  for (const r of RECIPES) producers.set(r.output.item, [...(producers.get(r.output.item) ?? []), r]);
  const visiting = new Set<string>(), done = new Set<string>();
  const cycles: string[][] = [];
  const dfs = (item: string, path: string[]) => {
    if (done.has(item)) return;
    if (visiting.has(item)) {
      cycles.push([...path.slice(path.indexOf(item)), item]);
      return;
    }
    visiting.add(item);
    for (const r of producers.get(item) ?? []) for (const i of r.inputs) dfs(i.item, [...path, item]);
    visiting.delete(item);
    done.add(item);
  };
  for (const it of producers.keys()) dfs(it, []);
  for (const c of cycles) {
    const external = c.some((it) => got.get(it)?.startsWith('crafted') === false);
    if (!external) warn(`recipe cycle ${c.join(' → ')}`);
  }
  rep.stats.obtainable = got.size;

  for (const v of extraValidators) v.fn(rep);
  return rep;
}

export function formatReport(rep: ValidationReport): string {
  const lines: string[] = [];
  const s = rep.stats;
  lines.push(`✓ ${s.blocks} blocks validated`);
  lines.push(`✓ ${s.items} items validated`);
  lines.push(`✓ ${s.recipes} recipes validated`);
  lines.push(`✓ ${s.materials} architecture materials validated`);
  if (s.catalog !== undefined) lines.push(`✓ ${s.catalog} build catalog items validated`);
  if (s.objects !== undefined) lines.push(`✓ ${s.objects} furniture / object models validated`);
  lines.push(`✓ ${s.obtainable} items obtainable in survival`);
  lines.push(rep.errors.length ? `✗ ${rep.errors.length} error(s)` : '✓ no broken dependencies');
  for (const e of rep.errors) lines.push(`ERROR ${e}`);
  for (const w of rep.warnings) lines.push(`warn  ${w}`);
  return lines.join('\n');
}
