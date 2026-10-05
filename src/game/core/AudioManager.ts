import type * as THREE from 'three';
import type { SoundMaterial } from '../../data/blocks';
import type { CreatureKind } from '../../data/creatures';
import type { Settings } from '../../stores/settingsStore';
import { AudioRecovery } from './AudioRecovery';

/**
 * Fully procedural audio (Web Audio API): every sound effect, ambience layer
 * and the adaptive music are synthesised at runtime, so there are no audio
 * files to license or download. Categories have separate, persisted volumes.
 */
export type Sfx =
  | 'break' | 'hit' | 'place' | 'step' | 'land' | 'jump' | 'pickup' | 'craft' | 'eat' | 'hurt' | 'swim' | 'splash' | 'door'
  | 'click' | 'open' | 'close' | 'creak' | 'thud' | 'chime' | 'discover' | 'swing' | 'enemyHit' | 'thunder' | 'sleep' | 'error'
  | 'till' | 'water' | 'toolBreak' | 'levelUp' | 'poof' | 'bow' | 'arrowHit' | 'block' | 'warn';

export type Mood = 'explore' | 'night' | 'combat' | 'home' | 'cave' | 'silent';

interface PlayOpts {
  material?: SoundMaterial;
  volume?: number;
  pitch?: number;
  pos?: THREE.Vector3;
}

type Bus = 'music' | 'ambient' | 'sfx' | 'creatures' | 'ui';

const SCALES: Record<Exclude<Mood, 'silent'>, { root: number; scale: number[]; tempo: number; chords: number[][]; density: number }> = {
  explore: { root: 57, scale: [0, 2, 4, 7, 9], tempo: 84, chords: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [2, 5, 9]], density: 0.55 },
  night: { root: 52, scale: [0, 3, 5, 7, 10], tempo: 64, chords: [[0, 3, 7], [8, 12, 15], [5, 8, 12], [3, 7, 10]], density: 0.35 },
  combat: { root: 50, scale: [0, 3, 5, 7, 10], tempo: 118, chords: [[0, 3, 7], [3, 7, 10], [5, 8, 12], [7, 10, 14]], density: 0.75 },
  home: { root: 60, scale: [0, 2, 4, 7, 9], tempo: 72, chords: [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]], density: 0.45 },
  cave: { root: 45, scale: [0, 2, 3, 7, 8], tempo: 58, chords: [[0, 3, 7], [8, 12, 15], [2, 5, 8], [0, 3, 7]], density: 0.3 },
};

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

