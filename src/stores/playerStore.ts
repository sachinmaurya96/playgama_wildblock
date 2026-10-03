import { create } from 'zustand';
import type { BuffId } from '../data/items';

export interface Buff {
  id: BuffId;
  remaining: number;
}

export const BUFF_INFO: Record<BuffId, { name: string; description: string; icon: string }> = {
  swift: { name: 'Swift', description: 'Move 15% faster.', icon: '🍃' },
  sturdy: { name: 'Sturdy', description: 'Take 15% less damage.', icon: '🪨' },
  well_fed: { name: 'Well Fed', description: 'Energy drains half as fast.', icon: '🥧' },
  hearty: { name: 'Hearty', description: 'Vitality recovers twice as fast.', icon: '💚' },
  well_rested: { name: 'Well Rested', description: 'Energy recovers faster. Comfort makes it last longer.', icon: '🌅' },
  glowsight: { name: 'Glowsight', description: 'See further in the dark.', icon: '✨' },
};

interface PlayerState {
  vitality: number;
  maxVitality: number;
  energy: number;
  maxEnergy: number;
  buffs: Buff[];
  sheltered: boolean;
  underwater: boolean;
  comfort: number;
  heading: number;
  /** Sitting in a boat. */
  boating: boolean;
  /** Vitals HUD sync from the engine (called at a few Hz, only when changed). */
  sync(p: Partial<Pick<PlayerState, 'vitality' | 'energy' | 'buffs' | 'sheltered' | 'underwater' | 'comfort' | 'maxVitality' | 'boating'>>): void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  vitality: 100,
  maxVitality: 100,
  energy: 100,
  maxEnergy: 100,
  buffs: [],
  sheltered: false,
  underwater: false,
  comfort: 0,
  heading: 0,
  boating: false,
  sync(p) {
    const cur = get();
    let changed = false;
    for (const k of Object.keys(p) as (keyof typeof p)[]) {
      const v = p[k];
      if (k === 'buffs') {
        const a = cur.buffs, b = v as Buff[];
        if (a.length !== b.length || a.some((x, i) => x.id !== b[i].id || Math.ceil(x.remaining) !== Math.ceil(b[i].remaining))) changed = true;
      } else if (k === 'vitality' || k === 'energy') {
        if (Math.round(cur[k]) !== Math.round(v as number)) changed = true;
      } else if (cur[k] !== v) changed = true;
    }
    if (changed) set(p);
  },
}));
