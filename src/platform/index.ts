import { BrowserPlatformService } from './BrowserPlatformService';
import type { PlatformService } from './PlatformService';
import { PlaygamaService } from './PlaygamaService';

/** Picks the Playgama service when its bridge script is on the page, otherwise the plain browser service. */
function choose(): PlatformService {
  const hasBridge = typeof window !== 'undefined' && !!(window as unknown as { bridge?: unknown }).bridge;
  return hasBridge ? new PlaygamaService() : new BrowserPlatformService();
}

class PlatformFacade implements PlatformService {
  private impl: PlatformService = choose();
  get name() {
    return this.impl.name;
  }
  async init() {
    try {
      await this.impl.init();
    } catch (e) {
      console.warn('[WildBlocks] platform init failed, falling back to browser mode', e);
      this.impl = new BrowserPlatformService();
      await this.impl.init();
    }
  }
  gameReady() {
    this.impl.gameReady();
  }
  onPauseChange(cb: (p: boolean) => void) {
    this.impl.onPauseChange(cb);
  }
  rewardedAvailable() {
    return this.impl.rewardedAvailable();
  }
  showRewarded() {
    return this.impl.showRewarded();
  }
  language() {
    return this.impl.language();
  }
}

export const platform = new PlatformFacade();
export type { PlatformService };
