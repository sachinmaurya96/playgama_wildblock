import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { launchPvp, takePendingLaunch } from '../app/launch';
import { useGameStore } from '../stores/gameStore';
import { DEFAULT_PVP_SETTINGS, type PvpSource } from '../stores/pvpStore';
import { joinRoom, pvpNet, type WelcomeMsg } from './pvpNet';
import { joinLocal, joinOnline, type Transport } from './transport';

vi.mock('./transport', async (importOriginal) => ({
  ...await importOriginal<typeof import('./transport')>(), joinLocal: vi.fn(), joinOnline: vi.fn(),
}));
vi.mock('../game/core/audio', () => ({ audio: { init: vi.fn() } }));

const originalGame = useGameStore.getState();
let transport: Transport;
let welcome: WelcomeMsg;

beforeEach(() => {
  welcome = {
    t: 'welcome', you: 'guest', seedText: 'shared', time: 200, players: [], edits: [], timeLeft: null,
    settings: { ...DEFAULT_PVP_SETTINGS, seedText: 'shared' },
  };
  transport = {
    selfId: 'guest', isHost: false, peers: () => ['host'],
    onMessage() {}, onPeerJoin() {}, onPeerLeave() {}, onClosed() {},
    send: vi.fn((msg) => { if (msg.t === 'hello') transport.onMessage('host', welcome); }),
    close: vi.fn(),
  };
  vi.mocked(joinOnline).mockReset().mockResolvedValue(transport);
  vi.mocked(joinLocal).mockReset().mockResolvedValue(transport);
});
afterEach(() => {
  pvpNet.leave();
  useGameStore.setState(originalGame);
});

describe('joining a friend’s shared map by room code', () => {
  it('ignores a legacy room countdown in received settings', async () => {
    welcome.settings.minutes = 10;
    welcome.timeLeft = 90;
    const session = await joinRoom({ code: 'ABC234', name: 'Guest', color: '#ff0000', online: false });
    expect(session.settings.minutes).toBe(0);
  });
  it.each(['survival', 'build'] as const)('uses the host’s %s map and settings for a code-only guest', async (kind) => {
    const source: PvpSource = {
      kind, name: 'Friend’s map', seed: 12345, caves: 2,
      spawn: { x: 18, y: 51, z: -12 }, ...(kind === 'build' ? { arena: 'coastal' as const } : {}),
    };
    welcome.settings = { ...welcome.settings, style: 'together', source };
    const session = await joinRoom({ code: ' ab c234 ', name: 'Guest', color: '#ff0000', online: true });
    expect(joinOnline).toHaveBeenCalledExactlyOnceWith('ABC234');
    expect(session.code).toBe('ABC234');
    expect(session.settings.source).toEqual(source);
    expect(transport.send).toHaveBeenCalledWith({ t: 'hello', name: 'Guest', color: '#ff0000' });
    launchPvp(session);
    const launch = takePendingLaunch()!;
    expect(launch.meta.seed).toBe(source.seed);
    expect(launch.meta.caves).toBe(source.caves);
    expect(launch.meta.name).toContain(source.name);
    expect(launch.meta.mode).toBe(kind === 'build' ? 'build' : 'pvp');
    if (kind === 'build') {
      expect(launch.meta.coop).toBe('guest');
      expect(launch.meta.build?.plot).toBe('coastal');
    }
    expect(useGameStore.getState().screen).toBe('loading');
  });

  it('also supports the existing same-device connection', async () => {
    const session = await joinRoom({ code: 'abc234', name: 'Guest', color: '#ff0000', online: false });
    expect(joinLocal).toHaveBeenCalledExactlyOnceWith('ABC234');
    expect(joinOnline).not.toHaveBeenCalled();
    expect(session.online).toBe(false);
  });

  it('rejects an incomplete room code before trying a connection', async () => {
    await expect(joinRoom({ code: 'ABC', name: 'Guest', color: '#ff0000', online: true })).rejects.toThrow('6 letters/numbers');
    expect(joinOnline).not.toHaveBeenCalled();
  });
});
