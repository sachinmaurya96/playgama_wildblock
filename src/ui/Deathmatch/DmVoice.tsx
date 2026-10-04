import { touchEnabled } from '../../app/mobile';
import { dmNet } from '../../net/deathmatchNet';
import { useDeathmatchStore } from '../../stores/deathmatchStore';
import { usePvpStore } from '../../stores/pvpStore';
import { keyLabel, useSettingsStore } from '../../stores/settingsStore';

/**
 * Team voice: 🎧 listen to your teammates (on by default, no mic needed) and
 * 🎤 hold to talk (or tap to toggle in open-mic mode). Shown in the lobby and
 * in the match. The voice mesh itself lives in net/deathmatchNet.ts.
 */
export function DmVoice() {
  const listen = usePvpStore((s) => s.voiceListen);
  const micOn = usePvpStore((s) => s.voiceMicOn);
  const mode = usePvpStore((s) => s.voiceMode);
  const talking = usePvpStore((s) => s.voiceTalking);
  const speaking = usePvpStore((s) => s.voiceSpeaking);
  const peers = usePvpStore((s) => s.voicePeers);
  const error = usePvpStore((s) => s.voiceError);
  const players = useDeathmatchStore((s) => s.lobby?.players ?? []);
  const selfId = useDeathmatchStore((s) => s.selfId);
  const keys = useSettingsStore((s) => s.controls.keys);
  const touch = touchEnabled(useSettingsStore((s) => s.controls.touch));
  const voice = () => dmNet.current?.voice;
  const me = players.find((p) => p.id === selfId);
  const mates = players.filter((p) => p.id !== selfId && p.team === me?.team);
  const live = mates.filter((p) => speaking.includes(p.id));
  const hold = (v: boolean) => (e: React.PointerEvent) => {
    e.stopPropagation();
    voice()?.setPush('button', v);
    try {
      if (v) (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* pointer already gone */
    }
  };
  // taps use click (a real "user gesture" on iPhone / iPad) so audio is allowed to start
  const talkProps = mode === 'push'
    ? { onPointerDown: hold(true), onPointerUp: hold(false), onPointerCancel: hold(false), onLostPointerCapture: hold(false), onClick: () => voice()?.unlockAudio() }
    : { onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onClick: () => void voice()?.toggleTalk() };
  const talkLabel = talking ? 'Talking' : mode === 'push' ? 'Hold to talk' : micOn ? 'Mic on' : 'Mic off';
  if (!dmNet.current?.voice) return null;
  return (
    <div className="voice-dock dm-voice" onPointerDown={(e) => e.stopPropagation()}>
      {live.length > 0 && (
        <div className="voice-speakers">
          {live.map((p) => <span key={p.id} className={`voice-chip dm-vchip ${p.team}`}>🔊 {p.name}</span>)}
        </div>
      )}
      <div className="voice-btns">
        <button
          type="button"
          className={`vbtn listen ${listen ? 'on' : 'off'}`}
          aria-pressed={listen}
          title={`Listen to your team (${keyLabel(keys.listen)})`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => void voice()?.toggleListen()}
        >
          <span className="vicon">{listen ? '🎧' : '🔕'}</span>
          <small>{listen ? 'Team' : 'Listen'}{!touch && <kbd>{keyLabel(keys.listen)}</kbd>}</small>
        </button>
        <button
          type="button"
          className={`vbtn talk ${talking ? 'live' : micOn ? 'on' : ''}`}
          aria-pressed={talking}
          title={`${mode === 'push' ? 'Hold to talk to your team' : 'Tap to turn your mic on / off'} (${keyLabel(keys.talk)})`}
          {...talkProps}
        >
          <span className="vicon">{talking || micOn ? '🎙️' : '🎤'}</span>
          <small>{talkLabel}{!touch && <kbd>{keyLabel(keys.talk)}</kbd>}</small>
        </button>
      </div>
      {mates.length > 0 && <small className="dm-vpeers">{mates.filter((p) => peers.includes(p.id)).length}/{mates.length} teammates in voice</small>}
      {error && <small className="dm-verror">{error}</small>}
    </div>
  );
}
