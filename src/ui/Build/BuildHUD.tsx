import { useEffect, useState, type ReactNode } from 'react';
import { ARCH_MATERIALS, archIndex } from '../../data/architecture';
import { catalogItem, FARM_CROPS, FLOOR_MATERIALS, ROOF_MATERIALS, STRUCT_MATERIALS, WALL_MATERIALS, type BuildCatalogItem, type ToolId } from '../../data/buildCatalog';
import { BUILD_HINTS } from '../../data/buildControls';
import { CHALLENGES, challengeById } from '../../data/buildChallenges';
import { Game } from '../../game/Game';
import { markTutorialSeen, tutorialSeen, useBuildStore, type ToolOptions } from '../../stores/buildStore';
import { useGameStore } from '../../stores/gameStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { touchEnabled } from '../../app/mobile';
import { ItemIcon } from './BuildCatalog';

const build = () => Game.current?.build ?? null;

const TOOLS: { id: ToolId | 'catalog'; icon: string; name: string; key: string }[] = [
  { id: 'catalog', icon: '📚', name: 'Catalog', key: 'B' },
  { id: 'place', icon: '🧱', name: 'Place', key: 'Q' },
  { id: 'select', icon: '👆', name: 'Select & Move', key: 'V' },
  { id: 'remove', icon: '🧹', name: 'Remove', key: 'X' },
  { id: 'paint', icon: '🖌️', name: 'Paint', key: 'T' },
  { id: 'pick', icon: '💉', name: 'Pick Material', key: 'P' },
  { id: 'wall', icon: '🧱', name: 'Wall', key: 'Y' },
  { id: 'room', icon: '🏠', name: 'Room', key: 'U' },
  { id: 'floor', icon: '⬛', name: 'Floor', key: 'I' },
  { id: 'foundation', icon: '🧊', name: 'Foundation', key: '' },
  { id: 'roof', icon: '🔺', name: 'Roof', key: 'O' },
  { id: 'stairs', icon: '🪜', name: 'Stairs', key: 'J' },
  { id: 'pool', icon: '🏊', name: 'Pool', key: 'K' },
  { id: 'raise', icon: '⛰️', name: 'Landscape', key: 'L' },
  { id: 'farm', icon: '🚜', name: 'Farm Plot', key: '' },
  { id: 'measure', icon: '📏', name: 'Measure', key: 'N' },
  { id: 'copy', icon: '📋', name: 'Copy / Blueprint', key: 'Ctrl+C' },
];

const LAND_TOOLS: ToolId[] = ['raise', 'lower', 'flatten', 'paint_ground', 'water'];

const isTouchUi = () => document.documentElement.classList.contains('touch-ui');
/** Reactive: touch controls on (follows Settings → Controls → Touch). */
function useTouch(): boolean {
  return touchEnabled(useSettingsStore((s) => s.controls.touch));
}

/** Build Home in-world HUD (replaces the survival HUD). */
export function BuildHUD() {
  const photo = useBuildStore((s) => s.photo);
  const walkthrough = useBuildStore((s) => s.walkthrough);
  const overlay = useGameStore((s) => s.overlay);
  const hidden = useGameStore((s) => s.hudHidden);
  const [tut, setTut] = useState(false);
  useEffect(() => {
    if (!tutorialSeen()) setTut(true);
  }, []);
  // (wrapped so it gets pointer events — the bare panel inherited the HUD's click-through)
  if (photo) return <div className="build-hud"><PhotoPanel /></div>;
  if (hidden) return null;
  return (
    <div className="build-hud">
      {/* first = lowest layer: it only catches clicks on the 3D view, never on the toolbars */}
      <BuildClickToPlay />
      <TopBar />
      {!walkthrough && <Status />}
      {!walkthrough && <ToolBar />}
      {!walkthrough && <ToolOptionsPanel />}
      {!walkthrough && <SelectionPanel />}
      {!walkthrough && <RegionPanel />}
      {!walkthrough && <QuickBar />}
      {!walkthrough && <ChallengePanel />}
      <Hints />
      <BuildCrosshair />
      {walkthrough && <div className="walk-banner">🚶 Walkthrough — <b>F</b> opens doors & switches lights · <b>F9</b> back to building <button className="btn small" onClick={() => build()?.setWalkthrough(false)}>Keep building</button></div>}
      {tut && overlay === null && <Tutorial onClose={() => { setTut(false); markTutorialSeen(true); }} />}
    </div>
  );
}

