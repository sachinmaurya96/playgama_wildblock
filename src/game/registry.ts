import type { Game } from './Game';

/**
 * Lightweight handle to the running game for code outside the 3D bundle
 * (the menu shell) — importing Game itself would pull three.js into the
 * initial download.
 */
export type GameHandle = Game;

export const gameRegistry: { current: GameHandle | null } = { current: null };
