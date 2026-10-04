import { mulberry32 } from '../core/random';
import type { LootPoint, LootTier, MapPoint } from './DeathmatchMap';
import { AMMO_BOX, GUNS, type AmmoType, type GunId } from './WeaponDefinitions';
import type { Arsenal } from './WeaponSystem';

/**
 * Ground pickups, owned by the host. Fixed, validated spawn points around the
 * city; the host rolls what appears at each one. Every pickup has a unique id
 * and is handed out at most once: two players reaching the same gun in the same
 * instant → the first request processed wins, the other gets "gone".
 */

export type LootKind =
  | { k: 'gun'; gun: GunId; mag: number; reserve: number }
  | { k: 'ammo'; ammo: AmmoType; n: number }
  | { k: 'pack' }
  | { k: 'med'; size: 'small' | 'large' };

export interface LootItem {
  lid: string;
  kind: LootKind;
  x: number;
  y: number;
  z: number;
  /** Fixed point id (respawns) or null (dropped by an eliminated player; expires). */
  point: string | null;
}

export const RESPAWN_SECONDS: Record<LootTier, number> = { common: 20, uncommon: 35, rare: 60 };
export const DROP_LIFETIME = 30;
export const PICKUP_RANGE = 2.6;

const TABLE: Record<LootTier, [number, () => LootKind][]> = {
  common: [
    [3, () => gunKind('m416')],
    [3, () => gunKind('mp5')],
    [2, () => ({ k: 'ammo', ammo: '556', n: AMMO_BOX['556'] })],
    [2, () => ({ k: 'ammo', ammo: '9mm', n: AMMO_BOX['9mm'] })],
    [1, () => ({ k: 'ammo', ammo: '12g', n: AMMO_BOX['12g'] })],
    [3, () => ({ k: 'med', size: 'small' })],
  ],
  uncommon: [
    [3, () => gunKind('ak47')],
    [3, () => gunKind('shotgun')],
    [2, () => ({ k: 'pack' })],
    [1, () => ({ k: 'ammo', ammo: '762', n: AMMO_BOX['762'] })],
    [1, () => ({ k: 'med', size: 'large' })],
  ],
  rare: [
    [3, () => gunKind('m24')],
    [2, () => ({ k: 'med', size: 'large' })],
    [1, () => gunKind('ak47')],
  ],
};

function gunKind(gun: GunId): LootKind {
  return { k: 'gun', gun, mag: GUNS[gun].magazine, reserve: GUNS[gun].pickupReserve };
}

export function lootLabel(k: LootKind): string {
  switch (k.k) {
    case 'gun': return GUNS[k.gun].name;
    case 'ammo': return `${k.ammo === '556' ? '5.56mm' : k.ammo === '762' ? '7.62mm' : k.ammo === '9mm' ? '9mm' : '12 Gauge'} Ammo`;
    case 'pack': return 'Ammo Pack';
    case 'med': return k.size === 'small' ? 'Small Medkit' : 'Large Medkit';
  }
}

/** Would this pickup do anything for this player right now? (null = yes, else a reason). */
export function pickupBlock(k: LootKind, a: Arsenal): string | null {
  switch (k.k) {
    case 'gun': return a.has(k.gun) && a.ammoFull(GUNS[k.gun].ammo) ? 'Ammo full' : null;
    case 'ammo': return a.ammoFull(k.ammo) ? 'Ammo full' : null;
    case 'pack': {
      const types = a.guns.filter(Boolean).map((g) => GUNS[g!].ammo);
      if (!types.length) return 'No gun for this ammo';
      return types.every((t) => a.ammoFull(t)) ? 'Ammo full' : null;
    }
    case 'med': return (k.size === 'small' ? a.small >= 3 : a.large >= 2) ? 'Medkits full' : null;
  }
}

/** Apply a pickup to a loadout. Returns a gun to drop when a full slot was swapped. */
export function applyPickup(k: LootKind, a: Arsenal, now: number): { ok: boolean; dropped: { gun: GunId; mag: number } | null } {
  if (pickupBlock(k, a)) return { ok: false, dropped: null };
  switch (k.k) {
    case 'gun': {
      const r = a.addGun(k.gun, k.mag, k.reserve, now);
      return { ok: r.ok, dropped: r.dropped };
    }
    case 'ammo': return { ok: a.addAmmo(k.ammo, k.n) > 0, dropped: null };
    case 'pack': {
      let got = 0;
      for (const g of a.guns) if (g) got += a.addAmmo(GUNS[g].ammo, GUNS[g].magazine);
      return { ok: got > 0, dropped: null };
    }
    case 'med': return { ok: a.addMedkit(k.size), dropped: null };
  }
}

export class LootManager {
  readonly items = new Map<string, LootItem>();
  /** Fixed point id → time it comes back. */
  private respawnAt = new Map<string, number>();
  private dropExpires = new Map<string, number>();
  private seq = 0;
  private rnd: () => number;

  constructor(readonly points: LootPoint[], seed: number) {
    this.rnd = mulberry32(seed ^ 0x10075);
  }

  private roll(tier: LootTier): LootKind {
    const t = TABLE[tier];
    const total = t.reduce((s, [w]) => s + w, 0);
    let r = this.rnd() * total;
    for (const [w, f] of t) if ((r -= w) < 0) return f();
    return t[0][1]();
  }

  private spawnAt(p: LootPoint): LootItem {
    const it: LootItem = { lid: `L${++this.seq}`, kind: this.roll(p.tier), x: p.x, y: p.y, z: p.z, point: p.id };
    this.items.set(it.lid, it);
    return it;
  }

  /** Fresh round: every point gets an item. */
  reset(): LootItem[] {
    this.items.clear();
    this.respawnAt.clear();
    this.dropExpires.clear();
    return this.points.map((p) => this.spawnAt(p));
  }

  /** Validate + take. Never hands out the same item twice. */
  take(lid: string, from: MapPoint, now: number): { item: LootItem } | { error: 'gone' | 'far' } {
    const it = this.items.get(lid);
    if (!it) return { error: 'gone' };
    if (Math.hypot(it.x - from.x, it.z - from.z) > PICKUP_RANGE || Math.abs(it.y - from.y) > 2.2) return { error: 'far' };
    this.items.delete(lid);
    if (it.point) {
      const p = this.points.find((q) => q.id === it.point);
      this.respawnAt.set(it.point, now + RESPAWN_SECONDS[p?.tier ?? 'common']);
    } else this.dropExpires.delete(lid);
    return { item: it };
  }

  /** Put something on the ground (eliminated player's guns, a swapped-out gun). */
  drop(kind: LootKind, x: number, y: number, z: number, now: number): LootItem {
    const it: LootItem = { lid: `D${++this.seq}`, kind, x, y, z, point: null };
    this.items.set(it.lid, it);
    this.dropExpires.set(it.lid, now + DROP_LIFETIME);
    return it;
  }

  /** Respawns due and dropped items expired, as of `now`. */
  tick(now: number): { added: LootItem[]; removed: string[] } {
    const added: LootItem[] = [], removed: string[] = [];
    for (const [pid, at] of this.respawnAt) {
      if (now < at) continue;
      this.respawnAt.delete(pid);
      const p = this.points.find((q) => q.id === pid);
      if (p) added.push(this.spawnAt(p));
    }
    for (const [lid, at] of this.dropExpires) {
      if (now < at) continue;
      this.dropExpires.delete(lid);
      if (this.items.delete(lid)) removed.push(lid);
    }
    return { added, removed };
  }
}
