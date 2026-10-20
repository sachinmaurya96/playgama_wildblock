import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { createElement } from 'react';
import * as THREE from 'three';
import { renderToStaticMarkup } from 'react-dom/server';
import { Game } from '../Game';
import { BuildMode } from '../build/BuildMode';
import { Player } from '../player/Player';
import { PlayerInteraction } from '../player/PlayerInteraction';
import { World } from '../world/World';
import { InputManager } from './InputManager';
import { useGameStore } from '../../stores/gameStore';
import { useSettingsStore, DEFAULT_KEYS } from '../../stores/settingsStore';
import { useBuildStore } from '../../stores/buildStore';
import { usePvpStore } from '../../stores/pvpStore';
import { useDeathmatchStore } from '../../stores/deathmatchStore';
import { HUD } from '../../ui/HUD/HUD';
import { ControlsCard } from '../../ui/PauseMenu/PauseMenu';
import { lifecycle } from '../../platform/lifecycle';

const originalGame = useGameStore.getState();
const originalSettings = useSettingsStore.getState();
const originalBuild = useBuildStore.getState();
const originalPvp = usePvpStore.getState();
const originalDm = useDeathmatchStore.getState();
let input: InputManager;
let keyboard: EventTarget;
let doc: EventTarget & { pointerLockElement: HTMLElement | null; exitPointerLock: ReturnType<typeof vi.fn> };
let canvas: HTMLElement & { requestPointerLock: ReturnType<typeof vi.fn> };
let game: Game;

function press(code = 'Backquote', props: Record<string, unknown> = {}) {
  const event = new Event('keydown', { cancelable: true });
  for (const [key, value] of Object.entries({ code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...props })) {
    Object.defineProperty(event, key, { value });
  }
  keyboard.dispatchEvent(event);
  return event;
}

function mouse(target: EventTarget, type: string, props: Record<string, unknown> = {}) {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries({ button: 0, clientX: 320, clientY: 240, movementX: 10, movementY: 8, deltaY: 100, ...props })) {
    Object.defineProperty(event, key, { value });
  }
  target.dispatchEvent(event);
}

beforeEach(() => {
  keyboard = Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false }) });
  doc = Object.assign(new EventTarget(), {
    pointerLockElement: null as HTMLElement | null,
    documentElement: { classList: { contains: () => false } },
    exitPointerLock: vi.fn(() => { doc.pointerLockElement = null; doc.dispatchEvent(new Event('pointerlockchange')); }),
  });
  vi.stubGlobal('window', keyboard);
  vi.stubGlobal('document', doc);
  canvas = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    requestPointerLock: vi.fn(() => { doc.pointerLockElement = canvas; doc.dispatchEvent(new Event('pointerlockchange')); }),
  }) as unknown as typeof canvas;
  useSettingsStore.setState({ controls: { ...originalSettings.controls, keys: { ...DEFAULT_KEYS }, touch: 'off' } });
  useGameStore.setState({ screen: 'playing', overlay: null, cursorFree: false, hudHidden: false });
  useBuildStore.setState({ camera: 'player', cursorMode: false, walkthrough: false, photo: false });
  usePvpStore.setState({ gearOpen: false });
  useDeathmatchStore.setState({ optionsOpen: false, phase: 'playing' });
  input = new InputManager();
  input.attach(canvas);
  // Exercise the real game/input methods without constructing a WebGL renderer.
  game = Object.assign(Object.create(Game.prototype), {
    input, ready: true, disposed: false, suppressPause: false, build: null, pvp: null, dm: null,
    player: { dead: false },
    audio: { play: vi.fn() }, notify: vi.fn(),
  }) as Game;
  input.onCursorToggle = () => game.toggleCursor();
  input.onCursorChange = (free) => {
    useGameStore.setState({ cursorFree: free });
    if (game.build) useBuildStore.getState().set({ cursorMode: free && !game.build.usesFreeCamera() });
  };
  input.requestLock();
  canvas.requestPointerLock.mockClear();
});

afterEach(() => {
  input.detach();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Game.current = null;
  useGameStore.setState(originalGame);
  useSettingsStore.setState(originalSettings);
  useBuildStore.setState(originalBuild);
  usePvpStore.setState(originalPvp);
  useDeathmatchStore.setState(originalDm);
});

