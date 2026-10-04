import { touchEnabled } from '../../app/mobile';
import { voiceService } from '../../net/voice';
import { keyLabel, useSettingsStore } from '../../stores/settingsStore';
import { useVoiceStore, type VoiceRosterEntry } from '../../stores/voiceStore';

/**
 * Voice chat controls, shared by every multiplayer mode (PvP, Build together,
 * Build Home with friends, Deathmatch). They drive whichever room's voice is
 * running (`voiceService.current`) and read the shared voice store, so every
 * mode gets the same 🎧 / 🎤 buttons and the same ⚙️ voice settings.
 */
const voice = () => voiceService.current;

function useTouch(): boolean {
  return touchEnabled(useSettingsStore((s) => s.controls.touch));
}

const teamColor = (p: VoiceRosterEntry) => (p.team === 'red' ? '#ff6a5a' : p.team === 'blue' ? '#5aa0ff' : p.color);

/**
 * On-screen voice buttons: 🎧 listen (tap on / off) and 🎤 talk (hold, or tap to toggle in open-mic mode),
 * plus who is speaking right now. `keys` = show the keyboard shortcut caps (off where those keys do other things).
 */
export function VoiceDock({ className = '', keys: showKeys = true }: { className?: string; keys?: boolean }) {
  const listen = useVoiceStore((s) => s.listen);
  const micOn = useVoiceStore((s) => s.micOn);
  const mode = useVoiceStore((s) => s.mode);
  const talking = useVoiceStore((s) => s.talking);
  const speaking = useVoiceStore((s) => s.speaking);
  const roster = useVoiceStore((s) => s.roster);
  const selfId = useVoiceStore((s) => s.selfId);
  const talkScope = useVoiceStore((s) => s.talkScope);
  const error = useVoiceStore((s) => s.error);
  const keys = useSettingsStore((s) => s.controls.keys);
  const touch = useTouch();
  const kbd = !touch && showKeys;
  const others = roster.filter((p) => p.id !== selfId && speaking.includes(p.id)).slice(0, 4);
  const hold = (v: boolean) => (e: React.PointerEvent) => {
    e.stopPropagation();
    voice()?.setPush('button', v);
    try {
      if (v) (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* pointer already gone: release still arrives via pointerup / cancel */
    }
  };
  // taps use click (a real "user gesture" on iPhone / iPad, unlike pointerdown) so audio is allowed to start
  const talkProps = mode === 'push'
    ? { onPointerDown: hold(true), onPointerUp: hold(false), onPointerCancel: hold(false), onLostPointerCapture: hold(false), onClick: () => voice()?.unlockAudio() }
    : { onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onClick: () => void voice()?.toggleTalk() };
  const to = talkScope === 'team' ? ' · team' : talkScope === 'all' ? ' · all' : '';
  const talkLabel = (talking ? 'Talking' : mode === 'push' ? 'Hold to talk' : micOn ? 'Mic on' : 'Mic off') + to;
  return (
    <div className={`voice-dock ${className}`} onPointerDown={(e) => e.stopPropagation()}>
      {others.length > 0 && (
        <div className="voice-speakers">
          {others.map((p) => (
            <span key={p.id} className="voice-chip" style={{ borderColor: teamColor(p) }}>🔊 {p.name}</span>
          ))}
        </div>
      )}
      <div className="voice-btns">
        <button
          type="button"
          className={`vbtn listen ${listen ? 'on' : 'off'}`}
          aria-label={listen ? 'Stop listening to voice chat' : 'Listen to voice chat'}
          aria-pressed={listen}
          title={`Listen to the other players (${keyLabel(keys.listen)})`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => void voice()?.toggleListen()}
        >
          <span className="vicon">{listen ? '🎧' : '🔕'}</span>
          <small>{listen ? 'Listening' : 'Listen'}{kbd && <kbd>{keyLabel(keys.listen)}</kbd>}</small>
        </button>
        <button
          type="button"
          className={`vbtn talk ${talking ? 'live' : micOn ? 'on' : ''}`}
          aria-label={mode === 'push' ? 'Hold to talk' : micOn ? 'Turn microphone off' : 'Turn microphone on'}
          aria-pressed={talking}
          title={`${mode === 'push' ? 'Hold to talk' : 'Tap to turn your mic on / off'} (${keyLabel(keys.talk)})`}
          {...talkProps}
        >
          <span className="vicon">{talking || micOn ? '🎙️' : '🎤'}</span>
          <small>{talkLabel}{kbd && <kbd>{keyLabel(keys.talk)}</kbd>}</small>
        </button>
      </div>
      {error && <small className="voice-err dock">{error}</small>}
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button key={v} type="button" className={`seg-btn ${value === v ? 'active' : ''}`} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

/**
 * Voice section of a ⚙️ options panel: listen / talk, talk style, who you hear and who hears you
 * (team modes), nearby-louder (open-world modes), per-player mute, leave voice.
 */
export function VoicePanel({ keys: showKeys = true }: { keys?: boolean }) {
  const on = useVoiceStore((s) => s.on);
  const listen = useVoiceStore((s) => s.listen);
  const micReady = useVoiceStore((s) => s.micReady);
  const mode = useVoiceStore((s) => s.mode);
  const prox = useVoiceStore((s) => s.proximity);
  const proxAllowed = useVoiceStore((s) => s.proximityAllowed);
  const hearScope = useVoiceStore((s) => s.hearScope);
  const talkScope = useVoiceStore((s) => s.talkScope);
  const peers = useVoiceStore((s) => s.peers);
  const deaf = useVoiceStore((s) => s.deaf);
  const muted = useVoiceStore((s) => s.muted);
  const speaking = useVoiceStore((s) => s.speaking);
  const err = useVoiceStore((s) => s.error);
  const roster = useVoiceStore((s) => s.roster);
  const selfId = useVoiceStore((s) => s.selfId);
  const keys = useSettingsStore((s) => s.controls.keys);
  const touch = useTouch();
  const me = roster.find((p) => p.id === selfId);
  if (!voice()) return null;
  return (
    <div className="voice-panel">
      <div className="gear-row">
        <span>🎧 Listen</span>
        <Seg value={listen ? 'on' : 'off'} options={[['off', 'Off'], ['on', 'On']]} onChange={(v) => void voice()?.setListen(v === 'on')} />
      </div>
      {hearScope && (
        <div className="gear-row sub">
          <span>Hear</span>
          <Seg value={hearScope} options={[['team', 'My team'], ['all', 'All players']]} onChange={(v) => voice()?.setHearScope(v)} />
        </div>
      )}
      <div className="gear-row">
        <span>🎤 Talk</span>
        <Seg value={mode} options={[['push', 'Hold to talk'], ['open', 'Tap on / off']]} onChange={(v) => voice()?.setMode(v)} />
      </div>
      {talkScope && (
        <div className="gear-row sub">
          <span>Talk to</span>
          <Seg value={talkScope} options={[['team', 'My team'], ['all', 'All players']]} onChange={(v) => voice()?.setTalkScope(v)} />
        </div>
      )}
      <small className="muted">
        {touch || !showKeys ? 'Use the 🎤 and 🎧 buttons on the left of the screen.' : `Keys: ${keyLabel(keys.talk)} talk · ${keyLabel(keys.listen)} listen.`}{' '}
        {mode === 'push' ? 'Hold 🎤 while you speak.' : 'Tap 🎤 to open / close your mic.'}
        {talkScope && (talkScope === 'team' ? ' Only your team hears you.' : ' Everyone, including the other team, hears you.')}
      </small>
      {on && proxAllowed && (
        <div className="gear-row sub">
          <span>Hear</span>
          <Seg value={prox ? 'near' : 'all'} options={[['near', 'Nearby louder'], ['all', 'Everyone']]} onChange={(v) => voice()?.setProximity(v === 'near')} />
        </div>
      )}
      {err && <small className="voice-err">{err}</small>}
      {on && (
        <div className="voice-list">
          {roster.filter((p) => p.id !== selfId && peers.includes(p.id)).map((p) => {
            const mate = !!p.team && p.team === me?.team;
            return (
              <div key={p.id} className={`voice-row ${speaking.includes(p.id) ? 'speaking' : ''}`}>
                <span className="dot" style={{ background: teamColor(p) }} />
                <span className="vname">
                  {p.name}
                  {p.team && <small className="muted"> · {mate ? 'team' : 'opponent'}</small>}
                  {deaf.includes(p.id) ? ' · 🔕 not listening' : ''}
                </span>
                <button type="button" className="btn small" onClick={() => voice()?.toggleMute(p.id)}>{muted.includes(p.id) ? '🔇 Unmute' : '🔊 Mute'}</button>
              </div>
            );
          })}
          {!peers.length && <small className="muted">No one else is in voice yet — ask friends to tap 🎧 or 🎤.</small>}
        </div>
      )}
      {micReady && <button type="button" className="btn small" onClick={() => voice()?.releaseMic()}>🎙️ Stop using the microphone</button>}
      {on && <button type="button" className="btn small" onClick={() => { voice()?.releaseMic(); void voice()?.setListen(false); }}>Leave voice chat</button>}
      {!on && <small className="muted">Listening is off. Tap 🎧 to hear the room again. Only people in this room can hear you; your mic is used only while you talk.</small>}
    </div>
  );
}
