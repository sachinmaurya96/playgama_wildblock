/**
 * Everything portal-specific goes through this interface so the core game never
 * calls a platform SDK directly. The browser implementation is a no-op default.
 */
export interface PlatformService {
  readonly name: string;
  init(): Promise<void>;
  /** Called once the first world is interactive. */
  gameReady(): void;
  /** Pause / resume requests coming from the host page (e.g. ad shown, tab hidden). */
  onPauseChange(cb: (paused: boolean) => void): void;
  /** Optional rewarded ad for a cosmetic bonus. Resolves true only if the reward was granted. */
  rewardedAvailable(): boolean;
  showRewarded(): Promise<boolean>;
  language(): string;
}
