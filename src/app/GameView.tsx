import { GameCanvas } from '../game/GameCanvas';
import { HUD } from '../ui/HUD/HUD';
import { Overlays } from '../ui/Overlays';
import { TouchControls } from '../ui/Touch/TouchControls';
import { useGameStore } from '../stores/gameStore';
import { launchKey, takePendingLaunch } from './launch';

/** In-world view: the 3D canvas plus all React overlays (HUD, menus, inventory...). */
export default function GameView() {
  const launch = takePendingLaunch();
  const screen = useGameStore((s) => s.screen);
  if (!launch) return null;
  return (
    <>
      <div className="canvas-wrap">
        <GameCanvas key={launchKey(launch)} launch={launch} />
      </div>
      {screen === 'playing' && (
        <div className="ui-root">
          <HUD />
          <TouchControls />
          <Overlays />
        </div>
      )}
    </>
  );
}
