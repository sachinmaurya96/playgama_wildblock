import { gameRegistry } from '../../game/registry';
import { useGameStore } from '../../stores/gameStore';
import { useRestStore } from '../../stores/restStore';
import { useBuildStore } from '../../stores/buildStore';

/** Proximity buttons work with a mouse or touch, without precise crosshair aim. */
export function RestActions() {
  const { bed, chair, seated } = useRestStore();
  const overlay = useGameStore((s) => s.overlay);
  const hidden = useGameStore((s) => s.hudHidden);
  const freeCamera = useBuildStore((s) => s.active && (s.photo || s.camera === 'build'));
  if (overlay !== null || hidden || freeCamera || (!bed && !chair && !seated)) return null;
  return (
    <div className="rest-actions" role="group" aria-label="Nearby furniture">
      {seated ? (
        <button className="btn small" onPointerDown={(e) => e.stopPropagation()} onClick={() => gameRegistry.current?.rest.stand()}>↥ Stand up</button>
      ) : <>
        {bed && <button className="btn small" title={bed} onPointerDown={(e) => e.stopPropagation()} onClick={() => gameRegistry.current?.rest.activate('sleep')}>🛏️ Sleep / Set home</button>}
        {chair && <button className="btn small" title={chair} onPointerDown={(e) => e.stopPropagation()} onClick={() => gameRegistry.current?.rest.activate('sit')}>🪑 Sit</button>}
      </>}
    </div>
  );
}
