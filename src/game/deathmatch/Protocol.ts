import type { Team } from './DeathmatchMap';
import type { LobbySnapshot } from './DeathmatchRules';
import type { LootKind } from './LootManager';
import type { MatchResult } from './MatchResults';
import { isGun, isWeapon, type GunId, type WeaponId } from './WeaponDefinitions';
import type { LoadoutSnapshot } from './WeaponSystem';

/**
 * Deathmatch wire protocol. Every message names its round (`r`) once a match
 * is underway; the host drops anything from another round, so late packets
 * from a previous match can never score. Times from the host are seconds on
 * the host's monotonic clock — clients convert with their measured offset.
 */
export const DM_PROTOCOL = 2;

type V3 = [number, number, number];

// ---------------------------------------------------------------- client → host
export type ClientMsg =
  | { t: 'hello'; name: string; v: number; token?: string }
  | { t: 'team'; team: Team }
  | { t: 'minutes'; m: number }
  | { t: 'start' }
  | { t: 'again' }
  | { t: 'ready'; r: number }
  | { t: 'respawn'; r: number }
  | { t: 'ping'; c: number }
  /** Movement: position, look, flags (1 crouch, 2 grounded, 4 aiming, 8 reloading, 16 sprint, 32 healing), speed. */
  | { t: 'st'; r: number; p: V3; yw: number; pt: number; w: WeaponId; f: number; m: number }
  | { t: 'fire'; r: number; s: number; w: GunId; o: V3; d: V3; at: number; ads: boolean }
  | { t: 'melee'; r: number; s: number; o: V3; d: V3; at: number }
  | { t: 'reload'; r: number }
  | { t: 'equip'; r: number; slot: 0 | 1 | 2 }
  | { t: 'pick'; r: number; lid: string }
  | { t: 'heal'; r: number; size: 'small' | 'large' }
  | { t: 'station'; r: number; sid: string }
  | { t: 'env'; r: number; amt: number; cause: string };

// ---------------------------------------------------------------- host → client
export type ServerMsg =
  | { t: 'welcome'; you: string; token: string; lobby: LobbySnapshot; v: number }
  | { t: 'reject'; reason: 'full' | 'in_progress' | 'version' }
  | { t: 'lobby'; lobby: LobbySnapshot }
  | { t: 'teamRej'; reason: string }
  | { t: 'startRej'; reason: string }
  | { t: 'load'; r: number; seed: number; lobby: LobbySnapshot; spawns: Record<string, [number, number, number, number]>; late?: boolean }
  | { t: 'cancel'; reason: string }
  | { t: 'pong'; c: number; h: number }
  | { t: 'prep'; r: number; endsAt: number }
  | { t: 'go'; r: number; startAt: number; endAt: number }
  /** State of everyone: [id, x, y, z, yaw, pitch, weapon, flags, move, hp, alive(1/0), protected(1/0), kills, deaths]. */
  | { t: 'ss'; r: number; l: (string | number)[][]; h: number }
  | { t: 'shot'; r: number; id: string; w: GunId; o: V3; ends: V3[]; hits: boolean[] }
  | { t: 'swing'; r: number; id: string }
  | { t: 'dmg'; r: number; v: string; a: string; n: number; hp: number; head: boolean; w: string; from: V3 }
  | { t: 'kill'; r: number; v: string; k: string | null; w: string; head: boolean; red: number; blue: number; respawnAt: number }
  | { t: 'spawn'; r: number; id: string; p: V3; yw: number; protUntil: number }
  | { t: 'respawnWait'; r: number; until: number }
  | { t: 'inv'; r: number; inv: LoadoutSnapshot; reload: number }
  | { t: 'hp'; r: number; id: string; hp: number }
  | { t: 'heal'; r: number; size: 'small' | 'large'; until: number; ok: boolean; reason?: string }
  | { t: 'loot'; r: number; items: [string, LootKind, number, number, number][]; reset: boolean }
  | { t: 'lootGone'; r: number; lid: string; by: string | null }
  | { t: 'pickRej'; r: number; lid: string; reason: string }
  | { t: 'station'; r: number; sid: string; readyAt: number }
  | { t: 'correct'; r: number; p: V3 }
  | { t: 'end'; r: number; result: MatchResult }
  | { t: 'closed'; reason: string };

