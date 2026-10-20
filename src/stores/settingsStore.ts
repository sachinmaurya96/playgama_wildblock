import { preferences } from '../platform/storage';
import { create } from 'zustand';

export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sprint' | 'crouch' | 'inventory' | 'interact' | 'camera'
  | 'journal' | 'map' | 'drop' | 'hideHud' | 'options' | 'talk' | 'listen' | 'cursor' | 'buildView';

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Move forward', back: 'Move back', left: 'Strafe left', right: 'Strafe right', jump: 'Jump / swim up',
  sprint: 'Sprint', crouch: 'Crouch (edge-safe)', inventory: 'Backpack & crafting', interact: 'Interact / feed / pet',
  camera: 'Toggle camera', journal: 'Discovery journal', map: 'World map', drop: 'Drop item', hideHud: 'Hide HUD (photo)',
  options: 'Quick options (PvP)', talk: 'Voice: talk (PvP)', listen: 'Voice: listen on / off (PvP)',
  cursor: 'Free cursor / return to mouse-look',
  buildView: 'Build Home: first / third person',
};

export const DEFAULT_KEYS: Record<Action, string> = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sprint: 'ShiftLeft', crouch: 'ControlLeft',
  inventory: 'KeyE', interact: 'KeyF', camera: 'KeyV', journal: 'KeyJ', map: 'KeyM', drop: 'KeyQ', hideHud: 'F2',
  options: 'KeyO', talk: 'KeyT', listen: 'KeyH',
  cursor: 'Backquote',
  buildView: 'F6',
};

/** Which device the gyro tuning is for ('auto' picks phone or tablet from the screen size). */
export type GyroProfile = 'auto' | 'phone' | 'tablet';

export interface GyroSettings {
  /** Off by default: turn the phone / tablet to aim (adds to touch-drag looking). */
  enabled: boolean;
  profile: GyroProfile;
  /** Camera degrees per degree the device turns (horizontal). */
  sensitivity: number;
  /** Vertical speed relative to horizontal. */
  vertical: number;
  /** 0 = raw & instant, 1 = very smooth (filters hand shake, adds a little lag). */
  smoothing: number;
  invertX: boolean;
  invertY: boolean;
  /** 'always', or only while holding attack / use (aiming a bow). */
  when: 'always' | 'aiming';
  /**
   * How the browser names the rotation axes: 'standard' (Android / Chrome: beta = x, gamma = y) or
   * 'apple' (iPhone / iPad — every iOS browser is Safari inside: alpha = x, beta = y). 'auto' detects it.
   */
  axes: 'auto' | 'standard' | 'apple';
}

/** Tuned starting points: phones are light (more hand shake → more smoothing); tablets are heavy (turned less → more sensitivity). */
export const GYRO_PROFILES: Record<'phone' | 'tablet', Pick<GyroSettings, 'sensitivity' | 'vertical' | 'smoothing'> & { deadzone: number }> = {
  phone: { sensitivity: 1.4, vertical: 0.8, smoothing: 0.45, deadzone: 2 },
  tablet: { sensitivity: 2, vertical: 0.85, smoothing: 0.3, deadzone: 1.2 },
};

/** Tablet = the short side of the screen is at least 600 CSS px. */
export function detectGyroDevice(): 'phone' | 'tablet' {
  if (typeof window === 'undefined') return 'phone';
  const short = Math.min(window.screen?.width ?? window.innerWidth, window.screen?.height ?? window.innerHeight);
  return short >= 600 ? 'tablet' : 'phone';
}

export function defaultGyro(): GyroSettings {
  const p = GYRO_PROFILES[detectGyroDevice()];
  return { enabled: false, profile: 'auto', sensitivity: p.sensitivity, vertical: p.vertical, smoothing: p.smoothing, invertX: false, invertY: false, when: 'always', axes: 'auto' };
}

export type QualityPreset = 'low' | 'medium' | 'high' | 'auto' | 'custom';

