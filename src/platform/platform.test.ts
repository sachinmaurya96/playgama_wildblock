import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AdController, REWARDED_PLACEMENT, type RewardContext } from './ads';
import { Lifecycle } from './lifecycle';
import { BridgeStore, SAVE_KEY, parseSave, encodeSave } from './storage';
import { resolveLanguage } from './localization';
import type { WorldMeta } from '../persistence/types';
import { getStore, resetStoreForTests } from '../persistence/database';
import { parseSettings } from '../stores/settingsStore';

const events = { INTERSTITIAL_STATE_CHANGED: 'interstitial_state_changed', REWARDED_STATE_CHANGED: 'rewarded_state_changed' } as const;
const context: RewardContext = { token: 'one', placement: REWARDED_PLACEMENT, worldId: 'world', reward: 'starlight' };
function fixture() {
  const listeners = new Map<string, Set<(v: string) => void>>();
  const api = {
    isInterstitialSupported: true, isRewardedSupported: true, rewardedPlacement: REWARDED_PLACEMENT,
    showInterstitial: vi.fn(), showRewarded: vi.fn(),
    on: (key: string, cb: (v: string) => void) => { if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key)!.add(cb); },
    off: (key: string, cb?: (v: string) => void) => { if (cb) listeners.get(key)?.delete(cb); },
  };
  const state = new Lifecycle();
  const ads = new AdController(api, events, state, 100, 10); ads.install();
  const emit = (value: string, kind = 'rewarded') => { for (const fn of listeners.get(`${kind}_state_changed`) ?? []) fn(value); };
  return { api, state, ads, emit, listeners };
}
describe('ad sequencing and competing interruptions', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('grants once from success; reward never releases the overlay or saved user mute', async () => {
    const f = fixture(), grant = vi.fn(async (_context: Readonly<RewardContext>) => {});
    f.state.setAudio(true, false); f.state.set('user', true);
    const earned = f.ads.rewarded(context, grant);
    expect(await f.ads.rewarded({ ...context, token: 'two' }, grant)).toBe(false);
    f.emit('opened'); f.emit('rewarded'); f.emit('rewarded');
    await Promise.resolve(); expect(grant).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(grant.mock.calls[0][0])).toBe(true);
    expect(f.state.has('ad')).toBe(true);
    f.emit('closed'); await vi.advanceTimersByTimeAsync(10);
    expect(await earned).toBe(true); expect(f.state.has('user')).toBe(true); expect(f.state.audioEnabled).toBe(false);
  });
  it('preserves the exact context when closed precedes rewarded; excludes another request', async () => {
    const f = fixture(), grant = vi.fn(async () => {}), earned = f.ads.rewarded(context, grant);
    f.emit('opened'); f.emit('closed');
    expect(f.ads.busy).toBe(true); f.emit('rewarded'); await vi.advanceTimersByTimeAsync(10);
    expect(await earned).toBe(true); expect(grant).toHaveBeenCalledWith(context);
  });
  it.each(['closed', 'failed'])('never grants for %s alone', async (event) => {
    const f = fixture(), grant = vi.fn(async () => {}), earned = f.ads.rewarded(context, grant);
    f.emit(event); await vi.advanceTimersByTimeAsync(10);
    expect(await earned).toBe(false); expect(grant).not.toHaveBeenCalled(); expect(f.ads.busy).toBe(false);
  });
  it('ignores a reward for a different placement', async () => {
    const f = fixture(), grant = vi.fn(async () => {}), earned = f.ads.rewarded(context, grant);
    f.api.rewardedPlacement = 'other'; f.emit('rewarded'); f.emit('closed'); await vi.advanceTimersByTimeAsync(10);
    expect(await earned).toBe(false); expect(grant).not.toHaveBeenCalled();
  });
  it('handles unsupported and synchronous SDK exceptions', async () => {
    const f = fixture(), grant = vi.fn(async () => {});
    f.api.isRewardedSupported = false; expect(await f.ads.rewarded(context, grant)).toBe(false);
    f.api.isRewardedSupported = true; f.api.showRewarded.mockImplementation(() => { throw new Error('no fill'); });
    expect(await f.ads.rewarded(context, grant)).toBe(false); expect(f.state.paused).toBe(false);
  });
  it('bounds a missing-open request, ignores its late reward, and pauses an unexpectedly late overlay', async () => {
    const f = fixture(), grant = vi.fn(async () => {}), earned = f.ads.rewarded(context, grant);
    await vi.advanceTimersByTimeAsync(100); expect(await earned).toBe(false); expect(f.state.paused).toBe(false);
    f.emit('opened'); f.emit('rewarded'); expect(f.state.has('ad')).toBe(true);
    f.emit('closed'); expect(f.state.paused).toBe(false); expect(grant).not.toHaveBeenCalled();
  });
  it('never times out an opened or host-paused overlay', async () => {
    const f = fixture(); void f.ads.rewarded(context, async () => {}); f.emit('opened'); f.state.set('platform', true);
    await vi.advanceTimersByTimeAsync(1000); expect(f.state.paused).toBe(true);
    f.emit('closed'); await vi.advanceTimersByTimeAsync(10); expect(f.state.has('platform')).toBe(true);
  });
  it('honors the interval and recovers interstitial close/failure', async () => {
    const f = fixture(); expect(await f.ads.interstitial()).toBe(false);
    await vi.advanceTimersByTimeAsync(90000); const shown = f.ads.interstitial();
    f.emit('opened', 'interstitial'); expect(f.state.paused).toBe(true);
    f.emit('closed', 'interstitial'); await vi.advanceTimersByTimeAsync(1); await shown;
    expect(f.state.paused).toBe(false); expect(f.api.showInterstitial).toHaveBeenCalledWith('return_to_menu');
    await vi.advanceTimersByTimeAsync(90000); const failed = f.ads.interstitial(); f.emit('failed', 'interstitial');
    expect(await failed).toBe(false); expect(f.ads.busy).toBe(false);
  });
  it('cleans SDK listeners and installs them only once', () => {
    const f = fixture(); f.ads.install(); expect(f.listeners.get(events.REWARDED_STATE_CHANGED)?.size).toBe(1);
    f.ads.dispose(); expect(f.listeners.get(events.REWARDED_STATE_CHANGED)?.size).toBe(0);
  });
  it('keeps user, platform and hidden reasons independent', () => {
    const state = new Lifecycle(); state.set('user', true); state.set('platform', true); state.set('hidden', true);
    state.set('platform', false); state.set('hidden', false); expect(state.paused).toBe(true); expect(state.audioEnabled).toBe(false);
    state.set('user', false); state.setAudio(false); expect(state.audioEnabled).toBe(false);
  });
  it('freezes scheduled game delays with remaining time through competing pauses', async () => {
    const state = new Lifecycle(), action = vi.fn();
    const cancel = state.delay(action, 100);
    await vi.advanceTimersByTimeAsync(30); state.set('platform', true); state.set('hidden', true);
    await vi.advanceTimersByTimeAsync(500); state.set('platform', false); expect(action).not.toHaveBeenCalled();
    state.set('hidden', false); await vi.advanceTimersByTimeAsync(69); expect(action).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(action).toHaveBeenCalledOnce(); cancel();
  });
});

