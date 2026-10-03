import { describe, expect, it } from 'vitest';
import { addStack, clickSlot, countItem, craftableTimes, makeStack, quickMove, removeItem, sortSlots, type Slots } from './InventoryLogic';

const empty = (n: number): Slots => new Array(n).fill(null);

describe('inventory stacking', () => {
  it('fills existing stacks before empty slots and respects max stack', () => {
    const s = empty(4);
    expect(addStack(s, makeStack('planks', 50))).toBe(0);
    expect(addStack(s, makeStack('planks', 30))).toBe(0);
    expect(s[0]!.count).toBe(64);
    expect(s[1]!.count).toBe(16);
    expect(countItem(s, 'planks')).toBe(80);
  });

  it('returns what did not fit', () => {
    const s = empty(2);
    expect(addStack(s, makeStack('planks', 200))).toBe(72);
  });

  it('never merges tools (they carry durability)', () => {
    const s = empty(3);
    addStack(s, makeStack('scrap_axe'));
    addStack(s, makeStack('scrap_axe'));
    expect(s[0]!.count).toBe(1);
    expect(s[1]!.count).toBe(1);
    expect(s[0]!.durability).toBeGreaterThan(0);
  });

  it('removes items across stacks', () => {
    const s = empty(3);
    addStack(s, makeStack('stick', 64));
    addStack(s, makeStack('stick', 10));
    expect(removeItem(s, 'stick', 70)).toBe(70);
    expect(countItem(s, 'stick')).toBe(4);
    expect(removeItem(s, 'stick', 10)).toBe(4);
    expect(s.every((x) => x === null)).toBe(true);
  });

  it('click: pick up, split, place one, merge and swap', () => {
    const s = empty(3);
    s[0] = makeStack('fiber', 10);
    s[1] = makeStack('rope', 2);
    let cursor = clickSlot(s, 0, null, true); // split half
    expect(cursor!.count).toBe(5);
    expect(s[0]!.count).toBe(5);
    cursor = clickSlot(s, 2, cursor, true); // place one
    expect(s[2]!.count).toBe(1);
    expect(cursor!.count).toBe(4);
    cursor = clickSlot(s, 0, cursor, false); // merge back
    expect(cursor).toBeNull();
    expect(s[0]!.count).toBe(9);
    cursor = clickSlot(s, 1, null, false); // pick up rope
    cursor = clickSlot(s, 0, cursor, false); // swap with fiber
    expect(s[0]!.item).toBe('rope');
    expect(cursor!.item).toBe('fiber');
  });

  it('shift-click quick transfer moves whole stacks', () => {
    const a = empty(2), b = empty(4);
    a[0] = makeStack('log', 12);
    quickMove(a, 0, b);
    expect(a[0]).toBeNull();
    expect(countItem(b, 'log')).toBe(12);
  });

  it('sorts and merges partial stacks', () => {
    const s = empty(6);
    s[0] = makeStack('stick', 3);
    s[2] = makeStack('scrap_pick');
    s[4] = makeStack('stick', 5);
    sortSlots(s, 0, 6);
    expect(s[0]!.item).toBe('scrap_pick');
    expect(s[1]!.item).toBe('stick');
    expect(s[1]!.count).toBe(8);
    expect(s[2]).toBeNull();
  });

  it('computes how many times a recipe can be crafted', () => {
    const s = empty(4);
    addStack(s, makeStack('planks', 13));
    addStack(s, makeStack('log', 2));
    expect(craftableTimes(s, [{ item: 'planks', count: 6 }, { item: 'log', count: 1 }])).toBe(2);
    expect(craftableTimes(s, [{ item: 'rope', count: 1 }])).toBe(0);
  });
});
