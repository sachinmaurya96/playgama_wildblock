/**
 * Deathmatch weapon stats. Plain data (no three.js) so the host referee, the
 * client prediction and the tests all read the same numbers.
 *
 * Starting balance from the design brief — tuned for a 160-block city and the
 * WildBlocks movement speed (walk 5.6, sprint 8.2 blocks/s). Adjust here only.
 */

export type GunId = 'm416' | 'ak47' | 'mp5' | 'shotgun' | 'm24';
export type WeaponId = 'sword' | GunId;
export type AmmoType = '556' | '762' | '9mm' | '12g';

export const GUN_IDS: GunId[] = ['m416', 'ak47', 'mp5', 'shotgun', 'm24'];
export const WEAPON_IDS: WeaponId[] = ['sword', ...GUN_IDS];
export const AMMO_TYPES: AmmoType[] = ['556', '762', '9mm', '12g'];

export interface GunDef {
  id: GunId;
  name: string;
  short: string;
  category: 'Assault rifle' | 'SMG' | 'Shotgun' | 'Sniper';
  ammo: AmmoType;
  /** Damage per bullet (per pellet for the shotgun) at full range. */
  damage: number;
  pellets: number;
  magazine: number;
  /** Rounds (or pump / bolt cycles) per second. */
  fireRate: number;
  automatic: boolean;
  reloadSeconds: number;
  /** Full damage up to `falloffStart`, linearly down to `falloffMin` × damage at `falloffEnd`. Nothing past `maxRange`. */
  falloffStart: number;
  falloffEnd: number;
  falloffMin: number;
  maxRange: number;
  headMultiplier: number;
  /** Cone half-angle in degrees: hip fire and aimed. */
  spreadHip: number;
  spreadAds: number;
  /** Camera kick per shot (radians): vertical always up, horizontal random ±. */
  recoilV: number;
  recoilH: number;
  /** Aim-down-sights magnification (1 = none). The M24 scope is ~4×. */
  adsZoom: number;
  /** Movement speed multiplier while aiming. */
  adsMove: number;
  /** Reserve ammo that comes with a weapon picked up from the ground. */
  pickupReserve: number;
}

export const GUNS: Record<GunId, GunDef> = {
  m416: {
    id: 'm416', name: 'M416', short: 'M416', category: 'Assault rifle', ammo: '556', damage: 19, pellets: 1, magazine: 30, fireRate: 11, automatic: true,
    reloadSeconds: 2.1, falloffStart: 30, falloffEnd: 70, falloffMin: 0.7, maxRange: 110, headMultiplier: 1.6, spreadHip: 2.2, spreadAds: 0.35,
    recoilV: 0.0105, recoilH: 0.006, adsZoom: 1.3, adsMove: 0.75, pickupReserve: 60,
  },
  ak47: {
    id: 'ak47', name: 'AK-47', short: 'AK-47', category: 'Assault rifle', ammo: '762', damage: 26, pellets: 1, magazine: 30, fireRate: 8, automatic: true,
    reloadSeconds: 2.4, falloffStart: 25, falloffEnd: 65, falloffMin: 0.65, maxRange: 110, headMultiplier: 1.6, spreadHip: 2.8, spreadAds: 0.6,
    recoilV: 0.019, recoilH: 0.013, adsZoom: 1.3, adsMove: 0.72, pickupReserve: 60,
  },
  mp5: {
    id: 'mp5', name: 'MP5', short: 'MP5', category: 'SMG', ammo: '9mm', damage: 15, pellets: 1, magazine: 35, fireRate: 14, automatic: true,
    reloadSeconds: 1.9, falloffStart: 12, falloffEnd: 40, falloffMin: 0.55, maxRange: 70, headMultiplier: 1.5, spreadHip: 2.4, spreadAds: 0.9,
    recoilV: 0.0065, recoilH: 0.005, adsZoom: 1.2, adsMove: 0.88, pickupReserve: 70,
  },
  shotgun: {
    id: 'shotgun', name: 'Pump Shotgun', short: 'Shotgun', category: 'Shotgun', ammo: '12g', damage: 9, pellets: 8, magazine: 6, fireRate: 1, automatic: false,
    reloadSeconds: 2.8, falloffStart: 6, falloffEnd: 22, falloffMin: 0.25, maxRange: 30, headMultiplier: 1.25, spreadHip: 5.5, spreadAds: 4.5,
    recoilV: 0.05, recoilH: 0.012, adsZoom: 1.15, adsMove: 0.8, pickupReserve: 12,
  },
  m24: {
    id: 'm24', name: 'M24 Sniper', short: 'M24', category: 'Sniper', ammo: '762', damage: 80, pellets: 1, magazine: 5, fireRate: 1 / 1.15, automatic: false,
    reloadSeconds: 3.0, falloffStart: 200, falloffEnd: 220, falloffMin: 1, maxRange: 220, headMultiplier: 2, spreadHip: 7, spreadAds: 0,
    recoilV: 0.06, recoilH: 0.01, adsZoom: 4, adsMove: 0.5, pickupReserve: 10,
  },
};

/** The default melee weapon everyone spawns with. */
export const SWORD = {
  id: 'sword' as const,
  name: 'Sword',
  damage: 25,
  range: 3.1,
  cooldown: 0.55,
  /** Item key reused from the main game for the first-person model. */
  item: 'copper_sword',
};

export const AMMO_NAMES: Record<AmmoType, string> = { '556': '5.56mm', '762': '7.62mm', '9mm': '9mm', '12g': '12 Gauge' };
/** Most reserve ammo a player can carry per type. */
export const AMMO_CAP: Record<AmmoType, number> = { '556': 180, '762': 120, '9mm': 210, '12g': 36 };
/** Rounds in one ground ammo box. */
export const AMMO_BOX: Record<AmmoType, number> = { '556': 60, '762': 40, '9mm': 70, '12g': 12 };

export const MAX_HP = 100;
export const SMALL_MEDKIT = { heal: 30, seconds: 0.6, carry: 3 };
export const LARGE_MEDKIT = { heal: 65, seconds: 2, carry: 2 };
export const HEALTH_STATION = { heal: 20, cooldown: 20 };

export function isGun(w: unknown): w is GunId {
  return typeof w === 'string' && (GUN_IDS as string[]).includes(w);
}

export function isWeapon(w: unknown): w is WeaponId {
  return w === 'sword' || isGun(w);
}

export function weaponName(w: WeaponId | string): string {
  if (w === 'sword') return SWORD.name;
  return isGun(w) ? GUNS[w].name : String(w);
}

/** Damage multiplier for distance (1 up close, falling off to falloffMin; 0 past max range). */
export function falloff(def: GunDef, dist: number): number {
  if (dist > def.maxRange) return 0;
  if (dist <= def.falloffStart) return 1;
  if (dist >= def.falloffEnd) return def.falloffMin;
  const k = (dist - def.falloffStart) / (def.falloffEnd - def.falloffStart);
  return 1 + (def.falloffMin - 1) * k;
}

/** Seconds between shots. */
export function fireInterval(def: GunDef): number {
  return 1 / def.fireRate;
}
