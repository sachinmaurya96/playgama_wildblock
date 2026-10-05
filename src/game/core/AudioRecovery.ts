/** Resume after browser / device interruptions without undoing an intentional pause. */
export class AudioRecovery {
  private paused = false;
  private pending: Promise<void> | null = null;

  constructor(private ctx: AudioContext) {
    ctx.onstatechange = () => {
      if (this.paused && ctx.state === 'running') this.suspend();
      else this.wake(false);
    };
  }

  wake(retry = true): void {
    if (this.paused || this.ctx.state === 'running' || this.ctx.state === 'closed' || (!retry && this.pending)) return;
    // Do not await this from a gesture handler: autoplay may wait for another gesture.
    const pending = this.ctx.resume().catch(() => {}).finally(() => {
      if (this.pending === pending) this.pending = null;
    });
    this.pending = pending;
  }

  suspend(): void {
    this.paused = true;
    if (this.ctx.state !== 'closed') void this.ctx.suspend().catch(() => {});
  }

  resume(): void {
    this.paused = false;
    this.wake();
  }

  dispose(): void {
    this.paused = true;
    this.ctx.onstatechange = null;
  }
}
