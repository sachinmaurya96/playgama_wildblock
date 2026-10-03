import { useEffect, useState } from 'react';
import { launchWorld } from '../../app/launch';
import { audio } from '../../game/core/audio';
import { deleteWorld, listWorlds, renameWorld } from '../../persistence/SaveManager';
import type { WorldMeta } from '../../persistence/types';
import { useGameStore } from '../../stores/gameStore';
import { MenuBackground } from './MenuBackground';

const PLOT_NAMES: Record<string, string> = {
  meadow: 'Flat Meadow', coastal: 'Coastal Plot', forest: 'Forest Clearing', mountain: 'Mountain View', lakeside: 'Lakeside', desert: 'Desert Modern', studio: 'White Studio',
};

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function fmtDate(t: number): string {
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function WorldSelect() {
  const [worlds, setWorlds] = useState<WorldMeta[] | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [confirm, setConfirm] = useState<WorldMeta | null>(null);
  const [filter, setFilter] = useState<'all' | 'survival' | 'build'>('all');
  const refresh = () => void listWorlds().then(setWorlds);
  useEffect(refresh, []);
  return (
    <div className="menu-screen">
      <MenuBackground />
      <div className="panel worlds-panel">
        <button className="close-x" onClick={() => useGameStore.getState().setScreen('menu')} aria-label="Back">✕</button>
        <h2 className="panel-title">🗺️ Your Worlds</h2>
        <div className="seg world-filter">
          {([['all', 'All'], ['survival', '🌲 Survival'], ['build', '🏡 Build Home']] as const).map(([id, label]) => (
            <button key={id} className={`seg-btn ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>
        <div className="world-list scroll">
          {worlds === null && <p className="muted">Loading…</p>}
          {worlds?.length === 0 && (
            <div className="empty">
              <p>No worlds yet.</p>
              <button className="btn primary" onClick={() => useGameStore.getState().setScreen('newWorld')}>Create your first world</button>
            </div>
          )}
          {worlds?.filter((w) => filter === 'all' || (w.mode ?? 'survival') === filter).map((w) => (
            <div key={w.id} className={`world-card ${w.mode === 'build' ? 'is-build' : ''}`}>
              <div className="world-thumb" style={w.thumbnail ? { backgroundImage: `url(${w.thumbnail})` } : undefined}>{!w.thumbnail && (w.mode === 'build' ? '🏡' : '🌲')}</div>
              <div className="world-info">
                {renaming === w.id ? (
                  <form onSubmit={async (e) => { e.preventDefault(); await renameWorld(w.id, newName); setRenaming(null); refresh(); }}>
                    <input autoFocus value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)} onBlur={() => setRenaming(null)} />
                  </form>
                ) : (
                  <div className="world-name">
                    <span className={`mode-badge ${w.mode === 'build' ? 'build' : 'survival'}`}>{w.mode === 'build' ? 'BUILD HOME' : 'SURVIVAL'}</span>
                    {w.name}
                  </div>
                )}
                <div className="muted world-meta">
                  {w.mode === 'build'
                    ? <>Last edited {fmtDate(w.lastPlayed)} · {fmtTime(w.playTime)} building · {PLOT_NAMES[w.build?.plot ?? 'meadow']}</>
                    : <>Last played {fmtDate(w.lastPlayed)} · {fmtTime(w.playTime)} played · {w.difficulty} · seed “{w.seedText}”</>}
                </div>
              </div>
              <div className="world-actions">
                <button className={`btn small ${w.mode === 'build' ? 'build-home-btn' : 'primary'}`} onClick={() => { audio.play('click'); void launchWorld(w.id); }}>{w.mode === 'build' ? 'Build' : 'Play'}</button>
                <button className="btn small" onClick={() => { setRenaming(w.id); setNewName(w.name); }}>Rename</button>
                <button className="btn small danger" onClick={() => setConfirm(w)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
        <div className="menu-buttons row">
          <button className="btn" onClick={() => useGameStore.getState().setScreen('newWorld')}>🌱 New World</button>
          <button className="btn build-home-btn" onClick={() => useGameStore.getState().setScreen('newBuild')}>🏡 Build Home</button>
        </div>
      </div>
      {confirm && (
        <div className="modal-backdrop">
          <div className="panel confirm-panel">
            <h2 className="panel-title">Delete “{confirm.name}”?</h2>
            <p>This removes the world and everything you built in it. It cannot be undone.</p>
            <div className="menu-buttons row">
              <button className="btn" onClick={() => setConfirm(null)}>Keep it</button>
              <button className="btn danger" onClick={async () => { await deleteWorld(confirm.id); setConfirm(null); refresh(); }}>Delete forever</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
