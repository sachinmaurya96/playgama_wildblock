import { useEffect, useState } from 'react';
import { Game } from '../../game/Game';
import { useGameStore } from '../../stores/gameStore';
import { usePvpStore } from '../../stores/pvpStore';
import { keyLabel, useSettingsStore } from '../../stores/settingsStore';
import { Gyro } from '../../game/core/Gyro';
import { VoiceDock, VoicePanel } from '../Voice/VoiceControls';
import { PlayerRadar, type RadarBlip } from '../common/Radar';

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export function inviteLink(code: string): string {
  return `${location.origin}${location.pathname}?pvp=${code}`;
}

export async function copyInvite(code: string): Promise<void> {
  const link = inviteLink(code);
  const text = `Join my WildBlocks PvP match! Room code: ${code}\n${link}`;
  try {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share && Game.current?.input.touch.active) await nav.share({ title: 'WildBlocks PvP', text, url: link });
    else await navigator.clipboard.writeText(text);
    useGameStore.getState().toast('Invite copied — send it to your friends!', 'info', '📋');
  } catch {
    useGameStore.getState().toast(`Room code: ${code}`, 'info', '🔑');
  }
}

/** Build Home with friends: room code, who's here, and the voice buttons (the Build Home HUD does the rest). */
export function CoopBar() {
  const active = usePvpStore((s) => s.active);
  const code = usePvpStore((s) => s.code);
  const online = usePvpStore((s) => s.online);
  const players = usePvpStore((s) => s.players);
  const open = usePvpStore((s) => s.scoreboardOpen);
  const gear = usePvpStore((s) => s.gearOpen);
  if (!active) return null;
  return (
    <>
      <div className="coop-bar">
        <button className="pvp-chip code" onClick={() => void copyInvite(code)} title="Copy invite link">
          {online ? '🌐' : '💻'} <b>{code}</b> <small>· {players.length}/8</small>
        </button>
        <button className="pvp-chip" onClick={() => usePvpStore.getState().set({ scoreboardOpen: !open })} title="Who's building">🤝 {players.length} 👥</button>
        <button className={`pvp-chip gear ${gear ? 'on' : ''}`} aria-label="Options" title="Options: voice, players, invite, settings, exit (Esc closes)" onClick={() => Game.current?.setPvpOptions(!gear)}>⚙️</button>
      </div>
      {gear && <GearPanel kind="build" />}
      {/* Build Home uses T / H for its tools, so no key caps on the voice buttons here */}
      <VoiceDock keys={false} />
      {open && <Scoreboard />}
    </>
  );
}

/** PvP HUD: room code & timer, your score, kill feed, respawn countdown, scoreboard and match results. */
export function PvpHud() {
  const code = usePvpStore((s) => s.code);
  const online = usePvpStore((s) => s.online);
  const timeLeft = usePvpStore((s) => s.timeLeft);
  const players = usePvpStore((s) => s.players);
  const selfId = usePvpStore((s) => s.selfId);
  const killLimit = usePvpStore((s) => s.settings.killLimit);
  const me = players.find((p) => p.id === selfId);
  const open = usePvpStore((s) => s.scoreboardOpen);
  const together = usePvpStore((s) => s.settings.style === 'together');
  const gear = usePvpStore((s) => s.gearOpen);
  const optKey = useSettingsStore((s) => keyLabel(s.controls.keys.options));
  const touch = !!Game.current?.input.touch.active;
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Tab' || useGameStore.getState().overlay !== null) return;
      e.preventDefault();
      if (usePvpStore.getState().phase === 'playing') usePvpStore.getState().set({ scoreboardOpen: true });
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Tab' && usePvpStore.getState().phase === 'playing') usePvpStore.getState().set({ scoreboardOpen: false });
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
    };
  }, []);
  return (
    <>
      <div className="pvp-top">
        <button className="pvp-chip code" onClick={() => void copyInvite(code)} title="Copy invite link">
          {online ? '🌐' : '💻'} <b>{code}</b> <small>· {players.length}/8</small>
        </button>
        {timeLeft !== null && <span className={`pvp-chip timer ${timeLeft <= 30 ? 'hurry' : ''}`}>⏱ {fmtTime(timeLeft)}</span>}
        {together ? (
          <button className="pvp-chip score" onClick={() => usePvpStore.getState().set({ scoreboardOpen: !open })} title="Players (hold Tab)">🤝 Build together <small>· {players.length} 👥</small></button>
        ) : (
          <button className="pvp-chip score" onClick={() => usePvpStore.getState().set({ scoreboardOpen: !open })} title="Scoreboard (hold Tab)">
            ⚔️ {me?.kills ?? 0}{killLimit > 0 ? <small>/{killLimit}</small> : null} <small>· 💀 {me?.deaths ?? 0}</small> 🏆
          </button>
        )}
        <button className={`pvp-chip gear ${gear ? 'on' : ''}`} aria-label="Game options" title={`Options: camera, voice, controls, exit (${optKey})`} onClick={() => Game.current?.setPvpOptions(!gear)}>
          ⚙️{!touch && <small className="chip-key">{optKey}</small>}
        </button>
      </div>
      {gear && <GearPanel />}
      <Radar />
      <VoiceDock />
      <KillFeed />
      <RespawnBanner />
      {open && <Scoreboard />}
    </>
  );
}

