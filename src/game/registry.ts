import type { Overlay } from '../stores/gameStore';

/**
 * Lightweight handle to the running game for code outside the 3D bundle
 * (the menu shell) — importing Game itself would pull three.js into the
 * initial download.
 */
export interface GameHandle {
  saveNow(reason: 'hidden' | 'quit' | 'pause'): Promise<void>;
  openOverlay(o: Overlay): void;
  /** Set during a PvP match (truthy). */
  readonly pvp: unknown;
  /** Set during a Deathmatch match (truthy). */
  readonly dm: unknown;
}

export const gameRegistry: { current: GameHandle | null } = { current: null };
