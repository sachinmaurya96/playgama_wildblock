import { useEffect, useRef, useState } from 'react';
import { launchDeathmatch } from '../../app/launch';
import { audio } from '../../game/core/audio';
import { playDm } from '../../game/deathmatch/GunAudio';
import { MATCH_MINUTES, MAX_PLAYERS, DEFAULT_MINUTES } from '../../game/deathmatch/DeathmatchRules';
import type { Team } from '../../game/deathmatch/DeathmatchMap';
import { dmInviteFromUrl, dmInviteUrl, dmNet, hostDeathmatch, joinDeathmatch } from '../../net/deathmatchNet';
import { normalizeCode } from '../../net/transport';
import { useDeathmatchStore } from '../../stores/deathmatchStore';
import { useGameStore } from '../../stores/gameStore';
import { MenuBackground } from '../MainMenu/MenuBackground';
import { VoiceDock } from '../Voice/VoiceControls';
import { TeamPanel } from './TeamPanel';

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode */
  }
}

/** Deathmatch menu: create / join a room, then the Red vs Blue team lobby. */
export function DeathmatchScreen() {
  const conn = useDeathmatchStore((s) => s.conn);
  const lobby = useDeathmatchStore((s) => s.lobby);
  return (
    <div className="menu-screen dm-screen">
      <MenuBackground />
      {conn === 'room' && lobby ? <DeathmatchLobby /> : <RoomForm />}
    </div>
  );
}

function RoomForm() {
  const invite = dmInviteFromUrl();
  const [tab, setTab] = useState<'host' | 'join'>(invite ? 'join' : 'host');
  const [name, setName] = useState<string>(() => load('wb-dm-name', load('wb-pvp-name', '')));
  const [code, setCode] = useState(invite);
  const [minutes, setMinutes] = useState<number>(() => load('wb-dm-minutes', DEFAULT_MINUTES));
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const error = useDeathmatchStore((s) => s.error);
  const [localError, setLocalError] = useState<string | null>(null);
  const shown = localError ?? error;
  const playerName = () => (name.trim() || 'Player').slice(0, 16);

  const back = () => {
    audio.play('click');
    dmNet.leave();
    useGameStore.getState().setScreen('menu');
  };
  const host = async () => {
    setLocalError(null);
    useDeathmatchStore.getState().set({ error: null });
    setBusy(online ? 'Opening your room…' : 'Opening a local room…');
    audio.init();
    save('wb-dm-name', name);
    save('wb-dm-minutes', minutes);
    try {
      await hostDeathmatch({ name: playerName(), online, minutes }, launchDeathmatch);
      audio.play('chime');
    } catch (e) {
      setLocalError((e as Error).message);
    }
    setBusy(null);
  };
  const join = async () => {
    setLocalError(null);
    useDeathmatchStore.getState().set({ error: null });
    const c = normalizeCode(code);
    if (c.length !== 6) return setLocalError('Enter the 6-character room code.');
    setBusy('Connecting to the room…');
    audio.init();
    save('wb-dm-name', name);
    try {
      await joinDeathmatch({ code: c, name: playerName(), online }, launchDeathmatch);
      audio.play('chime');
    } catch (e) {
      setLocalError((e as Error).message);
    }
    setBusy(null);
  };

  return (
    <form className="panel form-panel dm-panel" onSubmit={(e) => { e.preventDefault(); void (tab === 'host' ? host() : join()); }}>
      <button type="button" className="close-x" onClick={back} aria-label="Back">✕</button>
      <h2 className="panel-title">⚔️ Deathmatch <small className="muted">Team Battle</small></h2>
      <p className="muted pvp-intro">Join Red or Blue. Collect weapons. Win the battle. Fight across the City Clash map — the team with the most eliminations when time runs out wins. Up to {MAX_PLAYERS} players (4 vs 4).</p>
      <div className="tabs pvp-tabs" role="tablist">
        <button type="button" role="tab" className={`tab ${tab === 'host' ? 'active' : ''}`} onClick={() => setTab('host')}>🏰 Create room</button>
        <button type="button" role="tab" className={`tab ${tab === 'join' ? 'active' : ''}`} onClick={() => setTab('join')}>🔑 Join with code</button>
      </div>
      <label className="field">
        <span>Your name</span>
        <input value={name} maxLength={16} placeholder="Player" onChange={(e) => setName(e.target.value)} />
      </label>
      {tab === 'join' ? (
        <label className="field">
          <span>Room code</span>
          <input className="code-input" value={code} maxLength={8} placeholder="AB7K2P" autoCapitalize="characters" autoComplete="off" spellCheck={false} onChange={(e) => setCode(normalizeCode(e.target.value))} />
        </label>
      ) : (
        <div className="field">
          <span>Match duration</span>
          <div className="dm-durations">
            {MATCH_MINUTES.map((m) => (
              <button type="button" key={m} className={`diff-card ${minutes === m ? 'active' : ''}`} onClick={() => setMinutes(m)}>
                <b>{m} min</b>
              </button>
            ))}
          </div>
          <small className="muted">2 to {MAX_PLAYERS} players · teams of up to 4 · uneven teams are fine</small>
        </div>
      )}
      <details className="pvp-advanced">
        <summary>Connection</summary>
        <label className="check">
          <input type="radio" name="dm-net" checked={online} onChange={() => setOnline(true)} />
          <span>Online <small className="muted">— friends on other devices</small></span>
        </label>
        <label className="check">
          <input type="radio" name="dm-net" checked={!online} onChange={() => setOnline(false)} />
          <span>Same device <small className="muted">— several tabs of this browser (testing)</small></span>
        </label>
        <small className="muted">Free peer-to-peer WebRTC: the PeerJS service only introduces players, then game data flows directly between browsers. Very strict school / office / mobile carrier networks can block direct connections (a TURN relay fixes that).</small>
      </details>
      {shown && <p className="pvp-error" role="alert">{shown}</p>}
      <button className="btn primary big dm-go" type="submit" disabled={!!busy}>
        {busy ?? (tab === 'host' ? '⚔️ Create Room' : '🔑 Join Room')}
      </button>
    </form>
  );
}

