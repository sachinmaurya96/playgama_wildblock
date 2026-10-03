import { useEffect, useMemo, useRef, useState } from 'react';
import { BUILD_CATALOG, BUILD_CATEGORIES, catalogItem, catalogSearchText, matchesTheme, THEMES, variantOf, type BuildCatalogItem } from '../../data/buildCatalog';
import { catalogIcon } from '../../game/build/BuildIcons';
import { Game } from '../../game/Game';
import { deleteBlueprint } from '../../persistence/SaveManager';
import type { BlueprintRecord } from '../../persistence/types';
import { useBuildStore, type CatalogView } from '../../stores/buildStore';

/**
 * Build Catalog (B): categories on the left, items in the centre, preview &
 * options on the right, search on top, recent & favourites along the bottom.
 * Everything is unlimited in Build Home.
 */
export function BuildCatalog() {
  const view = useBuildStore((s) => s.view);
  const query = useBuildStore((s) => s.query);
  const favorites = useBuildStore((s) => s.favorites);
  const recent = useBuildStore((s) => s.recent);
  const theme = useBuildStore((s) => s.theme);
  const selectedItem = useBuildStore((s) => s.selectedItem);
  const variantByItem = useBuildStore((s) => s.variantByItem);
  const blueprints = useBuildStore((s) => s.blueprints);
  useBuildStore((s) => s.iconsVersion);
  const set = useBuildStore((s) => s.set);
  const [focus, setFocus] = useState<string | null>(selectedItem);
  const [focusBp, setFocusBp] = useState<BlueprintRecord | null>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    search.current?.focus();
  }, []);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list: BuildCatalogItem[];
    if (q) {
      const words = q.split(/\s+/);
      list = BUILD_CATALOG.filter((i) => {
        const t = catalogSearchText(i);
        return words.every((w) => t.includes(w));
      });
    } else if (view === 'All') list = BUILD_CATALOG;
    else if (view === 'Favorites') list = favorites.map((id) => catalogItem(id)).filter((x): x is BuildCatalogItem => !!x);
    else if (view === 'Recent') list = recent.map((id) => catalogItem(id)).filter((x): x is BuildCatalogItem => !!x);
    else if (view === 'Suggested') list = theme ? BUILD_CATALOG.filter((i) => i.placementType !== 'tool' && matchesTheme(i, theme)) : [];
    else list = BUILD_CATALOG.filter((i) => i.category === view);
    return list;
  }, [query, view, favorites, recent, theme]);

  const groups = useMemo(() => {
    const m = new Map<string, BuildCatalogItem[]>();
    const byCat = view === 'All' || view === 'Suggested' || !!query.trim();
    for (const i of items) {
      const k = byCat ? i.category : view === 'Favorites' || view === 'Recent' ? '' : i.sub;
      const arr = m.get(k) ?? [];
      arr.push(i);
      m.set(k, arr);
    }
    return [...m.entries()];
  }, [items, view, query]);

  const focused = focus ? catalogItem(focus) : undefined;
  const close = () => Game.current?.build?.closeCatalog();
  const choose = (id: string, variant?: string) => {
    Game.current?.build?.chooseItem(id, variant);
    close();
  };
  const setView = (v: CatalogView) => {
    set({ view: v, query: '' });
    setFocusBp(null);
  };

  return (
    <div className="modal-backdrop catalog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="panel catalog" role="dialog" aria-label="Build Catalog">
        <div className="cat-top">
          <h2 className="panel-title">🏗️ Build Catalog</h2>
          <input
            ref={search}
            className="search cat-search"
            placeholder="Search by name, room or material… (e.g. oak, sofa, kitchen)"
            value={query}
            onChange={(e) => set({ query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                if (query) set({ query: '' });
                else close();
                e.stopPropagation();
              }
              if (e.key === 'Enter' && items[0]) choose(items[0].id);
            }}
          />
          <select className="cat-theme" value={theme ?? ''} onChange={(e) => set({ theme: e.target.value || null, view: e.target.value ? 'Suggested' : view })} title="Style palette: suggests matching materials and furniture">
            <option value="">🎨 Any style</option>
            {THEMES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button className="close-x" onClick={close} aria-label="Close catalog">✕</button>
        </div>
        <div className="cat-body">
          <nav className="cat-cats scroll">
            {(['All', 'Favorites', 'Recent'] as const).map((v) => (
              <button key={v} className={`cat-cat ${view === v && !query ? 'active' : ''}`} onClick={() => setView(v)}>
                <span>{v === 'All' ? '📚' : v === 'Favorites' ? '⭐' : '🕘'}</span>{v}
              </button>
            ))}
            {theme && (
              <button className={`cat-cat ${view === 'Suggested' && !query ? 'active' : ''}`} onClick={() => setView('Suggested')}>
                <span>🎨</span>{THEMES.find((t) => t.id === theme)?.name}
              </button>
            )}
            <hr />
            {BUILD_CATEGORIES.map((c) => (
              <button key={c.id} className={`cat-cat ${view === c.id && !query ? 'active' : ''}`} onClick={() => setView(c.id)}>
                <span>{c.icon}</span>{c.id}
              </button>
            ))}
          </nav>
          <div className="cat-items scroll">
            {groups.length === 0 && (
              <p className="muted cat-empty">
                {view === 'Favorites' && !query ? 'No favourites yet — select an item and press ☆ to pin it here.' : view === 'Recent' && !query ? 'Nothing used yet.' : view === 'Suggested' && !theme ? 'Choose a style palette above to see suggestions.' : 'Nothing matches that search.'}
              </p>
            )}
            {groups.map(([g, list]) => (
              <section key={g || 'items'}>
                {g && <h4 className="cat-sub">{g}</h4>}
                <div className="cat-grid">
                  {list.map((i) => (
                    <ItemTile key={i.id} item={i} active={focus === i.id} fav={favorites.includes(i.id)} variant={variantByItem[i.id]} onClick={() => { if (focus === i.id) choose(i.id, variantByItem[i.id]); else { setFocus(i.id); setFocusBp(null); } }} onDouble={() => choose(i.id, variantByItem[i.id])} />
                  ))}
                </div>
              </section>
            ))}
            {view === 'Presets' && !query && (
              <section>
                <h4 className="cat-sub">My Blueprints</h4>
                {blueprints.length === 0 && <p className="muted small-note">Use the Copy tool to select part of a build, then “Save as blueprint” to reuse it in any project.</p>}
                <div className="cat-grid">
                  {blueprints.map((b) => (
                    <button key={b.id} className={`cat-tile ${focusBp?.id === b.id ? 'active' : ''}`} onClick={() => { if (focusBp?.id === b.id) { Game.current?.build?.placeBlueprint(b); close(); } else { setFocusBp(b); setFocus(null); } }} onDoubleClick={() => { Game.current?.build?.placeBlueprint(b); close(); }}>
                      <span className="cat-emoji">📐</span>
                      <span className="cat-name">{b.name}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
          <aside className={`cat-preview ${focused || focusBp ? 'has-focus' : ''}`}>
            {(focused || focusBp) && <button className="close-x small cat-sheet-close" onClick={() => { setFocus(null); setFocusBp(null); }} aria-label="Close details">✕</button>}
            {focusBp ? (
              <BlueprintPreview bp={focusBp} onPlace={() => { Game.current?.build?.placeBlueprint(focusBp); close(); }} onDelete={async () => {
                await deleteBlueprint(focusBp.id);
                set({ blueprints: blueprints.filter((b) => b.id !== focusBp.id) });
                setFocusBp(null);
              }} />
            ) : focused ? (
              <ItemPreview item={focused} variant={variantByItem[focused.id]} fav={favorites.includes(focused.id)} onChoose={choose} />
            ) : (
              <div className="cat-hint muted">
                <p><b>Select an item</b> to see its colours and materials.</p>
                <p>Tap it again, double-click or press Enter on a search to start placing it.</p>
                <p>Everything is unlimited in Build Home.</p>
              </div>
            )}
          </aside>
        </div>
        <div className="cat-bottom">
          <Strip label="🕘 Recent" ids={recent.slice(0, 12)} onPick={(id) => choose(id)} />
          <Strip label="⭐ Favourites" ids={favorites.slice(0, 12)} onPick={(id) => choose(id)} />
        </div>
      </div>
    </div>
  );
}

export function ItemIcon({ item, size = 48 }: { item: BuildCatalogItem; size?: number }) {
  useBuildStore((s) => s.iconsVersion);
  const url = catalogIcon(item.id);
  if (url) return <img className="cat-icon" src={url} width={size} height={size} alt="" draggable={false} />;
  const v = variantOf(item);
  if (item.icon) return <span className="cat-emoji" style={{ fontSize: size * 0.62 }}>{item.icon}</span>;
  return <span className="cat-swatch-icon" style={{ width: size * 0.7, height: size * 0.7, background: v?.swatch ?? '#ccc' }} />;
}

function ItemTile({ item, active, fav, variant, onClick, onDouble }: { item: BuildCatalogItem; active: boolean; fav: boolean; variant?: string; onClick: () => void; onDouble: () => void }) {
  const v = variantOf(item, variant);
  return (
    <button className={`cat-tile ${active ? 'active' : ''}`} onClick={onClick} onDoubleClick={onDouble} title={item.description ?? item.name}>
      {fav && <span className="cat-fav">★</span>}
      <ItemIcon item={item} />
      <span className="cat-name">{item.name}</span>
      {item.variants.length > 1 && <span className="cat-var" style={{ background: v?.swatch }} title={v?.name} />}
    </button>
  );
}

function ItemPreview({ item, variant, fav, onChoose }: { item: BuildCatalogItem; variant?: string; fav: boolean; onChoose: (id: string, variant?: string) => void }) {
  const st = useBuildStore.getState();
  const v = variantOf(item, variant);
  const kind = item.placementType === 'tool' ? 'Tool' : item.placementType === 'preset' ? 'House template' : item.placementType === 'stamp' ? 'Landscaping' : item.placementType === 'object' ? 'Furniture & fittings' : 'Building block';
  return (
    <div className="cat-detail">
      <div className="cat-big"><ItemIcon item={item} size={112} /></div>
      <h3>{item.name}</h3>
      <p className="muted cat-kind">{item.category} · {item.sub} · {kind}</p>
      {item.description && <p className="cat-desc">{item.description}</p>}
      {item.variants.length > 1 && (
        <>
          <p className="cat-varname"><b>{item.metaKind && item.metaKind !== 'fixed' ? 'Material' : 'Colour'}:</b> {v?.name}</p>
          <div className="swatches scroll">
            {item.variants.map((x) => (
              <button key={x.id} className={`swatch ${x.id === v?.id ? 'active' : ''}`} style={{ background: x.swatch }} title={x.name} aria-label={x.name} onClick={() => useBuildStore.setState((s) => ({ variantByItem: { ...s.variantByItem, [item.id]: x.id } }))} />
            ))}
          </div>
        </>
      )}
      <div className="cat-actions">
        <button className="btn build-home-btn" onClick={() => onChoose(item.id, v?.id)}>
          {item.placementType === 'tool' ? 'Use tool' : item.placementType === 'preset' ? 'Place house' : 'Place'}
        </button>
        <button className={`btn small fav-btn ${fav ? 'on' : ''}`} onClick={() => st.toggleFavorite(item.id)} title="Favourite">{fav ? '★' : '☆'}</button>
      </div>
      <p className="muted small-note">Unlimited · {item.placementType === 'object' ? 'R rotates · Alt for free placement' : item.placementType === 'block' ? 'hold click to keep placing' : item.placementType === 'preset' ? 'R rotates · fully editable afterwards' : 'see hints at the bottom'}</p>
    </div>
  );
}

function BlueprintPreview({ bp, onPlace, onDelete }: { bp: BlueprintRecord; onPlace: () => void; onDelete: () => void }) {
  return (
    <div className="cat-detail">
      <div className="cat-big"><span className="cat-emoji" style={{ fontSize: 64 }}>📐</span></div>
      <h3>{bp.name}</h3>
      <p className="muted">{bp.size.join(' × ')} · {bp.blocks.length} blocks · {bp.objects.length} objects</p>
      <p className="muted">Saved {new Date(bp.createdAt).toLocaleDateString()}</p>
      <div className="cat-actions">
        <button className="btn build-home-btn" onClick={onPlace}>Place blueprint</button>
        <button className="btn small danger" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

function Strip({ label, ids, onPick }: { label: string; ids: string[]; onPick: (id: string) => void }) {
  const list = ids.map((id) => catalogItem(id)).filter((x): x is BuildCatalogItem => !!x);
  return (
    <div className="cat-strip">
      <span className="cat-strip-label">{label}</span>
      {list.length === 0 && <span className="muted small-note">—</span>}
      {list.map((i) => (
        <button key={i.id} className="cat-mini" title={i.name} onClick={() => onPick(i.id)}>
          <ItemIcon item={i} size={30} />
        </button>
      ))}
    </div>
  );
}
