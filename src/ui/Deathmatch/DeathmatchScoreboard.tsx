import type { Team } from '../../game/deathmatch/DeathmatchMap';
import type { PlayerStats } from '../../game/deathmatch/MatchResults';
import { useDeathmatchStore } from '../../stores/deathmatchStore';

/**
 * Team scoreboard (Tab on desktop, 🏆 on touch). During the match per-player
 * kills / deaths come from the kill feed counts kept by the HUD; the final
 * numbers come from the host's result.
 */
export function TeamTables({ players, red, blue, mvp = [], selfId }: { players: PlayerStats[]; red: number; blue: number; mvp?: string[]; selfId: string }) {
  const table = (team: Team, score: number) => (
    <table className={`dm-table dm-table-${team}`}>
      <thead>
        <tr>
          <th>{team === 'red' ? 'Red Team' : 'Blue Team'} <b>{score}</b></th>
          <th>Kills</th>
          <th>Deaths</th>
        </tr>
      </thead>
      <tbody>
        {players.filter((p) => p.team === team).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths).map((p) => (
          <tr key={p.id} className={p.id === selfId ? 'me' : ''}>
            <td>{mvp.includes(p.id) && '🏆 '}{p.name}</td>
            <td>{p.kills}</td>
            <td>{p.deaths}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <div className="dm-tables">
      {table('red', red)}
      {table('blue', blue)}
    </div>
  );
}

export function DeathmatchScoreboard({ stats }: { stats: PlayerStats[] }) {
  const open = useDeathmatchStore((s) => s.scoreboardOpen);
  const red = useDeathmatchStore((s) => s.red);
  const blue = useDeathmatchStore((s) => s.blue);
  const selfId = useDeathmatchStore((s) => s.selfId);
  if (!open) return null;
  return (
    <div className="dm-scoreboard">
      <h3>SCOREBOARD</h3>
      <TeamTables players={stats} red={red} blue={blue} selfId={selfId} />
    </div>
  );
}
