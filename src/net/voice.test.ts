import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audio } from '../game/core/audio';
import { useVoiceStore } from '../stores/voiceStore';
import { FakeAudioContext } from '../test/audioMocks';
import type { NetMsg } from './transport';
import { VoiceChat } from './voice';

class FakeTrack {
  kind = 'audio';
  enabled = false;
  readyState = 'live';
  onended: (() => void) | null = null;
  stop = vi.fn(() => { this.readyState = 'ended'; });
}
class FakeStream {
  constructor(readonly track = new FakeTrack()) {}
  getAudioTracks() { return [this.track]; }
  getTracks() { return [this.track]; }
}
class FakeSender {
  constructor(public track: FakeTrack | null) {}
  replaceTrack = vi.fn(async (track: FakeTrack | null) => { this.track = track; });
}
class FakePc {
  static instances: FakePc[] = [];
  connectionState = 'new';
  signalingState = 'stable';
  remoteDescription: RTCSessionDescriptionInit | null = null;
  onconnectionstatechange: (() => void) | null = null;
  onicecandidate: ((event: unknown) => void) | null = null;
  ontrack: ((event: unknown) => void) | null = null;
  transceivers: { sender: FakeSender; receiver: { track: { kind: string } }; direction: string }[] = [];
  constructor() { FakePc.instances.push(this); }
  setState(state: string) { this.connectionState = state; this.onconnectionstatechange?.(); }
  addTransceiver = vi.fn((track: FakeTrack | string) => {
    const tr = { sender: new FakeSender(typeof track === 'string' ? null : track), receiver: { track: { kind: 'audio' } }, direction: 'sendrecv' };
    this.transceivers.push(tr);
    return tr;
  });
  getTransceivers() { return this.transceivers; }
  createOffer = vi.fn(async () => ({ type: 'offer', sdp: 'offer' }));
  createAnswer = vi.fn(async () => ({ type: 'answer', sdp: 'answer' }));
  setLocalDescription = vi.fn(async (sdp: RTCSessionDescriptionInit) => {
    this.signalingState = sdp.type === 'offer' ? 'have-local-offer' : 'stable';
  });
  setRemoteDescription = vi.fn(async (sdp: RTCSessionDescriptionInit) => {
    this.remoteDescription = sdp;
    if (sdp.type === 'offer' && !this.transceivers.length) this.addTransceiver('audio');
    this.signalingState = sdp.type === 'offer' ? 'have-remote-offer' : 'stable';
  });
  addIceCandidate = vi.fn(async (_candidate: RTCIceCandidateInit) => {});
  close = vi.fn(() => { this.setState('closed'); });
}
class FakeAudioElement {
  paused = true;
  srcObject: unknown = null;
  setAttribute = vi.fn();
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
}

const here = { x: 0, y: 42, z: 0, fx: 0, fy: 0, fz: -1 };
const offer = { t: 'v', id: 'a', kind: 'offer', call: 'a:1', sdp: { type: 'offer', sdp: 'offer' } };
let voices: VoiceChat[];
let getUserMedia: ReturnType<typeof vi.fn>;
let events: EventTarget;
let mic: FakeStream;

async function flush() { for (let i = 0; i < 15; i++) await Promise.resolve(); }
function setup(id = 'a') {
  const sent: NetMsg[] = [];
  const voice = new VoiceChat(id, (msg) => sent.push(msg));
  voices.push(voice);
  voice.autoStart();
  return { voice, sent };
}

