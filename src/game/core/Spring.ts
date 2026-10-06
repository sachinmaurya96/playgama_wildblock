/** Critically damped motion shared by the hand and firearm view models. */
export class Spring {
  x = 0;
  v = 0;
  constructor(public omega: number) {}

  step(target: number, dt: number): number {
    let remaining = dt;
    while (remaining > 0) {
      const h = Math.min(remaining, 1 / 60);
      const acceleration = this.omega * this.omega * (target - this.x) - 2 * this.omega * this.v;
      this.v += acceleration * h;
      this.x += this.v * h;
      remaining -= h;
    }
    return this.x;
  }

  reset(x = 0): void {
    this.x = x;
    this.v = 0;
  }
}
