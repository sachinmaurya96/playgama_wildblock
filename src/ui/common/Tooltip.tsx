import { itemDef } from '../../data/items';
import type { ItemStack } from '../../game/systems/InventoryLogic';
import { BUFF_INFO } from '../../stores/playerStore';

const CATEGORY_LABEL: Record<string, string> = {
  block: 'Building block', material: 'Material', tool: 'Tool', weapon: 'Weapon', food: 'Food', seed: 'Seeds', equipment: 'Equipment', misc: 'Item',
};

/** Item tooltip: name, description, type and the stats that matter (not a wall of numbers). */
export function Tooltip({ stack }: { stack: ItemStack }) {
  const d = itemDef(stack.item);
  const lines: string[] = [];
  if (d.tool && d.tool.kind !== 'weapon' && d.category === 'tool' && stack.item !== 'watering_can') lines.push(`Work speed ×${d.tool.speed.toFixed(1)}`);
  if (d.tool && (d.category === 'weapon' || d.tool.damage > 3)) lines.push(`Damage ${d.tool.damage}`);
  if (stack.durability !== undefined && d.tool) lines.push(`Durability ${stack.durability}/${d.tool.durability}`);
  if (d.food) lines.push(`Restores ${d.food.vitality} vitality · ${d.food.energy} energy`);
  if (d.food?.buff) lines.push(`${BUFF_INFO[d.food.buff.id].icon} ${BUFF_INFO[d.food.buff.id].name} for ${Math.round(d.food.buff.seconds / 60)} min`);
  if (d.equip?.defense) lines.push(`Blocks ${Math.round(d.equip.defense * 100)}% damage`);
  if (d.equip?.speed) lines.push(`+${Math.round(d.equip.speed * 100)}% move speed`);
  if (d.equip?.slots) lines.push(`+${d.equip.slots} backpack slots`);
  const use = d.food ? 'Right-click to eat' : d.placeBlock ? 'Right-click to place' : d.plantsCrop ? 'Right-click tilled soil to plant' : d.equip ? 'Shift-click to equip' : null;
  return (
    <div className="tooltip">
      <div className="tt-name">{d.name}</div>
      <div className="tt-type">{CATEGORY_LABEL[d.category]}</div>
      <div className="tt-desc">{d.description}</div>
      {lines.map((l) => (
        <div key={l} className="tt-stat">{l}</div>
      ))}
      {use && <div className="tt-use">{use}</div>}
    </div>
  );
}
