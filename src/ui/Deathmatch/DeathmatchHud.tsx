import { useEffect, useMemo, useState } from 'react';
import { touchEnabled } from '../../app/mobile';
import { Game } from '../../game/Game';
import { LARGE_MEDKIT, SMALL_MEDKIT } from '../../game/deathmatch/WeaponDefinitions';
import { useDeathmatchStore } from '../../stores/deathmatchStore';
import { useGameStore } from '../../stores/gameStore';
import { keyLabel, useSettingsStore } from '../../stores/settingsStore';
import { DeathmatchResults } from './DeathmatchResults';
import { DeathmatchScoreboard } from './DeathmatchScoreboard';
import { PlayerRadar } from '../common/Radar';
import { VoiceDock } from '../Voice/VoiceControls';
import { DmOptions } from './DmOptions';
import { WeaponHud } from './WeaponHud';

const clock = (s: number) => {
  const t = Math.max(0, Math.ceil(s));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

/** Deathmatch in-match HUD (replaces the survival / PvP HUD in mode 'deathmatch'). */
export function DeathmatchHud() {
  const hidden = useGameStore((s) => s.hudHidden);
  const cursorFree = useGameStore((s) => s.cursorFree);
  const overlay = useGameStore((s) => s.overlay);
  const phase = useDeathmatchStore((s) => s.phase);
  const lobby = useDeathmatchStore((s) => s.lobby);
  const statsMap = useDeathmatchStore((s) => s.stats);
  const options = useDeathmatchStore((s) => s.optionsOpen);
  const stats = useMemo(
    () => (lobby?.players ?? []).map((p) => ({ id: p.id, name: p.name, team: p.team, kills: statsMap[p.id]?.kills ?? 0, deaths: statsMap[p.id]?.deaths ?? 0, damage: 0 })),
    [lobby, statsMap],
  );
  return (
    <div className="dm-hud">
      <Scope />
      <ClickToFight />
      {!hidden && phase !== 'ended' && (
        <>
          <TopBar />
          <PlayerRadar
            blips={() => Game.current?.dm?.radarBlips() ?? null}
            range={160}
            title="Radar — you are the white arrow, facing up. Green = teammates, red = opponents (the whole city fits)."
            empty="Players show here"
          />
          <VoiceDock className="dm-voice" />
          <KeyHints />
          <KillFeed />
          <Health />
          <WeaponHud />
          {overlay === null && !cursorFree && <Crosshair />}
          <Prompt />
          <Notice />
        </>
      )}
      <HurtIndicator />
      {phase === 'preparing' && <Preparation />}
      {phase === 'loading' && <Waiting />}
      <DeathScreen />
      {phase !== 'ended' && <DeathmatchScoreboard stats={stats} />}
      {phase === 'ended' && <DeathmatchResults />}
      {options && phase !== 'ended' && <DmOptions />}
    </div>
  );
}

function TopBar() {
  const red = useDeathmatchStore((s) => s.red);
  const blue = useDeathmatchStore((s) => s.blue);
  const t = useDeathmatchStore((s) => s.timeLeft);
  const phase = useDeathmatchStore((s) => s.phase);
  const minutes = useDeathmatchStore((s) => s.lobby?.minutes ?? 8);
  const urgent = phase === 'playing' && t <= 30;
  return (
    <div className="dm-top">
      <div className="dm-score">
        <span className="red">RED <b>{String(red).padStart(2, '0')}</b></span>
        <span className="dash">—</span>
        <span className="blue"><b>{String(blue).padStart(2, '0')}</b> BLUE</span>
      </div>
      <OptionsChip />
      <div className={`dm-timer ${urgent ? 'urgent' : ''}`}>{phase !== 'playing' ? clock(minutes * 60) : t <= 0 ? 'Time!' : clock(t)}</div>
    </div>
  );
}

/** ⚙️ options (desktop: next to the score; touch has its own ⚙️ button top-right). */
function OptionsChip() {
  const open = useDeathmatchStore((s) => s.optionsOpen);
  const touch = useSettingsStore((s) => s.controls.touch);
  const key = useSettingsStore((s) => keyLabel(s.controls.keys.options));
  if (touchEnabled(touch)) return null;
  return (
    <button type="button" className={`dm-gear ${open ? 'on' : ''}`} title={`Options: camera, voice, controls, leave (${key})`} onClick={() => Game.current?.setDmOptions(!open)}>
      ⚙️<kbd className="dm-k">{key}</kbd>
    </button>
  );
}

function KillFeed() {
  const feed = useDeathmatchStore((s) => s.feed);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const now = performance.now();
  return (
    <ul className="dm-feed">
      {feed.filter((e) => now - e.at < 7000).map((e) => (
        <li key={e.id}>
          {e.killer && <b className={e.killerTeam}>{e.killer}</b>}
          <span className="w">[{e.weapon}{e.head ? ' ✦' : ''}]</span>
          <b className={e.victimTeam}>{e.victim}</b>
          {!e.killer && <span className="w">eliminated</span>}
        </li>
      ))}
    </ul>
  );
}

function Health() {
  const hp = useDeathmatchStore((s) => s.hp);
  const lo = useDeathmatchStore((s) => s.loadout);
  const healing = useDeathmatchStore((s) => s.healing);
  const prot = useDeathmatchStore((s) => s.protectedFor);
  return (
    <div className="dm-health">
      <div className="dm-hpbar">
        <i style={{ width: `${hp}%` }} className={hp <= 30 ? 'low' : ''} />
        <span>❤ {hp}</span>
      </div>
      <div className="dm-meds">
        <button type="button" className="dm-med" onPointerDown={(e) => { e.stopPropagation(); Game.current?.dm?.heal('small'); }} disabled={!lo?.small}>
          🩹 {lo?.small ?? 0}<small>/{SMALL_MEDKIT.carry}</small><kbd className="dm-k">4</kbd>
        </button>
        <button type="button" className="dm-med" onPointerDown={(e) => { e.stopPropagation(); Game.current?.dm?.heal('large'); }} disabled={!lo?.large}>
          ⛑️ {lo?.large ?? 0}<small>/{LARGE_MEDKIT.carry}</small><kbd className="dm-k">5</kbd>
        </button>
        {prot > 0 && <span className="dm-prot">🛡 Spawn protection</span>}
      </div>
      {healing && (
        <div className="dm-healbar">
          <i style={{ width: `${Math.round(healing.progress * 100)}%` }} />
          <span>Using {healing.size === 'small' ? 'small' : 'large'} medkit…</span>
        </div>
      )}
    </div>
  );
}

function Crosshair() {
  const spread = useDeathmatchStore((s) => s.spread);
  const hitAt = useDeathmatchStore((s) => s.hitAt);
  const hitHead = useDeathmatchStore((s) => s.hitHead);
  const killAt = useDeathmatchStore((s) => s.killAt);
  const scoped = useDeathmatchStore((s) => s.scoped);
  // aiming through a red-dot sight: the sight's own dot is the crosshair (hit markers still show)
  const redDot = useDeathmatchStore((s) => s.aiming && s.weapon !== 'sword' && s.weapon !== 'm24');
  const [, tick] = useState(0);
  useEffect(() => {
    if (!hitAt && !killAt) return;
    const id = setTimeout(() => tick((n) => n + 1), 260);
    return () => clearTimeout(id);
  }, [hitAt, killAt]);
  if (scoped) return null;
  const now = performance.now();
  const gap = 5 + spread * 5;
  const showHit = now - hitAt < 220;
  const showKill = now - killAt < 900;
  return (
    <div className="dm-cross" style={{ ['--gap' as string]: `${gap}px` }}>
      {!redDot && (
        <>
          <i className="t" /><i className="b" /><i className="l" /><i className="r" />
          <span className="dot" />
        </>
      )}
      {showHit && <span className={`dm-hitmark ${hitHead ? 'head' : ''}`}>✕</span>}
      {showKill && <span className="dm-killmark">ELIMINATED</span>}
    </div>
  );
}

/** Desktop: the controls, as key caps along the bottom-left. */
function KeyHints() {
  const touch = useSettingsStore((s) => s.controls.touch);
  const keys = useSettingsStore((s) => s.controls.keys);
  if (touchEnabled(touch)) return null;
  const k = (code: string) => keyLabel(code);
  const list: [string, string][] = [
    [`${k(keys.forward)}${k(keys.left)}${k(keys.back)}${k(keys.right)}`, 'Move'], [k(keys.jump), 'Jump'], [k(keys.sprint), 'Sprint'], [k(keys.crouch), 'Crouch'],
    ['LMB / F', 'Fire'], ['RMB', 'Aim / scope'], ['R', 'Reload'], ['1-3', 'Weapons'], ['Q', 'Last weapon'],
    ['E', 'Pick up'], ['4', 'Small medkit'], ['5', 'Large medkit'], [k(keys.talk), 'Talk'], [k(keys.listen), 'Listen'], ['Tab', 'Scores'], [k(keys.options), 'Options'], ['Esc', 'Menu'],
  ];
  return (
    <ul className="dm-keys" aria-label="Controls">
      {list.map(([key, what]) => <li key={what}><kbd>{key}</kbd>{what}</li>)}
    </ul>
  );
}

function Scope() {
  const scoped = useDeathmatchStore((s) => s.scoped);
  // while scoped the touch buttons sit above the scope so you can still fire, move and un-scope
  useEffect(() => {
    document.documentElement.classList.toggle('dm-scoped', scoped);
    return () => document.documentElement.classList.remove('dm-scoped');
  }, [scoped]);
  if (!scoped) return null;
  return (
    <div className="dm-scope" aria-hidden>
      <div className="lens">
        <i className="h" /><i className="v" /><span className="c" />
      </div>
    </div>
  );
}

function HurtIndicator() {
  const hurtAt = useDeathmatchStore((s) => s.hurtAt);
  const dir = useDeathmatchStore((s) => s.hurtDir);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!hurtAt) return;
    const id = setTimeout(() => tick((n) => n + 1), 900);
    return () => clearTimeout(id);
  }, [hurtAt]);
  if (performance.now() - hurtAt > 850) return null;
  return (
    <div className="dm-hurt" aria-hidden>
      <i style={{ transform: `rotate(${-dir}rad)` }} />
    </div>
  );
}

