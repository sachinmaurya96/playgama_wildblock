import { detectGyroDevice, GYRO_PROFILES, type GyroSettings } from '../../stores/settingsStore';

/**
 * Gyro aiming for phones & tablets: turning the device turns the camera.
 *
 * Uses the gyroscope's rotation *rate* (devicemotion.rotationRate, deg/s)
 * rather than absolute orientation angles, so there's no drift, no
 * compass jumps and no "recentring" — it simply adds to touch-drag looking.
 * Rates are mapped from the device's axes to the screen's (portrait or either
 * landscape), passed through a small dead zone and an adjustable low-pass
 * filter, then accumulated as yaw / pitch radians for the player to consume.
 */
type MotionPermission = { requestPermission?: () => Promise<'granted' | 'denied'> };

export type GyroStatus = 'off' | 'waiting' | 'active' | 'unsupported' | 'denied';

const DEG = Math.PI / 180;

export class Gyro {
  /** Accumulated camera turn since the last frame (radians): + yaw = turn left, + pitch = look up. */
  yaw = 0;
  pitch = 0;
  status: GyroStatus = 'off';
  /** Last time a motion event arrived (performance.now()). */
  lastEvent = 0;
  private listening = false;
  private fy = 0;
  private fp = 0;
  private lastT = 0;
  private settings: GyroSettings | null = null;
  private waitTimer = 0;
  onStatus: ((s: GyroStatus) => void) | null = null;

  static supported(): boolean {
    return typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
  }

  /**
   * iOS 13+ asks for motion permission, and only from a tap / click.
   * Call this from the gesture that turns gyro on. Resolves true when allowed.
   */
  static async requestPermission(): Promise<boolean> {
    if (!Gyro.supported()) return false;
    const DM = (window as unknown as { DeviceMotionEvent: MotionPermission }).DeviceMotionEvent;
    if (typeof DM.requestPermission !== 'function') return true;
    try {
      return (await DM.requestPermission()) === 'granted';
    } catch {
      return false;
    }
  }

  /** Start / stop listening to match the settings (and whether touch controls are on). */
  configure(s: GyroSettings, touch: boolean): void {
    this.settings = s;
    const want = s.enabled && touch;
    if (want === this.listening) return;
    if (want) this.start();
    else this.stop();
  }

  private start() {
    if (!Gyro.supported()) {
      this.setStatus('unsupported');
      return;
    }
    this.listening = true;
    this.fy = this.fp = 0;
    this.lastT = 0;
    window.addEventListener('devicemotion', this.onMotion);
    this.setStatus('waiting');
    // no events at all after a moment: no gyroscope (desktop, some tablets) or blocked (iOS without permission)
    clearTimeout(this.waitTimer);
    this.waitTimer = window.setTimeout(() => {
      if (this.listening && this.status === 'waiting') this.setStatus('unsupported');
    }, 2500);
  }

  stop(): void {
    if (this.listening) window.removeEventListener('devicemotion', this.onMotion);
    this.listening = false;
    clearTimeout(this.waitTimer);
    this.yaw = this.pitch = 0;
    this.setStatus('off');
  }

  private setStatus(s: GyroStatus) {
    if (this.status === s) return;
    this.status = s;
    this.onStatus?.(s);
  }

  private onMotion = (e: DeviceMotionEvent) => {
    const r = e.rotationRate;
    const s = this.settings;
    if (!r || !s || r.alpha === null || r.beta === null || r.gamma === null) return;
    const now = performance.now();
    this.lastEvent = now;
    this.setStatus('active');
    // event spacing (clamped): devices fire at 60–120 Hz, some browsers report e.interval in s or ms
    // after a gap in events (tab hidden, sensor paused) start fresh: no leftover filtered motion
    if (!this.lastT || now - this.lastT > 100) this.fy = this.fp = 0;
    const dt = this.lastT ? Math.min(0.05, Math.max(0.004, (now - this.lastT) / 1000)) : 1 / 60;
    this.lastT = now;
    // device axes → screen axes for the current orientation
    const angle = ((screenAngle() % 360) + 360) % 360;
    const a = angle * DEG;
    const sin = Math.sin(a), cos = Math.cos(a);
    // rotation around the device's own x (across the screen) and y (up the screen) axes, deg/s
    const apple = s.axes === 'apple' || (s.axes !== 'standard' && isAppleMobile());
    const rx = (apple ? r.alpha : r.beta) ?? 0;
    const ry = (apple ? r.beta : r.gamma) ?? 0;
    const yawRate = rx * sin + ry * cos; // around the screen's vertical axis
    const pitchRate = rx * cos - ry * sin; // around the screen's horizontal axis
    const prof = GYRO_PROFILES[s.profile === 'auto' ? detectGyroDevice() : s.profile];
    // soft dead zone: hand tremor below it fades out instead of cutting off abruptly
    const dz = prof.deadzone;
    const soft = (v: number) => {
      const m = Math.abs(v);
      if (m >= dz * 2) return v;
      return v * Math.max(0, (m - dz) / dz);
    };
    // low-pass filter: smoothing 0 → instant, 1 → ~110 ms time constant
    const tau = s.smoothing * 0.11;
    const k = tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
    this.fy += (soft(yawRate) - this.fy) * k;
    this.fp += (soft(pitchRate) - this.fp) * k;
    this.yaw += this.fy * dt * DEG * s.sensitivity * (s.invertX ? -1 : 1);
    this.pitch += this.fp * dt * DEG * s.sensitivity * s.vertical * (s.invertY ? -1 : 1);
  };

  /** Hand the accumulated turn to the player (and reset it). */
  take(): { yaw: number; pitch: number } {
    const out = { yaw: this.yaw, pitch: this.pitch };
    this.yaw = this.pitch = 0;
    return out;
  }
}

/** iPhone / iPad (incl. iPads that report as a Mac): Safari's motion axes differ from the spec order. */
export function isAppleMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iP(hone|ad|od)/.test(navigator.userAgent ?? '') || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1);
}

function screenAngle(): number {
  const o = typeof screen !== 'undefined' ? (screen.orientation as ScreenOrientation | undefined) : undefined;
  if (o && typeof o.angle === 'number') return o.angle;
  const w = window as unknown as { orientation?: number };
  return typeof w.orientation === 'number' ? w.orientation : 0;
}
