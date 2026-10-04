import { useEffect, useState } from 'react';
import { launchWorld } from '../../app/launch';
import { audio } from '../../game/core/audio';
import { listWorlds, storageIsPersistent } from '../../persistence/SaveManager';
import type { WorldMeta } from '../../persistence/types';
import { useGameStore } from '../../stores/gameStore';
import { MenuBackground } from './MenuBackground';
import { BuildHomePreview } from './BuildHomePreview';

export function Logo() {
  return (
    <div className="logo">
      <div className="logo-word">
        {'WildBlocks'.split('').map((ch, i) => (
          <span key={i} style={{ animationDelay: `${i * 0.08}s` }} className={i < 4 ? 'w' : 'b'}>{ch}</span>
        ))}
      </div>
      <div className="logo-sub">A Tiny Living World</div>
    </div>
  );
}

export function MainMenu() {
  const [last, setLast] = useState<WorldMeta | null>(null);
  const [persistent, setPersistent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const go = (s: Parameters<ReturnType<typeof useGameStore.getState>['setScreen']>[0]) => {
    audio.init();
    audio.play('click');
    if (s === 'settings') useGameStore.getState().openSettings('menu');
    else useGameStore.getState().setScreen(s);
  };
  useEffect(() => {
    void listWorlds().then((w) => setLast(w[0] ?? null));
    void storageIsPersistent().then(setPersistent);
  }, []);
  return (
    <div className="menu-screen main-menu">
      <MenuBackground />
      <BuildHomePreview visible={preview} />
      <div className="menu-column">
        <Logo />
        <div className="menu-buttons">
          {last && (
            <button
              className="btn primary big"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                audio.init();
                await launchWorld(last.id);
              }}
            >
              ▶ Continue <small>“{last.name}”{last.mode === 'build' ? ' · Build Home' : ''}</small>
            </button>
          )}
          <button className={`btn primary ${last ? '' : 'big'} new-world-btn`} onClick={() => go('newWorld')}>🌱 New World</button>
          <button
            className="btn big build-home-btn"
            onMouseEnter={() => setPreview(true)}
            onMouseLeave={() => setPreview(false)}
            onFocus={() => setPreview(true)}
            onBlur={() => setPreview(false)}
            onClick={() => go('newBuild')}
          >
            🏡 Build Home <small>design your dream house</small>
          </button>
          <button className="btn pvp-btn" onClick={() => go('pvp')}>🎮 PvP Mode <small>battle or build with friends</small></button>
          <button className="btn dm-btn" onClick={() => go('deathmatch')}>⚔️ Deathmatch — Team Battle <small>Join Red or Blue. Collect weapons. Win the battle.</small></button>
          <button className="btn" onClick={() => go('worlds')}>🗺️ Worlds</button>
          <button className="btn" onClick={() => go('settings')}>⚙️ Settings</button>
          <button className="btn" onClick={() => go('howto')}>📖 How to Play</button>
          <button className="btn ghost" onClick={() => go('credits')}>Credits</button>
        </div>
        {!persistent && <p className="storage-warn">Your browser is blocking storage here — worlds won’t be saved after you close the tab.</p>}
      </div>
      <div className="version">v1.3.0 · made with three.js &amp; React</div>
    </div>
  );
}
