import { create } from 'zustand';
import { itemDef, type EquipSlot } from '../data/items';
import {
  addStack, clickSlot, cloneSlots, countItem, makeStack, quickMove, removeItem, sortSlots, type ItemStack, type Slots,
} from '../game/systems/InventoryLogic';

export const HOTBAR_SIZE = 9;
export const BASE_PACK = 24;
export const MAX_PACK = 32;
export const TOTAL_SLOTS = HOTBAR_SIZE + MAX_PACK;
export const CONTAINER_SIZE = 18;

export type SlotArea = 'inv' | 'container' | 'equip';
export const EQUIP_SLOTS: EquipSlot[] = ['head', 'body', 'legs', 'feet', 'offhand', 'pack'];

export interface InventorySnapshot {
  slots: Slots;
  equipment: Record<EquipSlot, ItemStack | null>;
  selected: number;
}

interface InventoryState extends InventorySnapshot {
  cursor: ItemStack | null;
  container: { key: string; title: string; slots: Slots } | null;
  /** Bumps whenever contents change (cheap change detection for systems). */
  version: number;

  packCapacity(): number;
  selectedStack(): ItemStack | null;
  select(i: number): void;
  cycle(delta: number): void;
  /** Adds items; returns how many did not fit. */
  add(item: string, count?: number, durability?: number): number;
  addStackObj(stack: ItemStack): number;
  remove(item: string, count: number): number;
  count(item: string): number;
  consumeSelected(n?: number): void;
  /** Wear the selected tool; returns true if it broke. */
  wearSelected(amount?: number): boolean;
  click(area: SlotArea, index: number, split: boolean): void;
  clickEquip(slot: EquipSlot): void;
  quickTransfer(area: SlotArea, index: number): void;
  sort(): void;
  takeCursor(): ItemStack | null;
  openContainer(key: string, title: string, slots: Slots): void;
  closeContainer(): { key: string; slots: Slots } | null;
  load(s: InventorySnapshot): void;
  snapshot(): InventorySnapshot;
  reset(): void;
}

function emptySlots(n: number): Slots {
  return new Array(n).fill(null);
}

function defaultEquipment(): Record<EquipSlot, ItemStack | null> {
  return { head: null, body: null, legs: null, feet: null, offhand: null, pack: null };
}