function TopBar() {
  const world = useGameStore((s) => s.world);
  const level = useBuildStore((s) => s.level);
  const lights = useBuildStore((s) => s.lights);
  const lastSaved = useBuildStore((s) => s.lastSaved);
  const dirty = useBuildStore((s) => s.dirty);
  const undoLabel = useBuildStore((s) => s.undoLabel);
  const redoLabel = useBuildStore((s) => s.redoLabel);
  const camera = useBuildStore((s) => s.camera);
  const grid = useBuildStore((s) => s.grid);
  const walkthrough = useBuildStore((s) => s.walkthrough);
  const flying = useBuildStore((s) => s.flying);
  const set = useBuildStore((s) => s.set);
  const touch = isTouchUi();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 10000);
    return () => clearInterval(t);
  }, []);
  const saved = lastSaved ? `Saved ${ago(lastSaved)}` : 'Not saved yet';
  return (
    <div className="bh-top">
      <div className="bh-project">
        <b>🏡 {world?.name}</b>
        <span className="muted">{level === 0 ? 'Ground level' : `Level ${level > 0 ? '+' : ''}${level} m`} · 💡 {lights.active}/{lights.total} lights{lights.total > 8 ? ' (8 nearest shown)' : ''}</span>
        <span className={`bh-saved ${dirty ? 'dirty' : ''}`}>{dirty ? '● Unsaved changes' : `✓ ${saved}`}</span>
      </div>
      <div className="bh-top-actions">
        <button className="btn small" disabled={!undoLabel} title={undoLabel ? `Undo: ${undoLabel} (Ctrl+Z)` : 'Nothing to undo'} onClick={() => build()?.undo()}>↶{touch ? '' : ' Undo'}</button>
        <button className="btn small" disabled={!redoLabel} title={redoLabel ? `Redo: ${redoLabel} (Ctrl+Y)` : 'Nothing to redo'} onClick={() => build()?.redo()}>↷{touch ? '' : ' Redo'}</button>
        {camera === 'player' && (
          <button className={`btn small fly-btn ${flying ? 'on' : ''}`} title="Fly (double-tap Space)" onClick={() => build()?.toggleFly()}>
            {flying ? '🕊️ Flying' : '🕊️ Fly'}
          </button>
        )}
        <button className={`btn small ${camera === 'build' ? 'on' : ''}`} title="Build camera (C)" onClick={() => build()?.setCamera(camera === 'build' ? 'player' : 'build')}>🎥 {camera === 'build' ? 'Build cam' : 'Walk'}</button>
        <button className={`btn small ${walkthrough ? 'on' : ''}`} title="Walkthrough (F9)" onClick={() => build()?.setWalkthrough(!walkthrough)}>🚶</button>
        <button className={`btn small ${grid ? 'on' : ''}`} title="Grid (G)" onClick={() => set({ grid: !grid })}>#</button>
        <button className="btn small" title="Photo mode (F10)" onClick={() => build()?.togglePhoto()}>📷</button>
        <button className="btn small" title="Design challenge (optional)" onClick={() => set({ challenge: useBuildStore.getState().challenge ? null : CHALLENGES[0].id })}>🎯</button>
        <EnvButton />
        <button className="btn small" title="Save (Ctrl+S)" onClick={() => void Game.current?.saveNow('pause')}>💾</button>
        <button className="btn small" title="Menu (Esc)" onClick={() => Game.current?.openOverlay('pause')}>☰</button>
      </div>
    </div>
  );
}

