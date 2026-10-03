import { itemDef } from '../../data/items';
import type { Ingredient } from '../../data/recipes';

/**
 * Pure inventory operations (no React, no engine) — unit tested.
 * A slot array is (ItemStack | null)[]; functions mutate the array passed in.
 */
export interface ItemStack {
  item: string;
  count: number;
  /** Remaining durability for tools. */
  durability?: number;
}

export type Slots = (ItemStack | null)[];

export function maxStackOf(item: string): number {
  return itemDef(item).maxStack;
}

export function makeStack(item: string, count = 1): ItemStack {
  const d = itemDef(item);
  const s: ItemStack = { item, count };
  if (d.tool && Number.isFinite(d.tool.durability)) s.durability = d.tool.durability;
  return s;
}

export function canMerge(a: ItemStack, b: ItemStack): boolean {
  return a.item === b.item && a.durability === undefined && b.durability === undefined && maxStackOf(a.item) > 1;
}

/**
 * Add a stack into slots[from..to). Fills existing stacks first, then empty slots.
 * Returns the count that did not fit (0 = all added).
 */
export function addStack(slots: Slots, stack: ItemStack, from = 0, to = slots.length): number {
  let remaining = stack.count;
  const max = maxStackOf(stack.item);
  if (stack.durability === undefined && max > 1) {
    for (let i = from; i < to && remaining > 0; i++) {
      const s = slots[i];
      if (s && s.item === stack.item && s.durability === undefined && s.count < max) {
        const add = Math.min(max - s.count, remaining);
        s.count += add;
        remaining -= add;
      }
    }
  }
  for (let i = from; i < to && remaining > 0; i++) {
    if (!slots[i]) {
      const add = Math.min(max, remaining);
      slots[i] = { ...stack, count: add };
      remaining -= add;
    }
  }
  return remaining;
}

export function countItem(slots: Slots, item: string): number {
  let n = 0;
  for (const s of slots) if (s && s.item === item) n += s.count;
  return n;
}

/** Remove up to `count` of an item. Returns how many were removed. */
export function removeItem(slots: Slots, item: string, count: number): number {
  let left = count;
  // Take from the end first so the hotbar keeps its stacks where possible.
  for (let i = slots.length - 1; i >= 0 && left > 0; i--) {
    const s = slots[i];
    if (!s || s.item !== item) continue;
    const take = Math.min(s.count, left);
    s.count -= take;
    left -= take;
    if (s.count <= 0) slots[i] = null;
  }
  return count - left;
}

export function hasIngredients(slots: Slots, inputs: Ingredient[], times = 1): boolean {
  return inputs.every((ing) => countItem(slots, ing.item) >= ing.count * times);
}

/** How many times a recipe can be made from these slots. */
export function craftableTimes(slots: Slots, inputs: Ingredient[]): number {
  let t = Infinity;
  for (const ing of inputs) t = Math.min(t, Math.floor(countItem(slots, ing.item) / ing.count));
  return Number.isFinite(t) ? t : 0;
}

/** Stable sort of a slot range: groups identical items, merges partial stacks, category then name order. */
export function sortSlots(slots: Slots, from: number, to: number): void {
  const items: ItemStack[] = [];
  for (let i = from; i < to; i++) {
    const s = slots[i];
    if (s) items.push(s);
    slots[i] = null;
  }
  const order = ['tool', 'weapon', 'equipment', 'food', 'seed', 'block', 'material', 'misc'];
  items.sort((a, b) => {
    const da = itemDef(a.item), db = itemDef(b.item);
    const c = order.indexOf(da.category) - order.indexOf(db.category);
    if (c !== 0) return c;
    return da.name.localeCompare(db.name) || b.count - a.count;
  });
  for (const s of items) addStack(slots, s, from, to);
}

/**
 * Click interaction between the cursor ("held") stack and a slot:
 * - empty cursor: pick up the whole stack (or half with split=true)
 * - cursor onto empty slot: place all (or one with split=true)
 * - same item: merge (or place one with split)
 * - different item: swap
 * Returns the new cursor stack.
 */
export function clickSlot(slots: Slots, index: number, cursor: ItemStack | null, split: boolean): ItemStack | null {
  const slot = slots[index];
  if (!cursor) {
    if (!slot) return null;
    if (split && slot.count > 1) {
      const half = Math.ceil(slot.count / 2);
      slot.count -= half;
      return { ...slot, count: half };
    }
    slots[index] = null;
    return slot;
  }
  if (!slot) {
    if (split && cursor.count > 1) {
      slots[index] = { ...cursor, count: 1 };
      return { ...cursor, count: cursor.count - 1 };
    }
    slots[index] = cursor;
    return null;
  }
  if (canMerge(slot, cursor)) {
    const max = maxStackOf(slot.item);
    const move = split ? Math.min(1, max - slot.count) : Math.min(cursor.count, max - slot.count);
    slot.count += move;
    const left = cursor.count - move;
    return left > 0 ? { ...cursor, count: left } : null;
  }
  slots[index] = cursor;
  return slot;
}

/** Move the whole stack at `index` into the target range (Shift+Click quick transfer). */
export function quickMove(src: Slots, index: number, dst: Slots, from = 0, to = dst.length): void {
  const s = src[index];
  if (!s) return;
  const left = addStack(dst, s, from, to);
  if (left <= 0) src[index] = null;
  else src[index] = { ...s, count: left };
}

export function cloneSlots(slots: Slots): Slots {
  return slots.map((s) => (s ? { ...s } : null));
}