function Prompt() {
  const p = useDeathmatchStore((s) => s.prompt);
  return p ? <div className="dm-prompt">{p}</div> : null;
}

function Notice() {
  const n = useDeathmatchStore((s) => s.notice);
  useEffect(() => {
    if (!n || n === 'FIGHT!') return;
    const id = setTimeout(() => useDeathmatchStore.getState().set({ notice: null }), 3000);
    return () => clearTimeout(id);
  }, [n]);
  return n ? <div className={`dm-notice ${n === 'FIGHT!' ? 'fight' : ''}`}>{n}</div> : null;
}

function Preparation() {
  const c = useDeathmatchStore((s) => s.countdown);
  const lobby = useDeathmatchStore((s) => s.lobby);
  const n = Math.max(1, Math.ceil(c));
  const red = lobby?.players.filter((p) => p.team === 'red') ?? [];
  const blue = lobby?.players.filter((p) => p.team === 'blue') ?? [];
  return (
    <div className="dm-prep">
      <h2>MATCH STARTING</h2>
      <div key={n} className={`dm-count-big ${n <= 3 ? 'final' : ''}`}>{n}</div>
      <div className="dm-prep-teams">
        <ul className="red">{red.map((p) => <li key={p.id}>{p.name}</li>)}</ul>
        <span>VS</span>
        <ul className="blue">{blue.map((p) => <li key={p.id}>{p.name}</li>)}</ul>
      </div>
      <p>Teams locked · weapons are scattered around the city</p>
    </div>
  );
}

