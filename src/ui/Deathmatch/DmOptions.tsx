import { useState } from 'react';
import { touchEnabled } from '../../app/mobile';
import { gameRegistry } from '../../game/registry';
import { dmInviteUrl, dmNet } from '../../net/deathmatchNet';
import { useDeathmatchStore } from '../../stores/deathmatchStore';
import { useGameStore } from '../../stores/gameStore';
import { keyLabel, useSettingsStore } from '../../stores/settingsStore';
import { GyroRow } from '../HUD/PvpHud';
import { VoicePanel } from '../Voice/VoiceControls';

/**
 * Deathmatch ⚙️ options (O on desktop, ⚙️ on touch): camera, gyro, voice
 * (who you hear / who hears you), controls, scoreboard, invite, settings and
 * leave. The match keeps running while it's open. No respawn / teleport /
 * coordinates here — those would break a fair fight.
 */
export function DmOptions() {
  const code = useDeathmatchStore((s) => s.code);
  const isHost = useDeathmatchStore((s) => s.isHost);
  const keys = useSettingsStore((s) => s.controls.keys);
  const camera = useSettingsStore((s) => s.gameplay.cameraMode);
  const touch = touchEnabled(useSettingsStore((s) => s.controls.touch));
  const [help, setHelp] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [copied, setCopied] = useState(false);
  const close = () => gameRegistry.current?.setDmOptions(false);
  const setCamera = (mode: 'first' | 'third') => {
    const g = gameRegistry.current;
    if (g) g.player.cameraMode = mode;
    useSettingsStore.getState().update('gameplay', { cameraMode: mode });
  };
  const invite = async () => {
    const url = dmInviteUrl(code);
    try {
      if (navigator.share && touch) await navigator.share({ title: 'WildBlocks Deathmatch', text: `Join my Deathmatch room: ${code}`, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* cancelled */
    }
  };
  const leave = () => {
    if (!confirmExit) return setConfirmExit(true);
    dmNet.leave();
    useGameStore.setState({ overlay: null });
    useGameStore.getState().setScreen('menu');
  };
  return (
    <div className="gear-panel panel dm-options" onPointerDown={(e) => e.stopPropagation()}>
      <div className="gear-head">
        <b>⚙️ Options{!touch && <small className="muted"> · {keyLabel(keys.options)} / Esc to close</small>}</b>
        <button className="gear-x" onClick={close} aria-label="Close options">✕</button>
      </div>
      <div className="gear-row">
        <span>👁️ Camera</span>
        <div className="seg">
          <button className={`seg-btn ${camera === 'first' ? 'active' : ''}`} onClick={() => setCamera('first')}>1st person</button>
          <button className={`seg-btn ${camera === 'third' ? 'active' : ''}`} onClick={() => setCamera('third')}>3rd person</button>
        </div>
      </div>
      {touch && <GyroRow />}
      <VoicePanel />
      <button className="btn small" onClick={() => setHelp(!help)}>🎮 Controls</button>
      {help && (
        <div className="gear-help">
          {touch ? (
            <>
              <div><b>Left stick</b> move · push to the rim to sprint · <b>drag right side</b> look</div>
              <div><b>🔥</b> fire — slide the finger to aim while firing · <b>🎯</b> aim / scope · <b>R</b> reload</div>
              <div><b>⇄</b> switch weapon · <b>✋</b> pick up · <b>🩹</b> medkit · <b>⤒</b> jump · <b>⤓</b> crouch</div>
              <div><b>🎤</b> talk · <b>🎧</b> listen · <b>🏆</b> scores · <b>⚙️</b> this menu</div>
            </>
          ) : (
            <>
              <div><b>WASD</b> move · <b>Shift</b> sprint · <b>Space</b> jump · <b>Ctrl</b> crouch</div>
              <div><b>Left click</b> / <b>F</b> fire · <b>Right click</b> aim / scope · <b>R</b> reload · <b>1–3</b> / wheel weapons · <b>Q</b> last weapon</div>
              <div><b>E</b> pick up · <b>4</b> / <b>5</b> medkits · <b>Tab</b> scores · <b>{keyLabel(keys.camera)}</b> camera</div>
              <div><b>{keyLabel(keys.talk)}</b> talk · <b>{keyLabel(keys.listen)}</b> listen · <b>{keyLabel(keys.options)}</b> this menu · <b>Esc</b> pause</div>
              <div><b>{keyLabel(keys.cursor)}</b> free cursor / return to mouse-look</div>
            </>
          )}
        </div>
      )}
      <button className="btn small" onClick={() => { close(); useDeathmatchStore.getState().set({ scoreboardOpen: true }); }}>🏆 Players & scores</button>
      <button className="btn small" onClick={() => void invite()}>{copied ? '✓ Invite link copied' : '📋 Invite friends'}</button>
      <button className="btn small" onClick={() => { close(); gameRegistry.current?.openOverlay('settings'); }}>⚙️ Settings (sound, graphics…)</button>
      <button className={`btn small ${confirmExit ? 'danger' : ''}`} onClick={leave}>
        {confirmExit ? (isHost ? 'Tap again — ends the match for everyone' : 'Tap again to leave') : isHost ? '🚪 Close room' : '🚪 Leave match'}
      </button>
      <button className="btn small primary" onClick={close}>Resume</button>
    </div>
  );
}