export interface Settings {
  graphics: {
    preset: QualityPreset;
    renderDistance: number;
    shadows: boolean;
    particles: 'off' | 'low' | 'high';
    resolutionScale: number;
    maxPixelRatio: number;
    fov: number;
    clouds: boolean;
    autoQuality: boolean;
  };
  audio: { master: number; music: number; sfx: number; ambient: number; creatures: number; ui: number };
  controls: { sensitivity: number; invertY: boolean; keys: Record<Action, string>; touch: 'auto' | 'on' | 'off'; gyro: GyroSettings };
  gameplay: { cameraMode: 'first' | 'third'; faceMovement: boolean; tips: boolean; dayLengthMinutes: number; ghostPreview: boolean; showDebug: boolean; scarf: string };
  accessibility: { reducedShake: boolean; highContrastOutline: boolean; uiScale: number; subtitles: boolean; reduceFlashing: boolean };
}

export const PRESETS: Record<'low' | 'medium' | 'high', Partial<Settings['graphics']>> = {
  low: { renderDistance: 4, shadows: false, particles: 'low', resolutionScale: 0.75, maxPixelRatio: 1, clouds: false },
  medium: { renderDistance: 6, shadows: true, particles: 'high', resolutionScale: 1, maxPixelRatio: 1.5, clouds: true },
  high: { renderDistance: 9, shadows: true, particles: 'high', resolutionScale: 1, maxPixelRatio: 2, clouds: true },
};

const isTouch = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

/**
 * Phones & tablets: crisp but light. The old touch default (low preset: pixel
 * ratio 1 × 0.75 resolution) rendered ~¼ of a phone's real pixels and looked
 * blurry; instead keep native-ish sharpness (up to 1.75× pixel ratio) and save
 * GPU time where it matters less — render distance, particles and clouds.
 */
export const MOBILE_GRAPHICS: Partial<Settings['graphics']> = {
  renderDistance: 4, shadows: false, particles: 'low', resolutionScale: 1, maxPixelRatio: 1.75, clouds: true, fov: 75,
};

/** Bumped when defaults change in a way old saved settings should pick up. */
const SETTINGS_VERSION = 2;

export function defaultSettings(): Settings {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 4 : 4;
  const base: 'low' | 'medium' | 'high' = cores >= 8 ? 'high' : 'medium';
  return {
    graphics: {
      preset: 'auto', renderDistance: 6, shadows: true, particles: 'high', resolutionScale: 1, maxPixelRatio: 1.5, fov: 72,
      clouds: true, autoQuality: true, ...(isTouch ? MOBILE_GRAPHICS : PRESETS[base]),
    },
    audio: { master: 0.8, music: 0.55, sfx: 0.8, ambient: 0.7, creatures: 0.8, ui: 0.6 },
    controls: { sensitivity: 1, invertY: false, keys: { ...DEFAULT_KEYS }, touch: 'auto', gyro: defaultGyro() },
    gameplay: { cameraMode: 'first', faceMovement: true, tips: true, dayLengthMinutes: 24, ghostPreview: true, showDebug: false, scarf: 'ember' },
    accessibility: { reducedShake: false, highContrastOutline: false, uiScale: 1, subtitles: true, reduceFlashing: false },
  };
}

const STORAGE_KEY = 'wildblocks.settings.v1';

function validFields<T extends object>(defaults: T, raw: unknown): T {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...defaults };
  const output = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const value = (raw as T)[key], fallback = defaults[key];
    if (typeof fallback === 'number') {
      if (typeof value === 'number' && Number.isFinite(value)) output[key] = value;
    } else if (typeof fallback === 'object' && fallback !== null) {
      output[key] = validFields(fallback, value) as T[keyof T];
    } else if (typeof value === typeof fallback) output[key] = value;
  }
  return output;
}

