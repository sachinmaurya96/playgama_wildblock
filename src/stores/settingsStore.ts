import { create } from 'zustand';

export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sprint' | 'crouch' | 'inventory' | 'interact' | 'camera'
  | 'journal' | 'map' | 'drop' | 'hideHud';

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Move forward', back: 'Move back', left: 'Strafe left', right: 'Strafe right', jump: 'Jump / swim up',
  sprint: 'Sprint', crouch: 'Crouch (edge-safe)', inventory: 'Backpack & crafting', interact: 'Interact / feed / pet',
  camera: 'Toggle camera', journal: 'Discovery journal', map: 'World map', drop: 'Drop item', hideHud: 'Hide HUD (photo)',
};

export const DEFAULT_KEYS: Record<Action, string> = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sprint: 'ShiftLeft', crouch: 'ControlLeft',
  inventory: 'KeyE', interact: 'KeyF', camera: 'KeyV', journal: 'KeyJ', map: 'KeyM', drop: 'KeyQ', hideHud: 'F2',
};

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
  controls: { sensitivity: number; invertY: boolean; keys: Record<Action, string>; touch: 'auto' | 'on' | 'off' };
  gameplay: { cameraMode: 'first' | 'third'; tips: boolean; dayLengthMinutes: number; ghostPreview: boolean; showDebug: boolean; scarf: string };
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
    controls: { sensitivity: 1, invertY: false, keys: { ...DEFAULT_KEYS }, touch: 'auto' },
    gameplay: { cameraMode: 'first', tips: true, dayLengthMinutes: 24, ghostPreview: true, showDebug: false, scarf: 'ember' },
    accessibility: { reducedShake: false, highContrastOutline: false, uiScale: 1, subtitles: true, reduceFlashing: false },
  };
}

const STORAGE_KEY = 'wildblocks.settings.v1';

function load(): Settings {
  const d = defaultSettings();
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return d;
    const s = JSON.parse(raw) as Partial<Settings> & { v?: number };
    // v1 → v2: touch devices had a blurry low-resolution default; lift it (keeps other choices)
    if ((s.v ?? 1) < 2 && isTouch && s.graphics) {
      s.graphics = { ...s.graphics, resolutionScale: Math.max(1, s.graphics.resolutionScale ?? 1), maxPixelRatio: Math.max(MOBILE_GRAPHICS.maxPixelRatio!, s.graphics.maxPixelRatio ?? 1) };
      if (s.graphics.preset === 'low') s.graphics.preset = 'auto';
    }
    return {
      graphics: { ...d.graphics, ...s.graphics },
      audio: { ...d.audio, ...s.audio },
      controls: { ...d.controls, ...s.controls, keys: { ...d.controls.keys, ...s.controls?.keys } },
      gameplay: { ...d.gameplay, ...s.gameplay },
      accessibility: { ...d.accessibility, ...s.accessibility },
    };
  } catch {
    return d;
  }
}

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
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: SETTINGS_VERSION, graphics, audio, controls, gameplay, accessibility }));
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
