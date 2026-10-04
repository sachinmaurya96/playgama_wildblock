import type { Team } from './DeathmatchMap';

/**
 * Room / lobby rules for Deathmatch. Pure state, owned by the host: the roster,
 * team assignment and the match lifecycle. Every change goes through a method
 * here so the rules (team capacity, minimum players, legal phase transitions)
 * live in one place — and the host processes requests one at a time, so two
 * players racing for the last slot can never both get it.
 *
 *   IDLE → LOBBY → LOADING → PREPARING → PLAYING → ENDED → (LOBBY …)
 *   any → ABORTED (host gone / unrecoverable)
 */
export type Phase = 'idle' | 'lobby' | 'loading' | 'preparing' | 'playing' | 'ended' | 'aborted';

export const MAX_PLAYERS = 8;
export const TEAM_SIZE = 4;
export const MATCH_MINUTES = [5, 8, 10, 12] as const;
export const DEFAULT_MINUTES = 8;
export const PREP_SECONDS = 10;
export const RESPAWN_SECONDS = 5;
export const PROTECT_SECONDS = 3;
export const LOAD_TIMEOUT_SECONDS = 30;

const TRANSITIONS: Record<Phase, Phase[]> = {
  idle: ['lobby', 'aborted'],
  lobby: ['loading', 'aborted'],
  loading: ['preparing', 'lobby', 'aborted'],
  preparing: ['playing', 'lobby', 'aborted'],
  playing: ['ended', 'lobby', 'aborted'],
  ended: ['lobby', 'aborted'],
  aborted: [],
};

export function canTransition(from: Phase, to: Phase): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface RoomPlayer {
  id: string;
  name: string;
  team: Team;
  host: boolean;
  /** Picked their team themselves (auto-balance never moves them). */
  chose: boolean;
  /** Join order — used for deterministic tie-breaks. */
  order: number;
  connected: boolean;
}

export interface LobbySnapshot {
  code: string;
  phase: Phase;
  round: number;
  minutes: number;
  hostId: string;
  players: RoomPlayer[];
}

export type JoinResult = { ok: true; player: RoomPlayer } | { ok: false; reason: 'full' | 'in_progress' };
export type SwitchResult = { ok: true } | { ok: false; reason: 'full' | 'locked' | 'same' | 'unknown' };
export type StartCheck = { ok: true } | { ok: false; reason: string };

export function sanitizeName(n: unknown): string {
  const s = String(n ?? '').replace(/[^\p{L}\p{N} _.\-!?']/gu, '').trim().slice(0, 16);
  return s || 'Player';
}

export class DmRoom {
  phase: Phase = 'idle';
  round = 0;
  minutes: number = DEFAULT_MINUTES;
  readonly players = new Map<string, RoomPlayer>();
  private seq = 0;

  constructor(readonly code: string, readonly hostId: string, hostName: string, minutes = DEFAULT_MINUTES) {
    this.minutes = (MATCH_MINUTES as readonly number[]).includes(minutes) ? minutes : DEFAULT_MINUTES;
    this.players.set(hostId, { id: hostId, name: sanitizeName(hostName), team: 'red', host: true, chose: false, order: this.seq++, connected: true });
    this.phase = 'lobby';
  }

  teamCount(team: Team): number {
    let n = 0;
    for (const p of this.players.values()) if (p.team === team) n++;
    return n;
  }

  /** Rule: the smaller team; equal sizes → Red. (The host starts on Red, so the first joiner lands on Blue.) */
  private autoTeam(): Team | null {
    const r = this.teamCount('red'), b = this.teamCount('blue');
    if (r >= TEAM_SIZE && b >= TEAM_SIZE) return null;
    if (r >= TEAM_SIZE) return 'blue';
    if (b >= TEAM_SIZE) return 'red';
    if (b < r) return 'blue';
    if (r < b) return 'red';
    return 'red'; // equal sizes: deterministic
  }

  private uniqueName(name: string): string {
    const taken = new Set([...this.players.values()].map((p) => p.name));
    if (!taken.has(name)) return name;
    for (let i = 2; i < 20; i++) if (!taken.has(`${name} ${i}`)) return `${name} ${i}`;
    return name;
  }

  join(id: string, name: string): JoinResult {
    const existing = this.players.get(id);
    if (existing) return { ok: true, player: existing };
    if (this.phase !== 'lobby') return { ok: false, reason: 'in_progress' };
    if (this.players.size >= MAX_PLAYERS) return { ok: false, reason: 'full' };
    const team = this.autoTeam();
    if (!team) return { ok: false, reason: 'full' };
    const p: RoomPlayer = { id, name: this.uniqueName(sanitizeName(name)), team, host: false, chose: false, order: this.seq++, connected: true };
    this.players.set(id, p);
    return { ok: true, player: p };
  }

  /** Re-admit a player who dropped out of the running match (same team and name). */
  rejoin(p: RoomPlayer): void {
    this.players.set(p.id, { ...p, connected: true });
  }

  leave(id: string): RoomPlayer | null {
    const p = this.players.get(id) ?? null;
    this.players.delete(id);
    return p;
  }

  /** Only the player themselves may switch, only in the lobby, never into a full team. */
  requestTeam(id: string, team: Team): SwitchResult {
    const p = this.players.get(id);
    if (!p) return { ok: false, reason: 'unknown' };
    if (this.phase !== 'lobby') return { ok: false, reason: 'locked' };
    if (p.team === team) return { ok: false, reason: 'same' };
    if (this.teamCount(team) >= TEAM_SIZE) return { ok: false, reason: 'full' };
    p.team = team;
    p.chose = true;
    return { ok: true };
  }

  setMinutes(m: number): boolean {
    if (this.phase !== 'lobby' || !(MATCH_MINUTES as readonly number[]).includes(m)) return false;
    this.minutes = m;
    return true;
  }

  startCheck(by: string): StartCheck {
    if (by !== this.hostId) return { ok: false, reason: 'Only the host can start the match.' };
    if (this.phase !== 'lobby') return { ok: false, reason: 'The match has already started.' };
    if (this.players.size < 2) return { ok: false, reason: 'Waiting for at least one more player.' };
    if (this.teamCount('red') < 1) return { ok: false, reason: 'Red team needs at least one player.' };
    if (this.teamCount('blue') < 1) return { ok: false, reason: 'Blue team needs at least one player.' };
    if (this.teamCount('red') > TEAM_SIZE || this.teamCount('blue') > TEAM_SIZE) return { ok: false, reason: 'A team has too many players.' };
    return { ok: true };
  }

  /** Still a valid match (both teams present)? */
  viable(): boolean {
    return this.teamCount('red') >= 1 && this.teamCount('blue') >= 1;
  }

  transition(to: Phase): boolean {
    if (!canTransition(this.phase, to)) return false;
    this.phase = to;
    if (to === 'loading') this.round++;
    return true;
  }

  snapshot(): LobbySnapshot {
    const players = [...this.players.values()].sort((a, b) => a.order - b.order).map((p) => ({ ...p }));
    return { code: this.code, phase: this.phase, round: this.round, minutes: this.minutes, hostId: this.hostId, players };
  }
}
