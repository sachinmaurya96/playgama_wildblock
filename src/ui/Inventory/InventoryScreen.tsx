import { useMemo, useState } from 'react';
import type { StationKind } from '../../data/blocks';
import { ARMOR_SETS, itemDef, SET_BONUS_DEFENSE, type EquipSlot } from '../../data/items';
import { RECIPE_CATEGORIES, RECIPES, STATION_NAMES, type Recipe, type RecipeCategory } from '../../data/recipes';
import { HOMESTEAD_LEVELS, SCARF_COLORS } from '../../data/progression';
import { ScarfBonus, useStarlightUnlocked } from '../../platform/ScarfBonus';
import { audio } from '../../game/core/audio';
import { gameRegistry } from '../../game/registry';
import { craftState, maxCraftsFitting, recipeSearchText, type CraftState } from '../../game/systems/CraftingSystem';
import { countItem } from '../../game/systems/InventoryLogic';
import { useGameStore } from '../../stores/gameStore';
import { EQUIP_SLOTS, useInventoryStore } from '../../stores/inventoryStore';
import { usePlayerStore } from '../../stores/playerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { levelForPoints, useWorldStore } from '../../stores/worldStore';
import { ItemIcon, ItemSlot } from '../common/ItemSlot';
import { BackpackGrid } from './InventoryGrid';
import { armorStats } from '../../game/player/Player';

const CAT_ICON: Record<RecipeCategory, string> = { Tools: '🪓', Weapons: '🗡️', Armor: '🛡️', Building: '🧱', Furniture: '🪑', Storage: '📦', Lighting: '🏮', Cooking: '🍲', Farming: '🌱', Utility: '🛠️', Exploration: '🧭' };
const EQUIP_LABEL: Record<EquipSlot, string> = { head: 'Head', body: 'Chest', legs: 'Legs', feet: 'Feet', offhand: 'Shield', pack: 'Pack' };

type InvTab = 'pack' | 'craft' | 'me';

export function InventoryScreen() {
  const station = useGameStore((s) => s.craftingStation);
  const close = () => gameRegistry.current?.closeOverlay();
  // Phones / small landscape screens: one section at a time with big tabs instead of a
  // three-column page where the backpack and crafting end up below the fold.
  const [compact] = useState(() => document.documentElement.classList.contains('touch-ui') && (window.innerHeight < 640 || window.innerWidth < 900));
  const [tab, setTab] = useState<InvTab>(station ? 'craft' : 'pack');
  const touch = document.documentElement.classList.contains('touch-ui');
  const backpack = (
    <div className="inv-center">
      <div className="inv-head">
        <h2 className="panel-title">🎒 Backpack</h2>
        <button className="btn small" onClick={() => { useInventoryStore.getState().sort(); audio.play('click'); }}>Sort</button>
      </div>
      <BackpackGrid />
      <p className="inv-help muted">{touch ? 'Tap to pick up · tap another slot to drop · press & hold to split' : 'Click to pick up · Right-click to split · Shift-click to move · Drag & drop'}</p>
    </div>
  );
  if (compact) {
    return (
      <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
        <div className="panel inventory-panel compact">
          <button className="close-x" onClick={close} aria-label="Close">✕</button>
          <div className="inv-tabs" role="tablist">
            {([['pack', '🎒 Backpack'], ['craft', '🔨 Crafting'], ['me', '🧭 Explorer']] as [InvTab, string][]).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={`inv-tab ${tab === id ? 'active' : ''}`} onClick={() => { setTab(id); audio.play('click'); }}>{label}</button>
            ))}
          </div>
          <div className="inv-tab-body">
            {tab === 'pack' && backpack}
            {tab === 'craft' && <CraftingPanel initialStation={station} />}
            {tab === 'me' && <CharacterCard />}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="panel inventory-panel">
        <button className="close-x" onClick={close} aria-label="Close">✕</button>
        <CharacterCard />
        {backpack}
        <CraftingPanel initialStation={station} />
      </div>
    </div>
  );
}

