import type { CreatureKind } from '../../data/creatures';

/** All gameplay events. Systems publish; quests, journal, audio and harmony listen. */
export interface GameEvents {
  blockBroken: { x: number; y: number; z: number; id: number; byPlayer: boolean };
  blockPlaced: { x: number; y: number; z: number; id: number };
  treeFelled: { x: number; y: number; z: number; logs: number };
  itemCollected: { item: string; count: number };
  itemCrafted: { item: string; count: number; station: string | null };
  ateFood: { item: string };
  creatureFed: { kind: CreatureKind; id: number };
  creaturePetted: { kind: CreatureKind; id: number };
  creatureDefeated: { kind: CreatureKind };
  creatureSeen: { kind: CreatureKind };
  playerHurt: { amount: number; cause: string };
  playerBlocked: { cause: string };
  creatureHit: { id: number; kind: CreatureKind; amount: number; x: number; y: number; z: number; crit: boolean; killed: boolean };
  playerDied: { cause: string };
  biomeEntered: { biome: number };
  landmarkFound: { type: string; x: number; z: number };
  loreRead: { index: number };
  sheltered: { value: boolean };
  slept: { comfort: number };
  cropPlanted: { crop: string };
  cropHarvested: { crop: string };
  soilTilled: Record<string, never>;
  riverFound: Record<string, never>;
  caveEntered: Record<string, never>;
  saplingPlanted: Record<string, never>;
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<unknown>>>();

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn as Handler<unknown>);
    return () => set!.delete(fn as Handler<unknown>);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(payload);
      } catch (e) {
        console.error(`[EventBus] handler for ${String(type)} failed`, e);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
