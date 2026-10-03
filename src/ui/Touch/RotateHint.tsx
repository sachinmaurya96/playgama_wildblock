import { useEffect, useState } from 'react';
import { isPortrait, isTouchDevice, requestLandscape } from '../../app/mobile';
import { gameRegistry } from '../../game/registry';
import { useGameStore } from '../../stores/gameStore';

/**
 * WildBlocks is played in landscape on phones and tablets. Where the browser
 * allows it (Android) the orientation is locked automatically on the first
 * tap; elsewhere (iOS) this card asks the player to turn the device and the
 * game pauses until they do.
 */
export function RotateHint() {
  const [touch] = useState(isTouchDevice);
  const [portrait, setPortrait] = useState(() => touch && isPortrait());

  useEffect(() => {
    if (!touch) return;
    const on = () => setPortrait(isPortrait());
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    screen.orientation?.addEventListener?.('change', on);
    // lock to landscape on the first taps (needs a user gesture)
    const tap = () => void requestLandscape().then(on);
    window.addEventListener('pointerup', tap);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
      screen.orientation?.removeEventListener?.('change', on);
      window.removeEventListener('pointerup', tap);
    };
  }, [touch]);

  // pause the world while the device is upright
  useEffect(() => {
    if (!portrait) return;
    const gs = useGameStore.getState();
    const g = gameRegistry.current;
    if (g && gs.screen === 'playing' && gs.overlay === null) g.openOverlay('pause');
  }, [portrait]);

  if (!touch || !portrait) return null;
  return (
    <div className="rotate-hint" role="dialog" aria-label="Rotate your device">
      <div className="rotate-card">
        <div className="rotate-phone" aria-hidden>
          <span />
        </div>
        <b>Turn your device sideways</b>
        <small>WildBlocks plays in landscape for big, comfy controls.</small>
        <button className="btn primary" onClick={() => void requestLandscape().then(() => setPortrait(isPortrait()))}>
          ⛶ Play fullscreen
        </button>
      </div>
    </div>
  );
}