// ---------------------------------------------------------------- validation

const num = (v: unknown, lim = 1e6): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
const int = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const v3 = (v: unknown, lim = 1000): v is V3 => Array.isArray(v) && v.length === 3 && v.every((n) => num(n, lim));
const unit = (v: unknown): v is V3 => v3(v, 2) && Math.abs(Math.hypot(...(v as V3)) - 1) < 0.05;
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const team = (v: unknown): v is Team => v === 'red' || v === 'blue';

/** Strictly parse an incoming client message; anything malformed → null (ignored, never thrown). */
export function parseClientMsg(raw: unknown): ClientMsg | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const r = m.r;
  switch (m.t) {
    case 'hello':
      return typeof m.name === 'string' && num(m.v) ? { t: 'hello', name: m.name.slice(0, 40), v: m.v as number, token: str(m.token, 64) ? m.token : undefined } : null;
    case 'team': return team(m.team) ? { t: 'team', team: m.team } : null;
    case 'minutes': return int(m.m, 1, 60) ? { t: 'minutes', m: m.m } : null;
    case 'start': return { t: 'start' };
    case 'again': return { t: 'again' };
    case 'ready': return int(r, 0, 1e6) ? { t: 'ready', r } : null;
    case 'respawn': return int(r, 0, 1e6) ? { t: 'respawn', r } : null;
    case 'ping': return num(m.c, 1e12) ? { t: 'ping', c: m.c } : null;
    case 'st':
      return int(r, 0, 1e6) && v3(m.p) && num(m.yw, 100) && num(m.pt, 4) && isWeapon(m.w) && int(m.f, 0, 255) && num(m.m, 2)
        ? { t: 'st', r, p: m.p, yw: m.yw, pt: m.pt, w: m.w, f: m.f, m: m.m } : null;
    case 'fire':
      return int(r, 0, 1e6) && int(m.s, 0, 1e9) && isGun(m.w) && v3(m.o) && unit(m.d) && num(m.at, 1e9)
        ? { t: 'fire', r, s: m.s, w: m.w, o: m.o, d: m.d, at: m.at, ads: m.ads === true } : null;
    case 'melee':
      return int(r, 0, 1e6) && int(m.s, 0, 1e9) && v3(m.o) && unit(m.d) && num(m.at, 1e9) ? { t: 'melee', r, s: m.s, o: m.o, d: m.d, at: m.at } : null;
    case 'reload': return int(r, 0, 1e6) ? { t: 'reload', r } : null;
    case 'equip': return int(r, 0, 1e6) && (m.slot === 0 || m.slot === 1 || m.slot === 2) ? { t: 'equip', r, slot: m.slot } : null;
    case 'pick': return int(r, 0, 1e6) && str(m.lid, 24) ? { t: 'pick', r, lid: m.lid } : null;
    case 'heal': return int(r, 0, 1e6) && (m.size === 'small' || m.size === 'large') ? { t: 'heal', r, size: m.size } : null;
    case 'station': return int(r, 0, 1e6) && str(m.sid, 16) ? { t: 'station', r, sid: m.sid } : null;
    case 'env': return int(r, 0, 1e6) && num(m.amt, 1000) && (m.amt as number) > 0 ? { t: 'env', r, amt: m.amt as number, cause: String(m.cause ?? 'fall').slice(0, 16) } : null;
  }
  return null;
}

/** Light shape check for host messages (the host is trusted for game rules, but never for crashing us). */
export function parseServerMsg(raw: unknown): ServerMsg | null {
  if (!raw || typeof raw !== 'object' || typeof (raw as { t?: unknown }).t !== 'string') return null;
  return raw as ServerMsg;
}
