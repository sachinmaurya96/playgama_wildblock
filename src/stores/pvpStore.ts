import { create } from 'zustand';

export type PvpKit = 'hunter' | 'knight' | 'champion';

/** 'wild' = the main WildBlocks world; the others are flat arenas (Build Home lots with scenery around them). */
export type PvpMap = 'wild' | 'meadow' | 'studio' | 'desert' | 'forest' | 'lakeside' | 'mountain' | 'coastal';

export const PVP_MAPS: { id: PvpMap; name: string; text: string }[] = [
  { id: 'wild', name: '🌲 Wild World', text: 'The main map: hills, rivers, forests and caves' },
  { id: 'meadow', name: '🟩 Flat Meadow', text: 'Big flat grass field — pure fighting & building' },
  { id: 'studio', name: '⬜ Plain Arena', text: 'Clean flat floor, nothing to hide behind' },
  { id: 'desert', name: '🏜️ Desert Flats', text: 'Flat sand under dunes and cliffs' },
  { id: 'forest', name: '🌳 Forest Clearing', text: 'Flat clearing ringed by thick woods' },
  { id: 'lakeside', name: '🏞️ Lakeside', text: 'Flat field next to a lake and hills' },
  { id: 'mountain', name: '⛰️ Mountain Valley', text: 'Flat valley floor between mountains' },
  { id: 'coastal', name: '🏖️ Coastal', text: 'Flat ground by the sea' },
];

/** battle = players fight for takedowns; together = co-op building & exploring (players can't hurt each other). */
export type PvpStyle = 'battle' | 'together';

export interface PvpSettings {
  style: PvpStyle;
  /** Match length in minutes (0 = no time limit). */
  minutes: number;
  /** First to this many takedowns wins (0 = no limit). */
  killLimit: number;
  kit: PvpKit;
  /** Which map the match is played on. */
  map: PvpMap;
  /** Night creatures roam the arena too. */
  creatures: boolean;
  /** Players may break & place blocks (forts, bridges, cover). */
  building: boolean;
  /** World seed text: same seed = same map. */
  seedText: string;
}

export const DEFAULT_PVP_SETTINGS: PvpSettings = { style: 'battle', minutes: 10, killLimit: 15, kit: 'knight', map: 'wild', creatures: false, building: true, seedText: '' };

export interface PvpPlayerInfo {
  id: string;
  name: string;
  color: string;
  kills: number;
  deaths: number;
  /** Ping-ish: ms since we last heard from them (UI only). */
  quiet?: number;
}

export interface KillFeedEntry {
  id: number;
  killer: string | null;
  killerColor?: string;
  victim: string;
  victimColor?: string;
  how: string;
  at: number;
}

interface PvpState {
  active: boolean;
  code: string;
  online: boolean;
  isHost: boolean;
  selfId: string;
  settings: PvpSettings;
  players: PvpPlayerInfo[];
  feed: KillFeedEntry[];
  /** Seconds left in the match (null = no time limit). */
  timeLeft: number | null;
  phase: 'playing' | 'ended';
  winner: string | null;
  /** Local player: respawn countdown (seconds) while dead, else 0. */
  respawnIn: number;
  killedBy: string | null;
  scoreboardOpen: boolean;
  /** Local player is stuck (cave / ravine / deep water): offer the 🆘 respawn. */
  emergency: boolean;
  /** Voice chat (see net/voice.ts). */
  voiceOn: boolean;
  voiceMode: 'push' | 'open';
  voiceProximity: boolean;
  /** Your mic is live right now (open mic, or push-to-talk held). */
  voiceTalking: boolean;
  /** Player ids in voice / muted by you / speaking right now (your own id when you talk). */
  voicePeers: string[];
  voiceMuted: string[];
  voiceSpeaking: string[];
  voiceError: string | null;
  status: string | null;
  set(p: Partial<PvpState>): void;
  pushFeed(e: Omit<KillFeedEntry, 'id' | 'at'>): void;
  reset(): void;
}

let feedId = 1;

const initial = {
  active: false, code: '', online: true, isHost: false, selfId: '', settings: DEFAULT_PVP_SETTINGS, players: [] as PvpPlayerInfo[],
  feed: [] as KillFeedEntry[], timeLeft: null as number | null, phase: 'playing' as const, winner: null as string | null, respawnIn: 0,
  killedBy: null as string | null, scoreboardOpen: false, emergency: false, voiceOn: false, voiceMode: 'push' as 'push' | 'open', voiceProximity: true, voiceTalking: false,
  voicePeers: [] as string[], voiceMuted: [] as string[], voiceSpeaking: [] as string[], voiceError: null as string | null, status: null as string | null,
};

export const usePvpStore = create<PvpState>((set, get) => ({
  ...initial,
  set(p) {
    set(p);
  },
  pushFeed(e) {
    const feed = [...get().feed, { ...e, id: feedId++, at: performance.now() }].slice(-5);
    set({ feed });
  },
  reset() {
    set({ ...initial });
  },
}));

export const PVP_COLORS = ['#d9573f', '#3f8fd9', '#e0b23d', '#7fae5a', '#b06ad9', '#3fc4c0', '#e07fb0', '#f0f0e8'];
