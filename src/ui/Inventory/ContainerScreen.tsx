import { gameRegistry } from '../../game/registry';
import { useInventoryStore } from '../../stores/inventoryStore';
import { ItemSlot } from '../common/ItemSlot';
import { BackpackGrid, useSlotHandlers } from './InventoryGrid';

export function ContainerScreen() {
  const container = useInventoryStore((s) => s.container);
  const handlers = useSlotHandlers('container');
  const close = () => gameRegistry.current?.closeOverlay();
  if (!container) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="panel container-panel">
        <button className="close-x" onClick={close} aria-label="Close">✕</button>
        <h2 className="panel-title">📦 {container.title}</h2>
        <div className="grid container-grid">
          {container.slots.map((s, i) => (
            <ItemSlot key={i} stack={s} {...handlers(i)} />
          ))}
        </div>
        <div className="container-actions">
          <button
            className="btn small"
            onClick={() => {
              const st = useInventoryStore.getState();
              st.container?.slots.forEach((s, i) => s && useInventoryStore.getState().quickTransfer('container', i));
            }}
          >
            Take all
          </button>
          <span className="muted">Shift-click to move stacks between chest and backpack</span>
        </div>
        <h3 className="sub-title">Your backpack</h3>
        <BackpackGrid />
      </div>
    </div>
  );
}