function EnvButton() {
  const [open, setOpen] = useState(false);
  const day = useBuildStore((s) => s.dayFraction);
  const locked = useBuildStore((s) => s.timeLocked);
  const weather = useBuildStore((s) => s.weather);
  const icon = day < 0.24 || day > 0.8 ? '🌙' : day < 0.36 ? '🌅' : day > 0.66 ? '🌇' : '☀️';
  return (
    <div className="env-wrap">
      <button className="btn small" title="Time of day & weather" onClick={() => setOpen(!open)}>{icon}{locked ? '🔒' : ''}</button>
      {open && (
        <div className="panel env-pop">
          <button className="close-x small pop-x" onClick={() => setOpen(false)} aria-label="Close">✕</button>
          <EnvControls />
          <button className="btn small" onClick={() => setOpen(false)}>Done</button>
        </div>
      )}
      {void weather}
    </div>
  );
}

function EnvControls() {
  const day = useBuildStore((s) => s.dayFraction);
  const locked = useBuildStore((s) => s.timeLocked);
  const weather = useBuildStore((s) => s.weather);
  const presets: [string, number][] = [['🌅 Morning', 0.28], ['☀️ Day', 0.45], ['🌇 Golden', 0.73], ['🌙 Night', 0.92]];
  const hh = Math.floor(day * 24), mm = Math.floor((day * 24 - hh) * 60);
  return (
    <div className="env-controls">
      <label className="env-row">
        <span>Time {String(hh).padStart(2, '0')}:{String(mm).padStart(2, '0')}</span>
        <input type="range" min={0} max={1} step={0.002} value={day} onChange={(e) => build()?.setDayFraction(Number(e.target.value))} />
      </label>
      <div className="seg env-seg">
        {presets.map(([n, f]) => <button key={n} className={`seg-btn ${Math.abs(day - f) < 0.01 ? 'active' : ''}`} onClick={() => build()?.setDayFraction(f)}>{n}</button>)}
      </div>
      <label className="check"><input type="checkbox" checked={locked} onChange={(e) => build()?.setTimeLocked(e.target.checked)} /><span>Lock time of day</span></label>
      <div className="seg env-seg">
        {(['clear', 'cloudy', 'rain'] as const).map((w) => <button key={w} className={`seg-btn ${weather === w ? 'active' : ''}`} onClick={() => build()?.setWeather(w)}>{w === 'clear' ? '☀️ Clear' : w === 'cloudy' ? '☁️ Cloudy' : '🌧️ Rain'}</button>)}
      </div>
    </div>
  );
}

function Status() {
  const status = useBuildStore((s) => s.status);
  const measure = useBuildStore((s) => s.measure);
  const pending = useBuildStore((s) => s.pending);
  if (!status && !measure) return null;
  return (
    <div className="bh-status">
      <span>{status}</span>
      {measure && pending && <span className="bh-measure">{measure}</span>}
    </div>
  );
}

function ToolBar() {
  const tool = useBuildStore((s) => s.tool);
  const pasting = useBuildStore((s) => s.pasting);
  const touch = isTouchUi();
  const [open, setOpen] = useState(false);
  const current = TOOLS.find((t) => (t.id === 'raise' ? LAND_TOOLS.includes(tool) : t.id === tool)) ?? TOOLS[1];
  if (touch && !open) {
    // phones: one compact button showing the active tool; tap for the full palette
    return (
      <button className="bh-tool-drawer" onClick={() => setOpen(true)} aria-label="Tools">
        <span>{current.icon}</span>
        <small>{current.name.split(' ')[0]} ▾</small>
      </button>
    );
  }
  return (
    <div className={`bh-tools ${touch ? 'drawer-open' : ''}`}>
      {TOOLS.map((t) => {
        const active = t.id === 'raise' ? LAND_TOOLS.includes(tool) : t.id === tool && !pasting;
        return (
          <button
            key={t.id}
            className={`bh-tool ${active ? 'active' : ''}`}
            title={`${t.name}${t.key ? ` (${t.key})` : ''}`}
            onClick={() => {
              const b = build();
              if (!b) return;
              if (t.id === 'catalog') b.openCatalog();
              else b.setTool(t.id);
              setOpen(false);
            }}
          >
            <span>{t.icon}</span>
            <small>{t.name.split(' ')[0]}</small>
          </button>
        );
      })}
    </div>
  );
}

