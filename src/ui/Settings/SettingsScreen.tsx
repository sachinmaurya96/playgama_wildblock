import { useEffect, useState } from 'react';
import { audio } from '../../game/core/audio';
import { useGameStore } from '../../stores/gameStore';
import { ACTION_LABELS, keyLabel, useSettingsStore, type Action, type QualityPreset } from '../../stores/settingsStore';

type Tab = 'graphics' | 'audio' | 'controls' | 'gameplay' | 'accessibility';

export function SettingsScreen({ inGame = false }: { inGame?: boolean }) {
  const [tab, setTab] = useState<Tab>('graphics');
  const back = () => {
    audio.play('close');
    if (inGame) useGameStore.getState().setOverlay('pause');
    else useGameStore.getState().setScreen(useGameStore.getState().returnTo === 'settings' ? 'menu' : useGameStore.getState().returnTo);
  };
  return (
    <div className={inGame ? 'modal-backdrop' : 'menu-screen'}>
      <div className="panel settings-panel">
        <button className="close-x" onClick={back} aria-label="Back">✕</button>
        <h2 className="panel-title">⚙️ Settings</h2>
        <div className="tabs">
          {(['graphics', 'audio', 'controls', 'gameplay', 'accessibility'] as Tab[]).map((t) => (
            <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div className="settings-body scroll">
          {tab === 'graphics' && <Graphics />}
          {tab === 'audio' && <Audio />}
          {tab === 'controls' && <Controls />}
          {tab === 'gameplay' && <Gameplay />}
          {tab === 'accessibility' && <Accessibility />}
        </div>
        <div className="settings-foot">
          <button className="btn primary" onClick={back}>Done</button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="setting-row">
      <span className="setting-label">
        {label}
        {hint && <small className="muted">{hint}</small>}
      </span>
      <span className="setting-control">{children}</span>
    </label>
  );
}

function Slider({ value, min, max, step, onChange, format }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="setting-value">{format ? format(value) : value}</span>
    </>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className={`toggle ${value ? 'on' : ''}`} onClick={() => onChange(!value)} aria-pressed={value}>
      <span />
    </button>
  );
}

function Graphics() {
  const g = useSettingsStore((s) => s.graphics);
  const update = useSettingsStore((s) => s.update);
  const applyPreset = useSettingsStore((s) => s.applyPreset);
  const set = (p: Partial<typeof g>) => update('graphics', { ...p, preset: g.preset === 'auto' ? 'auto' : 'custom' });
  return (
    <>
      <Row label="Quality preset" hint="Auto adapts to your device and lowers settings if frame rate drops.">
        <div className="seg">
          {(['low', 'medium', 'high', 'auto'] as QualityPreset[]).map((p) => (
            <button key={p} className={`seg-btn ${g.preset === p ? 'active' : ''}`} onClick={() => applyPreset(p)}>
              {p[0].toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Render distance" hint="Chunks around you. Lower = faster.">
        <Slider value={g.renderDistance} min={3} max={12} step={1} onChange={(v) => set({ renderDistance: v })} />
      </Row>
      <Row label="Resolution scale">
        <Slider value={g.resolutionScale} min={0.5} max={1} step={0.05} onChange={(v) => set({ resolutionScale: v })} format={(v) => `${Math.round(v * 100)}%`} />
      </Row>
      <Row label="Max pixel ratio" hint="High-DPI screens: capping this saves a lot of GPU.">
        <Slider value={g.maxPixelRatio} min={1} max={3} step={0.25} onChange={(v) => set({ maxPixelRatio: v })} format={(v) => `${v}×`} />
      </Row>
      <Row label="Field of view">
        <Slider value={g.fov} min={55} max={100} step={1} onChange={(v) => update('graphics', { fov: v })} format={(v) => `${v}°`} />
      </Row>
      <Row label="Creature shadows">
        <Toggle value={g.shadows} onChange={(v) => set({ shadows: v })} />
      </Row>
      <Row label="Particles">
        <div className="seg">
          {(['off', 'low', 'high'] as const).map((p) => (
            <button key={p} className={`seg-btn ${g.particles === p ? 'active' : ''}`} onClick={() => set({ particles: p })}>
              {p}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Clouds">
        <Toggle value={g.clouds} onChange={(v) => set({ clouds: v })} />
      </Row>
      <Row label="Automatic quality" hint="Gently lowers render distance / resolution when frames drop.">
        <Toggle value={g.autoQuality} onChange={(v) => update('graphics', { autoQuality: v })} />
      </Row>
    </>
  );
}

function Audio() {
  const a = useSettingsStore((s) => s.audio);
  const update = useSettingsStore((s) => s.update);
  const rows: [keyof typeof a, string][] = [['master', 'Master'], ['music', 'Music'], ['sfx', 'Effects'], ['ambient', 'Ambience'], ['creatures', 'Creatures'], ['ui', 'Interface']];
  return (
    <>
      {rows.map(([k, label]) => (
        <Row key={k} label={label}>
          <Slider
            value={a[k]} min={0} max={1} step={0.05}
            onChange={(v) => {
              update('audio', { [k]: v });
              audio.init();
              audio.play('click');
            }}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </Row>
      ))}
      <p className="muted">All music and sounds in WildBlocks are synthesised live in your browser.</p>
    </>
  );
}

function Controls() {
  const c = useSettingsStore((s) => s.controls);
  const update = useSettingsStore((s) => s.update);
  const bind = useSettingsStore((s) => s.bindKey);
  const [listening, setListening] = useState<Action | null>(null);
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') bind(listening, e.code);
      setListening(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listening, bind]);
  return (
    <>
      <Row label="Mouse sensitivity">
        <Slider value={c.sensitivity} min={0.2} max={3} step={0.05} onChange={(v) => update('controls', { sensitivity: v })} format={(v) => `${v.toFixed(2)}×`} />
      </Row>
      <Row label="Invert Y axis">
        <Toggle value={c.invertY} onChange={(v) => update('controls', { invertY: v })} />
      </Row>
      <Row label="Touch controls">
        <div className="seg">
          {(['auto', 'on', 'off'] as const).map((p) => (
            <button key={p} className={`seg-btn ${c.touch === p ? 'active' : ''}`} onClick={() => update('controls', { touch: p })}>{p}</button>
          ))}
        </div>
      </Row>
      <div className="keybinds">
        {(Object.keys(ACTION_LABELS) as Action[]).map((a) => (
          <div key={a} className="keybind-row">
            <span>{ACTION_LABELS[a]}</span>
            <button className={`btn small keybtn ${listening === a ? 'listening' : ''}`} onClick={() => setListening(a)}>
              {listening === a ? 'Press a key…' : keyLabel(c.keys[a])}
            </button>
          </div>
        ))}
      </div>
      <p className="muted">If a key is already used, the two actions swap keys.</p>
      <button className="btn small" onClick={() => useSettingsStore.getState().resetKeys()}>Reset keys</button>
    </>
  );
}

function Gameplay() {
  const gp = useSettingsStore((s) => s.gameplay);
  const update = useSettingsStore((s) => s.update);
  return (
    <>
      <Row label="Camera" hint="Toggle any time with V.">
        <div className="seg">
          {(['first', 'third'] as const).map((p) => (
            <button key={p} className={`seg-btn ${gp.cameraMode === p ? 'active' : ''}`} onClick={() => update('gameplay', { cameraMode: p })}>
              {p === 'first' ? 'First person' : 'Third person'}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Day length" hint="Real minutes for a full day/night cycle.">
        <Slider value={gp.dayLengthMinutes} min={10} max={40} step={2} onChange={(v) => update('gameplay', { dayLengthMinutes: v })} format={(v) => `${v} min`} />
      </Row>
      <Row label="Tutorial tips">
        <Toggle value={gp.tips} onChange={(v) => update('gameplay', { tips: v })} />
      </Row>
      <Row label="Placement ghost preview">
        <Toggle value={gp.ghostPreview} onChange={(v) => update('gameplay', { ghostPreview: v })} />
      </Row>
      <Row label="Debug overlay (F3)">
        <Toggle value={gp.showDebug} onChange={(v) => update('gameplay', { showDebug: v })} />
      </Row>
      <p className="muted">Difficulty is chosen per world when you create it.</p>
    </>
  );
}

function Accessibility() {
  const a = useSettingsStore((s) => s.accessibility);
  const update = useSettingsStore((s) => s.update);
  return (
    <>
      <Row label="Reduce camera shake & head bob">
        <Toggle value={a.reducedShake} onChange={(v) => update('accessibility', { reducedShake: v })} />
      </Row>
      <Row label="High-contrast block outline">
        <Toggle value={a.highContrastOutline} onChange={(v) => update('accessibility', { highContrastOutline: v })} />
      </Row>
      <Row label="Subtitles for creature sounds">
        <Toggle value={a.subtitles} onChange={(v) => update('accessibility', { subtitles: v })} />
      </Row>
      <Row label="Reduce flashing (lightning, hit flashes)">
        <Toggle value={a.reduceFlashing} onChange={(v) => update('accessibility', { reduceFlashing: v })} />
      </Row>
      <Row label="Interface size">
        <Slider value={a.uiScale} min={0.8} max={1.4} step={0.05} onChange={(v) => update('accessibility', { uiScale: v })} format={(v) => `${Math.round(v * 100)}%`} />
      </Row>
    </>
  );
}