function KillFeed() {
  const feed = usePvpStore((s) => s.feed);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const now = performance.now();
  const shown = feed.filter((f) => now - f.at < 8000);
  if (!shown.length) return null;
  return (
    <div className="kill-feed">
      {shown.map((f) => (
        <div key={f.id} className="kf-row">
          {f.how === 'joined' || f.how === 'left' ? (
            <span><b style={{ color: f.victimColor }}>{f.victim}</b> {f.how === 'joined' ? 'joined the match' : 'left'}</span>
          ) : f.killer ? (
            <span><b style={{ color: f.killerColor }}>{f.killer}</b> <i>{f.how}</i> <b style={{ color: f.victimColor }}>{f.victim}</b></span>
          ) : (
            <span>💀 <b style={{ color: f.victimColor }}>{f.victim}</b> {f.how === 'fall' ? 'fell' : 'was defeated'}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function RespawnBanner() {
  const t = usePvpStore((s) => s.respawnIn);
  const by = usePvpStore((s) => s.killedBy);
  const phase = usePvpStore((s) => s.phase);
  if (t <= 0 || phase !== 'playing') return null;
  return (
    <div className="respawn-banner">
      <b>{by ? `Taken down by ${by}` : 'You were defeated'}</b>
      <span>Back in the fight in {t}…</span>
    </div>
  );
}

export function Scoreboard() {
  const players = usePvpStore((s) => s.players);
  const selfId = usePvpStore((s) => s.selfId);
  const phase = usePvpStore((s) => s.phase);
  const winner = usePvpStore((s) => s.winner);
  const isHost = usePvpStore((s) => s.isHost);
  const code = usePvpStore((s) => s.code);
  const ended = phase === 'ended';
  const close = () => {
    usePvpStore.getState().set({ scoreboardOpen: false });
    if (useGameStore.getState().overlay === null) Game.current?.input.requestLock();
  };
  const leave = () => {
    useGameStore.setState({ overlay: null });
    useGameStore.getState().setScreen('menu');
  };
  return (
    <div className={`scoreboard-wrap ${ended ? 'ended' : ''}`} onPointerDown={(e) => e.stopPropagation()}>
      <div className="panel scoreboard">
        <button className="close-x" onClick={close} aria-label="Close">✕</button>
        <h2 className="panel-title">{ended ? (winner ? `🏆 ${winner} wins!` : '🤝 It’s a draw!') : usePvpStore.getState().settings.style === 'together' ? '👥 Players' : '🏆 Scoreboard'}</h2>
        <table>
          <thead>
            <tr><th>#</th><th>Player</th><th>⚔️</th><th>💀</th></tr>
          </thead>
          <tbody>
            {players.map((p, i) => (
              <tr key={p.id} className={p.id === selfId ? 'me' : ''}>
                <td>{i + 1}</td>
                <td><span className="dot" style={{ background: p.color }} />{p.name}{p.id === selfId ? ' (you)' : ''}</td>
                <td>{p.kills}</td>
                <td>{p.deaths}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="sb-actions">
          {!ended && <button className="btn small" onClick={() => void copyInvite(code)}>📋 Invite friends</button>}
          {ended && isHost && <button className="btn primary" onClick={() => Game.current?.pvp?.restartMatch()}>🔁 Play again</button>}
          {ended && !isHost && <span className="muted">Waiting for the host to start a new round…</span>}
          {ended && <button className="btn" onClick={leave}>Leave match</button>}
        </div>
      </div>
    </div>
  );
}

/** PvP: everyone else in the room (alive, recently heard from). */
function Radar() {
  return (
    <PlayerRadar
      blips={() => {
        const pvp = Game.current?.pvp;
        if (!pvp) return null;
        const out: RadarBlip[] = [];
        for (const r of pvp.remotes.values()) if (!r.dead && r.lastHeard >= performance.now() - 6000) out.push({ name: r.name, color: r.color, x: r.pos.x, y: r.pos.y, z: r.pos.z });
        return out;
      }}
    />
  );
}

/**
 * ⚙️ quick options: camera view, controls, voice, scoreboard, invite, settings and exit.
 * kind 'build' = Build Home with friends (its own camera & tools).
 */
function GearPanel({ kind = 'pvp' }: { kind?: 'pvp' | 'build' }) {
  const build = kind === 'build';
  const close = () => usePvpStore.getState().set({ gearOpen: false });
  const code = usePvpStore((s) => s.code);
  const keys = useSettingsStore((s) => s.controls.keys);
  const camera = useSettingsStore((s) => s.gameplay.cameraMode);
  const [confirmExit, setConfirmExit] = useState(false);
  const [help, setHelp] = useState(false);
  const touch = !!Game.current?.input.touch.active;
  const setCamera = (mode: 'first' | 'third') => {
    const g = Game.current;
    if (g?.build) return g.build.setPlayerView(mode);
    if (g) g.player.cameraMode = mode;
    useSettingsStore.getState().update('gameplay', { cameraMode: mode });
  };
  const back = () => {
    if (touch) close();
    else Game.current?.setPvpOptions(false);
  };
  const exit = async () => {
    if (!confirmExit) return setConfirmExit(true);
    if (build) await Game.current?.saveNow('quit');
    useGameStore.setState({ overlay: null });
    useGameStore.getState().setScreen('menu');
  };
  return (
    <div className="gear-panel panel" onPointerDown={(e) => e.stopPropagation()}>
      <div className="gear-head">
        <b>⚙️ Options{!touch && <small className="muted"> · {keyLabel(keys.options)} / Esc to close</small>}</b>
        <button className="gear-x" onClick={back} aria-label="Close options">✕</button>
      </div>
      <div className="gear-row">
        <span>👁️ Camera{build && !touch && <small> · {keyLabel(keys.buildView)}</small>}</span>
        <div className="seg">
          <button className={`seg-btn ${camera === 'first' ? 'active' : ''}`} onClick={() => setCamera('first')}>1st person</button>
          <button className={`seg-btn ${camera === 'third' ? 'active' : ''}`} onClick={() => setCamera('third')}>3rd person</button>
        </div>
      </div>
      {!build && <QuickRespawn onDone={back} />}
      {touch && !build && <GyroRow />}
      <VoicePanel keys={!build} />
      <LocationPanel onDone={back} />
      <button className="btn small" onClick={() => setHelp(!help)}>🎮 Controls</button>
      {help && (
        <div className="gear-help">
          {build ? (
            touch ? (
              <>
                <div><b>Left stick</b> move · <b>drag</b> look · <b>🧱</b> place · <b>⤒</b> jump (double-tap to fly)</div>
                <div><b>🎤</b> talk · <b>🎧</b> listen (voice chat) · <b>⚙️</b> this menu</div>
              </>
            ) : (
              <>
                <div><b>WASD</b> move · <b>Space</b> jump (double-tap to fly) · <b>Left click</b> place · <b>Right click</b> remove</div>
                <div><b>Esc</b> pause / close · <b>🎤 / 🎧</b> buttons on the left: voice chat · <b>⚙️</b> this menu</div>
              </>
            )
          ) : touch ? (
            <>
              <div><b>Left stick</b> move · push to the rim to sprint</div>
              <div><b>Drag right side</b> look · <b>tap</b> attack / use · <b>hold</b> dig</div>
              <div><b>⛏️</b> attack / break · <b>🧱 / 🏹</b> place / shoot · <b>⤒</b> jump · <b>⤓</b> crouch</div>
              <div><b>🎤</b> talk · <b>🎧</b> listen (voice chat) · <b>🏆</b> players · <b>🎒</b> backpack · <b>⚙️</b> this menu</div>
              <div><b>Gyro</b> (optional): turn the device to aim — switch it on above</div>
            </>
          ) : (
            <>
              <div><b>WASD</b> move · <b>Shift</b> sprint · <b>Space</b> jump · <b>Ctrl</b> crouch</div>
              <div><b>Left click</b> attack / break · <b>Right click</b> place / shoot bow</div>
              <div><b>1–9</b> hotbar · <b>{keyLabel(keys.inventory)}</b> backpack · <b>{keyLabel(keys.camera)}</b> camera · <b>Tab</b> players</div>
              <div><b>{keyLabel(keys.options)}</b> this options panel · <b>Esc</b> pause</div>
              <div><b>{keyLabel(keys.talk)}</b> talk · <b>{keyLabel(keys.listen)}</b> listen on / off (voice chat)</div>
            </>
          )}
          {!touch && <div><b>{keyLabel(keys.cursor)}</b> free cursor / return to mouse-look</div>}
        </div>
      )}
      <button className="btn small" onClick={() => { close(); usePvpStore.getState().set({ scoreboardOpen: true }); }}>🏆 Players & scores</button>
      <button className="btn small" onClick={() => void copyInvite(code)}>📋 Invite friends</button>
      <button className="btn small" onClick={() => { close(); Game.current?.openOverlay('settings'); }}>⚙️ Settings (sound, graphics…)</button>
      <button className={`btn small ${confirmExit ? 'danger' : ''}`} onClick={() => void exit()}>{confirmExit ? 'Tap again to leave' : build ? '🚪 Save & exit' : '🚪 Exit game'}</button>
      <button className="btn small primary" onClick={back}>Resume</button>
    </div>
  );
}

/** Ticks every half second while mounted (positions / cooldowns shown in the ⚙️ panel). */
function useTick(ms = 500) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/** 🆘 Always-available respawn: back on solid ground near the other players (keeps health & items). */
function QuickRespawn({ onDone }: { onDone: () => void }) {
  useTick();
  const [msg, setMsg] = useState<string | null>(null);
  const pvp = Game.current?.pvp;
  const blocked = pvp?.moveBlocked() ?? null;
  return (
    <div className="quick-respawn">
      <button
        className="btn small danger"
        disabled={!!blocked}
        onClick={() => {
          const why = Game.current?.pvp?.quickRespawn() ?? null;
          if (why) setMsg(why);
          else onDone();
        }}
      >
        🆘 Quick respawn near players
      </button>
      {(blocked || msg) && <small className="muted">{blocked ?? msg}</small>}
    </div>
  );
}

/** Parse "x y z", "x, z", "x/y/z"… → numbers (2 = x z, 3 = x y z). */
export function parseCoords(text: string): { x: number; y?: number; z: number } | null {
  const parts = text.trim().split(/[\s,\/]+/);
  if (!parts.every((p) => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(p))) return null;
  const n = parts.map(Number);
  if (!n.every(Number.isFinite)) return null;
  if (n.length === 2) return { x: n[0], z: n[1] };
  if (n.length === 3) return { x: n[0], y: n[1], z: n[2] };
  return null;
}

/** 📍 Coordinates: yours (copy to share), every player's (tap Go to join them) and a box to teleport anywhere. */
export function LocationPanel({ onDone }: { onDone: () => void }) {
  useTick();
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const build = Game.current?.build;
  const pvp = Game.current?.pvp;
  const pos = Game.current?.player.position;
  const spots = pvp?.playerSpots() ?? (build && pos ? [{ id: 'self', name: 'You', color: '#fff', x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z), dist: 0, me: true }] : []);
  const me = spots.find((p) => p.me);
  const result = (why: string | null) => {
    if (why) setMsg(why);
    else {
      setMsg(null);
      setText('');
      onDone();
    }
  };
  const copy = async () => {
    if (!me) return;
    const t = `${me.x} ${me.y} ${me.z}`;
    try {
      await navigator.clipboard.writeText(t);
      setMsg(`Copied ${t} — send it to a friend.`);
    } catch {
      setMsg(`Your coordinates: ${t}`);
    }
  };
  const teleport = async (x: number, z: number, y?: number) => {
    if (busy) return;
    setBusy(true);
    try {
      const g = Game.current;
      // Build Home needs its own collision checks and camera updates, even with friends.
      const why = g?.build ? await g.build.navigation.teleportTo(x, z, y) : g?.pvp ? g.pvp.teleportTo(x, z, y) : 'Teleport is unavailable.';
      result(why);
    } catch {
      setMsg('Teleport could not finish — please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="location-panel">
      <div className="gear-row">
        <span>📍 Location</span>
        {me && (
          <button className="coord-chip" onClick={() => void copy()} title="Copy your coordinates">
            {me.x} {me.y} {me.z} 📋
          </button>
        )}
      </div>
      {spots.filter((p) => !p.me).map((p) => (
        <div key={p.id} className="loc-row">
          <span className="dot" style={{ background: p.color }} />
          <span className="vname">{p.name}</span>
          <small className="muted">{p.x} {p.y} {p.z} · {p.dist}m</small>
          <button className="btn small" disabled={busy} onClick={() => {
            if (build) void teleport(p.x + (p.x <= 125 ? 2 : -2), p.z, p.y);
            else result(Game.current?.pvp?.teleportToPlayer(p.id) ?? 'Teleport is unavailable.');
          }}>Go</button>
        </div>
      ))}
      {build && <small className="muted">X and Z: -128 to 127 · Y: 2 to 120. Leave Y out to land on the surface.</small>}
      {pvp && spots.length <= 1 && <small className="muted">Friends' coordinates show up here when they join.</small>}
      <form
        className="loc-form"
        onSubmit={(e) => {
          e.preventDefault();
          const c = parseCoords(text);
          if (!c) return setMsg('Type coordinates like 120 64 -35 (or just 120 -35).');
          void teleport(c.x, c.z, c.y);
        }}
      >
        <input className="search" inputMode="text" placeholder={build ? 'x y z  (e.g. 20 41 -35)' : 'x y z  (e.g. 120 64 -35)'} value={text} onChange={(e) => setText(e.target.value)} aria-label="Coordinates to teleport to" disabled={busy} />
        <button type="submit" className="btn small primary" disabled={busy}>{busy ? 'Loading…' : 'Teleport'}</button>
      </form>
      {msg && <small className="muted">{msg}</small>}
    </div>
  );
}

/** Gyro aiming quick switch (phones & tablets); fine-tuning lives in Settings → Controls. */
export function GyroRow() {
  const gyro = useSettingsStore((s) => s.controls.gyro);
  const [err, setErr] = useState<string | null>(null);
  const set = async (on: boolean) => {
    setErr(null);
    if (on && !(await Gyro.requestPermission())) {
      setErr(Gyro.supported() ? 'Motion access was not allowed.' : 'This device has no gyroscope.');
      return;
    }
    useSettingsStore.getState().update('controls', { gyro: { ...gyro, enabled: on } });
  };
  return (
    <>
      <div className="gear-row">
        <span>🎯 Gyro aim</span>
        <div className="seg">
          <button className={`seg-btn ${!gyro.enabled ? 'active' : ''}`} onClick={() => void set(false)}>Off</button>
          <button className={`seg-btn ${gyro.enabled ? 'active' : ''}`} onClick={() => void set(true)}>On</button>
        </div>
      </div>
      {err && <small className="voice-err">{err}</small>}
    </>
  );
}
