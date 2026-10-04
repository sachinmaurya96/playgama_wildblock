import type { Team } from './DeathmatchMap';

export interface PlayerStats {
  id: string;
  name: string;
  team: Team;
  kills: number;
  deaths: number;
  damage: number;
}

export interface MatchResult {
  winner: Team | 'draw';
  red: number;
  blue: number;
  /** Seconds actually played. */
  duration: number;
  /** One id normally; several when kills AND deaths tie (joint MVP). Empty when nobody scored. */
  mvp: string[];
  players: PlayerStats[];
  reason: 'time' | 'forfeit';
}

/** Team score = valid enemy eliminations by that team's players. */
export function teamScores(players: PlayerStats[]): { red: number; blue: number } {
  let red = 0, blue = 0;
  for (const p of players) {
    if (p.team === 'red') red += p.kills;
    else blue += p.kills;
  }
  return { red, blue };
}

/** Most kills; first tie-break fewer deaths; still tied → joint MVP. Nobody with 0 kills is MVP. */
export function pickMvp(players: PlayerStats[]): string[] {
  const best = Math.max(0, ...players.map((p) => p.kills));
  if (best <= 0) return [];
  const top = players.filter((p) => p.kills === best);
  const fewest = Math.min(...top.map((p) => p.deaths));
  return top.filter((p) => p.deaths === fewest).map((p) => p.id).sort();
}

export function computeResult(players: PlayerStats[], red: number, blue: number, duration: number, reason: MatchResult['reason'] = 'time'): MatchResult {
  const sorted = [...players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.damage - a.damage || a.name.localeCompare(b.name));
  return {
    winner: red > blue ? 'red' : blue > red ? 'blue' : 'draw',
    red, blue, duration: Math.round(duration), mvp: pickMvp(players), players: sorted.map((p) => ({ ...p })), reason,
  };
}
