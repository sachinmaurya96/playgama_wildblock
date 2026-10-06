import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../Game';
import { useGameStore } from '../../stores/gameStore';
import { useBuildStore } from '../../stores/buildStore';
import { writeSave } from '../../persistence/SaveManager';

vi.mock('../../persistence/SaveManager', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../persistence/SaveManager')>(), writeSave: vi.fn(),
}));

const originalBuild = useBuildStore.getState();
const originalGame = useGameStore.getState();
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};
let game: Game;
let snapshot: ReturnType<typeof vi.fn>;

beforeEach(() => {
  snapshot = vi.fn().mockReturnValue({});
  game = Object.assign(Object.create(Game.prototype), {
    ready: true, disposed: false, savePromise: null, dm: null, pvp: null, build: null,
    meta: { id: 'save-test', thumbnail: 'existing-thumbnail' },
    clock: { playTime: 10 }, containers: { set: vi.fn() },
    pendingMaps: [], world: { dirtyMods: new Set() },
    buildState: snapshot, render: vi.fn(),
  }) as Game;
  vi.mocked(writeSave).mockReset().mockResolvedValue();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  useBuildStore.setState(originalBuild);
  useGameStore.setState(originalGame);
});

describe('game save coordination', () => {
  it('waits for an autosave and takes a fresh snapshot before quitting', async () => {
    const firstWrite = deferred<void>();
    const quitWrite = deferred<void>();
    vi.mocked(writeSave).mockReturnValueOnce(firstWrite.promise).mockReturnValueOnce(quitWrite.promise);
    const auto = game.saveNow('auto');
    const quit = game.saveNow('quit');
    let finished = false;
    void quit.then(() => { finished = true; });
    expect(writeSave).toHaveBeenCalledTimes(1);
    firstWrite.resolve();
    expect(await auto).toBe(true);
    await vi.waitFor(() => expect(writeSave).toHaveBeenCalledTimes(2));
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(finished).toBe(false);
    quitWrite.resolve();
    expect(await quit).toBe(true);
  });

  it('shares an in-progress save for repeated autosave requests', async () => {
    const pending = deferred<void>();
    vi.mocked(writeSave).mockReturnValueOnce(pending.promise);
    const first = game.saveNow('auto');
    const second = game.saveNow('quiet');
    pending.resolve();
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(writeSave).toHaveBeenCalledTimes(1);
  });

  it('returns failure and retains map tiles ahead of new tiles for retry', async () => {
    const oldTile = { key: 'old' }, newTile = { key: 'new' };
    const internals = game as unknown as { pendingMaps: unknown[] };
    internals.pendingMaps = [oldTile];
    vi.mocked(writeSave).mockImplementationOnce(async () => {
      internals.pendingMaps.push(newTile);
      throw new Error('storage full');
    });
    expect(await game.saveNow('quit')).toBe(false);
    expect(internals.pendingMaps).toEqual([oldTile, newTile]);
    expect(await game.saveNow('quit')).toBe(true);
    expect(vi.mocked(writeSave).mock.calls[1][3]).toEqual([oldTile, newTile]);
    expect(internals.pendingMaps).toEqual([]);
  });

  it.each(['objects', 'blocks'] as const)('keeps a project dirty when %s change during a save', async (kind) => {
    const build = { objects: { revision: 5 } };
    Object.assign(game, { build });
    useBuildStore.setState({ dirty: true });
    vi.mocked(writeSave).mockImplementationOnce(async () => {
      if (kind === 'objects') build.objects.revision++;
      else game.world.dirtyMods.add(42);
    });
    expect(await game.saveNow('quiet')).toBe(true);
    expect(useBuildStore.getState().dirty).toBe(true);
  });

  it('marks a successfully saved unchanged project clean', async () => {
    Object.assign(game, { build: { objects: { revision: 5 } } });
    useBuildStore.setState({ dirty: true });
    expect(await game.saveNow('quiet')).toBe(true);
    expect(useBuildStore.getState().dirty).toBe(false);
  });

  it('skips temporary matches and refuses saves after disposal', async () => {
    Object.assign(game, { dm: {} });
    expect(await game.saveNow('quit')).toBe(true);
    Object.assign(game, { dm: null, disposed: true });
    expect(await game.saveNow('quit')).toBe(false);
    expect(writeSave).not.toHaveBeenCalled();
  });
});
