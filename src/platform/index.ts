import { initializeBridge, gameReady, getAds, bridge } from './playgama';
import { lifecycle } from './lifecycle';
export const platform = {
  name: 'playgama',
  init: initializeBridge,
  gameReady,
  language: () => bridge.platform.language,
  onPauseChange(cb: (paused: boolean) => void) { return lifecycle.subscribe(() => cb(lifecycle.paused)); },
  rewardedAvailable: () => getAds()?.rewardedAvailable ?? false,
};