function CharacterCard() {
  const equipment = useInventoryStore((s) => s.equipment);
  const clickEquip = useInventoryStore((s) => s.clickEquip);
  const v = usePlayerStore((s) => s.vitality);
  const e = usePlayerStore((s) => s.energy);
  const comfort = usePlayerStore((s) => s.comfort);
  const points = useWorldStore((s) => s.homesteadPoints);
  const harmony = useWorldStore((s) => s.harmony);
  const scarf = useSettingsStore((s) => s.gameplay.scarf);
  const level = levelForPoints(points);
  const next = HOMESTEAD_LEVELS[level] ?? null;
  const scarfColor = SCARF_COLORS.find((c) => c.id === scarf)?.color ?? '#d9573f';
  return (
    <div className="character-card">
      <ExplorerPortrait scarf={scarfColor} />
      <div className="equip-grid">
        {EQUIP_SLOTS.map((slot) => (
          <div key={slot} className="equip-cell">
            <ItemSlot stack={equipment[slot]} onClick={() => { clickEquip(slot); audio.play('click'); }} label={EQUIP_LABEL[slot]} />
          </div>
        ))}
      </div>
      <ArmorSummary />
      <div className="char-stats">
        <div><span>❤️ Vitality</span><b>{Math.round(v)}</b></div>
        <div><span>🌰 Energy</span><b>{Math.round(e)}</b></div>
        <div title="Furniture near your bed adds comfort for a better morning buff"><span>🛋️ Comfort</span><b>{comfort}</b></div>
        <div title="Planting, feeding animals and discovering raise harmony; over-harvesting lowers it"><span>🍃 Harmony</span><b>{harmonyLabel(harmony)}</b></div>
      </div>
      <div className="homestead">
        <div className="hs-title">🏡 Homestead Lv {level}</div>
        <div className="hs-bar"><span style={{ width: `${next ? Math.min(100, ((points - HOMESTEAD_LEVELS[level - 1]) / (next - HOMESTEAD_LEVELS[level - 1])) * 100) : 100}%` }} /></div>
        <small className="muted">{next ? `${points} / ${next} points` : `${points} points — max level!`}</small>
      </div>
      <ScarfPicker level={level} />
    </div>
  );
}

/** Armory summary: total protection, shield block chance and the full-set bonus. */
function ArmorSummary() {
  const equipment = useInventoryStore((s) => s.equipment);
  const st = armorStats(equipment);
  const set = st.fullSet ? ARMOR_SETS.find((x) => x.key === st.fullSet) : null;
  return (
    <div className="armor-summary" title="Armor reduces all damage from creatures and other players (max 75%). A shield can block hits from the front.">
      <span>🛡️ Armor <b>{Math.round(st.defense * 100)}%</b></span>
      {st.block > 0 && <span>✋ Block <b>{Math.round(st.block * 100)}%</b></span>}
      {set ? <span className="set-bonus">✨ {set.name} set +{Math.round(SET_BONUS_DEFENSE * 100)}%</span> : <span className="muted">Craft armor in the 🛡️ Armor tab</span>}
    </div>
  );
}

function harmonyLabel(h: number): string {
  if (h > 60) return 'Blooming';
  if (h > 25) return 'Thriving';
  if (h > 0) return 'Balanced';
  if (h > -20) return 'Uneasy';
  return 'Wilting';
}

function ScarfPicker({ level }: { level: number }) {
  const scarf = useSettingsStore((s) => s.gameplay.scarf);
  const starlight = useStarlightUnlocked();
  return (
    <div className="scarf-picker">
      <small className="muted">Scarf</small>
      <div className="swatches">
        {SCARF_COLORS.map((c) => {
          const locked = level < c.level && !(c.id === 'starlight' && starlight);
          return (
            <button
              key={c.id}
              className={`swatch ${scarf === c.id ? 'active' : ''}`}
              style={{ background: c.color, opacity: locked ? 0.3 : 1 }}
              title={locked ? `${c.name} — unlocks at Homestead level ${c.level}` : c.name}
              disabled={locked}
              onClick={() => useSettingsStore.getState().update('gameplay', { scarf: c.id })}
            />
          );
        })}
      </div>
      <ScarfBonus />
    </div>
  );
}

