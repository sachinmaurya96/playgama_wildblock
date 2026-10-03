import { create } from 'zustand';
import { ACHIEVEMENTS, HOMESTEAD_LEVELS, QUESTS, type StatKey } from '../data/progression';

export type JournalSection = 'biomes' | 'animals' | 'plants' | 'materials' | 'landmarks' | 'recipes' | 'lore';

export interface Waypoint {
  x: number;
  z: number;
  label: string;
}

export interface ProgressSnapshot {
  stats: Partial<Record<StatKey, number>>;
  questIndex: number;
  achievements: string[];
  journal: Record<JournalSection, string[]>;
  homesteadPoints: number;
  harmony: number;
  home: { x: number; y: number; z: number } | null;
  camp: { x: number; y: number; z: number };
  deathMarker: { x: number; z: number } | null;
  waypoint: Waypoint | null;
  scarf: string;
}

interface WorldState extends ProgressSnapshot {
  /** HUD-facing clock (updated ~1 Hz). */
  timeLabel: string;
  dayCount: number;
  isNight: boolean;
  weather: string;
  biomeName: string;

  bump(stat: StatKey, n?: number): number;
  discover(section: JournalSection, id: string): boolean;
  addHomestead(points: number): void;
  homesteadLevel(): number;
  addHarmony(delta: number): void;
  setClock(label: string, day: number, night: boolean): void;
  setHome(p: { x: number; y: number; z: number } | null): void;
  setWaypoint(w: Waypoint | null): void;
  load(p: ProgressSnapshot): void;
  snapshot(): ProgressSnapshot;
  reset(camp: { x: number; y: number; z: number }): void;
}

export function emptyJournal(): Record<JournalSection, string[]> {
  return { biomes: [], animals: [], plants: [], materials: [], landmarks: [], recipes: [], lore: [] };
}

export function levelForPoints(points: number): number {
  let lvl = 1;
  for (let i = 0; i < HOMESTEAD_LEVELS.length; i++) if (points >= HOMESTEAD_LEVELS[i]) lvl = i + 1;
  return lvl;
}

export const useWorldStore = create<WorldState>((set, get) => ({
  stats: {},
  questIndex: 0,
  achievements: [],
  journal: emptyJournal(),
  homesteadPoints: 0,
  harmony: 10,
  home: null,
  camp: { x: 0, y: 60, z: 0 },
  deathMarker: null,
  waypoint: null,
  scarf: 'ember',
  timeLabel: '',
  dayCount: 1,
  isNight: false,
  weather: 'Clear',
  biomeName: '',

  bump(stat, n = 1) {
    const stats = { ...get().stats, [stat]: (get().stats[stat] ?? 0) + n };
    set({ stats });
    return stats[stat]!;
  },
  discover(section, id) {
    const j = get().journal;
    if (j[section].includes(id)) return false;
    set({ journal: { ...j, [section]: [...j[section], id] } });
    return true;
  },
  addHomestead(points) {
    set({ homesteadPoints: Math.max(0, get().homesteadPoints + points) });
  },
  homesteadLevel() {
    return levelForPoints(get().homesteadPoints);
  },
  addHarmony(delta) {
    set({ harmony: Math.max(-50, Math.min(100, get().harmony + delta)) });
  },
  setClock(timeLabel, dayCount, isNight) {
    const s = get();
    if (s.timeLabel !== timeLabel || s.dayCount !== dayCount || s.isNight !== isNight) set({ timeLabel, dayCount, isNight });
  },
  setHome(home) {
    set({ home });
  },
  setWaypoint(waypoint) {
    set({ waypoint });
  },
  load(p) {
    set({
      stats: { ...p.stats }, questIndex: p.questIndex, achievements: [...p.achievements],
      journal: { ...emptyJournal(), ...p.journal }, homesteadPoints: p.homesteadPoints, harmony: p.harmony,
      home: p.home, camp: p.camp, deathMarker: p.deathMarker, waypoint: p.waypoint, scarf: p.scarf ?? 'ember',
    });
  },
  snapshot() {
    const s = get();
    return {
      stats: { ...s.stats }, questIndex: s.questIndex, achievements: [...s.achievements], journal: structuredClone(s.journal),
      homesteadPoints: s.homesteadPoints, harmony: s.harmony, home: s.home, camp: s.camp, deathMarker: s.deathMarker,
      waypoint: s.waypoint, scarf: s.scarf,
    };
  },
  reset(camp) {
    set({
      stats: {}, questIndex: 0, achievements: [], journal: emptyJournal(), homesteadPoints: 0, harmony: 10, home: null, camp,
      deathMarker: null, waypoint: null, timeLabel: '', dayCount: 1, isNight: false, weather: 'Clear', biomeName: '',
    });
  },
}));

export { QUESTS, ACHIEVEMENTS };
