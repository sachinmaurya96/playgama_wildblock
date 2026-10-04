import { create } from 'zustand';
import type { Team } from '../game/deathmatch/DeathmatchMap';
import type { LobbySnapshot } from '../game/deathmatch/DeathmatchRules';
import type { MatchResult } from '../game/deathmatch/MatchResults';
import type { LoadoutSnapshot } from '../game/deathmatch/WeaponSystem';
import type { WeaponId } from '../game/deathmatch/WeaponDefinitions';

/**
 * Deathmatch UI state (menus, lobby, HUD). Written by net/deathmatchNet.ts and
 * game/deathmatch/DeathmatchSession.ts; React only reads it. Kept apart from
 * the PvP store so the two modes never interfere.
 */
export interface DmFeedEntry {
  id: number;
  killer: string | null;
  killerTeam?: Team;
  victim: string;
  victimTeam?: Team;
  weapon: string;
  head: boolean;
  at: number;
}

export interface DmState {
  /** idle = no room; connecting = creating / joining; room = connected. */
  conn: 'idle' | 'connecting' | 'room';
  error: string | null;
  code: string;
  online: boolean;
  isHost: boolean;
  selfId: string;
  lobby: LobbySnapshot | null;
  startError: string | null;
  teamError: string | null;

  // ---- in match
  /** Match phase as this client sees it (lobby phases come from `lobby.phase`). */
  phase: 'loading' | 'preparing' | 'playing' | 'ended' | null;
  countdown: number;
  timeLeft: number;
  red: number;
  blue: number;
  hp: number;
  alive: boolean;
  protectedFor: number;
  respawnIn: number;
  killedBy: { name: string; weapon: string; team?: Team } | null;
  loadout: LoadoutSnapshot | null;
  weapon: WeaponId;
  reloading: number;
  healing: { size: 'small' | 'large'; progress: number } | null;
  aiming: boolean;
  scoped: boolean;
  hitAt: number;
  hitHead: boolean;
  killAt: number;
  hurtAt: number;
  /** Direction (radians, relative to view) of the last hit taken. */
  hurtDir: number;
  feed: DmFeedEntry[];
  prompt: string | null;
  scoreboardOpen: boolean;
  /** The ⚙️ options panel (camera, voice, controls…) — key O on desktop. */
  optionsOpen: boolean;
  result: MatchResult | null;
  waitingFor: string[];
  spread: number;
  notice: string | null;
  /** Live kills / deaths per player id (from the host's snapshots). */
  stats: Record<string, { kills: number; deaths: number }>;

  set(p: Partial<DmState>): void;
  pushFeed(e: Omit<DmFeedEntry, 'id' | 'at'>): void;
  resetMatch(): void;
  reset(): void;
}

let feedId = 1;

const matchInitial = {
  phase: null as DmState['phase'], countdown: 0, timeLeft: 0, red: 0, blue: 0, hp: 100, alive: true, protectedFor: 0, respawnIn: 0,
  killedBy: null as DmState['killedBy'], loadout: null as LoadoutSnapshot | null, weapon: 'sword' as WeaponId, reloading: 0,
  healing: null as DmState['healing'], aiming: false, scoped: false, hitAt: 0, hitHead: false, killAt: 0, hurtAt: 0, hurtDir: 0,
  feed: [] as DmFeedEntry[], prompt: null as string | null, scoreboardOpen: false, optionsOpen: false, result: null as MatchResult | null, waitingFor: [] as string[], spread: 0,
  notice: null as string | null, stats: {} as Record<string, { kills: number; deaths: number }>,
};

const initial = {
  conn: 'idle' as DmState['conn'], error: null as string | null, code: '', online: true, isHost: false, selfId: '', lobby: null as LobbySnapshot | null,
  startError: null as string | null, teamError: null as string | null, ...matchInitial,
};

export const useDeathmatchStore = create<DmState>((set, get) => ({
  ...initial,
  set(p) {
    set(p);
  },
  pushFeed(e) {
    set({ feed: [...get().feed, { ...e, id: feedId++, at: performance.now() }].slice(-5) });
  },
  resetMatch() {
    set({ ...matchInitial });
  },
  reset() {
    set({ ...initial });
  },
}));
