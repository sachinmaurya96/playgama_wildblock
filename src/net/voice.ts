import { iceServers, type NetMsg } from './transport';
import { usePvpStore } from '../stores/pvpStore';

/**
 * Voice chat for PvP Mode — free and serverless, like the rest of PvP.
 *
 * Every pair of players in voice gets its own direct WebRTC audio connection
 * (a small mesh: fine for up to 8 players at ~30 kbps each). The game's
 * existing data connection carries the WebRTC handshake ("v" messages, relayed
 * by the host), so no extra signalling service is needed and it also works in
 * the two-tab "This device" mode.
 *
 * Audio plays through Web Audio: per-player volume / mute, and optional
 * proximity voice (louder when close, from the speaker's direction).
 */
export type VoiceMode = 'push' | 'open';

interface Link {
  pc: RTCPeerConnection;
  audio?: HTMLAudioElement;
  source?: MediaStreamAudioSourceNode;
  gain?: GainNode;
  panner?: PannerNode;
  analyser?: AnalyserNode;
  level: Uint8Array<ArrayBuffer> | null;
  pendingIce: RTCIceCandidateInit[];
  initiator: boolean;
}

const PROX_FULL = 6; // blocks: full volume inside this distance
const PROX_MAX = 48; // silent beyond this

function loadPrefs(): { mode: VoiceMode; proximity: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem('wb-voice') ?? '{}');
    return { mode: v.mode === 'open' ? 'open' : 'push', proximity: v.proximity !== false };
  } catch {
    return { mode: 'push', proximity: true };
  }
}

export class VoiceChat {
  on = false;
  mode: VoiceMode;
  proximity: boolean;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private links = new Map<string, Link>();
  /** Players who announced they are in voice. */
  private inVoice = new Set<string>();
  private pushHeld = false;
  private announceTimer = 0;
  private levelTimer = 0;
  private localAnalyser: AnalyserNode | null = null;
  private localLevel: Uint8Array<ArrayBuffer> | null = null;
  muted = new Set<string>();
  volumes = new Map<string, number>();

  constructor(
    private selfId: string,
    private send: (msg: NetMsg) => void,
  ) {
    const p = loadPrefs();
    this.mode = p.mode;
    this.proximity = p.proximity;
    this.publish();
  }

  private savePrefs() {
    try {
      localStorage.setItem('wb-voice', JSON.stringify({ mode: this.mode, proximity: this.proximity }));
    } catch {
      /* private mode */
    }
  }

  private publish(extra: Record<string, unknown> = {}) {
    usePvpStore.getState().set({
      voiceOn: this.on, voiceMode: this.mode, voiceProximity: this.proximity, voiceTalking: this.transmitting(),
      voicePeers: [...this.inVoice], voiceMuted: [...this.muted], ...extra,
    });
  }

  private transmitting(): boolean {
    return this.on && !!this.stream && (this.mode === 'open' || this.pushHeld);
  }

  private applyTrackState() {
    const live = this.transmitting();
    for (const t of this.stream?.getAudioTracks() ?? []) t.enabled = live;
    this.publish();
  }

  // ---------------------------------------------------------------- public controls

