import { useState } from 'react';
import { createAndLaunch } from '../../app/launch';
import { audio } from '../../game/core/audio';
import { useGameStore, type Difficulty } from '../../stores/gameStore';
import { MenuBackground } from './MenuBackground';

const NAMES = ['Mossy Hollow', 'Brambleford', 'Amberfall Vale', 'Fernwhistle', 'Pinecrest', 'Willowmere', 'Glimmerdell', 'Thistledown'];

const DIFFICULTIES: { id: Difficulty; name: string; text: string }[] = [
  { id: 'peaceful', name: 'Peaceful', text: 'No hostile creatures. Nothing is lost if you faint.' },
  { id: 'explorer', name: 'Explorer', text: 'The intended experience: dangerous nights — creatures hunt you after dark. Some gathered items drop on fainting.' },
  { id: 'adventurer', name: 'Adventurer', text: 'Night packs are bigger and fiercer. Everything drops when you faint.' },
];

export function NewWorldScreen() {
  const [name, setName] = useState(NAMES[Math.floor(Math.random() * NAMES.length)]);
  const [seed, setSeed] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('explorer');
  const [peaceful, setPeaceful] = useState(false);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    audio.init();
    audio.play('chime');
    await createAndLaunch({ name, seedText: seed, difficulty, peacefulCreatures: peaceful });
  };
  return (
    <div className="menu-screen">
      <MenuBackground />
      <form className="panel form-panel" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <button type="button" className="close-x" onClick={() => useGameStore.getState().setScreen('menu')} aria-label="Back">✕</button>
        <h2 className="panel-title">🌱 New World</h2>
        <label className="field">
          <span>World name</span>
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Seed <small className="muted">(optional — leave blank for a surprise)</small></span>
          <input value={seed} maxLength={40} placeholder="e.g. fern-42 or 12345" onChange={(e) => setSeed(e.target.value)} />
        </label>
        <div className="field">
          <span>Difficulty</span>
          <div className="difficulty-cards">
            {DIFFICULTIES.map((d) => (
              <button type="button" key={d.id} className={`diff-card ${difficulty === d.id ? 'active' : ''}`} onClick={() => setDifficulty(d.id)}>
                <b>{d.name}</b>
                <small>{d.text}</small>
              </button>
            ))}
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={peaceful} onChange={(e) => setPeaceful(e.target.checked)} />
          <span>Peaceful creatures only <small className="muted">(no hostile creatures at all, any difficulty)</small></span>
        </label>
        <button className="btn primary big" type="submit" disabled={busy}>{busy ? 'Growing…' : 'Generate World'}</button>
      </form>
    </div>
  );
}
