import { vi } from 'vitest';

export class FakeParam {
  value = 0;
  setTargetAtTime = vi.fn((value: number) => { this.value = value; });
  setValueAtTime = vi.fn((value: number) => { this.value = value; });
  linearRampToValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
  cancelScheduledValues = vi.fn();
}

export class FakeAudioNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  detune = new FakeParam();
  Q = new FakeParam();
  pan = new FakeParam();
  playbackRate = new FakeParam();
  threshold = new FakeParam();
  ratio = new FakeParam();
  positionX = new FakeParam();
  positionY = new FakeParam();
  positionZ = new FakeParam();
  fftSize = 256;
  frequencyBinCount = 128;
  connect = vi.fn((_out: FakeAudioNode) => _out);
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
  getByteTimeDomainData = vi.fn((data: Uint8Array) => { data.fill(128); });
}

export class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = new FakeAudioNode();
  onstatechange: (() => void) | null = null;
  listener = {
    positionX: new FakeParam(), positionY: new FakeParam(), positionZ: new FakeParam(),
    forwardX: new FakeParam(), forwardY: new FakeParam(), forwardZ: new FakeParam(),
    upX: new FakeParam(), upY: new FakeParam(), upZ: new FakeParam(),
  };
  constructor() { FakeAudioContext.instances.push(this); }
  setState(state: string) { this.state = state; this.onstatechange?.(); }
  resume = vi.fn(async () => { this.setState('running'); });
  suspend = vi.fn(async () => { this.setState('suspended'); });
  close = vi.fn(async () => { this.setState('closed'); });
  createGain = vi.fn(() => new FakeAudioNode());
  createBiquadFilter = vi.fn(() => new FakeAudioNode());
  createBufferSource = vi.fn(() => new FakeAudioNode());
  createOscillator = vi.fn(() => new FakeAudioNode());
  createStereoPanner = vi.fn(() => new FakeAudioNode());
  createDynamicsCompressor = vi.fn(() => new FakeAudioNode());
  createMediaStreamSource = vi.fn(() => new FakeAudioNode());
  createAnalyser = vi.fn(() => new FakeAudioNode());
  createPanner = vi.fn(() => new FakeAudioNode());
  createBuffer = vi.fn((_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) }));
}
