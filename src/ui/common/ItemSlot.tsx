import { memo, useState, type MouseEvent, type ReactNode } from 'react';
import { itemDef } from '../../data/items';
import { getIcon } from '../../game/core/AssetManager';
import type { ItemStack } from '../../game/systems/InventoryLogic';
import { Tooltip } from './Tooltip';

export function ItemIcon({ item, size = 40 }: { item: string; size?: number }) {
  const src = getIcon(item);
  if (!src) return <span className="item-fallback" style={{ width: size, height: size }}>{itemDef(item).name[0]}</span>;
  return <img className="item-icon" src={src} width={size} height={size} alt={itemDef(item).name} draggable={false} />;
}

export function Durability({ stack }: { stack: ItemStack }) {
  const max = itemDef(stack.item).tool?.durability;
  if (stack.durability === undefined || !max || !Number.isFinite(max)) return null;
  const f = Math.max(0, stack.durability / max);
  if (f >= 0.999) return null;
  const col = f > 0.5 ? '#6fbf4a' : f > 0.2 ? '#e0b23d' : '#e0553a';
  return (
    <span className={`durability ${f < 0.15 ? 'warn' : ''}`}>
      <span style={{ width: `${f * 100}%`, background: col }} />
    </span>
  );
}

interface SlotProps {
  stack: ItemStack | null;
  selected?: boolean;
  locked?: boolean;
  onClick?: (e: MouseEvent) => void;
  onContextMenu?: (e: MouseEvent) => void;
  onDragStart?: () => void;
  onDrop?: () => void;
  hint?: ReactNode;
  small?: boolean;
  label?: string;
  /** Show the hover tooltip (off for the in-game hotbar). */
  tooltip?: boolean;
}

/** A single inventory slot: icon, count, durability, tooltip; supports click, right-click split and drag & drop. */
export const ItemSlot = memo(function ItemSlot({ stack, selected, locked, onClick, onContextMenu, onDragStart, onDrop, hint, small, label, tooltip = true }: SlotProps) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className={`slot ${selected ? 'selected' : ''} ${locked ? 'locked' : ''} ${small ? 'small' : ''}`}
      onMouseDown={(e) => {
        if (locked) return;
        if (e.button === 0) onClick?.(e);
        else if (e.button === 2) onContextMenu?.(e);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        // phones & tablets: press-and-hold a slot = split the stack (like right-click)
        if (!locked && document.documentElement.classList.contains('touch-ui')) onContextMenu?.(e);
      }}
      onMouseEnter={() => !document.documentElement.classList.contains('touch-ui') && setHover(true)}
      onMouseLeave={() => setHover(false)}
      draggable={!!stack && !locked}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'slot');
        onDragStart?.();
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDrop?.();
      }}
    >
      {label && !stack && <span className="slot-label">{label}</span>}
      {hint && !stack && <span className="slot-hint">{hint}</span>}
      {stack && (
        <>
          <ItemIcon item={stack.item} size={small ? 32 : 40} />
          {stack.count > 1 && <span className="count">{stack.count}</span>}
          <Durability stack={stack} />
        </>
      )}
      {locked && <span className="lock">🔒</span>}
      {hover && tooltip && stack && <Tooltip stack={stack} />}
    </div>
  );
});
