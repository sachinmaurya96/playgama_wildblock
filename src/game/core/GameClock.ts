/**
 * Game time. `time` is total elapsed game-seconds (monotonic, saved with the
 * world, used for crop growth). One in-game day = dayLength real seconds.
 * dayFraction: 0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = dusk.
 */
export class GameClock {
  /** Total game seconds since world creation. */
  time: number;
  dayLength: number;
  /** Real seconds played in this world. */
  playTime = 0;

  constructor(startTime: number, dayLengthMinutes: number) {
    this.time = startTime;
    this.dayLength = Math.max(60, dayLengthMinutes * 60);
  }

  static readonly START_OF_DAY = 0.3; // worlds begin in the morning

  advance(dt: number): void {
    this.time += dt;
    this.playTime += dt;
  }

  get dayFraction(): number {
    return (((this.time / this.dayLength + GameClock.START_OF_DAY) % 1) + 1) % 1;
  }

  get day(): number {
    return Math.floor(this.time / this.dayLength + GameClock.START_OF_DAY) + 1;
  }

  /** Sun height -1..1 (sin curve, 0 at dawn/dusk). */
  get sunHeight(): number {
    return Math.sin((this.dayFraction - 0.25) * Math.PI * 2);
  }

  /** 0 at night, 1 in full day, smooth through dawn and dusk. */
  get daylight(): number {
    const h = this.sunHeight;
    const t = Math.min(1, Math.max(0, (h + 0.12) / 0.4));
    return t * t * (3 - 2 * t);
  }

  get isNight(): boolean {
    return this.sunHeight < -0.08;
  }

  /** Skip forward to the next morning (sleeping). Returns seconds skipped. */
  skipToMorning(): number {
    const f = this.dayFraction;
    const target = 0.27;
    let delta = target - f;
    if (delta <= 0) delta += 1;
    const secs = delta * this.dayLength;
    this.time += secs;
    return secs;
  }

  label(): string {
    const f = this.dayFraction;
    const mins = Math.floor(f * 24 * 60);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const phase = f < 0.2 ? 'Night' : f < 0.3 ? 'Dawn' : f < 0.45 ? 'Morning' : f < 0.6 ? 'Midday' : f < 0.7 ? 'Afternoon' : f < 0.8 ? 'Sunset' : 'Night';
    return `${String(h).padStart(2, '0')}:${String(Math.floor(m / 10) * 10).padStart(2, '0')} · ${phase}`;
  }
}
