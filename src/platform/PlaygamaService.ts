import type { PlatformService } from './PlatformService';

/**
 * Playgama Bridge integration, based on the official Plain-JS docs
 * (https://wiki.playgama.com — Bridge SDK). Only documented calls are used:
 *   bridge.initialize(), bridge.platform.sendMessage('game_ready'),
 *   bridge.platform.on(bridge.EVENT_NAME.PAUSE_STATE_CHANGED, isPaused => …),
 *   bridge.advertisement.isRewardedSupported, bridge.advertisement.showRewarded(),
 *   bridge.advertisement.on(bridge.EVENT_NAME.REWARDED_STATE_CHANGED, state => …)  // 'opened' | 'closed' | 'rewarded'
 *   bridge.platform.language
 *
 * The SDK script is only present when the build is hosted on Playgama (see
 * README → "Playgama build"). Ad policy: rewarded ads are strictly optional and
 * player-initiated (cosmetic scarf dye); no interstitials during play.
 */
interface BridgeLike {
  initialize(): Promise<void>;
  EVENT_NAME: { PAUSE_STATE_CHANGED: string; REWARDED_STATE_CHANGED: string };
  platform: { sendMessage(msg: string): void; on(ev: string, cb: (v: unknown) => void): void; language: string };
  advertisement: { isRewardedSupported: boolean; showRewarded(): void; on(ev: string, cb: (state: string) => void): void };
}

export class PlaygamaService implements PlatformService {
  readonly name = 'playgama';
  private ready = false;
  private pauseListeners: ((p: boolean) => void)[] = [];
  private rewardResolve: ((granted: boolean) => void) | null = null;
  private rewarded = false;

  private get bridge(): BridgeLike | undefined {
    return (window as unknown as { bridge?: BridgeLike }).bridge;
  }

  async init(): Promise<void> {
    const b = this.bridge;
    if (!b) throw new Error('Playgama bridge script not present');
    await b.initialize();
    this.ready = true;
    b.platform.on(b.EVENT_NAME.PAUSE_STATE_CHANGED, (isPaused) => {
      for (const l of this.pauseListeners) l(Boolean(isPaused));
    });
    b.advertisement.on(b.EVENT_NAME.REWARDED_STATE_CHANGED, (state) => {
      if (state === 'rewarded') this.rewarded = true;
      if (state === 'closed' || state === 'failed') {
        this.rewardResolve?.(this.rewarded);
        this.rewardResolve = null;
        this.rewarded = false;
      }
    });
  }

  gameReady(): void {
    if (this.ready) this.bridge?.platform.sendMessage('game_ready');
  }

  onPauseChange(cb: (paused: boolean) => void): void {
    this.pauseListeners.push(cb);
    document.addEventListener('visibilitychange', () => cb(document.hidden));
  }

  rewardedAvailable(): boolean {
    return this.ready && !!this.bridge?.advertisement.isRewardedSupported;
  }

  showRewarded(): Promise<boolean> {
    const b = this.bridge;
    if (!this.rewardedAvailable() || !b) return Promise.resolve(false);
    return new Promise((resolve) => {
      this.rewardResolve = resolve;
      this.rewarded = false;
      b.advertisement.showRewarded();
    });
  }

  language(): string {
    return this.bridge?.platform.language ?? 'en';
  }
}
