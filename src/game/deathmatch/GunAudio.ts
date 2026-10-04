import type * as THREE from 'three';
import { audio } from '../core/audio';
import type { GunId } from './WeaponDefinitions';

/**
 * Procedural Deathmatch sounds (no audio files). Every gun has its own voice;
 * remote shots are positioned and fade with distance (heard up to ~90 blocks),
 * and rapid fire is throttled so automatic weapons never pile up into noise.
 */
export type DmSound =
  | 'dry' | 'reload' | 'magIn' | 'pump' | 'bolt' | 'swordSwing' | 'impact' | 'hit' | 'headshot' | 'kill' | 'eliminated'
  | 'heal' | 'pickup' | 'team' | 'tick' | 'tickFinal' | 'fight' | 'victory' | 'defeat' | 'warn';

const lastShot = new Map<string, number>();

export function playGun(gun: GunId, pos?: THREE.Vector3, local = true): void {
  const key = `${gun}${local ? 'L' : 'R'}`;
  const t = performance.now();
  if (t - (lastShot.get(key) ?? 0) < (local ? 40 : 55)) return;
  lastShot.set(key, t);
  const vol = local ? 0.55 : 0.75;
  audio.custom(({ t, out, tone, noise }) => {
    switch (gun) {
      case 'm416':
        noise(out, t, 0.12, 'bandpass', 1900, 0.9, 0.55 * vol);
        noise(out, t, 0.2, 'lowpass', 700, 0.7, 0.6 * vol, true);
        tone(out, t, 150, 0.08, 'square', 0.12 * vol, 70);
        break;
      case 'ak47':
        noise(out, t, 0.18, 'bandpass', 1200, 0.8, 0.65 * vol);
        noise(out, t, 0.3, 'lowpass', 420, 0.7, 0.8 * vol, true);
        tone(out, t, 110, 0.12, 'sawtooth', 0.14 * vol, 50);
        break;
      case 'mp5':
        noise(out, t, 0.08, 'bandpass', 2600, 1.1, 0.45 * vol);
        noise(out, t, 0.12, 'lowpass', 1100, 0.6, 0.35 * vol, true);
        tone(out, t, 220, 0.05, 'square', 0.08 * vol, 120);
        break;
      case 'shotgun':
        noise(out, t, 0.45, 'lowpass', 900, 0.6, 1.0 * vol, true, 160);
        noise(out, t, 0.18, 'bandpass', 1500, 0.6, 0.6 * vol);
        tone(out, t, 80, 0.3, 'sine', 0.35 * vol, 35);
        break;
      case 'm24':
        noise(out, t, 0.6, 'lowpass', 1300, 0.6, 1.0 * vol, true, 120);
        noise(out, t, 0.1, 'highpass', 3000, 0.6, 0.5 * vol);
        tone(out, t, 95, 0.5, 'sine', 0.35 * vol, 40);
        noise(out, t + 0.12, 1.2, 'lowpass', 500, 0.5, 0.18 * vol, true, 90); // echo
        break;
    }
  }, { pos: local ? undefined : pos, maxDist: 95, volume: 1 });
}

export function playDm(name: DmSound, pos?: THREE.Vector3): void {
  const ui = ['hit', 'headshot', 'kill', 'eliminated', 'team', 'tick', 'tickFinal', 'fight', 'victory', 'defeat', 'warn', 'heal', 'pickup'].includes(name);
  audio.custom(({ t, out, tone, noise }) => {
    switch (name) {
      case 'dry': tone(out, t, 1800, 0.03, 'square', 0.08); break;
      case 'reload':
        noise(out, t, 0.06, 'bandpass', 2400, 3, 0.25);
        tone(out, t + 0.02, 600, 0.05, 'square', 0.05, 400);
        break;
      case 'magIn':
        noise(out, t, 0.05, 'bandpass', 3000, 4, 0.35);
        tone(out, t, 900, 0.04, 'square', 0.07, 500);
        break;
      case 'pump':
        noise(out, t, 0.08, 'bandpass', 1400, 2, 0.35);
        noise(out, t + 0.16, 0.08, 'bandpass', 1800, 2, 0.35);
        break;
      case 'bolt':
        noise(out, t, 0.06, 'bandpass', 2600, 3, 0.3);
        tone(out, t + 0.2, 700, 0.05, 'square', 0.06, 1100);
        noise(out, t + 0.35, 0.06, 'bandpass', 2200, 3, 0.3);
        break;
      case 'swordSwing': noise(out, t, 0.16, 'bandpass', 1300, 1.2, 0.22, false, 3600); break;
      case 'impact': noise(out, t, 0.06, 'bandpass', 2200, 1.5, 0.25); break;
      case 'hit': tone(out, t, 1500, 0.05, 'square', 0.07); break;
      case 'headshot':
        tone(out, t, 2100, 0.06, 'square', 0.08);
        tone(out, t + 0.05, 2800, 0.08, 'sine', 0.08);
        break;
      case 'kill':
        [0, 7, 12].forEach((s, i) => tone(out, t + i * 0.06, 523 * 2 ** (s / 12), 0.25, 'triangle', 0.12));
        break;
      case 'eliminated':
        tone(out, t, 330, 0.5, 'sawtooth', 0.08, 110);
        noise(out, t, 0.4, 'lowpass', 400, 0.6, 0.4, true);
        break;
      case 'heal':
        [0, 4, 7].forEach((s, i) => tone(out, t + i * 0.07, 660 * 2 ** (s / 12), 0.3, 'sine', 0.1));
        break;
      case 'pickup':
        tone(out, t, 700, 0.06, 'square', 0.06);
        noise(out, t + 0.03, 0.07, 'bandpass', 2500, 3, 0.25);
        break;
      case 'team':
        tone(out, t, 660, 0.08, 'sine', 0.12);
        tone(out, t + 0.07, 990, 0.12, 'sine', 0.1);
        break;
      case 'tick': tone(out, t, 880, 0.08, 'sine', 0.13); break;
      case 'tickFinal':
        tone(out, t, 1320, 0.16, 'square', 0.1);
        noise(out, t, 0.1, 'lowpass', 300, 0.6, 0.4, true);
        break;
      case 'fight':
        [0, 4, 7, 12].forEach((s, i) => tone(out, t + i * 0.05, 392 * 2 ** (s / 12), 0.5, 'sawtooth', 0.07));
        noise(out, t, 0.5, 'lowpass', 300, 0.5, 0.6, true);
        break;
      case 'victory':
        [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => tone(out, t + i * 0.09, 523 * 2 ** (s / 12), 0.7, 'triangle', 0.09));
        break;
      case 'defeat':
        [7, 3, 0, -5].forEach((s, i) => tone(out, t + i * 0.18, 392 * 2 ** (s / 12), 0.6, 'sine', 0.1));
        break;
      case 'warn':
        tone(out, t, 740, 0.12, 'square', 0.07);
        tone(out, t + 0.16, 740, 0.12, 'square', 0.07);
        break;
    }
  }, { pos, ui, maxDist: 40 });
}
