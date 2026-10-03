import type { PlatformService } from './PlatformService';

/** Standalone web build: no ads, pause follows tab visibility. */
export class BrowserPlatformService implements PlatformService {
  readonly name = 'browser';
  private listeners: ((p: boolean) => void)[] = [];

  async init(): Promise<void> {
    document.addEventListener('visibilitychange', () => {
      for (const l of this.listeners) l(document.hidden);
    });
  }

  gameReady(): void {}

  onPauseChange(cb: (paused: boolean) => void): void {
    this.listeners.push(cb);
  }

  rewardedAvailable(): boolean {
    return false;
  }

  async showRewarded(): Promise<boolean> {
    return false;
  }

  language(): string {
    return (navigator.language || 'en').slice(0, 2);
  }
}
