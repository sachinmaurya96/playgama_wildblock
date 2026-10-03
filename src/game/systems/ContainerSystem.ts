import { mulberry32, hash3 } from '../core/random';
import { CONTAINER_SIZE } from '../../stores/inventoryStore';
import { makeStack, type Slots } from './InventoryLogic';

/**
 * Container contents keyed by world position ("x,y,z"). Stored independently
 * of React so they persist through the save system and survive UI remounts.
 * Landmark chests are filled with deterministic loot the first time they open.
 */
export class ContainerSystem {
  readonly containers = new Map<string, Slots>();
  /** Keys changed since the last save. */
  readonly dirty = new Set<string>();

  static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  get(key: string, seed: number, loot: boolean): Slots {
    let c = this.containers.get(key);
    if (!c) {
      c = new Array(CONTAINER_SIZE).fill(null);
      if (loot) fillLoot(c, key, seed);
      this.containers.set(key, c);
      this.dirty.add(key);
    }
    return c;
  }

  set(key: string, slots: Slots): void {
    this.containers.set(key, slots.map((s) => (s ? { ...s } : null)));
    this.dirty.add(key);
  }

  /** Remove a container (block broken); returns its contents to drop. */
  take(key: string): Slots {
    const c = this.containers.get(key) ?? [];
    this.containers.delete(key);
    this.dirty.add(key);
    return c;
  }

  load(entries: [string, Slots][]): void {
    this.containers.clear();
    for (const [k, v] of entries) this.containers.set(k, v);
  }
}

/** Ruin chest loot: item, weight, min, max (exported for the data validator). */
export const LOOT_TABLE: [string, number, number, number][] = [
  // item, weight, min, max
  ['sunapple', 5, 1, 3], ['bramble_berries', 5, 2, 5], ['torch', 5, 2, 6], ['rope', 4, 1, 3], ['raw_copper', 4, 1, 3],
  ['emberite', 4, 2, 5], ['glow_crystal', 2, 1, 2], ['sunwheat_seeds', 3, 2, 4], ['puffgourd_seeds', 2, 1, 3], ['brookmint', 3, 1, 3],
  ['copper_ingot', 2, 1, 2], ['trail_mix', 2, 1, 2], ['moonstone', 0.6, 1, 1], ['raw_ferra', 2, 1, 2], ['emberroot', 3, 2, 4],
  ['clay_lump', 3, 2, 5], ['glass', 1.5, 1, 3], ['lantern', 1, 1, 1], ['moss_fleece', 1.5, 1, 2],
];

/** Rare tool finds in ruin chests. */
export const LOOT_TOOLS = ['copper_pick', 'copper_axe'];

function fillLoot(c: Slots, key: string, seed: number) {
  const [x, y, z] = key.split(',').map(Number);
  const rng = mulberry32(Math.floor(hash3(x, y, z, seed ^ 0x10ad) * 4294967295));
  const total = LOOT_TABLE.reduce((a, l) => a + l[1], 0);
  const n = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    let pick = rng() * total;
    for (const [item, w, lo, hi] of LOOT_TABLE) {
      pick -= w;
      if (pick <= 0) {
        const slot = Math.floor(rng() * c.length);
        if (!c[slot]) c[slot] = makeStack(item, lo + Math.floor(rng() * (hi - lo + 1)));
        break;
      }
    }
  }
  // rare tool find
  if (rng() < 0.2) c[Math.floor(rng() * c.length)] = makeStack(rng() < 0.5 ? LOOT_TOOLS[0] : LOOT_TOOLS[1]);
}
