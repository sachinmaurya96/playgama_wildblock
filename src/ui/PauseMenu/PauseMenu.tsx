import { useState } from 'react';
import { gameRegistry } from '../../game/registry';
import { useGameStore } from '../../stores/gameStore';
import { ACTION_LABELS, keyLabel, useSettingsStore, type Action } from '../../stores/settingsStore';
import { useWorldStore } from '../../stores/worldStore';
import { BUILD_CONTROLS } from '../../data/buildControls';
import { useBuildStore } from '../../stores/buildStore';
import { usePvpStore } from '../../stores/pvpStore';
import { copyInvite } from '../HUD/PvpHud';
import { dmNet } from '../../net/deathmatchNet';
import { useDeathmatchStore } from '../../stores/deathmatchStore';
import { QuickRespawnButton } from './QuickRespawnButton';

export function PauseMenu() {
  const world = useGameStore((s) => s.world);
  const [controls, setControls] = useState(false);
  const [busy, setBusy] = useState(false);
  const day = useWorldStore((s) => s.dayCount);
  const resume = () => gameRegistry.current?.closeOverlay();

  const quit = async () => {
    setBusy(true);
    const saved = await gameRegistry.current?.saveNow('quit');
    if (saved === false) { setBusy(false); return; }
    useGameStore.setState({ overlay: null });
    useGameStore.getState().setScreen('menu');
  };

  if (controls) return <ControlsCard onBack={() => setControls(false)} build={world?.mode === 'build'} />;

  if (world?.mode === 'deathmatch') return <DeathmatchPause resume={resume} />;

  if (world?.mode === 'pvp') return <PvpPause resume={resume} onControls={() => setControls(true)} />;

  if (world?.mode === 'build') return <BuildPause resume={resume} quit={quit} busy={busy} onControls={() => setControls(true)} />;

  return (
    <div className="modal-backdrop">
      <div className="panel pause-panel">
        <button className="close-x" onClick={resume} aria-label="Resume">✕</button>
        <h2 className="panel-title">🍃 Paused</h2>
        <p className="muted">{world?.name} · Day {day}</p>
        <div className="menu-buttons">
          <button className="btn primary" onClick={resume} autoFocus>Resume</button>
          <QuickRespawnButton />
          <button className="btn pvp-btn" onClick={() => useGameStore.getState().setOverlay('settings')}>🎮 Play this world with friends</button>
          <button className="btn" onClick={() => useGameStore.getState().setOverlay('settings')}>Settings</button>
          <button className="btn" onClick={() => setControls(true)}>Controls</button>
          <button className="btn" onClick={() => gameRegistry.current?.openOverlay('journal')}>Journal</button>
          <button className="btn" disabled={busy} onClick={quit}>{busy ? 'Saving…' : 'Save & Quit to Menu'}</button>
        </div>
      </div>
    </div>
  );
}

function PvpPause({ resume, onControls }: { resume: () => void; onControls: () => void }) {
  const code = usePvpStore((s) => s.code);
  const online = usePvpStore((s) => s.online);
  const together = usePvpStore((s) => s.settings.style === 'together');
  const leave = () => {
    useGameStore.setState({ overlay: null });
    useGameStore.getState().setScreen('menu');
  };
  return (
    <div className="modal-backdrop">
      <div className="panel pause-panel">
        <button className="close-x" onClick={resume} aria-label="Back to the game">✕</button>
        <h2 className="panel-title">{together ? '🤝 Build Together' : '⚔️ PvP Battle'}</h2>
        <p className="muted">The game keeps going while this menu is open!</p>
        <div className="pvp-invite">
          <span>Room code</span>
          <b>{code}</b>
          <small className="muted">{online ? 'Friends: PvP Mode → Join with code' : 'Open another tab of this browser → PvP → Join (This device)'}</small>
        </div>
        <div className="menu-buttons">
          <button className="btn primary" onClick={resume} autoFocus>{together ? 'Back to the game' : 'Back to the fight'}</button>
          <QuickRespawnButton />
          <button className="btn" onClick={() => { const g = gameRegistry.current; if (g) { g.player.cameraMode = g.player.cameraMode === 'first' ? 'third' : 'first'; useSettingsStore.getState().update('gameplay', { cameraMode: g.player.cameraMode }); } resume(); }}>👁️ Switch camera (1st / 3rd person)</button>
          <button className="btn" onClick={() => void copyInvite(code)}>📋 Copy invite link</button>
          <button className="btn" onClick={() => { useGameStore.setState({ overlay: null }); usePvpStore.getState().set({ scoreboardOpen: true }); }}>🏆 Scoreboard</button>
          <button className="btn" onClick={() => useGameStore.getState().setOverlay('settings')}>Settings</button>
          <button className="btn" onClick={onControls}>Controls</button>
          <button className="btn" onClick={leave}>Leave match</button>
        </div>
      </div>
    </div>
  );
}