describe('desktop cursor shortcut', () => {
  it('accepts the inventory shortcut immediately after an ad closes, without retaining interrupted input', () => {
    useGameStore.setState({ overlay: 'inventory' });
    const close = vi.spyOn(game, 'closeOverlay').mockImplementation(() => {});
    const hotkeys = game as unknown as { handleKeys: () => void };
    const handleKeys = hotkeys.handleKeys.bind(game);
    vi.spyOn(hotkeys, 'handleKeys').mockImplementation(() => {
      handleKeys();
      // Stop this renderer-free test after the real hotkey handler runs.
      lifecycle.set('user', true);
    });
    try {
      press('KeyW');
      lifecycle.set('ad', true);
      game.update(1);
      expect(input.isDown('forward')).toBe(false);
      press('KeyE');
      expect(input.wasPressed('inventory')).toBe(false);
      lifecycle.set('ad', false);
      press('KeyE');
      expect(input.wasPressed('inventory')).toBe(true);
      game.update(1);
      expect(close).toHaveBeenCalledOnce();
    } finally {
      lifecycle.set('ad', false);
      lifecycle.set('user', false);
    }
  });

  it('releases without pausing, clears held actions, and restores mouse-look on the next press', () => {
    press('KeyW');
    input.mouseLeft = input.mouseLeftPressed = true;
    input.lookX = 42;
    const intentionalUnlock: boolean[] = [];
    input.onLockLost = () => intentionalUnlock.push((game as unknown as { suppressPause: boolean }).suppressPause);
    expect(press().defaultPrevented).toBe(true);
    expect(input.pointerLocked).toBe(false);
    expect(input.cursorFree).toBe(true);
    expect(useGameStore.getState().overlay).toBeNull();
    expect(intentionalUnlock).toEqual([true]);
    expect(input.isDown('forward')).toBe(false);
    expect(input.mouseLeft).toBe(false);
    expect(input.mouseLeftPressed).toBe(false);
    expect(input.lookX).toBe(0);
    press();
    expect(canvas.requestPointerLock).toHaveBeenCalledOnce();
    expect(input.pointerLocked).toBe(true);
    expect(input.cursorFree).toBe(false);
    expect(useGameStore.getState().cursorFree).toBe(false);
  });

  it('does not toggle repeatedly while the key is held', () => {
    press();
    expect(press('Backquote', { repeat: true }).defaultPrevented).toBe(true);
    expect(input.cursorFree).toBe(true);
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
  });

  it.each([{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { isContentEditable: true }])('leaves typing alone in %j', (target) => {
    expect(press('Backquote', { target }).defaultPrevented).toBe(false);
    expect(input.pointerLocked).toBe(true);
  });

  it.each(['ctrlKey', 'metaKey', 'altKey'])('does not intercept a %s shortcut', (modifier) => {
    press('Backquote', { [modifier]: true });
    expect(input.pointerLocked).toBe(true);
  });

  it('uses the rebound key immediately and swaps conflicting gameplay bindings', () => {
    useSettingsStore.getState().bindKey('cursor', 'KeyE');
    expect(useSettingsStore.getState().controls.keys.inventory).toBe('Backquote');
    press('Backquote');
    expect(input.cursorFree).toBe(false);
    input.endFrame();
    press('KeyE');
    expect(input.cursorFree).toBe(true);
    expect(input.wasPressed('inventory')).toBe(false);
    expect(input.keyPressed('KeyE')).toBe(false);
  });

  it('keeps the cursor free when gameplay or menu code asks to capture it automatically', () => {
    press();
    input.requestLock();
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    expect(input.cursorFree).toBe(true);
  });

  it('blocks all canvas buttons, dragging and scrolling while UI options remain usable', () => {
    input.allowUnlocked = true; // Build Home normally accepts unlocked canvas input.
    press();
    for (const button of [0, 1, 2]) mouse(canvas, 'mousedown', { button });
    mouse(keyboard, 'mousemove');
    mouse(canvas, 'wheel');
    expect(input.mouseLeft).toBe(false);
    expect(input.mouseRight).toBe(false);
    expect(input.mouseMiddle).toBe(false);
    expect(input.mouseLeftPressed).toBe(false);
    expect(input.mouseRightPressed).toBe(false);
    expect(input.mouseMiddlePressed).toBe(false);
    expect([input.lookX, input.lookY, input.dragRX, input.dragRY, input.dragMX, input.dragMY, input.wheel]).toEqual([0, 0, 0, 0, 0, 0, 0]);
    press('KeyO');
    expect(input.wasPressed('options')).toBe(true);
    press();
    mouse(canvas, 'mousedown');
    expect(input.mouseLeftPressed).toBe(true);
  });

  it('blocks movement and jumping while allowing voice and menu shortcuts', () => {
    press();
    for (const code of ['KeyW', 'KeyD', 'Space', 'ShiftLeft', 'KeyT', 'KeyO']) press(code);
    expect(input.moveVector()).toEqual({ x: 0, y: 0 });
    expect(input.isDown('jump')).toBe(false);
    expect(input.isDown('sprint')).toBe(false);
    expect(input.isDown('talk')).toBe(true);
    expect(input.wasPressed('options')).toBe(true);
  });

  it('blocks survival interactions and clears mining progress while the cursor is free', () => {
    const hide = vi.fn();
    const drop = vi.fn();
    Object.assign(game, { outline: { hide }, drops: { throwFromPlayer: drop } });
    const interaction = new PlayerInteraction(game);
    useGameStore.getState().setBreakProgress(0.8);
    press();
    press('KeyF');
    press('KeyQ');
    input.mouseLeftPressed = input.mouseRightPressed = true;
    interaction.update(1 / 60, true);
    expect(hide).toHaveBeenCalledOnce();
    expect(drop).not.toHaveBeenCalled();
    expect(useGameStore.getState().breakProgress).toBe(0);
  });

  it('waits for pointer lock confirmation and lets the user retry a rejected request', async () => {
    press();
    canvas.requestPointerLock.mockImplementationOnce(() => Promise.reject(new Error('Browser cooldown')));
    press();
    await Promise.resolve();
    expect(input.cursorFree).toBe(true);
    expect(input.pointerLocked).toBe(false);
    press();
    expect(input.pointerLocked).toBe(true);
    expect(input.cursorFree).toBe(false);
  });

  it.each(['pause', 'settings', 'inventory'] as const)('does not capture while the %s overlay is open', (overlay) => {
    press();
    useGameStore.setState({ overlay });
    press();
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    expect(input.cursorFree).toBe(true);
  });

  it('does not handle the shortcut on touch devices or outside a running game', () => {
    input.touch.active = true;
    expect(game.toggleCursor()).toBe(false);
    input.touch.active = false;
    useGameStore.setState({ screen: 'menu' });
    expect(game.toggleCursor()).toBe(false);
    expect(input.pointerLocked).toBe(true);
  });

  it('keeps the pointer free for the respawn button while defeated', () => {
    press();
    game.player.dead = true;
    expect(game.toggleCursor()).toBe(false);
    press();
    expect(input.pointerLocked).toBe(false);
    expect(input.cursorFree).toBe(true);
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
  });

  it('closes multiplayer quick options when returning to mouse-look', () => {
    Object.assign(game, { pvp: {}, dm: {} });
    press();
    usePvpStore.getState().set({ gearOpen: true });
    useDeathmatchStore.getState().set({ optionsOpen: true });
    press();
    expect(usePvpStore.getState().gearOpen).toBe(false);
    expect(useDeathmatchStore.getState().optionsOpen).toBe(false);
    expect(input.pointerLocked).toBe(true);
  });

  it('still opens pause with Esc while the cursor is free', () => {
    const pause = vi.spyOn(game, 'openOverlay').mockImplementation(() => {});
    press();
    press('Escape');
    (game as unknown as { handleKeys(): void }).handleKeys();
    expect(pause).toHaveBeenCalledWith('pause');
  });

  it('lets Esc close Deathmatch options without pausing or capturing the free cursor', () => {
    Object.assign(game, { dm: {} });
    const pause = vi.spyOn(game, 'openOverlay').mockImplementation(() => {});
    press();
    game.setDmOptions(true);
    press('Escape');
    (game as unknown as { handleKeys(): void }).handleKeys();
    expect(useDeathmatchStore.getState().optionsOpen).toBe(false);
    expect(pause).not.toHaveBeenCalled();
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    expect(input.cursorFree).toBe(true);
  });
});

describe('Build Home cursor integration', () => {
  function setupBuild() {
    const build = Object.assign(Object.create(BuildMode.prototype), {
      game, cancelPending: vi.fn(), select: vi.fn(),
    }) as BuildMode;
    game.build = build;
    Object.assign(game, { player: { cameraMode: 'first', waitingForGround: false } });
    return build;
  }

  it('frees the cursor for UI on the first press even when the build camera is already unlocked', () => {
    setupBuild();
    useBuildStore.setState({ camera: 'build' });
    game.releasePointer();
    press();
    expect(input.cursorFree).toBe(true);
    expect(input.pointerLocked).toBe(false);
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    press();
    expect(input.pointerLocked).toBe(true);
    expect(input.cursorFree).toBe(false);
  });

  it.each(['place', 'select', 'remove', 'paint', 'pick', 'wall'] as const)('blocks the %s tool, interactions and pending strokes with the UI cursor', (tool) => {
    const build = setupBuild();
    const pick = vi.fn();
    const interact = vi.fn();
    const hide = vi.fn();
    const endStroke = vi.fn();
    Object.assign(build, {
      navigation: { update: vi.fn() }, focus: () => new THREE.Vector3(),
      objects: { tick: vi.fn() }, updateLights: vi.fn(), autosave: vi.fn(),
      hideTransient: hide, endStroke, pick, interact, drag: null,
    });
    useBuildStore.setState({ tool, timeLocked: true });
    press();
    // Even stale/virtual input cannot bypass the engine's world-action guard.
    input.mouseLeft = input.mouseLeftPressed = input.mouseRightPressed = true;
    input.touch.interactPressed = true;
    press('KeyF');
    build.update(1 / 60, true);
    expect(pick).not.toHaveBeenCalled();
    expect(interact).not.toHaveBeenCalled();
    expect(hide).toHaveBeenCalledOnce();
    expect(endStroke).toHaveBeenCalledOnce();
  });

  it('blocks delete, duplicate and undo shortcuts while the cursor is free', () => {
    const build = setupBuild();
    const remove = vi.fn();
    const undo = vi.fn();
    const duplicate = vi.fn();
    Object.assign(build, { selectedId: 1, deleteSelected: remove, undo, duplicateSelected: duplicate });
    const keys = build as unknown as { handleKeys(state: ReturnType<typeof useBuildStore.getState>, overlay: null): void };
    press();
    for (const [code, ctrlKey] of [['Delete', false], ['KeyD', true], ['KeyZ', true]] as const) {
      press(code, { ctrlKey });
      keys.handleKeys(useBuildStore.getState(), null);
      input.endFrame();
    }
    expect(remove).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
    expect(duplicate).not.toHaveBeenCalled();
  });

  it('switches first / third person with F6 while the UI cursor remains free', () => {
    const build = setupBuild();
    input.captureShortcuts = true;
    const keys = build as unknown as { handleKeys(state: ReturnType<typeof useBuildStore.getState>, overlay: null): void };
    press();
    expect(press('F6').defaultPrevented).toBe(true);
    keys.handleKeys(useBuildStore.getState(), null);
    expect(game.player.cameraMode).toBe('third');
    expect(useSettingsStore.getState().gameplay.cameraMode).toBe('third');
    expect(input.cursorFree).toBe(true);
    input.endFrame();
    press('F6');
    keys.handleKeys(useBuildStore.getState(), null);
    expect(game.player.cameraMode).toBe('first');
  });

  it('uses a rebound view key without selecting the V tool', () => {
    const build = setupBuild();
    const tool = vi.fn();
    Object.assign(build, { setTool: tool });
    useSettingsStore.getState().bindKey('buildView', 'KeyV');
    press('KeyV');
    (build as unknown as { handleKeys(state: ReturnType<typeof useBuildStore.getState>, overlay: null): void }).handleKeys(useBuildStore.getState(), null);
    expect(game.player.cameraMode).toBe('third');
    expect(tool).not.toHaveBeenCalled();
  });

  it('returns from the build camera to the selected player view without capturing a settings overlay', () => {
    const build = setupBuild();
    useBuildStore.setState({ camera: 'build' });
    game.releasePointer();
    useGameStore.setState({ overlay: 'settings' });
    build.setPlayerView('third');
    expect(useBuildStore.getState().camera).toBe('player');
    expect(game.player.cameraMode).toBe('third');
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    expect(useGameStore.getState().overlay).toBe('settings');
  });

  it('actually moves the camera between eye-level and third-person views', () => {
    const build = setupBuild();
    Object.assign(game, { scene: new THREE.Scene(), world: new World(7, 'meadow') });
    const player = new Player(game);
    Object.assign(game, { player });
    player.teleport(10, 41, 10);
    const camera = new THREE.PerspectiveCamera();
    build.setPlayerView('first');
    player.updateCamera(camera, 1);
    expect(camera.position.toArray()).toEqual(player.eyePosition().toArray());
    build.setPlayerView('third');
    player.updateCamera(camera, 1);
    expect(camera.position.distanceTo(player.eyePosition())).toBeGreaterThan(4);
    build.setPlayerView('first');
    player.updateCamera(camera, 1);
    expect(camera.position.toArray()).toEqual(player.eyePosition().toArray());
  });

  it('shares the same cursor state with the existing Tab mode', () => {
    const build = setupBuild();
    build.setCursorMode(true);
    expect(input.cursorFree).toBe(true);
    expect(input.pointerLocked).toBe(false);
    press();
    expect(useBuildStore.getState().cursorMode).toBe(false);
    expect(input.pointerLocked).toBe(true);
    press();
    expect(useBuildStore.getState().cursorMode).toBe(true);
    build.setCursorMode(false);
    expect(input.pointerLocked).toBe(true);
    expect(input.cursorFree).toBe(false);
  });

  it('keeps cursor controls usable when a Tab capture request fails', async () => {
    const build = setupBuild();
    build.setCursorMode(true);
    canvas.requestPointerLock.mockImplementationOnce(() => Promise.reject(new Error('Browser cooldown')));
    build.setCursorMode(false);
    await Promise.resolve();
    expect(useBuildStore.getState().cursorMode).toBe(true);
    expect(input.cursorFree).toBe(true);
  });

  it('preserves cursor choice through walkthrough and camera changes', () => {
    const build = setupBuild();
    press();
    build.setWalkthrough(true);
    expect(useBuildStore.getState().cursorMode).toBe(true);
    useBuildStore.setState({ camera: 'build', cursorMode: false });
    build.setCamera('player');
    expect(useBuildStore.getState().cursorMode).toBe(true);
    expect(input.pointerLocked).toBe(false);
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
  });

  it('restores cursor aiming after leaving photo mode', () => {
    const build = setupBuild();
    useBuildStore.setState({ photo: true });
    press();
    expect(useBuildStore.getState().cursorMode).toBe(false);
    build.togglePhoto();
    expect(useBuildStore.getState().photo).toBe(false);
    expect(useBuildStore.getState().cursorMode).toBe(true);
    expect(input.pointerLocked).toBe(false);
  });
});

describe('cursor controls in the HUD', () => {
  beforeEach(() => {
    // Server rendering normally uses the store's initial snapshot; use the current game state here.
    vi.spyOn(React, 'useSyncExternalStore').mockImplementation((_subscribe, getSnapshot) => getSnapshot());
  });

  it.each(['survival', 'pvp', 'deathmatch', 'build'] as const)('removes the click-to-play blocker in %s and shows the return key', (mode) => {
    useGameStore.setState({ world: { mode } as NonNullable<ReturnType<typeof useGameStore.getState>['world']> });
    press();
    const html = renderToStaticMarkup(createElement(HUD));
    expect(html).not.toContain('class="click-to-play"');
    expect(html).toContain('Cursor free');
    expect(html).toContain('<kbd>`</kbd>');
  });

  it.each(['survival', 'pvp', 'deathmatch', 'build'] as const)('still shows click-to-play in %s after an ordinary unlock', (mode) => {
    useGameStore.setState({ world: { mode } as NonNullable<ReturnType<typeof useGameStore.getState>['world']> });
    game.releasePointer();
    const html = renderToStaticMarkup(createElement(HUD));
    expect(html).toContain('class="click-to-play"');
    expect(html).not.toContain('Cursor free');
  });

  it.each([false, true])('shows the current binding in the controls card (build: %s)', (build) => {
    useSettingsStore.getState().bindKey('cursor', 'KeyZ');
    const html = renderToStaticMarkup(createElement(ControlsCard, { onBack: () => {}, build }));
    expect(html).toContain('<span class="kbd">Z</span>');
    expect(html).toContain('Free cursor / return to mouse-look');
  });

  it('shows the Build Home view button and its current shortcut in the toolbar and hints', () => {
    useGameStore.setState({ world: { mode: 'build' } as NonNullable<ReturnType<typeof useGameStore.getState>['world']> });
    useBuildStore.setState({ hintsCollapsed: false });
    useSettingsStore.getState().bindKey('buildView', 'F7');
    useSettingsStore.getState().update('gameplay', { cameraMode: 'third' });
    const html = renderToStaticMarkup(createElement(HUD));
    expect(html).toContain('aria-label="Switch first / third person"');
    expect(html).toContain('3rd person');
    expect(html).toContain('<kbd>F7</kbd>');
    expect(html).toContain('First / third person');
  });
});