beforeEach(() => {
  voices = [];
  vi.useFakeTimers();
  FakePc.instances = [];
  FakeAudioContext.instances = [];
  events = new EventTarget();
  vi.stubGlobal('window', Object.assign(events, { AudioContext: FakeAudioContext, isSecureContext: true }));
  vi.stubGlobal('RTCPeerConnection', FakePc);
  vi.stubGlobal('Audio', FakeAudioElement);
  const prefs = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => prefs.get(key) ?? null, setItem: (key: string, value: string) => prefs.set(key, value) });
  mic = new FakeStream();
  getUserMedia = vi.fn(async () => mic as unknown as MediaStream);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.spyOn(audio, 'init').mockImplementation(() => {});
  useVoiceStore.getState().reset();
});
afterEach(() => {
  for (const v of voices) v.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('voice controls and microphone lifecycle', () => {
  it('listens automatically without requesting the microphone', () => {
    const { voice } = setup();
    expect(voice.listen).toBe(true);
    expect(voice.on).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('never transmits a released first push while microphone permission is pending', async () => {
    let allow!: (stream: MediaStream) => void;
    getUserMedia.mockReturnValueOnce(new Promise<MediaStream>((r) => { allow = r; }));
    const { voice } = setup();
    voice.setPush('button', true);
    voice.setPush('button', false);
    allow(mic as unknown as MediaStream);
    await flush();
    expect(mic.track.enabled).toBe(false);
    expect(voice.transmitting()).toBe(false);
    voice.setPush('key', true);
    expect(mic.track.enabled).toBe(true);
    voice.setPush('key', false);
    expect(mic.track.enabled).toBe(false);
  });

  it('cancels a pending open-mic toggle on the second tap', async () => {
    let allow!: (stream: MediaStream) => void;
    getUserMedia.mockReturnValueOnce(new Promise<MediaStream>((r) => { allow = r; }));
    const { voice } = setup();
    voice.setMode('open');
    const first = voice.toggleTalk();
    await voice.toggleTalk();
    allow(mic as unknown as MediaStream);
    await first;
    expect(voice.micOn).toBe(false);
    expect(mic.track.enabled).toBe(false);
  });

  it('does not reactivate a microphone after release during the permission prompt', async () => {
    let allow!: (stream: MediaStream) => void;
    getUserMedia.mockReturnValueOnce(new Promise<MediaStream>((r) => { allow = r; }));
    const { voice } = setup();
    voice.setMode('open');
    const talking = voice.toggleTalk();
    voice.releaseMic();
    allow(mic as unknown as MediaStream);
    await talking;
    expect(mic.track.stop).toHaveBeenCalled();
    expect(useVoiceStore.getState().micReady).toBe(false);
    expect(voice.listen).toBe(true);
  });

  it('ignores old permission results after leaving and immediately rejoining voice', async () => {
    let allowOld!: (stream: MediaStream) => void;
    getUserMedia.mockReturnValueOnce(new Promise<MediaStream>((r) => { allowOld = r; }));
    const { voice } = setup();
    voice.setMode('open');
    const oldRequest = voice.toggleTalk();
    voice.disable();
    const freshMic = new FakeStream();
    getUserMedia.mockResolvedValueOnce(freshMic as unknown as MediaStream);
    await voice.toggleTalk();
    allowOld(mic as unknown as MediaStream);
    await oldRequest;
    expect(mic.track.stop).toHaveBeenCalled();
    expect(freshMic.track.enabled).toBe(true);
    expect(voice.micOn).toBe(true);
  });

  it('keeps listening when microphone permission is denied and lets the next tap retry', async () => {
    const { voice } = setup();
    voice.setMode('open');
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    await voice.toggleTalk();
    expect(voice.listen).toBe(true);
    expect(useVoiceStore.getState().error).toContain('Microphone blocked');
    await voice.toggleTalk();
    expect(mic.track.enabled).toBe(true);
    expect(useVoiceStore.getState().error).toBeNull();
  });

  it('releases a lost microphone and acquires the replacement on the next talk', async () => {
    const { voice } = setup();
    voice.setMode('open');
    await voice.toggleTalk();
    mic.track.onended?.();
    expect(useVoiceStore.getState().micReady).toBe(false);
    expect(useVoiceStore.getState().error).toContain('disconnected');
    const replacement = new FakeStream();
    getUserMedia.mockResolvedValueOnce(replacement as unknown as MediaStream);
    await voice.toggleTalk();
    expect(replacement.track.enabled).toBe(true);
  });

  it('clears push-to-talk when focus is lost', async () => {
    const { voice } = setup();
    voice.setPush('button', true);
    await flush();
    expect(mic.track.enabled).toBe(true);
    events.dispatchEvent(new Event('blur'));
    expect(mic.track.enabled).toBe(false);
  });

  it('resumes interrupted voice and wakes game audio after microphone acquisition', async () => {
    const { voice } = setup();
    const ctx = FakeAudioContext.instances.at(-1)!;
    ctx.setState('interrupted');
    expect(ctx.resume).toHaveBeenCalled();
    vi.mocked(audio.init).mockClear();
    voice.setPush('button', true);
    await flush();
    expect(audio.init).toHaveBeenCalled();
    voice.suspendAudio();
    events.dispatchEvent(new Event('click'));
    expect(ctx.state).toBe('suspended');
    voice.resumeAudio();
    expect(ctx.state).toBe('running');
  });
});

describe('voice connection recovery and team radio', () => {
  it('reconnects when the initiating player loses the connection', async () => {
    const { voice, sent } = setup('a');
    voice.handleState({ t: 'vs', id: 'b', on: true });
    await flush();
    const old = FakePc.instances.at(-1)!;
    old.setState('connected');
    old.setState('failed');
    await vi.advanceTimersByTimeAsync(3000);
    expect(old.close).toHaveBeenCalled();
    expect(sent.filter((m) => m.kind === 'offer')).toHaveLength(2);
  });

  it('asks the initiator to rebuild when the answering player loses the connection', async () => {
    const { voice, sent } = setup('b');
    voice.handleState({ t: 'vs', id: 'a', on: true });
    await voice.handleSignal(offer);
    const pc = FakePc.instances.at(-1)!;
    pc.setState('connected');
    pc.setState('disconnected');
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent.some((m) => m.kind === 'recall' && m.to === 'a')).toBe(true);
    await voice.handleSignal({ ...offer, call: 'a:2' });
    expect(sent.some((m) => m.kind === 'answer' && m.call === 'a:2')).toBe(true);
  });

  it('allows a short disconnection to recover without replacing the link', async () => {
    const { voice } = setup();
    voice.handleState({ t: 'vs', id: 'b', on: true });
    await flush();
    const pc = FakePc.instances.at(-1)!;
    pc.setState('connected');
    pc.setState('disconnected');
    await vi.advanceTimersByTimeAsync(1000);
    pc.setState('connected');
    await vi.advanceTimersByTimeAsync(4000);
    expect(pc.close).not.toHaveBeenCalled();
    expect(FakePc.instances).toHaveLength(1);
  });

  it('retries a handshake when the offer / answer was lost', async () => {
    const { voice, sent } = setup();
    voice.handleState({ t: 'vs', id: 'b', on: true });
    await vi.advanceTimersByTimeAsync(15000);
    expect(sent.filter((m) => m.kind === 'offer')).toHaveLength(2);
  });

  it('ignores stale callbacks and answers from a replaced connection', async () => {
    const { voice, sent } = setup();
    voice.handleState({ t: 'vs', id: 'b', on: true });
    await flush();
    const old = FakePc.instances.at(-1)!;
    const oldCallback = old.onconnectionstatechange!;
    const oldCall = sent.find((m) => m.kind === 'offer')!.call;
    await voice.handleSignal({ t: 'v', id: 'b', kind: 'recall' });
    await flush();
    const fresh = FakePc.instances.at(-1)!;
    old.connectionState = 'failed';
    oldCallback();
    await voice.handleSignal({ t: 'v', id: 'b', kind: 'answer', call: oldCall, sdp: { type: 'answer', sdp: 'stale' } });
    await vi.advanceTimersByTimeAsync(3000);
    expect(fresh.close).not.toHaveBeenCalled();
    expect(fresh.setRemoteDescription).not.toHaveBeenCalled();
  });

  it('keeps ICE candidates that arrive before their offer', async () => {
    const { voice } = setup('b');
    voice.handleState({ t: 'vs', id: 'a', on: true });
    const c = { candidate: 'candidate', sdpMid: '0' };
    await voice.handleSignal({ t: 'v', id: 'a', kind: 'ice', call: 'a:1', c });
    await voice.handleSignal(offer);
    expect(FakePc.instances.at(-1)!.addIceCandidate).toHaveBeenCalledWith(c);
  });

  it('routes the microphone by team and refreshes it after a team change', async () => {
    const { voice } = setup('a');
    const teams: Record<string, string> = { a: 'red', b: 'red' };
    voice.useTeams((id) => teams[id]);
    voice.handleState({ t: 'vs', id: 'b', on: true });
    voice.setMode('open');
    await voice.toggleTalk();
    await flush();
    const pc = FakePc.instances.at(-1)!;
    pc.setState('connected');
    const sender = pc.transceivers[0].sender;
    expect(sender.track).toBe(mic.track);
    teams.b = 'blue';
    voice.refreshTeams();
    await flush();
    expect(sender.track).toBeNull();
    voice.setTalkScope('all');
    await flush();
    expect(sender.track).toBe(mic.track);
  });

  it('renegotiates a silent opponent link when talk scope changes to all players', async () => {
    const { voice, sent } = setup('a');
    voice.useTeams((id) => id === 'a' ? 'red' : 'blue');
    voice.handleState({ t: 'vs', id: 'b', on: true });
    voice.setMode('open');
    await voice.toggleTalk();
    await flush();
    const silent = FakePc.instances.at(-1)!;
    silent.setState('connected');
    expect(silent.transceivers[0].sender.track).toBeNull();
    voice.setTalkScope('all');
    await flush();
    const audible = FakePc.instances.at(-1)!;
    expect(audible).not.toBe(silent);
    expect(audible.transceivers[0].sender.track).toBe(mic.track);
    expect(sent.filter((m) => m.kind === 'offer').at(-1)!.call).not.toBe(sent.filter((m) => m.kind === 'offer').at(-2)!.call);
  });

  it('does not accept a late offer from a player who has left', async () => {
    const { voice } = setup('b');
    voice.handleState({ t: 'vs', id: 'a', on: true });
    await voice.handleSignal(offer);
    voice.drop('a');
    const count = FakePc.instances.length;
    await voice.handleSignal({ ...offer, call: 'a:2' });
    expect(FakePc.instances).toHaveLength(count);
  });

  it('keeps team radio audible across the map, while honoring listen and per-player mute', async () => {
    const { voice } = setup('b');
    voice.proximityAllowed = false;
    voice.useTeams((id) => id === 'b' ? 'red' : 'blue');
    voice.handleState({ t: 'vs', id: 'a', on: true });
    await voice.handleSignal(offer);
    FakePc.instances.at(-1)!.ontrack?.({ streams: [new FakeStream()] });
    const ctx = FakeAudioContext.instances.at(-1)!;
    const gain = ctx.createGain.mock.results.at(-1)!.value;
    voice.update(0.2, here, new Map([['a', { x: 500, y: 42, z: 500 }]]));
    expect(gain.gain.value).toBe(1.4);
    voice.toggleMute('a');
    voice.update(0.2, here, new Map());
    expect(gain.gain.value).toBe(0);
    voice.toggleMute('a');
    voice.setHearScope('team');
    voice.update(0.2, here, new Map());
    expect(gain.gain.value).toBe(0);
    voice.setHearScope('all');
    voice.update(0.2, here, new Map());
    expect(gain.gain.value).toBe(1.4);
    await voice.setListen(false);
    expect(voice.on).toBe(false);
  });

  it('does not reconnect after the player leaves or the room is disposed', async () => {
    const { voice, sent } = setup();
    voice.handleState({ t: 'vs', id: 'b', on: true });
    await flush();
    FakePc.instances.at(-1)!.setState('failed');
    voice.drop('b');
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent.filter((m) => m.kind === 'offer')).toHaveLength(1);
    voice.dispose();
    events.dispatchEvent(new Event('click'));
    await voice.setListen(true);
    expect(voice.on).toBe(false);
  });
});
