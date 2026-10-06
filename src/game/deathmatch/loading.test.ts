import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../Game';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useWorldStore } from '../../stores/worldStore';
import { CITY_G } from './DeathmatchMap';
import { LOAD_TIMEOUT_SECONDS } from './DeathmatchRules';

const originalInventory = useInventoryStore.getState();
const originalWorld = useWorldStore.getState();

function setup(radius = 4) {
  const begin = vi.fn();
  const generateIcons = vi.fn().mockResolvedValue(undefined);
  const readiness = vi.fn().mockReturnValue(1);
  const player = {
    position: new THREE.Vector3(), yaw: 0, pitch: 1, cameraMode: 'third',
    teleport: vi.fn(function (x: number, y: number, z: number) { player.position.set(x, y, z); }),
    lookDirection: () => new THREE.Vector3(1, 0, 0),
  };
  const chunks = { renderRadius: radius, update: vi.fn(), readiness };
  const game = Object.assign(Object.create(Game.prototype), {
    disposed: false, ready: false, dm: { team: 'red', begin },
    assets: { generateIcons }, player, chunks, input: {},
    env: { setWeather: vi.fn(), cover: 0, rain: 1 },
    clock: { dayFraction: 0, time: 0, dayLength: 1200 },
    ensureSafePosition: vi.fn(),
  }) as Game;
  return { game, begin, generateIcons, readiness, player, chunks };
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
afterEach(() => {
  vi.useRealTimers();
  useInventoryStore.setState(originalInventory);
  useWorldStore.setState(originalWorld);
});

describe('Deathmatch loading on slower devices', () => {
  it.each([3, 4, 8])('starts on safe spawn terrain at distance %i without survival icons', async (radius) => {
    const { game, begin, generateIcons, readiness, player, chunks } = setup(radius);
    // Farther city meshes are still loading; the spawn neighbourhood is ready.
    readiness.mockImplementation((needed: number) => needed <= 2 ? 1 : 0.25);
    await game.start(null, vi.fn());
    expect(generateIcons).not.toHaveBeenCalled();
    expect(begin).toHaveBeenCalledOnce();
    expect(game.ready).toBe(true);
    expect(player.position.toArray()).toEqual([-70, CITY_G + 1.05, 0]);
    expect(player.cameraMode).toBe('first');
    expect(chunks.renderRadius).toBe(radius);
  });

  it('waits for real terrain readiness past the old 25-second cutoff', async () => {
    const { game, begin, readiness } = setup();
    readiness.mockReturnValue(0.5);
    const loading = game.start(null, vi.fn());
    await vi.advanceTimersByTimeAsync(30000);
    expect(begin).not.toHaveBeenCalled();
    expect(game.ready).toBe(false);
    readiness.mockReturnValue(1);
    await vi.advanceTimersByTimeAsync(30);
    await loading;
    expect(begin).toHaveBeenCalledOnce();
  });

  it('never announces ready if the city cannot load within the limit', async () => {
    const { game, begin, readiness } = setup();
    readiness.mockReturnValue(0);
    const result = game.start(null, vi.fn()).then(() => null, (error: Error) => error);
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_SECONDS * 1000 + 30);
    expect(await result).toMatchObject({ message: expect.stringContaining('could not finish loading') });
    expect(game.ready).toBe(false);
    expect(begin).not.toHaveBeenCalled();
  });

  it('stops loading when a cancelled room disposes the game', async () => {
    const { game, begin, readiness, chunks } = setup();
    readiness.mockReturnValue(0);
    const loading = game.start(null, vi.fn());
    Object.assign(game, { disposed: true });
    await vi.advanceTimersByTimeAsync(30);
    await loading;
    expect(begin).not.toHaveBeenCalled();
    expect(chunks.update).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
