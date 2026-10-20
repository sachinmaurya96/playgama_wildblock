import { useState } from 'react';
import { createAndLaunch } from '../../app/launch';
import { THEMES } from '../../data/buildCatalog';
import { audio } from '../../game/core/audio';
import type { BuildTimeOfDay, PlotType } from '../../persistence/types';
import { useGameStore } from '../../stores/gameStore';
import { BuildHomePreview } from './BuildHomePreview';

const PLOTS: { id: PlotType; name: string; text: string; colors: [string, string, string] }[] = [
  { id: 'meadow', name: 'Flat Meadow', text: 'Rolling grassland all around.', colors: ['#9fc7e8', '#7fb24c', '#5f8f3a'] },
  { id: 'coastal', name: 'Coastal Plot', text: 'Sea views and a sandy shore.', colors: ['#8fc6e8', '#3f8fc6', '#e3cf98'] },
  { id: 'forest', name: 'Forest Clearing', text: 'Tall trees surround the lot.', colors: ['#a6c8d8', '#2f6a35', '#4f8a3a'] },
  { id: 'mountain', name: 'Mountain View', text: 'Peaks rise behind the lot.', colors: ['#b7cbe0', '#8a8f96', '#f2f4f6'] },
  { id: 'lakeside', name: 'Lakeside', text: 'A calm lake beside the plot.', colors: ['#a9cfe6', '#4f9fce', '#7fb24c'] },
  { id: 'desert', name: 'Desert Modern', text: 'Warm sand and red mesas.', colors: ['#f4d6a8', '#e3b878', '#c2653f'] },
  { id: 'studio', name: 'Blank White Studio', text: 'A clean white void for pure design.', colors: ['#f7f7f5', '#e8e8e4', '#d0d0cc'] },
];

const TIMES: { id: BuildTimeOfDay; name: string; icon: string }[] = [
  { id: 'morning', name: 'Morning', icon: '🌅' },
  { id: 'day', name: 'Day', icon: '☀️' },
  { id: 'golden', name: 'Golden Hour', icon: '🌇' },
  { id: 'night', name: 'Night', icon: '🌙' },
];

const NAMES = ['Dream House', 'Lakeview Villa', 'Maple Cottage', 'Sunset Residence', 'Cedar House', 'The Glass Pavilion'];

/** New Build Home project: name, plot type, time of day, optional style palette. */
export function NewBuildHomeScreen() {
  const [name, setName] = useState(NAMES[Math.floor(Math.random() * NAMES.length)]);
  const [plot, setPlot] = useState<PlotType>('meadow');
  const [time, setTime] = useState<BuildTimeOfDay>('golden');
  const [theme, setTheme] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    audio.init();
    audio.play('chime');
    try { await createAndLaunch({
      name: name.trim() || 'Dream House', seedText: '', difficulty: 'peaceful', peacefulCreatures: true, mode: 'build',
      build: { plot, timeOfDay: time, timeLocked: true, weather: 'clear', theme: theme || undefined },
    }); }
    catch { useGameStore.getState().toast('Your project could not be saved. Retry saving, then try again.', 'warn'); }
    finally { setBusy(false); }
  };
  return (
    <div className="menu-screen">
      <BuildHomePreview />
      <form className="panel form-panel build-form" onSubmit={(e) => { e.preventDefault(); void start(); }}>
        <button type="button" className="close-x" onClick={() => useGameStore.getState().setScreen('menu')} aria-label="Back">✕</button>
        <h2 className="panel-title">🏡 New Build Home Project</h2>
        <p className="muted build-intro">A flat 256 × 256 lot, unlimited materials and furniture, no survival — just design.</p>
        <label className="field">
          <span>Project name</span>
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="field">
          <span>Plot type</span>
          <div className="plot-cards">
            {PLOTS.map((p) => (
              <button type="button" key={p.id} className={`plot-card ${plot === p.id ? 'active' : ''}`} onClick={() => { setPlot(p.id); audio.play('click'); }}>
                <span className="plot-swatch" style={{ background: `linear-gradient(180deg, ${p.colors[0]} 0 45%, ${p.colors[1]} 45% 75%, ${p.colors[2]} 75%)` }} />
                <b>{p.name}</b>
                <small>{p.text}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Time of day <small className="muted">(locked while you build — change it anytime)</small></span>
          <div className="seg">
            {TIMES.map((t) => (
              <button type="button" key={t.id} className={`seg-btn ${time === t.id ? 'active' : ''}`} onClick={() => setTime(t.id)}>{t.icon} {t.name}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Style palette <small className="muted">(optional — highlights matching materials)</small></span>
          <div className="seg">
            <button type="button" className={`seg-btn ${theme === '' ? 'active' : ''}`} onClick={() => setTheme('')}>Any style</button>
            {THEMES.map((t) => (
              <button type="button" key={t.id} className={`seg-btn ${theme === t.id ? 'active' : ''}`} title={t.description} onClick={() => setTheme(t.id)}>{t.name}</button>
            ))}
          </div>
        </div>
        <button className="btn big build-home-btn" type="submit" disabled={busy}>{busy ? 'Preparing your lot…' : 'Start Building'}</button>
      </form>
    </div>
  );
}
