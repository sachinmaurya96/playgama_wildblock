import {
  AMMO_CAP, AMMO_TYPES, GUNS, LARGE_MEDKIT, SMALL_MEDKIT, SWORD, fireInterval, isGun,
  type AmmoType, type GunId, type WeaponId,
} from './WeaponDefinitions';

/**
 * A player's Deathmatch loadout as a small state machine: the default sword,
 * two firearm slots, per-gun magazines, reserve ammo per calibre, medkits,
 * fire cooldowns and reloads.
 *
 * The same class runs in two places:
 *  - on the shooter's device, for instant feedback (client prediction);
 *  - on the host, as the authoritative copy that every shot is checked against.
 * The host copy is created with a small timing tolerance so honest players on
 * a jittery connection are never rejected, while the long-run fire rate and
 * the ammo count stay exact (a token-bucket style cooldown).
 *
 * Time is in seconds from any monotonic clock.
 */

/** Slot 0 = sword, 1 and 2 = firearm slots. */
export type Slot = 0 | 1 | 2;

export interface LoadoutSnapshot {
  guns: [GunId | null, GunId | null];
  /** Rounds loaded in each carried gun. */
  mags: Partial<Record<GunId, number>>;
  ammo: Record<AmmoType, number>;
  sel: Slot;
  small: number;
  large: number;
}

export type FireBlock = 'no_gun' | 'reloading' | 'empty' | 'cooldown' | 'equipping';

export interface ArsenalOptions {
  /** Seconds a shot may arrive early (host: network jitter). 0 on the shooter's own device. */
  tolerance?: number;
  /** Fraction of the reload time required before the reload counts as done (host: < 1 for jitter). */
  reloadScale?: number;
  /** Seconds after switching weapons before the new one can fire. */
  equipDelay?: number;
}

const emptyAmmo = (): Record<AmmoType, number> => ({ '556': 0, '762': 0, '9mm': 0, '12g': 0 });

export class Arsenal {
  guns: [GunId | null, GunId | null] = [null, null];
  mags: Partial<Record<GunId, number>> = {};
  ammo: Record<AmmoType, number> = emptyAmmo();
  sel: Slot = 0;
  small = 0;
  large = 0;
  reloading: { gun: GunId; startedAt: number; endsAt: number } | null = null;
  private nextFireAt = 0;
  private readyAt = 0;
  private nextMeleeAt = 0;
  readonly tolerance: number;
  readonly reloadScale: number;
  readonly equipDelay: number;

  constructor(opts: ArsenalOptions = {}) {
    this.tolerance = opts.tolerance ?? 0;
    this.reloadScale = opts.reloadScale ?? 1;
    this.equipDelay = opts.equipDelay ?? 0.3;
  }

  /** Back to the spawn loadout: just the sword. */
  reset(): void {
    this.guns = [null, null];
    this.mags = {};
    this.ammo = emptyAmmo();
    this.sel = 0;
    this.small = 0;
    this.large = 0;
    this.reloading = null;
    this.nextFireAt = 0;
    this.readyAt = 0;
    this.nextMeleeAt = 0;
  }

  get weapon(): WeaponId {
    if (this.sel === 0) return 'sword';
    return this.guns[this.sel - 1] ?? 'sword';
  }

  get gun(): GunId | null {
    const w = this.weapon;
    return isGun(w) ? w : null;
  }

  has(gun: GunId): boolean {
    return this.guns[0] === gun || this.guns[1] === gun;
  }

  mag(gun: GunId): number {
    return this.mags[gun] ?? 0;
  }

  reserveFor(gun: GunId): number {
    return this.ammo[GUNS[gun].ammo];
  }

  /** Select a slot. Switching cancels a reload in progress (no ammo moves). Returns false for an empty slot. */
  equip(slot: Slot, now: number): boolean {
    if (slot !== 0 && !this.guns[slot - 1]) return false;
    if (slot === this.sel) return true;
    this.sel = slot;
    this.reloading = null;
    this.readyAt = now + this.equipDelay;
    return true;
  }