  /** Join voice (asks for the microphone). Must run from a tap / click (iOS rule). */
  async enable(): Promise<void> {
    if (this.on) return;
    this.ctx ??= new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
    let micError: string | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.localAnalyser = this.ctx.createAnalyser();
      this.localAnalyser.fftSize = 256;
      this.localLevel = new Uint8Array(this.localAnalyser.frequencyBinCount);
      src.connect(this.localAnalyser);
    } catch (e) {
      this.stream = null;
      const name = (e as Error)?.name ?? '';
      micError = name === 'NotAllowedError' ? 'Microphone blocked — you can still listen. Allow the mic in your browser to talk.' : !window.isSecureContext ? 'Voice needs the game on https:// — you can still listen.' : 'No microphone found — you can still listen.';
    }
    this.on = true;
    this.applyTrackState();
    this.publish({ voiceError: micError });
    this.announce();
    for (const id of this.inVoice) this.maybeConnect(id);
  }

  disable(): void {
    if (!this.on) return;
    this.on = false;
    this.send({ t: 'vs', id: this.selfId, on: false });
    for (const id of [...this.links.keys()]) this.closeLink(id);
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    this.localAnalyser = null;
    this.publish({ voiceError: null, voiceSpeaking: [] });
  }

  setMode(mode: VoiceMode): void {
    this.mode = mode;
    this.savePrefs();
    this.applyTrackState();
  }

  setProximity(on: boolean): void {
    this.proximity = on;
    this.savePrefs();
    for (const [id, l] of this.links) this.wireOutput(id, l);
    this.publish();
  }

  setPush(held: boolean): void {
    if (this.pushHeld === held) return;
    this.pushHeld = held;
    this.applyTrackState();
  }

  toggleMute(id: string): void {
    if (this.muted.has(id)) this.muted.delete(id);
    else this.muted.add(id);
    this.publish();
  }

  // ---------------------------------------------------------------- signalling (over the game connection)

  private announce() {
    if (this.on) this.send({ t: 'vs', id: this.selfId, on: true });
  }

  /** "vs": someone joined / left voice. */
  handleState(msg: NetMsg): void {
    const id = String(msg.id ?? '');
    if (!id || id === this.selfId) return;
    if (msg.on) {
      const isNew = !this.inVoice.has(id);
      this.inVoice.add(id);
      if (isNew) this.announce(); // let newcomers know about us right away
      this.maybeConnect(id);
    } else {
      this.inVoice.delete(id);
      this.closeLink(id);
    }
    this.publish();
  }

  /** "v": WebRTC offer / answer / ICE candidate for us. */
  async handleSignal(msg: NetMsg): Promise<void> {
    const from = String(msg.id ?? '');
    if (!from || !this.on) return;
    try {
      if (msg.kind === 'offer') {
        this.closeLink(from);
        const l = this.createLink(from, false);
        await l.pc.setRemoteDescription(msg.sdp as RTCSessionDescriptionInit);
        await this.flushIce(l);
        const answer = await l.pc.createAnswer();
        await l.pc.setLocalDescription(answer);
        this.send({ t: 'v', id: this.selfId, to: from, kind: 'answer', sdp: { type: answer.type, sdp: answer.sdp } });
      } else if (msg.kind === 'answer') {
        const l = this.links.get(from);
        if (l && l.pc.signalingState === 'have-local-offer') {
          await l.pc.setRemoteDescription(msg.sdp as RTCSessionDescriptionInit);
          await this.flushIce(l);
        }
      } else if (msg.kind === 'ice') {
        const l = this.links.get(from);
        const c = msg.c as RTCIceCandidateInit;
        if (!l || !c) return;
        if (l.pc.remoteDescription) await l.pc.addIceCandidate(c).catch(() => {});
        else l.pendingIce.push(c);
      }
    } catch (e) {
      console.warn('[WildBlocks voice]', e);
    }
  }

  private async flushIce(l: Link) {
    for (const c of l.pendingIce.splice(0)) await l.pc.addIceCandidate(c).catch(() => {});
  }

  /** The player with the smaller id makes the call — never both at once. */
  private maybeConnect(id: string) {
    if (!this.on || !this.inVoice.has(id) || this.links.has(id) || this.selfId > id) return;
    const l = this.createLink(id, true);
    void (async () => {
      try {
        const offer = await l.pc.createOffer();
        await l.pc.setLocalDescription(offer);
        this.send({ t: 'v', id: this.selfId, to: id, kind: 'offer', sdp: { type: offer.type, sdp: offer.sdp } });
      } catch (e) {
        console.warn('[WildBlocks voice]', e);
      }
    })();
  }

  private createLink(id: string, initiator: boolean): Link {
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    const l: Link = { pc, level: null, pendingIce: [], initiator };
    this.links.set(id, l);
    const track = this.stream?.getAudioTracks()[0];
    if (track && this.stream) pc.addTrack(track, this.stream);
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send({ t: 'v', id: this.selfId, to: id, kind: 'ice', c: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      this.attachRemote(id, l, stream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        this.closeLink(id);
        // try again in a moment (network hiccup)
        setTimeout(() => this.maybeConnect(id), 3000);
      }
    };
    return l;
  }

  private attachRemote(id: string, l: Link, stream: MediaStream) {
    const ctx = this.ctx;
    if (!ctx) return;
    // Chrome only feeds remote WebRTC audio into Web Audio when it's also attached to a media element
    const a = new Audio();
    a.srcObject = stream;
    a.muted = true;
    void a.play().catch(() => {});
    l.audio = a;
    l.source?.disconnect();
    l.source = ctx.createMediaStreamSource(stream);
    l.analyser = ctx.createAnalyser();
    l.analyser.fftSize = 256;
    l.level = new Uint8Array(l.analyser.frequencyBinCount);
    l.gain = ctx.createGain();
    l.panner = ctx.createPanner();
    l.panner.panningModel = 'HRTF';
    l.panner.distanceModel = 'linear';
    l.panner.refDistance = PROX_FULL;
    l.panner.maxDistance = PROX_MAX;
    l.panner.rolloffFactor = 1;
    l.source.connect(l.analyser);
    this.wireOutput(id, l);
  }

  private wireOutput(_id: string, l: Link) {
    if (!l.source || !l.gain || !l.panner || !this.ctx) return;
    l.source.disconnect();
    l.gain.disconnect();
    l.panner.disconnect();
    l.source.connect(l.analyser!);
    if (this.proximity) {
      l.source.connect(l.panner);
      l.panner.connect(l.gain);
    } else l.source.connect(l.gain);
    l.gain.connect(this.ctx.destination);
  }

  private closeLink(id: string) {
    const l = this.links.get(id);
    if (!l) return;
    this.links.delete(id);
    try {
      l.source?.disconnect();
      l.gain?.disconnect();
      l.panner?.disconnect();
      if (l.audio) l.audio.srcObject = null;
      l.pc.close();
    } catch {
      /* ignore */
    }
  }

  /** A player left the game. */
  drop(id: string): void {
    this.inVoice.delete(id);
    this.closeLink(id);
    this.publish();
  }

  // ---------------------------------------------------------------- per frame

  private loud(an: AnalyserNode | null | undefined, buf: Uint8Array<ArrayBuffer> | null): boolean {
    if (!an || !buf) return false;
    an.getByteTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
    return peak > 10;
  }

  /**
   * listener = your camera; positions = where each other player is.
   * Push-to-talk key (T) is read by the caller and passed in.
   */
  update(dt: number, listener: { x: number; y: number; z: number; fx: number; fy: number; fz: number }, positions: Map<string, { x: number; y: number; z: number }>): void {
    if (!this.on) return;
    this.announceTimer -= dt;
    if (this.announceTimer <= 0) {
      this.announceTimer = 5;
      this.announce();
    }
    const ctx = this.ctx;
    if (!ctx) return;
    const L = ctx.listener;
    const t = ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(listener.x, t, 0.05);
      L.positionY.setTargetAtTime(listener.y, t, 0.05);
      L.positionZ.setTargetAtTime(listener.z, t, 0.05);
      L.forwardX.setTargetAtTime(listener.fx, t, 0.05);
      L.forwardY.setTargetAtTime(listener.fy, t, 0.05);
      L.forwardZ.setTargetAtTime(listener.fz, t, 0.05);
      L.upX.value = 0;
      L.upY.value = 1;
      L.upZ.value = 0;
    } else {
      L.setPosition(listener.x, listener.y, listener.z);
      L.setOrientation(listener.fx, listener.fy, listener.fz, 0, 1, 0);
    }
    for (const [id, l] of this.links) {
      if (!l.gain || !l.panner) continue;
      const vol = this.muted.has(id) ? 0 : this.volumes.get(id) ?? 1;
      l.gain.gain.setTargetAtTime(vol * 1.4, t, 0.05);
      const p = positions.get(id);
      if (p) {
        if (l.panner.positionX) {
          l.panner.positionX.setTargetAtTime(p.x, t, 0.05);
          l.panner.positionY.setTargetAtTime(p.y + 1.5, t, 0.05);
          l.panner.positionZ.setTargetAtTime(p.z, t, 0.05);
        } else l.panner.setPosition(p.x, p.y + 1.5, p.z);
      }
    }
    // who is speaking (UI)
    this.levelTimer -= dt;
    if (this.levelTimer <= 0) {
      this.levelTimer = 0.15;
      const speaking: string[] = [];
      if (this.transmitting() && this.loud(this.localAnalyser, this.localLevel)) speaking.push(this.selfId);
      for (const [id, l] of this.links) if (!this.muted.has(id) && this.loud(l.analyser, l.level)) speaking.push(id);
      const prev = usePvpStore.getState().voiceSpeaking;
      if (prev.join() !== speaking.join()) usePvpStore.getState().set({ voiceSpeaking: speaking });
    }
  }

  dispose(): void {
    this.disable();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