function MatPicker({ label, value, list, onPick }: { label: string; value: string; list: number[]; onPick: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const m = ARCH_MATERIALS[archIndex(value)] ?? ARCH_MATERIALS[0];
  return (
    <div className="mat-pick">
      <span className="opt-label">{label}</span>
      <button className="mat-btn" onClick={() => setOpen(!open)} title={m.name}>
        <span className="mat-dot" style={{ background: swatchOf(archIndex(value)) }} />{m.name}
      </button>
      {open && (
        <div className="panel mat-pop scroll">
          <button className="close-x small pop-x" onClick={() => setOpen(false)} aria-label="Close">✕</button>
          {[...new Set(list)].map((i) => (
            <button key={i} className={`swatch ${ARCH_MATERIALS[i].key === value ? 'active' : ''}`} style={{ background: swatchOf(i) }} title={ARCH_MATERIALS[i].name} onClick={() => { onPick(ARCH_MATERIALS[i].key); setOpen(false); }} />
          ))}
        </div>
      )}
    </div>
  );
}

function swatchOf(i: number): string {
  const m = ARCH_MATERIALS[i];
  if (!m) return '#ccc';
  if (m.tint !== '#ffffff') return m.tint;
  return m.tile === 'brick' ? '#b35a42' : m.tile === 'gravel' ? '#9a948b' : m.tile === 'planks' ? '#b3844f' : m.tile === 'fieldstone' ? '#a6a39b' : m.tile === 'thatch' ? '#d8b45a' : '#ddd';
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="stepper">
      <span className="opt-label">{label}</span>
      <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>−</button>
      <b>{value}</b>
      <button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>+</button>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="opt-toggle">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function Seg<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="opt-seg">
      <span className="opt-label">{label}</span>
      <div className="seg">
        {options.map(([v, n]) => <button key={String(v)} className={`seg-btn ${v === value ? 'active' : ''}`} onClick={() => onChange(v)}>{n}</button>)}
      </div>
    </div>
  );
}

