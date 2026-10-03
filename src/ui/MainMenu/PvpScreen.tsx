import { useEffect, useState } from 'react';
import { launchPvp } from '../../app/launch';
import { audio } from '../../game/core/audio';
import { hostRoom, joinRoom } from '../../net/pvpNet';
import { normalizeCode } from '../../net/transport';
import { useGameStore } from '../../stores/gameStore';
import { DEFAULT_PVP_SETTINGS, PVP_COLORS, PVP_MAPS, usePvpStore, type PvpKit, type PvpSettings } from '../../stores/pvpStore';
import { MenuBackground } from './MenuBackground';

const KITS: { id: PvpKit; name: string; text: string }[] = [
  { id: 'hunter', name: '🏹 Hunter', text: 'Stone sword, bow, Thornhide armor, wooden shield' },
  { id: 'knight', name: '🛡️ Knight', text: 'Copper sword, bow, Copper armor, copper shield' },
  { id: 'champion', name: '💎 Champion', text: 'Crystal sword & bow, Crystal armor, crystal shield' },
];

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

/** Room code from an invite link (?pvp=CODE). */
export function inviteCodeFromUrl(): string {
  try {
    return normalizeCode(new URLSearchParams(location.search).get('pvp') ?? '');
  } catch {
    return '';
  }
}

/**
 * PvP lobby: host a room (you get a 6-letter code to share) or join one.
 * Peer-to-peer over WebRTC — no game server, nothing to pay for.
 */
