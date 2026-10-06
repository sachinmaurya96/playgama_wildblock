import { useState } from 'react';
import { launchCoopHost, launchPvp } from '../../app/launch';
import { gameRegistry } from '../../game/registry';
import { PLOT_Y } from '../../game/world/PlotGenerator';
import { hostRoom } from '../../net/pvpNet';
import { useGameStore } from '../../stores/gameStore';
import { DEFAULT_PVP_SETTINGS, PVP_COLORS, type PvpSettings, type PvpSource, type PvpStyle } from '../../stores/pvpStore';

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * 🎮 PvP mode for the world you're in (Survival or Build Home): opens a room on this very map —
 * same terrain, your builds, your Build Home furniture — and friends join with the room code.
 * Your save isn't touched: the match is played on a copy.
 */
export function PlayWithFriends() {
  const mode = useGameStore((s) => s.world?.mode);
  const [style, setStyle] = useState<PvpStyle>('battle');
  const [online, setOnline] = useState(true);
  const [name, setName] = useState<string>(() => load('wb-pvp-name', ''));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // already sharing (or a friend's lot): nothing to open
  if ((mode !== 'survival' && mode !== 'build') || gameRegistry.current?.pvp) return null;

  const start = async () => {
    const g = gameRegistry.current;
    if (!g || busy) return;
    setError(null);
    setBusy('Saving your world…');
    if (!(await g.saveNow('quit'))) {
      setError('Your world could not be saved. Check browser storage and try again.');
      setBusy(null);
      return;
    }
    // everything the match needs from this world, captured before it closes
    const mods = new Map<number, [number, number][]>([...g.world.mods].map(([k, m]) => [k, [...m.entries()]]));
    const objects = g.build ? g.build.objects.serialize() : [];
    const p = g.player.position;
    const arena = g.build ? g.meta.build?.plot ?? 'meadow' : undefined;
    const source: PvpSource = {
      kind: g.build ? 'build' : 'survival', name: g.meta.name, seed: g.meta.seed, caves: g.meta.caves ?? 1, arena,
      spawn: g.build ? { x: p.x, y: PLOT_Y + 1, z: p.z } : { x: p.x, y: p.y, z: p.z },
    };
    const saved = load<Partial<PvpSettings>>('wb-pvp-settings', {});
    // Build Home: always building together, with everyone's full Build Home tools
    const settings: PvpSettings = { ...DEFAULT_PVP_SETTINGS, ...saved, minutes: 0, style: g.build ? 'together' : style, map: arena ?? 'wild', seedText: `world-${g.meta.id}`, source };
    const worldId = g.meta.id;
    const playerName = (name.trim() || 'Explorer').slice(0, 16);
    try {
      localStorage.setItem('wb-pvp-name', JSON.stringify(name));
    } catch {
      /* private mode */
    }
    setBusy(online ? 'Opening your room…' : 'Opening a local room…');
    try {
      const session = await hostRoom({ name: playerName, color: load('wb-pvp-color', PVP_COLORS[0]), online, settings });
      useGameStore.setState({ overlay: null });
      if (source.kind === 'build') await launchCoopHost(worldId);
      else {
        session.sourceObjects = objects;
        launchPvp(session, mods);
      }
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="play-friends">
      <div className="pf-head">
        <b>🎮 {mode === 'build' ? 'Build this home together with friends' : 'PvP mode — play this world with friends'}</b>
        <small className="muted">
          {mode === 'build'
            ? 'Friends join your lot in Build Home mode with the full catalog and tools. Everything anyone builds shows up for everyone and is saved in your project.'
            : 'Opens a room on this map with everything you built. Your save stays exactly as it is.'}
        </small>
        <small className="muted">After opening, share the six-character code shown in the in-game room bar. Friends choose Main menu → Join Friend’s World and enter it. Use Online for other devices.</small>
      </div>
      {mode !== 'build' && (
        <div className="seg pf-style">
          <button className={`seg-btn ${style === 'battle' ? 'active' : ''}`} onClick={() => setStyle('battle')}>⚔️ Battle</button>
          <button className={`seg-btn ${style === 'together' ? 'active' : ''}`} onClick={() => setStyle('together')}>🤝 Build together</button>
        </div>
      )}
      <div className="pf-row">
        <input className="search" maxLength={16} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Your name" />
        <div className="seg">
          <button className={`seg-btn ${online ? 'active' : ''}`} onClick={() => setOnline(true)} title="Friends on other devices">🌐 Online</button>
          <button className={`seg-btn ${!online ? 'active' : ''}`} onClick={() => setOnline(false)} title="Two tabs of this browser (testing)">💻 This device</button>
        </div>
      </div>
      {error && <p className="pvp-error" role="alert">{error}</p>}
      <button className="btn primary pvp-btn" disabled={!!busy} onClick={() => void start()}>{busy ?? '🎮 Open to friends'}</button>
    </div>
  );
}