function ToolOptionsPanel() {
  const tool = useBuildStore((s) => s.tool);
  const o = useBuildStore((s) => s.options);
  const pasting = useBuildStore((s) => s.pasting);
  const setOption = useBuildStore((s) => s.setOption);
  const set = <K extends keyof ToolOptions>(k: K) => (v: ToolOptions[K]) => setOption(k, v);
  if (pasting) return <PastePanel />;
  let body: ReactNode = null;
  switch (tool) {
    case 'wall':
      body = <><Stepper label="Height" value={o.wallHeight} min={1} max={4} onChange={set('wallHeight')} /><MatPicker label="Wall" value={o.wallMat} list={WALL_MATERIALS} onPick={set('wallMat')} /></>;
      break;
    case 'room':
      body = (
        <>
          <Stepper label="Wall height" value={o.wallHeight} min={1} max={4} onChange={set('wallHeight')} />
          <MatPicker label="Walls" value={o.wallMat} list={WALL_MATERIALS} onPick={set('wallMat')} />
          <MatPicker label="Floor" value={o.floorMat} list={FLOOR_MATERIALS} onPick={set('floorMat')} />
          <Toggle label="Ceiling" value={o.ceiling} onChange={set('ceiling')} />
          {o.ceiling && <MatPicker label="Ceiling" value={o.ceilingMat} list={WALL_MATERIALS} onPick={set('ceilingMat')} />}
          <span className="muted small-note">Doors & windows cut their own openings.</span>
        </>
      );
      break;
    case 'floor':
      body = <MatPicker label="Floor" value={o.floorMat} list={FLOOR_MATERIALS} onPick={set('floorMat')} />;
      break;
    case 'foundation':
      body = <><MatPicker label="Foundation" value={o.foundationMat} list={STRUCT_MATERIALS} onPick={set('foundationMat')} /><Stepper label="Raise" value={o.foundationRaise} min={0} max={2} onChange={set('foundationRaise')} /></>;
      break;
    case 'roof':
      body = (
        <>
          <Seg label="Type" value={o.roofType} options={[['flat', 'Flat'], ['gable', 'Gable'], ['shed', 'Shed'], ['hip', 'Hip']]} onChange={set('roofType')} />
          {(o.roofType === 'gable' || o.roofType === 'shed') && <Seg label="Pitch" value={o.roofPitch} options={[['steep', 'Steep'], ['low', 'Low']]} onChange={set('roofPitch')} />}
          <Seg label="Overhang" value={o.overhang} options={[[0, 'None'], [1, '1 block']]} onChange={set('overhang')} />
          <MatPicker label="Roof" value={o.roofMat} list={ROOF_MATERIALS} onPick={set('roofMat')} />
          <span className="muted small-note">Click two opposite corners of the walls.</span>
        </>
      );
      break;
    case 'stairs':
      body = <><Stepper label="Width" value={o.stairWidth} min={1} max={3} onChange={set('stairWidth')} /><Toggle label="Floating" value={o.floatingStairs} onChange={set('floatingStairs')} /><MatPicker label="Material" value={o.stairMat} list={STRUCT_MATERIALS} onPick={set('stairMat')} /><span className="muted small-note">Click the bottom step, then the upper floor.</span></>;
      break;
    case 'pool':
      body = <><Stepper label="Depth" value={o.poolDepth} min={1} max={4} onChange={set('poolDepth')} /><Toggle label="Steps" value={o.poolSteps} onChange={set('poolSteps')} /></>;
      break;
    case 'raise': case 'lower': case 'flatten': case 'paint_ground': case 'water':
      body = (
        <>
          <Seg label="Brush" value={tool} options={[['raise', '⛰️ Raise'], ['lower', '🕳️ Lower'], ['flatten', '➖ Flatten'], ['paint_ground', '🌱 Paint'], ['water', '💧 Pond']]} onChange={(v) => build()?.setTool(v)} />
          {tool !== 'water' && <Seg label="Size" value={o.brush} options={[[1, '1'], [3, '3'], [5, '5'], [9, '9']]} onChange={set('brush')} />}
          {tool === 'paint_ground' && <Seg label="Ground" value={o.ground} options={[['grass', 'Grass'], ['dirt', 'Soil'], ['sand', 'Sand'], ['gravel', 'Gravel'], ['stone', 'Stone'], ['pavers', 'Pavers'], ['decking', 'Deck']]} onChange={set('ground')} />}
        </>
      );
      break;
    case 'farm':
      body = (
        <>
          <Seg label="Crop" value={o.farmCrop} options={[...FARM_CROPS.map((c) => [c.key, `${c.icon} ${c.name}`] as [string, string]), ['mixed', '🧺 Mixed rows']]} onChange={set('farmCrop')} />
          <Seg label="Plant as" value={o.farmStage} options={[['grow', '🌱 Growing'], [0, 'Seedlings'], [2, 'Half grown'], [3, 'Ripe']]} onChange={set('farmStage')} />
          <Toggle label="💧 Water channels" value={o.farmIrrigation} onChange={set('farmIrrigation')} />
          <Toggle label="Picket fence" value={o.farmFence} onChange={set('farmFence')} />
          <span className="muted small-note">Tap / click two corners of the field. Ripe crops: tap to harvest — they replant themselves.</span>
        </>
      );
      break;
    case 'paint':
      body = <><MatPicker label="Paint with" value={o.wallMat} list={[...WALL_MATERIALS, ...FLOOR_MATERIALS, ...ROOF_MATERIALS]} onPick={(k) => { setOption('wallMat', k); useBuildStore.getState().selectItem(null); }} /><span className="muted small-note">Click objects to cycle their colours.</span></>;
      break;
    default:
      return null;
  }
  return <div className="panel bh-options">{body}</div>;
}

