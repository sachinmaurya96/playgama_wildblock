import bridge from '@playgama/bridge';
import { AdController } from './ads';
import { lifecycle } from './lifecycle';

let initialization: Promise<void> | null = null;
let ready = false;
let removeListeners: (() => void) | null = null;
let ads: AdController | null = null;
export function initializeBridge(): Promise<void> {
  if (!initialization) {
    initialization = bridge.initialize().then(() => {
      const pause = (v: boolean) => lifecycle.set('platform', v);
      const audio = (v: boolean) => lifecycle.setAudio(v);
      bridge.platform.on(bridge.EVENT_NAME.PAUSE_STATE_CHANGED, pause);
      bridge.platform.on(bridge.EVENT_NAME.AUDIO_STATE_CHANGED, audio);
      lifecycle.set('platform', bridge.platform.isPaused);
      lifecycle.setAudio(bridge.platform.isAudioEnabled);
      const visibility = lifecycle.observeVisibility();
      ads = new AdController(bridge.advertisement, bridge.EVENT_NAME);
      ads.install();
      removeListeners = () => {
        bridge.platform.off(bridge.EVENT_NAME.PAUSE_STATE_CHANGED, pause);
        bridge.platform.off(bridge.EVENT_NAME.AUDIO_STATE_CHANGED, audio);
        visibility(); ads?.dispose();
      };
    }).catch((e: unknown) => { initialization = null; throw e; });
  }
  return initialization;
}
export function gameReady(): void {
  if (ready || !initialization) return;
  ready = true;
  void bridge.platform.sendMessage('game_ready').catch((e: unknown) => console.error('[WildBlocks] Game Ready could not be delivered', e));
}
export function getAds(): AdController | null { return ads; }
export function disposeBridgeListeners(): void { removeListeners?.(); removeListeners = null; }
export { bridge };
