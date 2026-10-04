import * as THREE from 'three';
import { part } from '../rendering/Models';
import type { GunId } from './WeaponDefinitions';

/**
 * Original procedural voxel guns, built from boxes in the WildBlocks style.
 * The M416, AK-47, MP5 and shotgun carry a red-dot sight; the M24 keeps its sniper scope.
 * Each model points down -Z with the pistol grip at the origin (so a hand can
 * hold it), and tags its muzzle (`userData.muzzle`), magazine (`userData.mag`)
 * and moving part — bolt / pump — (`userData.action`) for animations.
 *
 * Geometry & materials are shared (Models.ts caches both), so a gun costs only
 * a few dozen meshes and nothing to dispose.
 */

const C = {
  black: '#26282c', dark: '#3a3d43', gun: '#4a4e55', steel: '#6c7178', tan: '#c9a25a', yellow: '#d6b23e',
  wood: '#a5582a', woodDark: '#7c3f1c', olive: '#4f6b34', oliveDark: '#3c5328', red: '#e0372f', lens: '#2f8ee0',
};

function group(): THREE.Group {
  const g = new THREE.Group();
  g.userData.muzzle = new THREE.Vector3(0, 0.06, -0.8);
  return g;
}

function mag(g: THREE.Group, w: number, h: number, d: number, color: string, x: number, y: number, z: number, tilt = 0): THREE.Group {
  const m = new THREE.Group();
  m.position.set(x, y, z);
  const p = part(m, w, h, d, color, 0, -h / 2, 0);
  p.rotation.x = tilt;
  g.add(m);
  g.userData.mag = m;
  return m;
}

/** Sight line: every model's aim point sits this high above the grip (GunViewModel's ADS position). */
const SIGHT_Y = 0.16;
/** See-through lens glass, shared by every sight. */
const LENS = new THREE.MeshBasicMaterial({ color: '#a8dcff', transparent: true, opacity: 0.2, depthWrite: false });
const LENS_GEO = new THREE.PlaneGeometry(1, 1);

/**
 * Voxel red-dot sight (reference sheet "Red Dot Scope"): rail mount with clamp knobs, octagonal housing with
 * hooded front & rear rings, blue-tinted glass, a glowing red dot centred on the sight line, a top turret with a
 * red band and a side turret with a red mark. `z` = centre along the gun, `base` = top of the rail it sits on.
 */
function redDotSight(g: THREE.Object3D, z: number, base: number): void {
  const y = SIGHT_Y;
  const W = 0.078, H = 0.072, L = 0.11, T = 0.012; // housing outer size & wall thickness
  // mount: rail clamp from the rail up to the housing, two knobs on each side
  const bottom = y - H / 2;
  part(g, 0.05, Math.max(0.01, bottom - base), 0.08, C.black, 0, (base + bottom) / 2, z);
  part(g, 0.066, 0.018, 0.09, C.dark, 0, base + 0.009, z);
  for (const kz of [-0.028, 0.028]) for (const kx of [-1, 1]) part(g, 0.012, 0.014, 0.014, C.steel, kx * 0.037, base + 0.012, z + kz);
  // housing tube: four walls round an open middle (you look through it)
  part(g, W, T, L, C.black, 0, y + H / 2 - T / 2, z);
  part(g, W, T, L, C.black, 0, y - H / 2 + T / 2, z);
  part(g, T, H, L, C.black, -W / 2 + T / 2, y, z);
  part(g, T, H, L, C.black, W / 2 - T / 2, y, z);
  // bevelled outer corners make the octagon (kept outside the window you look through)
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const c = part(g, 0.014, 0.014, L * 0.98, C.dark, sx * (W / 2 - 0.004), y + sy * (H / 2 - 0.004), z);
    c.rotation.z = Math.PI / 4;
  }
  // front & rear hood rings (slightly bigger, dark grey)
  for (const [rz, d] of [[z - L / 2 - 0.008, 0.02], [z + L / 2 + 0.004, 0.012]] as const) {
    part(g, W + 0.012, 0.014, d, C.dark, 0, y + H / 2 + 0.001, rz);
    part(g, W + 0.012, 0.014, d, C.dark, 0, y - H / 2 - 0.001, rz);
    part(g, 0.014, H + 0.012, d, C.dark, -W / 2 - 0.001, y, rz);
    part(g, 0.014, H + 0.012, d, C.dark, W / 2 + 0.001, y, rz);
  }
  // glass and the dot
  const glass = new THREE.Mesh(LENS_GEO, LENS);
  glass.scale.set(W - 2 * T, H - 2 * T, 1);
  glass.position.set(0, y, z - L / 2 + 0.01);
  g.add(glass);
  part(g, 0.007, 0.007, 0.004, C.red, 0, y, z - L / 2 + 0.012, '#ff2a1f');
  // top turret (brightness) with a red band
  part(g, 0.032, 0.012, 0.032, C.dark, 0, y + H / 2 + 0.006, z + 0.01);
  part(g, 0.034, 0.008, 0.034, C.red, 0, y + H / 2 + 0.016, z + 0.01, '#a81c14');
  part(g, 0.038, 0.014, 0.038, C.black, 0, y + H / 2 + 0.027, z + 0.01);
  // side turret (windage) with a red mark
  part(g, 0.014, 0.034, 0.034, C.black, W / 2 + 0.007, y, z + 0.012);
  part(g, 0.004, 0.008, 0.018, C.red, W / 2 + 0.016, y, z + 0.012, '#a81c14');
}

