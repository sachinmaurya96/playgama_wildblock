import { useEffect, useRef, useState } from 'react';
import { Game } from '../../game/Game';
import { useGameStore } from '../../stores/gameStore';
import { usePvpStore } from '../../stores/pvpStore';
import { keyLabel, useSettingsStore } from '../../stores/settingsStore';
import { Gyro } from '../../game/core/Gyro';

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
      <VoiceHud />
      <KillFeed />
      <RespawnBanner />
      <EmergencyButton />
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
        {!ended && <button className="close-x" onClick={close} aria-label="Close">✕</button>}
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

const RADAR_RANGE = 60; // blocks from the centre to the rim

/**
 * Player radar (top-left): you in the middle, facing up. Other players are
 * coloured dots; players further away sit on the rim as arrows with their
 * distance. ▲ / ▼ = well above / below you (on a cliff, down in a cave).
 */
function Radar() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [nearest, setNearest] = useState<string>('');
  useEffect(() => {
    let raf = 0;
    let textTimer = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const c = ref.current;
      const g = Game.current;
      if (!c || !g?.pvp) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const size = c.clientWidth;
      if (c.width !== Math.round(size * dpr)) {
        c.width = Math.round(size * dpr);
        c.height = Math.round(size * dpr);
      }
      const x = c.getContext('2d')!;
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      const R = size / 2;
      x.clearRect(0, 0, size, size);
      // disc
      x.fillStyle = 'rgba(30, 24, 16, 0.55)';
      x.beginPath();
      x.arc(R, R, R - 1, 0, Math.PI * 2);
      x.fill();
      x.strokeStyle = 'rgba(255, 246, 224, 0.55)';
      x.lineWidth = 2;
      x.stroke();
      x.strokeStyle = 'rgba(255, 246, 224, 0.18)';
      x.lineWidth = 1;
      for (const f of [1 / 3, 2 / 3]) {
        x.beginPath();
        x.arc(R, R, (R - 6) * f, 0, Math.PI * 2);
        x.stroke();
      }
      x.beginPath();
      x.moveTo(R, 6);
      x.lineTo(R, size - 6);
      x.moveTo(6, R);
      x.lineTo(size - 6, R);
      x.stroke();
      const p = g.player.position;
      const yaw = g.player.yaw;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      // north marker on the rim
      {
        const sx = 0 * rx + -1 * rz, sy = -(0 * fx + -1 * fz);
        const l = Math.hypot(sx, sy) || 1;
        x.fillStyle = '#ffe08a';
        x.font = `900 ${Math.max(9, size * 0.09)}px Nunito, sans-serif`;
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillText('N', R + (sx / l) * (R - 9), R + (sy / l) * (R - 9));
      }
      const scale = (R - 10) / RADAR_RANGE;
      let best: { name: string; d: number } | null = null;
      for (const r of g.pvp.remotes.values()) {
        if (r.dead || r.lastHeard < performance.now() - 6000) continue;
        const dx = r.pos.x - p.x, dz = r.pos.z - p.z, dy = r.pos.y - p.y;
        const d = Math.hypot(dx, dz);
        if (!best || d < best.d) best = { name: r.name, d };
        let sx = (dx * rx + dz * rz) * scale, sy = -(dx * fx + dz * fz) * scale;
        const far = d > RADAR_RANGE;
        if (far) {
          const l = Math.hypot(sx, sy) || 1;
          sx = (sx / l) * (R - 10);
          sy = (sy / l) * (R - 10);
        }
        const px = R + sx, py = R + sy;
        x.fillStyle = r.color;
        x.strokeStyle = 'rgba(20, 12, 6, 0.9)';
        x.lineWidth = 2;
        if (far) {
          // arrow pointing outwards
          const a = Math.atan2(sy, sx);
          x.save();
          x.translate(px, py);
          x.rotate(a);
          x.beginPath();
          x.moveTo(7, 0);
          x.lineTo(-5, -5.5);
          x.lineTo(-5, 5.5);
          x.closePath();
          x.fill();
          x.stroke();
          x.restore();
          x.fillStyle = '#fff6e0';
          x.font = `800 ${Math.max(8, size * 0.075)}px Nunito, sans-serif`;
          const tx = R + sx * 0.72, ty = R + sy * 0.72;
          x.fillText(`${Math.round(d)}m`, tx, ty);
        } else {
          x.beginPath();
          x.arc(px, py, 5, 0, Math.PI * 2);
          x.fill();
          x.stroke();
          if (Math.abs(dy) > 4) {
            x.fillStyle = '#fff6e0';
            x.font = `900 ${Math.max(8, size * 0.08)}px Nunito, sans-serif`;
            x.fillText(dy > 0 ? '▲' : '▼', px, py - 10);
          }
        }
      }
      // you
      x.fillStyle = '#ffffff';
      x.strokeStyle = 'rgba(20, 12, 6, 0.9)';
      x.lineWidth = 2;
      x.beginPath();
      x.moveTo(R, R - 8);
      x.lineTo(R - 6, R + 6);
      x.lineTo(R, R + 3);
      x.lineTo(R + 6, R + 6);
      x.closePath();
      x.fill();
      x.stroke();
      textTimer -= 1;
      if (textTimer <= 0) {
        textTimer = 15;
        setNearest(best ? `${best.name} · ${Math.round(best.d)}m` : '');
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="pvp-radar" title="Player radar — you are the white arrow, facing up">
      <canvas ref={ref} />
      <small>{nearest ? `Nearest: ${nearest}` : 'No one nearby yet'}</small>
    </div>
  );
}

function EmergencyButton() {
  const show = usePvpStore((s) => s.emergency);
  const touch = !!Game.current?.input.touch.active;
  if (!show) return null;
  return (
    <button
      className="emergency-btn"
      onPointerDown={(e) => {
        e.stopPropagation();
        Game.current?.pvp?.emergencyRespawn();
      }}
    >
      🆘 Stuck? Respawn near players {!touch && <span className="kbd">R</span>}
    </button>
  );
}

/** ⚙️ quick options for a PvP game: camera view, controls, scoreboard, invite, settings and exit. */
function GearPanel() {
  const close = () => usePvpStore.getState().set({ gearOpen: false });
  const code = usePvpStore((s) => s.code);
  const keys = useSettingsStore((s) => s.controls.keys);
  const camera = useSettingsStore((s) => s.gameplay.cameraMode);
  const [confirmExit, setConfirmExit] = useState(false);
  const [help, setHelp] = useState(false);
  const touch = !!Game.current?.input.touch.active;
  const setCamera = (mode: 'first' | 'third') => {
    const g = Game.current;
    if (g) g.player.cameraMode = mode;
    useSettingsStore.getState().update('gameplay', { cameraMode: mode });
  };
  const back = () => {
    if (touch) close();
    else Game.current?.setPvpOptions(false);
  };
  const exit = () => {
    if (!confirmExit) return setConfirmExit(true);
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
        <span>👁️ Camera</span>
        <div className="seg">
          <button className={`seg-btn ${camera === 'first' ? 'active' : ''}`} onClick={() => setCamera('first')}>1st person</button>
          <button className={`seg-btn ${camera === 'third' ? 'active' : ''}`} onClick={() => setCamera('third')}>3rd person</button>
        </div>
      </div>
      {touch && <GyroRow />}
      <VoicePanel />
      <button className="btn small" onClick={() => setHelp(!help)}>🎮 Controls</button>
      {help && (
        <div className="gear-help">
          {touch ? (
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
              <div><b>{keyLabel(keys.options)}</b> this options panel · <b>Esc</b> pause · <b>R</b> emergency respawn (when stuck)</div>
              <div><b>{keyLabel(keys.talk)}</b> talk · <b>{keyLabel(keys.listen)}</b> listen on / off (voice chat)</div>
            </>
          )}
        </div>
      )}
      <button className="btn small" onClick={() => { close(); usePvpStore.getState().set({ scoreboardOpen: true }); }}>🏆 Players & scores</button>
      <button className="btn small" onClick={() => void copyInvite(code)}>📋 Invite friends</button>
      <button className="btn small" onClick={() => { close(); Game.current?.openOverlay('settings'); }}>⚙️ Settings (sound, graphics…)</button>
      <button className={`btn small ${confirmExit ? 'danger' : ''}`} onClick={exit}>{confirmExit ? 'Tap again to leave' : '🚪 Exit game'}</button>
      <button className="btn small primary" onClick={back}>Resume</button>
    </div>
  );
}

/** Gyro aiming quick switch (phones & tablets); fine-tuning lives in Settings → Controls. */
function GyroRow() {
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

/** Voice chat section of the ⚙️ panel: listen / talk, talk style, proximity, per-player mute, leave voice. */
function VoicePanel() {
  const on = usePvpStore((s) => s.voiceOn);
  const listen = usePvpStore((s) => s.voiceListen);
  const micReady = usePvpStore((s) => s.voiceMicReady);
  const mode = usePvpStore((s) => s.voiceMode);
  const prox = usePvpStore((s) => s.voiceProximity);
  const peers = usePvpStore((s) => s.voicePeers);
  const deaf = usePvpStore((s) => s.voiceDeaf);
  const muted = usePvpStore((s) => s.voiceMuted);
  const speaking = usePvpStore((s) => s.voiceSpeaking);
  const err = usePvpStore((s) => s.voiceError);
  const players = usePvpStore((s) => s.players);
  const keys = useSettingsStore((s) => s.controls.keys);
  const touch = !!Game.current?.input.touch.active;
  const voice = () => Game.current?.pvp?.voice;
  return (
    <div className="voice-panel">
      <div className="gear-row">
        <span>🎧 Listen</span>
        <div className="seg">
          <button className={`seg-btn ${!listen ? 'active' : ''}`} onClick={() => void voice()?.setListen(false)}>Off</button>
          <button className={`seg-btn ${listen ? 'active' : ''}`} onClick={() => void voice()?.setListen(true)}>On</button>
        </div>
      </div>
      <div className="gear-row">
        <span>🎤 Talk</span>
        <div className="seg">
          <button className={`seg-btn ${mode === 'push' ? 'active' : ''}`} onClick={() => voice()?.setMode('push')}>Hold to talk</button>
          <button className={`seg-btn ${mode === 'open' ? 'active' : ''}`} onClick={() => voice()?.setMode('open')}>Tap on / off</button>
        </div>
      </div>
      <small className="muted">
        {touch ? 'Use the 🎤 and 🎧 buttons on the left of the screen.' : `Keys: ${keyLabel(keys.talk)} talk · ${keyLabel(keys.listen)} listen.`}{' '}
        {mode === 'push' ? 'Hold 🎤 while you speak.' : 'Tap 🎤 to open / close your mic.'}
      </small>
      {on && (
        <div className="gear-row sub">
          <span>Hear</span>
          <div className="seg">
            <button className={`seg-btn ${prox ? 'active' : ''}`} onClick={() => voice()?.setProximity(true)}>Nearby louder</button>
            <button className={`seg-btn ${!prox ? 'active' : ''}`} onClick={() => voice()?.setProximity(false)}>Everyone</button>
          </div>
        </div>
      )}
      {err && <small className="voice-err">{err}</small>}
      {on && (
        <div className="voice-list">
          {players.filter((p) => peers.includes(p.id)).map((p) => (
            <div key={p.id} className={`voice-row ${speaking.includes(p.id) ? 'speaking' : ''}`}>
              <span className="dot" style={{ background: p.color }} />
              <span className="vname">{p.name}{deaf.includes(p.id) ? ' · 🔕 not listening' : ''}</span>
              <button className="btn small" onClick={() => voice()?.toggleMute(p.id)}>{muted.includes(p.id) ? '🔇 Unmute' : '🔊 Mute'}</button>
            </div>
          ))}
          {!peers.length && <small className="muted">No one else is in voice yet — ask friends to tap 🎧 or 🎤.</small>}
        </div>
      )}
      {micReady && <button className="btn small" onClick={() => voice()?.releaseMic()}>🎙️ Stop using the microphone</button>}
      {on && <button className="btn small" onClick={() => voice()?.disable()}>Leave voice chat</button>}
      {!on && <small className="muted">Only people in this room can hear you. Your mic is used only while you talk.</small>}
    </div>
  );
}

/**
 * Voice controls on screen: 🎧 listen (tap on / off) and 🎤 talk (hold, or tap to toggle in open-mic mode),
 * plus who is speaking right now.
 */
function VoiceHud() {
  const listen = usePvpStore((s) => s.voiceListen);
  const micOn = usePvpStore((s) => s.voiceMicOn);
  const mode = usePvpStore((s) => s.voiceMode);
  const talking = usePvpStore((s) => s.voiceTalking);
  const speaking = usePvpStore((s) => s.voiceSpeaking);
  const players = usePvpStore((s) => s.players);
  const selfId = usePvpStore((s) => s.selfId);
  const keys = useSettingsStore((s) => s.controls.keys);
  const touch = !!Game.current?.input.touch.active;
  const voice = () => Game.current?.pvp?.voice;
  const others = players.filter((p) => p.id !== selfId && speaking.includes(p.id)).slice(0, 4);
  const hold = (v: boolean) => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (v) (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    voice()?.setPush('button', v);
  };
  const talkProps = mode === 'push'
    ? { onPointerDown: hold(true), onPointerUp: hold(false), onPointerCancel: hold(false), onLostPointerCapture: hold(false) }
    : { onPointerDown: (e: React.PointerEvent) => { e.stopPropagation(); void voice()?.toggleTalk(); } };
  const talkLabel = talking ? 'Talking' : mode === 'push' ? 'Hold to talk' : micOn ? 'Mic on' : 'Mic off';
  return (
    <div className="voice-dock" onPointerDown={(e) => e.stopPropagation()}>
      {others.length > 0 && (
        <div className="voice-speakers">
          {others.map((p) => (
            <span key={p.id} className="voice-chip" style={{ borderColor: p.color }}>🔊 {p.name}</span>
          ))}
        </div>
      )}
      <div className="voice-btns">
        <button
          className={`vbtn listen ${listen ? 'on' : 'off'}`}
          aria-label={listen ? 'Stop listening to voice chat' : 'Listen to voice chat'}
          aria-pressed={listen}
          title={`Listen to the other players (${keyLabel(keys.listen)})`}
          onPointerDown={(e) => { e.stopPropagation(); void voice()?.toggleListen(); }}
        >
          <span className="vicon">{listen ? '🎧' : '🔕'}</span>
          <small>{listen ? 'Listening' : 'Listen'}{!touch && <kbd>{keyLabel(keys.listen)}</kbd>}</small>
        </button>
        <button
          className={`vbtn talk ${talking ? 'live' : micOn ? 'on' : ''}`}
          aria-label={mode === 'push' ? 'Hold to talk' : micOn ? 'Turn microphone off' : 'Turn microphone on'}
          aria-pressed={talking}
          title={`${mode === 'push' ? 'Hold to talk' : 'Tap to turn your mic on / off'} (${keyLabel(keys.talk)})`}
          {...talkProps}
        >
          <span className="vicon">{talking || micOn ? '🎙️' : '🎤'}</span>
          <small>{talkLabel}{!touch && <kbd>{keyLabel(keys.talk)}</kbd>}</small>
        </button>
      </div>
    </div>
  );
}
