import { useRef } from 'react';
import { audio } from '../../game/core/audio';
import { BASE_PACK, HOTBAR_SIZE, MAX_PACK, useInventoryStore, type SlotArea } from '../../stores/inventoryStore';
import { ItemSlot } from '../common/ItemSlot';

/** Shared drag-source tracking for HTML5 drag & drop between grids. */
export const dragState: { area: SlotArea | null; index: number } = { area: null, index: -1 };

export function useSlotHandlers(area: SlotArea) {
  const click = useInventoryStore((s) => s.click);
  const quick = useInventoryStore((s) => s.quickTransfer);
  return (index: number) => ({
    onClick: (e: React.MouseEvent) => {
      if (e.shiftKey) quick(area, index);
      else click(area, index, false);
      audio.play('click');
    },
    onContextMenu: () => {
      click(area, index, true);
      audio.play('click');
    },
    onDragStart: () => {
      dragState.area = area;
      dragState.index = index;
    },
    onDrop: () => {
      if (dragState.area === null) return;
      const st = useInventoryStore.getState();
      if (st.cursor) return;
      // pick up from source, drop onto target
      st.click(dragState.area, dragState.index, false);
      useInventoryStore.getState().click(area, index, false);
      if (useInventoryStore.getState().cursor) useInventoryStore.getState().click(dragState.area, dragState.index, false);
      dragState.area = null;
      audio.play('click');
    },
  });
}

export function BackpackGrid({ showHotbar = true }: { showHotbar?: boolean }) {
  const slots = useInventoryStore((s) => s.slots);
  const selected = useInventoryStore((s) => s.selected);
  const pack = useInventoryStore((s) => s.equipment.pack);
  const handlers = useSlotHandlers('inv');
  const cap = BASE_PACK + (pack ? MAX_PACK - BASE_PACK : 0);
  const gridRef = useRef<HTMLDivElement>(null);
  return (
    <div className="backpack">
      <div className="grid backpack-grid" ref={gridRef}>
        {Array.from({ length: MAX_PACK }, (_, k) => {
          const i = HOTBAR_SIZE + k;
          const locked = k >= cap;
          return <ItemSlot key={i} stack={slots[i]} locked={locked} {...handlers(i)} />;
        })}
      </div>
      {!pack && <div className="pack-hint muted">Craft an Explorer’s Pack to unlock 8 more pockets.</div>}
      {showHotbar && (
        <>
          <div className="grid-label">Hotbar</div>
          <div className="grid hotbar-grid">
            {slots.slice(0, HOTBAR_SIZE).map((s, i) => (
              <ItemSlot key={i} stack={s} selected={i === selected} {...handlers(i)} hint={<span className="slot-num">{i + 1}</span>} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
