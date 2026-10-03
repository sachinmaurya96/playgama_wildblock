import { Game } from '../../game/Game';
import { useGameStore } from '../../stores/gameStore';
import { useWorldStore } from '../../stores/worldStore';

export function DeathScreen() {
  const death = useGameStore((s) => s.death);
  const home = useWorldStore((s) => s.home);
  return (
    <div className="modal-backdrop death-backdrop">
      <div className="panel death-panel">
        <h2 className="panel-title">🍂 You were overcome by the wilds.</h2>
        <p>{death?.cause ? `Cause: ${death.cause}.` : ''} {death && death.lost > 0 ? `You dropped ${death.lost} gathered items — your satchel is marked 🍂 on the map and compass.` : 'Nothing was lost.'}</p>
        <div className="menu-buttons">
          {home && <button className="btn primary" onClick={() => Game.current?.respawn('home')}>Respawn at home</button>}
          <button className={`btn ${home ? '' : 'primary'}`} onClick={() => Game.current?.respawn('camp')}>Respawn at starting camp</button>
        </div>
      </div>
    </div>
  );
}

export function SleepDialog() {
  const close = () => Game.current?.closeOverlay();
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="panel sleep-panel">
        <button className="close-x" onClick={close} aria-label="Close">✕</button>
        <h2 className="panel-title">🛏️ Cozy Cot</h2>
        <p>Rest here to set your home, or sleep until morning. Furniture near the bed adds comfort for a better “Well Rested” buff.</p>
        <div className="menu-buttons">
          <button className="btn primary" onClick={() => Game.current?.sleepAtBed('sleep')}>Sleep until morning</button>
          <button className="btn" onClick={() => Game.current?.sleepAtBed('home')}>Set home only</button>
        </div>
      </div>
    </div>
  );
}

export function LoreDialog() {
  const lore = useGameStore((s) => s.lore);
  const close = () => Game.current?.closeOverlay();
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
