import { getStore, setPlatformStore, DB_NAME, type Store } from '../persistence/database';
import { hydrateSettings, useSettingsStore } from '../stores/settingsStore';
import { hydrateBuildPreferences } from '../stores/buildStore';
import { bridge, initializeBridge } from './playgama';
import { bridgeStorage } from './storage';
import { lifecycle } from './lifecycle';
import { resolveLanguage } from './localization';

let pending: Promise<void> | null = null;
export function initializeGame(): Promise<void> {
  if (!pending) pending = (async () => {
    lifecycle.set('loading', true);
    await initializeBridge();
    let legacy: (() => Promise<Store | undefined>) | undefined;
    if (typeof indexedDB !== 'undefined') {
      // Probe legacy storage only if Bridge reports no save. A valid cloud save
      // must remain usable even when this browser blocks IndexedDB.
      legacy = async () => {
        const databases = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : null;
        if (databases && !databases.some((d) => d.name === DB_NAME)) return undefined;
        return getStore();
      };
    }
    let local: Storage | undefined;
    let session: Storage | undefined;
    try { local = window.localStorage; } catch { /* blocked legacy storage has no readable preferences */ }
    try { session = window.sessionStorage; } catch { /* no readable legacy rejoin token */ }
    await bridgeStorage.load(bridge.storage, legacy, local, session);
    setPlatformStore(bridgeStorage);
    hydrateSettings();
    hydrateBuildPreferences();
    document.documentElement.lang = resolveLanguage(bridge.platform.language, bridgeStorage.getItem('wildblocks.language'));
    lifecycle.setAudio(bridge.platform.isAudioEnabled, useSettingsStore.getState().audio.master > 0);
    lifecycle.set('loading', false);
  })().catch((e: unknown) => { pending = null; throw e; });
  return pending;
}
