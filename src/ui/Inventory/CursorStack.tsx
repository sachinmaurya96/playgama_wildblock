import { useEffect, useRef } from 'react';
import { useInventoryStore } from '../../stores/inventoryStore';
import { ItemIcon } from '../common/ItemSlot';

/** The stack "held" by the mouse while moving items between slots. */
export function CursorStack() {
  const cursor = useInventoryStore((s) => s.cursor);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (ref.current) ref.current.style.transform = `translate(${e.clientX - 20}px, ${e.clientY - 20}px)`;
    };
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, []);
  return (
    <div className="cursor-stack" ref={ref} style={{ display: cursor ? 'block' : 'none' }}>
      {cursor && (
        <>
          <ItemIcon item={cursor.item} />
          {cursor.count > 1 && <span className="count">{cursor.count}</span>}
        </>
      )}
    </div>
  );
}
