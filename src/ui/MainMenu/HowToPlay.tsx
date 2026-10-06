import { useState } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { MenuBackground } from './MenuBackground';
import { PLAYER_GUIDE, guideControls } from '../../data/playerGuide';

export function HowToPlay() {
  const [topic, setTopic] = useState('start');
  const [query, setQuery] = useState('');
  const keys = useSettingsStore((s) => s.controls.keys);
  const search = query.trim().toLowerCase();
  const sections = PLAYER_GUIDE.filter((s) => search || s.id === topic)
    .map((s) => ({ ...s, cards: s.cards.filter((c) => !search || `${s.title} ${c.title} ${c.text}`.toLowerCase().includes(search)) }))
    .filter((s) => s.cards.length);
  const controlsTopic = ['build', 'deathmatch', 'pvp'].includes(topic) ? topic : 'survival';

  return (
    <div className="menu-screen">
      <MenuBackground />
      <div className="panel howto-panel">
        <button className="close-x" onClick={() => useGameStore.getState().setScreen('menu')} aria-label="Back">✕</button>
        <h2 className="panel-title">📖 How to Play</h2>
        <p className="muted howto-intro">Choose a topic, or search the whole guide. Controls include your saved bindings and fixed tool shortcuts.</p>
        <input className="search" type="search" aria-label="Search the player guide" placeholder="Search farming, saves, touch, lag…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <nav className="tabs howto-topics" aria-label="Guide topics">
          {PLAYER_GUIDE.map((s) => <button key={s.id} className={`tab ${topic === s.id && !search ? 'active' : ''}`} aria-pressed={topic === s.id && !search} onClick={() => { setTopic(s.id); setQuery(''); }}>{s.title}</button>)}
        </nav>
        <div className="howto-content" aria-live="polite">
          {sections.map((s) => <section key={s.id} aria-labelledby={`guide-${s.id}`}>
            <h3 className="sub-title" id={`guide-${s.id}`}>{s.title}</h3>
            <div className="howto-grid">
              {s.cards.map((c) => <article key={c.title} className="howto-card">
                <div className="howto-icon" aria-hidden="true">{c.icon}</div>
                <b>{c.title}</b>
                <p>{c.text}</p>
              </article>)}
            </div>
          </section>)}
          {sections.length === 0 && <p className="muted">No guide entries match. Try a shorter search or choose a topic.</p>}
        </div>
        {!search && <details key={controlsTopic} className="howto-controls">
          <summary>{controlsTopic === 'build' ? 'Build Home' : controlsTopic === 'deathmatch' ? 'Deathmatch' : controlsTopic === 'pvp' ? 'Survival & PvP' : 'Survival'} keyboard & mouse controls</summary>
          <div className="controls-list">
            {guideControls(controlsTopic, keys).map(([key, action], i) => <div key={`${key}-${i}`} className="control-row"><span className="kbd">{key}</span><span>{action}</span></div>)}
          </div>
          <p className="muted">Change supported bindings in Settings → Controls. Build tools and Deathmatch weapon shortcuts have fixed keys. For on-screen controls, choose Devices & smooth play.</p>
        </details>}
      </div>
    </div>
  );
}
