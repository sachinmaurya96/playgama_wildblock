import { audio } from '../../game/core/audio';
import { dmNet } from '../../net/deathmatchNet';
import { useDeathmatchStore } from '../../stores/deathmatchStore';
import { useGameStore } from '../../stores/gameStore';
import { TeamTables } from './DeathmatchScoreboard';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Full-screen end of match: winning team (or draw), final score, MVP, per-player stats. */
export function DeathmatchResults() {
  const r = useDeathmatchStore((s) => s.result);
  const isHost = useDeathmatchStore((s) => s.isHost);
  const selfId = useDeathmatchStore((s) => s.selfId);
  if (!r) return null;
  const mvps = r.players.filter((p) => r.mvp.includes(p.id));
  const title = r.winner === 'draw' ? 'MATCH DRAW' : r.winner === 'red' ? 'RED TEAM WINS' : 'BLUE TEAM WINS';
  const leave = () => {
    audio.play('click');
    dmNet.leave();
    useGameStore.getState().setScreen('menu');
  };
  return (
    <div className={`dm-results win-${r.winner}`} role="dialog" aria-label="Match results">
      <div className="dm-results-card">
        <h1>{title}</h1>
        {r.reason === 'forfeit' && <p className="muted">The other team left the match.</p>}
        <div className="dm-final">
          <span className="red">RED <b>{r.red}</b></span>
          <span className="sep">—</span>
          <span className="blue"><b>{r.blue}</b> BLUE</span>
        </div>
        <p className="dm-dur">Match time {fmt(r.duration)}</p>
        {mvps.length > 0 && (
          <div className="dm-mvp">
            <div className="dm-trophy" aria-hidden>🏆</div>
            <div>
              <small>{mvps.length > 1 ? 'JOINT MVP · TOP FRAGGERS' : 'MVP · TOP FRAGGER'}</small>
              <b>{mvps.map((m) => m.name).join(' & ')}</b>
              <span>{mvps[0].kills} Kills · {mvps[0].deaths} Deaths</span>
            </div>
          </div>
        )}
        <TeamTables players={r.players} red={r.red} blue={r.blue} mvp={r.mvp} selfId={selfId} />
        <div className="dm-results-actions">
          {isHost ? (
            <button type="button" className="btn primary big" onClick={() => { audio.play('click'); dmNet.current?.send({ t: 'again' }); }}>↻ Play Again</button>
          ) : (
            <p className="dm-wait">Waiting for the host…</p>
          )}
          <button type="button" className="btn" onClick={leave}>Leave Room</button>
        </div>
      </div>
    </div>
  );
}
