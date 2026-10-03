import { useState } from 'react';
import { BIOMES } from '../../data/biomes';
import { CREATURES, type CreatureKind } from '../../data/creatures';
import { ITEM_DEFS, itemDef } from '../../data/items';
import { ACHIEVEMENTS, LORE } from '../../data/progression';
import { LANDMARK_NAMES, type LandmarkType } from '../../game/world/StructureGenerator';
import { Game } from '../../game/Game';
import { useWorldStore, type JournalSection } from '../../stores/worldStore';
import { ItemIcon } from '../common/ItemSlot';

const SECTIONS: { id: JournalSection | 'achievements'; label: string; icon: string }[] = [
  { id: 'biomes', label: 'Biomes', icon: '🗺️' },
  { id: 'animals', label: 'Creatures', icon: '🐾' },
  { id: 'plants', label: 'Plants', icon: '🌿' },
  { id: 'materials', label: 'Materials', icon: '💎' },
  { id: 'landmarks', label: 'Landmarks', icon: '🗿' },
  { id: 'recipes', label: 'Recipes', icon: '📜' },
  { id: 'lore', label: 'Stories', icon: '📖' },
  { id: 'achievements', label: 'Feats', icon: '🏅' },
];

const PLANT_KEYS = ITEM_DEFS.filter((d) => d.journal === 'plants').map((d) => d.key);
const MATERIAL_KEYS = ITEM_DEFS.filter((d) => d.journal === 'materials').map((d) => d.key);

/** Discovery Journal (J): fills in as you explore — gives exploration its own purpose. */
export function JournalScreen() {
  const [tab, setTab] = useState<(typeof SECTIONS)[number]['id']>('biomes');
  const journal = useWorldStore((s) => s.journal);
  const achievements = useWorldStore((s) => s.achievements);
  const close = () => Game.current?.closeOverlay();
  const total = (id: string) =>
    id === 'biomes' ? BIOMES.length : id === 'animals' ? Object.keys(CREATURES).length : id === 'plants' ? PLANT_KEYS.length : id === 'materials' ? MATERIAL_KEYS.length : id === 'lore' ? LORE.length : id === 'achievements' ? ACHIEVEMENTS.length : null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="panel journal-panel">
        <button className="close-x" onClick={close} aria-label="Close">✕</button>
        <h2 className="panel-title">📔 Discovery Journal</h2>
        <div className="tabs journal-tabs">
          {SECTIONS.map((s) => {
            const n = s.id === 'achievements' ? achievements.length : journal[s.id].length;
            const t = total(s.id);
            return (
              <button key={s.id} className={`tab ${tab === s.id ? 'active' : ''}`} onClick={() => setTab(s.id)}>
                {s.icon} {s.label} <span className="badge">{n}{t ? `/${t}` : ''}</span>
              </button>
            );
          })}
        </div>
        <div className="journal-page scroll">
          {tab === 'biomes' &&
            BIOMES.map((b) => {
              const found = journal.biomes.includes(b.id);
              return (
                <Entry key={b.id} found={found} title={b.name} swatch={`rgb(${b.mapColor.map((c) => Math.round(c * 255)).join(',')})`}>
                  {b.description}
                </Entry>
              );
            })}
          {tab === 'animals' &&
            (Object.keys(CREATURES) as CreatureKind[]).map((k) => {
              const c = CREATURES[k];
              const found = journal.animals.includes(k);
              return (
                <Entry key={k} found={found} title={c.name} tag={c.hostile ? 'Wild & grumpy' : 'Friendly'}>
                  {c.description}
                  {found && c.favoriteFood && <div className="entry-extra">Favourite food: {c.favoriteFood.map((f) => itemDef(f).name).join(', ')}</div>}
                </Entry>
              );
            })}
          {(tab === 'plants' || tab === 'materials') && (
            <div className="entry-grid">
              {(tab === 'plants' ? PLANT_KEYS : MATERIAL_KEYS).map((k) => {
                const found = journal[tab].includes(k);
                const d = itemDef(k);
                return (
                  <div key={k} className={`mini-entry ${found ? '' : 'unknown'}`} title={found ? d.description : 'Not yet found'}>
                    {found ? <ItemIcon item={k} size={36} /> : <span className="q">?</span>}
                    <span>{found ? d.name : '???'}</span>
                  </div>
                );
              })}
            </div>
          )}
          {tab === 'landmarks' && (
            <>
              {journal.landmarks.length === 0 && <p className="muted">No landmarks yet. Look for stone circles, hollow trees, sky pillars and waterfalls on your travels.</p>}
              {journal.landmarks.map((l) => {
                const [type, pos] = l.split('@');
                const name = type === 'waterfall' ? 'Tumbling Waterfall' : LANDMARK_NAMES[type as LandmarkType] ?? type;
                const [x, z] = pos.split(',').map(Number);
                return (
                  <Entry key={l} found title={name} tag={`at ${x}, ${z}`}>
                    <button className="btn small" onClick={() => { useWorldStore.getState().setWaypoint({ x, z, label: name }); }}>Mark on compass</button>
                  </Entry>
                );
              })}
            </>
          )}
          {tab === 'recipes' && (
            <div className="entry-grid">
              {journal.recipes.length === 0 && <p className="muted">Craft things to fill this page.</p>}
              {journal.recipes.map((k) => (
                <div key={k} className="mini-entry">
                  <ItemIcon item={k} size={36} />
                  <span>{itemDef(k).name}</span>
                </div>
              ))}
            </div>
          )}
          {tab === 'lore' &&
            LORE.map((l, i) => {
              const found = journal.lore.includes(String(i));
              return (
                <Entry key={i} found={found} title={found ? l.title : 'Unread stele'}>
                  {found ? <em>“{l.text}”</em> : 'Find a Whisper Stele to read this fragment.'}
                </Entry>
              );
            })}
          {tab === 'achievements' &&
            ACHIEVEMENTS.map((a) => (
              <Entry key={a.id} found={achievements.includes(a.id)} title={a.title} tag={achievements.includes(a.id) ? 'Earned' : undefined}>
                {a.description}
              </Entry>
            ))}
        </div>
      </div>
    </div>
  );
}

function Entry({ found, title, tag, swatch, children }: { found: boolean; title: string; tag?: string; swatch?: string; children: React.ReactNode }) {
  return (
    <div className={`entry ${found ? '' : 'unknown'}`}>
      {swatch && <span className="swatch-dot" style={{ background: found ? swatch : '#bbb' }} />}
      <div>
        <div className="entry-title">
          {found ? title : '??? — undiscovered'} {tag && found && <span className="entry-tag">{tag}</span>}
        </div>
        <div className="entry-text">{found ? children : <span className="muted">Keep exploring…</span>}</div>
      </div>
    </div>
  );
}