function Waiting() {
  return (
    <div className="dm-prep">
      <h2>WAITING FOR PLAYERS</h2>
      <p>Everyone is loading City Clash…</p>
    </div>
  );
}

function DeathScreen() {
  const alive = useDeathmatchStore((s) => s.alive);
  const by = useDeathmatchStore((s) => s.killedBy);
  const t = useDeathmatchStore((s) => s.respawnIn);
  const phase = useDeathmatchStore((s) => s.phase);
  if (alive || phase !== 'playing') return null;
  return (
    <div className="dm-dead">
      <h2>YOU WERE ELIMINATED</h2>
      {by && <p>Eliminated by <b className={by.team}>{by.name}</b> — {by.weapon}</p>}
      <p className="dm-respawn">Respawning in {Math.max(1, Math.ceil(t))}…</p>
    </div>
  );
}

function ClickToFight() {
  const overlay = useGameStore((s) => s.overlay);
  const cursorFree = useGameStore((s) => s.cursorFree);
  const phase = useDeathmatchStore((s) => s.phase);
  const touch = useSettingsStore((s) => s.controls.touch);
  const options = useDeathmatchStore((s) => s.optionsOpen);
  const [locked, setLocked] = useState(() => typeof document !== 'undefined' && !!document.pointerLockElement);
  useEffect(() => {
    const on = () => setLocked(!!document.pointerLockElement);
    document.addEventListener('pointerlockchange', on);
    on();
    return () => document.removeEventListener('pointerlockchange', on);
  }, []);
  if (locked || cursorFree || overlay !== null || options || touchEnabled(touch) || phase === 'ended') return null;
  return (
    <button className="click-to-play" onClick={() => Game.current?.input.requestLock()}>
      <span className="ctp-card">
        <b>Click to get back in the fight</b>
        <small>WASD move · Mouse aim · Left click / F fire · Right aim · R reload · 1-3 weapons · 4/5 medkits · E pick up · T talk · Tab scores · O options · Esc menu</small>
      </span>
    </button>
  );
}
