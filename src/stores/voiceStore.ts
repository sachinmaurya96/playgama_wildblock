import { create } from 'zustand';

/**
 * Voice chat state shared by every multiplayer mode (PvP, Build together,
 * Build Home with friends, Deathmatch). Written by net/voice.ts; read by the
 * shared voice controls in ui/Voice. Each mode only supplies who is who
 * (`roster`) and, for team modes, team-aware talk / listen scopes.
 */
export interface VoiceRosterEntry {
  id: string;
  name: string;
  color: string;
  /** Team modes only. */
  team?: string;
}

export type VoiceScope = 'team' | 'all';

export interface VoiceState {
  /** Connected to voice (listening and / or talking). */
  on: boolean;
  /** 🎧 hearing the others. */
  listen: boolean;
  /** 🎤 open mic switched on (tap-to-talk mode). */
  micOn: boolean;
  /** Microphone allowed & in use (push-to-talk is instant once this is true). */
  micReady: boolean;
  /** Players in voice who switched listening off. */
  deaf: string[];
  mode: 'push' | 'open';
  proximity: boolean;
  /** "Nearby louder" makes sense here (open-world modes, not a team radio). */
  proximityAllowed: boolean;
  /** Your mic is live right now (open mic, or push-to-talk held). */
  talking: boolean;
  /** Player ids in voice / muted by you / speaking right now (your own id when you talk). */
  peers: string[];
  muted: string[];
  speaking: string[];
  error: string | null;
  /** Team modes: who you hear / who hears you. null = no teams in this mode. */
  hearScope: VoiceScope | null;
  talkScope: VoiceScope | null;
  /** Everyone in the room, from the running mode. */
  roster: VoiceRosterEntry[];
  selfId: string;
  set(p: Partial<VoiceState>): void;
  reset(): void;
}

const initial = {
  on: false, listen: false, micOn: false, micReady: false, deaf: [] as string[], mode: 'push' as 'push' | 'open', proximity: true, proximityAllowed: true,
  talking: false, peers: [] as string[], muted: [] as string[], speaking: [] as string[], error: null as string | null,
  hearScope: null as VoiceScope | null, talkScope: null as VoiceScope | null, roster: [] as VoiceRosterEntry[], selfId: '',
};

export const useVoiceStore = create<VoiceState>((set) => ({
  ...initial,
  set(p) {
    set(p);
  },
  reset() {
    set({ ...initial });
  },
}));