function PastePanel() {
  const name = useBuildStore((s) => s.pasteName);
  const deg = useBuildStore((s) => s.rotationDeg);
  return (
    <div className="panel bh-options">
      <b>📐 {name}</b>
      <button className="btn small" onClick={() => build()?.rotate()}>⟳ Rotate (R) · {deg}°</button>
      <span className="muted small-note">Click to place · right-click / Esc to cancel</span>
      <button className="btn small" onClick={() => build()?.cancelOrDeselect(true)}>Cancel</button>
    </div>
  );
}

function SelectionPanel() {
  const sel = useBuildStore((s) => s.selection);
  const tool = useBuildStore((s) => s.tool);
  if (!sel || tool !== 'select') return null;
  const b = build();
  const o = b?.objects.get(sel.id);
  return (
    <div className="panel bh-selection">
      <div className="sel-head"><b>{sel.name}</b><button className="close-x small" onClick={() => b?.select(null)} aria-label="Deselect">✕</button></div>
      <div className="sel-actions">
        <button className="btn small" onClick={() => b?.rotate(false)}>⟳ Rotate</button>
        {sel.freeRotate && <button className="btn small" onClick={() => b?.rotate(true)}>⟳ 15°</button>}
        <button className="btn small" onClick={() => b?.duplicateSelected()}>⧉ Duplicate</button>
        <button className="btn small danger" onClick={() => b?.deleteSelected()}>🗑 Delete</button>
        {sel.interactive && o && (
          <button className="btn small" onClick={() => b?.interact(o.id)}>
            {o.def.interaction === 'door' || o.def.interaction === 'curtain' ? (o.state?.open ? 'Close' : 'Open') : o.def.interaction === 'label' ? 'Rename' : o.state?.on ? 'Turn off' : 'Turn on'}
          </button>
        )}
      </div>
      <span className="muted small-note">Drag to move · Alt for free placement</span>
      {sel.variants.length > 1 && (
        <div className="swatches">
          {sel.variants.map((v) => (
            <button key={v.id} className={`swatch ${v.id === sel.variant ? 'active' : ''}`} style={{ background: v.swatch }} title={v.name} aria-label={v.name} onClick={() => b?.setSelectedVariant(v.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function RegionPanel() {
  const region = useBuildStore((s) => s.regionSelected);
  const tool = useBuildStore((s) => s.tool);
  if (!region || tool !== 'copy') return null;
  const b = build();
  return (
    <div className="panel bh-selection">
      <div className="sel-head"><b>📋 Area {region.size.join(' × ')}</b><button className="close-x small" onClick={() => b?.clearRegion()} aria-label="Clear">✕</button></div>
      <span className="muted small-note">{region.blocks} blocks copied</span>
      <div className="sel-actions">
        <button className="btn small" onClick={() => b?.startPaste()}>📥 Paste (Ctrl+V)</button>
        <button className="btn small" onClick={() => { useBuildStore.getState().set({ blueprintNaming: true }); Game.current?.openOverlay('buildDialog'); }}>📐 Save as blueprint</button>
        <button className="btn small danger" onClick={() => b?.deleteRegion()}>🗑 Delete area</button>
      </div>
    </div>
  );
}

function QuickBar() {
  const recent = useBuildStore((s) => s.recent);
  const selected = useBuildStore((s) => s.selectedItem);
  const tool = useBuildStore((s) => s.tool);
  const deg = useBuildStore((s) => s.rotationDeg);
  const max = isTouchUi() ? (window.innerWidth < 760 ? 4 : 6) : 9;
  const items = recent.slice(0, max).map((id) => catalogItem(id)).filter((x): x is BuildCatalogItem => !!x);
  return (
    <div className="bh-quick">
      {items.map((i, k) => (
        <button key={i.id} className={`bh-slot ${selected === i.id && (tool === 'place' || tool === i.tool) ? 'active' : ''}`} title={i.name} onClick={() => build()?.chooseItem(i.id)}>
          <ItemIcon item={i} size={40} />
          <span className="bh-num">{k + 1}</span>
        </button>
      ))}
      <button className="bh-slot bh-open" title="Build Catalog (B)" onClick={() => build()?.openCatalog()}>
        <span>📚</span><small>B</small>
      </button>
      {tool === 'place' && deg !== 0 && <span className="bh-rot">⟳ {deg}°</span>}
    </div>
  );
}

function Hints() {
  const collapsed = useBuildStore((s) => s.hintsCollapsed);
  const set = useBuildStore((s) => s.set);
  return (
    <div className={`bh-hints ${collapsed ? 'collapsed' : ''}`}>
      <button className="bh-hints-toggle" onClick={() => set({ hintsCollapsed: !collapsed })}>{collapsed ? '⌨️ Hints (H)' : 'Hide hints (H)'}</button>
      {!collapsed && (
        <div className="bh-hint-list">
          {BUILD_HINTS.map(([k, v]) => <span key={k}><kbd>{k}</kbd> {v}</span>)}
        </div>
      )}
    </div>
  );
}

function BuildCrosshair() {
  const camera = useBuildStore((s) => s.camera);
  const cursor = useBuildStore((s) => s.cursorMode);
  const locked = usePointerLocked();
  const overlay = useGameStore((s) => s.overlay);
  const touch = useTouch();
  if (cursor || overlay !== null) return null;
  if (!touch && (camera === 'build' || !locked)) return null;
  return <div className="crosshair"><span className="dot" /></div>;
}

function BuildClickToPlay() {
  const camera = useBuildStore((s) => s.camera);
  const cursor = useBuildStore((s) => s.cursorMode);
  const locked = usePointerLocked();
  const overlay = useGameStore((s) => s.overlay);
  const touch = useTouch();
  if (locked || overlay !== null || camera === 'build' || cursor || touch) return null;
  return (
    <button className="click-to-play" onClick={() => Game.current?.input.requestLock()}>
      <span className="ctp-card">
        <b>Click to keep building</b>
        <small>Mouse to look · WASD to walk · B catalog · C build camera · Tab cursor mode</small>
      </span>
    </button>
  );
}

const TUTORIAL: { icon: string; title: string; text: string }[] = [
  { icon: '📚', title: 'Open the catalog', text: 'Press B to browse walls, floors, windows, furniture, lighting, landscaping and whole house templates. Everything is unlimited.' },
  { icon: '🧱', title: 'Place & rotate', text: 'Click to place. The see-through ghost turns red when something is in the way. R rotates, Alt places freely off the grid.' },
  { icon: '🏠', title: 'Big tools', text: 'Wall (Y), Room (U), Floor (I), Roof (O), Stairs (J) and Pool (K): click two points to build a whole piece at once.' },
  { icon: '↶', title: 'Undo anything', text: 'Ctrl+Z undoes, Ctrl+Y redoes. X removes, P picks a material, V selects and moves furniture.' },
  { icon: '🎥', title: 'Build camera', text: 'Press C to fly above your build: right-drag to look, Alt+right-drag to orbit, wheel to zoom, Q/E down/up. C again walks you back in.' },
  { icon: '🕊️', title: 'Fly & open doors', text: 'Double-tap Space (or the 🕊️ Fly button) to fly: Space up, Shift down, Ctrl faster. Click a door to open it; F or right-click switches lights.' },
];

const TUTORIAL_TOUCH: { icon: string; title: string; text: string }[] = [
  { icon: '📚', title: 'Open the catalog', text: 'Tap 📚 (bottom) to browse walls, floors, windows, doors, furniture, farming, landscaping and whole house templates. Everything is unlimited.' },
  { icon: '🧱', title: 'Place & rotate', text: 'Aim the dot at the ground and tap the screen (or 🧱) to place. Press & hold to keep placing. ⟳ rotates, ↶ undoes.' },
  { icon: '🚪', title: 'Doors & lights', text: 'Tap a door to open or close it. Aim at lamps, taps and TVs and press ✋ to switch them.' },
  { icon: '🕊️', title: 'Fly!', text: 'Tap 🕊️ Fly at the top (or double-tap ⤒). Then ⏫ / ⏬ go up and down — perfect for roofs and second floors.' },
  { icon: '🛠️', title: 'Big tools', text: 'Tap the tool button (top left) for Wall, Room, Floor, Roof, Stairs, Pool and the 🌾 Farm Plot: tap two corners to build a whole piece at once.' },
];

function Tutorial({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const steps = isTouchUi() ? TUTORIAL_TOUCH : TUTORIAL;
  const t = steps[i];
  return (
    <div className="bh-tutorial panel">
      <div className="tut-step">{i + 1} / {steps.length}</div>
      <div className="tut-icon">{t.icon}</div>
      <b>{t.title}</b>
      <p>{t.text}</p>
      <div className="tut-actions">
        <button className="btn small ghost" onClick={onClose}>Skip</button>
        {i < steps.length - 1 ? <button className="btn small build-home-btn" onClick={() => setI(i + 1)}>Next</button> : <button className="btn small build-home-btn" onClick={onClose}>Start building</button>}
      </div>
    </div>
  );
}

function PhotoPanel() {
  const [hide, setHide] = useState(false);
  const touch = useTouch();
  if (hide) return <button className="photo-show" onClick={() => setHide(false)} title="Show photo controls">📷</button>;
  return (
    <div className="panel photo-panel">
      <b>📷 Photo mode</b>
      <span className="muted small-note">{touch ? 'Stick moves · drag to look · ⏫ ⏬ up and down' : 'WASD fly · right-drag look · Alt+right-drag orbit · wheel zoom'}</span>
      <EnvControls />
      <div className="tut-actions">
        <button className="btn small" onClick={() => setHide(true)}>Hide controls</button>
        <button className="btn small build-home-btn" onClick={() => build()?.togglePhoto()}>{touch ? 'Exit' : 'Exit (F10)'}</button>
      </div>
    </div>
  );
}

function usePointerLocked(): boolean {
  const [locked, setLocked] = useState(() => !!document.pointerLockElement);
  useEffect(() => {
    const on = () => setLocked(!!document.pointerLockElement);
    document.addEventListener('pointerlockchange', on);
    on();
    return () => document.removeEventListener('pointerlockchange', on);
  }, []);
  return locked;
}

function ChallengePanel() {
  const id = useBuildStore((s) => s.challenge);
  const set = useBuildStore((s) => s.set);
  const touch = useTouch();
  const [open, setOpen] = useState(true);
  useEffect(() => setOpen(!touch), [id, touch]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!id) return;
    const t = setInterval(() => tick((x) => x + 1), 1500);
    return () => clearInterval(t);
  }, [id]);
  const c = challengeById(id);
  if (!c) return null;
  const progress = build()?.challengeProgress(c.id) ?? [];
  const done = progress.filter((p) => p.have >= p.need).length;
  const i = CHALLENGES.findIndex((x) => x.id === c.id);
  if (!open) {
    // phones: a small chip that doesn't cover the tool options; tap to expand
    return <button className="bh-challenge-chip" onClick={() => setOpen(true)}>🎯 {done}/{progress.length}</button>;
  }
  return (
    <div className="panel bh-challenge">
      <div className="sel-head"><b>🎯 {c.title}</b>{touch && <button className="btn small" onClick={() => setOpen(false)}>Hide</button>}<button className="close-x small" onClick={() => set({ challenge: null })} aria-label="Close challenge">✕</button></div>
      <span className="muted small-note">{c.brief}</span>
      <ul>
        {progress.map((p) => (
          <li key={p.label} className={p.have >= p.need ? 'done' : ''}>{p.have >= p.need ? '✅' : '⬜'} {p.label} <small>({p.have}/{p.need})</small></li>
        ))}
      </ul>
      <div className="sel-actions">
        <span className="small-note"><b>{done}/{progress.length}</b> done{done === progress.length ? ' — lovely work! 🎉' : ''}</span>
        <button className="btn small" onClick={() => set({ challenge: CHALLENGES[(i + 1) % CHALLENGES.length].id })}>Next challenge</button>
      </div>
    </div>
  );
}

function ago(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 20) return 'just now';
  if (s < 90) return `${s}s ago`;
  return `${Math.round(s / 60)} min ago`;
}