const meta: WorldMeta = { id: 'old', name: 'Legacy', seed: 42, seedText: 'seed', difficulty: 'explorer', peacefulCreatures: false, createdAt: 1, lastPlayed: 2, playTime: 3, saveVersion: 1, mode: 'survival' };
describe('Bridge storage integrity', () => {
  it('migrates existing IndexedDB worlds, maps and preferences only when the Bridge key is absent', async () => {
    await resetStoreForTests(); const old = await getStore(); await old.putWorld(meta);
    await old.putChunks([{ key: 'old|1,0', worldId: 'old', cx: 1, cz: 0, changes: [[20, 4]], saveVersion: 1 }]);
    await old.putMaps([{ key: 'old|1,0', worldId: 'old', cx: 1, cz: 0, colors: new Uint8Array([255]) }]);
    let raw: string | null = null; const api = { get: async () => [raw], set: async (_k: string[], v: string[]) => { raw = v[0]; } };
    const legacy = vi.fn(async () => old), migrated = new BridgeStore();
    await migrated.load(api, legacy, { getItem: (k) => k === 'wildblocks.settings.v1' ? '{"v":1,"audio":{"master":0}}' : null });
    expect(await migrated.getWorld('old')).toEqual(meta); expect((await migrated.getMaps('old'))[0].colors).toEqual(new Uint8Array([255]));
    expect(await old.getWorld('old')).toEqual(meta); expect(raw).toBeTruthy();
    const restored = new BridgeStore(); await restored.load(api, legacy); expect(legacy).toHaveBeenCalledOnce();
    expect((await restored.getChunks('old'))[0].changes).toEqual([[20, 4]]);
    await resetStoreForTests();
  });
  it('distinguishes missing, failed and malformed loads; no writes erase unknown remote data', async () => {
    const store = new BridgeStore(), set = vi.fn(async () => {});
    await expect(store.load({ get: async () => { throw new Error('offline'); }, set })).rejects.toThrow('offline');
    await expect(store.flush()).rejects.toThrow('not loaded'); expect(set).not.toHaveBeenCalled();
    await expect(store.load({ get: async () => ['bad JSON'], set })).rejects.toThrow(); expect(set).not.toHaveBeenCalled();
    await store.load({ get: async () => [null], set }); expect(await store.listWorlds()).toEqual([]); expect(set).not.toHaveBeenCalled();
  });
  it('serializes async checkpoints and retains a failed write for retry', async () => {
    const store = new BridgeStore(), saved: string[] = []; let release!: () => void;
    let first = true;
    await store.load({ get: async () => [null], set: async (_k, values) => { if (first) { first = false; await new Promise<void>((r) => { release = r; }); } saved.push(values[0]); } });
    store.setItem('score', '1'); const a = store.flush(); await Promise.resolve();
    store.setItem('score', '2'); const b = store.flush(); await Promise.resolve(); expect(saved).toEqual([]);
    release(); await Promise.all([a, b]); expect(parseSave(saved.at(-1)).preferences.score).toBe('2');
    const set = vi.fn(async (): Promise<void> => { throw new Error('quota'); }); const failed = new BridgeStore();
    await failed.load({ get: async () => [null], set }); failed.setItem('reward', 'true'); await expect(failed.flush()).rejects.toThrow('quota');
    expect(failed.getItem('reward')).toBe('true'); expect(failed.error).toBeTruthy();
    set.mockImplementation(async () => {}); await failed.flush(); expect(failed.error).toBeNull();
  });
  it('round-trips old-world block edits and typed map tiles without changing schemas', async () => {
    let raw: string | null = null; const api = { get: async () => [raw], set: async (_k: string[], values: string[]) => { raw = values[0]; } };
    const s = new BridgeStore(); await s.load(api); await s.putWorld(meta);
    await s.putChunks([{ key: 'old|0,0', worldId: 'old', cx: 0, cz: 0, saveVersion: 1, changes: [[4, 22]] }]);
    await s.putMaps([{ key: 'old|0,0', worldId: 'old', cx: 0, cz: 0, colors: new Uint8Array([1, 2, 255]) }]);
    const restored = new BridgeStore(); await restored.load(api);
    expect(await restored.getWorld('old')).toEqual(meta); expect((await restored.getChunks('old'))[0].changes).toEqual([[4, 22]]);
    expect((await restored.getMaps('old'))[0].colors).toEqual(new Uint8Array([1, 2, 255]));
    expect(SAVE_KEY).toBe('wildblocks.bridge.v1');
  });
  it('rejects unknown schema versions and invalid map bytes', () => {
    expect(() => parseSave('{"schemaVersion":99}')).toThrow('Unsupported');
    expect(() => parseSave('{"type":"Uint8Array","bytes":[999]}')).toThrow('Invalid');
    const s = new BridgeStore(); expect(parseSave(encodeSave(s.document)).schemaVersion).toBe(1);
  });
  it('uses English fallback for undeclared host languages and retains deliberate English choice', () => {
    expect(resolveLanguage('ru-RU')).toBe('en'); expect(resolveLanguage('de', 'en')).toBe('en');
  });
  it('validates malformed preference types and bounds before applying them', () => {
    const settings = parseSettings('{"audio":{"master":"wrong","music":4},"graphics":{"renderDistance":999,"preset":"nonsense"},"controls":{"keys":{"forward":5}}}');
    expect(settings.audio.master).toBe(0.8); expect(settings.audio.music).toBe(1); expect(settings.graphics.renderDistance).toBe(12); expect(settings.graphics.preset).toBe('auto'); expect(settings.controls.keys.forward).toBe('KeyW');
  });
});