export function PvpScreen() {
  const invite = inviteCodeFromUrl();
  const [tab, setTab] = useState<'host' | 'join'>(invite ? 'join' : 'host');
  const [name, setName] = useState<string>(() => load('wb-pvp-name', ''));
  const [color, setColor] = useState<string>(() => load('wb-pvp-color', PVP_COLORS[0]));
  const [code, setCode] = useState(invite);
  const [settings, setSettings] = useState<PvpSettings>(() => ({ ...DEFAULT_PVP_SETTINGS, ...load<Partial<PvpSettings>>('wb-pvp-settings', {}), seedText: '' }));
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const status = usePvpStore((s) => s.status);
  const [error, setError] = useState<string | null>(status);

  useEffect(() => {
    if (status) usePvpStore.getState().set({ status: null });
  }, [status]);

  const back = () => {
    audio.play('click');
    useGameStore.getState().setScreen('menu');
  };
  const playerName = () => (name.trim() || 'Explorer').slice(0, 16);

  const host = async () => {
    setError(null);
    setBusy(online ? 'Opening your room…' : 'Opening a local room…');
    audio.init();
    save('wb-pvp-name', name);
    save('wb-pvp-color', color);
    save('wb-pvp-settings', { ...settings, seedText: undefined });
    try {
      const s = await hostRoom({ name: playerName(), color, online, settings });
      audio.play('chime');
      launchPvp(s);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };
  const join = async () => {
    setError(null);
    const c = normalizeCode(code);
    if (c.length !== 6) {
      setError('Enter the 6-character room code from your friend.');
      return;
    }
    setBusy('Connecting to the room…');
    audio.init();
    save('wb-pvp-name', name);
    save('wb-pvp-color', color);
    try {
      const s = await joinRoom({ code: c, name: playerName(), color, online });
      audio.play('chime');
      launchPvp(s);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };
  const set = <K extends keyof PvpSettings>(k: K, v: PvpSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));

  return (
    <div className="menu-screen">
      <MenuBackground />
      <form className="panel form-panel pvp-panel" onSubmit={(e) => { e.preventDefault(); void (tab === 'host' ? host() : join()); }}>
        <button type="button" className="close-x" onClick={back} aria-label="Back">✕</button>
        <h2 className="panel-title">🎮 PvP Mode</h2>
        <p className="muted pvp-intro">Play with friends on a real WildBlocks map — battle each other or build together. Free & peer-to-peer: players connect straight to each other, no server needed. Up to 8 players.</p>
        <div className="tabs pvp-tabs" role="tablist">
          <button type="button" role="tab" className={`tab ${tab === 'host' ? 'active' : ''}`} onClick={() => setTab('host')}>🏰 Host a match</button>
          <button type="button" role="tab" className={`tab ${tab === 'join' ? 'active' : ''}`} onClick={() => setTab('join')}>🔑 Join with code</button>
        </div>

        <div className="pvp-row">
          <label className="field grow">
            <span>Your name</span>
            <input value={name} maxLength={16} placeholder="Explorer" onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="field">
            <span>Scarf colour</span>
            <div className="pvp-colors">
              {PVP_COLORS.map((c) => (
                <button type="button" key={c} className={`swatch ${c === color ? 'active' : ''}`} style={{ background: c }} aria-label={`Colour ${c}`} onClick={() => setColor(c)} />
              ))}
            </div>
          </div>
        </div>

        {tab === 'join' ? (
          <label className="field">
            <span>Room code</span>
            <input className="code-input" value={code} maxLength={8} placeholder="ABC123" autoCapitalize="characters" autoComplete="off" spellCheck={false} onChange={(e) => setCode(normalizeCode(e.target.value))} />
          </label>
        ) : (
          <>
            <div className="field">
              <span>Game style</span>
              <div className="difficulty-cards style-cards">
                <button type="button" className={`diff-card ${settings.style !== 'together' ? 'active' : ''}`} onClick={() => set('style', 'battle')}>
                  <b>⚔️ Battle</b>
                  <small>Fight for takedowns — timer, scoreboard and a winner</small>
                </button>
                <button type="button" className={`diff-card ${settings.style === 'together' ? 'active' : ''}`} onClick={() => set('style', 'together')}>
                  <b>🤝 Build together</b>
                  <small>Team up: build, explore and survive — players can’t hurt each other</small>
                </button>
              </div>
            </div>
            <div className="field">
              <span>Map</span>
              <div className="map-cards">
                {PVP_MAPS.map((m) => (
                  <button type="button" key={m.id} className={`diff-card map-card ${settings.map === m.id ? 'active' : ''}`} onClick={() => set('map', m.id)}>
                    <b>{m.name}</b>
                    <small>{m.text}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span>Starting kit (everyone gets the same)</span>
              <div className="difficulty-cards">
                {KITS.map((k) => (
                  <button type="button" key={k.id} className={`diff-card ${settings.kit === k.id ? 'active' : ''}`} onClick={() => set('kit', k.id)}>
                    <b>{k.name}</b>
                    <small>{k.text}</small>
                  </button>
                ))}
              </div>
            </div>
            {settings.style !== 'together' && <div className="pvp-row">
              <label className="field grow">
                <span>Match length</span>
                <select value={settings.minutes} onChange={(e) => set('minutes', Number(e.target.value))}>
                  {[5, 10, 15, 20].map((m) => <option key={m} value={m}>{m} minutes</option>)}
                  <option value={0}>No time limit</option>
                </select>
              </label>
              <label className="field grow">
                <span>Win at</span>
                <select value={settings.killLimit} onChange={(e) => set('killLimit', Number(e.target.value))}>
                  {[5, 10, 15, 25].map((m) => <option key={m} value={m}>{m} takedowns</option>)}
                  <option value={0}>Most takedowns when time runs out</option>
                </select>
              </label>
            </div>}
            <label className="field">
              <span>Map seed <small className="muted">(optional — same seed = same map)</small></span>
              <input value={settings.seedText} maxLength={40} placeholder="random" onChange={(e) => set('seedText', e.target.value)} />
            </label>
            {settings.style !== 'together' && <label className="check">
              <input type="checkbox" checked={settings.building} onChange={(e) => set('building', e.target.checked)} />
              <span>Building & digging <small className="muted">(walls, bridges, hideouts — everyone sees them)</small></span>
            </label>}
            <label className="check">
              <input type="checkbox" checked={settings.creatures} onChange={(e) => set('creatures', e.target.checked)} />
              <span>Night creatures <small className="muted">(hostile creatures hunt everyone at night)</small></span>
            </label>
          </>
        )}

        <details className="pvp-advanced">
          <summary>Connection</summary>
          <label className="check">
            <input type="radio" name="pvp-net" checked={online} onChange={() => setOnline(true)} />
            <span>Online <small className="muted">— friends on other devices (internet)</small></span>
          </label>
          <label className="check">
            <input type="radio" name="pvp-net" checked={!online} onChange={() => setOnline(false)} />
            <span>This device <small className="muted">— two tabs of this browser (testing)</small></span>
          </label>
          <small className="muted">Online games use free WebRTC: the PeerJS cloud only introduces the players, then all game data goes directly between browsers. Very strict school/office networks can block direct connections.</small>
        </details>

        {error && <p className="pvp-error" role="alert">{error}</p>}
        <button className="btn primary big" type="submit" disabled={!!busy}>
          {busy ?? (tab === 'host' ? (settings.style === 'together' ? '🤝 Create game' : '⚔️ Create match') : '🔑 Join game')}
        </button>
      </form>
    </div>
  );
}