function m416(): THREE.Group {
  const g = group();
  part(g, 0.075, 0.075, 0.42, C.gun, 0, 0.06, -0.12); // upper receiver
  part(g, 0.07, 0.05, 0.3, C.dark, 0, 0.0, -0.06); // lower
  part(g, 0.085, 0.085, 0.3, C.dark, 0, 0.06, -0.45); // railed handguard
  for (let i = 0; i < 5; i++) part(g, 0.095, 0.015, 0.03, C.black, 0, 0.11, -0.33 - i * 0.055);
  part(g, 0.1, 0.012, 0.25, C.tan, 0, 0.06, -0.45); // tan side panels
  part(g, 0.03, 0.03, 0.18, C.black, 0, 0.06, -0.68); // barrel
  part(g, 0.045, 0.045, 0.06, C.black, 0, 0.06, -0.77); // flash hider
  part(g, 0.015, 0.012, 0.42, C.black, 0, 0.105, -0.15); // top rail
  redDotSight(g, -0.12, 0.111);
  part(g, 0.05, 0.13, 0.06, C.black, 0, -0.07, 0.04).rotation.x = -0.3; // grip
  part(g, 0.06, 0.06, 0.24, C.dark, 0, 0.04, 0.24); // buffer tube
  part(g, 0.07, 0.12, 0.1, C.yellow, 0, 0.0, 0.36); // stock
  part(g, 0.04, 0.02, 0.12, C.black, 0, -0.04, -0.02); // trigger guard
  mag(g, 0.05, 0.2, 0.07, C.black, 0, 0.0, -0.15, 0.18);
  g.userData.muzzle.set(0, 0.06, -0.81);
  return g;
}

function ak47(): THREE.Group {
  const g = group();
  part(g, 0.07, 0.08, 0.36, C.steel, 0, 0.05, -0.1); // receiver
  part(g, 0.072, 0.015, 0.3, C.dark, 0, 0.095, -0.1); // dust cover
  part(g, 0.08, 0.075, 0.22, C.wood, 0, 0.045, -0.39); // wooden handguard
  part(g, 0.04, 0.035, 0.22, C.wood, 0, 0.1, -0.39); // gas tube cover
  part(g, 0.028, 0.028, 0.32, C.black, 0, 0.05, -0.64); // barrel
  part(g, 0.018, 0.018, 0.2, C.black, 0, 0.1, -0.6); // gas tube
  part(g, 0.02, 0.07, 0.02, C.black, 0, 0.11, -0.72); // front sight post
  part(g, 0.06, 0.008, 0.16, C.black, 0, 0.106, -0.12); // side-rail optic mount on the dust cover
  redDotSight(g, -0.12, 0.11);
  part(g, 0.05, 0.13, 0.06, C.woodDark, 0, -0.07, 0.05).rotation.x = -0.35; // grip
  const st = part(g, 0.065, 0.12, 0.32, C.wood, 0, -0.01, 0.25); // wooden stock (drops down)
  st.rotation.x = 0.16;
  part(g, 0.04, 0.02, 0.12, C.black, 0, -0.03, -0.02);
  // the famous curved magazine: two angled segments
  const m = mag(g, 0.05, 0.12, 0.07, C.wood, 0, 0.0, -0.17, 0.25);
  part(m, 0.05, 0.11, 0.07, C.wood, 0, -0.19, -0.06).rotation.x = 0.55;
  g.userData.muzzle.set(0, 0.05, -0.81);
  return g;
}

