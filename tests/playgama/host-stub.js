// Served by Playwright route interception only; never copied to public/ or dist/.
(() => {
  const listeners = new Map();
  const emitter = {
    on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    off(name, fn) { listeners.get(name)?.delete(fn); },
    emit(name, value) { for (const fn of listeners.get(name) ?? []) fn(value); },
  };
  const scenario = window.__scenario ?? {};
  const host = window.__host = { initializations: 0, messages: [], writes: [], requests: [], loadError: scenario.loadError, initError: scenario.initError, saveError: false, contexts: [], ...emitter };
  const NativeAudio = window.AudioContext;
  if (NativeAudio) window.AudioContext = class extends NativeAudio { constructor(...args) { super(...args); host.contexts.push(this); } };
  window.bridge = {
    EVENT_NAME: { PAUSE_STATE_CHANGED: 'pause_state_changed', AUDIO_STATE_CHANGED: 'audio_state_changed', INTERSTITIAL_STATE_CHANGED: 'interstitial_state_changed', REWARDED_STATE_CHANGED: 'rewarded_state_changed' },
    async initialize() { host.initializations++; if (host.initError) throw new Error('Injected initialization error'); await fetch('./playgama-bridge-config.json').then((r) => r.json()); },
    platform: { language: scenario.language ?? 'en', isAudioEnabled: true, isPaused: false, ...emitter, async sendMessage(message) { host.messages.push(message); } },
    storage: {
      async get(keys) { if (host.loadError) throw new Error('Injected load error'); return keys.map((k) => scenario.malformed ? 'malformed' : scenario.saved ?? localStorage.getItem(`test-host:${k}`)); },
      async set(keys, values) { if (host.saveError) throw new Error('Injected save error'); keys.forEach((k, i) => localStorage.setItem(`test-host:${k}`, values[i])); host.writes.push(...values); },
    },
    advertisement: { ...emitter, isInterstitialSupported: true, isRewardedSupported: true, rewardedPlacement: null,
      showInterstitial(placement) { host.requests.push(['interstitial', placement]); },
      showRewarded(placement) { this.rewardedPlacement = placement; host.requests.push(['rewarded', placement]); },
    },
  };
})();