function BuildPause({ resume, quit, busy, onControls }: { resume: () => void; quit: () => void; busy: boolean; onControls: () => void }) {
  const world = useGameStore((s) => s.world);
  const viewKey = useSettingsStore((s) => keyLabel(s.controls.keys.buildView));
  const tutorial = () => {
    try {
      localStorage.setItem('wildblocks.build.v1', JSON.stringify({ ...JSON.parse(localStorage.getItem('wildblocks.build.v1') ?? '{}'), tutorialSeen: false }));
    } catch {
      /* storage unavailable */
    }
    useGameStore.getState().toast('The tutorial will show again next time you open this project.', 'info', '🎓');
  };
  return (
    <div className="modal-backdrop">
      <div className="panel pause-panel">
        <button className="close-x" onClick={resume} aria-label="Keep building">✕</button>
        <h2 className="panel-title">🏡 {world?.name}</h2>
        <p className="muted">Build Home project · autosaves as you build</p>
        <div className="menu-buttons">
          <button className="btn build-home-btn" onClick={resume} autoFocus>Keep building</button>
          <QuickRespawnButton />
          <button className="btn" onClick={() => { gameRegistry.current?.build?.togglePlayerView(); resume(); }}>👁️ Switch first / third person ({viewKey})</button>
          <button className="btn" onClick={() => { useGameStore.getState().setOverlay(null); useBuildStore.getState().set({ walkthrough: false }); gameRegistry.current?.build?.setWalkthrough(true); gameRegistry.current?.input.requestLock(); }}>🚶 Walkthrough</button>
          <button className="btn" onClick={() => { useGameStore.getState().setOverlay(null); gameRegistry.current?.build?.togglePhoto(); }}>📷 Photo mode</button>
          {gameRegistry.current?.pvp ? (
            <button className="btn" onClick={() => void copyInvite(usePvpStore.getState().code)}>📋 Invite friends · {usePvpStore.getState().code}</button>
          ) : (
            <button className="btn pvp-btn" onClick={() => useGameStore.getState().setOverlay('settings')}>🎮 Build this home with friends</button>
          )}
          <button className="btn" onClick={() => useGameStore.getState().setOverlay('settings')}>Settings</button>
          <button className="btn" onClick={onControls}>Controls</button>
          <button className="btn small ghost" onClick={tutorial}>Show the tutorial again</button>
          <button className="btn" disabled={busy} onClick={quit}>{busy ? 'Saving…' : 'Save & Quit to Menu'}</button>
        </div>
      </div>
    </div>
  );
}

export function ControlsCard({ onBack, build = false }: { onBack: () => void; build?: boolean }) {
  const keys = useSettingsStore((s) => s.controls.keys);
  const rows: [string, string][] = build ? BUILD_CONTROLS : [
    ...(['forward', 'back', 'left', 'right', 'jump', 'sprint', 'crouch'] as Action[]).map((a) => [keyLabel(keys[a]), ACTION_LABELS[a]] as [string, string]),
    ['LMB (hold)', 'Break / chop / mine · attack'],
    ['RMB', 'Place · use · eat · till · plant · shoot a bow (hold to repeat)'],
    ['Tab (PvP)', 'Hold for the scoreboard'],
    [`${keyLabel(keys.options)} (PvP)`, 'Quick options: camera, voice, controls'],
    [`${keyLabel(keys.talk)} (PvP)`, 'Voice chat: talk (hold, or tap in open-mic mode)'],
    [`${keyLabel(keys.listen)} (PvP)`, 'Voice chat: listen on / off'],
    ...(['interact', 'inventory', 'journal', 'map', 'camera', 'drop', 'hideHud'] as Action[]).map((a) => [keyLabel(keys[a]), ACTION_LABELS[a]] as [string, string]),
    ['1–9 / wheel', 'Select hotbar slot'],
    ['Esc', 'Pause'],
    ['F3', 'Debug info'],
  ];
  return (
    <div className="modal-backdrop">
      <div className="panel controls-panel">
        <button className="close-x" onClick={onBack} aria-label="Back">✕</button>
        <h2 className="panel-title">⌨️ Controls</h2>
        <div className="controls-list scroll">
          <div className="control-row">
            <span className="kbd">{keyLabel(keys.cursor)}</span>
            <span>{ACTION_LABELS.cursor}</span>
          </div>
          {build && <div className="control-row">
            <span className="kbd">{keyLabel(keys.buildView)}</span>
            <span>{ACTION_LABELS.buildView}</span>
          </div>}
          {rows.map(([k, v]) => (
            <div key={v} className="control-row">
              <span className="kbd">{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>
        <p className="muted">Rebind keys in Settings → Controls.</p>
        <button className="btn primary" onClick={onBack}>Back</button>
      </div>
    </div>
  );
}

/** Deathmatch: the match keeps running while this is open. */
function DeathmatchPause({ resume }: { resume: () => void }) {
  const code = useDeathmatchStore((s) => s.code);
  const isHost = useDeathmatchStore((s) => s.isHost);
  const leave = () => {
    dmNet.leave();
    useGameStore.setState({ overlay: null });
    useGameStore.getState().setScreen('menu');
  };
  return (
    <div className="modal-backdrop">
      <div className="panel pause-panel">
        <button className="close-x" onClick={resume} aria-label="Resume">✕</button>
        <h2 className="panel-title">⚔️ Deathmatch</h2>
        <p className="muted">Room {code} · the match keeps going while you're here!</p>
        <div className="menu-buttons">
          <button className="btn primary" onClick={resume} autoFocus>Back to the fight</button>
          <button className="btn" onClick={() => useGameStore.getState().setOverlay('settings')}>Settings</button>
          <button className="btn danger" onClick={leave}>{isHost ? 'Close room (ends the match for everyone)' : 'Leave room'}</button>
        </div>
      </div>
    </div>
  );
}
