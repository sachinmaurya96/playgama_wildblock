import { create } from 'zustand';
import type { StationKind } from '../data/blocks';

export type Screen = 'boot' | 'menu' | 'newWorld' | 'newBuild' | 'worlds' | 'settings' | 'howto' | 'credits' | 'pvp' | 'deathmatch' | 'loading' | 'playing' | 'error';
export type Overlay = null | 'inventory' | 'container' | 'journal' | 'map' | 'pause' | 'death' | 'sleep' | 'settings' | 'lore' | 'controls' | 'catalog' | 'buildDialog';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'save' | 'quest' | 'discovery' | 'warn' | 'achievement';
  icon?: string;
}

export interface WorldSummary {
  id: string;
  name: string;
  seed: string;
  difficulty: Difficulty;
  mode?: 'survival' | 'build' | 'pvp' | 'deathmatch';
}

export type Difficulty = 'peaceful' | 'explorer' | 'adventurer';

export interface DebugInfo {
  fps: number;
  pos: string;
  chunk: string;
  biome: string;
  chunks: number;
  meshed: number;
  queue: number;
  triangles: number;
  calls: number;
  entities: number;
  seed: string;
  time: string;
  light: string;
  memory: string;
}

interface GameState {
  screen: Screen;
  /** Where Settings/HowTo return to. */
  returnTo: Screen;
  overlay: Overlay;
  craftingStation: StationKind | null;
  world: WorldSummary | null;
  loading: { progress: number; stage: string; tipIndex: number };
  toasts: Toast[];
  prompt: string | null;
  breakProgress: number;
  hudHidden: boolean;
  pointerLocked: boolean;
  lore: { title: string; text: string; index: number } | null;
  death: { cause: string; lost: number } | null;
  debug: DebugInfo | null;
  subtitle: { text: string; dir: string; t: number } | null;
  fatalError: string | null;
  hurtFlash: number;

  setScreen(s: Screen): void;
  openSettings(from: Screen): void;
  setOverlay(o: Overlay, station?: StationKind | null): void;
  setWorld(w: WorldSummary | null): void;
  setLoading(progress: number, stage: string): void;
  toast(text: string, kind?: Toast['kind'], icon?: string): void;
  dismissToast(id: number): void;
  setPrompt(p: string | null): void;
  setBreakProgress(p: number): void;
  setDebug(d: DebugInfo | null): void;
  setSubtitle(text: string, dir: string): void;
  fail(message: string): void;
}

const toastQueue: Toast[] = [];

function isCompactScreen(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('touch-ui');
}

function scheduleDismiss(t: Toast, compact: boolean, dismiss: (id: number) => void) {
  const base = t.kind === 'save' ? 1500 : t.kind === 'achievement' || t.kind === 'quest' ? 5200 : 3600;
  setTimeout(() => dismiss(t.id), compact ? Math.min(base, t.kind === 'achievement' || t.kind === 'quest' ? 3600 : 2600) : base);
}

let toastId = 1;

export const useGameStore = create<GameState>((set, get) => ({
  screen: 'boot',
  returnTo: 'menu',
  overlay: null,
  craftingStation: null,
  world: null,
  loading: { progress: 0, stage: 'Growing your world...', tipIndex: 0 },
  toasts: [],
  prompt: null,
  breakProgress: 0,
  hudHidden: false,
  pointerLocked: false,
  lore: null,
  death: null,
  debug: null,
  subtitle: null,
  fatalError: null,
  hurtFlash: 0,

  setScreen(screen) {
    set({ screen, overlay: null });
  },
  openSettings(from) {
    set({ returnTo: from, screen: 'settings' });
  },
  setOverlay(overlay, station = null) {
    set({ overlay, craftingStation: overlay === 'inventory' ? station : null });
  },
  setWorld(world) {
    set({ world });
  },
  setLoading(progress, stage) {
    const l = get().loading;
    if (Math.abs(l.progress - progress) < 0.005 && l.stage === stage) return;
    set({ loading: { ...l, progress, stage } });
  },
  toast(text, kind = 'info', icon) {
    const id = toastId++;
    if (get().toasts.some((t) => t.text === text) || toastQueue.some((t) => t.text === text)) return;
    const t: Toast = { id, text, kind, icon };
    const compact = isCompactScreen();
    // phones: at most 2 small toasts at a time; the rest wait their turn (one by one)
    const max = compact ? 2 : 4;
    const shown = get().toasts.filter((x) => !(x.kind === 'save' && kind === 'save'));
    if (compact && shown.length >= max) {
      toastQueue.push(t);
      if (toastQueue.length > 6) toastQueue.shift(); // drop the oldest backlog rather than nag
      return;
    }
    set({ toasts: [...shown, t].slice(-max) });
    scheduleDismiss(t, compact, get().dismissToast);
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
    const next = toastQueue.shift();
    if (next) {
      setTimeout(() => {
        set({ toasts: [...get().toasts, next] });
        scheduleDismiss(next, isCompactScreen(), get().dismissToast);
      }, 180);
    }
  },
  setPrompt(prompt) {
    if (get().prompt !== prompt) set({ prompt });
  },
  setBreakProgress(p) {
    const q = Math.round(p * 20) / 20;
    if (get().breakProgress !== q) set({ breakProgress: q });
  },
  setDebug(debug) {
    set({ debug });
  },
  setSubtitle(text, dir) {
    set({ subtitle: { text, dir, t: performance.now() } });
  },
  fail(message) {
    set({ fatalError: message, screen: 'error' });
  },
}));