class MusicLayer {
  readonly gain: GainNode;
  private nextTime = 0;
  private step = 0;
  private bar = 0;
  stopped = false;
  constructor(private am: AudioManager, readonly mood: Exclude<Mood, 'silent'>, out: AudioNode) {
    const ctx = am.ctx!;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(out);
    this.gain.gain.linearRampToValueAtTime(1, ctx.currentTime + 3);
    this.nextTime = ctx.currentTime + 0.2;
  }
  fadeOut() {
    const ctx = this.am.ctx!;
    this.gain.gain.cancelScheduledValues(ctx.currentTime);
    this.gain.gain.setValueAtTime(this.gain.gain.value, ctx.currentTime);
    this.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 3);
    setTimeout(() => {
      this.stopped = true;
      this.gain.disconnect();
    }, 3300);
  }
  schedule() {
    if (this.stopped) return;
    const ctx = this.am.ctx!;
    // Background timer throttling must not queue minutes of expired notes at once.
    if (this.nextTime < ctx.currentTime - 0.4) this.nextTime = ctx.currentTime + 0.02;
    const cfg = SCALES[this.mood];
    const beat = 60 / cfg.tempo / 2; // eighth notes
    while (this.nextTime < ctx.currentTime + 0.4) {
      const t = this.nextTime;
      const chord = cfg.chords[this.bar % cfg.chords.length];
      const inBar = this.step % 16;
      // phrase structure: 4 bars playing, then 2 bars of rest (cozy, not wall-to-wall)
      const phrase = this.bar % 6;
      const playing = phrase < 4;
      if (inBar === 0 && playing) {
        for (const n of chord) this.am.pad(midi(cfg.root + n - 12), t, beat * 16, this.gain, 0.05);
        this.am.pluck(midi(cfg.root + chord[0] - 24), t, beat * 6, this.gain, 0.16, 'sine');
      }
      if (playing && Math.random() < cfg.density * (inBar % 2 === 0 ? 1 : 0.4)) {
        const deg = cfg.scale[Math.floor(Math.random() * cfg.scale.length)];
        const oct = Math.random() < 0.3 ? 12 : 0;
        this.am.pluck(midi(cfg.root + deg + oct), t, beat * 3, this.gain, 0.09, this.mood === 'night' || this.mood === 'cave' ? 'sine' : 'triangle');
      }
      if (this.mood === 'combat' && inBar % 4 === 0) this.am.drum(t, this.gain, inBar % 8 === 0 ? 0.35 : 0.2);
      if ((this.mood === 'night' || this.mood === 'cave') && playing && inBar === 8 && Math.random() < 0.5) {
        this.am.bell(midi(cfg.root + 24 + cfg.scale[Math.floor(Math.random() * 5)]), t, this.gain, 0.05);
      }
      this.nextTime += beat;
      this.step++;
      if (this.step % 16 === 0) this.bar++;
    }
  }
}

export class AudioManager {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses = {} as Record<Bus, GainNode>;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private listener = { x: 0, y: 0, z: 0, yaw: 0 };
  private layers: MusicLayer[] = [];
  private mood: Mood = 'silent';
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private amb: Record<string, { gain: GainNode; filter?: BiquadFilterNode }> = {};
  private birdTimer = 2;
  private insectTimer = 1;
  private dripTimer = 3;
  private lastPlay = new Map<string, number>();
  private volumes: Settings['audio'] | null = null;
  private stinger = 0;
  private recovery: AudioRecovery | null = null;

  /** Must be called from a user gesture (browser autoplay rules). Safe to call repeatedly. */
  init(): void {
    if (this.ctx) {
      this.recovery?.wake();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.recovery = new AudioRecovery(ctx);
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    for (const b of ['music', 'ambient', 'sfx', 'creatures', 'ui'] as Bus[]) {
      const g = ctx.createGain();
      g.connect(this.master);
      this.buses[b] = g;
    }
    // noise buffers
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = this.noise.getChannelData(0), br = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      w[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * w[i]) / 1.02;
      br[i] = last * 3.5;
    }
    // ambience beds
    this.amb.wind = this.loopNoise(this.brown, 'lowpass', 500, 0.7);
    this.amb.leaves = this.loopNoise(this.noise, 'highpass', 3500, 0.5);
    this.amb.river = this.loopNoise(this.noise, 'bandpass', 700, 0.6);
    this.amb.fall = this.loopNoise(this.brown, 'lowpass', 1400, 0.4);
    this.amb.rain = this.loopNoise(this.noise, 'highpass', 1200, 0.3);
    this.amb.cave = this.loopNoise(this.brown, 'lowpass', 180, 0.8);
    if (this.volumes) this.applyVolumes(this.volumes);
    this.musicTimer = setInterval(() => {
      if (ctx.state !== 'running') return;
      for (const l of this.layers) l.schedule();
      this.layers = this.layers.filter((l) => !l.stopped);
    }, 120);
    this.recovery.wake();
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  private loopNoise(buf: AudioBuffer, type: BiquadFilterType, freq: number, q: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.buses.ambient);
    src.start();
    return { gain, filter };
  }