  /** Next occupied slot (wheel / mobile switch button). */
  cycle(dir: 1 | -1): Slot {
    for (let i = 1; i <= 3; i++) {
      const s = ((this.sel + dir * i + 6) % 3) as Slot;
      if (s === 0 || this.guns[s - 1]) return s;
    }
    return this.sel;
  }

  canFire(now: number): FireBlock | null {
    const g = this.gun;
    if (!g) return 'no_gun';
    if (this.reloading) return 'reloading';
    if (now < this.readyAt - this.tolerance) return 'equipping';
    if (this.mag(g) <= 0) return 'empty';
    if (now < this.nextFireAt - this.tolerance) return 'cooldown';
    return null;
  }

  /** Spend one round (call only after canFire returned null). */
  fire(now: number): GunId | null {
    const g = this.gun;
    if (!g || this.canFire(now)) return null;
    this.mags[g] = this.mag(g) - 1;
    this.nextFireAt = Math.max(this.nextFireAt, now - this.tolerance) + fireInterval(GUNS[g]);
    return g;
  }

  canMelee(now: number): boolean {
    return this.weapon === 'sword' && now >= this.nextMeleeAt - this.tolerance && now >= this.readyAt - this.tolerance;
  }

  melee(now: number): boolean {
    if (!this.canMelee(now)) return false;
    this.nextMeleeAt = Math.max(this.nextMeleeAt, now - this.tolerance) + SWORD.cooldown;
    return true;
  }

  /** Why a reload can't start (null = it can). */
  reloadBlock(): 'no_gun' | 'reloading' | 'full' | 'no_ammo' | null {
    const g = this.gun;
    if (!g) return 'no_gun';
    if (this.reloading) return 'reloading';
    if (this.mag(g) >= GUNS[g].magazine) return 'full';
    if (this.reserveFor(g) <= 0) return 'no_ammo';
    return null;
  }

  startReload(now: number): boolean {
    if (this.reloadBlock()) return false;
    const g = this.gun!;
    this.reloading = { gun: g, startedAt: now, endsAt: now + GUNS[g].reloadSeconds * this.reloadScale };
    return true;
  }

  /** 0..1 progress of the reload in progress. */
  reloadProgress(now: number): number {
    const r = this.reloading;
    if (!r) return 0;
    return Math.min(1, (now - r.startedAt) / Math.max(1e-3, r.endsAt - r.startedAt));
  }

  /** Finish a due reload. Returns the gun that was reloaded. Never creates ammo: rounds come out of the reserve. */
  update(now: number): GunId | null {
    const r = this.reloading;
    if (!r || now < r.endsAt) return null;
    this.reloading = null;
    const def = GUNS[r.gun];
    if (!this.has(r.gun)) return null;
    const want = def.magazine - this.mag(r.gun);
    const take = Math.max(0, Math.min(want, this.ammo[def.ammo]));
    this.mags[r.gun] = this.mag(r.gun) + take;
    this.ammo[def.ammo] -= take;
    return r.gun;
  }

  /**
   * Pick up a gun. Already carrying it → its rounds go to the reserve instead.
   * Both slots full → it replaces the gun in hand (or slot 1 while the sword is out); the old one is returned so it can be dropped.
   */
  addGun(gun: GunId, mag: number, reserve: number, now: number): { ok: boolean; dropped: { gun: GunId; mag: number } | null; ammoOnly: boolean } {
    const def = GUNS[gun];
    mag = Math.max(0, Math.min(def.magazine, Math.floor(mag)));
    if (this.has(gun)) {
      const got = this.addAmmo(def.ammo, mag + reserve);
      return { ok: got > 0, dropped: null, ammoOnly: true };
    }
    let slot: 0 | 1;
    let dropped: { gun: GunId; mag: number } | null = null;
    if (!this.guns[0]) slot = 0;
    else if (!this.guns[1]) slot = 1;
    else {
      slot = this.sel === 2 ? 1 : 0;
      const old = this.guns[slot]!;
      dropped = { gun: old, mag: this.mag(old) };
      delete this.mags[old];
      if (this.reloading?.gun === old) this.reloading = null;
    }
    this.guns[slot] = gun;
    this.mags[gun] = mag;
    this.addAmmo(def.ammo, reserve);
    this.equip((slot + 1) as Slot, now);
    return { ok: true, dropped, ammoOnly: false };
  }

