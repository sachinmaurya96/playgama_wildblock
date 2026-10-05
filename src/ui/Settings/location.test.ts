import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Game } from '../../game/Game';
import { useGameStore } from '../../stores/gameStore';
import { LocationPanel, parseCoords } from '../HUD/PvpHud';
import { SettingsScreen } from './SettingsScreen';

const previousScreen = useGameStore.getState().screen;
afterEach(() => {
  Game.current = null;
  useGameStore.setState({ screen: previousScreen });
});

describe('Build Home settings location controls', () => {
  it('shows coordinates and teleport in a solo project', () => {
    Game.current = { isBuild: true, build: {}, player: { position: { x: 12.5, y: 41.05, z: -6.5 } } } as unknown as Game;
    const html = renderToStaticMarkup(createElement(SettingsScreen, { inGame: true }));
    expect(html).toContain('📍 Location');
    expect(html).toContain('12 41 -7');
    expect(html).toContain('Coordinates to teleport to');
    expect(html).toContain('Teleport');
  });

  it('shows friends and their coordinates in a shared Build Home', () => {
    Game.current = {
      isBuild: true, build: {}, player: { position: { x: 0.5, y: 41.05, z: 0.5 } },
      pvp: { playerSpots: () => [
        { id: 'me', name: 'You', color: 'red', x: 0, y: 41, z: 0, dist: 0, me: true },
        { id: 'friend', name: 'Friend', color: 'blue', x: 20, y: 44, z: -10, dist: 22, me: false },
      ] },
    } as unknown as Game;
    const html = renderToStaticMarkup(createElement(LocationPanel, { onDone: () => {} }));
    expect(html).toContain('Friend');
    expect(html).toContain('20 44 -10');
    expect(html).toContain('>Go</button>');
  });

  it('does not add teleport to Deathmatch settings', () => {
    Game.current = { isBuild: false } as unknown as Game;
    const html = renderToStaticMarkup(createElement(SettingsScreen, { inGame: true }));
    expect(html).not.toContain('Coordinates to teleport to');
  });
});

describe('coordinate input validation', () => {
  it('accepts two or three signed coordinates with spaces, commas or slashes', () => {
    expect(parseCoords('20 -35')).toEqual({ x: 20, z: -35 });
    expect(parseCoords('20, 41, -35')).toEqual({ x: 20, y: 41, z: -35 });
    expect(parseCoords('+20/41.5/-.5')).toEqual({ x: 20, y: 41.5, z: -0.5 });
  });

  it.each(['', 'hello 20 41 -35', '20oops 41 -35', '1e2 40 3', '--2 41 2', 'Infinity 40 3', '1 2 3 4'])('rejects malformed input %s instead of teleporting to extracted digits', (text) => {
    expect(parseCoords(text)).toBeNull();
  });
});