  applyVolumes(v: Settings['audio']): void {
    this.volumes = v;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(v.master, t, 0.05);
    this.buses.music.gain.setTargetAtTime(v.music * 0.5, t, 0.05);
    this.buses.ambient.gain.setTargetAtTime(v.ambient * 0.8, t, 0.05);
    this.buses.sfx.gain.setTargetAtTime(v.sfx, t, 0.05);
    this.buses.creatures.gain.setTargetAtTime(v.creatures * 0.8, t, 0.05);
    this.buses.ui.gain.setTargetAtTime(v.ui * 0.7, t, 0.05);
  }

  setListener(pos: THREE.Vector3, yaw: number): void {
    this.listener.x = pos.x;
    this.listener.y = pos.y;
    this.listener.z = pos.z;
    this.listener.yaw = yaw;
  }

  /** Output node for a positioned sound (stereo pan + distance falloff), or null if too far. */
  private spatial(bus: Bus, pos: THREE.Vector3 | undefined, volume: number, maxDist = 34): AudioNode | null {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    let vol = volume;
    if (pos) {
      const dx = pos.x - this.listener.x, dy = pos.y - this.listener.y, dz = pos.z - this.listener.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > maxDist) return null;
      vol *= 1 / (1 + d * 0.12) * (1 - d / maxDist);
      const right = Math.cos(this.listener.yaw) * dx - Math.sin(this.listener.yaw) * dz;
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = Math.max(-0.85, Math.min(0.85, right / (Math.abs(d) + 1)));
        g.connect(p).connect(this.buses[bus]);
      } else g.connect(this.buses[bus]);
    } else g.connect(this.buses[bus]);
    g.gain.value = vol;
    return g;
  }

  private noiseBurst(out: AudioNode, t: number, dur: number, type: BiquadFilterType, freq: number, q: number, gain: number, buf = this.noise, freqEnd?: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.01, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  tone(out: AudioNode, t: number, freq: number, dur: number, type: OscillatorType, gain: number, freqEnd?: number, attack = 0.005) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // instruments used by the music layers
  pluck(freq: number, t: number, dur: number, out: AudioNode, gain: number, type: OscillatorType) {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq * 6, t);
    f.frequency.exponentialRampToValueAtTime(freq * 1.5, t + dur);
    f.connect(out);
    this.tone(f, t, freq, dur, type, gain);
    this.tone(f, t, freq * 2.003, dur * 0.5, 'sine', gain * 0.25);
  }
  pad(freq: number, t: number, dur: number, out: AudioNode, gain: number) {
    const ctx = this.ctx!;
    for (const det of [-4, 4]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq;
      o.detune.value = det;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + dur * 0.3);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }
  bell(freq: number, t: number, out: AudioNode, gain: number) {
    this.tone(out, t, freq, 2.5, 'sine', gain);
    this.tone(out, t, freq * 2.76, 1.2, 'sine', gain * 0.3);
  }
  drum(t: number, out: AudioNode, gain: number) {
    this.tone(out, t, 120, 0.25, 'sine', gain, 50);
    this.noiseBurst(out, t, 0.08, 'lowpass', 900, 0.5, gain * 0.3);
  }

  play(name: Sfx, opts: PlayOpts = {}): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    // de-duplicate identical sounds fired in the same few ms
    const now = this.ctx.currentTime;
    const key = name + (opts.material ?? '');
    if ((this.lastPlay.get(key) ?? -1) > now - 0.03) return;
    this.lastPlay.set(key, now);
    const ui = name === 'click' || name === 'open' || name === 'close' || name === 'error';
    const out = this.spatial(ui ? 'ui' : 'sfx', opts.pos, opts.volume ?? 1);
    if (!out) return;
    const t = now + 0.005;
    const p = (opts.pitch ?? 1) * (0.92 + Math.random() * 0.16);
    const m = opts.material ?? 'dirt';
    const matSound = (vol: number, dur: number) => {
      switch (m) {
        case 'wood':
          this.noiseBurst(out, t, dur, 'bandpass', 700 * p, 1.5, 0.5 * vol);
          this.tone(out, t, 180 * p, dur * 0.9, 'triangle', 0.3 * vol, 110 * p);
          break;
        case 'stone':
          this.noiseBurst(out, t, dur * 0.8, 'bandpass', 1900 * p, 2, 0.45 * vol);
          this.noiseBurst(out, t, dur, 'lowpass', 500 * p, 1, 0.3 * vol);
          break;
        case 'plant':
          this.noiseBurst(out, t, dur * 0.8, 'highpass', 2800 * p, 0.7, 0.35 * vol);
          break;
        case 'glass':
          this.noiseBurst(out, t, dur * 0.6, 'highpass', 3000, 1, 0.3 * vol);
          for (let i = 0; i < 3; i++) this.tone(out, t + i * 0.03, (1800 + Math.random() * 1800) * p, 0.25, 'sine', 0.1 * vol);
          break;
        case 'metal':
          this.tone(out, t, 820 * p, dur * 2, 'triangle', 0.18 * vol);
          this.tone(out, t, 1230 * p, dur * 1.5, 'sine', 0.1 * vol);
          this.noiseBurst(out, t, dur * 0.4, 'bandpass', 2400, 3, 0.2 * vol);
          break;
        case 'sand':
          this.noiseBurst(out, t, dur, 'lowpass', 2600 * p, 0.5, 0.35 * vol);
          break;
        case 'cloth':
          this.noiseBurst(out, t, dur, 'lowpass', 900 * p, 0.5, 0.3 * vol);
          break;
        default:
          this.noiseBurst(out, t, dur, 'lowpass', 520 * p, 0.8, 0.5 * vol, this.brown);
          this.noiseBurst(out, t, dur * 0.5, 'bandpass', 1200 * p, 1, 0.15 * vol);
      }
    };
    switch (name) {
      case 'break': matSound(1, 0.22); break;
      case 'hit': matSound(0.45, 0.09); break;
      case 'step': matSound(0.3, 0.07); break;
      case 'land': matSound(0.6, 0.14); break;
      case 'place':
        matSound(0.6, 0.12);
        this.tone(out, t, 140 * p, 0.12, 'sine', 0.3, 80);
        break;
      case 'jump': this.noiseBurst(out, t, 0.12, 'bandpass', 900, 0.8, 0.08); break;
      case 'pickup':
        this.tone(out, t, 880 * p, 0.09, 'sine', 0.18);
        this.tone(out, t + 0.06, 1320 * p, 0.12, 'sine', 0.16);
        break;
      case 'craft':
        this.tone(out, t, 200, 0.1, 'triangle', 0.3, 120);
        this.tone(out, t + 0.1, 988, 0.3, 'sine', 0.15);
        this.tone(out, t + 0.18, 1319, 0.4, 'sine', 0.12);
        break;
      case 'eat':
        for (let i = 0; i < 3; i++) this.noiseBurst(out, t + i * 0.13, 0.08, 'bandpass', 1500 + Math.random() * 800, 1.2, 0.3);
        break;
      case 'hurt':
        this.tone(out, t, 260 * p, 0.22, 'triangle', 0.35, 150);
        this.noiseBurst(out, t, 0.1, 'lowpass', 700, 1, 0.3);
        break;
      case 'swim':
      case 'splash':
        this.noiseBurst(out, t, name === 'splash' ? 0.45 : 0.25, 'bandpass', 900 * p, 0.7, name === 'splash' ? 0.45 : 0.18, this.noise, 400);
        break;
      case 'door':
        this.tone(out, t, 190 * p, 0.25, 'sawtooth', 0.05, 150);
        this.noiseBurst(out, t + 0.2, 0.08, 'bandpass', 400, 2, 0.4);
        break;
      case 'creak':
        this.tone(out, t, 110, 1.1, 'sawtooth', 0.05, 70, 0.2);
        this.noiseBurst(out, t, 1.0, 'bandpass', 500, 4, 0.1);
        break;
      case 'thud':
        this.tone(out, t, 90, 0.5, 'sine', 0.6, 40);
        this.noiseBurst(out, t, 0.5, 'lowpass', 400, 0.7, 0.5, this.brown);
        this.noiseBurst(out, t + 0.05, 0.6, 'highpass', 2500, 0.5, 0.2);
        break;
      case 'click': this.tone(out, t, 900, 0.04, 'sine', 0.15); break;
      case 'open':
        this.tone(out, t, 520, 0.08, 'sine', 0.12);
        this.tone(out, t + 0.05, 780, 0.1, 'sine', 0.1);
        break;
      case 'close':
        this.tone(out, t, 700, 0.08, 'sine', 0.1);
        this.tone(out, t + 0.05, 470, 0.1, 'sine', 0.1);
        break;
      case 'error': this.tone(out, t, 220, 0.15, 'square', 0.05, 180); break;
      case 'chime':
      case 'levelUp':
        [0, 4, 7, 12].forEach((s, i) => this.tone(out, t + i * 0.09, midi(72 + s), 0.6, 'sine', 0.13));
        if (name === 'levelUp') [0, 4, 7, 12, 16].forEach((s, i) => this.tone(out, t + 0.45 + i * 0.07, midi(79 + s), 0.8, 'triangle', 0.08));
        break;
      case 'discover':
        [0, 7, 12, 16, 19, 24].forEach((s, i) => this.tone(out, t + i * 0.07, midi(76 + s), 1.2, 'sine', 0.08));
        break;
      case 'swing': this.noiseBurst(out, t, 0.14, 'bandpass', 1400 * p, 1.2, 0.18, this.noise, 3200); break;
      case 'bow':
        this.tone(out, t, 140 * p, 0.12, 'triangle', 0.18, 90);
        this.noiseBurst(out, t + 0.02, 0.18, 'bandpass', 2400, 1.4, 0.12, this.noise, 5200);
        break;
      case 'arrowHit': this.noiseBurst(out, t, 0.08, 'bandpass', 900 * p, 1.5, 0.25); this.tone(out, t, 260 * p, 0.06, 'square', 0.05, 160); break;
      case 'block':
        this.tone(out, t, 880 * p, 0.25, 'triangle', 0.12, 640);
        this.tone(out, t, 1320 * p, 0.18, 'sine', 0.06, 1100);
        this.noiseBurst(out, t, 0.06, 'highpass', 3000, 1, 0.2);
        break;
      case 'warn':
        this.tone(out, t, 196, 0.6, 'sine', 0.12, 185);
        this.tone(out, t + 0.25, 147, 0.9, 'sine', 0.1, 140);
        break;
      case 'enemyHit':
        this.tone(out, t, 180 * p, 0.12, 'square', 0.08, 120);
        this.noiseBurst(out, t, 0.1, 'lowpass', 1200, 1, 0.35);
        break;
      case 'thunder':
        this.noiseBurst(out, t, 3.5, 'lowpass', 300, 0.5, 0.9, this.brown, 60);
        this.noiseBurst(out, t + 0.1, 1.2, 'lowpass', 900, 0.5, 0.3, this.brown, 100);
        break;
      case 'sleep':
        [0, 4, 7, 11, 14].forEach((s, i) => this.tone(out, t + i * 0.25, midi(64 + s), 1.6, 'sine', 0.08));
        break;
      case 'till': matSound(0.8, 0.18); break;
      case 'water': this.noiseBurst(out, t, 0.6, 'bandpass', 1800, 0.8, 0.2, this.noise, 900); break;
      case 'toolBreak':
        this.noiseBurst(out, t, 0.3, 'highpass', 2000, 1, 0.4);
        this.tone(out, t, 600, 0.3, 'triangle', 0.15, 200);
        break;
      case 'poof': this.noiseBurst(out, t, 0.35, 'bandpass', 1200, 0.8, 0.25, this.noise, 300); break;
    }
  }

  /**
   * A custom procedural sound on the SFX (or UI) bus, positioned like every other
   * sound (stereo pan + distance falloff). Used by Deathmatch for weapons.
   */
  custom(build: (s: { t: number; out: AudioNode; tone: AudioManager['tone']; noise: (out: AudioNode, t: number, dur: number, type: BiquadFilterType, freq: number, q: number, gain: number, brown?: boolean, freqEnd?: number) => void }) => void, opts: { pos?: THREE.Vector3; volume?: number; maxDist?: number; ui?: boolean } = {}): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const out = this.spatial(opts.ui ? 'ui' : 'sfx', opts.pos, opts.volume ?? 1, opts.maxDist ?? 34);
    if (!out) return;
    build({
      t: this.ctx.currentTime + 0.005, out,
      tone: (o, t, f, d, ty, g, fe, at) => this.tone(o, t, f, d, ty, g, fe, at),
      noise: (o, t, d, ty, f, q, g, brown, fe) => this.noiseBurst(o, t, d, ty, f, q, g, brown ? this.brown : this.noise, fe),
    });
  }

  creature(kind: CreatureKind, what: 'idle' | 'hurt' | 'happy' | 'attack', pos: THREE.Vector3): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const out = this.spatial('creatures', pos, 0.8, 30);
    if (!out) return;
    const t = this.ctx.currentTime + 0.01;
    const p = 0.9 + Math.random() * 0.2 * (what === 'hurt' ? 1.3 : 1);
    const hurt = what === 'hurt' ? 1.25 : 1;
    switch (kind) {
      case 'mossback':
        this.tone(out, t, 110 * p * hurt, 0.7, 'sawtooth', 0.06, 95 * p, 0.15);
        this.tone(out, t, 220 * p * hurt, 0.6, 'sine', 0.05, 180, 0.12);
        break;
      case 'pufftail':
        this.tone(out, t, 1300 * p * hurt, 0.12, 'sine', 0.12, 1800 * p);
        if (what === 'happy') this.tone(out, t + 0.14, 1500 * p, 0.12, 'sine', 0.1, 2100);
        break;
      case 'twiglet':
        for (let i = 0; i < 3; i++) this.tone(out, t + i * 0.09, (2600 + Math.random() * 1400) * p, 0.07, 'sine', 0.08, 3600);
        break;
      case 'mudsnout':
        for (let i = 0; i < 2; i++) this.noiseBurst(out, t + i * 0.16, 0.12, 'lowpass', 500 * p * hurt, 3, 0.4, this.brown);
        break;
      case 'glowbug':
        this.tone(out, t, 190 * p, 0.8, 'sine', 0.04, 210);
        break;
      case 'fenn':
        this.tone(out, t, 700 * p * hurt, 0.14, 'square', 0.04, 1000 * p);
        this.tone(out, t + 0.16, 800 * p, 0.12, 'square', 0.035, 1100 * p);
        break;
      case 'thorncrawler':
        for (let i = 0; i < 5; i++) this.noiseBurst(out, t + i * 0.05, 0.04, 'bandpass', 3000 * p, 4, 0.2);
        break;
      case 'nightling':
        this.noiseBurst(out, t, 0.9, 'bandpass', 700 * p * hurt, 6, 0.3, this.noise, 1400 * p);
        break;
      case 'stoneback':
        this.noiseBurst(out, t, 0.6, 'bandpass', 220 * p * hurt, 2, 0.6, this.brown);
        break;
      case 'cave_mite':
        for (let i = 0; i < 4; i++) this.tone(out, t + i * 0.04, 4200 * p, 0.02, 'square', 0.03);
        break;
      case 'bog_snapper':
        this.noiseBurst(out, t, 0.7, 'highpass', 2200 * p, 1, 0.25, this.noise, 3500);
        break;
      case 'gloomstalker':
        this.tone(out, t, 85 * p * hurt, 1.1, 'sawtooth', 0.07, 62 * p, 0.2);
        this.noiseBurst(out, t + 0.05, 0.8, 'lowpass', 400 * p, 2, 0.3, this.brown);
        break;
      case 'duskfang':
        if (what === 'idle') this.tone(out, t, 420 * p, 1.2, 'sine', 0.06, 640 * p, 0.3); // howl
        else this.noiseBurst(out, t, 0.25, 'bandpass', 900 * p * hurt, 3, 0.35, this.noise, 1600 * p);
        break;
    }
  }

  /** Called every frame with environment info; drives ambience beds and music mood. */
  updateAmbience(dt: number, env: {
    daylight: number; forest: number; underground: number; rain: number; wind: number; river: number; waterfall: number; paused: boolean; mood: Mood;
    riverPos?: THREE.Vector3; fallPos?: THREE.Vector3;
  }): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const set = (k: string, v: number) => this.amb[k]?.gain.gain.setTargetAtTime(env.paused ? v * 0.3 : v, t, 0.6);
    const outside = 1 - env.underground;
    set('wind', (0.05 + env.wind * 0.12) * outside + env.rain * 0.05);
    set('leaves', env.forest * 0.035 * outside * (0.5 + env.wind));
    set('river', Math.min(0.2, env.river * 0.2));
    set('fall', Math.min(0.35, env.waterfall * 0.35));
    set('rain', env.rain * 0.16 * (outside * 0.8 + 0.2));
    set('cave', env.underground * 0.25);
    if (this.amb.wind?.filter) this.amb.wind.filter.frequency.setTargetAtTime(380 + Math.sin(t * 0.2) * 150 + env.wind * 300, t, 1);
    if (env.paused) {
      this.setMood('silent');
      return;
    }
    // birds by day, insects at night, drips underground
    this.birdTimer -= dt;
    if (this.birdTimer <= 0 && env.daylight > 0.5 && outside > 0.5 && env.rain < 0.3) {
      this.birdTimer = 2 + Math.random() * 6;
      const out = this.spatial('ambient', undefined, 0.5 * (0.4 + env.forest));
      if (out) {
        const base = 2200 + Math.random() * 2200;
        const n = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) this.tone(out, t + i * 0.11, base * (0.9 + Math.random() * 0.3), 0.08, 'sine', 0.05, base * 1.3);
      }
    }
    this.insectTimer -= dt;
    if (this.insectTimer <= 0 && env.daylight < 0.3 && outside > 0.5) {
      this.insectTimer = 0.6 + Math.random() * 1.8;
      const out = this.spatial('ambient', undefined, 0.3);
      if (out) for (let i = 0; i < 6; i++) this.tone(out, t + i * 0.045, 4400 + Math.random() * 300, 0.025, 'square', 0.012);
    }
    this.dripTimer -= dt;
    if (this.dripTimer <= 0 && env.underground > 0.5) {
      this.dripTimer = 1.5 + Math.random() * 4;
      const out = this.spatial('ambient', undefined, 0.5);
      if (out) this.tone(out, t, 1200 + Math.random() * 900, 0.18, 'sine', 0.08, 600);
    }
    this.setMood(env.mood);
  }

  setMood(mood: Mood): void {
    if (!this.ctx || mood === this.mood) return;
    if (performance.now() < this.stinger) return;
    this.mood = mood;
    for (const l of this.layers) l.fadeOut();
    if (mood !== 'silent') this.layers.push(new MusicLayer(this, mood, this.buses.music));
  }

  /** A short discovery flourish that briefly takes over from the music. */
  discoveryStinger(): void {
    this.play('discover');
    this.stinger = performance.now() + 4000;
  }

  suspend(): void {
    this.recovery?.suspend();
  }

  resume(): void {
    this.recovery?.resume();
  }

  dispose(): void {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.recovery?.dispose();
    this.recovery = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
