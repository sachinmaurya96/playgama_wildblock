import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultGyro, type GyroSettings } from '../../stores/settingsStore';
import { Gyro } from './Gyro';

/** A minimal browser for the gyro: one devicemotion listener, a controllable clock and screen angle. */
let listener: ((e: unknown) => void) | null = null;
let now = 0;
let angle = 90;

beforeEach(() => {
  listener = null;
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('window', {
    DeviceMotionEvent: class {},
    addEventListener: (t: string, f: (e: unknown) => void) => t === 'devicemotion' && (listener = f),
    removeEventListener: () => (listener = null),
    setTimeout: () => 0,
    innerWidth: 844,
    innerHeight: 390,
    screen: { width: 844, height: 390 },
  });
  vi.stubGlobal('screen', { get orientation() { return { angle }; } });
  vi.stubGlobal('clearTimeout', () => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Turn the device at a fixed rate (deg/s) for `seconds`, 60 events per second. */
function spin(beta: number, gamma: number, seconds = 0.5) {
  for (let i = 0; i < seconds * 60; i++) {
    now += 1000 / 60;
    listener?.({ rotationRate: { alpha: 0, beta, gamma } });
  }
}

function gyro(p: Partial<GyroSettings> = {}): Gyro {
  const g = new Gyro();
  g.configure({ ...defaultGyro(), enabled: true, sensitivity: 1, vertical: 1, smoothing: 0, ...p }, true);
  return g;
}

const DEG30 = (30 * Math.PI) / 180;

describe('gyro aiming', () => {
  it('only listens when enabled and touch controls are on', () => {
    const g = new Gyro();
    g.configure({ ...defaultGyro(), enabled: true }, false);
    expect(listener).toBeNull();
    g.configure({ ...defaultGyro(), enabled: true }, true);
    expect(listener).not.toBeNull();
    g.configure({ ...defaultGyro(), enabled: false }, true);
    expect(listener).toBeNull();
  });

  it('maps device axes to screen axes in landscape (angle 90)', () => {
    angle = 90;
    const g = gyro();
    spin(60, 0); // turning left around the screen's vertical axis
    const t = g.take();
    expect(t.yaw).toBeCloseTo(DEG30, 1);
    expect(Math.abs(t.pitch)).toBeLessThan(1e-6);
    spin(0, -60); // top edge tilting toward you → look up
    expect(g.take().pitch).toBeCloseTo(DEG30, 1);
  });

  it('flips for the other landscape side (angle 270) and works in portrait', () => {
    angle = 270;
    let g = gyro();
    spin(60, 0);
    expect(g.take().yaw).toBeCloseTo(-DEG30, 1);
    angle = 0;
    g = gyro();
    spin(0, 60);
    expect(g.take().yaw).toBeCloseTo(DEG30, 1);
  });

  it('reads iPhone / iPad axis order (alpha = x, beta = y)', () => {
    angle = 90;
    const g = gyro({ axes: 'apple' });
    spin(0, 0); // nothing
    listener?.({ rotationRate: { alpha: 0, beta: 0, gamma: 0 } });
    g.take();
    for (let i = 0; i < 30; i++) {
      now += 1000 / 60;
      listener?.({ rotationRate: { alpha: 60, beta: 0, gamma: 0 } }); // Safari: alpha is the x axis
    }
    expect(g.take().yaw).toBeCloseTo(DEG30, 1);
    for (let i = 0; i < 30; i++) {
      now += 1000 / 60;
      listener?.({ rotationRate: { alpha: 0, beta: -60, gamma: 0 } }); // Safari: beta is the y axis
    }
    expect(g.take().pitch).toBeCloseTo(DEG30, 1);
  });

  it('applies sensitivity, vertical speed and invert options', () => {
    angle = 90;
    const g = gyro({ sensitivity: 2, vertical: 0.5, invertX: true });
    spin(60, -60);
    const t = g.take();
    expect(t.yaw).toBeCloseTo(-2 * DEG30, 1);
    expect(t.pitch).toBeCloseTo(DEG30, 1);
  });

  it('ignores hand tremor inside the dead zone', () => {
    const g = gyro({ profile: 'phone' });
    spin(1.5, 1, 2);
    const t = g.take();
    expect(t.yaw).toBe(0);
    expect(t.pitch).toBe(0);
  });

  it('smoothing lags a little but reaches the same speed', () => {
    const raw = gyro({ smoothing: 0 });
    spin(60, 0, 0.05);
    const fast = raw.take().yaw;
    raw.stop();
    const smooth = gyro({ smoothing: 1 });
    spin(60, 0, 0.05);
    expect(smooth.take().yaw).toBeLessThan(fast);
    // over a full second it lags by at most its ~0.11 s time constant
    spin(60, 0, 1);
    const full = (60 * Math.PI) / 180;
    const got = smooth.take().yaw;
    expect(got).toBeGreaterThan(full - 0.11 * full);
    expect(got).toBeLessThan(full + 1e-6);
  });
});
