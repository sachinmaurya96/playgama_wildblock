import { useGameStore } from '../../stores/gameStore';
import { MenuBackground } from './MenuBackground';

export function Credits() {
  return (
    <div className="menu-screen">
      <MenuBackground />
      <div className="panel credits-panel">
        <button className="close-x" onClick={() => useGameStore.getState().setScreen('menu')} aria-label="Back">✕</button>
        <h2 className="panel-title">🌟 Credits</h2>
        <p><b>WildBlocks — A Tiny Living World</b></p>
        <p>An original cozy voxel adventure. All block textures, item icons, creature models, sounds and music are generated procedurally in code — no external art or audio assets are used.</p>
        <h3 className="sub-title">Built with</h3>
        <ul>
          <li>three.js (MIT) — 3D rendering</li>
          <li>React &amp; React DOM (MIT) — interface</li>
          <li>@react-three/fiber (MIT) — React renderer for three.js</li>
          <li>zustand (MIT) — state management</li>
          <li>idb (ISC) — IndexedDB saves</li>
          <li>Vite, TypeScript, Vitest — tooling</li>
        </ul>
        <p className="muted">Simplex noise implementation based on Stefan Gustavson’s public-domain algorithm.</p>
        <p>Thank you for playing. Be a good guest in the wilds. 🍃</p>
      </div>
    </div>
  );
}
