import { useRef } from 'react';
import type { Team } from '../../game/deathmatch/DeathmatchMap';
import { TEAM_SIZE, type RoomPlayer } from '../../game/deathmatch/DeathmatchRules';

/**
 * One team column of the lobby: four slots, filled player cards on top, empty
 * slots below. Double-click (desktop) or double-tap (touch) an empty slot of
 * the other team to move there. Double-tap is detected by hand from pointer
 * events, so it works the same on iOS, Android and desktop and never zooms.
 */
export function TeamPanel({ team, players, selfId, hostId, locked, onJoin }: {
  team: Team;
  players: RoomPlayer[];
  selfId: string;
  hostId: string;
  locked: boolean;
  onJoin: (team: Team) => void;
}) {
  const lastTap = useRef(0);
  const mine = players.some((p) => p.id === selfId);
  const full = players.length >= TEAM_SIZE;
  const canJoin = !mine && !full && !locked;
  const tap = () => {
    if (!canJoin) return;
    const now = performance.now();
    if (now - lastTap.current < 380) {
      lastTap.current = 0;
      onJoin(team);
    } else lastTap.current = now;
  };
  const slots = Array.from({ length: TEAM_SIZE }, (_, i) => players[i] ?? null);
  return (
    <section className={`dm-team dm-team-${team} ${mine ? 'mine' : ''}`} aria-label={`${team} team`}>
      <header>
        <span className="dm-team-name">{team === 'red' ? 'RED TEAM' : 'BLUE TEAM'}</span>
        <span className="dm-team-count">{players.length} / {TEAM_SIZE}</span>
      </header>
      <ol className="dm-slots">
        {slots.map((p, i) =>
          p ? (
            <li key={`${p.id}-${team}`} className={`dm-card ${p.id === selfId ? 'me' : ''}`}>
              <span className="dm-avatar" aria-hidden>
                <i className="hat" />
                <i className="face" />
              </span>
              <span className="dm-card-name">{p.name}{p.id === selfId && <small> (you)</small>}</span>
              {p.id === hostId && <span className="dm-badge" title="Host">👑 Host</span>}
              <span className={`dm-dot ${p.connected ? 'on' : ''}`} title={p.connected ? 'Connected' : 'Reconnecting'} />
            </li>
          ) : (
            <li
              key={`empty-${i}`}
              className={`dm-card empty ${canJoin ? 'joinable' : ''}`}
              onPointerUp={tap}
              onDoubleClick={(e) => {
                e.preventDefault();
                if (canJoin) onJoin(team);
              }}
              title={canJoin ? 'Double-click / double-tap to join this team' : undefined}
            >
              {canJoin ? <span>Double-tap to join</span> : <span>Empty slot</span>}
            </li>
          ),
        )}
      </ol>
      {canJoin && (
        <button type="button" className="btn small dm-switch" onClick={() => onJoin(team)}>
          ⇄ Switch to {team === 'red' ? 'Red' : 'Blue'}
        </button>
      )}
      {!mine && full && !locked && <p className="dm-full">Team full</p>}
    </section>
  );
}
