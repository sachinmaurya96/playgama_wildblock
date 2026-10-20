import { useState } from 'react';
import { gameRegistry } from '../../game/registry';
import { useGameStore } from '../../stores/gameStore';
import { useWorldStore } from '../../stores/worldStore';
import { usePvpStore } from '../../stores/pvpStore';

export function DeathScreen() {
  const death = useGameStore((s) => s.death);
  const home = useWorldStore((s) => s.home);
  const pvp = usePvpStore((s) => s.active);
  const by = usePvpStore((s) => s.killedBy);
  const [busy, setBusy] = useState(false);
  const quit = async () => {
    setBusy(true);
    const saved = await gameRegistry.current?.saveNow('quit');
    if (saved === false) { setBusy(false); return; }
    useGameStore.getState().setScreen('menu');
  };
  return (
    <div className="modal-backdrop death-backdrop" role="dialog" aria-modal="true" aria-labelledby="death-title">
      <div className="panel death-panel">
        <h2 id="death-title" className="panel-title">{pvp ? 'You were defeated.' : '🍂 You were overcome by the wilds.'}</h2>
        {pvp ? <p>{by ? `Taken down by ${by}.` : 'Your player is defeated.'}</p> : <p>{death?.cause ? `Cause: ${death.cause}.` : ''} {death ? death.lost > 0 ? `You dropped ${death.lost} items — your satchel is marked 🍂 on the map and compass.` : 'Nothing was lost.' : 'Your saved player is still defeated.'}</p>}
        <p>Respawn when you are ready.</p>
        <div className="menu-buttons">
          {pvp ? <button className="btn primary" disabled={busy} onClick={() => gameRegistry.current?.pvp?.requestRespawn()}>Respawn</button> : <>
            {home && <button className="btn primary" disabled={busy} onClick={() => gameRegistry.current?.respawn('home')}>Respawn at home</button>}
            <button className={`btn ${home ? '' : 'primary'}`} disabled={busy} onClick={() => gameRegistry.current?.respawn('camp')}>Respawn at starting camp</button>
          </>}
          <button className="btn" disabled={busy} onClick={() => void quit()}>{busy ? 'Saving…' : pvp ? 'Leave match' : 'Save & Quit to Menu'}</button>
        </div>
      </div>
    </div>
  );
}

export function SleepDialog() {
  const close = () => gameRegistry.current?.closeOverlay();
  const build = useGameStore((s) => s.world?.mode === 'build');
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="panel sleep-panel">
        <button className="close-x" onClick={close} aria-label="Close">✕</button>
        <h2 className="panel-title">🛏️ Rest at the bed</h2>
        <p>{build ? 'Sleep until morning to change the time of day. Build Home beds work at any time, including when the daylight setting is locked.' : 'Rest here to set your home, or sleep until morning. Furniture near the bed adds comfort for a better “Well Rested” buff.'}</p>
        <div className="menu-buttons">
          <button className="btn primary" onClick={() => gameRegistry.current?.sleepAtBed('sleep')}>Sleep until morning</button>
          <button className="btn" onClick={() => gameRegistry.current?.sleepAtBed('home')}>Set home only</button>
        </div>
      </div>
    </div>
  );
}

export function LoreDialog() {
  const lore = useGameStore((s) => s.lore);
  const close = () => gameRegistry.current?.closeOverlay();
  if (!lore) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="panel lore-panel">
        <button className="close-x" onClick={close} aria-label="Close">✕</button>
        <div className="lore-glyphs">ᚹ ᛁ ᛚ ᛞ</div>
        <h2 className="panel-title">{lore.title}</h2>
        <p className="lore-text">“{lore.text}”</p>
        <p className="muted">A fragment of the Wayfarers’ journal ({lore.index + 1} of 10). Added to your Discovery Journal.</p>
        <button className="btn primary" onClick={close} autoFocus>Continue</button>
      </div>
    </div>
  );
}