function DeathmatchLobby() {
  const lobby = useDeathmatchStore((s) => s.lobby)!;
  const selfId = useDeathmatchStore((s) => s.selfId);
  const isHost = useDeathmatchStore((s) => s.isHost);
  const startError = useDeathmatchStore((s) => s.startError);
  const teamError = useDeathmatchStore((s) => s.teamError);
  const error = useDeathmatchStore((s) => s.error);
  const online = useDeathmatchStore((s) => s.online);
  const [copied, setCopied] = useState(false);
  const red = lobby.players.filter((p) => p.team === 'red');
  const blue = lobby.players.filter((p) => p.team === 'blue');
  const me = lobby.players.find((p) => p.id === selfId);
  const prevTeam = useRef(me?.team);
  useEffect(() => {
    if (me && prevTeam.current && me.team !== prevTeam.current) playDm('team');
    prevTeam.current = me?.team;
  }, [me?.team]);
  useEffect(() => {
    // dismiss a "cancelled" message after a while
    if (!error) return;
    const id = setTimeout(() => useDeathmatchStore.getState().set({ error: null }), 5000);
    return () => clearTimeout(id);
  }, [error]);

  const locked = lobby.phase !== 'lobby';
  const join = (team: Team) => {
    audio.play('click');
    dmNet.current?.send({ t: 'team', team });
  };
  const why = lobby.players.length < 2 ? 'Waiting for at least one more player to join.' : red.length === 0 ? 'Red team needs at least one player.' : blue.length === 0 ? 'Blue team needs at least one player.' : null;
  const leave = () => {
    audio.play('click');
    dmNet.leave();
    useGameStore.getState().setScreen('menu');
  };
  const share = async () => {
    const url = dmInviteUrl(lobby.code);
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'WildBlocks Deathmatch', text: `Join my Deathmatch room: ${lobby.code}`, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* cancelled */
    }
  };

  return (
    <div className="dm-lobby">
      <header className="dm-lobby-head">
        <h2>⚔️ DEATHMATCH <small>City Clash · {lobby.minutes} min</small></h2>
        {isHost && !locked && (
          <div className="dm-minutes" role="group" aria-label="Match duration">
            {MATCH_MINUTES.map((m) => (
              <button key={m} type="button" className={`dm-chip ${lobby.minutes === m ? 'active' : ''}`} onClick={() => dmNet.current?.send({ t: 'minutes', m })}>{m}m</button>
            ))}
          </div>
        )}
      </header>
      <div className="dm-teams">
        <TeamPanel team="red" players={red} selfId={selfId} hostId={lobby.hostId} locked={locked} onJoin={join} />
        <div className="dm-vs" aria-hidden>VS</div>
        <TeamPanel team="blue" players={blue} selfId={selfId} hostId={lobby.hostId} locked={locked} onJoin={join} />
      </div>
      <VoiceDock className="dm-voice" />
      {(teamError || startError || error) && <p className="pvp-error dm-msg" role="alert">{teamError ?? startError ?? error}</p>}
      <footer className="dm-lobby-foot">
        <div className="dm-code">
          <small>Room code</small>
          <b>{lobby.code}</b>
          <small>{lobby.players.length} / {MAX_PLAYERS} players{online ? '' : ' · same device'}</small>
        </div>
        <button type="button" className="btn" onClick={() => void share()}>{copied ? '✓ Link copied' : '🔗 Invite'}</button>
        <button type="button" className="btn ghost" onClick={leave}>← Leave</button>
        {isHost ? (
          <div className="dm-start">
            <button type="button" className="btn primary big" disabled={!!why || locked} onClick={() => { audio.play('click'); dmNet.current?.send({ t: 'start' }); }}>
              ▶ Start Match
            </button>
            {why && <small className="muted">{why}</small>}
          </div>
        ) : (
          <p className="dm-wait">{locked ? 'Match starting…' : 'Waiting for host to start…'}</p>
        )}
      </footer>
    </div>
  );
}