export function ExplorerPortrait({ scarf }: { scarf: string }) {
  return (
    <svg className="portrait" viewBox="0 0 120 150" aria-label="Your explorer">
      <defs>
        <radialGradient id="pbg" cx="50%" cy="40%" r="70%">
          <stop offset="0%" stopColor="#fdf6e3" />
          <stop offset="100%" stopColor="#d9e8c4" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="116" height="146" rx="16" fill="url(#pbg)" stroke="#b0804a" strokeWidth="3" />
      <ellipse cx="60" cy="140" rx="34" ry="5" fill="rgba(60,40,20,0.2)" />
      {/* backpack */}
      <rect x="30" y="62" width="60" height="58" rx="10" fill="#b0703c" stroke="#553820" strokeWidth="2.5" />
      <rect x="26" y="56" width="68" height="14" rx="7" fill="#6f8a3a" stroke="#3f5222" strokeWidth="2.5" />
      {/* body */}
      <rect x="40" y="72" width="40" height="44" rx="9" fill="#4f7a4a" stroke="#2d4f2a" strokeWidth="2.5" />
      <rect x="40" y="104" width="40" height="6" fill="#6b4424" />
      <rect x="44" y="116" width="13" height="18" rx="3" fill="#6b5a44" stroke="#3a2c1e" strokeWidth="2" />
      <rect x="63" y="116" width="13" height="18" rx="3" fill="#6b5a44" stroke="#3a2c1e" strokeWidth="2" />
      <rect x="42" y="130" width="17" height="9" rx="3" fill="#5a3a24" />
      <rect x="61" y="130" width="17" height="9" rx="3" fill="#5a3a24" />
      {/* arms + gloves */}
      <rect x="28" y="76" width="12" height="30" rx="5" fill="#4f7a4a" stroke="#2d4f2a" strokeWidth="2" />
      <rect x="80" y="76" width="12" height="30" rx="5" fill="#4f7a4a" stroke="#2d4f2a" strokeWidth="2" />
      <circle cx="34" cy="108" r="6.5" fill="#8a5a32" stroke="#4a2e18" strokeWidth="2" />
      <circle cx="86" cy="108" r="6.5" fill="#8a5a32" stroke="#4a2e18" strokeWidth="2" />
      {/* scarf */}
      <rect x="37" y="66" width="46" height="11" rx="5" fill={scarf} stroke="#3a2c1e" strokeWidth="2" />
      <path d="M74 74 L 84 96 L 76 98 L 68 76 Z" fill={scarf} stroke="#3a2c1e" strokeWidth="2" />
      {/* head */}
      <rect x="35" y="24" width="50" height="44" rx="14" fill="#e8b88f" stroke="#7a4a2a" strokeWidth="2.5" />
      <path d="M35 40 C 36 26, 48 22, 60 22 C 74 22, 85 28, 85 40 L 85 34 L 35 34 Z" fill="#7a4a2a" />
      <ellipse cx="60" cy="24" rx="34" ry="6" fill="#8a6a3a" stroke="#553820" strokeWidth="2" />
      <path d="M44 22 C 46 8, 74 8, 76 22 Z" fill="#a8844a" stroke="#553820" strokeWidth="2" />
      <rect x="44" y="17" width="32" height="4" fill="#c0563f" />
      {/* face */}
      <ellipse cx="50" cy="47" rx="5" ry="6" fill="#fbf7ee" />
      <ellipse cx="70" cy="47" rx="5" ry="6" fill="#fbf7ee" />
      <circle cx="51" cy="48" r="3.2" fill="#2a1e18" />
      <circle cx="71" cy="48" r="3.2" fill="#2a1e18" />
      <circle cx="50" cy="46" r="1.2" fill="#fff" />
      <circle cx="70" cy="46" r="1.2" fill="#fff" />
      <ellipse cx="43" cy="56" rx="4" ry="2.4" fill="#e89a7a" opacity="0.7" />
      <ellipse cx="77" cy="56" rx="4" ry="2.4" fill="#e89a7a" opacity="0.7" />
      <path d="M54 57 Q 60 62, 66 57" stroke="#8a4a3a" strokeWidth="2.2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

const STATE_LABEL: Record<CraftState, string> = {
  ok: '',
  ingredients: 'Missing ingredients',
  station: 'Needs station',
  locked: 'Locked',
  full: 'Inventory full',
};

function CraftingPanel({ initialStation }: { initialStation: StationKind | null }) {
  const slots = useInventoryStore((s) => s.slots);
  const points = useWorldStore((s) => s.homesteadPoints);
  const level = levelForPoints(points);
  const stations = useMemo(() => gameRegistry.current?.nearbyStations() ?? new Set<StationKind>(), []);
  const [tab, setTab] = useState<StationKind | 'pack' | 'all'>(initialStation ?? 'pack');
  const [cat, setCat] = useState<RecipeCategory | 'All'>('All');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Recipe | null>(null);

  // Every station is always browsable: nearby ones are marked, far ones show what they unlock.
  const allStations = Object.keys(STATION_NAMES) as StationKind[];
  const tabs: (StationKind | 'pack' | 'all')[] = ['pack', ...allStations, 'all'];
  const q = query.trim().toLowerCase();
  const list = useMemo(() => RECIPES.filter((r) => (tab === 'all' ? true : tab === 'pack' ? r.station === null : r.station === tab))
    .filter((r) => cat === 'All' || r.category === cat)
    .filter((r) => !q || recipeSearchText(r).includes(q)), [tab, cat, q]);
  const rank: Record<CraftState, number> = { ok: 0, full: 1, ingredients: 2, station: 3, locked: 4 };
  // outputFits simulates inventory changes. Evaluate each recipe once instead
  // of repeating that work in every sorting comparison and rendered row.
  const states = useMemo(() => new Map(list.map((r) => [r, craftState(r, slots, stations, level)])), [list, slots, stations, level]);
  const stateOf = (r: Recipe) => states.get(r)!;
  const sorted = [...list].sort((a, b) => rank[stateOf(a)] - rank[stateOf(b)]);
  const sel = selected && list.includes(selected) ? selected : sorted[0] ?? null;
  const selState = sel ? stateOf(sel) : 'locked';
  const fitting = sel ? maxCraftsFitting(sel, slots) : 0;

  const craft = (times: number) => {
    if (!sel) return;
    gameRegistry.current?.craft(sel, times);
  };

  const tabLabel = (t: StationKind | 'pack' | 'all') =>
    t === 'pack' ? '🎒 Anywhere' : t === 'all' ? '📚 All' : `${stations.has(t) ? '🛠️' : '·'} ${STATION_NAMES[t]}`;

  return (
    <div className="crafting">
      <h2 className="panel-title">🔨 Recipe Book</h2>
      <div className="tabs station-tabs">
        {tabs.map((t) => (
          <button
            key={t}
            className={`tab ${tab === t ? 'active' : ''} ${t !== 'pack' && t !== 'all' && !stations.has(t) ? 'far' : ''}`}
            title={t !== 'pack' && t !== 'all' ? (stations.has(t) ? `${STATION_NAMES[t]} is nearby` : `Stand near a ${STATION_NAMES[t]} to craft these`) : undefined}
            onClick={() => { setTab(t); setSelected(null); audio.play('click'); }}
          >
            {tabLabel(t)}
          </button>
        ))}
      </div>
      <div className="craft-filters">
        <div className="tabs cat-tabs">
          <button className={`tab ${cat === 'All' ? 'active' : ''}`} onClick={() => setCat('All')}>All</button>
          {RECIPE_CATEGORIES.map((c) => (
            <button key={c} className={`tab ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)} title={c} aria-label={c}>
              {CAT_ICON[c]}
            </button>
          ))}
        </div>
        <input className="search" placeholder="Search recipes, ingredients…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </div>
      <div className="craft-body">
        <div className="recipe-list scroll">
          {sorted.length === 0 && <p className="muted">No recipes match.</p>}
          {sorted.map((r) => {
            const st = stateOf(r);
            return (
              <button key={r.id} className={`recipe ${st === 'ok' ? 'ok' : ''} ${sel === r ? 'sel' : ''} ${st === 'locked' ? 'locked' : ''} ${st === 'station' ? 'far' : ''}`} onClick={() => { setSelected(r); audio.play('click'); }}>
                <ItemIcon item={r.output.item} size={32} />
                <span className="recipe-name">{itemDef(r.output.item).name}{r.output.count > 1 ? ` ×${r.output.count}` : ''}</span>
                {st === 'locked' && <span className="lock-small">Lv{r.homestead}</span>}
                {st === 'station' && tab === 'all' && r.station && <span className="lock-small">{STATION_NAMES[r.station]}</span>}
              </button>
            );
          })}
        </div>
        {sel && (
          <div className="recipe-detail">
            <div className="recipe-detail-content">
              <div className="rd-head">
                <ItemIcon item={sel.output.item} size={56} />
                <div>
                  <div className="rd-name">{itemDef(sel.output.item).name}{sel.output.count > 1 ? ` ×${sel.output.count}` : ''}</div>
                  <div className="muted rd-desc">{itemDef(sel.output.item).description}</div>
                  <div className="rd-where muted">{sel.category} · {sel.station ? STATION_NAMES[sel.station] : 'Craft anywhere'}</div>
                </div>
              </div>
              <div className="ingredients">
                {sel.inputs.map((ing) => {
                  const have = countItem(slots, ing.item);
                  return (
                    <div key={ing.item} className={`ing ${have >= ing.count ? 'have' : 'need'}`}>
                      <ItemIcon item={ing.item} size={28} />
                      <span>{itemDef(ing.item).name}</span>
                      <b>{have}/{ing.count}</b>
                    </div>
                  );
                })}
              </div>
              {selState === 'locked' && <p className="warn-text">Unlocks at Homestead level {sel.homestead}. Build, farm and befriend creatures to level up.</p>}
              {selState === 'station' && sel.station && <p className="warn-text">Needs a {STATION_NAMES[sel.station]} nearby. Build one and stand next to it.</p>}
              {selState === 'full' && <p className="warn-text">Inventory Full — free a slot to craft this.</p>}
            </div>
            <div className="craft-buttons">
              <button className="btn primary" disabled={selState !== 'ok'} onClick={() => craft(1)}>{selState === 'full' ? 'Inventory Full' : 'Craft'}</button>
              <button className="btn" disabled={selState !== 'ok' || fitting < 2} onClick={() => craft(Math.min(5, fitting))}>×{Math.max(2, Math.min(5, fitting))}</button>
              <button className="btn ghost small" disabled={selState !== 'ok'} onClick={() => craft(fitting)}>All ({fitting})</button>
            </div>
            {selState !== 'ok' && STATE_LABEL[selState] && <span className="sr-only">{STATE_LABEL[selState]}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
