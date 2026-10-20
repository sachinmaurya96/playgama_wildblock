export type PauseReason = 'user' | 'platform' | 'hidden' | 'loading' | 'ad';

/** Independent reasons: releasing an ad must never undo a user/host pause. */
export class Lifecycle {
  private reasons = new Set<PauseReason>();
  private listeners = new Set<() => void>();
  platformAudio = true;
  userAudio = true;
  get paused() { return this.reasons.size > 0; }
  get interrupted() { return [...this.reasons].some((r) => r !== 'user'); }
  get audioEnabled() { return this.platformAudio && this.userAudio && !this.paused; }
  has(reason: PauseReason) { return this.reasons.has(reason); }
  set(reason: PauseReason, value: boolean) {
    if (value === this.reasons.has(reason)) return;
    if (value) this.reasons.add(reason); else this.reasons.delete(reason);
    this.changed();
  }
  setAudio(platform: boolean, user = this.userAudio) {
    this.platformAudio = platform;
    this.userAudio = user;
    this.changed();
  }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  /** Gameplay delays keep their remaining duration across every interruption. */
  delay(fn: () => void, durationMs: number): () => void {
    let remaining = durationMs, started = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const sync = () => {
      if (cancelled) return;
      if (this.paused && timer !== null) {
        clearTimeout(timer); timer = null;
        remaining = Math.max(0, remaining - (Date.now() - started));
      } else if (!this.paused && timer === null) {
        started = Date.now();
        timer = setTimeout(() => { timer = null; cancelled = true; remove(); fn(); }, remaining);
      }
    };
    const remove = this.subscribe(sync);
    sync();
    return () => { cancelled = true; remove(); if (timer !== null) clearTimeout(timer); };
  }
  private changed() { for (const fn of this.listeners) fn(); }
  observeVisibility(doc = document) {
    const changed = () => this.set('hidden', doc.hidden);
    doc.addEventListener('visibilitychange', changed);
    changed();
    return () => doc.removeEventListener('visibilitychange', changed);
  }
}
export const lifecycle = new Lifecycle();