  /** Add reserve rounds (capped). Returns how many were taken. */
  addAmmo(type: AmmoType, n: number): number {
    const room = AMMO_CAP[type] - this.ammo[type];
    const take = Math.max(0, Math.min(room, Math.floor(n)));
    this.ammo[type] += take;
    return take;
  }

  ammoFull(type: AmmoType): boolean {
    return this.ammo[type] >= AMMO_CAP[type];
  }

  addMedkit(kind: 'small' | 'large'): boolean {
    if (kind === 'small') {
      if (this.small >= SMALL_MEDKIT.carry) return false;
      this.small++;
    } else {
      if (this.large >= LARGE_MEDKIT.carry) return false;
      this.large++;
    }
    return true;
  }

  /** Guns (with their loaded rounds) and a share of the matching reserve — what drops when this player is eliminated. */
  dropsOnDeath(): { gun: GunId; mag: number; reserve: number }[] {
    const out: { gun: GunId; mag: number; reserve: number }[] = [];
    const left = { ...this.ammo };
    for (const g of this.guns) {
      if (!g) continue;
      const t = GUNS[g].ammo;
      const reserve = Math.min(left[t], GUNS[g].magazine);
      left[t] -= reserve;
      out.push({ gun: g, mag: this.mag(g), reserve });
    }
    return out;
  }

  snapshot(): LoadoutSnapshot {
    return { guns: [this.guns[0], this.guns[1]], mags: { ...this.mags }, ammo: { ...this.ammo }, sel: this.sel, small: this.small, large: this.large };
  }

  /** Adopt the host's authoritative loadout (keeps cooldown timers). */
  load(s: LoadoutSnapshot, now: number): void {
    const prevWeapon = this.weapon;
    this.guns = [s.guns[0], s.guns[1]];
    this.mags = { ...s.mags };
    this.ammo = { ...s.ammo };
    this.small = s.small;
    this.large = s.large;
    this.sel = s.sel;
    if (this.reloading && !this.has(this.reloading.gun)) this.reloading = null;
    if (this.weapon !== prevWeapon) {
      this.reloading = null;
      this.readyAt = now + this.equipDelay;
    }
  }
}

/** Strict validation of a loadout snapshot from the network. */
export function parseLoadout(v: unknown): LoadoutSnapshot | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.guns) || o.guns.length !== 2) return null;
  const guns = o.guns.map((g) => (g === null ? null : isGun(g) ? g : undefined));
  if (guns.some((g) => g === undefined)) return null;
  const mags: Partial<Record<GunId, number>> = {};
  if (o.mags && typeof o.mags === 'object') {
    for (const [k, n] of Object.entries(o.mags as Record<string, unknown>)) {
      if (isGun(k) && Number.isInteger(n) && (n as number) >= 0 && (n as number) <= GUNS[k].magazine) mags[k] = n as number;
    }
  }
  const ammo = emptyAmmo();
  if (o.ammo && typeof o.ammo === 'object') {
    for (const t of AMMO_TYPES) {
      const n = (o.ammo as Record<string, unknown>)[t];
      if (Number.isInteger(n) && (n as number) >= 0) ammo[t] = Math.min(AMMO_CAP[t], n as number);
    }
  }
  const sel = o.sel === 1 || o.sel === 2 ? o.sel : 0;
  const small = Number.isInteger(o.small) ? Math.max(0, Math.min(SMALL_MEDKIT.carry, o.small as number)) : 0;
  const large = Number.isInteger(o.large) ? Math.max(0, Math.min(LARGE_MEDKIT.carry, o.large as number)) : 0;
  return { guns: guns as [GunId | null, GunId | null], mags, ammo, sel, small, large };
}