export function parseSettings(raw: string | null): Settings {
  const d = defaultSettings();
  try {
    if (!raw) return d;
    const s = JSON.parse(raw) as Partial<Settings> & { v?: number };
    // v1 → v2: touch devices had a blurry low-resolution default; lift it (keeps other choices)
    if ((s.v ?? 1) < 2 && isTouch && s.graphics) {
      s.graphics = { ...s.graphics, resolutionScale: Math.max(1, s.graphics.resolutionScale ?? 1), maxPixelRatio: Math.max(MOBILE_GRAPHICS.maxPixelRatio!, s.graphics.maxPixelRatio ?? 1) };
      if (s.graphics.preset === 'low') s.graphics.preset = 'auto';
    }
    const next = validFields(d, {
      graphics: { ...d.graphics, ...s.graphics },
      audio: { ...d.audio, ...s.audio },
      controls: { ...d.controls, ...s.controls, keys: { ...d.controls.keys, ...s.controls?.keys }, gyro: { ...d.controls.gyro, ...s.controls?.gyro } },
      gameplay: { ...d.gameplay, ...s.gameplay },
      accessibility: { ...d.accessibility, ...s.accessibility },
    });
    for (const key of Object.keys(next.audio) as (keyof Settings['audio'])[]) next.audio[key] = Math.max(0, Math.min(1, next.audio[key]));
    if (!['low', 'medium', 'high', 'auto', 'custom'].includes(next.graphics.preset)) next.graphics.preset = d.graphics.preset;
    if (!['off', 'low', 'high'].includes(next.graphics.particles)) next.graphics.particles = d.graphics.particles;
    if (!['auto', 'on', 'off'].includes(next.controls.touch)) next.controls.touch = 'auto';
    if (!['first', 'third'].includes(next.gameplay.cameraMode)) next.gameplay.cameraMode = 'first';
    if (!['auto', 'phone', 'tablet'].includes(next.controls.gyro.profile)) next.controls.gyro.profile = 'auto';
    if (!['auto', 'standard', 'apple'].includes(next.controls.gyro.axes)) next.controls.gyro.axes = 'auto';
    if (!['always', 'aiming'].includes(next.controls.gyro.when)) next.controls.gyro.when = 'always';
    next.graphics.renderDistance = Math.max(3, Math.min(12, Math.round(next.graphics.renderDistance)));
    next.graphics.resolutionScale = Math.max(0.5, Math.min(1, next.graphics.resolutionScale));
    next.graphics.maxPixelRatio = Math.max(1, Math.min(3, next.graphics.maxPixelRatio));
    next.graphics.fov = Math.max(55, Math.min(100, next.graphics.fov));
    next.accessibility.uiScale = Math.max(0.5, Math.min(2, next.accessibility.uiScale));
    return next;
  } catch {
    return d;
  }
}

function load(): Settings { return parseSettings(preferences.getItem(STORAGE_KEY)); }

/** Called once after Bridge storage resolves, before interactive screens render. */
export function hydrateSettings(): void { useSettingsStore.setState(load()); }

interface SettingsState extends Settings {
  update<K extends keyof Settings>(section: K, patch: Partial<Settings[K]>): void;
  applyPreset(p: QualityPreset): void;
  /** Rebind an action. If another action used the key, the two swap (conflict resolution). */
  bindKey(action: Action, code: string): void;
  resetKeys(): void;
  reset(): void;
}

function persist(s: Settings) {
  try {
    const { graphics, audio, controls, gameplay, accessibility } = s;
    preferences.setItem(STORAGE_KEY, JSON.stringify({ v: SETTINGS_VERSION, graphics, audio, controls, gameplay, accessibility }));
  } catch {
    /* storage unavailable (private mode) — settings stay in memory */
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...load(),
  update(section, patch) {
    set({ [section]: { ...get()[section], ...patch } } as Partial<SettingsState>);
    persist(get());
  },
  applyPreset(p) {
    const g = get().graphics;
    if (p === 'auto') set({ graphics: { ...g, preset: 'auto', autoQuality: true } });
    else if (p === 'custom') set({ graphics: { ...g, preset: 'custom' } });
    else set({ graphics: { ...g, ...PRESETS[p], preset: p, autoQuality: false } });
    persist(get());
  },
  bindKey(action, code) {
    const keys = { ...get().controls.keys };
    const prev = keys[action];
    for (const a of Object.keys(keys) as Action[]) {
      if (a !== action && keys[a] === code) keys[a] = prev;
    }
    keys[action] = code;
    set({ controls: { ...get().controls, keys } });
    persist(get());
  },
  resetKeys() {
    set({ controls: { ...get().controls, keys: { ...DEFAULT_KEYS } } });
    persist(get());
  },
  reset() {
    set(defaultSettings());
    persist(get());
  },
}));

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt', AltRight: 'R-Alt', Tab: 'Tab', Enter: 'Enter', Backquote: '`', CapsLock: 'Caps',
  };
  return map[code] ?? code;
}
