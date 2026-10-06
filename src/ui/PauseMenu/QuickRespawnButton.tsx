import { useState } from 'react';
import { gameRegistry } from '../../game/registry';

/** Shared Pause action: rescue while alive, without consuming or dropping equipment. */
export function QuickRespawnButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const rescue = async () => {
    const game = gameRegistry.current;
    if (!game || busy) return;
    setBusy(true); setMessage(null);
    try {
      setMessage(await game.quickRespawn());
    } catch {
      setMessage('Could not reach a safe spot. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pause-rescue">
      <button className="btn" disabled={busy} onClick={() => void rescue()}>
        {busy ? 'Finding a safe spot…' : '🆘 Quick Respawn'}
      </button>
      <small className="muted">Stuck? Return to safety. Keeps your health and items.</small>
      {message && <small role="status">{message}</small>}
    </div>
  );
}