function mp5(): THREE.Group {
  const g = group();
  part(g, 0.07, 0.08, 0.34, C.black, 0, 0.05, -0.08); // receiver
  part(g, 0.085, 0.085, 0.16, C.dark, 0, 0.04, -0.32); // round-ish handguard
  part(g, 0.028, 0.028, 0.08, C.black, 0, 0.05, -0.44); // short barrel
  part(g, 0.04, 0.04, 0.03, C.black, 0, 0.05, -0.49);
  part(g, 0.04, 0.05, 0.03, C.black, 0, 0.11, -0.4); // front sight hood
  part(g, 0.04, 0.035, 0.05, C.black, 0, 0.105, 0.03); // drum rear sight
  redDotSight(g, -0.08, 0.09);
  part(g, 0.05, 0.12, 0.06, C.black, 0, -0.06, 0.06).rotation.x = -0.25;
  // retractable stock: two thin rails + butt plate
  part(g, 0.012, 0.012, 0.22, C.steel, -0.025, 0.06, 0.18);
  part(g, 0.012, 0.012, 0.22, C.steel, 0.025, 0.06, 0.18);
  part(g, 0.07, 0.1, 0.025, C.black, 0, 0.04, 0.3);
  part(g, 0.04, 0.02, 0.1, C.black, 0, -0.02, 0.0);
  const m = mag(g, 0.045, 0.1, 0.06, C.dark, 0, 0.01, -0.17, 0.2);
  part(m, 0.045, 0.1, 0.06, C.dark, 0, -0.15, -0.035).rotation.x = 0.4;
  g.userData.muzzle.set(0, 0.05, -0.51);
  return g;
}

function shotgun(): THREE.Group {
  const g = group();
  part(g, 0.075, 0.08, 0.26, C.dark, 0, 0.05, -0.06); // receiver
  part(g, 0.04, 0.04, 0.6, C.black, 0, 0.08, -0.48); // barrel
  part(g, 0.035, 0.035, 0.5, C.dark, 0, 0.03, -0.42); // tube magazine
  part(g, 0.015, 0.02, 0.02, C.steel, 0, 0.11, -0.76); // bead sight
  part(g, 0.05, 0.008, 0.18, C.black, 0, 0.094, -0.06); // receiver rail
  redDotSight(g, -0.06, 0.098);
  const pump = new THREE.Group(); // moving fore-end
  pump.position.set(0, 0.03, -0.36);
  part(pump, 0.075, 0.07, 0.2, C.wood, 0, 0, 0);
  for (let i = 0; i < 3; i++) part(pump, 0.08, 0.012, 0.02, C.woodDark, 0, 0.0, -0.07 + i * 0.07);
  g.add(pump);
  g.userData.action = pump;
  const st = part(g, 0.07, 0.13, 0.36, C.wood, 0, 0.0, 0.26);
  st.rotation.x = 0.12;
  part(g, 0.05, 0.11, 0.07, C.woodDark, 0, -0.06, 0.07).rotation.x = -0.4;
  part(g, 0.04, 0.02, 0.1, C.black, 0, -0.02, 0.0);
  g.userData.mag = pump;
  g.userData.muzzle.set(0, 0.08, -0.8);
  return g;
}

