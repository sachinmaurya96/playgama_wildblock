import { useEffect, useState } from 'react';
import { TIPS } from '../../data/progression';
import { useGameStore } from '../../stores/gameStore';

/** "Growing your world..." — a spinning miniature island + real progress (no fake bars). */
export function LoadingScreen() {
  const loading = useGameStore((s) => s.loading);
  const world = useGameStore((s) => s.world);
  const [tip, setTip] = useState(loading.tipIndex % TIPS.length);
  useEffect(() => {
    const id = setInterval(() => setTip((t) => (t + 1) % TIPS.length), 4200);
    return () => clearInterval(id);
  }, []);
  const stages = ['Packing backpack', 'Loading terrain', 'Preparing creatures'];
  const pct = Math.round(loading.progress * 100);
  return (
    <div className="loading-screen">
      <div className="mini-island" aria-hidden>
        <div className="island-spin">
          {ISLAND.map(([x, y, z, c], i) => (
            <div key={i} className="vox" style={{ '--x': x, '--y': y, '--z': z, '--c': c } as React.CSSProperties}>
              <span className="f top" />
              <span className="f left" />
              <span className="f right" />
            </div>
          ))}
        </div>
      </div>
      <h1 className="loading-title">Growing your world...</h1>
      {world && <div className="loading-world">“{world.name}”</div>}
      <div className="loading-bar">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="loading-stages">
        {stages.map((s) => {
          const idx = stages.indexOf(loading.stage);
          const me = stages.indexOf(s);
          const state = loading.stage === s ? 'now' : idx > me || loading.progress >= 1 ? 'done' : '';
          return (
            <span key={s} className={`stage ${state}`}>
              {state === 'done' ? '✓' : state === 'now' ? '•' : '○'} {s}
            </span>
          );
        })}
      </div>
      {!stages.includes(loading.stage) && <div className="loading-stage-text">{loading.stage}</div>}
      <p className="loading-tip">💡 {TIPS[tip]}</p>
    </div>
  );
}

// A tiny voxel island: [x, y, z, color]
const ISLAND: [number, number, number, string][] = (() => {
  const out: [number, number, number, string][] = [];
  for (let x = 0; x < 4; x++)
    for (let z = 0; z < 4; z++) {
      out.push([x, 0, z, (x + z) % 3 === 0 ? '#6fa84a' : '#7fb85a']);
      if ((x === 0 || x === 3) && z > 0) out.push([x, -1, z, '#8a6a44']);
    }
  out.push([1, 1, 1, '#6b4a2b'], [1, 2, 1, '#6b4a2b'], [1, 3, 1, '#4f8a3a'], [0, 3, 1, '#4f8a3a'], [2, 3, 1, '#4f8a3a'], [1, 3, 0, '#4f8a3a'], [1, 3, 2, '#4f8a3a'], [1, 4, 1, '#5f9a45']);
  out.push([3, 1, 3, '#3f86b8'], [2, 1, 3, '#3f86b8'], [3, 1, 2, '#b0804a'], [3, 2, 2, '#d8b45a']);
  return out.sort((a, b) => a[1] - b[1] || a[0] + a[2] - (b[0] + b[2]));
})();
