import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PauseMenu } from './PauseMenu';
import { useGameStore, type WorldSummary } from '../../stores/gameStore';

// Node render checks need current scenario values rather than Zustand's SSR bootstrap snapshot.
vi.mock('../../stores/gameStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../stores/gameStore')>();
  const store = actual.useGameStore;
  return { ...actual, useGameStore: Object.assign((select: (state: ReturnType<typeof store.getState>) => unknown) => select(store.getState()), store) };
});

const before = useGameStore.getState();
afterEach(() => { useGameStore.setState(before); });

describe('Pause-menu rescue visibility', () => {
  it.each(['survival', 'build', 'pvp'] as const)('offers Quick Respawn directly after resume in %s', (mode) => {
    const world: WorldSummary = { id: 'pause-test', name: 'Test', seed: '1', difficulty: 'explorer', mode };
    useGameStore.setState({ world });
    const html = renderToStaticMarkup(createElement(PauseMenu));
    expect(html).toContain(mode === 'build' ? 'Build Home project' : mode === 'pvp' ? 'PvP Battle' : '🍃 Paused');
    expect(html).toContain('🆘 Quick Respawn');
    expect(html).toContain('Keeps your health and items.');
    expect(html.indexOf('autofocus')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('autofocus')).toBeLessThan(html.indexOf('Quick Respawn'));
    expect(html.indexOf('Quick Respawn')).toBeLessThan(html.indexOf('>Settings</button>'));
  });

  it('keeps Quick Respawn out of the Deathmatch panel', () => {
    useGameStore.setState({ world: { id: 'dm-test', name: 'Deathmatch', seed: '1', difficulty: 'explorer', mode: 'deathmatch' } });
    expect(renderToStaticMarkup(createElement(PauseMenu))).not.toContain('Quick Respawn');
  });
});