export const useInventoryStore = create<InventoryState>((set, get) => ({
  slots: emptySlots(TOTAL_SLOTS),
  equipment: defaultEquipment(),
  selected: 0,
  cursor: null,
  container: null,
  version: 0,

  packCapacity() {
    return BASE_PACK + (get().equipment.pack ? itemDef(get().equipment.pack!.item).equip?.slots ?? 0 : 0);
  },
  selectedStack() {
    return get().slots[get().selected];
  },
  select(i) {
    if (i >= 0 && i < HOTBAR_SIZE) set({ selected: i });
  },
  cycle(delta) {
    set({ selected: (get().selected + (delta > 0 ? 1 : -1) + HOTBAR_SIZE) % HOTBAR_SIZE });
  },
  add(item, count = 1, durability) {
    const st = makeStack(item, count);
    if (durability !== undefined) st.durability = durability;
    return get().addStackObj(st);
  },
  addStackObj(stack) {
    const slots = cloneSlots(get().slots);
    const limit = HOTBAR_SIZE + get().packCapacity();
    // Merge into existing stacks first (anywhere), then hotbar empties, then backpack empties.
    let left = stack.count;
    const tmp = { ...stack };
    if (stack.durability === undefined) {
      for (let i = 0; i < limit && left > 0; i++) {
        const s = slots[i];
        if (s && s.item === stack.item && s.durability === undefined) {
          const max = itemDef(s.item).maxStack;
          const add = Math.min(max - s.count, left);
          if (add > 0) {
            s.count += add;
            left -= add;
          }
        }
      }
    }
    if (left > 0) {
      tmp.count = left;
      left = addStack(slots, tmp, 0, limit);
    }
    set({ slots, version: get().version + 1 });
    return left;
  },
  remove(item, count) {
    const slots = cloneSlots(get().slots);
    const n = removeItem(slots, item, count);
    set({ slots, version: get().version + 1 });
    return n;
  },
  count(item) {
    return countItem(get().slots, item);
  },
  consumeSelected(n = 1) {
    const slots = cloneSlots(get().slots);
    const s = slots[get().selected];
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) slots[get().selected] = null;
    set({ slots, version: get().version + 1 });
  },
  wearSelected(amount = 1) {
    const slots = cloneSlots(get().slots);
    const s = slots[get().selected];
    if (!s || s.durability === undefined) return false;
    s.durability -= amount;
    let broke = false;
    if (s.durability <= 0) {
      slots[get().selected] = null;
      broke = true;
    }
    set({ slots, version: get().version + 1 });
    return broke;
  },
  click(area, index, split) {
    const st = get();
    if (area === 'inv') {
      if (index >= HOTBAR_SIZE + st.packCapacity()) return;
      const slots = cloneSlots(st.slots);
      const cursor = clickSlot(slots, index, st.cursor ? { ...st.cursor } : null, split);
      set({ slots, cursor, version: st.version + 1 });
    } else if (area === 'container' && st.container) {
      const slots = cloneSlots(st.container.slots);
      const cursor = clickSlot(slots, index, st.cursor ? { ...st.cursor } : null, split);
      set({ container: { ...st.container, slots }, cursor, version: st.version + 1 });
    }
  },
  clickEquip(slot) {
    const st = get();
    const cur = st.cursor;
    const eq = { ...st.equipment };
    if (cur) {
      const def = itemDef(cur.item);
      if (def.equip?.slot !== slot) return;
      const prev = eq[slot];
      eq[slot] = { ...cur, count: 1 };
      set({ equipment: eq, cursor: prev, version: st.version + 1 });
    } else if (eq[slot]) {
      // Unequipping a pack only allowed when the extra pocket slots are empty.
      if (slot === 'pack') {
        const extraFrom = HOTBAR_SIZE + BASE_PACK;
        if (st.slots.slice(extraFrom).some((s) => s)) return;
      }
      const prev = eq[slot];
      eq[slot] = null;
      set({ equipment: eq, cursor: prev, version: st.version + 1 });
    }
  },
  quickTransfer(area, index) {
    const st = get();
    const cap = HOTBAR_SIZE + st.packCapacity();
    if (area === 'inv') {
      const slots = cloneSlots(st.slots);
      const s = slots[index];
      if (!s) return;
      if (st.container) {
        const cslots = cloneSlots(st.container.slots);
        quickMove(slots, index, cslots);
        set({ slots, container: { ...st.container, slots: cslots }, version: st.version + 1 });
        return;
      }
      // Equipment goes straight to its slot when free.
      const def = itemDef(s.item);
      if (def.equip && !st.equipment[def.equip.slot]) {
        const eq = { ...st.equipment, [def.equip.slot]: { ...s, count: 1 } };
        s.count -= 1;
        if (s.count <= 0) slots[index] = null;
        set({ slots, equipment: eq, version: st.version + 1 });
        return;
      }
      if (index < HOTBAR_SIZE) quickMove(slots, index, slots, HOTBAR_SIZE, cap);
      else quickMove(slots, index, slots, 0, HOTBAR_SIZE);
      set({ slots, version: st.version + 1 });
    } else if (area === 'container' && st.container) {
      const slots = cloneSlots(st.slots);
      const cslots = cloneSlots(st.container.slots);
      quickMove(cslots, index, slots, 0, cap);
      set({ slots, container: { ...st.container, slots: cslots }, version: st.version + 1 });
    }
  },
  sort() {
    const st = get();
    const slots = cloneSlots(st.slots);
    sortSlots(slots, HOTBAR_SIZE, HOTBAR_SIZE + st.packCapacity());
    set({ slots, version: st.version + 1 });
  },
  takeCursor() {
    const c = get().cursor;
    set({ cursor: null });
    return c;
  },
  openContainer(key, title, slots) {
    set({ container: { key, title, slots: cloneSlots(slots) } });
  },
  closeContainer() {
    const c = get().container;
    set({ container: null });
    return c ? { key: c.key, slots: c.slots } : null;
  },
  load(s) {
    const slots = emptySlots(TOTAL_SLOTS);
    s.slots.forEach((v, i) => {
      if (i < TOTAL_SLOTS) slots[i] = v ? { ...v } : null;
    });
    set({ slots, equipment: { ...defaultEquipment(), ...s.equipment }, selected: s.selected ?? 0, cursor: null, container: null, version: get().version + 1 });
  },
  snapshot() {
    const st = get();
    const slots = cloneSlots(st.slots);
    // A stack held on the cursor is returned to the pack when saving.
    if (st.cursor) addStack(slots, { ...st.cursor }, 0, HOTBAR_SIZE + st.packCapacity());
    return { slots, equipment: { ...st.equipment }, selected: st.selected };
  },
  reset() {
    set({ slots: emptySlots(TOTAL_SLOTS), equipment: defaultEquipment(), selected: 0, cursor: null, container: null, version: 0 });
  },
}));
