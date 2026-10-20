import { useEffect, useId, useState } from 'react';
import { isTouchDevice, touchEnabled } from '../../app/mobile';
import { guideControls } from '../../data/playerGuide';
import { useBuildStore } from '../../stores/buildStore';
import { useDeathmatchStore } from '../../stores/deathmatchStore';
import { useGameStore } from '../../stores/gameStore';
import { usePvpStore } from '../../stores/pvpStore';
import { ACTION_LABELS, keyLabel, useSettingsStore } from '../../stores/settingsStore';
import '../../styles/shortcuts.css';

/** A mode-aware desktop reference; shares the guide's controls and saved bindings. */
export function DesktopShortcuts() {
  const listId = useId();
  const [collapsed, setCollapsed] = useState(false);
  const [locked, setLocked] = useState(() => typeof document !== 'undefined' && !!document.pointerLockElement);
  const mode = useGameStore((s) => s.world?.mode ?? 'survival');
  const overlay = useGameStore((s) => s.overlay);
  const hidden = useGameStore((s) => s.hudHidden);
  const keys = useSettingsStore((s) => s.controls.keys);
  const touch = useSettingsStore((s) => s.controls.touch);
  const photo = useBuildStore((s) => s.photo);
  const buildCollapsed = useBuildStore((s) => s.hintsCollapsed);
  const shared = usePvpStore((s) => s.active);
  const pvpOptions = usePvpStore((s) => s.gearOpen);
  const pvpScores = usePvpStore((s) => s.scoreboardOpen);
  const dmOptions = useDeathmatchStore((s) => s.optionsOpen);
  const dmScores = useDeathmatchStore((s) => s.scoreboardOpen);
  const dmPhase = useDeathmatchStore((s) => s.phase);

  useEffect(() => {
    const update = () => setLocked(!!document.pointerLockElement);
    document.addEventListener('pointerlockchange', update);
    update();
    return () => document.removeEventListener('pointerlockchange', update);
  }, []);

  if (isTouchDevice() || touchEnabled(touch) || hidden || overlay !== null
    || (mode === 'build' && photo)
    || (shared && (pvpOptions || pvpScores))
    || (mode === 'deathmatch' && (dmOptions || dmScores || dmPhase === 'ended'))) return null;

  const isBuild = mode === 'build';
  const isCollapsed = isBuild ? buildCollapsed : collapsed;
  const label = isBuild ? 'Build Home' : mode === 'deathmatch' ? 'Deathmatch' : mode === 'pvp' ? 'Survival & PvP' : 'Survival';
  const controls = guideControls(mode, keys).map(([key, action]): [string, string] => [
    key, action === ACTION_LABELS.buildView ? 'First / third person' : action,
  ]);
  if (!isBuild) {
    // Keep movement on one row so the first commands are easy to scan.
    controls.splice(0, 4, [
      [keys.forward, keys.left, keys.back, keys.right].map(keyLabel).join(' · '), 'Move',
    ]);
    controls.unshift(['Mouse', 'Look around']);
  }
  if (isBuild || mode === 'deathmatch') {
    controls.push([keyLabel(keys.hideHud), 'Hide / show HUD'], ['F3', 'Debug statistics']);
  }

  return (
    <aside
      className={`desktop-shortcuts desktop-shortcuts--${mode}${shared || mode === 'pvp' || mode === 'deathmatch' ? ' desktop-shortcuts--shared' : ''}${locked ? ' is-locked' : ''}`}
      aria-label={`${label} desktop shortcuts`}
    >
      <button
        type="button"
        className="desktop-shortcuts-toggle"
        aria-expanded={!isCollapsed}
        aria-controls={listId}
        onClick={() => isBuild ? useBuildStore.getState().set({ hintsCollapsed: !buildCollapsed }) : setCollapsed(!collapsed)}
      >
        <span className="desktop-shortcuts-title"><span aria-hidden="true">⌨</span> Desktop controls</span>
        <span aria-hidden="true">{isCollapsed ? '+' : '−'}</span>
      </button>
      {!isCollapsed && (
        <>
          <div className="desktop-shortcuts-mode">{label} · Keyboard & mouse</div>
          <div className="desktop-shortcuts-list" id={listId} tabIndex={locked ? -1 : 0} role="region" aria-label="Keyboard and mouse shortcuts">
            <dl>
              {controls.map(([key, action], index) => (
                <div className="desktop-shortcuts-row" key={`${key}-${index}`}>
                  <dt><kbd>{key}</kbd></dt>
                  <dd>{action}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="desktop-shortcuts-footer"><kbd>{keyLabel(keys.cursor)}</kbd> Free cursor to scroll{isBuild ? ' · H hide' : ''}</div>
        </>
      )}
    </aside>
  );
}