function m24(): THREE.Group {
  const g = group();
  part(g, 0.075, 0.085, 0.95, C.olive, 0, 0.02, -0.05); // long olive stock
  part(g, 0.07, 0.1, 0.22, C.oliveDark, 0, 0.0, 0.32);
  part(g, 0.075, 0.03, 0.3, C.oliveDark, 0, -0.04, 0.38); // cheek / butt
  part(g, 0.032, 0.032, 0.5, C.black, 0, 0.07, -0.72); // barrel
  part(g, 0.045, 0.045, 0.05, C.black, 0, 0.07, -0.97);
  part(g, 0.06, 0.05, 0.28, C.dark, 0, 0.08, -0.08); // action
  // scope
  part(g, 0.06, 0.06, 0.32, C.black, 0, 0.17, -0.1);
  part(g, 0.085, 0.085, 0.08, C.black, 0, 0.17, -0.3);
  part(g, 0.075, 0.075, 0.06, C.black, 0, 0.17, 0.08);
  part(g, 0.06, 0.06, 0.01, C.lens, 0, 0.17, -0.345, '#1d5aa0');
  part(g, 0.03, 0.04, 0.03, C.black, 0, 0.13, -0.18);
  part(g, 0.03, 0.04, 0.03, C.black, 0, 0.13, 0.0);
  const bolt = new THREE.Group();
  bolt.position.set(0.05, 0.08, 0.02);
  part(bolt, 0.07, 0.02, 0.02, C.steel, 0.035, 0, 0);
  part(bolt, 0.03, 0.03, 0.03, C.steel, 0.07, 0, 0);
  g.add(bolt);
  g.userData.action = bolt;
  part(g, 0.04, 0.02, 0.1, C.black, 0, -0.04, -0.02);
  const m = mag(g, 0.045, 0.06, 0.08, C.black, 0, -0.02, -0.1);
  void m;
  g.userData.muzzle.set(0, 0.07, -1.0);
  return g;
}

const BUILDERS: Record<GunId, () => THREE.Group> = { m416, ak47, mp5, shotgun, m24 };

export function buildGun(id: GunId): THREE.Group {
  const g = BUILDERS[id]();
  g.name = `gun-${id}`;
  g.traverse((o) => (o.castShadow = false));
  return g;
}

/** Floating ground icon colours per pickup, like the loot glows in the reference sheet. */
export const PICKUP_GLOW: Record<string, string> = {
  m416: '#3fa8ff', ak47: '#ff4a3a', mp5: '#5be06a', shotgun: '#ff9a2e', m24: '#b76bff',
  '556': '#5f8f3a', '762': '#a8542a', '9mm': '#2f74c9', '12g': '#d83a2c', pack: '#c9a25a', small: '#ffffff', large: '#ff4a4a',
};

/** Ammo box / medkit pickup models. */
export function buildPickupModel(kind: 'ammo' | 'pack' | 'small' | 'large', color: string): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'small' || kind === 'large') {
    const s = kind === 'large' ? 1.3 : 1;
    part(g, 0.42 * s, 0.3 * s, 0.3 * s, kind === 'large' ? '#e23a3a' : '#f2f0ea', 0, 0.15 * s, 0);
    part(g, 0.08 * s, 0.22 * s, 0.32 * s, kind === 'large' ? '#ffffff' : '#e23a3a', 0, 0.16 * s, 0.001);
    part(g, 0.24 * s, 0.07 * s, 0.32 * s, kind === 'large' ? '#ffffff' : '#e23a3a', 0, 0.16 * s, 0.002);
    part(g, 0.16 * s, 0.05 * s, 0.05 * s, '#3a3d43', 0, 0.33 * s, 0);
  } else {
    part(g, 0.4, 0.28, 0.28, color, 0, 0.14, 0);
    part(g, 0.42, 0.05, 0.3, '#3a3d43', 0, 0.29, 0);
    for (let i = 0; i < 3; i++) part(g, 0.04, 0.12, 0.04, '#d6b23e', -0.08 + i * 0.08, 0.36, 0);
  }
  return g;
}
